/* ------------------------------------------------------------------ *
 *  TrailGuard Web Firmware Installer — esptool-js direct integration
 *
 *  Architecture:
 *    - ONE transport is kept alive for the entire session.
 *    - Connect enters the bootloader via ESPLoader.main(), which stops
 *      an unstable ESP from rebooting and holds the port firmly.
 *    - After flash/erase, a RTS/DTR reset reboots the device but the
 *      transport stays open — the port is never released.
 *    - The ESPLoader is only valid while in bootloader mode. After a
 *      reset it becomes stale and is cleared, but the transport persists.
 *
 *  Buttons:
 *    Install Firmware                — connect + flash manifest parts + reboot
 *    Factory Reset (in console)      — connect + erase all + flash + reboot
 *    Erase Device (in console)       — erase all, NO reboot (flash empty)
 *    Reboot Device (in console)      — RTS/DTR reset, port stays held
 *
 *  Status bar states:
 *    waiting → connected → flashing / erasing → installed / erased / failed
 * ------------------------------------------------------------------ */

const MANIFEST_URL = "manifest-latest.json";
const FLASH_BAUDRATE = 460800;
const INSTALL_RETRY_COUNT = 3;
const FACTORY_RESET_RETRY_COUNT = 3;
const ERASE_RETRY_COUNT = 3;
const RETRY_DELAY_MS = 2000;
const PORT_WATCH_INTERVAL_MS = 1000;
const PORT_WATCH_TIMEOUT_MS = 10000;

const NON_RETRYABLE_ERROR_PATTERNS = [
  "doesn't fit in the available flash",
  "charcodeat is not a function",
  "manifest has no builds",
  "manifest build has no flash parts",
  "invalid part in manifest",
  "failed to fetch",
  "user cancelled",
  "no port selected",
];

// Local bundle is esptool-js v0.5.7 — pin CDN fallbacks to same version
// to avoid stub loader / flash write incompatibilities with newer releases.
const ESPTOOL_MODULE_URLS = [
  "./esptool-js-bundle.js",
  "https://unpkg.com/esptool-js@0.5.7/bundle.js",
  "https://cdn.jsdelivr.net/npm/esptool-js@0.5.7/bundle.js",
];

/* ---- Status bar states ---- */
const STATUS = {
  LOADING:    { text: "Loading Installer...",                              tone: "waiting" },
  WAITING:    { text: "Installer Loaded - Waiting to Connect...",           tone: "waiting" },
  CONNECTED:  { text: "Connected — Ready to Install Firmware",             tone: "connected" },
  FLASHING:   { text: "Installing Firmware...",                            tone: "flashing" },
  ERASING:    { text: "Erasing Device...",                                 tone: "erasing" },
  INSTALLED:  { text: "Firmware Installed — Device Rebooted",              tone: "installed" },
  ERASED:     { text: "Device Erased — Flash is Empty, Install Firmware Before Disconnecting", tone: "erased" },
  FAILED:     { text: "Operation Failed",                                  tone: "failed" },
  NO_SERIAL:  { text: "Web Serial Unavailable in This Browser. Please use the desktop version of Google Chrome or Microsoft Edge", tone: "failed" },
};

/* ---- DOM refs ---- */
let installBtn = null;
let factoryResetBtn = null;
let eraseBtn = null;
let copyLogBtn = null;
let rebootBtn = null;
let clearLogBtn = null;
let versionSelect = null;
let versionInstallBtn = null;
let versionFactoryResetBtn = null;
let consoleEl = null;
let statusEl = null;

/* ---- State ---- */
let selectedPort = null;       // SerialPort from requestPort()
let activeTransport = null;    // Transport holding the port open (persists across resets)
let activeLoader = null;       // ESPLoader (only valid while in bootloader, null after reset)
let activeChipLabel = null;    // Chip name from last bootloader handshake
let esptoolModule = null;
let loadingModulePromise = null;
let busy = false;
let connected = false;         // true whenever activeTransport is open
let mainFactoryResetEnabled = false;    // toggled by main Factory Reset button
let versionFactoryResetEnabled = false; // toggled by version Factory Reset button

/* ================================================================== *
 *  Utility helpers
 * ================================================================== */

