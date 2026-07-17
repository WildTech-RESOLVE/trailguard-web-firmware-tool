/* Setup guide interactions — vanilla port of the React component that shipped
   inside the bundled setupguide.html export (figure lightbox + LED sequence
   simulator). Initialized by main.js after the content fragment is injected. */
(function () {
  "use strict";

  /* ---------- Figure lightbox ---------- */

  function initLightbox(root) {
    let overlay = document.getElementById("tg-zoom-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "tg-zoom-overlay";
      overlay.className = "tg-zoom-overlay";
      overlay.hidden = true;
      overlay.innerHTML =
        '<img alt="Enlarged figure"><div class="tg-zoom-hint">Esc / click to close</div>';
      document.body.appendChild(overlay);

      overlay.addEventListener("click", () => {
        overlay.hidden = true;
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !overlay.hidden) {
          overlay.hidden = true;
        }
      });
    }

    root.addEventListener("click", (event) => {
      const img = event.target.closest(".tg-fig img");
      if (!img) {
        return;
      }
      overlay.querySelector("img").src = img.getAttribute("src");
      overlay.hidden = false;
    });
  }

  /* ---------- LED sequence simulator ---------- */

  const LED_COLORS = {
    sig1: "#2a9468",
    sig2: "#2a9468",
    trans: "#ff9d1a",
    lora: "#2a6fdb",
    power: "#e0483a",
  };

  /* lit: 0 = off, 1 = solid, 2 = flashing */
  const STEPS = {
    ready: {
      label: "Ready",
      lit: { sig1: 1, power: 1 },
      caption: "Sig 1 (LTE) and Power on — unit connected and ready.",
    },
    connecting: {
      label: "Connecting",
      lit: { sig1: 1, power: 1, trans: 1 },
      caption: "Transmission LED on — connecting to the network.",
    },
    transmitting: {
      label: "Transmitting",
      lit: { sig1: 1, power: 1, trans: 2 },
      caption: "Transmission LED flashing — image upload in progress.",
    },
    off: {
      label: "Complete",
      lit: {},
      caption: "All LEDs off — transmission complete.",
    },
  };
  const SEQUENCE = ["ready", "connecting", "transmitting", "off"];

  function initLedSim(root) {
    const panel = root.querySelector("#tg-led-panel");
    if (!panel) {
      return;
    }
    const stepLabel = panel.querySelector("#tg-led-step-label");
    const caption = panel.querySelector("#tg-led-caption");
    const leds = panel.querySelectorAll(".tg-led");
    const labels = panel.querySelectorAll(".tg-led-label");
    const stepButtons = panel.querySelectorAll(".tg-led-step");
    const playBtn = panel.querySelector("#tg-led-play");
    const playText = playBtn.querySelector(".tg-led-play-text");
    const playIcon = playBtn.querySelector(".tg-led-icon-play");
    const stopIcon = playBtn.querySelector(".tg-led-icon-stop");

    let playing = false;
    let timer = null;

    function apply(stepKey) {
      const step = STEPS[stepKey] || STEPS.transmitting;

      leds.forEach((led) => {
        const key = led.dataset.led;
        const state = step.lit[key] || 0;
        const color = LED_COLORS[key];
        if (state >= 1) {
          led.style.background = color;
          led.style.boxShadow = "0 0 14px " + color + ", 0 0 4px " + color;
        } else {
          led.style.background = "#182219";
          led.style.boxShadow = "inset 0 1px 2px rgba(0,0,0,.55)";
        }
        led.style.animation =
          state === 2 ? "ledFlash 0.4s ease-in-out infinite" : "none";
      });

      labels.forEach((label) => {
        const state = step.lit[label.dataset.ledLabel] || 0;
        label.style.color = state >= 1 ? "#e8efe9" : "#4b5a51";
      });

      stepButtons.forEach((btn) => {
        const active = btn.dataset.step === stepKey;
        btn.style.background = active ? "#ff7a00" : "transparent";
        btn.style.color = active ? "#0b0f0c" : "#9db3a5";
        btn.style.borderColor = active ? "#ff7a00" : "#2a3a30";
      });

      stepLabel.textContent = step.label;
      caption.textContent = step.caption;
    }

    function setPlaying(next) {
      playing = next;
      playText.textContent = playing ? "Stop" : "Play sequence";
      playIcon.hidden = playing;
      stopIcon.hidden = !playing;
    }

    function stopPlay() {
      clearTimeout(timer);
      if (playing) {
        setPlaying(false);
      }
    }

    function togglePlay() {
      if (playing) {
        stopPlay();
        return;
      }
      let i = 0;
      setPlaying(true);
      apply(SEQUENCE[0]);
      const tick = () => {
        i += 1;
        if (i >= SEQUENCE.length) {
          setPlaying(false);
          return;
        }
        apply(SEQUENCE[i]);
        timer = setTimeout(tick, SEQUENCE[i] === "transmitting" ? 1900 : 1300);
      };
      timer = setTimeout(tick, 1300);
    }

    stepButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        stopPlay();
        apply(btn.dataset.step);
      });
    });
    playBtn.addEventListener("click", togglePlay);

    apply("transmitting");
  }

  /* ---------- Table-of-contents navigation ---------- */

  // Manual smooth scroll — animates identically on every platform, and works
  // even where native scroll-behavior:smooth is unsupported/disabled.
  function smoothScrollTo(targetY, duration) {
    const startY = window.scrollY;
    const distance = targetY - startY;
    if (Math.abs(distance) < 2) {
      return;
    }
    const easeInOutQuad = (t) =>
      t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    let startTime = null;
    function step(now) {
      if (startTime === null) {
        startTime = now;
      }
      const progress = Math.min((now - startTime) / duration, 1);
      window.scrollTo(0, startY + distance * easeInOutQuad(progress));
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }
    requestAnimationFrame(step);
  }

  function initToc(root) {
    const appbar = document.querySelector(".appbar");
    root.querySelectorAll(".tg-toc-link").forEach((link) => {
      link.setAttribute("role", "link");
      link.setAttribute("tabindex", "0");
      const go = () => {
        const target = document.getElementById(link.dataset.target);
        if (!target) {
          return;
        }
        // Clear the app bar only while it is sticky (it becomes static on
        // narrow screens, where no offset is needed).
        const sticky = appbar && getComputedStyle(appbar).position === "sticky";
        const offset = sticky ? appbar.getBoundingClientRect().height + 14 : 14;
        const targetY = window.scrollY + target.getBoundingClientRect().top - offset;
        smoothScrollTo(Math.max(0, targetY), 500);
      };
      link.addEventListener("click", go);
      link.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          go();
        }
      });
    });
  }

  window.TGSetupGuide = {
    init(root) {
      initLightbox(root);
      initLedSim(root);
      initToc(root);
    },
  };
})();
