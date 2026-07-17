(function () {
  const manifestUrl = "manifest-latest.json";
  const modelEl = document.getElementById("fw-model");
  const versionEl = document.getElementById("fw-version");
  const dateEl = document.getElementById("fw-date");
  const navLinks = Array.from(document.querySelectorAll(".nav-link[data-panel]"));
  const brandLink = document.querySelector(".brand[data-panel]");
  const panelIds = ["setup", "install", "download", "troubleshooting"];
  // Which footer variant each tab shows: the guide/troubleshooting tabs get the
  // support-contact footer, the firmware tabs keep the esptool-js credit.
  const footerByPanel = {
    setup: "guide",
    install: "tools",
    download: "tools",
    troubleshooting: "guide",
  };

  document.addEventListener("DOMContentLoaded", () => {
    loadManifest();
    initTabs();
    loadSetupGuide();
  });

  function loadSetupGuide() {
    const panel = document.getElementById("setup");
    if (!panel) {
      return;
    }
    fetch("setupguide-content.html", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.text();
      })
      .then((html) => {
        panel.innerHTML = html;
        if (window.TGSetupGuide) {
          window.TGSetupGuide.init(panel);
        }
      })
      .catch((err) => {
        console.warn("Failed to load setup guide", err);
        panel.innerHTML =
          '<p class="muted">Could not load the setup guide. Please refresh the page to try again.</p>';
      });
  }

  function loadManifest() {
    fetch(manifestUrl, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((manifest) => {
        updateMetadata(manifest);
      })
      .catch((err) => {
        console.warn("Failed to load manifest", err);
        setFallbackMeta();
      });
  }

  function updateMetadata(manifest) {
    const version = manifest.version || "v2.0.0";
    const name = manifest.name || "TrailGuard Camera";
    const releaseDate = manifest.release_date || manifest.date || "";

    if (modelEl) {
      modelEl.textContent = "TrailGuard 4B";
    }
    if (versionEl) {
      versionEl.textContent = version;
    }
    if (dateEl) {
      dateEl.textContent = releaseDate || "Unknown";
    }

    // Update main install button text with version
    const installBtn = document.getElementById("tg-install");
    if (installBtn) {
      installBtn.textContent = `Install TrailGuard ${version} Firmware`;
    }
  }

  function setFallbackMeta() {
    if (modelEl) {
      modelEl.textContent = "TrailGuard 4B";
    }
    if (versionEl) {
      versionEl.textContent = "Unknown";
    }
    if (dateEl) {
      dateEl.textContent = "Unknown";
    }
  }

  function initTabs() {
    const initialPanel = getInitialPanelId();
    setActivePanel(initialPanel, false);

    navLinks.forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const panelId = link.dataset.panel;
        if (!panelIds.includes(panelId)) {
          return;
        }
        setActivePanel(panelId, true);
      });
    });

    // Clicking the brand logo/name returns to the default Set Up Guide tab.
    if (brandLink) {
      brandLink.addEventListener("click", (event) => {
        event.preventDefault();
        setActivePanel("setup", true);
        window.scrollTo({ top: 0 });
      });
    }

    window.addEventListener("hashchange", () => {
      const hashPanel = window.location.hash.replace("#", "");
      if (!panelIds.includes(hashPanel)) {
        return;
      }
      setActivePanel(hashPanel, false);
    });
  }

  function getInitialPanelId() {
    const hashPanel = window.location.hash.replace("#", "");
    if (panelIds.includes(hashPanel)) {
      return hashPanel;
    }
    return "setup";
  }

  function setActivePanel(panelId, updateHash) {
    panelIds.forEach((id) => {
      const panelEl = document.getElementById(id);
      if (!panelEl) {
        return;
      }
      panelEl.classList.toggle("panel-hidden", id !== panelId);
    });

    navLinks.forEach((link) => {
      link.classList.toggle("active", link.dataset.panel === panelId);
    });

    const footerKind = footerByPanel[panelId] || "tools";
    document.querySelectorAll(".footer-variant").forEach((el) => {
      el.hidden = el.dataset.footer !== footerKind;
    });

    if (updateHash && window.location.hash !== `#${panelId}`) {
      window.location.hash = panelId;
    }
  }
})();

