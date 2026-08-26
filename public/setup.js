import { noProPresenterFound } from "./strings.js";
import { createMeter, updateMeter, meterCount } from "./led-meter.js";
import { injectSvg } from "./nav.js";

/**
 * First-run setup screen (Section 6). Shown instead of the rest of the
 * app until config.json exists with a host/port/role. On save, writes
 * config.json and triggers the one-time full index build, showing
 * progress inline until it completes, then hands off to the caller.
 */
export function initSetup({ onComplete }) {
  injectSvg(document.getElementById("setup-brand-logo"), "img/logo.svg", ["h-10", "w-auto"]);

  const hostInput = document.getElementById("setup-host");
  const portInput = document.getElementById("setup-port");
  const detectBtn = document.getElementById("setup-detect-btn");
  const detectResult = document.getElementById("setup-detect-result");
  const testBtn = document.getElementById("setup-test-btn");
  const testResult = document.getElementById("setup-test-result");
  const saveBtn = document.getElementById("setup-save-btn");
  const progressWrap = document.getElementById("setup-progress");
  /**
   * Refrain is designed to sit docked beside ProPresenter. A window wide enough
   * to be maximised means the operator has not got the point of the tool yet,
   * and first-run setup is the one moment they are arranging windows anyway, so
   * the nudge lands when it is actionable rather than as an interruption.
   *
   * Deliberately setup-only. A runtime callout could only ever be made
   * *unlikely* to appear mid-service, never guaranteed not to, and that is not
   * a risk worth carrying for a joke however good the joke is. The accepted
   * cost is that someone who set up months ago and now runs it maximised never
   * sees this: it is first-run orientation, not an ongoing correction.
   *
   * The threshold is measured rather than guessed, as far as it can be here.
   * The rail is 144px pinned and a usable docked panel runs roughly 380-520px,
   * so a docked window tops out near 520. The desktop this was built on is
   * 1728px wide, so a maximised window is well over 1000. 900 sits clear of
   * both: wide enough that no plausible dock reaches it, narrow enough that a
   * genuinely maximised window always does. Worth revisiting against a real
   * booth machine, which is the one measurement not available from here.
   */
  const DOCKED_WIDTH_CEILING = 900;

  function maybeShowWidthNudge() {
    if (window.innerWidth <= DOCKED_WIDTH_CEILING) return;
    const wrap = document.getElementById("setup-width-nudge");
    const text = document.getElementById("setup-width-nudge-text");
    if (!wrap || !text) return;
    // Warm zone: this is nowhere near the path to screen, and it is the one
    // moment the installer is curious rather than under pressure. The second
    // sentence does the work for anyone the first does not land for.
    text.textContent =
      "Refrain is built to sit beside ProPresenter, not in front of it. " +
      "Drag this window narrow and tuck it to one side.";
    wrap.classList.remove("hidden");
  }

  maybeShowWidthNudge();

  const progressMeter = document.getElementById("setup-progress-meter");
  const progressCount = document.getElementById("setup-progress-count");
  const progressText = document.getElementById("setup-progress-text");

  let connectionVerified = false;

  function updateSaveEnabled() {
    saveBtn.disabled = !(connectionVerified && getSelectedRole());
  }

  function getSelectedRole() {
    return document.querySelector('input[name="setup-role"]:checked')?.value ?? null;
  }

  const networkOffer = document.getElementById("setup-network-scan-offer");

  // scanNetwork is off unless the operator explicitly escalates: sweeping the
  // network touches other machines' ProPresenter, which may be live.
  async function runDetect(button, scanNetwork) {
    button.disabled = true;
    detectResult.textContent = scanNetwork ? "Searching the network..." : "Looking on this machine...";
    detectResult.className = "text-sm ml-2 opacity-70";
    try {
      const res = await fetch("/api/setup/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanNetwork }),
      });
      const data = await res.json();
      const found = data.candidates?.[0];
      if (found) {
        // Found via the API itself, so we already know it works — fill the
        // fields and treat the connection as verified.
        hostInput.value = found.host;
        portInput.value = found.port;
        connectionVerified = true;
        testResult.textContent = "";
        const extra = data.candidates.length > 1 ? ` (+${data.candidates.length - 1} more found)` : "";
        detectResult.textContent = `Found ${found.name} at ${found.host}:${found.port}${extra}`;
        detectResult.className = "text-sm ml-2 text-success";
        networkOffer?.classList.add("hidden");
      } else if (scanNetwork) {
        detectResult.textContent = "Nothing found on the network either. Enter the host and port by hand below.";
        detectResult.className = "text-sm ml-2 text-warning";
      } else {
        detectResult.textContent = noProPresenterFound("below");
        detectResult.className = "text-sm ml-2 text-warning";
        // Only now offer the wider search, with its warning.
        networkOffer?.classList.remove("hidden");
        if (window.lucide) window.lucide.createIcons();
      }
    } catch (err) {
      detectResult.textContent = `Scan failed: ${err.message}`;
      detectResult.className = "text-sm ml-2 text-error";
    } finally {
      button.disabled = false;
      updateSaveEnabled();
    }
  }

  detectBtn.addEventListener("click", () => runDetect(detectBtn, false));
  document
    .getElementById("setup-network-scan-btn")
    ?.addEventListener("click", (e) => runDetect(e.currentTarget, true));

  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    testResult.textContent = "Testing...";
    testResult.className = "text-sm opacity-70";
    try {
      const res = await fetch("/api/setup/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: hostInput.value, port: Number(portInput.value) }),
      });
      const data = await res.json();
      connectionVerified = data.connected;
      testResult.textContent = data.connected ? "Connected." : data.error;
      testResult.className = `text-sm ${data.connected ? "text-success" : "text-error"}`;
    } finally {
      testBtn.disabled = false;
      updateSaveEnabled();
    }
  });

  document.querySelectorAll('input[name="setup-role"]').forEach((el) => {
    el.addEventListener("change", updateSaveEnabled);
  });

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: hostInput.value,
          port: Number(portInput.value),
          role: getSelectedRole(),
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        alert(`Setup failed: ${error}`);
        saveBtn.disabled = false;
        return;
      }
    } catch (err) {
      alert(`Setup failed: ${err.message}`);
      saveBtn.disabled = false;
      return;
    }

    progressWrap.classList.remove("hidden");
    await pollBuildProgress();
    onComplete();
  });

  async function pollBuildProgress() {
    let sawInProgress = false;
    while (true) {
      const status = await fetch("/api/index/status").then((r) => r.json());
      const { rebuild, presentationCount } = status;

      if (rebuild.inProgress) {
        sawInProgress = true;
        createMeter(progressMeter);
        updateMeter(progressMeter, rebuild.current, rebuild.total);
        progressCount.textContent = meterCount(rebuild.current, rebuild.total);
        // The longest wait in the product, and the one moment the operator is
        // curious rather than under pressure. Warm zone: it can have a pulse,
        // as long as the count underneath it stays honest.
        progressText.textContent = "Reading every slide you own. Go coil something.";
      } else if (status.builtAt) {
        createMeter(progressMeter);
        updateMeter(progressMeter, 1, 1);
        progressCount.textContent = meterCount(presentationCount, presentationCount);
        progressText.textContent = `Indexed ${presentationCount} presentations.`;
        return;
      } else if (sawInProgress) {
        // Build started and finished, but never produced an index —
        // it failed. Don't loop forever; let the user into the app,
        // where the health screen explains what's wrong.
        progressText.textContent = "Index build failed. Check the server logs, then retry from the Health screen.";
        return;
      }

      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
