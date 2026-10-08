import { COPY_FAILED, noProPresenterFound } from "./strings.js";
import { showFailure } from "./notice.js";
import { wireTabKeys, fitTabs } from "./tabs.js";
import { display } from "./nav.js";
import { SETTINGS_TABS, SETTINGS_TOP, SETTINGS_MORE, settingsTopTab, settingsTabFromHash } from "./settings-tabs.js";
import { createMeter, updateMeter, meterCount } from "./led-meter.js";
import { mountLiveReadout, unmountLiveReadout } from "./live-readout.js";
import { healthCheckHtml } from "./health-check.js";
const ARRANGEMENT_STATUS_LABEL = {
  off: null, // hidden entirely per Section 4.1
  misconfigured: "Misconfigured",
  active: "Active",
};

/**
 * A recent service day that was never ended, so no summary was written. Shown
 * once per day per browser, then it stops (handoff section 37's proposed
 * default): a reminder, not a nag.
 */
async function showUnfinishedDay() {
  const host = document.getElementById("health-unfinished-day");
  if (!host) return;
  try {
    const { day } = await fetch("/api/service/unfinished").then((r) => r.json());
    if (!day) return;
    const key = `refrain.unfinishedSeen.${day}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // No storage: it shows each time instead of once. Harmless.
    }
    const label = new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    host.innerHTML = `<div class="rf-readout text-sm">${escapeHtml(label)} was never ended, so no summary was written. <a href="#service/service" class="link">Open the day</a></div>`;
  } catch {
    // The Service module is off, or unreachable: nothing to say.
  }
}

export function initHealth() {
  const container = document.getElementById("view-health");

  // Checked once per page load, not on every save-triggered re-render —
  // it's an external call to GitHub, no need to repeat it every time a
  // config field is saved.
  // The last unused-media scan, kept across re-renders: Health redraws the
  // whole screen whenever a setting is saved, and a five-second scan the
  // operator just asked for should not vanish because they saved something.
  let lastOrphanScan = null;
  let statusReadout = null;

  let versionCheck = null;
  async function fetchVersionCheck() {
    if (versionCheck) return versionCheck;
    versionCheck = await fetch("/api/version-check")
      .then((r) => r.json())
      .catch(() => ({ currentVersion: null, latestVersion: null, updateAvailable: false, repoUrl: null }));
    return versionCheck;
  }

  // The last panel opened under More, so pressing More again comes back to it.
  let lastMore = SETTINGS_MORE[0];
  function showSettingsTab(tab) {
    if (SETTINGS_MORE.includes(tab)) lastMore = tab;
    container.querySelectorAll("[data-settings-panel]").forEach((p) => p.classList.toggle("hidden", p.dataset.settingsPanel !== tab));
    // The top row marks the group a panel belongs to; the second row, inside
    // More, marks the panel itself.
    container.querySelectorAll("[data-settings-top]").forEach((b) => {
      const on = b.dataset.settingsTop === settingsTopTab(tab);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    container.querySelectorAll("[data-settings-tab]").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.settingsTab === tab));
      b.tabIndex = b.dataset.settingsTab === tab ? 0 : -1;
    });
  }
  function selectSettingsTab(tab) {
    showSettingsTab(tab);
    // replaceState, like the menu: a link to the tab, not a trail of Back
    // presses through tabs.
    history.replaceState(null, "", tab === SETTINGS_TABS[0][0] ? "#settings" : `#settings/${tab}`);
  }
  function wireSettingsTabs() {
    const row = document.getElementById("settings-tabs");
    if (!row) return;
    // The top row's More opens the last panel used under it.
    const topTarget = (b) => (b.dataset.settingsTop === "more" ? lastMore : b.dataset.settingsTop);
    row.querySelectorAll("[data-settings-top]").forEach((b) => b.addEventListener("click", () => selectSettingsTab(topTarget(b))));
    wireTabKeys(row, (b) => selectSettingsTab(topTarget(b)));
    fitTabs(row);
    // The second row, one copy inside each More panel.
    container.querySelectorAll("[data-settings-subrow]").forEach((sub) => {
      sub.querySelectorAll("[data-settings-tab]").forEach((b) => b.addEventListener("click", () => selectSettingsTab(b.dataset.settingsTab)));
      wireTabKeys(sub, (b) => selectSettingsTab(b.dataset.settingsTab));
      fitTabs(sub);
    });
  }
  // Someone following a #settings/phones link while Settings is already open.
  window.addEventListener("hashchange", () => {
    if (!container.classList.contains("hidden") && /^#settings/.test(location.hash)) showSettingsTab(settingsTabFromHash(location.hash));
  });
  function wireDisplayCard() {
    const paint = () => {
      const now = display.get();
      const current = { theme: now.theme, side: now.navSide };
      container.querySelectorAll("[data-display]").forEach((b) => {
        const on = current[b.dataset.display] === b.dataset.value;
        b.setAttribute("aria-checked", String(on));
      });
    };
    paint();
    const set = { theme: display.setTheme, side: display.setSide };
    container.querySelectorAll("[data-display]").forEach((b) =>
      b.addEventListener("click", async () => {
        await set[b.dataset.display](b.dataset.value);
        paint();
      })
    );
    document.getElementById("settings-welcome-btn")?.addEventListener("click", () => display.openWelcome());
  }

  /**
   * Keeps the Status health check current (every 4s while Settings is open) and
   * wires its two presses: performance mode on or off, and Refresh for the index.
   * The rows are redrawn only when what they show changes.
   */
  let healthTimer = null;
  function wireHealthCheck() {
    clearInterval(healthTimer);
    const host = document.getElementById("health-check");
    if (!host) return;
    // Start from what the render drew, so a press before the first poll lands
    // flips the real state rather than an unknown one.
    let last = { armed: host.querySelector('[data-hc="perf"]')?.textContent.trim() === "Turn off" };
    const read = () => ({ ...last });
    const paintRows = async () => {
      try {
        const [live, idx] = await Promise.all([fetch("/api/live-state").then((r) => r.json()), fetch("/api/index/status").then((r) => r.json())]);
        const next = {
          connected: Boolean(live.connected),
          host: host.dataset.host,
          port: host.dataset.port,
          feed: live.feed ?? "off",
          armed: Boolean(live.performanceMode?.armed),
          indexBuiltAt: idx.builtAt ?? null,
          indexCount: idx.presentationCount ?? 0,
        };
        const key = JSON.stringify([next.connected, next.feed, next.armed, next.indexBuiltAt, next.indexCount]);
        if (key === host.dataset.key) return;
        host.dataset.key = key;
        last = { ...last, ...next };
        host.innerHTML = healthCheckHtml(next);
      } catch {
        // Keep what is shown; the next poll tries again.
      }
    };
    host.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-hc]");
      if (!btn) return;
      btn.disabled = true;
      try {
        if (btn.dataset.hc === "perf") {
          const armed = !read().armed;
          const res = await fetch("/api/performance-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ armed }) });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
        } else if (btn.dataset.hc === "refresh") {
          btn.textContent = "Refreshing";
          const res = await fetch("/api/index/reindex-changed", { method: "POST" });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Refresh didn't run");
        }
        host.dataset.key = "";
        await paintRows();
      } catch (err) {
        showFailure(`${btn.dataset.hc === "perf" ? "Performance mode didn't change" : "Refresh didn't run"}: ${err.message}`);
        host.dataset.key = "";
        await paintRows();
      }
    });
    healthTimer = setInterval(() => (container.classList.contains("hidden") ? null : paintRows()), 4000);
    paintRows();
  }

  async function render() {
    const scrollY = window.scrollY;

    const [health, libraryFolders, configOptions, versionInfo, duplicateNames, envData] = await Promise.all([
      fetch("/api/health").then((r) => r.json()),
      // Kept even when ProPresenter can't list its folders: the reply still
      // says what search holds, which is the half anyone looks for first.
      fetch("/api/library-folders").then((r) => r.json().catch(() => ({})).then((d) => (r.ok ? d : { folders: [], selected: null, ...d, error: true }))),
      fetch("/api/config-options").then((r) => r.json()),
      fetchVersionCheck(),
      // Pure and in-memory on the server, so this costs nothing extra worth
      // gating behind the index actually being built.
      fetch("/api/duplicate-names").then((r) => (r.ok ? r.json() : { groups: [] })),
      fetch("/api/env", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { entries: [] })).catch(() => ({ entries: [] })),
    ]);
    const trackArrangement = health.arrangementModule.status !== "off";
    const arrangementFolders = trackArrangement
      ? await fetch("/api/arrangement/folders").then((r) => (r.ok ? r.json() : { folders: [], selected: null, error: true }))
      : null;
    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="menu" class="w-5 h-5"></i> Settings</h1>
        <div id="health-unfinished-day"></div>
        ${renderHealth(health, configOptions, versionInfo, renderLibraryCard(libraryFolders, arrangementFolders), duplicateNames.groups ?? [], envData.entries ?? [])}
      </div>`;

    window.scrollTo(0, scrollY);

    showSettingsTab(settingsTabFromHash(location.hash));
    wireSettingsTabs();
    // Settings is redrawn on every save, so let go of the old readout first.
    if (statusReadout) unmountLiveReadout(statusReadout);
    statusReadout = document.getElementById("settings-readout");
    mountLiveReadout(statusReadout);
    wireHealthCheck();
    wireDisplayCard();
    if (window.lucide) window.lucide.createIcons();
    showUnfinishedDay();

    const autostartBtn = document.getElementById("autostart-toggle");
    if (autostartBtn) {
      autostartBtn.addEventListener("click", async () => {
        // Captured now: the click handler awaits, and re-rendering the card
        // replaces this node, so reading it back afterwards finds nothing.
        const btn = autostartBtn;
        const statusEl = document.getElementById("autostart-status");
        const turningOn = btn.dataset.enabled !== "1";
        btn.disabled = true;
        if (statusEl) statusEl.textContent = turningOn ? "Turning on..." : "Turning off...";
        try {
          const res = await fetch("/api/autostart", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: turningOn }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || res.statusText);
          await render();
        } catch (err) {
          btn.disabled = false;
          if (statusEl) statusEl.textContent = "";
          showFailure(`Couldn't ${turningOn ? "turn on" : "turn off"} start at login: ${err.message}`);
        }
      });
    }

    document.querySelectorAll(".terminal-copy").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const label = btn.innerHTML;
        try {
          await navigator.clipboard.writeText(btn.dataset.command);
          btn.innerHTML = `<i data-lucide="check" class="w-3 h-3"></i> Copied`;
        } catch {
          // Clipboard access can be refused; the command is on screen anyway,
          // so say so rather than pretending it worked.
          btn.innerHTML = `<i data-lucide="x" class="w-3 h-3"></i> Select it`;
        }
        if (window.lucide) window.lucide.createIcons();
        setTimeout(() => {
          btn.innerHTML = label;
          if (window.lucide) window.lucide.createIcons();
        }, 1800);
      });
    });

    // One per duplicate-name entry on the card above. Same action and the
    // same route search.js's results use: opens ProPresenter's editor on
    // that exact presentation without changing what is live.
    document.querySelectorAll(".show-in-editor-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const res = await fetch("/api/focus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ presentationId: btn.dataset.presentationId }),
          });
          if (!res.ok) {
            const { error } = await res.json();
            showFailure(`Didn't open the editor: ${error ?? "ProPresenter didn't answer"}. Nothing on the screens changed.`);
          }
        } finally {
          btn.disabled = false;
        }
      });
    });

    const preferredBtn = document.getElementById("preferred-check-btn");
    preferredBtn?.addEventListener("click", async () => {
      const status = document.getElementById("preferred-check-status");
      const results = document.getElementById("preferred-results");
      preferredBtn.disabled = true;
      status.textContent = "Checking...";
      results.innerHTML = "";
      try {
        const res = await fetch("/api/index/preferred-arrangements", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        status.textContent =
          `${data.notSelected.length} of ${data.checked} need switching` +
          (data.unread ? `; ${data.unread} couldn't be read` : "") +
          (data.stopped ? "; stopped to keep ProPresenter free" : "") +
          (data.remaining ? `; ${data.remaining} not checked yet (press Check again)` : "") +
          ".";
        results.innerHTML = data.notSelected
          .map(
            (p) => `
          <div class="flex items-center justify-between gap-2 border-t border-base-300 pt-1 first:border-0 first:pt-0">
            <span class="text-sm min-w-0 truncate">${escapeHtml(p.name)} <span class="opacity-60">· ${escapeHtml(p.selectedName ?? "no arrangement")} selected</span></span>
            <button class="btn btn-chip shrink-0 preferred-editor-btn" data-presentation-id="${escapeHtml(p.presentationId)}">Show in editor</button>
          </div>`
          )
          .join("");
        results.querySelectorAll(".preferred-editor-btn").forEach((b) =>
          b.addEventListener("click", async () => {
            b.disabled = true;
            try {
              const r = await fetch("/api/focus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ presentationId: b.dataset.presentationId }) });
              if (!r.ok) showFailure(`Didn't open the editor: ${(await r.json().catch(() => ({}))).error ?? "ProPresenter didn't answer"}. Nothing on the screens changed.`);
            } finally {
              b.disabled = false;
            }
          })
        );
      } catch (err) {
        status.textContent = err.message;
      } finally {
        preferredBtn.disabled = false;
      }
    });

    const orphanResults = document.getElementById("orphan-results");
    const wireOrphanResults = () => {
      orphanResults?.querySelectorAll(".orphan-reveal-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            const res = await fetch("/api/orphaned-media/reveal", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ root: btn.dataset.root, relPath: btn.dataset.relPath }),
            });
            if (!res.ok) {
              const { error } = await res.json().catch(() => ({}));
              showFailure(error || "Could not show that file in Finder.");
            }
          } finally {
            btn.disabled = false;
          }
        });
      });
    };
    if (orphanResults && lastOrphanScan) {
      orphanResults.innerHTML = renderOrphanResults(lastOrphanScan);
      wireOrphanResults();
    }
    document.getElementById("settings-shortcuts-btn")?.addEventListener("click", () => document.getElementById("nav-help-toggle")?.click());
    document.getElementById("health-open-phone")?.addEventListener("click", () => document.getElementById("nav-phone-toggle")?.click());

    // Today's phone PIN, to read out; and a way to sign every phone out.
    const pinEl = document.getElementById("phone-pin-today");
    const paintPin = async () => {
      try {
        const p = await fetch("/api/network/pin").then((r) => (r.ok ? r.json() : null));
        if (p && pinEl) pinEl.innerHTML = `${p.mode === "daily" ? "Today's PIN" : "PIN"}: <strong class="font-mono text-base">${escapeHtml(p.pin ?? "")}</strong>${p.changesAt ? ` <span class="opacity-60">(changes at midnight)</span>` : ""}${
          p.wrongToday ? ` <span class="opacity-80">· ${p.wrongToday} wrong PIN${p.wrongToday === 1 ? "" : "s"} today${p.wrongToday >= 30 ? ", so phones can't sign in again until tomorrow" : ""}</span>` : ""
        }`;
      } catch {
        // leave it blank
      }
    };
    if (pinEl) paintPin();
    document.getElementById("phone-forget-btn")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const status = document.getElementById("phone-forget-status");
      btn.disabled = true;
      try {
        const res = await fetch("/api/network/forget-phones", { method: "POST" });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
        status.textContent = "Every phone will need the new PIN.";
        await paintPin();
      } catch (err) {
        status.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("theme-report-btn")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const statusEl = document.getElementById("theme-report-status");
      const out = document.getElementById("theme-report-results");
      btn.disabled = true;
      statusEl.textContent = "Reading every deck...";
      try {
        const res = await fetch("/api/theme-report", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        statusEl.textContent = `${data.themedDecks} of ${data.decksRead} decks use a theme's layouts.${data.unreadable ? ` Couldn't read ${data.unreadable}.` : ""}`;
        out.innerHTML = renderThemeReport(data);
      } catch (err) {
        statusEl.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("orphan-scan-btn")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget; // captured before the await
      const statusEl = document.getElementById("orphan-scan-status");
      btn.disabled = true;
      if (statusEl) statusEl.textContent = "Scanning. This takes a few seconds.";
      try {
        const res = await fetch("/api/orphaned-media/scan", { method: "POST" });
        const data = await res.json().catch(() => ({ ok: false, error: res.statusText }));
        if (!data.ok) throw new Error(data.error || "The scan did not finish.");
        lastOrphanScan = data;
        if (orphanResults) {
          orphanResults.innerHTML = renderOrphanResults(data);
          wireOrphanResults();
          if (window.lucide) window.lucide.createIcons();
        }
        if (statusEl) statusEl.textContent = "";
      } catch (err) {
        if (statusEl) statusEl.textContent = "";
        showFailure(err.message);
      } finally {
        btn.disabled = false;
      }
    });


    wireKillSwitch();
    wireDaySummarySettings(render);

    // A feature switched: the page reloads, so the menu, the tabs and every
    // screen are drawn again with it on or off.
    document.querySelectorAll("[data-feature]").forEach((key) =>
      key.addEventListener("click", async () => {
        // The switch asks for the opposite of what it shows (data-on is the
        // state it would set).
        if ((key.getAttribute("aria-checked") === "true") === (key.dataset.on === "true")) return;
        const status = document.getElementById("features-status");
        try {
          const res = await fetch("/api/features", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: key.dataset.feature, on: key.dataset.on === "true" }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? res.statusText);
          if (status) status.textContent = "Saved. Updating the menu...";
          // On but not working yet (Image Crop's folders): say so long enough to read.
          if (data.warning) {
            showFailure(data.warning);
            setTimeout(() => location.reload(), 6000);
          } else location.reload();
        } catch (err) {
          showFailure(`Couldn't change that feature: ${err.message}`);
        }
      })
    );

    document.querySelectorAll("[data-protect]").forEach((key) =>
      key.addEventListener("click", async () => {
        const on = key.dataset.protect === "true";
        try {
          const res = await fetch("/api/protect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? res.statusText);
          await render();
          document.getElementById("protect-details")?.setAttribute("open", "");
        } catch (err) {
          showFailure(`Couldn't change Protect ProPresenter: ${err.message}`);
        }
      })
    );

    document.querySelectorAll("[data-pictures-show]").forEach((key) =>
      key.addEventListener("click", async () => {
        try {
          const res = await fetch("/api/slide-pictures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ show: key.dataset.picturesShow === "true" }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? res.statusText);
          render(); // the card's wording and the draw-ahead keys follow it
        } catch (err) {
          showFailure(`Couldn't change slide pictures: ${err.message}`);
        }
      })
    );

    document.querySelectorAll("[data-quick-pictures]").forEach((key) =>
      key.addEventListener("click", async () => {
        try {
          const res = await fetch("/api/slide-pictures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quickSlides: key.dataset.quickPictures === "true" }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? res.statusText);
          render();
        } catch (err) {
          showFailure(`Couldn't change safe slide pictures: ${err.message}`);
        }
      })
    );

    document.querySelectorAll("[data-prerender]").forEach((key) =>
      key.addEventListener("click", async () => {
        const prerender = key.dataset.prerender === "true";
        const status = document.getElementById("prerender-status");
        try {
          const res = await fetch("/api/slide-pictures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prerender }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? res.statusText);
          document.querySelectorAll("[data-prerender]").forEach((k) => k.setAttribute("aria-checked", String(k.dataset.prerender === String(prerender))));
          if (status) status.textContent = prerender ? "On. Starts when nothing is on the screens and no service is near." : "Off.";
        } catch (err) {
          showFailure(`Couldn't change slide pictures: ${err.message}`);
        }
      })
    );

    // Telemetry tab: collected from the fields, validated by the server.
    const feedWindows = document.getElementById("feed-windows");
    if (feedWindows) {
      const radio = (attr, val) => document.querySelector(`[${attr}][aria-checked="true"]`)?.getAttribute(attr) === val;
      document.querySelectorAll("[data-feed-enabled], [data-feed-text], [data-feed-image]").forEach((key) =>
        key.addEventListener("click", () => {
          const attr = ["data-feed-enabled", "data-feed-text", "data-feed-image"].find((a) => key.hasAttribute(a));
          document.querySelectorAll(`[${attr}]`).forEach((k) => k.setAttribute("aria-checked", String(k === key)));
        })
      );
      feedWindows.addEventListener("click", (e) => e.target.closest("[data-feed-remove]")?.closest("[data-feed-window]")?.remove());
      document.getElementById("feed-add-window").addEventListener("click", () => {
        feedWindows.insertAdjacentHTML("beforeend", feedWindowRow({ days: ["sun"], from: "09:00", until: "14:00" }));
      });
      document.getElementById("feed-send-log").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const status = document.getElementById("feed-status");
        btn.disabled = true;
        try {
          const res = await fetch("/api/service-feed/send-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? res.statusText);
          status.textContent = data.sent ? `Sent ${data.sent} day${data.sent === 1 ? "" : "s"} of log.` : "Nothing new to send. The server already has every log.";
        } catch (err) {
          showFailure(`The log didn't send: ${err.message}`);
        } finally {
          btn.disabled = false;
        }
      });
      document.getElementById("feed-save").addEventListener("click", async () => {
        const status = document.getElementById("feed-status");
        const windows = [...feedWindows.querySelectorAll("[data-feed-window]")].map((row) => ({
          days: [...row.querySelectorAll("[data-feed-day]")].filter((c) => c.checked).map((c) => c.dataset.feedDay),
          from: row.querySelector("[data-feed-from]").value,
          until: row.querySelector("[data-feed-until]").value,
        }));
        const body = {
          enabled: radio("data-feed-enabled", "true"),
          name: document.getElementById("feed-name").value,
          url: document.getElementById("feed-url").value,
          includeSlideText: radio("data-feed-text", "true"),
          includeSlideImage: radio("data-feed-image", "true"),
          windows,
        };
        try {
          const res = await fetch("/api/service-feed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? res.statusText);
          status.textContent = data.status === "misconfigured" ? `Saved, but not ready: ${(data.problems ?? []).join(" ")}` : body.enabled ? "Saved." : "Saved. Off.";
        } catch (err) {
          showFailure(`Couldn't save telemetry: ${err.message}`);
        }
      });
    }

    const updateNowBtn = document.getElementById("update-now-btn");
    if (updateNowBtn) {
      const statusEl = document.getElementById("update-status");
      updateNowBtn.addEventListener("click", async () => {
        updateNowBtn.disabled = true;
        statusEl.textContent = "Updating...";
        statusEl.className = "text-sm opacity-70";
        try {
          const res = await fetch("/api/update", { method: "POST" });
          const data = await res.json();
          if (!res.ok) {
            statusEl.textContent = data.error;
            statusEl.className = "text-sm text-warning";
            updateNowBtn.disabled = false;
            return;
          }
          statusEl.textContent = "Updated. Restart Refrain to finish.";
          statusEl.className = "text-sm rf-nominal";
        } catch (err) {
          statusEl.textContent = `Update failed: ${err.message}`;
          statusEl.className = "text-sm text-warning";
          updateNowBtn.disabled = false;
        }
      });
    }
    const recheckBtn = document.getElementById("update-recheck-btn");
    if (recheckBtn) {
      recheckBtn.addEventListener("click", () => {
        versionCheck = null; // bust the cached check so it re-fetches
        render();
      });
    }

    const diagnoseBtn = document.getElementById("pp-diagnose-btn");
    if (diagnoseBtn) {
      const statusEl = document.getElementById("pp-diagnose-status");
      const resultsEl = document.getElementById("pp-diagnose-results");

      // Severity drives the stripe and chip so the worst thing reads first
      // without having to be read at all.
      const TONE = {
        problem: { border: "border-error", chip: "badge-error", label: "Problem" },
        warn: { border: "border-warning", chip: "badge-warning", label: "Check" },
        info: { border: "border-info", chip: "badge-info", label: "Info" },
        ok: { border: "border-success", chip: "badge-success", label: "OK" },
      };

      diagnoseBtn.addEventListener("click", async () => {
        diagnoseBtn.disabled = true;
        statusEl.textContent = "Checking this machine...";
        resultsEl.innerHTML = "";
        try {
          const data = await fetch("/api/propresenter/diagnose").then((r) => r.json());
          statusEl.textContent = `Checked ${new Date(data.checkedAt).toLocaleTimeString()}`;
          resultsEl.innerHTML = (data.findings ?? [])
            .map((f, i) => {
              const tone = TONE[f.severity] ?? TONE.info;
              return `
              <div class="border-l-2 ${tone.border} bg-base-100 rounded p-2 flex flex-col gap-1">
                <div class="flex items-start justify-between gap-2">
                  <div class="text-sm font-medium">
                    <span class="badge ${tone.chip} badge-sm mr-1">${tone.label}</span>${escapeHtml(f.title)}
                  </div>
                  ${
                    f.prompt
                      ? `<button type="button" class="btn btn-chip shrink-0 pp-copy-prompt" data-index="${i}" title="Copy a ready-made prompt to paste into Claude Code">
                           <span class="copy-icon"><i data-lucide="clipboard"></i></span> Copy prompt
                         </button>`
                      : ""
                  }
                </div>
                <div class="text-xs opacity-70 whitespace-pre-line">${escapeHtml(f.detail)}</div>
                ${
                  f.command
                    ? `<div class="flex items-center gap-2 mt-1">
                         <code class="text-xs bg-base-200 rounded px-2 py-1 flex-1 overflow-x-auto whitespace-nowrap">${escapeHtml(f.command)}</code>
                         <button type="button" class="btn btn-chip shrink-0 pp-copy-command" data-index="${i}" title="Copy this command">
                           <span class="copy-icon"><i data-lucide="copy"></i></span>
                         </button>
                       </div>`
                    : ""
                }
              </div>`;
            })
            .join("");
          if (window.lucide) window.lucide.createIcons();

          // Copy with visible confirmation: under pressure a silent copy is
          // indistinguishable from a dead button.
          const wireCopy = (selector, pick) =>
            resultsEl.querySelectorAll(selector).forEach((btn) =>
              btn.addEventListener("click", async () => {
                const text = pick(data.findings[Number(btn.dataset.index)]);
                const iconWrap = btn.querySelector(".copy-icon");
                let ok = true;
                try {
                  await navigator.clipboard.writeText(text);
                } catch {
                  ok = false;
                }
                iconWrap.innerHTML = `<i data-lucide="${ok ? "check" : "x"}"></i>`;
                if (window.lucide) window.lucide.createIcons();
                if (!ok) btn.title = COPY_FAILED;
                setTimeout(() => {
                  iconWrap.innerHTML = `<i data-lucide="${selector.includes("prompt") ? "clipboard" : "copy"}"></i>`;
                  if (window.lucide) window.lucide.createIcons();
                }, 1200);
              })
            );
          wireCopy(".pp-copy-prompt", (f) => f.prompt);
          wireCopy(".pp-copy-command", (f) => f.command);
        } catch (err) {
          statusEl.textContent = `Diagnose failed: ${err.message}`;
        } finally {
          diagnoseBtn.disabled = false;
        }
      });
    }

    const configDetectBtn = document.getElementById("config-detect-btn");
    if (configDetectBtn) {
      const detectResult = document.getElementById("config-detect-result");
      const networkOffer = document.getElementById("config-network-scan-offer");

      // Local-only unless the operator escalates: a network sweep reaches other
      // machines' ProPresenter, which may be live.
      const runDetect = async (button, scanNetwork) => {
        button.disabled = true;
        detectResult.textContent = scanNetwork ? "Searching the network..." : "Looking on this machine...";
        detectResult.className = "text-sm opacity-70";
        try {
          const res = await fetch("/api/setup/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scanNetwork }),
          });
          const data = await res.json();
          const found = data.candidates?.[0];
          if (found) {
            document.getElementById("config-host").value = found.host;
            document.getElementById("config-port").value = found.port;
            const extra = data.candidates.length > 1 ? ` (+${data.candidates.length - 1} more)` : "";
            detectResult.textContent = `Found ${found.name} at ${found.host}:${found.port}${extra}. Save to apply.`;
            detectResult.className = "text-sm rf-nominal";
            networkOffer?.classList.add("hidden");
          } else if (scanNetwork) {
            detectResult.textContent = "Nothing found on the network either. Type the host and port above.";
            detectResult.className = "text-sm text-warning";
          } else {
            detectResult.textContent = noProPresenterFound("above");
            detectResult.className = "text-sm text-warning";
            networkOffer?.classList.remove("hidden");
            if (window.lucide) window.lucide.createIcons();
          }
        } catch (err) {
          detectResult.textContent = `Scan failed: ${err.message}`;
          detectResult.className = "text-sm rf-flag";
        } finally {
          button.disabled = false;
        }
      };

      configDetectBtn.addEventListener("click", () => runDetect(configDetectBtn, false));
      document
        .getElementById("config-network-scan-btn")
        ?.addEventListener("click", (e) => runDetect(e.currentTarget, true));
    }

    const rebuildMeter = document.getElementById("health-rebuild-meter");
    if (rebuildMeter) {
      createMeter(rebuildMeter);
      updateMeter(rebuildMeter, health.index.rebuild.current, health.index.rebuild.total);
      document.getElementById("health-rebuild-count").textContent = meterCount(
        health.index.rebuild.current,
        health.index.rebuild.total
      );
    }

    // "Quit Refrain" used to be the only way to end a running crawl, which is
    // a poor thing to tell someone ten minutes before doors.
    const stopBtn = document.getElementById("health-stop-rebuild-btn");
    if (stopBtn) {
      stopBtn.addEventListener("click", async () => {
        const status = document.getElementById("health-stop-rebuild-status");
        stopBtn.disabled = true;
        try {
          const res = await fetch("/api/index/stop", { method: "POST" });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
          if (status) status.textContent = "Stopping after this presentation.";
        } catch (err) {
          stopBtn.disabled = false;
          if (status) status.textContent = `Couldn't stop it: ${err.message}`;
        }
      });
    }

    const reindexBtn = document.getElementById("health-reindex-btn");
    if (reindexBtn) {
      const label = document.getElementById("health-reindex-btn-label");
      const statusEl = document.getElementById("health-reindex-status");
      reindexBtn.addEventListener("click", async () => {
        reindexBtn.disabled = true;
        label.textContent = "Checking files...";
        statusEl.textContent = "";
        statusEl.className = "text-sm";
        try {
          document.dispatchEvent(new CustomEvent("refrain:index-requested"));
          const res = await fetch("/api/index/reindex-changed", { method: "POST" });
          const data = await res.json();
          if (!res.ok) {
            statusEl.textContent = data.error;
            statusEl.className = "text-sm rf-flag";
            return;
          }
          // Say what happened rather than just "done". A reindex that quietly
          // turned into a full rebuild is exactly the surprise the warning
          // above is trying to prevent.
          const c = data.counts;
          // "unverifiable" has to be named, not folded into the others. On the
          // first reindex after an upgrade it can be most of the library, and a
          // message reading "0 changed, 0 new" for a run that re-read 221
          // presentations over half a minute is just baffling.
          const parts = c
            ? [
                `${c.changed} changed`,
                `${c.added} new`,
                ...(c.unverifiable ? [`${c.unverifiable} re-checked`] : []),
                `${c.carriedOver} reused`,
              ]
            : [];
          const message =
            data.buildMode === "incremental" && c
              ? `Reindexed in ${formatDuration(data.buildDurationMs)}: ${parts.join(", ")}.`
              : `Full rebuild was needed, finished in ${formatDuration(data.buildDurationMs)}.`;
          // Re-render so the status tiles and the last-run line stop showing
          // pre-reindex figures, then put the result back on the fresh element
          // the re-render just created.
          await render();
          const freshStatus = document.getElementById("health-reindex-status");
          if (freshStatus) {
            freshStatus.textContent = message;
            freshStatus.className = "text-sm rf-nominal";
          }
          return;
        } catch (err) {
          statusEl.textContent = `Reindex failed: ${err.message}`;
          statusEl.className = "text-sm rf-flag";
        } finally {
          if (reindexBtn.isConnected) {
            reindexBtn.disabled = false;
            label.textContent = "Reindex changed only";
          }
        }
      });
    }

    const btn = document.getElementById("health-rebuild-btn");
    if (btn) {
      const btnLabel = document.getElementById("health-rebuild-btn-label");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btnLabel.textContent = "Rebuilding...";
        try {
          document.dispatchEvent(new CustomEvent("refrain:index-requested"));
          const res = await fetch("/api/index/rebuild", { method: "POST" });
          const refused = res.ok ? null : ((await res.json().catch(() => ({}))).error ?? "The rebuild didn't start.");
          await render();
          // After render, which redraws the card: said where the other index
          // messages are, so a refusal (performance mode on, ProPresenter
          // still loading) is read rather than looking like nothing happened.
          const statusEl = document.getElementById("health-reindex-status");
          if (refused && statusEl) {
            statusEl.textContent = refused;
            statusEl.className = "text-sm rf-flag";
          }
        } finally {
          if (btn.isConnected) {
            btn.disabled = false;
            btnLabel.textContent = "Rebuild everything";
          }
        }
      });
    }

    const saveFoldersBtn = document.getElementById("save-library-folders-btn");
    if (saveFoldersBtn) {
      saveFoldersBtn.addEventListener("click", async () => {
        const allChecked = document.getElementById("library-folder-all").checked;
        const folders = allChecked
          ? null
          : Array.from(document.querySelectorAll(".library-folder-checkbox:checked")).map((el) => el.value);

        saveFoldersBtn.disabled = true;
        saveFoldersBtn.textContent = "Saving...";
        try {
          const res = await fetch("/api/library-folders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folders }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? res.statusText);
          // The bar along the bottom shows the run, or why it can't start.
          document.dispatchEvent(new CustomEvent("refrain:index-requested", { detail: data.rebuild === "waiting" ? { reason: `Saved. ${data.reason}` } : {} }));
        } catch (err) {
          showFailure(`Couldn't save the libraries: ${err.message}`);
        } finally {
          if (saveFoldersBtn.isConnected) {
            saveFoldersBtn.disabled = false;
            saveFoldersBtn.textContent = "Save and rebuild";
          }
        }
        // Not awaited: /api/health's live ProPresenter connectivity
        // check can take up to 8s to time out when unreachable, and
        // the save itself already succeeded — don't make the button
        // hang on an unrelated status refresh.
        render();
      });

      const allCheckbox = document.getElementById("library-folder-all");
      const folderCheckboxes = document.querySelectorAll(".library-folder-checkbox");
      allCheckbox.addEventListener("change", () => {
        folderCheckboxes.forEach((cb) => (cb.disabled = allCheckbox.checked));
      });
    }

    const saveArrangementFoldersBtn = document.getElementById("save-arrangement-folders-btn");
    if (saveArrangementFoldersBtn) {
      saveArrangementFoldersBtn.addEventListener("click", async () => {
        const allChecked = document.getElementById("arrangement-folder-all").checked;
        const folders = allChecked
          ? null
          : Array.from(document.querySelectorAll(".arrangement-folder-checkbox:checked")).map((el) => el.value);

        saveArrangementFoldersBtn.disabled = true;
        saveArrangementFoldersBtn.textContent = "Saving...";
        try {
          await fetch("/api/arrangement/folders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folders }),
          });
        } finally {
          if (saveArrangementFoldersBtn.isConnected) {
            saveArrangementFoldersBtn.disabled = false;
            saveArrangementFoldersBtn.textContent = "Save";
          }
        }
        render(); // not awaited — see save-library-folders-btn's handler for why
      });

      const arrangementAllCheckbox = document.getElementById("arrangement-folder-all");
      const arrangementFolderCheckboxes = document.querySelectorAll(".arrangement-folder-checkbox");
      arrangementAllCheckbox.addEventListener("change", () => {
        arrangementFolderCheckboxes.forEach((cb) => (cb.disabled = arrangementAllCheckbox.checked));
      });
    }

    const lyricsSiteCheckboxes = document.querySelectorAll(".config-lyrics-site-checkbox");
    const lyricsSitesHint = document.getElementById("config-lyrics-sites-hint");
    if (lyricsSiteCheckboxes.length) {
      const maxLyricsSites = lyricsSiteCheckboxes.length ? Number(lyricsSitesHint?.dataset.max) || 5 : 5;
      lyricsSiteCheckboxes.forEach((cb) => {
        cb.addEventListener("change", () => {
          const checkedCount = document.querySelectorAll(".config-lyrics-site-checkbox:checked").length;
          const atLimit = checkedCount >= maxLyricsSites;
          lyricsSiteCheckboxes.forEach((other) => {
            if (!other.checked) other.disabled = atLimit;
          });
          lyricsSitesHint.classList.toggle("hidden", !atLimit);
        });
      });
    }

    const arrangementProviderSelect = document.getElementById("config-arrangement-provider");
    const planningCenterServiceTypeWrap = document.getElementById("config-planning-center-service-type-wrap");
    if (arrangementProviderSelect) {
      arrangementProviderSelect.addEventListener("change", () => {
        planningCenterServiceTypeWrap.classList.toggle("hidden", arrangementProviderSelect.value !== "planning-center");
      });
    }

    const arrangementStorageSelect = document.getElementById("config-arrangement-storage");
    const storagePathWrap = document.getElementById("config-storage-path-wrap");
    const detectPathBtn = document.getElementById("detect-storage-path-btn");
    if (arrangementStorageSelect) {
      arrangementStorageSelect.addEventListener("change", () => {
        const backend = arrangementStorageSelect.value;
        storagePathWrap.classList.toggle("hidden", !["local-folder", "synced-folder"].includes(backend));
        detectPathBtn.classList.toggle("hidden", backend !== "synced-folder");
      });
    }
    if (detectPathBtn) {
      detectPathBtn.addEventListener("click", async () => {
        const resultEl = document.getElementById("detect-storage-path-result");
        detectPathBtn.disabled = true;
        resultEl.textContent = "Scanning for Google Drive / Dropbox / OneDrive...";
        try {
          const { candidates } = await fetch("/api/arrangement/detect-storage-paths").then((r) => r.json());
          if (!candidates.length) {
            resultEl.textContent = "Nothing found. Install the sync app and let it sync once, or type the path.";
            return;
          }
          resultEl.innerHTML = candidates
            .map(
              (c) =>
                `<button type="button" class="btn btn-chip detect-path-option" data-path="${escapeHtml(c.path)}">${escapeHtml(c.label)}: ${escapeHtml(c.path)}</button>`
            )
            .join("<br>");
          resultEl.querySelectorAll(".detect-path-option").forEach((btn) => {
            btn.addEventListener("click", () => {
              document.getElementById("config-storage-path").value = btn.dataset.path;
              resultEl.textContent = "";
            });
          });
        } catch (err) {
          resultEl.textContent = `Scan failed: ${err.message}`;
        } finally {
          detectPathBtn.disabled = false;
        }
      });
    }

    const backupConfigBtn = document.getElementById("backup-config-btn");
    if (backupConfigBtn) {
      backupConfigBtn.addEventListener("click", async () => {
        backupConfigBtn.disabled = true;
        try {
          const res = await fetch("/api/config/export");
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showFailure(data.error || "Couldn't back up config.json. Nothing was changed.");
            return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `refrain-config-backup-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } finally {
          backupConfigBtn.disabled = false;
        }
      });
    }

    document.querySelectorAll(".config-arrangement-suggestion").forEach((chip) => {
      chip.addEventListener("click", () => {
        const input = document.getElementById("config-preferred-arrangements");
        const current = input.value.split(",").map((n) => n.trim()).filter(Boolean);
        const name = chip.dataset.name;
        // Appending (not inserting) keeps the admin's priority order intact.
        if (!current.some((n) => n.toLowerCase() === name.toLowerCase())) current.push(name);
        input.value = current.join(", ");
      });
    });

    // Each settings section saves only its own fields. POST /api/config treats
    // an absent key as "leave alone", so a section can post its subset without
    // resubmitting every setting on the page — which is what made one giant
    // Save button feel risky to press.
    const SCOPE_FIELDS = {
      propresenter: () => ({
        role: document.getElementById("config-role").value,
        propresenterHost: document.getElementById("config-host").value,
        propresenterPort: document.getElementById("config-port").value,
      }),
      indexing: () => ({
        crawlPlaylists: document.getElementById("config-crawl-playlists").checked,
        preferredArrangements: document
          .getElementById("config-preferred-arrangements")
          .value.split(",")
          .map((n) => n.trim())
          .filter(Boolean),
      }),
      lyrics: () => ({
        slideSplitter: document.getElementById("config-slide-splitter").value,
        lyricsSites: Array.from(document.querySelectorAll(".config-lyrics-site-checkbox:checked")).map((el) => el.value),
      }),
      qr: () => ({
        qrDefaultBaseUrl: document.getElementById("config-qr-base-url").value,
        qrDefaultLogoUrl: document.getElementById("config-qr-logo-url").value,
        qrRecentLimit: Number(document.getElementById("config-qr-recent-limit").value),
        qrDefaultSize: document.getElementById("config-qr-default-size").value,
      }),
      arrangement: () => ({
        arrangementProvider: document.getElementById("config-arrangement-provider").value,
        arrangementStorageBackend: document.getElementById("config-arrangement-storage").value,
        arrangementLocalFolderPath: document.getElementById("config-storage-path").value,
        planningCenterServiceTypeId: document.getElementById("config-planning-center-service-type").value,
      }),
    };

    document.querySelectorAll(".config-save").forEach((btn) => {
      const scope = btn.dataset.scope;
      const statusEl = document.querySelector(`.config-save-status[data-scope="${scope}"]`);
      btn.addEventListener("click", async () => {
        const collect = SCOPE_FIELDS[scope];
        if (!collect) return;
        btn.disabled = true;
        btn.textContent = "Saving...";
        statusEl.textContent = "";
        let saved = false;
        try {
          const res = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(collect()),
          });
          const data = await res.json();
          if (!res.ok) {
            statusEl.textContent = data.error;
            statusEl.className = "text-sm config-save-status rf-flag";
            return;
          }
          saved = true;
        } finally {
          if (btn.isConnected) {
            btn.disabled = false;
            btn.textContent = "Save";
          }
        }
        // Not awaited — see save-library-folders-btn's handler for why.
        if (saved) render();
      });
    });

    const envShow = document.getElementById("env-show");
    envShow?.addEventListener("change", () => {
      // Masked by CSS, not type="password": Settings is always in the page, and
      // Chrome paired a password field here with the search box and offered to
      // save the search as a login, which could also have stored a real secret
      // in the browser (owner, 2026-10-04).
      container.querySelectorAll(".env-value").forEach((i) => (i.dataset.masked = String(!envShow.checked)));
    });
    const envSave = document.getElementById("env-save");
    envSave?.addEventListener("click", async () => {
      const status = document.getElementById("env-status");
      const edits = {};
      container.querySelectorAll(".env-value").forEach((i) => {
        if (i.value !== i.dataset.original) edits[i.dataset.name] = i.value;
      });
      if (!Object.keys(edits).length) {
        status.textContent = "Nothing changed.";
        status.className = "text-sm";
        return;
      }
      envSave.disabled = true;
      try {
        const res = await fetch("/api/env", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ edits }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        container.querySelectorAll(".env-value").forEach((i) => {
          if (i.dataset.name in edits) i.dataset.original = i.value;
        });
        status.textContent = `Saved ${Object.keys(edits).length}. Restart Refrain to use ${Object.keys(edits).length === 1 ? "it" : "them"}.`;
        status.className = "text-sm";
      } catch (err) {
        status.textContent = err.message;
        status.className = "text-sm rf-flag";
      } finally {
        envSave.disabled = false;
      }
    });

    const openEnvBtn = document.getElementById("open-env-btn");
    if (openEnvBtn) {
      openEnvBtn.addEventListener("click", async () => {
        const statusEl = document.getElementById("open-env-status");
        openEnvBtn.disabled = true;
        statusEl.textContent = "";
        try {
          const res = await fetch("/api/env/open", { method: "POST" });
          const data = await res.json();
          if (!res.ok) {
            statusEl.textContent = data.error;
            statusEl.className = "text-sm text-warning mt-2";
          }
        } finally {
          openEnvBtn.disabled = false;
        }
      });
    }
  }

  return { render };
}

/**
 * The little (i) beside a field label.
 *
 * These used to take a direction, hand-picked per field for the ones "known to
 * sit in a layout's right-hand column". That is the wrong altitude: it asks
 * every call site to know where it will be laid out, and it had already fallen
 * behind the layout -- measured at 380px, 10 of Health's 20 tooltips ran off
 * the edge anyway, and the four hand-placed `tooltip-left` ones ran off the
 * OTHER edge. public/tooltip-fit.js measures and nudges instead, once, for all
 * of them, so there is one direction and nothing to keep in sync.
 */
function infoIcon(tip) {
  return `<span class="tooltip tooltip-info-wide" data-tip="${escapeHtml(tip)}"><i data-lucide="info" class="w-3.5 h-3.5 opacity-50 cursor-help align-text-top"></i></span>`;
}

/**
 * What search reads, in plain sight (owner, 2026-09-30: "I can't find where to
 * say which libraries to scan"). It used to be a folded-away "Library folders"
 * section. Now it's the first card on Settings > Search: a line saying what is
 * being searched, each library with how many of its presentations are in
 * search, and the choice itself. What's in search comes from the index, so it
 * shows even when ProPresenter can't list its folders.
 */
export function searchScopeSummary({ folders = [], selected = null, indexed = {} }) {
  const total = Object.values(indexed).reduce((t, n) => t + n, 0);
  const plural = (n) => `${n} presentation${n === 1 ? "" : "s"}`;
  if (selected === null) return `Searching every library: ${plural(total)}.`;
  if (!selected.length) return "No libraries chosen, so search is empty.";
  const of = folders.length ? ` of ${folders.length}` : "";
  return `Searching ${selected.length}${of} ${selected.length === 1 && !of ? "library" : "libraries"} (${selected.join(", ")}): ${plural(total)}.`;
}

function renderLibraryCard({ folders = [], selected = null, indexed = {}, error }, arrangementFolders) {
  const summary = `<div class="text-sm font-medium">${escapeHtml(searchScopeSummary({ folders, selected, indexed }))}</div>`;
  const count = (name) => indexed[name] ?? 0;
  if (error) {
    const known = Object.keys(indexed).sort();
    return `
      <div id="library-folders-details" class="card bg-base-200">
        <div class="card-body p-3 gap-2">
          <h2 class="card-title text-base"><i data-lucide="library" class="w-4 h-4 opacity-70"></i> Libraries to search</h2>
          ${summary}
          ${known.length ? `<div class="flex flex-col gap-1">${known.map((n) => `<div class="text-sm">${escapeHtml(n)} <span class="opacity-60">· ${count(n)} in search</span></div>`).join("")}</div>` : ""}
          <div class="text-sm opacity-70">Open ProPresenter to change which libraries are searched.</div>
        </div>
      </div>
    `;
  }

  const allSelected = selected === null;
  return `
    <div id="library-folders-details" class="card bg-base-200">
      <div class="card-body p-3 gap-2">
        <h2 class="card-title text-base"><i data-lucide="library" class="w-4 h-4 opacity-70"></i> Libraries to search</h2>
        ${summary}
        <div class="text-sm opacity-70 rf-measure">Refrain only reads these libraries. Nothing is copied or moved. Fewer libraries index faster.</div>
        <label class="label cursor-pointer justify-start gap-2 w-fit">
          <input type="checkbox" id="library-folder-all" class="checkbox checkbox-sm" ${allSelected ? "checked" : ""} />
          <span class="label-text">All libraries</span>
        </label>
        <div class="flex flex-col gap-1 ml-1">
          ${folders
            .map(
              (name) => `
            <label class="label cursor-pointer justify-start gap-2 w-fit">
              <input type="checkbox" class="checkbox checkbox-sm library-folder-checkbox" value="${escapeHtml(name)}"
                ${allSelected || selected.includes(name) ? "checked" : ""}
                ${allSelected ? "disabled" : ""} />
              <span class="label-text">${escapeHtml(name)} <span class="opacity-60">· ${count(name) ? `${count(name)} in search` : "not in search"}</span></span>
            </label>
          `
            )
            .join("")}
        </div>
        <div class="alert alert-warning py-2 text-sm mt-2 items-start">
          <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
          <span><strong>Saving starts a full rebuild.</strong> ProPresenter can be slow or unresponsive
          for an hour or more. Save only when it's free for the next two hours.</span>
        </div>
        <button id="save-library-folders-btn" class="btn btn-sm btn-outline mt-1 w-fit">Save and rebuild</button>

        ${arrangementFolders ? renderArrangementFoldersSection(arrangementFolders) : ""}
      </div>
    </div>
  `;
}

// A church's real song-library folder is rarely named exactly "Songs" —
// matches the common conventions so a fresh install gets a sensible
// drift-tracking scope pre-checked instead of either "everything" or
// "nothing." Deliberately narrow (not "import" or other generic catch-all
// folder names) since those don't reliably mean "this holds songs."
const SONG_FOLDER_NAME_HINT = /song|worship|music/i;

function renderArrangementFoldersSection({ folders, selected, error }) {
  const suggested = selected === null ? folders.filter((name) => SONG_FOLDER_NAME_HINT.test(name)) : null;
  // Only auto-narrow to the suggestion when it's an unambiguous, partial
  // match — an empty or all-folders match can't express a preference,
  // so fall back to the old safe default of tracking everything.
  const useSuggestion = suggested !== null && suggested.length > 0 && suggested.length < folders.length;
  const allSelected = selected === null && !useSuggestion;
  const isChecked = (name) => allSelected || (useSuggestion ? suggested.includes(name) : selected?.includes(name));

  return `
    <div class="divider my-1"></div>
    <div class="text-sm font-semibold">Arrangement drift tracking</div>
    ${
      error
        ? `<div class="text-sm opacity-70">Can't reach ProPresenter to list Library folders right now.</div>`
        : folders.length === 0
          ? `<div class="text-sm opacity-70">No Library folders found.</div>`
          : `
      <div class="text-sm opacity-70 mb-1 rf-measure">
        Folders that hold songs. Separate from search, so a sermons folder can stay searchable
        without being tracked. ${useSuggestion ? `Pre-selected by name. Check it looks right.` : ""}
      </div>
      <label class="label cursor-pointer justify-start gap-2 w-fit">
        <input type="checkbox" id="arrangement-folder-all" class="checkbox checkbox-sm" ${allSelected ? "checked" : ""} />
        <span class="label-text">All libraries</span>
      </label>
      <div class="flex flex-col gap-1 ml-1">
        ${folders
          .map(
            (name) => `
          <label class="label cursor-pointer justify-start gap-2 w-fit">
            <input type="checkbox" class="checkbox checkbox-sm arrangement-folder-checkbox" value="${escapeHtml(name)}"
              ${isChecked(name) ? "checked" : ""}
              ${allSelected ? "disabled" : ""} />
            <span class="label-text">${escapeHtml(name)}</span>
          </label>
        `
          )
          .join("")}
      </div>
      <button id="save-arrangement-folders-btn" class="btn btn-sm btn-outline mt-2 w-fit">Save</button>
    `
    }
  `;
}

// Not DOM-based (div.textContent -> innerHTML) because that only escapes
// what's needed for text-node context (&, <, >) and leaves quote
// characters untouched — safe for text, but this app also interpolates
// escapeHtml() output straight into attribute values (data-tip="...",
// value="...", etc.), where an unescaped `"` in the source string closes
// the attribute early and corrupts the rest of the tag.
const DAY_LABELS = [["sun", "Sun"], ["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"]];
function feedWindowRow(w) {
  return `
    <div class="feed-window rf-control-row flex-wrap" data-feed-window>
      <div class="flex gap-1" role="group" aria-label="Days">${DAY_LABELS.map(([d, l]) => `<label class="flex items-center gap-1 text-xs"><input type="checkbox" class="checkbox checkbox-xs" data-feed-day="${d}" ${w.days.includes(d) ? "checked" : ""} aria-label="${l}"> ${l}</label>`).join("")}</div>
      <label class="text-xs flex items-center gap-1">From <input type="time" class="input input-bordered input-xs" data-feed-from value="${escapeHtml(w.from)}" aria-label="Window start"></label>
      <label class="text-xs flex items-center gap-1">Until <input type="time" class="input input-bordered input-xs" data-feed-until value="${escapeHtml(w.until)}" aria-label="Window end"></label>
      <button type="button" class="btn btn-ghost btn-xs" data-feed-remove aria-label="Remove this window">Remove</button>
    </div>`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "under a second";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// Accepts either plain id strings (slide splitters — no vendor-friendly
// name needed) or {id, displayName} pairs (providers/storage backends —
// see Section 17.2/17.3) so the visible label is never just a raw id.
function selectOptions(options, current) {
  return options
    .map((opt) => {
      const id = typeof opt === "string" ? opt : opt.id;
      const label = typeof opt === "string" ? opt : opt.displayName;
      return `<option value="${escapeHtml(id)}" ${id === current ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

/**
 * The two ways an index can be short without looking short.
 *
 * A configured folder that does not exist matched nothing and produced an
 * index missing every song in it. A folder that threw mid-crawl, or a crawl
 * that hit the consecutive-failure breaker, did the same. Both were reported
 * only to the console, so on screen a partial index and a complete one were
 * the same picture -- and the operator finds out by searching for a song on a
 * Sunday and not finding it.
 *
 * The unmatched-name case prints what the library actually has, because "you
 * asked for Songs and this library has Song" is the entire answer and there
 * is no way to reach it from an empty result.
 */
function renderIndexShortfall(index) {
  const issues = index.libraryFolderIssues;
  const aborted = index.crawlAborted;
  if (!issues && !aborted) return "";

  const parts = [];
  if (issues?.unmatchedNames?.length) {
    const many = issues.unmatchedNames.length !== 1;
    parts.push(
      `<div><strong>Configured folder${many ? "s" : ""} not found: ` +
        `${issues.unmatchedNames.map(escapeHtml).join(", ")}.</strong> ` +
        `This library has: ${(issues.availableFolders ?? []).map(escapeHtml).join(", ") || "no folders"}. ` +
        `Their songs are missing from search. ` +
        `Choose the libraries again on the Search tab.</div>`
    );
  }
  if (issues?.failedFolders?.length) {
    parts.push(
      `<div><strong>Could not read: ${issues.failedFolders.map((f) => escapeHtml(f.name)).join(", ")}.</strong> ` +
        `Their songs are missing from search. Rebuild once ProPresenter is responding.</div>`
    );
  }
  if (aborted) {
    parts.push(
      `<div><strong>Indexing stopped early.</strong> ` +
        `${escapeHtml(aborted.message ?? "ProPresenter stopped answering.")}</div>`
    );
  }

  return `<div class="alert alert-warning py-2 text-sm mt-2 items-start">
            <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
            <span class="flex flex-col gap-1">${parts.join("")}</span>
          </div>`;
}

/**
 * Commands the operator runs in Terminal, as one-click copies.
 *
 * Both of these are things Refrain cannot do for itself. It cannot open a
 * browser window without Chrome's own chrome, and it cannot restart itself
 * mid-update. What it can do is stop making somebody retype a command from a
 * README on another screen.
 *
 * Shown rather than hidden behind a toggle: the command IS the instruction, and
 * a copy button beside a command you can read is more trustworthy than a button
 * that promises to do something to your machine.
 */
/**
 * Open Refrain as its own window: Chrome with no tabs or address bar. The
 * 420px width only applies when Chrome isn't already running: a running
 * Chrome takes the --app but keeps its own window size (checked 2026-10-04),
 * so the help line says to drag it narrow. Every screen was checked at 320px.
 */
function appModeCommand(port) {
  return `open -na "Google Chrome" --args --app=http://localhost:${port} --window-size=420,1000`;
}
// `git checkout -- package-lock.json` first: npm rewrites the lockfile
// whenever it syncs it to package.json, and a modified lockfile makes
// `git pull` refuse. Discarding it loses nothing -- it is generated, and the
// npm install here rebuilds it.
function updateCommand(installDir) {
  return `cd "${installDir}" && git checkout -- package-lock.json 2>/dev/null; git pull --ff-only && npm install --silent && echo "Updated. Restart Refrain"`;
}
/** A command to run in Terminal, shown with a one-click copy. */
/**
 * Settings › Features › Day summary (owner, 2026-10-04): ending the day on
 * its own and sending the summary by email. The mail server login is in
 * Secrets (.env) below; this says when it's missing rather than failing later.
 */
function renderDaySummarySection(health) {
  const d = health.daySummary ?? {};
  const a = d.autoEnd ?? { enabled: false, idleMinutes: 120, closedMinutes: 15 };
  const report = health.reportModule ?? { status: "off", problems: [] };
  const sending =
    report.status === "active"
      ? "Ready to send."
      : report.status === "off"
        ? "Sending is off: the summary is kept on this Mac only."
        : `Not ready to send: ${(report.problems ?? []).join(" ")}`;
  return `
        <details id="day-summary-details" class="collapse collapse-arrow bg-base-200 rounded">
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="mail" class="w-4 h-4 opacity-70 shrink-0"></i> Day summary
              <span class="text-xs opacity-50 font-normal">${a.enabled ? "ends on its own" : "ends when you press End"}</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
            ${d.serviceModuleOn === false ? `<p class="text-sm">The Service timeline is off, so there's no day to end. Turn it on to use this.</p>` : ""}
            <label class="flex items-start gap-2 cursor-pointer">
              <input id="auto-end-enabled" type="checkbox" class="checkbox checkbox-sm mt-0.5" ${a.enabled ? "checked" : ""} />
              <span class="text-sm"><strong>End the day on its own and send the summary.</strong> Nobody reads it before it goes.</span>
            </label>
            <div class="flex flex-wrap gap-3 items-end">
              <label class="form-control">
                <span class="label-text text-xs opacity-70">After nothing on the screens for (minutes)</span>
                <input id="auto-end-idle" type="number" min="15" max="1440" step="15" class="input input-bordered input-sm w-28" value="${a.idleMinutes}" />
              </label>
              <label class="form-control">
                <span class="label-text text-xs opacity-70">Or ProPresenter closed for (minutes)</span>
                <input id="auto-end-closed" type="number" min="5" max="360" step="5" class="input input-bordered input-sm w-28" value="${a.closedMinutes}" ${d.closedWatch ? "" : "disabled"} />
              </label>
            </div>
            <p class="text-xs opacity-70 rf-measure">${
              d.closedWatch
                ? "Whichever comes first. A restart between services doesn't count; ProPresenter is back long before then."
                : "ProPresenter is on another Mac, so only the time with nothing on the screens is used: a quit there can't be told from a network drop."
            } Never on a day nothing went live, before a service still to come, or during a lock-in.</p>
            ${
              // Sending is only edited here for a backend that takes a list of
              // addresses; one that doesn't (a folder) is set in config.json and
              // left alone, so saving this section can't switch it off.
              d.backend?.takesRecipients
                ? `<label class="flex items-start gap-2 cursor-pointer">
              <input id="report-send-email" type="checkbox" class="checkbox checkbox-sm mt-0.5" ${d.sendByEmail ? "checked" : ""} />
              <span class="text-sm">Send the summary by ${escapeHtml(String(d.backend.name).toLowerCase())}</span>
            </label>
            <label class="form-control">
              <span class="label-text text-xs opacity-70">To (one address per line)</span>
              <textarea id="report-recipients" rows="3" class="textarea textarea-bordered textarea-sm font-mono" placeholder="name@yourchurch.org" spellcheck="false">${escapeHtml((d.recipients ?? []).join("\n"))}</textarea>
            </label>
            <p class="text-xs opacity-70 rf-measure">The mail server and the From address are in Secrets (.env) below: SMTP_HOST, SMTP_FROM, and SMTP_USERNAME and SMTP_PASSWORD if it needs a login.</p>`
                : `<p class="text-sm">The summary goes ${d.backend ? `by ${escapeHtml(d.backend.name)}` : "nowhere yet"}, set in config.json (reportModule).</p>`
            }
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" id="day-summary-save" class="btn btn-outline btn-sm">Save</button>
              <span id="day-summary-status" class="text-sm" role="status">${escapeHtml(sending)}</span>
            </div>
          </div>
        </details>`;
}

function wireDaySummarySettings(rerender) {
  const save = document.getElementById("day-summary-save");
  if (!save) return;
  save.addEventListener("click", async () => {
    const status = document.getElementById("day-summary-status");
    const closed = document.getElementById("auto-end-closed");
    const body = {
      autoEnd: {
        enabled: document.getElementById("auto-end-enabled").checked,
        idleMinutes: Number(document.getElementById("auto-end-idle").value),
        ...(closed.disabled ? {} : { closedMinutes: Number(closed.value) }),
      },
    };
    const send = document.getElementById("report-send-email");
    const to = document.getElementById("report-recipients");
    if (send) body.sendByEmail = send.checked;
    if (to) body.recipients = to.value.split(/[\n,;]+/).map((r) => r.trim()).filter(Boolean);
    save.disabled = true;
    try {
      const res = await fetch("/api/day-summary-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      const r = data.report ?? {};
      const said = `Saved. ${r.status === "active" ? "Ready to send." : r.status === "off" ? "Sending is off." : `Not ready to send: ${(r.problems ?? []).join(" ")}`}`;
      // Redrawn so the section's heading says what's now set; the fold
      // stays open and the result stays said.
      await rerender?.();
      document.getElementById("day-summary-details")?.setAttribute("open", "");
      const after = document.getElementById("day-summary-status");
      if (after) after.textContent = said;
    } catch (err) {
      status.textContent = `Not saved: ${err.message}`;
    } finally {
      save.disabled = false;
    }
  });
}

/**
 * The kill switch's two presses (issue #15): the first shows Kill, the second
 * stops Refrain. Anything else cancels: a click or tap elsewhere, Escape,
 * scrolling. No countdown and no dialog. After the kill, the page watches
 * Refrain go quiet before it says "stopped"; still answering after 10s, it
 * says so and points at Terminal.
 */
function wireKillSwitch() {
  const reveal = document.getElementById("kill-reveal");
  const kill = document.getElementById("kill-confirm");
  const status = document.getElementById("kill-status");
  if (!reveal || !kill) return;
  const cancel = () => {
    kill.classList.add("hidden");
    reveal.classList.remove("hidden");
    status.textContent = "";
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", cancel, true);
    window.removeEventListener("wheel", cancel, true);
  };
  const outside = (e) => {
    if (e.target !== kill && !kill.contains(e.target)) cancel();
  };
  const onKey = (e) => {
    if (e.key === "Escape" || (e.target !== kill && !["Enter", " ", "Tab", "Shift"].includes(e.key))) cancel();
  };
  reveal.addEventListener("click", () => {
    reveal.classList.add("hidden");
    kill.classList.remove("hidden");
    status.textContent = "Press Kill to stop Refrain. Anything else cancels.";
    kill.focus();
    // Next tick, so the press that revealed it isn't taken as "elsewhere".
    setTimeout(() => {
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("scroll", cancel, true);
      window.addEventListener("wheel", cancel, true);
    }, 0);
  });
  kill.addEventListener("click", async () => {
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", cancel, true);
    window.removeEventListener("wheel", cancel, true);
    kill.disabled = true;
    status.textContent = "Stopping...";
    let answer = null;
    try {
      const res = await fetch("/api/panic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }), signal: AbortSignal.timeout(5000) });
      answer = await res.json().catch(() => null);
    } catch {
      /* it may have gone before answering; watching says which */
    }
    // Stopped is something seen, not assumed: Refrain has to stop answering.
    const started = Date.now();
    while (Date.now() - started < 10_000) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(1000) });
      } catch {
        return showStopped(answer);
      }
    }
    kill.disabled = false;
    status.innerHTML = `<strong>Refrain is still answering.</strong> Use the Stream Deck key, or in Terminal: <code class="font-mono">launchctl bootout gui/$(id -u)/com.refrain.server</code>`;
  });
}

/** The whole page becomes the stopped state: not an error, and no dead buttons. */
function showStopped(answer) {
  const restart = answer?.restart ?? "launchctl kickstart gui/$(id -u)/com.refrain.server";
  const el = document.createElement("div");
  el.id = "refrain-stopped";
  el.className = "rf-stopped";
  el.setAttribute("role", "alert");
  el.innerHTML = `
    <div class="rf-stopped-box">
      <h1 class="text-2xl font-semibold">Refrain is stopped.</h1>
      <p>Nothing on the screens is affected. ProPresenter carries on as it was.</p>
      <p>To start Refrain again, run this in Terminal:</p>
      <div class="flex items-center gap-2 min-w-0">
        <code class="text-sm bg-base-300 rounded px-2 py-1 flex-1 min-w-0 overflow-x-auto whitespace-nowrap">${escapeHtml(restart)}</code>
        <button type="button" class="btn btn-chip shrink-0" id="stopped-copy">Copy</button>
      </div>
      ${answer?.comesBackAtLogin ? `<p class="opacity-70">It also starts again the next time this Mac's user logs in.</p>` : ""}
      <p class="opacity-70">This page can't restart it: the part of Refrain it would ask has stopped. Reload it once Refrain is running.</p>
    </div>`;
  document.body.appendChild(el);
  el.querySelector("#stopped-copy").addEventListener("click", (e) => {
    navigator.clipboard?.writeText(restart).then(
      () => (e.target.textContent = "Copied"),
      () => (e.target.textContent = "Select and copy it")
    );
  });
}

function commandRow(label, help, cmd) {
  return `
    <div class="flex flex-col gap-1">
      <div class="rf-silkscreen">${label}</div>
      <div class="text-xs opacity-60 rf-measure">${help}</div>
      <div class="flex items-center gap-2 min-w-0">
        <code class="text-xs bg-base-300 rounded px-2 py-1 flex-1 min-w-0 overflow-x-auto whitespace-nowrap">${escapeHtml(cmd)}</code>
        <button class="btn btn-chip shrink-0 terminal-copy" data-command="${escapeHtml(cmd)}" title="Copy this command">
          <i data-lucide="copy" class="w-3 h-3"></i> Copy
        </button>
      </div>
    </div>`;
}

/** "121 MB", "1.4 GB" -- decimal units, the way Finder reports sizes. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 KB";
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** The theme report, library by library. Pure, for tests. */
export function renderThemeReport(data) {
  const libs = data?.libraries ?? [];
  if (!libs.length) return `<div class="text-sm opacity-70">No deck uses a theme's layouts, so there's nothing to compare.</div>`;
  return libs
    .map((l) => {
      const rows = l.off
        .slice(0, 30)
        .map((o) => `<li>${escapeHtml(o.name)}: ${o.themes.map(escapeHtml).join(", ")}${o.alsoCurrent ? " <span class=\"opacity-60\">(mixed with the current one)</span>" : ""}</li>`)
        .join("");
      const more = l.off.length > 30 ? `<li class="opacity-60">and ${l.off.length - 30} more</li>` : "";
      return `
        <div class="text-sm">
          <div><strong>${escapeHtml(l.folder)}:</strong> current theme ${escapeHtml(l.current)} (${l.currentCount} of ${l.themedDecks} decks).
          ${l.off.length ? `${l.off.length} use another:` : "Every deck matches."}</div>
          ${l.off.length ? `<ul class="list-disc pl-5 text-xs opacity-80">${rows}${more}</ul>` : ""}
        </div>`;
    })
    .join("");
}

/**
 * The results of an unused-media scan, per workspace.
 *
 * The caveat at the bottom is not boilerplate: "unused" can only mean unused
 * by this Mac's ProPresenter, and a volunteer about to delete things should be
 * told which things that sentence cannot see.
 */
export function renderOrphanResults(result) {
  const sections = (result?.workspaces ?? []).map((w) => {
    if (w.missing) {
      return `<div class="text-sm opacity-70">${escapeHtml(w.name)}: no Media folder.</div>`;
    }
    if (w.orphanCount === 0) {
      return `<div class="text-sm opacity-70">${escapeHtml(w.name)}: all ${w.mediaFiles.toLocaleString()} media files are in use.</div>`;
    }
    const rows = w.orphans
      .map(
        (o) => `
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs min-w-0 break-all"><span class="opacity-60 tabular-nums">${formatBytes(o.bytes)}</span> ${escapeHtml(o.relPath)}</span>
          <button class="btn btn-chip shrink-0 orphan-reveal-btn" data-root="${escapeHtml(w.root)}" data-rel-path="${escapeHtml(o.relPath)}">Show in Finder</button>
        </div>`
      )
      .join("");
    return `
      <div class="flex flex-col gap-1">
        <div class="text-sm">
          <strong>${escapeHtml(w.name)}:</strong> ${w.orphanCount.toLocaleString()} of ${w.mediaFiles.toLocaleString()} files
          (${formatBytes(w.orphanBytes)}) are not used by anything.
        </div>
        ${w.truncated ? `<div class="text-xs opacity-60">Showing the ${w.orphans.length} largest.</div>` : ""}
        <div class="flex flex-col gap-1 max-h-80 overflow-y-auto">${rows}</div>
      </div>`;
  });
  return `
    ${sections.join("")}
    <div class="text-xs opacity-60 rf-measure">
      Unused on this Mac only. A deck not built yet, or another Mac, may still need it.
      Look before you delete.
    </div>`;
}

/**
 * Start at login.
 *
 * This is the answer to the thing every operator hits first: Refrain lives in
 * a Terminal window, and closing that window stops it. A LaunchAgent runs the
 * same server with no window and brings it back at the next login.
 *
 * Not shown at all off macOS -- an explanation of a button that cannot exist
 * is worse than silence.
 */
function renderAutostartCard(state) {
  if (!state || !state.supported) {
    return `
    <div class="card bg-base-200">
      <div class="card-body p-3 gap-2">
        <h2 class="card-title text-base">Start at login</h2>
        <div class="text-sm opacity-70 rf-measure">Only on a Mac for now. On this computer, start Refrain with <span class="font-mono">scripts/start.bat</span>.</div>
      </div>
    </div>`;
  }
  const on = state.installed;
  const badge = on
    ? `<div class="badge badge-success gap-1">On</div>`
    : `<div class="badge badge-ghost gap-1">Off</div>`;
  // "installed but not loaded" is the one state worth calling out: the plist is
  // there and launchd is not running it, which a plain On/Off would hide.
  const warn =
    on && !state.loaded
      ? `<div class="rf-hint">Installed, but not running. Turn it off and on again, or check <code>logs/refrain.err.log</code>.</div>`
      : "";
  return `
    <div class="card bg-base-200">
      <div class="card-body p-3 gap-2">
        <h2 class="card-title text-base flex items-center justify-between gap-2">
          <span class="flex items-center gap-2"><i data-lucide="power" class="w-4 h-4 opacity-70"></i> Start at login</span>
          ${badge}
        </h2>
        <div class="text-sm opacity-70 rf-measure">
          Runs Refrain in the background, with no Terminal window, each time you log in.
        </div>
        ${warn}
        <div class="rf-control-row">
          <button type="button" id="autostart-toggle" class="btn btn-outline btn-xs" data-enabled="${on ? "1" : "0"}">
            <i data-lucide="${on ? "power-off" : "power"}" class="w-3.5 h-3.5"></i> ${on ? "Turn off" : "Turn on"}
          </button>
          <span id="autostart-status" class="text-xs opacity-60"></span>
        </div>
      </div>
    </div>`;
}

/**
 * The Modules tile in the top strip: one line a volunteer can read out on the
 * phone. Only the modules that need setup report a status (the rest are
 * always on), so this lists those, worst first, plus anything staged locally
 * and still waiting to reach shared storage.
 */
export function summarizeModules(health) {
  const mods = [
    { name: "Arrangement", status: health.arrangementModule?.status },
    { name: "Phone flags", status: health.networkModule?.status },
    { name: "Summary sending", status: health.reportModule?.status },
    { name: "Service feed", status: health.serviceFeedModule?.status },
  ].filter((m) => m.status);
  const rank = { misconfigured: 0, active: 1, off: 2 };
  mods.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3));
  const broken = mods.filter((m) => m.status === "misconfigured").length;
  const pending = health.arrangementModule?.pendingUploads ?? 0;
  const headline = broken ? `${broken} need${broken === 1 ? "s" : ""} setup` : "Nothing misconfigured";
  const detail = [
    ...mods.map((m) => `${m.name} ${m.status}`),
    ...(pending ? [`${pending} upload${pending === 1 ? "" : "s"} waiting`] : []),
  ].join(" · ");
  return { headline, detail, attention: broken > 0 || pending > 0 };
}

/**
 * Secrets (.env), as the last section of the Options card (owner, 2026-09-30:
 * "Can the Secrets card be one of the accordions, and load the .env in an
 * editable way?"). A field for each setting .env.example lists, plus any the
 * file has of its own; values hidden until shown. Saved by server/env-file.js,
 * which keeps comments and order and the previous file as .env.previous.
 */
function renderEnvSection(envRequirements, entries) {
  return `
        <details id="env-details" class="collapse collapse-arrow bg-base-200 rounded">
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="key-round" class="w-4 h-4 opacity-70 shrink-0"></i> Secrets (.env)
              <span class="text-xs opacity-50 font-normal">passwords and API keys</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
            <div class="text-sm opacity-70 rf-measure">Saved to .env on this computer. <strong>Restart Refrain after saving.</strong> The previous version is kept as .env.previous.</div>
        ${
          envRequirements.length === 0
            ? `<div class="text-sm mt-0 opacity-70">Nothing you've turned on needs a .env value.</div>`
            : `<div class="flex flex-col gap-2 mt-0">
                ${envRequirements
                  .map(
                    (r) => `
                  <div class="flex items-start gap-2">
                    <div class="badge badge-sm ${r.set ? "badge-success" : "badge-ghost"} mt-0.5 shrink-0">${r.set ? "Set" : "Missing"}</div>
                    <div class="text-sm">
                      <span class="font-mono">${escapeHtml(r.name)}</span>
                      <div class="opacity-60">${escapeHtml(r.note)}</div>
                    </div>
                  </div>
                `
                  )
                  .join("")}
              </div>`
        }
            <label class="label cursor-pointer justify-start gap-2 w-fit">
              <input type="checkbox" id="env-show" class="checkbox checkbox-xs" />
              <span class="label-text text-sm">Show values</span>
            </label>
            <div class="flex flex-col gap-2">
              ${entries
                .map(
                  (e) => `
              <div class="rf-field">
                <label for="env-${escapeHtml(e.name)}" class="font-mono">${escapeHtml(e.name)}${e.inExample ? "" : ` <span class="opacity-60">(not in .env.example)</span>`}</label>
                <input type="text" data-masked="true" id="env-${escapeHtml(e.name)}" class="input input-bordered input-sm font-mono env-value" data-1p-ignore data-lpignore="true" data-name="${escapeHtml(e.name)}" data-original="${escapeHtml(e.value)}" value="${escapeHtml(e.value)}" autocomplete="off" spellcheck="false" />
              </div>`
                )
                .join("")}
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <button type="button" id="env-save" class="btn btn-outline btn-sm">Save</button>
              <button type="button" id="open-env-btn" class="btn btn-chip"><i data-lucide="file-cog" class="w-3.5 h-3.5"></i> Open .env</button>
              <span id="env-status" class="text-sm"></span>
              <span id="open-env-status" class="text-sm"></span>
            </div>
          </div>
        </details>`;
}

function renderHealth(health, configOptions, versionInfo, libraryCard = "", duplicateNameGroups = [], envEntryList = []) {
  const { propresenter, index, arrangementModule, role, version, config, envRequirements } = health;
  const port = health.port ?? window.location.port ?? 9999;
  const installDir = health.installDir ?? "$HOME/Refrain";
  const autostartCard = renderAutostartCard(health.autostart);

  const propresenterCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="cast" class="w-4 h-4 opacity-70"></i> ProPresenter connection</h2>
        <div class="flex items-center gap-2 mt-1">
          <button type="button" id="pp-diagnose-btn" class="btn btn-outline btn-xs">
            <i data-lucide="stethoscope" class="w-3.5 h-3.5"></i> Diagnose
          </button>
          <span id="pp-diagnose-status" class="text-xs opacity-60"></span>
        </div>
        <div id="pp-diagnose-results" class="flex flex-col gap-2"></div>
        ${
          // Connected state lives in the status strip above; repeating it here was
          // the main thing that made this screen read as two copies of itself.
          // What belongs here is only what the strip can't say: how to fix it.
          propresenter.load ? `<div class="text-sm rf-flag rf-measure" role="status">${escapeHtml(propresenter.load.message)}</div>` : ""
        }
        ${
          propresenter.slidePictures?.show && propresenter.slidePictures?.lastRunAt && propresenter.slidePictures.presentations
            ? `<div class="text-sm opacity-60 rf-measure">Slide pictures: ${propresenter.slidePictures.ready} ready for today's playlists (checked ${new Date(propresenter.slidePictures.lastRunAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${propresenter.slidePictures.stopped ? `; stopped: ${escapeHtml(propresenter.slidePictures.stopReason ?? "something went live")}` : ""}).</div>`
            : ""
        }
        ${
          propresenter.connected
            ? `<div class="text-sm opacity-60 rf-measure">Last checked ${new Date(propresenter.lastCheckIn ?? Date.now()).toLocaleTimeString()}. Run Diagnose if ProPresenter is behaving oddly.</div>`
            : `<div class="text-sm">Check ProPresenter is open with its Network API on (Preferences &gt; Network), and the host and port on the <a href="#settings/features" class="link">Features</a> tab are correct.</div>`
        }
      </div>
    </div>
  `;

  const indexCard = `
    <div class="card bg-base-200${health.index?.rebuild?.inProgress ? " rf-indexing" : ""}">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="database" class="w-4 h-4 opacity-70"></i> Search index</h2>
        ${
          index.builtAt
            ? `<div class="text-sm opacity-70">
                ${
                  index.buildDurationMs == null
                    ? "Last build time unknown."
                    : `Last ${index.buildMode === "incremental" ? "reindex" : "full rebuild"} took ${formatDuration(index.buildDurationMs)}${
                        index.buildMode === "incremental" && index.reindexCounts
                          ? // What it actually re-read, not what it set out to.
                            // The planned figure was printed as fact directly
                            // above a notice saying most of the library had been
                            // skipped, and the reassuring number was the wrong one.
                            `. Re-read ${
                              index.reindexCompleted ??
                              index.reindexCounts.changed + index.reindexCounts.added + index.reindexCounts.unverifiable
                            }${
                              index.reindexCompleted != null &&
                              index.reindexAttempted != null &&
                              index.reindexCompleted < index.reindexAttempted
                                ? ` of ${index.reindexAttempted} planned, then stopped early`
                                : ""
                            }, reused ${index.reindexCounts.carriedOver}`
                          : index.crawledPlaylists
                            ? " (included a playlist crawl)"
                            : ""
                      }`
                } ${infoIcon("Use it to judge whether a rebuild would finish before a service.")}
              </div>`
            : ""
        }
        ${
          // Performance mode is the loudest thing on this card while it is on:
          // every "why hasn't it indexed" question has the same answer, and it
          // should be answered before it is asked.
          index.performanceMode?.armed
            ? `<div class="alert alert-warning py-2 text-sm mt-2 items-start">
                 <i data-lucide="pause-circle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                 <span><strong>Performance mode is on, so background indexing is paused.</strong>
                 ${escapeHtml(index.performanceMode.description)}
                 Search still works, and the buttons below still run.
                 Turn it off on the Live screen after the service${
                   index.performanceMode.source === "manual" ? ": it was turned on by hand, so it won't clear on its own" : ""
                 }.</span>
               </div>`
            : index.indexWorkDeferred
              ? `<div class="alert alert-info py-2 text-sm mt-2 items-start">
                   <i data-lucide="pause-circle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                   <span><strong>${index.builtAt ? "The index is out of date" : "No index yet"}. Refrain held off because ${escapeHtml(index.indexWorkDeferred)}.</strong>
                   ${index.builtAt ? "Search still works from the old index." : "Search is empty until it's built."}</span>
                 </div>`
              : ""
        }
        ${renderIndexShortfall(index)}
        ${
          index.rebuild.inProgress
            ? `<div class="flex items-center gap-3 mt-1">
                 <div id="health-rebuild-meter" class="flex-1"></div>
                 <span id="health-rebuild-count" class="rf-meter-count"></span>
               </div>
               <div class="text-sm mt-2">Reading every slide you own${
                 index.rebuild.etaMs != null ? `: about ${formatDuration(index.rebuild.etaMs)} to go at this rate` : ""
               }. Go coil something.</div>
               <button id="health-stop-rebuild-btn" class="btn btn-brand btn-sm w-fit mt-2">Stop indexing</button>
               <div id="health-stop-rebuild-status" class="rf-hint"></div>
               <div class="alert alert-warning py-2 text-sm mt-2 items-start">
                 <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                 <span><strong>A rebuild is running, so ProPresenter will be sluggish until it finishes.</strong>
                 Keep ProPresenter open, or the build stops. Nothing goes to the screens, but Go Live, Clear
                 and macros may be slow or not respond. Stop it if a service is about to start: what's already
                 read is kept. After a big run, restart ProPresenter before the service.</span>
               </div>`
            : health.protectProPresenter
              ? `<div class="text-sm mt-2 rf-measure">Search uses the index it already has. Refrain doesn't read the library from ProPresenter while <strong>Protect ProPresenter</strong> is on (Advanced, below), so nothing here reads it again.</div>`
              : (() => {
                // The scary warning belongs to whichever button is actually
                // going to run an hour-long crawl. With no index yet there is
                // nothing to compare files against, so the only thing on offer
                // IS the full crawl — offering a "quick and safe" reindex
                // button that silently becomes one would be a trap.
                const fullRebuildWarning = `
                  <div class="alert alert-warning py-2 text-sm mt-2 items-start">
                    <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                    <span>
                      <strong>Never rebuild near a service.</strong>
                      It can take an hour or more, and ProPresenter can stop responding to Go Live, Clear
                      and macros while it runs. Start one only when ProPresenter is free for two hours,
                      and let it finish.
                    </span>
                  </div>`;
                const fullRebuildButton = `
                  <div class="flex items-center gap-2 mt-1">
                    <button id="health-rebuild-btn" class="btn btn-sm btn-outline w-fit"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> <span id="health-rebuild-btn-label">${index.builtAt ? "Rebuild everything" : "Build index"}</span></button>
                    ${infoIcon("Reads the whole library again. Only for a first build, or when reindexing hasn't fixed search.")}
                  </div>`;

                if (!index.builtAt) {
                  return `<div class="flex flex-col gap-2 mt-2">
                    <div class="text-sm opacity-70">
                      The first build reads everything once. After that, only changed presentations
                      are re-read.
                    </div>
                    ${fullRebuildWarning}
                    ${fullRebuildButton}
                  </div>`;
                }

                const watch = index.autoReindex;
                // Two things have to be visible here: that Refrain is keeping
                // itself current without being asked, and — more importantly —
                // any work it deliberately declined to do. A guard that quietly
                // skips is indistinguishable from a watcher that is broken.
                const watchLine = watch
                  ? `<div class="text-sm opacity-60 flex items-center gap-1.5">
                       <span class="rf-led ${watch.watching > 0 ? "lit" : ""}" title="${watch.watching > 0 ? "Watching for library changes" : "Not watching"}"></span>
                       ${
                         watch.watching > 0
                           ? `Watching ${watch.watching} library folder${watch.watching === 1 ? "" : "s"}. Edited presentations reindex on their own.`
                           : "Not watching any folders yet."
                       }
                       ${watch.at ? `Last check ${new Date(watch.at).toLocaleTimeString()}: ${escapeHtml(watch.outcome)}.` : ""}
                     </div>`
                  : `<div class="text-sm opacity-60">Automatic reindexing is off (<code>autoReindex: false</code> in config.json).</div>`;

                const pendingAlert = watch?.pending
                  ? `<div class="alert alert-info py-2 text-sm items-start">
                       <i data-lucide="inbox" class="w-4 h-4 shrink-0 mt-0.5"></i>
                       <span>${
                         watch.pending.needsFullRebuild
                           ? `<strong>Waiting on a full rebuild.</strong> ${escapeHtml(watch.pending.reason)}. Refrain won't start one itself. Use Rebuild everything below when you have a clear hour.`
                           : `<strong>${watch.pending.count} presentations have changed.</strong> Too many to reindex without asking. Press Reindex changed only when ProPresenter is free.`
                       }</span>
                     </div>`
                  : "";

                const rebuildSuggestion = index.fullRebuildSuggestion
                  ? `<div class="alert alert-info py-2 text-sm items-start">
                       <i data-lucide="calendar-clock" class="w-4 h-4 shrink-0 mt-0.5"></i>
                       <span>${escapeHtml(index.fullRebuildSuggestion.message)}</span>
                     </div>`
                  : "";

                return `<div class="flex flex-col gap-2 mt-2">
                  ${pendingAlert}
                  ${rebuildSuggestion}
                  <div class="flex items-center gap-2">
                    <button id="health-reindex-btn" class="btn btn-sm btn-outline w-fit"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> <span id="health-reindex-btn-label">Reindex changed only</span></button>
                    ${infoIcon("Re-reads only what changed. Takes seconds.")}
                  </div>
                  <div id="health-reindex-status" class="text-sm"></div>
                  ${watchLine}
                  ${
                    index.crawledPlaylists
                      ? `<div class="alert alert-warning py-2 text-sm items-start">
                           <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                           <span><strong>Playlist crawling is on, so reindexing is slow.</strong>
                           Every playlist is re-read each time, which is hard on ProPresenter. Turn it off
                           under Search &amp; indexing on the Features tab if you don't need it.</span>
                         </div>`
                      : `<div class="text-sm opacity-60 rf-measure">
                           After you change preferred arrangements or playlist crawling, Reindex runs a
                           full rebuild instead, and says so.
                         </div>`
                  }
                  <details class="mt-1">
                    <summary class="text-sm cursor-pointer opacity-70 w-fit">Rebuild everything instead</summary>
                    ${fullRebuildWarning}
                    ${fullRebuildButton}
                  </details>
                </div>`;
              })()
        }
      </div>
    </div>
  `;

  /**
   * Quiet unless there is something to act on — no "0 duplicates found"
   * all-clear, matching renderIndexShortfall. A number nobody has to act on
   * is exactly what the ideas doc's own "considered and not recommended"
   * section warns against.
   *
   * Each entry gets the same "Show in editor" action search.js's results
   * use — opens ProPresenter's editor on that exact presentation without
   * changing what is live, so the admin can go look and decide which one
   * to rename or archive rather than guessing from a name alone.
   */
  const duplicateNamesCard =
    duplicateNameGroups.length === 0
      ? ""
      : `
    <div class="card bg-base-200">
      <div class="card-body p-3 gap-2">
        <h2 class="card-title text-base"><i data-lucide="copy-x" class="w-4 h-4 opacity-70"></i> Duplicate names across folders</h2>
        <div class="text-sm opacity-70 rf-measure">
          The same name in more than one folder, so it's easy to pick the wrong one.
        </div>
        <div class="flex flex-col gap-2">
          ${duplicateNameGroups
            .map(
              (g) => `
            <div class="flex flex-col gap-1 border-t border-base-300 pt-2 first:border-0 first:pt-0">
              <div class="text-sm font-medium">${escapeHtml(g.name)}</div>
              <div class="flex flex-col gap-1">
                ${g.entries
                  .map(
                    (e) => `
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs opacity-70">${escapeHtml(e.folder ?? "Unknown folder")}</span>
                    <button class="btn btn-chip shrink-0 show-in-editor-btn" data-presentation-id="${escapeHtml(e.presentationId)}">
                      Show in editor
                    </button>
                  </div>`
                  )
                  .join("")}
              </div>
            </div>`
            )
            .join("")}
        </div>
      </div>
    </div>
  `;

  /**
   * Presentations whose preferred arrangement exists but isn't selected
   * (handoff §38). A button, because it reads each candidate through
   * ProPresenter; the list only points, since the switch is made in
   * ProPresenter's editor. Only shown when a preferred arrangement is set.
   */
  const preferredNames = health.preferredArrangements ?? [];
  const preferredCard = preferredNames.length
    ? `
    <div class="card bg-base-200">
      <div class="card-body p-3 gap-2">
        <h2 class="card-title text-base"><i data-lucide="list-ordered" class="w-4 h-4 opacity-70"></i> ${escapeHtml(preferredNames.join(" or "))} not selected</h2>
        <div class="text-sm opacity-70 rf-measure">
          These have a ${escapeHtml(preferredNames.join(" or "))} arrangement, but another is selected. Switch them in
          ProPresenter's editor. Only new playlist entries change. Checking reads through ProPresenter, so run it
          outside a service day.
        </div>
        <div class="flex items-center gap-2">
          <button id="preferred-check-btn" class="btn btn-outline btn-sm w-fit">Check</button>
          <span id="preferred-check-status" class="text-xs opacity-70"></span>
        </div>
        <div id="preferred-results" class="flex flex-col gap-1"></div>
      </div>
    </div>`
    : "";

  /**
   * Unused media: a button, never automatic, and nowhere near Search or Live --
   * docs/ideas.md is explicit that this is disk cleanup and must not dilute
   * the pre-service list. Refrain never deletes anything; the most it does is
   * show a file in Finder so a person can look and decide.
   */
  const net = health.networkModule;
  // Features (owner, 2026-10-06): Search and Spell Check are what Refrain is
  // for and are always on; everything else is a switch, declared by its own
  // module (server/features.js). Off hides its tab or section entirely.
  const features = health.features ?? [];
  const featureOn = (id) => features.find((f) => f.id === id)?.on !== false;

  // Always here, off or on, because Health is where people look for setup.
  // The Phone panel (rail) does the work; this says the state and opens it.
  const phoneStatus = !net || net.status === "off"
    ? "Off. Phones can flag slides and, if you approve them, send a stage message or a pager code."
    : net.status === "active"
      ? `On at ${escapeHtml((net.urls ?? [])[0] ?? "this Mac")}${net.pinMode === "none" ? ", with no PIN" : net.pinMode === "daily" ? ", with a daily PIN" : ", with a PIN"}.`
      : `Not running: ${escapeHtml((net.problems ?? []).join(" "))}`;
  const phoneCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3 gap-2">
        <h2 class="card-title text-base"><i data-lucide="smartphone" class="w-4 h-4 opacity-70"></i> Phones</h2>
        <div class="text-sm rf-measure">${phoneStatus}</div>
        <button type="button" id="health-open-phone" class="btn btn-outline btn-xs w-fit">Open the Phone panel</button>
      </div>
    </div>`;

  // Pictures ahead of time (owner, 2026-10-04): here, beside Phones, because
  // the phone's flag tray is what needs them. During a service nothing new is
  // drawn, so a picture that wasn't rendered ahead just isn't shown.
  const pictures = propresenter.slidePictures ?? {};
  const picturesOn = pictures.prerender === true;
  const picturesCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3 gap-2">
        <h2 class="card-title text-base"><i data-lucide="images" class="w-4 h-4 opacity-70"></i> Slide pictures</h2>
        <!-- The one switch for every picture (owner, 2026-10-04: "disable all
             image previews ... temporary"). Off: ProPresenter is asked for
             none, and the screens show the slides' words. -->
        <div class="rf-tabs" role="radiogroup" aria-label="Show slide pictures" style="margin-bottom:0">
          <button type="button" role="radio" class="rf-tab" data-pictures-show="true" aria-checked="${pictures.show === true}"><span>Show pictures</span></button>
          <button type="button" role="radio" class="rf-tab" data-pictures-show="false" aria-checked="${pictures.show !== true}"><span>Words only</span></button>
        </div>
        <p class="text-xs opacity-70 rf-measure">${
          pictures.show === true
            ? "Safe slides, Spell Check and phones show slide pictures."
            : pictures.quickSlides !== false
              ? "Off: slides show their words. Only your saved safe slides have pictures (below)."
              : "Off: Refrain asks ProPresenter for no pictures. Slides show their words."
        }</p>
        <div class="rf-subhead mt-2">Safe slide pictures</div>
        <p class="text-sm rf-measure">Pictures of your saved safe slides on Now, even with pictures off, so the logo and the blank are told apart at a glance. Each is drawn once, when it's saved, and kept. Nothing new is drawn during a service.</p>
        <div class="rf-tabs" role="radiogroup" aria-label="Safe slide pictures" style="margin-bottom:0">
          <button type="button" role="radio" class="rf-tab" data-quick-pictures="true" aria-checked="${pictures.quickSlides !== false}"><span>Pictures</span></button>
          <button type="button" role="radio" class="rf-tab" data-quick-pictures="false" aria-checked="${pictures.quickSlides === false}"><span>Names</span></button>
        </div>
        <div class="rf-subhead mt-2">Draw ahead of time</div>
        <p class="text-sm rf-measure">Phones and the Now screen only show pictures drawn before the service. Turn this on to draw today's service playlists while nothing is on the screens.</p>
        <p class="text-xs opacity-70 rf-measure">ProPresenter holds on to memory for each picture it draws until it restarts, so restart ProPresenter after the pictures are drawn and before the service. The pictures are kept.</p>
        <div class="rf-tabs" role="radiogroup" aria-label="Slide pictures ahead of time" style="margin-bottom:0">
          <button type="button" role="radio" class="rf-tab" data-prerender="true" aria-checked="${picturesOn}" ${pictures.show === true ? "" : "disabled"}><span>On</span></button>
          <button type="button" role="radio" class="rf-tab" data-prerender="false" aria-checked="${!picturesOn}" ${pictures.show === true ? "" : "disabled"}><span>Off</span></button>
        </div>
        <div id="prerender-status" class="text-xs opacity-70 rf-measure">${
          pictures.show !== true
            ? "Nothing is drawn ahead while pictures are off (Words only above)."
            : pictures.onThisMac === false
            ? "ProPresenter is on another Mac, so pictures can't be drawn ahead from here."
            : picturesOn
              ? pictures.lastRunAt
                ? `${pictures.ready} ready for today's playlists (checked ${new Date(pictures.lastRunAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${pictures.stopped ? `; stopped: ${escapeHtml(pictures.stopReason ?? "something went live")}` : ""}).`
                : "Waits until nothing is on the screens and no service is near, then starts. Needs today's services set up on Service › Day."
              : "Off."
        }</div>
      </div>
    </div>`;

  // Telemetry (owner, 2026-10-04): this station reporting to the church's own
  // announcement server. Off until set up; talks only inside its windows.
  const feed = health.serviceFeedModule ?? {};
  const fs = feed.settings ?? { enabled: false, name: "", url: "", includeSlideText: false, windows: [], keySet: false };
  const feedStatusLine = !fs.enabled
    ? "Off. Nothing is sent anywhere."
    : feed.status === "misconfigured"
      ? (feed.problems ?? []).join(" ")
      : feed.lastError
        ? feed.lastError
        : feed.inWindow
          ? feed.lastOkAt ? `Sending. Last heard by the server at ${new Date(feed.lastOkAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "Inside a send window. Waiting for the first send."
          : "Outside its send windows, so it is quiet.";
  const telemetryCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3 gap-3">
        <h2 class="card-title text-base"><i data-lucide="radio-tower" class="w-4 h-4 opacity-70"></i> This station</h2>
        <p class="text-sm rf-measure">Lets your own announcement server see which slide this station is showing, and keep its log for review. It only talks to the address below, and only inside the windows below. Nothing goes to the Refrain project.</p>
        <div class="rf-tabs" role="radiogroup" aria-label="Telemetry" style="margin-bottom:0">
          <button type="button" role="radio" class="rf-tab" data-feed-enabled="true" aria-checked="${fs.enabled}"><span>On</span></button>
          <button type="button" role="radio" class="rf-tab" data-feed-enabled="false" aria-checked="${!fs.enabled}"><span>Off</span></button>
        </div>
        <label class="flex flex-col gap-1 text-sm">Station name
          <input id="feed-name" type="text" maxlength="60" class="input input-bordered input-sm max-w-sm" value="${escapeHtml(fs.name)}" placeholder="Main Campus FOH" autocomplete="off">
          <span class="text-xs opacity-60">How the announcement server lists this station, so its data is told apart from the others.</span>
        </label>
        <label class="flex flex-col gap-1 text-sm">Announcement server address
          <input id="feed-url" type="url" class="input input-bordered input-sm max-w-xl" value="${escapeHtml(fs.url)}" placeholder="https://" autocomplete="off">
          <span class="text-xs opacity-60">The console address from its admin page. The key for this station goes in Secrets as SERVICE_FEED_TOKEN${fs.keySet ? " (set)" : " (not set yet)"}. A key saved in Secrets takes effect when Refrain is restarted.</span>
        </label>
        <div class="flex flex-col gap-1">
          <div class="text-sm">Send windows <span class="text-xs opacity-60">(this Mac's local time; nothing is sent outside them)</span></div>
          <div id="feed-windows" class="flex flex-col gap-2">${fs.windows.map(feedWindowRow).join("")}</div>
          <button type="button" id="feed-add-window" class="btn btn-outline btn-xs w-fit">Add a window</button>
        </div>
        <div class="flex flex-col gap-1">
          <div class="text-sm">Words on the slide</div>
          <div class="rf-tabs" role="radiogroup" aria-label="Send the words on the slide" style="margin-bottom:0">
            <button type="button" role="radio" class="rf-tab" data-feed-text="true" aria-checked="${fs.includeSlideText}"><span>Send them</span></button>
            <button type="button" role="radio" class="rf-tab" data-feed-text="false" aria-checked="${!fs.includeSlideText}"><span>Title and number only</span></button>
          </div>
          <span class="text-xs opacity-60 rf-measure">A prayer or care slide can carry a name, so the default is the title and slide number only.</span>
        </div>
        <div class="flex flex-col gap-1">
          <div class="text-sm">Picture of the slide</div>
          <div class="rf-tabs" role="radiogroup" aria-label="Send a picture of the slide" style="margin-bottom:0">
            <button type="button" role="radio" class="rf-tab" data-feed-image="true" aria-checked="${fs.includeSlideImage}"><span>Send it</span></button>
            <button type="button" role="radio" class="rf-tab" data-feed-image="false" aria-checked="${!fs.includeSlideImage}"><span>Don't send</span></button>
          </div>
          <span class="text-xs opacity-60 rf-measure">A small picture of the slide on screen, about 25 KB each time it changes. During a service only slides already drawn ahead of time are sent (Settings &gt; Phones &gt; Slide pictures), so nothing new is drawn on ProPresenter. A picture can show a name, like the words can.</span>
        </div>
        <div class="rf-control-row">
          <button type="button" id="feed-save" class="btn btn-primary btn-sm">Save</button>
          <button type="button" id="feed-send-log" class="btn btn-outline btn-sm">Send log</button>
          <span id="feed-status" class="text-xs opacity-70 rf-measure">${escapeHtml(feedStatusLine)}</span>
        </div>
      </div>
    </div>`;

  const themesCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3 gap-2">
        <h2 class="card-title text-base"><i data-lucide="palette" class="w-4 h-4 opacity-70"></i> Themes</h2>
        <div class="text-sm opacity-70 rf-measure">
          Finds decks using a different theme from most of their library. Read only.
        </div>
        <div class="rf-control-row">
          <button id="theme-report-btn" class="btn btn-outline btn-xs"><i data-lucide="scan-search" class="w-3.5 h-3.5"></i> Check themes</button>
          <span id="theme-report-status" class="text-xs opacity-60"></span>
        </div>
        <div id="theme-report-results" class="flex flex-col gap-3"></div>
      </div>
    </div>
  `;

  const orphanedMediaCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3 gap-2">
        <h2 class="card-title text-base"><i data-lucide="image-off" class="w-4 h-4 opacity-70"></i> Unused media</h2>
        <div class="text-sm opacity-70 rf-measure">
          Files in ProPresenter's Media folder that nothing uses. Refrain never deletes anything.
        </div>
        <div class="rf-control-row">
          <button id="orphan-scan-btn" class="btn btn-outline btn-xs">
            <i data-lucide="scan-search" class="w-3.5 h-3.5"></i> Scan for unused media
          </button>
          <span id="orphan-scan-status" class="text-xs opacity-60"></span>
        </div>
        <div id="orphan-results" class="flex flex-col gap-3"></div>
      </div>
    </div>
  `;

  const arrangementCard =
    arrangementModule.status === "off"
      ? ""
      : `
    <div class="card bg-base-200">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="git-compare" class="w-4 h-4 opacity-70"></i> Arrangement module</h2>
        <div class="badge ${arrangementModule.status === "active" ? "badge-success" : "badge-warning"} gap-1">
          <i data-lucide="${arrangementModule.status === "active" ? "check-circle-2" : "alert-triangle"}" class="w-3 h-3"></i>
          ${ARRANGEMENT_STATUS_LABEL[arrangementModule.status]}
        </div>
        <div class="text-sm opacity-70">
          Provider: ${escapeHtml(arrangementModule.providerDisplayName ?? "Manual")} &middot; Storage: ${escapeHtml(arrangementModule.storageBackendDisplayName ?? "Not set")}
        </div>
        ${
          arrangementModule.status === "misconfigured"
            ? `<div class="text-sm mt-1">Turned on, but .env is missing credentials for this provider or storage. See .env.example.</div>`
            : ""
        }
        ${
          arrangementModule.pendingUploads > 0
            ? `<div class="alert alert-warning mt-2 py-2 text-sm">${arrangementModule.pendingUploads} upload(s) waiting. Storage was unreachable. Refrain retries on its own.</div>`
            : ""
        }
      </div>
    </div>
  `;

  const configCard = `
      <div class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="rf-subhead" style="margin-bottom:0">Options</h2>
          <button id="backup-config-btn" class="btn btn-chip">
            <i data-lucide="download" class="w-3.5 h-3.5"></i> Back up config
          </button>
        </div>
        <div class="text-xs opacity-60 rf-measure">
          Saved to <code>config.json</code>. Each section saves on its own.
        </div>
        <details class="collapse collapse-arrow bg-base-200 rounded" >
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="cast" class="w-4 h-4 opacity-70 shrink-0"></i> ProPresenter
              <span class="text-xs opacity-50 font-normal">host, port, role</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
            <label class="label py-1" for="config-role">
              <span class="label-text">Role ${infoIcon('"logger" records the data, "reader" only shows it. Use logger on the one computer that runs during service.')}</span>
            </label>
            <select id="config-role" class="select select-bordered select-sm">
              <option value="reader" ${role === "reader" ? "selected" : ""}>reader</option>
              <option value="logger" ${role === "logger" ? "selected" : ""}>logger</option>
            </select>
          </label>

          <div class="flex flex-wrap gap-3">
            <label class="form-control w-full max-w-xs">
              <label class="label py-1" for="config-host">
                <span class="label-text">ProPresenter host ${infoIcon("The address of the computer running ProPresenter. \"localhost\" if it's this one.")}</span>
              </label>
              <input id="config-host" type="text" class="input input-bordered input-sm" value="${escapeHtml(propresenter.host)}" />
            </label>
            <label class="form-control w-full max-w-[10rem]">
              <label class="label py-1" for="config-port">
                <span class="label-text">Port ${infoIcon("Shown in ProPresenter under Preferences > Network.")}</span>
              </label>
              <input id="config-port" type="number" min="1" max="65535" class="input input-bordered input-sm" value="${propresenter.port}" />
            </label>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" id="config-detect-btn" class="btn btn-outline btn-sm">Detect ProPresenter</button>
            <span id="config-detect-result" class="text-sm"></span>
          </div>
          <div class="text-xs opacity-60 rf-measure">Checks <strong>this computer only</strong> and fills in the host and port. Save to apply.</div>

          <div id="config-network-scan-offer" class="alert alert-warning py-2 text-sm items-start hidden">
            <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
            <span>
              <strong>Only search the network if ProPresenter is on another computer.</strong>
              It contacts every address on the network, may reach a ProPresenter that is
              mid-service, and some networks flag it as suspicious.
              <button type="button" id="config-network-scan-btn" class="btn btn-chip mt-2 block">Search the network anyway</button>
            </span>
          </div>
            <div class="flex items-center gap-2 pt-1">
              <button type="button" class="btn btn-outline btn-sm config-save" data-scope="propresenter">Save</button>
              <span class="text-sm config-save-status" data-scope="propresenter"></span>
            </div>
          </div>
        </details>
        <details class="collapse collapse-arrow bg-base-200 rounded" >
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="database" class="w-4 h-4 opacity-70 shrink-0"></i> Search &amp; indexing
              <span class="text-xs opacity-50 font-normal">scope, arrangements</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
          <label class="label cursor-pointer justify-start gap-2 w-fit">
            <input type="checkbox" id="config-crawl-playlists" class="checkbox checkbox-sm" ${config.librarySync.crawlPlaylists ? "checked" : ""} />
            <span class="label-text">Crawl playlists (not recommended) ${infoIcon("Records which playlists each slide is in. It's the slowest part of a rebuild.")}</span>
          </label>
          <div>
            <label class="form-control w-full max-w-xs">
              <label class="label py-1 px-0" for="config-preferred-arrangements">
                <span class="label-text">Preferred arrangements ${infoIcon("Most important first: \"FS, T\" uses FS when a song has both. Blank uses whatever ProPresenter has selected. Applies at the next rebuild.")}</span>
              </label>
              <input id="config-preferred-arrangements" type="text" placeholder="FS, T" class="input input-bordered input-sm"
                value="${escapeHtml((config.preferredArrangements ?? []).join(", "))}" />
            </label>
            ${
              (configOptions.arrangementNameCandidates ?? []).length
                ? `<div class="text-xs opacity-60 mt-1">
                     Found in your library (click to add):
                     <span class="flex flex-wrap gap-1 mt-1">
                       ${configOptions.arrangementNameCandidates
                         .map(
                           (n) =>
                             `<button type="button" class="btn btn-xs rf-tile config-arrangement-suggestion" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`
                         )
                         .join("")}
                     </span>
                   </div>`
                : `<div class="text-xs opacity-60 mt-1">Build the index to see your arrangement names.</div>`
            }
            <div class="flex items-center gap-2 pt-1">
              <button type="button" class="btn btn-outline btn-sm config-save" data-scope="indexing">Save</button>
              <span class="text-sm config-save-status" data-scope="indexing"></span>
            </div>
          </div>
        </details>
        <details class="collapse collapse-arrow bg-base-200 rounded" >
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="music" class="w-4 h-4 opacity-70 shrink-0"></i> Lyrics
              <span class="text-xs opacity-50 font-normal">splitter, search sites</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
          <label class="form-control w-full max-w-xs">
            <label class="label py-1" for="config-slide-splitter">
              <span class="label-text">Lyrics slide splitter ${infoIcon("How pasted lyrics get cut into slides on the Lyrics screen.")}</span>
            </label>
            <select id="config-slide-splitter" class="select select-bordered select-sm">
              ${selectOptions(configOptions.slideSplitters, config.slideSplitter)}
            </select>
          </label>

          <div>
            <div class="label py-1 px-0">
              <span class="label-text">Lyrics search sites ${infoIcon(`Sites the Search Lyrics button searches. Up to ${configOptions.maxLyricsSites}: more makes results less reliable.`)}</span>
            </div>
            <div class="flex flex-col gap-1 ml-1" id="config-lyrics-sites-list">
              ${configOptions.lyricsSiteCandidates
                .map(
                  (site) => `
                <label class="label cursor-pointer justify-start gap-2 w-fit">
                  <input type="checkbox" class="checkbox checkbox-sm config-lyrics-site-checkbox" value="${escapeHtml(site)}" ${config.lyricsSites.includes(site) ? "checked" : ""} />
                  <span class="label-text">${escapeHtml(site)}</span>
                </label>
              `
                )
                .join("")}
            </div>
            <div id="config-lyrics-sites-hint" class="text-xs text-warning mt-1 hidden" data-max="${configOptions.maxLyricsSites}">
              You can pick at most ${configOptions.maxLyricsSites}.
            </div>
          </div>
            <div class="flex items-center gap-2 pt-1">
              <button type="button" class="btn btn-outline btn-sm config-save" data-scope="lyrics">Save</button>
              <span class="text-sm config-save-status" data-scope="lyrics"></span>
            </div>
          </div>
        </details>
        <details class="collapse collapse-arrow bg-base-200 rounded" ${featureOn("qr-code") ? "" : "hidden"}>
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="qr-code" class="w-4 h-4 opacity-70 shrink-0"></i> QR codes
              <span class="text-xs opacity-50 font-normal">defaults</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
          <div class="text-sm font-semibold">QR Codes</div>
          <div class="flex flex-wrap gap-3">
            <label class="form-control w-full max-w-xs">
              <label class="label py-1" for="config-qr-base-url">
                <span class="label-text">Default base URL ${infoIcon("Pre-fills the URL on the QR Codes screen.")}</span>
              </label>
              <input id="config-qr-base-url" type="text" class="input input-bordered input-sm" placeholder="https://yourchurch.org" value="${escapeHtml(config.qrCodeModule?.defaultBaseUrl ?? "")}" />
            </label>
            <label class="form-control w-full max-w-xs">
              <label class="label py-1" for="config-qr-logo-url">
                <span class="label-text">Default logo ${infoIcon("A path like img/logo.png, or a full URL. Change it per code.")}</span>
              </label>
              <input id="config-qr-logo-url" type="text" class="input input-bordered input-sm" placeholder="img/mylogo.png" value="${escapeHtml(config.qrCodeModule?.defaultLogoUrl ?? "")}" />
            </label>
            <label class="form-control w-full max-w-xs">
              <label class="label py-1" for="config-qr-recent-limit">
                <span class="label-text">Recent codes to keep ${infoIcon("Kept for one-click reuse. 0 turns the list off. Max 100.")}</span>
              </label>
              <input id="config-qr-recent-limit" type="number" min="0" max="100" step="1" class="input input-bordered input-sm w-28" value="${config.qrCodeModule?.recentLimit ?? 20}" />
            </label>
            <label class="form-control w-full max-w-xs">
              <label class="label py-1" for="config-qr-default-size">
                <span class="label-text">Default QR size (px) ${infoIcon("Blank for 512. Change it per code.")}</span>
              </label>
              <input id="config-qr-default-size" type="number" min="64" max="2000" step="1" class="input input-bordered input-sm w-28" placeholder="512" value="${config.qrCodeModule?.defaultSize ?? ""}" />
            </label>
          </div>
            <div class="flex items-center gap-2 pt-1">
              <button type="button" class="btn btn-outline btn-sm config-save" data-scope="qr">Save</button>
              <span class="text-sm config-save-status" data-scope="qr"></span>
            </div>
          </div>
        </details>
        <details class="collapse collapse-arrow bg-base-200 rounded" ${featureOn("arrangement") ? "" : "hidden"}>
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="git-compare" class="w-4 h-4 opacity-70 shrink-0"></i> Arrangement tracking
              <span class="text-xs opacity-50 font-normal">provider, storage</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
          <div class="flex flex-wrap gap-3">
            <label class="form-control w-full max-w-xs">
              <label class="label py-1" for="config-arrangement-provider">
                <span class="label-text">Provider ${infoIcon("Where the planned arrangement comes from. Manual means you type it in.")}</span>
              </label>
              <select id="config-arrangement-provider" class="select select-bordered select-sm">
                ${selectOptions(configOptions.providers, arrangementModule.provider ?? "manual")}
              </select>
            </label>
            <label class="form-control w-full max-w-xs">
              <label class="label py-1" for="config-arrangement-storage">
                <span class="label-text">Storage ${infoIcon("Where history is saved. A local folder stays on this computer. The others share it and need .env credentials.")}</span>
              </label>
              <select id="config-arrangement-storage" class="select select-bordered select-sm">
                ${selectOptions(configOptions.storageBackends, arrangementModule.storageBackend ?? "local-folder")}
              </select>
            </label>
          </div>

          <div id="config-planning-center-service-type-wrap" class="${arrangementModule.provider === "planning-center" ? "" : "hidden"}">
            <label class="form-control w-full max-w-xs">
              <label class="label py-1" for="config-planning-center-service-type">
                <span class="label-text">Planning Center Service Type ID ${infoIcon("Which service type to pull plans from. Always takes the most recent past plan, so it never needs updating.")}</span>
              </label>
              <input id="config-planning-center-service-type" type="text" class="input input-bordered input-sm" placeholder="574087 or https://services.planningcenteronline.com/service_types/574087" value="${escapeHtml(arrangementModule.planningCenterServiceTypeId ?? "")}" />
            </label>
          </div>

          <div id="config-storage-path-wrap" class="${["local-folder", "synced-folder"].includes(arrangementModule.storageBackend ?? "local-folder") ? "" : "hidden"}">
            <label class="form-control w-full max-w-md">
              <label class="label py-1" for="config-storage-path">
                <span class="label-text">Folder path ${infoIcon("Blank for a folder inside Refrain. For a synced folder, pick your Drive or Dropbox folder.")}</span>
              </label>
              <div class="flex gap-2">
                <input id="config-storage-path" type="text" class="input input-bordered input-sm flex-1" placeholder="./data/arrangements" value="${escapeHtml(arrangementModule.localFolderPath ?? "")}" />
                <button type="button" id="detect-storage-path-btn" class="btn btn-outline btn-sm ${arrangementModule.storageBackend === "synced-folder" ? "" : "hidden"}">Auto-detect</button>
              </div>
              <div id="detect-storage-path-result" class="text-xs mt-1"></div>
            </label>
          </div>

            <div class="flex items-center gap-2 pt-1">
              <button type="button" class="btn btn-outline btn-sm config-save" data-scope="arrangement">Save</button>
              <span class="text-sm config-save-status" data-scope="arrangement"></span>
            </div>
          </div>
        </details>
        ${featureOn("service") ? renderDaySummarySection(health) : ""}
        ${renderEnvSection(envRequirements, envEntryList)}
      </div>
  `;

  const latest = versionInfo?.latestVersion;
  const updatesCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="refresh-cw" class="w-4 h-4 opacity-70"></i> Updates</h2>
        <div class="text-sm opacity-70">
          Installed: <span class="font-mono">v${escapeHtml(version)}</span>
          &middot; Latest: <span class="font-mono">${latest ? "v" + escapeHtml(latest) : "couldn't check"}</span>
        </div>
        ${
          versionInfo?.updateAvailable
            ? `<div class="badge badge-info gap-1"><i data-lucide="arrow-up-circle" class="w-3 h-3"></i> Update available</div>`
            : latest
              ? `<div class="badge badge-success gap-1"><i data-lucide="check-circle-2" class="w-3 h-3"></i> Up to date</div>`
              : ""
        }
        ${
          versionInfo?.gitInstall
            ? `<div class="flex flex-wrap items-center gap-2 mt-1">
                 <button id="update-now-btn" class="btn btn-outline btn-sm">Update now</button>
                 <button id="update-recheck-btn" class="btn btn-chip">Check again</button>
                 <span id="update-status" class="text-sm"></span>
               </div>
               <div class="text-xs opacity-60 rf-measure">Or double-click <span class="font-mono">scripts/update.command</span>. Restart Refrain afterward.</div>`
            : `<div class="text-sm mt-1">To update, download the latest ZIP from <a href="${escapeHtml(versionInfo?.repoUrl ?? "")}" target="_blank" rel="noopener" class="link">GitHub</a> and copy your <span class="font-mono">config.json</span> and <span class="font-mono">.env</span> into it.</div>`
        }
        ${commandRow("Update by hand", "If the Update button doesn't work. Restart Refrain afterwards. Your settings are kept.", updateCommand(installDir))}
      </div>
    </div>
  `;

  // Status is scanned, not read: three tiles answer "is it working" at a glance,
  // and the detail that used to fill three full cards now hangs off them.
  const modules = summarizeModules(health);
  // What is on the screens, for when something looks wrong (owner, 2026-10-07:
  // it left the Search and Now pages, where it sat in the way). The same lit
  // face, polled by the same one poll.
  const readoutCard = `
    <div>
      <div id="settings-readout" class="rf-readout" data-mode="standby"></div>
      <p class="rf-readout-none text-sm opacity-70">Nothing on the screens to show: ProPresenter isn't answering.</p>
    </div>`;
  // The health check: filled from this render's data, then kept current by the
  // poll in wireHealthCheck().
  const statusStrip = `
    <div class="flex flex-col gap-2">
      <h3 class="rf-silkscreen">Health check</h3>
      <div id="health-check" class="flex flex-col gap-2" data-host="${escapeHtml(propresenter.host ?? "")}" data-port="${escapeHtml(String(propresenter.port ?? ""))}">${healthCheckHtml({
        connected: propresenter.connected,
        host: propresenter.host,
        port: propresenter.port,
        feed: health.feed ?? "off",
        armed: Boolean(health.performanceMode?.armed),
        indexBuiltAt: index.builtAt ?? null,
        indexCount: index.presentationCount ?? 0,
        modules,
      })}</div>
    </div>`;

  // One row per feature: its name, one short line, and a switch. The longer
  // sentence is the tooltip. Search and Spell Check are rows with no switch, so
  // the list says what is always on without a paragraph.
  const featureRow = (f) => `
        <div class="rf-feature-row" title="${escapeHtml(f.description)}">
          <div class="rf-feature-text"><b>${escapeHtml(f.label)}</b><span>${escapeHtml(f.summary || f.description)}</span></div>
          <button type="button" role="switch" class="rf-switch" data-feature="${escapeHtml(f.id)}" data-on="${!f.on}" aria-checked="${f.on}" aria-label="${escapeHtml(f.label)}"></button>
        </div>`;
  const fixedRow = (name, line) => `
        <div class="rf-feature-row"><div class="rf-feature-text"><b>${name}</b><span>${line}</span></div><span class="rf-feature-fixed">Always</span></div>`;
  const featuresCard = `
    <div class="rf-features">
      <p class="rf-feature-lede">Search and Spell Check are always on. Turn on only what your team uses; each one adds a key.</p>
      <h3 class="rf-silkscreen">Always on</h3>
      ${fixedRow("Search", "Find a slide and send it")}
      ${fixedRow("Spell Check", "Spelling, dates, media")}
      <h3 class="rf-silkscreen">Optional</h3>
      ${features.map(featureRow).join("")}
      <div id="features-status" class="text-sm" role="status"></div>
    </div>`;

  // Protect ProPresenter (owner, 2026-10-04, after the main station's
  // ProPresenter was damaged overnight). Tucked at the end of Search, closed:
  // turning it off is a deliberate act, and says what it lets Refrain do.
  const protectCard = `
    <details id="protect-details" class="collapse collapse-arrow bg-base-200 rounded">
      <summary class="collapse-title min-h-0 py-2">
        <span class="flex items-center gap-2 text-sm font-medium"><i data-lucide="shield" class="w-4 h-4 opacity-70 shrink-0"></i> Advanced
          <span class="text-xs opacity-60 font-normal">${health.protectProPresenter ? "Protect ProPresenter is on" : "Protect ProPresenter is OFF"}</span></span>
      </summary>
      <div class="collapse-content flex flex-col gap-2">
        <div class="rf-tabs" role="radiogroup" aria-label="Protect ProPresenter" style="margin-bottom:0">
          <button type="button" role="radio" class="rf-tab" data-protect="true" aria-checked="${health.protectProPresenter === true}"><span>Protect ProPresenter</span></button>
          <button type="button" role="radio" class="rf-tab" data-protect="false" aria-checked="${health.protectProPresenter !== true}"><span>Allow library reads</span></button>
        </div>
        <p class="text-sm rf-measure">On (recommended): Refrain never reads presentations from ProPresenter in bulk. No index runs, automatic or pressed; no Spell Check, pre-service checks or Update pictures. Search uses the index it has; Go Live, Now and Clear work as always.</p>
        <p class="text-xs opacity-70 rf-measure">Off lets those run again. Each presentation read costs ProPresenter about 10 MB until it restarts, and a whole-library read is the heaviest thing Refrain does. Only on a machine where that's safe, never near a service, and restart ProPresenter afterwards.</p>
        <div id="protect-status" class="text-sm" role="status"></div>
      </div>
    </details>`;

  // The kill switch (GitHub issue #15). On Status, where Settings always
  // opens, so someone stressed lands on it. Amber, the Settings colour for
  // "needs a hand", not red: a red card on a health screen reads as a fault
  // every time anyone opens it. The out-of-app line is always visible,
  // because a page that's stuck is exactly when this button can't help.
  const killCard = `
    <div id="kill-card" class="card bg-base-200 rf-kill">
      <div class="card-body p-3 gap-2">
        <h2 class="card-title text-base">Stop Refrain</h2>
        <p class="text-sm rf-measure">If the booth feels slow, this stops Refrain at once. ProPresenter and the screens aren't touched.</p>
        <p class="text-xs opacity-70 rf-measure">If this page isn't responding, use the Stream Deck key or Terminal instead.</p>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" id="kill-reveal" class="btn btn-outline btn-sm rf-kill-reveal">Stop Refrain</button>
          <button type="button" id="kill-confirm" class="btn btn-sm rf-kill-confirm hidden">Kill</button>
          <span id="kill-status" class="text-sm" role="status" aria-live="polite"></span>
        </div>
      </div>
    </div>`;

  // How Refrain looks here (owner, 2026-09-30). Choices, not a button that
  // cycles: the old "Theme: System" button said where you were, not what
  // pressing it would do. The menu owns these settings (nav.js, `display`).
  const choice = (group, value, label, swatch = "") =>
    `<button type="button" role="radio" class="rf-tab" data-display="${group}" data-value="${value}" aria-checked="false">${swatch}<span>${label}</span></button>`;
  // Sized inline, not by utility class: a class that exists only in a JS
  // string may get no Tailwind rule in time (CLAUDE.md).
  const swatch = (bg) => `<span style="width:12px;height:12px;border-radius:2px;flex:none;background:${bg};box-shadow:inset 0 0 0 1px rgba(128,128,128,.5)"></span>`;
  const displayCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3 gap-3">
        <h2 class="card-title text-base">Display</h2>
        <div class="flex flex-col gap-1">
          <div class="rf-silkscreen">Theme</div>
          <div class="rf-tabs" role="radiogroup" aria-label="Theme" style="margin-bottom:0">
            ${choice("theme", "system", "System", swatch("linear-gradient(135deg,#f4f2f6 50%,#16121c 50%)"))}
            ${choice("theme", "light", "Light", swatch("#f4f2f6"))}
            ${choice("theme", "dark", "Dark", swatch("#16121c"))}
            ${choice("theme", "blackroom", "Blackroom", swatch("#000"))}
          </div>
        </div>
        <div class="flex gap-6 flex-wrap">
          <div class="flex flex-col gap-1">
            <div class="rf-silkscreen">Menu side</div>
            <div class="rf-tabs" role="radiogroup" aria-label="Menu side" style="margin-bottom:0">${choice("side", "left", "Left")}${choice("side", "right", "Right")}</div>
          </div>
        </div>
        <button type="button" id="settings-shortcuts-btn" class="btn btn-outline btn-sm w-fit">Keyboard shortcuts</button>
        ${commandRow("Open in its own window", "Chrome with no tabs or address bar, to dock beside ProPresenter. It opens 420 wide if Chrome is closed; otherwise drag it narrow.", appModeCommand(port))}
      </div>
    </div>`;
  const welcomeCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3 gap-2">
        <h2 class="card-title text-base">Welcome</h2>
        <div class="text-sm opacity-70 rf-measure">The three things a new volunteer needs on a Sunday.</div>
        <button type="button" id="settings-welcome-btn" class="btn btn-outline btn-sm w-fit">Show the welcome card</button>
      </div>
    </div>`;

  // Settings is Health's cards on five tabs (handoff section 40). Every card
  // is rendered, so every card's wiring below finds its elements; the tabs
  // only show one group at a time.
  // Each tab opens with its own name, one step below the page title.
  // The second row under More: Phones, Customize, Telemetry, Audit.
  const subRow = () =>
    `<div data-settings-subrow class="rf-tabs" role="tablist" aria-label="More settings" style="margin-bottom:0">${SETTINGS_TABS.filter(([t]) => SETTINGS_MORE.includes(t))
      .map(([id, label, icon]) => `<button type="button" role="tab" aria-controls="settings-panel-${id}" class="rf-tab" data-settings-tab="${id}" aria-selected="false" tabindex="-1"><i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i><span>${label}</span></button>`)
      .join("")}</div>`;
  const panel = (id, ...cards) =>
    `<div data-settings-panel="${id}" id="settings-panel-${id}" role="tabpanel" aria-label="${SETTINGS_TABS.find(([t]) => t === id)[1]}" class="flex flex-col gap-4">${SETTINGS_MORE.includes(id) ? subRow() : ""}<h2 class="rf-visually-hidden">${SETTINGS_TABS.find(([t]) => t === id)[1]}</h2>${cards.join("")}</div>`;
  return `
    <div class="flex flex-col gap-4">
      <div id="settings-tabs" class="rf-tabs" role="tablist" aria-label="Settings" style="margin-bottom:0">
        ${SETTINGS_TOP.map(([id, label, icon], i) => `<button type="button" role="tab" id="settings-top-${id}" class="rf-tab" data-settings-top="${id}" aria-selected="false" tabindex="-1"><i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i><span>${label}</span><kbd class="kbd kbd-xs tab-key" aria-hidden="true">${i + 1}</kbd></button>`).join("")}
      </div>
      ${panel("status", readoutCard, statusStrip)}
      ${
        // While a run is going, the index card comes first (owner,
        // 2026-10-04: its messages were far below the libraries list).
        health.index?.rebuild?.inProgress ? panel("search", indexCard, libraryCard, protectCard) : panel("search", libraryCard, indexCard, protectCard)
      }
      ${panel("features", featuresCard, configCard, featureOn("arrangement") ? arrangementCard : "")}
      ${panel("phones", phoneCard, picturesCard)}
      ${panel("customize", displayCard, welcomeCard, autostartCard)}
      ${panel("telemetry", telemetryCard)}
      ${panel("system", killCard, propresenterCard, updatesCard)}
      ${panel("audit", duplicateNamesCard, preferredCard, themesCard, orphanedMediaCard)}
      <div class="text-xs opacity-50 text-center mt-2 flex flex-col items-center gap-1">
        <div>
          Panel textures by
          <a href="https://www.toptal.com/designers/subtlepatterns/" target="_blank" rel="noopener" class="link">Atle Mo</a>
          and
          <a href="https://www.toptal.com/designers/subtlepatterns/noisy-net/" target="_blank" rel="noopener" class="link">Tom McArdle</a>,
          <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener" class="link">CC BY-SA 3.0</a>.
        </div>
        <div>
          Refrain v${version} &middot; role: ${role ?? "unset"}
          ${
            versionInfo?.repoUrl
              ? ` &middot; <a href="${escapeHtml(versionInfo.repoUrl)}" target="_blank" rel="noopener" class="link inline-flex items-center gap-1"><i data-lucide="github" class="w-3 h-3"></i>GitHub</a>`
              : ""
          }
        </div>
        ${
          versionInfo?.updateAvailable
            ? `<a href="${escapeHtml(versionInfo.repoUrl)}" target="_blank" rel="noopener" class="badge badge-info badge-sm gap-1">
                <i data-lucide="arrow-up-circle" class="w-3 h-3"></i> v${escapeHtml(versionInfo.latestVersion)} available
              </a>`
            : ""
        }
      </div>
    </div>
  `;
}
