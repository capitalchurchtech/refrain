const ARRANGEMENT_STATUS_LABEL = {
  off: null, // hidden entirely per Section 4.1
  misconfigured: "Misconfigured",
  active: "Active",
};

export function initHealth() {
  const container = document.getElementById("view-health");

  async function render() {
    const health = await fetch("/api/health").then((r) => r.json());
    container.innerHTML = renderHealth(health);

    const btn = document.getElementById("health-rebuild-btn");
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Rebuilding...";
        try {
          await fetch("/api/index/rebuild", { method: "POST" });
          await render();
        } finally {
          if (btn.isConnected) {
            btn.disabled = false;
            btn.textContent = "Rebuild Now";
          }
        }
      });
    }
  }

  return { render };
}

function renderHealth(health) {
  const { propresenter, index, arrangementModule, role, version } = health;

  const propresenterCard = `
    <div class="card bg-base-200">
      <div class="card-body">
        <h2 class="card-title text-base">ProPresenter Connection</h2>
        ${
          propresenter.connected
            ? `<div class="badge badge-success gap-1">Connected</div>
               <div class="text-sm opacity-70">${propresenter.host}:${propresenter.port} &middot; last checked ${new Date(propresenter.lastCheckIn ?? Date.now()).toLocaleTimeString()}</div>`
            : `<div class="badge badge-error gap-1">Disconnected</div>
               <div class="text-sm opacity-70">${propresenter.host}:${propresenter.port}</div>
               <div class="text-sm mt-1">Check ProPresenter is running with its Network API enabled (Preferences &gt; Network), and that the host/port are correct.</div>`
        }
      </div>
    </div>
  `;

  const indexCard = `
    <div class="card bg-base-200">
      <div class="card-body">
        <h2 class="card-title text-base">Search Index</h2>
        <div class="text-sm opacity-70">
          ${
            index.builtAt
              ? `${index.presentationCount} presentations &middot; built ${new Date(index.builtAt).toLocaleString()}`
              : "Not built yet"
          }
        </div>
        ${
          index.rebuild.inProgress
            ? `<div class="text-sm mt-1">Rebuilding (${index.rebuild.stage}): ${index.rebuild.current}/${index.rebuild.total || "?"}</div>`
            : `<button id="health-rebuild-btn" class="btn btn-sm btn-outline mt-2 w-fit">Rebuild Now</button>`
        }
      </div>
    </div>
  `;

  const arrangementCard =
    arrangementModule.status === "off"
      ? ""
      : `
    <div class="card bg-base-200">
      <div class="card-body">
        <h2 class="card-title text-base">Arrangement Module</h2>
        <div class="badge ${arrangementModule.status === "active" ? "badge-success" : "badge-warning"} gap-1">
          ${ARRANGEMENT_STATUS_LABEL[arrangementModule.status]}
        </div>
        <div class="text-sm opacity-70">
          Provider: ${arrangementModule.provider ?? "manual"} &middot; Storage: ${arrangementModule.storageBackend ?? "—"}
        </div>
        ${
          arrangementModule.status === "misconfigured"
            ? `<div class="text-sm mt-1">Enabled in config.json, but required credentials are missing from .env for the selected storage backend/provider. See .env.example.</div>`
            : ""
        }
      </div>
    </div>
  `;

  return `
    <div class="flex flex-col gap-4">
      ${propresenterCard}
      ${indexCard}
      ${arrangementCard}
      <div class="text-xs opacity-50 text-center mt-2">
        Refrain v${version} &middot; role: ${role ?? "unset"}
      </div>
    </div>
  `;
}