function nowStamp() {
  return new Date().toLocaleTimeString();
}

function appendConsole(text) {
  if (!consoleEl) return;
  consoleEl.textContent += String(text ?? "");
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function appendLine(text) {
  appendConsole(`[${nowStamp()}] ${text}\n`);
}

function clearConsole() {
  if (consoleEl) consoleEl.textContent = "";
}

function setStatus(statusObj, override) {
  if (!statusEl) return;
  statusEl.textContent = override || statusObj.text;
  statusEl.className = "status-bar " + statusObj.tone;
}

function setStatusText(text, tone) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = "status-bar " + tone;
}

function setBusy(state) {
  busy = state;
  updateButtons();
}

function setConnected(state) {
  connected = state;
  updateButtons();
}

function updateButtons() {
  const serialAvailable = "serial" in navigator && window.isSecureContext;
  const canAct = !busy && serialAvailable;

  if (installBtn) installBtn.disabled = !canAct;
  if (factoryResetBtn) factoryResetBtn.disabled = busy;
  if (eraseBtn) eraseBtn.disabled = !canAct;
  if (rebootBtn) rebootBtn.disabled = !canAct || !connected;
  if (versionSelect) versionSelect.disabled = busy;
  if (versionInstallBtn) versionInstallBtn.disabled = !canAct;
  if (versionFactoryResetBtn) versionFactoryResetBtn.disabled = busy;
  if (clearLogBtn) clearLogBtn.disabled = false;
}

function formatError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  return String(error);
}

function isNonRetryableError(errorMessage) {
  const message = String(errorMessage || "").toLowerCase();
  return NON_RETRYABLE_ERROR_PATTERNS.some((p) => message.includes(p));
}

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseOffset(offset) {
  if (typeof offset === "number") return offset;
  if (typeof offset === "string") {
    const v = offset.trim().toLowerCase();
    return v.startsWith("0x") ? parseInt(v, 16) : parseInt(v, 10);
  }
  return NaN;
}

function fileNameFromPath(path) {
  if (!path) return "unknown.bin";
  const parts = String(path).split("/");
  return parts[parts.length - 1] || path;
}

function terminalAdapter() {
  return {
    clean() { clearConsole(); },
    writeLine(data) { appendLine(String(data ?? "")); },
    write(data) { appendConsole(String(data ?? "")); },
  };
}

/* ================================================================== *
 *  esptool-js module loader (with fallback chain + caching)
 * ================================================================== */

async function loadEsptoolModule() {
  if (esptoolModule) return esptoolModule;
  if (loadingModulePromise) return loadingModulePromise;

  loadingModulePromise = (async () => {
    let lastError = null;
    for (const url of ESPTOOL_MODULE_URLS) {
      try {
        const mod = await import(url);
        if (!mod.ESPLoader || !mod.Transport) {
          throw new Error("Missing ESPLoader or Transport export");
        }
        esptoolModule = { ESPLoader: mod.ESPLoader, Transport: mod.Transport };
        return esptoolModule;
      } catch (error) {
        lastError = error;
        appendLine(`Library load failed from ${url}: ${formatError(error)}`);
      }
    }
    throw lastError || new Error("Unable to load esptool-js library");
  })();

  try {
    return await loadingModulePromise;
  } catch (error) {
    loadingModulePromise = null;
    throw error;
  }
}

/* ================================================================== *
 *  Port selection
 * ================================================================== */

async function ensurePortSelected() {
  if (selectedPort) return selectedPort;
  selectedPort = await navigator.serial.requestPort({});
  const info = selectedPort.getInfo ? selectedPort.getInfo() : {};
  const vid = typeof info.usbVendorId === "number"
    ? `0x${info.usbVendorId.toString(16)}` : "unknown";
  const pid = typeof info.usbProductId === "number"
    ? `0x${info.usbProductId.toString(16)}` : "unknown";
  appendLine(`Serial port selected (VID ${vid}, PID ${pid}).`);
  return selectedPort;
}

