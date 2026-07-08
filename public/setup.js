import { injectSvg } from "./nav.js";

/**
 * First-run setup screen (Section 6). Shown instead of the rest of the
 * app until config.json exists with a host/port/role. On save, writes
 * config.json and triggers the one-time full index build, showing
 * progress inline until it completes, then hands off to the caller.
 */
export function initSetup({ onComplete }) {
  injectSvg(document.getElementById("setup-brand-mark"), "img/icon.svg", ["h-6", "w-auto"]);

  const hostInput = document.getElementById("setup-host");
  const portInput = document.getElementById("setup-port");
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
      testResult.textContent = data.connected ? "Connected!" : data.error;
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
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const status = await fetch("/api/index/status").then((r) => r.json());
      const { rebuild, presentationCount } = status;

      if (rebuild.inProgress) {
        sawInProgress = true;
        progressBar.value = rebuild.total ? rebuild.current : 0;
        progressBar.max = rebuild.total || 1;
        progressText.textContent = `Indexing (${rebuild.stage})... ${rebuild.current}${rebuild.total ? `/${rebuild.total}` : ""}`;
      } else if (status.builtAt) {
        progressText.textContent = `Indexed ${presentationCount} presentations.`;
        return;
      } else if (sawInProgress) {
        // Build started and finished, but never produced an index —
        // it failed. Don't loop forever; let the user into the app,
        // where the health screen explains what's wrong.
        progressText.textContent = "Index build failed — check the server logs. You can retry from the Health screen.";
        return;
      }

      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
