/**
 * The day summary End writes (handoff section 37, phase 4; issue #3).
 *
 * Everything a production meeting wants from the day, in one Markdown file
 * that reads well printed, pasted, or opened in any editor: the timing
 * rundown per service, flags by service and type, the pre-service checks
 * that needed a look, steps that were skipped, and arrangement drift. Pure:
 * index.js gathers the pieces.
 */

const fmtDuration = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  const t = Math.round(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};
const fmtClock = (ms, tz) =>
  Number.isFinite(ms) ? new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", ...(tz ? { timeZone: tz } : {}) }) : "–";
// Markdown table cells: a pipe or newline in a song title must not break the table.
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/**
 * Which service each flag fell in: the service whose item was on screen when
 * it was captured. A flag outside every recorded stretch is "not in a
 * service", which is honest rather than guessed.
 */
export function flagsByService(flags, state) {
  const out = new Map();
  const add = (key, f) => (out.get(key) ?? out.set(key, []).get(key)).push(f);
  const segs = [...state.segments, ...(state.openItem ? [{ ...state.openItem, endMs: Infinity }] : [])];
  for (const f of flags ?? []) {
    const t = Date.parse(f.capturedAt);
    const seg = segs.find((g) => t >= g.startMs && t <= g.endMs);
    add(seg?.serviceId ?? null, f);
  }
  return out;
}

function rundownTable(rows, tz) {
  if (!rows.length) return "_Nothing went live._\n";
  const lines = ["| # | Item | Live at | On screen | Gap before |", "|---|---|---|---|---|"];
  for (const r of rows) {
    lines.push(`| ${r.position ?? "+"} | ${cell(r.name)}${r.offPlan ? " _(off-plan)_" : ""} | ${fmtClock(r.firstLive, tz)} | ${fmtDuration(r.onScreenMs)} | ${r.gapBeforeMs == null ? "–" : fmtDuration(r.gapBeforeMs)} |`);
    for (const x of r.returns ?? []) lines.push(`|  | ↺ back again | ${fmtClock(x.at, tz)} | ${fmtDuration(x.onScreenMs)} |  |`);
  }
  return lines.join("\n") + "\n";
}

function flagsList(flags) {
  if (!flags?.length) return "No flags.\n";
  const byType = new Map();
  for (const f of flags) (byType.get(f.type ?? "No type") ?? byType.set(f.type ?? "No type", []).get(f.type ?? "No type")).push(f);
  const lines = [];
  for (const [type, list] of byType) {
    lines.push(`- **${cell(type)}** (${list.length})`);
    for (const f of list) {
      const slide = Number.isInteger(f.slideIndex) ? `, slide ${f.slideIndex + 1}` : "";
      lines.push(`  - ${cell(f.presentationName ?? "Untitled")}${slide}${f.note ? `: ${cell(f.note)}` : ""}${f.resolved ? " _(resolved)_" : ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * @param {object} p
 * @param {string} p.day                YYYY-MM-DD
 * @param {Array}  p.services           [{ serviceId, name, startsAt, summary: { startedAt, runMs, items }, rows }]
 * @param {Array}  p.outside            rows recorded outside any service
 * @param {Map}    p.flags              serviceId|null -> flags
 * @param {Map}    p.checks             serviceId -> { at, results }
 * @param {Array}  p.skipped            [{ phase, service, step }]
 * @param {object} p.drift              { ran: boolean, reason?, results?, unmatched? }
 * @param {boolean} p.reopened
 * @param {number} p.endedAt
 * @param {string} [p.timeZone]         for tests; defaults to the machine's
 */
export function renderDaySummary({ day, services, outside, flags, checks, skipped, drift, reopened, endedAt, timeZone }) {
  const tz = timeZone;
  const out = [];
  const dayLabel = new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  out.push(`# ${dayLabel}\n`);
  out.push(`Ended ${fmtClock(endedAt, tz)}.${reopened ? " The day was picked up again after an earlier End, so this replaces that summary." : ""} Times are when Refrain first saw each item, within a few seconds.\n`);

  const ran = services.filter((s) => s.summary?.items);
  const first = ran[0];
  for (const s of services) {
    out.push(`## ${cell(s.name)}${s.startsAt ? ` (${fmtClock(s.startsAt, tz).replace(/:00 /, " ")})` : ""}\n`);
    const sum = s.summary ?? {};
    if (sum.items) {
      let line = `Started ${fmtClock(sum.startedAt, tz)}, ran ${fmtDuration(sum.runMs)}, ${sum.items} item${sum.items === 1 ? "" : "s"}.`;
      if (first && first.serviceId !== s.serviceId && first.summary?.items) {
        const diff = sum.runMs - first.summary.runMs;
        if (Math.abs(diff) >= 30_000) line += ` ${fmtDuration(Math.abs(diff))} ${diff > 0 ? "longer" : "shorter"} than ${cell(first.name)}.`;
      }
      out.push(line + "\n");
    }
    out.push(rundownTable(s.rows ?? [], tz));
    out.push(`**Flags**\n\n${flagsList(flags.get(s.serviceId))}`);
    const run = checks.get(s.serviceId);
    if (!run) {
      out.push("**Pre-service checks:** not run.\n");
    } else {
      const notPass = run.results.filter((r) => r.status !== "pass");
      out.push(
        notPass.length
          ? `**Pre-service checks** (run ${fmtClock(run.at, tz)}):\n\n${notPass.map((r) => `- ${r.status === "couldnt" ? "Couldn't check" : "Needs a look"}: ${cell(r.label)}. ${cell(r.summary)}`).join("\n")}\n`
          : `**Pre-service checks** (run ${fmtClock(run.at, tz)}): all clear.\n`
      );
    }
  }

  if (outside?.length || flags.get(null)?.length) {
    out.push(`## Not in a service\n`);
    if (outside?.length) out.push(rundownTable(outside, tz));
    if (flags.get(null)?.length) out.push(`**Flags**\n\n${flagsList(flags.get(null))}`);
  }

  out.push(`## Arrangements\n`);
  if (!drift?.ran) {
    out.push(`Not compared: ${drift?.reason ?? "not run"}.\n`);
  } else {
    const differs = (drift.results ?? []).filter((r) => r.diff && (r.diff.skipped?.length || r.diff.added?.length || r.diff.reordered?.length) && !r.ignored);
    const compared = (drift.results ?? []).length;
    const planName = drift.plan?.dates ? ` (${cell(drift.plan.dates)})` : "";
    out.push(
      !compared
        ? `None of the songs shown were in the most recent plan${planName}, so nothing was compared.\n`
        : differs.length
          ? `${differs.length} song${differs.length === 1 ? "" : "s"} played differently from the plan${planName}. Nothing was pushed back; review them on the Arrangement screen.\n\n${differs.map((r) => `- ${cell(r.presentationName ?? r.title)}: ${cell(r.suggestion ?? "differs")}`).join("\n")}\n`
          : `Every song shown matched the plan${planName} (${compared} compared).\n`
    );
    if (drift.unmatched?.length) out.push(`Not compared: ${drift.unmatched.map((u) => cell(u.title)).join(", ")}.\n`);
  }

  out.push(`## Checklist\n`);
  out.push(skipped?.length ? `Not ticked:\n\n${skipped.map((s) => `- ${cell(s.phase)}${s.service ? ` (${cell(s.service)})` : ""}: ${cell(s.step)}`).join("\n")}\n` : "Every step was ticked.\n");

  return out.join("\n");
}