/* ================================================================== *
 *  Connection management
 *
 *  openConnection() — creates Transport + ESPLoader, enters bootloader.
 *    Stores both in activeTransport / activeLoader.
 *
 *  closeConnection() — closes the transport entirely, releases the port.
 *
 *  hardResetKeepPort() — RTS/DTR reset on activeTransport.
 *    The device reboots out of bootloader, but the transport stays open.
 *    activeLoader is cleared (stale) but activeTransport persists.
 *
 *  reconnectBootloader() — the transport is already open but the loader
 *    is stale (device was reset). Close the transport, create a fresh
 *    Transport + ESPLoader, re-enter bootloader.
 * ================================================================== */

async function openConnection() {
  const mod = await loadEsptoolModule();
  const port = await ensurePortSelected();

  const transport = new mod.Transport(port, true);
  const loader = new mod.ESPLoader({
    transport,
    baudrate: FLASH_BAUDRATE,
    terminal: terminalAdapter(),
    debugLogging: false,
  });

  const chip = await loader.main();
  const chipLabel = typeof chip === "string"
    ? chip : chip?.CHIP_NAME || "ESP device";
  appendLine(`Bootloader connected: ${chipLabel}.`);

  activeTransport = transport;
  activeLoader = loader;
  activeChipLabel = chipLabel;
  setConnected(true);

  return { loader, transport, chipLabel };
}

async function closeConnection() {
  const transport = activeTransport;
  activeTransport = null;
  activeLoader = null;
  activeChipLabel = null;
  setConnected(false);

  if (!transport) return;
  try {
    await transport.disconnect();
  } catch (error) {
    appendLine(`Transport disconnect warning: ${formatError(error)}`);
  }
  if (typeof transport.waitForUnlock === "function") {
    try { await transport.waitForUnlock(600); } catch {}
  }
}

/**
 * Hard-reset the ESP via RTS/DTR on the active transport.
 * The transport stays open. The loader becomes stale and is cleared.
 */
async function hardResetKeepPort() {
  if (!activeTransport) {
    throw new Error("No active transport for reset.");
  }

  await activeTransport.setDTR(false);
  await activeTransport.setRTS(true);
  await sleep(100);
  await activeTransport.setDTR(true);
  await activeTransport.setRTS(false);
  await sleep(500);
  await activeTransport.setDTR(false);

  // Loader is now stale — device left bootloader
  activeLoader = null;
  appendLine("RTS/DTR reset sent. Device is rebooting.");
}

/**
 * Re-enter the bootloader when the transport is open but the loader
 * is stale. Closes the current transport, creates a fresh one, and
 * calls ESPLoader.main() again.
 */
async function reconnectBootloader() {
  await closeConnection();
  await sleep(RETRY_DELAY_MS);
  return await openConnection();
}

/**
 * Wait for the port to become available and enter the bootloader.
 * Used during retries when the device may be mid-reboot.
 */
async function waitForBootloader(timeoutMs = PORT_WATCH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  appendLine("Waiting for device to re-appear on serial port...");

  while (Date.now() < deadline) {
    try {
      const connection = await openConnection();
      appendLine("Device re-captured in bootloader.");
      return connection;
    } catch {
      await sleep(PORT_WATCH_INTERVAL_MS);
    }
  }
  throw new Error("Timed out waiting for device to re-appear on serial port.");
}

/* ================================================================== *
 *  Reboot Device — RTS/DTR reset, transport stays open
 * ================================================================== */

async function rebootDevice() {
  setBusy(true);
  try {
    if (!activeTransport) {
      setStatus(STATUS.FAILED, "Not Connected - Reboot Unavailable");
      appendLine("Reboot failed: no active connection.");
      return;
    }

    appendLine("Reboot: toggling RTS/DTR to reset device...");
    setStatusText("Rebooting Device...", "flashing");

    await hardResetKeepPort();

    setStatus(STATUS.CONNECTED, "Device Rebooted Successfully");
    appendLine("Reboot: complete. Port still connected.");
  } catch (error) {
    const message = formatError(error);
    setStatus(STATUS.FAILED, `Reboot Failed - ${message}`);
    appendLine(`Reboot failed — ${message}`);
  } finally {
    setBusy(false);
  }
}

/* ================================================================== *
 *  Manifest & firmware loading
 * ================================================================== */

