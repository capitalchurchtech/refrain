/**
 * Assembles the crash report the operator copies.
 *
 * Nothing is sent anywhere. The surface shows the report and offers one button
 * that copies it; the operator pastes it where they like. That deletes the
 * whole risk surface an emailing reporter would have needed -- no SMTP, no
 * credentials, no recipient config, no endpoint to protect, no crash-loop mail
 * storm -- and it leaves the README's "no telemetry" claim untouched rather
 * than merely defensible.
 *
 * It also works where a mailer could not: a mailer cannot report the crash that
 * killed the server, or anything at all with the network down, which is often
 * exactly why things broke.
 *
 * **Assembling a report must never throw.** A reporter that crashes inside an
 * error handler turns a recoverable error into a dead app, and it is the joke
 * that writes itself. Every field is individually guarded and the whole thing
 * is wrapped, so a circular object in an error payload costs that one line
 * rather than the report.
 *
 * Fields are ordered by whether someone could fix the bug without them, so the
 * commit leads and the counts trail.
 */

import { readCrumbs } from "./breadcrumbs.js";

/** Never let one bad field cost the report. */
function attempt(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

/**
 * Serialises anything without throwing on a cycle.
 *
 * An error payload can carry a DOM node or a request object with a circular
 * reference, and plain JSON.stringify would throw -- inside the error handler,
 * which is the worst possible place.
 */
function safeJson(value, space = 0) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (_k, v) => {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[circular]";
          seen.add(v);
        }
        if (typeof v === "function") return "[function]";
        if (typeof v === "bigint") return String(v);
        return v;
      },
      space
    );
  } catch {
    return null;
  }
}

/** Pulls what can be pulled off an unknown thrown value. */
export function describeError(err) {
  return {
    class: attempt(() => err?.constructor?.name, null) ?? typeof err,
    message: attempt(() => String(err?.message ?? err), "(no message)"),
    stack: attempt(() => (typeof err?.stack === "string" ? err.stack : null), null),
  };
}

/**
 * Builds the report as plain text, ready to paste into an email or an agent
 * session in one action.
 *
 * A single block rather than a structured payload, because the person
 * receiving it is going to paste it somewhere that reads text.
 */
export function buildCrashReport(input = {}) {
  return (
    attempt(() => {
      const {
        error,
        side = "client",
        route = attempt(() => location.hash || "#search", "(unknown)"),
        build = {},
        state = {},
        occurrence = 1,
        now = new Date(),
      } = input;

      const e = describeError(error);
      const lines = [];

      lines.push("Refrain crash report");
      lines.push(`when       ${attempt(() => now.toISOString(), "(unknown)")}`);
      lines.push(`version    ${build.version ?? "(unknown)"}`);
      lines.push(`commit     ${build.commit ?? "(unknown, not a git install)"}`);
      if (build.branch) lines.push(`branch     ${build.branch}`);
      lines.push(`side       ${side}`);
      lines.push(`route      ${route}`);
      lines.push(`occurrence ${occurrence}`);
      lines.push("");

      lines.push(`error      ${e.class}: ${e.message}`);
      if (e.stack) {
        lines.push("stack");
        for (const l of String(e.stack).split("\n").slice(0, 24)) lines.push(`  ${l.trim()}`);
      }
      lines.push("");

      const stateKeys = attempt(() => Object.keys(state), []) ?? [];
      if (stateKeys.length) {
        lines.push("state");
        for (const k of stateKeys) {
          lines.push(`  ${k.padEnd(16)} ${attempt(() => String(state[k]), "(unreadable)")}`);
        }
        lines.push("");
      }

      const trail = attempt(() => readCrumbs(), []) ?? [];
      lines.push(`what led to it (${trail.length} steps, newest last)`);
      if (!trail.length) {
        lines.push("  (nothing recorded)");
      } else {
        for (const c of trail) {
          const { ago, action, ...rest } = c;
          const extras = Object.entries(rest)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
          lines.push(`  -${String(ago).padStart(5)}s  ${action}${extras ? "  " + extras : ""}`);
        }
      }
      lines.push("");
      lines.push("No slide text, search terms or presentation names are included by design.");

      return lines.join("\n");
    }, null) ??
    // Absolute floor: if even the guarded assembly failed, say so rather than
    // handing the operator an empty box.
    `Refrain crash report\n(the report could not be assembled)\nerror ${attempt(
      () => String(input?.error?.message ?? input?.error),
      "(unknown)"
    )}`
  );
}

/** A one-line title, so it is scannable in an inbox or a chat. */
export function crashSubject({ error, route } = {}) {
  const e = describeError(error);
  const screen = attempt(() => String(route ?? location.hash ?? "").replace("#", ""), "") || "app";
  return `Refrain crash · ${screen} · ${e.class}`;
}

/** Everything the report wants to know about how the app was set up. */
export function collectState() {
  return {
    theme: attempt(() => document.documentElement.dataset.theme, null),
    blackroom: attempt(() => document.documentElement.classList.contains("blackroom"), null),
    viewport: attempt(() => `${window.innerWidth}x${window.innerHeight}`, null),
    railPinned: attempt(() => !document.getElementById("nav-rail")?.classList.contains("collapsed"), null),
    online: attempt(() => navigator.onLine, null),
    userAgent: attempt(() => navigator.userAgent, null),
  };
}

export { safeJson };
