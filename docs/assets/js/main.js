(function () {
  const manifestUrl = "manifest.json";
  const modelEl = document.getElementById("fw-model");
  const versionEl = document.getElementById("fw-version");
  const dateEl = document.getElementById("fw-date");
  const navLinks = Array.from(document.querySelectorAll(".nav-link[data-panel]"));
  const panelIds = ["install", "download", "troubleshooting"];

  document.addEventListener("DOMContentLoaded", () => {
    loadManifest();
    initTabs();
  });

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
    return "install";
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

    if (updateHash && window.location.hash !== `#${panelId}`) {
      window.location.hash = panelId;
    }
  }
})();

