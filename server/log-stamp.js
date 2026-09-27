/**
 * A local timestamp on every line Refrain writes to its log.
 *
 * Issue #13's timeline had to be pieced together from which lines came near
 * which, because none of them said when. Imported first by index.js, so it
 * applies before anything else logs. Continuation lines of a multi-line
 * message are left as they are.
 */
const pad = (n, w = 2) => String(n).padStart(w, "0");
export function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
for (const level of ["log", "info", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => (args.length === 1 && args[0] === "" ? original("") : original(`[${stamp()}]`, ...args));
}