async function loadManifestParts(manifestPath) {
  const manifestUrl = new URL(manifestPath || MANIFEST_URL, window.location.href);
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load manifest (${response.status})`);
  }

  const manifest = await response.json();
  if (!Array.isArray(manifest.builds) || manifest.builds.length === 0) {
    throw new Error("Manifest has no builds");
  }

  const build =
    manifest.builds.find((b) => b.chipFamily === "ESP32-S3") ||
    manifest.builds[0];
  if (!Array.isArray(build.parts) || build.parts.length === 0) {
    throw new Error("Manifest build has no flash parts");
  }

  const parts = build.parts.map((part) => {
    const offset = parseOffset(part.offset);
    if (!part.path || Number.isNaN(offset)) {
      throw new Error(`Invalid part in manifest: ${JSON.stringify(part)}`);
    }
    return {
      path: part.path,
      name: fileNameFromPath(part.path),
      offset,
      url: new URL(part.path, manifestUrl).toString(),
    };
  });

  return { manifest, parts };
}

async function preloadParts(parts) {
  const preloaded = [];
  for (const part of parts) {
    appendLine(`Fetching ${part.name}...`);
    const response = await fetch(part.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${part.path} (${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    appendLine(
      `Ready ${part.name} (${bytes.length} bytes) @ 0x${part.offset.toString(16)}.`,
    );
    preloaded.push({ ...part, data: bytes });
  }
  return preloaded;
}

function cloneFlashFiles(preloaded, loader) {
  return preloaded.map((part) => ({
    address: part.offset,
    data:
      typeof loader?.ui8ToBstr === "function"
        ? loader.ui8ToBstr(new Uint8Array(part.data))
        : new Uint8Array(part.data),
  }));
}

/* ================================================================== *
 *  Weighted progress reporting
 *
 *  Manifest parts and their weight in overall progress:
 *    0  bootloader.bin        10%
 *    1  partition-table.bin   10%
 *    2  ota_data_initial.bin  10%
 *    3  app binary            50%
 *    4  storage.bin           20%
 *                            ────
 *                            100%
 *
 *  Progress is capped at 99% during writeFlash — 100% is only shown
 *  after the entire operation (including device reset) succeeds.
 * ================================================================== */

const PART_WEIGHTS = [10, 10, 10, 50, 20];

function getPartWeight(fileIndex, totalParts) {
  if (fileIndex < PART_WEIGHTS.length) {
    return PART_WEIGHTS[fileIndex];
  }
  // Fallback for unexpected part counts: distribute remaining weight evenly
  const defined = PART_WEIGHTS.reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, 100 - defined);
  const extra = totalParts - PART_WEIGHTS.length;
  return extra > 0 ? remaining / extra : 0;
}

function getPartBase(fileIndex, totalParts) {
  let base = 0;
  for (let i = 0; i < fileIndex; i++) {
    base += getPartWeight(i, totalParts);
  }
  return base;
}

/**
 * Create a reportProgress callback for writeFlash that shows a single
 * overall percentage in the status bar.
 *
 * The last part's weight is NOT counted via the live callback — overall
 * caps at the base of the last part (80% for the default 5-part manifest).
 * Instead, simulated ticks (85%, 90%, 95%) are scheduled at 3s intervals
 * once the last part starts writing. Remaining ticks are cancelled when
 * writeFlash resolves. 100% is shown after the entire operation succeeds.
 *
 * Returns { reportProgress, cancel }.
 */
function makeProgressReporter(label, preloaded, flashFiles) {
  const totalParts = flashFiles.length;
  let simulatedTimers = [];
  let simulatedStarted = false;

  function reportProgress(fileIndex, written, total) {
    const safeTotal = total || 1;
    const partFraction = written / safeTotal;
    const base = getPartBase(fileIndex, totalParts);
    // Don't count the last part's live progress — it reports 100% before
    // writeFlash actually resolves. Simulated ticks cover this gap.
    const effectiveWeight = (fileIndex === totalParts - 1)
      ? 0
      : getPartWeight(fileIndex, totalParts);
    const overall = Math.min(Math.floor(base + effectiveWeight * partFraction), 99);

    setStatusText(`${label} - ${overall}%`, "flashing");

    // When the last part starts, simulate 1% increments from 81% to 99%
    if (fileIndex === totalParts - 1 && !simulatedStarted) {
      simulatedStarted = true;
      for (let pct = 81; pct <= 99; pct++) {
        const delayMs = (pct - 80) * 600;
        simulatedTimers.push(
          setTimeout(() => setStatusText(`${label} - ${pct}%`, "flashing"), delayMs)
        );
      }
    }
  }

  function cancel() {
    simulatedTimers.forEach(clearTimeout);
    simulatedTimers = [];
  }

  return { reportProgress, cancel };
}

/* ================================================================== *
 *  Retry harness
 *
 *  Flow:
 *    1. If we have an activeLoader (in bootloader), reuse it directly.
 *    2. If we have activeTransport but no loader (device was reset),
 *       close transport and re-enter bootloader.
 *    3. If we have nothing, open a fresh connection.
 *    4. On failure, close everything and retry from scratch.
 *
 *  After success:
 *    - resetAfter=true:  RTS/DTR reset, transport stays open, loader cleared
 *    - resetAfter=false: no reset, transport stays open, loader cleared
 *  The port is NEVER released. Button stays "Disconnect".
 * ================================================================== */

async function runWithRetries(label, retries, resetAfter, action) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      setStatusText(`${label}: Attempt ${attempt} of ${retries}`, "flashing");
      appendLine(`${label}: attempt ${attempt}/${retries}`);

      // Ensure we have a live loader in bootloader mode
      if (activeLoader && activeTransport) {
        appendLine(`${label}: reusing existing bootloader connection.`);
      } else if (activeTransport && !activeLoader) {
        // Transport open but loader stale (device was reset out of bootloader)
        appendLine(`${label}: re-entering bootloader...`);
        await reconnectBootloader();
      } else {
        // Nothing open — fresh connect
        if (attempt === 1) {
          await openConnection();
        } else {
          await waitForBootloader();
        }
      }

      await action(activeLoader, attempt, retries);

      // Success — reset the device if appropriate
      if (resetAfter) {
        appendLine(`${label}: resetting device...`);
        try {
          await hardResetKeepPort();
        } catch (error) {
          appendLine(`Reset warning: ${formatError(error)}`);
        }
      } else {
        // Erase-only: don't reboot, but loader is done — clear it
        activeLoader = null;
        appendLine(`${label}: skipping reset (flash is empty).`);
      }

      return; // success

    } catch (error) {
      lastError = error;
      const errorMessage = formatError(error);
      appendLine(`${label}: attempt ${attempt} failed — ${errorMessage}`);

      if (isNonRetryableError(errorMessage)) {
        appendLine(`${label}: stopping retries (non-retryable error).`);
        break;
      }

      // Clean up for retry — close everything so next attempt starts fresh
      await closeConnection();
      if (attempt < retries) {
        appendLine(`${label}: waiting ${RETRY_DELAY_MS}ms before retry...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError || new Error(`${label} failed after ${retries} attempts`);
}

