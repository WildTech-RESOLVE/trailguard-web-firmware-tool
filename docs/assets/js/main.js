(function () {
  const manifestUrl = "manifest.json";
  const versionEl = document.getElementById("fw-version");
  const dateEl = document.getElementById("fw-date");

  document.addEventListener("DOMContentLoaded", () => {
    loadManifest();
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
    const version = manifest.version || "2.0.0";
    const name = manifest.name || "TrailGuard Firmware";
    const releaseDate = manifest.release_date || manifest.date || "";

    if (versionEl) {
      versionEl.textContent = `${name} ${version}`;
    }
    if (dateEl) {
      dateEl.textContent = releaseDate || "Unknown";
    }
  }

  function setFallbackMeta() {
    if (versionEl) {
      versionEl.textContent = "2.0.0";
    }
    if (dateEl) {
      dateEl.textContent = "Unknown";
    }
  }
})();

