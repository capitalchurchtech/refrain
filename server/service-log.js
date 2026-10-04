/**
 * What Refrain was doing, written to its own log while it matters (issue #13).
 *
 * On 27 Sep ProPresenter beachballed during a sermon, Refrain was quit, and its
 * log had gained nothing in 100 minutes. Nobody could say whether Refrain was
 * involved, which is the worst answer for the tool an operator suspects first.
 * So during a service (or whenever performance mode is on) Refrain writes one
 * line a minute: how often it is asking ProPresenter, how those calls are
 * going, how Refrain itself is doing, and how ProPresenter's own process looks.
 * Anything out of the ordinary (a slow call, a stall) gets its own line at
 * once.
 *
 * **Local only.** These lines go to Refrain's own log file on this machine and
 * nowhere else. No telemetry: see the README.
 *
 * Everything here is pure, so the numbers and the wording are testable; the
 * timers and the `ps` call live in index.js.
 */

/** Which kind of ProPresenter call a path is, for counting. */
export function classifyCall(path, method = "GET") {
  const p = String(path ?? "");
  // Reading the stage message is a look, not a press; showing or taking it
  // down is a press.
  if (p === "/v1/stage/message") return String(method).toUpperCase() === "GET" ? "status" : "control";
  if (p.startsWith("/v1/status/") || p === "/v1/presentation/slide_index") return "status";
  if (/\/thumbnail\//.test(p)) return "thumbnail";
  if (/\/(trigger|focus)$/.test(p) || p.startsWith("/v1/clear/") || /\/clear$/.test(p)) return "control";
  if (/^\/v1\/presentation\/[^/]+$/.test(p)) return "document";
  if (p.startsWith("/v1/librar") || p.startsWith("/v1/playlist") || p === "/v1/themes") return "library";
  return "other";
}

/** Counts ProPresenter calls by kind; `take()` returns the totals and starts again. */
export function createCallStats() {
  let kinds = {};
  return {
    record({ kind, ms, ok, timedOut }) {
      const k = (kinds[kind] ??= { n: 0, totalMs: 0, maxMs: 0, failed: 0, timedOut: 0 });
      k.n += 1;
      k.totalMs += ms;
      k.maxMs = Math.max(k.maxMs, ms);
      if (!ok) k.failed += 1;
      if (timedOut) k.timedOut += 1;
    },
    take() {
      const out = kinds;
      kinds = {};
      return out;
    },
  };
}

/**
 * ProPresenter's main process and its helpers, from `ps -Ao pid,%cpu,rss,comm`.
 * Null when it isn't running (or isn't on this machine).
 */
export function parseProPresenterPs(stdout) {
  let main = null;
  const helpers = { cpu: 0, rssMB: 0, count: 0 };
  for (const line of String(stdout ?? "").split("\n")) {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const [, pid, cpu, rssKB, comm] = m;
    if (/ProPresenter\.app\/Contents\/MacOS\/ProPresenter$/.test(comm) || comm === "ProPresenter") {
      main = { pid: Number(pid), cpu: Number(cpu), rssMB: Math.round(Number(rssKB) / 1024) };
    } else if (/ProPresenter Helper/.test(comm)) {
      helpers.cpu += Number(cpu);
      helpers.rssMB += Math.round(Number(rssKB) / 1024);
      helpers.count += 1;
    }
  }
  return main ? { ...main, helpers } : null;
}

/**
 * What Refrain has asked of this run of ProPresenter, counted per distinct
 * thing. Measured on 21.x (2026-09-27): ProPresenter keeps memory for every
 * presentation document read through its API (~10 MB each) and every slide
 * picture drawn (~1-2 MB each at the size Refrain asks for), until it
 * restarts. Asking again for the same one costs almost nothing. So an index
 * crawl of 670 documents on a service morning can add several GB before the
 * first song. Reset when ProPresenter's process changes.
 */
export function createAskedCounter() {
  let pid = null;
  let documents = new Set();
  let pictures = new Set();
  return {
    note(path) {
      const doc = String(path).match(/^\/v1\/presentation\/([^/]+)$/);
      if (doc && doc[1] !== "slide_index") documents.add(doc[1]);
      const pic = String(path).match(/^\/v1\/presentation\/([^/]+)\/thumbnail\/(\d+)/);
      if (pic) pictures.add(`${pic[1]}:${pic[2]}`);
    },
    /** Starts again when a different ProPresenter process is running. */
    seen(processId) {
      if (processId != null && processId !== pid) {
        if (pid != null) {
          documents = new Set();
          pictures = new Set();
        }
        pid = processId;
      }
    },
    counts() {
      return { documents: documents.size, pictures: pictures.size };
    },
  };
}

export const LOAD_DEFAULTS = {
  // Share of this Mac's memory ProPresenter can use before it's worth saying.
  memoryShare: 0.5,
  // Average CPU over the recent samples (100% = one core) before it's worth saying.
  busyCpu: 150,
  busySamples: 5,
  // Presentation documents read since ProPresenter started (≈10 MB each).
  heavyDocuments: 150,
};

const gb = (mb) => `${(mb / 1024).toFixed(mb >= 10 * 1024 ? 0 : 1)} GB`;

/**
 * A sentence for Health and Service when ProPresenter itself is heavy, or null.
 * `samples` are recent parseProPresenterPs results, oldest first.
 *
 * About ProPresenter, not Refrain: ProPresenter's memory grows as it is used
 * (clicking around, imports) and a long service day can carry it into the
 * beachball. Refrain can see that coming on the same machine and say so while
 * there's still a gap between services to restart it.
 */
export function propresenterLoadNotice(samples, totalMemMB, opts = {}) {
  const { memoryShare, busyCpu, busySamples, heavyDocuments } = { ...LOAD_DEFAULTS, ...opts };
  const recent = (samples ?? []).filter(Boolean);
  const last = recent.at(-1);
  if (!last) return null;
  const asked = opts.asked;
  if (totalMemMB && last.rssMB >= totalMemMB * memoryShare) {
    return {
      level: "attention",
      kind: "memory",
      message: `ProPresenter is using ${gb(last.rssMB)} of this Mac's ${gb(totalMemMB)}. If it's slowing down, restart it between services.`,
    };
  }
  if (asked && asked.documents >= heavyDocuments) {
    return {
      level: "attention",
      kind: "documents",
      message: `Refrain has read ${asked.documents} presentations through this ProPresenter (indexing), and ProPresenter holds on to memory for each until it restarts. Restart ProPresenter before the service if you can.`,
    };
  }
  const window = recent.slice(-busySamples);
  if (window.length >= busySamples) {
    const avg = window.reduce((t, s) => t + s.cpu, 0) / window.length;
    if (avg >= busyCpu) {
      return {
        level: "attention",
        kind: "cpu",
        message: `ProPresenter has been very busy for ${busySamples} minutes (about ${Math.round(avg / 100)} cores' worth). If it's slowing down, restart it between services.`,
      };
    }
  }
  return null;
}

const ms = (n) => `${Math.round(n)}ms`;
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The once-a-minute line. */
export function formatServiceLine({ why, paceMs, calls, refrain, propresenter, performance, index, asked }) {
  const kinds = Object.entries(calls ?? {});
  const total = kinds.reduce((t, [, k]) => t + k.n, 0);
  const callText = total
    ? kinds
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([kind, k]) => `${kind} ${k.n} avg ${ms(k.totalMs / k.n)} max ${ms(k.maxMs)}${k.failed ? ` ${k.failed} failed` : ""}${k.timedOut ? ` ${k.timedOut} timed out` : ""}`)
        .join(", ")
    : "none";
  const pp = propresenter
    ? `ProPresenter ${Math.round(propresenter.cpu)}% CPU ${gb(propresenter.rssMB)}${propresenter.helpers?.count ? ` (+helpers ${Math.round(propresenter.helpers.cpu)}% ${gb(propresenter.helpers.rssMB)})` : ""}`
    : "ProPresenter not running here";
  return [
    `Service log (${why}):`,
    `checking every ${Math.round(paceMs / 1000)}s;`,
    `calls to ProPresenter: ${callText};`,
    `Refrain ${Math.round(refrain.cpu)}% CPU ${Math.round(refrain.rssMB)} MB, stalls up to ${ms(refrain.loopMaxMs)} (p99 ${ms(refrain.loopP99Ms)});`,
    `${pp}${asked ? `; Refrain has asked it for ${plural(asked.documents, "document")} and ${plural(asked.pictures, "picture")} since it started watching it` : ""};`,
    `performance mode ${performance.armed ? `on (${performance.source})` : "off"}${index ? `; indexing ${index}` : ""}.`,
  ].join(" ");
}