/* ================================================================== *
 *  Install Firmware (preserves NVS — no full erase)
 * ================================================================== */

async function installFirmware(manifestPath) {
  const label = "Firmware Installation";
  setBusy(true);
  try {
    setStatus(STATUS.FLASHING);
    await loadEsptoolModule();
    await ensurePortSelected();

    const { parts } = await loadManifestParts(manifestPath);
    const preloaded = await preloadParts(parts);
    appendLine(`${label}: prepared ${preloaded.length} part(s).`);

    const imageEnd = preloaded.reduce(
      (maxEnd, part) => Math.max(maxEnd, part.offset + part.data.length), 0,
    );
    appendLine(
      `${label}: image footprint ends at 0x${imageEnd.toString(16)} (${formatMb(imageEnd)} MB).`,
    );

    const statusLabel = "Installing Firmware";
    await runWithRetries(label, INSTALL_RETRY_COUNT, true, async (loader) => {
      const flashFiles = cloneFlashFiles(preloaded, loader);
      setStatus(STATUS.FLASHING);
      appendLine(`${label}: starting writeFlash (${flashFiles.length} parts)`);

      const progress = makeProgressReporter(statusLabel, preloaded, flashFiles);
      await loader.writeFlash({
        fileArray: flashFiles,
        eraseAll: false,
        compress: true,
        flashMode: "keep",
        flashFreq: "keep",
        flashSize: "keep",
        reportProgress: progress.reportProgress,
      });
      progress.cancel();
    });

    setStatusText("Firmware Installation Successful - 100%", "installed");
    appendLine(`${label}: firmware installation complete`);
  } catch (error) {
    const message = formatError(error);
    setStatus(STATUS.FAILED, `${label} Failed - ${message}`);
    appendLine(`${label}: failed — ${message}`);
  } finally {
    setBusy(false);
  }
}

