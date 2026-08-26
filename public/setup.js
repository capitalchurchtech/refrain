import { noProPresenterFound } from "./strings.js";
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
  const progressBar = document.getElementById("setup-progress-bar");
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
        progressBar.value = rebuild.total ? rebuild.current : 0;
        progressBar.max = rebuild.total || 1;
        // The longest wait in the product, and the one moment the operator is
        // curious rather than under pressure. Warm zone: it can have a pulse,
        // as long as the count underneath it stays honest.
        progressText.textContent = `Reading every slide you own. Go coil something. ${rebuild.current}${
          rebuild.total ? `/${rebuild.total}` : ""
        }`;
      } else if (status.builtAt) {
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
