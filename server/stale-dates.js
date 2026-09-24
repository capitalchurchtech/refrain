/**
 * Dates on a slide that have already passed.
 *
 * From docs/ideas.md: "Announcement expiry. Slides mentioning dates that have
 * passed. Cheap text scan, catches the 'event from three weeks ago still in the
 * loop' problem." The booth's announcement decks are full of lines like
 * "Game night Friday, June 27 at 6:30PM" -- fine in June, a mistake in September.
 *
 * Only month-name dates ("June 27", "Sept 9th", "March 23, 2025"). Numeric
 * dates were measured and left out: across all 973 presentations and 38,561
 * slides there were six "N/N" matches, and every one was "Hindsight is 20/20"
 * or a "50/20" split. A numeric parser would have added
 * nothing but false alarms.
 *
 * **When there is no year, the weekday picks it.** Announcements say
 * "Sunday, March 23" far more often than "March 23, 2025". The obvious rule --
 * take whichever March 23 is nearest today -- gets that line wrong in late
 * September: March 2027 is five days nearer than March 2026, so it reads as
 * upcoming. But March 23 was a Sunday in 2025, which makes it an old slide.
 * So a stated weekday chooses the year it is true in, and only a date with no
 * weekday and no year falls back to "nearest occurrence".
 *
 * **A range is judged by its end.** "July 20-23" is still happening on the
 * 21st, so the check is against the 23rd.
 *
 * **An explicit old year is history, not an announcement.** A sermon deck in
 * this weekend's playlist can say "On October 31, 1517" -- that date has
 * passed, and flagging it would be exactly the kind of noise that teaches an
 * operator to stop reading this list. An announcement names a near event and
 * rarely a year at all, so a written year before last year is left alone.
 *
 * Errs toward silence: a date it cannot place confidently is not reported.
 * A pre-service list that cries wolf stops being read.
 */

const MONTHS = [
  ["january", "jan"], ["february", "feb"], ["march", "mar"], ["april", "apr"],
  ["may"], ["june", "jun"], ["july", "jul"], ["august", "aug"],
  ["september", "sept", "sep"], ["october", "oct"], ["november", "nov"], ["december", "dec"],
];
const WEEKDAYS = [
  ["sunday", "sun"], ["monday", "mon"], ["tuesday", "tues", "tue"], ["wednesday", "wed"],
  ["thursday", "thurs", "thur", "thu"], ["friday", "fri"], ["saturday", "sat"],
];

const monthIndex = new Map(MONTHS.flatMap((names, i) => names.map((n) => [n, i])));
const weekdayIndex = new Map(WEEKDAYS.flatMap((names, i) => names.map((n) => [n, i])));

const MONTH = MONTHS.flat().sort((a, b) => b.length - a.length).join("|");
const WEEKDAY = WEEKDAYS.flat().sort((a, b) => b.length - a.length).join("|");

// weekday? month day(ordinal)? (range end)? (, year)?
//   "Friday, June 27"  "Sept 9th"  "July 20-23"  "June 9 through June 12"  "March 23, 2025"
const DATE = new RegExp(
  String.raw`(?:\b(${WEEKDAY})\.?,?\s+)?` +
    String.raw`\b(${MONTH})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b` +
    String.raw`(?:\s*(?:-|–|—|to|through|thru)\s*(?:(${MONTH})\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?\b)?` +
    String.raw`(?:,?\s+(\d{4})\b)?`,
  "gi"
);

const DAY_MS = 86_400_000;

/** Midnight local time, so "today" and "that date" compare as whole days. */
function dayOf(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** A real calendar date, or null for "February 30". */
function makeDate(year, month, day) {
  const d = new Date(year, month, day);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day ? d : null;
}

/**
 * Which year a month/day most plausibly means, as of `today`.
 *
 * With a stated weekday: the year, among the recent past and next year, in
 * which that date actually falls on that weekday -- nearest to today if more
 * than one does. With neither weekday nor year: whichever occurrence is
 * nearest today, ties going to the future (a tie reported as stale would be a
 * false alarm; a tie left alone is just the status quo).
 */
function resolveYear({ month, day, weekday, today }) {
  const thisYear = today.getFullYear();
  if (weekday != null) {
    let best = null;
    for (let y = thisYear - 6; y <= thisYear + 1; y++) {
      const d = makeDate(y, month, day);
      if (!d || d.getDay() !== weekday) continue;
      if (!best || Math.abs(d - today) < Math.abs(best - today)) best = d;
    }
    if (best) return best.getFullYear();
    return null; // the weekday is true in no nearby year: not confident enough to say
  }
  let best = null;
  for (const y of [thisYear - 1, thisYear, thisYear + 1]) {
    const d = makeDate(y, month, day);
    if (!d) continue;
    if (!best) { best = d; continue; }
    const dist = Math.abs(d - today), bestDist = Math.abs(best - today);
    if (dist < bestDist || (dist === bestDist && d > best)) best = d;
  }
  return best ? best.getFullYear() : null;
}

/**
 * Every month-name date in `text` that is already over as of `now`.
 *
 * @returns {{ text: string, date: string, daysAgo: number }[]} `text` is the
 *   phrase as written on the slide, `date` the day it resolved to (YYYY-MM-DD),
 *   `daysAgo` how long ago that was -- always at least 1.
 */
export function findPastDates(text, { now = new Date() } = {}) {
  const today = dayOf(now);
  const found = [];
  for (const m of String(text ?? "").matchAll(DATE)) {
    const [phrase, weekdayName, startMonthName, startDayStr, endMonthName, endDayStr, yearStr] = m;
    const month = monthIndex.get(startMonthName.toLowerCase());
    const startDay = Number(startDayStr);
    const endMonth = endMonthName ? monthIndex.get(endMonthName.toLowerCase()) : month;
    const endDay = endDayStr ? Number(endDayStr) : startDay;
    const weekday = weekdayName ? weekdayIndex.get(weekdayName.toLowerCase()) : null;

    const year = yearStr ? Number(yearStr) : resolveYear({ month, day: startDay, weekday, today });
    if (year == null) continue;
    if (yearStr && year < today.getFullYear() - 1) continue; // history, not an announcement
    const start = makeDate(year, month, startDay);
    if (!start) continue;
    // A range that crosses into the next year ("Dec 30 - Jan 2") ends a year later.
    const endYear = endMonth < month ? year + 1 : year;
    const end = makeDate(endYear, endMonth, endDay);
    if (!end || end < start) continue;

    const daysAgo = Math.round((today - end) / DAY_MS);
    if (daysAgo < 1) continue; // today or later: not over yet
    found.push({ text: phrase.trim(), date: toISODate(end), daysAgo });
  }
  return found;
}

function toISODate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