/* ================================================================== *
 *  Install Firmware + Factory Reset (eraseFlash then flash, reboot)
 * ================================================================== */

async function installFactoryReset(manifestPath) {
  const label = "Factory Reset + Firmware Installation";
  setBusy(true);
  try {
    setStatus(STATUS.FLASHING);
    await loadEsptoolModule();
    await ensurePortSelected();

    const { parts } = await loadManifestParts(manifestPath);
    const preloaded = await preloadParts(parts);
    appendLine(`${label}: prepared ${preloaded.length} part(s).`);

    const imageEnd = preloaded.reduce(
      (maxEnd, part) => Math.max(maxEnd, part.offset + part.data.length), 0,
    );
    appendLine(
      `${label}: image footprint ends at 0x${imageEnd.toString(16)} (${formatMb(imageEnd)} MB).`,
    );

    const statusLabel = "Installing Firmware";
    await runWithRetries(label, FACTORY_RESET_RETRY_COUNT, true, async (loader) => {
      setStatus(STATUS.ERASING);
      appendLine(`${label}: erasing flash now`);
      await loader.eraseFlash();
      appendLine(`${label}: erase complete`);

      const flashFiles = cloneFlashFiles(preloaded, loader);
      setStatus(STATUS.FLASHING);
      appendLine(`${label}: starting writeFlash (${flashFiles.length} parts)`);

      const progress = makeProgressReporter(statusLabel, preloaded, flashFiles);
      await loader.writeFlash({
        fileArray: flashFiles,
        eraseAll: false,
        compress: true,
        flashMode: "keep",
        flashFreq: "keep",
        flashSize: "keep",
        reportProgress: progress.reportProgress,
      });
      progress.cancel();
    });

    setStatusText("Factory Reset + Firmware Installation Successful - 100%", "installed");
    appendLine(`${label}: firmware installation complete`);
  } catch (error) {
    const message = formatError(error);
    setStatus(STATUS.FAILED, `${label} Failed - ${message}`);
    appendLine(`${label}: failed — ${message}`);
  } finally {
    setBusy(false);
  }
}

/* ================================================================== *
 *  Erase Device (erase only — NO reboot, port stays held)
 * ================================================================== */

async function eraseDevice() {
  const label = "Erase Device";
  setBusy(true);
  try {
    await loadEsptoolModule();
    await ensurePortSelected();

    // resetAfter = false — do NOT reboot after erase (flash is empty)
    await runWithRetries(label, ERASE_RETRY_COUNT, false, async (loader) => {
      setStatus(STATUS.ERASING);
      appendLine(`${label}: erasing entire flash...`);
      await loader.eraseFlash();
      appendLine(`${label}: erase complete`);
    });

    setStatus(STATUS.ERASED);
    appendLine(
      `${label}: device erased. Flash is empty — use Install Firmware before disconnecting.`,
    );
  } catch (error) {
    const message = formatError(error);
    setStatus(STATUS.FAILED, `${label} Failed - ${message}`);
    appendLine(`${label}: failed — ${message}`);
  } finally {
    setBusy(false);
  }
}

/* ================================================================== *
 *  Initialisation & event wiring
 * ================================================================== */

