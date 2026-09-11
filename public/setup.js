import { noProPresenterFound } from "./strings.js";
import { createMeter, updateMeter, meterCount } from "./led-meter.js";

/**
 * First-run setup screen (Section 6). Shown instead of the rest of the
 * app until config.json exists with a host/port/role. On save, writes
 * config.json and triggers the one-time full index build, showing
 * progress inline until it completes, then hands off to the caller.
 */
export function initSetup({ onComplete }) {
  const hostInput = document.getElementById("setup-host");
  const portInput = document.getElementById("setup-port");
  const detectBtn = document.getElementById("setup-detect-btn");
  const detectResult = document.getElementById("setup-detect-result");
  const testBtn = document.getElementById("setup-test-btn");
  const testResult = document.getElementById("setup-test-result");
  const saveBtn = document.getElementById("setup-save-btn");
  const progressWrap = document.getElementById("setup-progress");

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
        detectResult.className = "text-sm ml-2 rf-nominal";
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
      detectResult.className = "text-sm ml-2 rf-flag";
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
      testResult.className = `text-sm ${data.connected ? "rf-nominal" : "rf-flag"}`;
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

  /**
   * Watches the first index build, and says what is happening when it is not
   * building yet.
   *
   * That last part was missing, and it is the state a fresh machine sits in
   * most often. With no index, nothing in progress, and nothing having failed,
   * this loop used to poll every 500ms and change nothing on screen -- so
   * Refrain waiting sensibly for ProPresenter was indistinguishable from
   * Refrain having hung. The server has always known why it was waiting; the
   * screen simply never asked.
   */
  /** Turns the server's reason for waiting into something to act on. */
  function describeWait(reason) {
    const r = String(reason);
    if (/not answering/i.test(r)) {
      return "Waiting for ProPresenter. Open it, and check its Network API is on under Preferences, then Network.";
    }
    if (/starting up/i.test(r)) {
      return "ProPresenter is still starting up. Refrain waits a few minutes before reading the library, because a library read too early comes back half empty.";
    }
    if (/never became available/i.test(r)) {
      return "Gave up waiting for ProPresenter. You can finish setup and build the index later from the Health screen.";
    }
    if (/performance mode/i.test(r)) {
      return "Something is on the screens, so Refrain is holding off. It will build the index once nothing is live.";
    }
    return r;
  }

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
        // Warm zone, but it now carries the two facts an operator needs while
        // watching a progress bar for a quarter of an hour: keep ProPresenter
        // open, because this is read THROUGH it, and nothing is going to the
        // screens. Both were things Refrain knew and never said.
        progressText.textContent =
          "Reading every slide you own. Go coil something. " +
          "Leave ProPresenter open — Refrain reads the library through it, and it will feel sluggish while this runs. " +
          "Nothing is being sent to the screens.";
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
      } else if (status.indexWorkDeferred) {
        // Not started yet, and the server knows why. Say it, and say what to
        // do about it — a silent screen is the one thing this moment cannot
        // afford, because it is also the moment the operator has no idea
        // whether the product works at all.
        progressText.textContent = describeWait(status.indexWorkDeferred);
      } else {
        progressText.textContent = "Getting ready…";
      }

      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