function init() {
  installBtn = document.getElementById("tg-install");
  factoryResetBtn = document.getElementById("tg-factory-reset");
  eraseBtn = document.getElementById("tg-erase");
  rebootBtn = document.getElementById("tg-reboot");
  versionSelect = document.getElementById("tg-version-select");
  versionInstallBtn = document.getElementById("tg-version-install");
  versionFactoryResetBtn = document.getElementById("tg-version-factory-reset");
  copyLogBtn = document.getElementById("tg-copy-log");
  clearLogBtn = document.getElementById("tg-clear-log");
  consoleEl = document.getElementById("tg-console");
  statusEl = document.getElementById("tg-status");

  const serialAvailable = "serial" in navigator && window.isSecureContext;
  if (!serialAvailable) {
    setStatus(STATUS.NO_SERIAL);
  } else {
    setStatus(STATUS.LOADING);
    loadEsptoolModule()
      .then(() => setStatus(STATUS.WAITING))
      .catch((error) => setStatus(STATUS.FAILED, `Installer failed to load — ${formatError(error)}`));
  }

  // Track device disconnection at the OS level
  if ("serial" in navigator) {
    navigator.serial.addEventListener("disconnect", (event) => {
      if (event.target === selectedPort) {
        appendLine("Serial device disconnected.");
        activeTransport = null;
        activeLoader = null;
        activeChipLabel = null;
        selectedPort = null;
        setConnected(false);
        if (!busy) {
          setStatus(STATUS.WAITING);
        }
      }
    });
  }

  if (installBtn) {
    installBtn.addEventListener("click", () => {
      if (mainFactoryResetEnabled) {
        installFactoryReset();
      } else {
        installFirmware();
      }
    });
  }
  if (factoryResetBtn) {
    factoryResetBtn.addEventListener("click", () => {
      mainFactoryResetEnabled = !mainFactoryResetEnabled;
      factoryResetBtn.textContent = mainFactoryResetEnabled ? "Factory Reset: YES" : "Factory Reset: NO";
      factoryResetBtn.classList.remove("factory-yes", "factory-no");
      factoryResetBtn.classList.add(mainFactoryResetEnabled ? "factory-yes" : "factory-no");
    });
  }
  if (versionFactoryResetBtn) {
    versionFactoryResetBtn.addEventListener("click", () => {
      versionFactoryResetEnabled = !versionFactoryResetEnabled;
      versionFactoryResetBtn.textContent = versionFactoryResetEnabled ? "Factory Reset: YES" : "Factory Reset: NO";
      versionFactoryResetBtn.classList.remove("factory-yes", "factory-no");
      versionFactoryResetBtn.classList.add(versionFactoryResetEnabled ? "factory-yes" : "factory-no");
    });
  }
  if (versionInstallBtn) {
    versionInstallBtn.addEventListener("click", () => {
      const manifestPath = versionSelect ? versionSelect.value : null;
      if (!manifestPath) return;
      if (versionFactoryResetEnabled) {
        installFactoryReset(manifestPath);
      } else {
        installFirmware(manifestPath);
      }
    });
  }
  if (eraseBtn) {
    eraseBtn.addEventListener("click", () => {
      if (!window.confirm(
        "This will erase ALL data on the device. The flash will be completely empty — the device will NOT boot until firmware is re-installed. Continue?"
      )) {
        appendLine("Erase cancelled by user.");
        return;
      }
      eraseDevice();
    });
  }
  if (rebootBtn) {
    rebootBtn.addEventListener("click", () => rebootDevice());
  }
  if (copyLogBtn) {
    copyLogBtn.addEventListener("click", async () => {
      if (!consoleEl || !consoleEl.textContent) {
        return;
      }
      try {
        await navigator.clipboard.writeText(consoleEl.textContent);
        copyLogBtn.textContent = "Copied!";
        setTimeout(() => { copyLogBtn.textContent = "Copy Logs"; }, 1500);
      } catch {
        // Fallback for non-secure contexts
        const ta = document.createElement("textarea");
        ta.value = consoleEl.textContent;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        copyLogBtn.textContent = "Copied!";
        setTimeout(() => { copyLogBtn.textContent = "Copy Logs"; }, 1500);
      }
    });
  }
  if (clearLogBtn) {
    clearLogBtn.addEventListener("click", () => {
      clearConsole();
      appendLine("Console cleared.");
    });
  }

  updateButtons();
}

document.addEventListener("DOMContentLoaded", init);
