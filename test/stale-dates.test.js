import { test } from "node:test";
import assert from "node:assert/strict";
import { findPastDates } from "../server/stale-dates.js";

// Fixed "today" so these do not rot: Thursday 24 September 2026.
const now = new Date(2026, 8, 24);
const past = (text, at = now) => findPastDates(text, { now: at });
const dates = (text, at) => past(text, at).map((d) => d.date);

test("an announcement for an event that is over is flagged, with the day it meant", () => {
  const [d] = past("Game night Friday, June 27 at 6:30PM. Register online.");
  assert.equal(d.text, "Friday, June 27");
  assert.equal(d.date, "2025-06-27", "June 27 was a Friday in 2025, so that is the year");
  assert.ok(d.daysAgo > 400);
});

test("THE TRAP: a weekday decides the year when 'nearest occurrence' would get it wrong", () => {
  // In late September, March 2027 is five days nearer than March 2026, so the
  // naive rule reads this as upcoming. March 23 was a Sunday in 2025.
  assert.deepEqual(dates("Newcomers lunch Sunday, March 23. Main campus."), ["2025-03-23"]);
});

test("an upcoming event with the right weekday is left alone", () => {
  // October 11, 2026 is a Sunday.
  assert.deepEqual(past("Join us Sunday, October 11 at 9am"), []);
});

test("a date with no weekday and no year uses the nearest occurrence", () => {
  assert.deepEqual(dates("VBS runs June 27"), ["2026-06-27"], "June is behind us, not nine months ahead");
  assert.deepEqual(past("Save the date: January 5"), [], "January is nearer ahead than behind");
});

test("a range is judged by its end, not its start", () => {
  assert.deepEqual(past("Camp is September 23-26"), [], "still running on the 24th");
  assert.deepEqual(dates("Camp is September 23-26", new Date(2026, 8, 27)), ["2026-09-26"]);
  assert.deepEqual(dates("VBS runs June 9 through June 12"), ["2026-06-12"]);
  assert.deepEqual(dates("Retreat June 30 - July 2"), ["2026-07-02"]);
});

test("a range across the new year ends in the next year", () => {
  assert.deepEqual(past("Closed Dec 30 - Jan 2", new Date(2027, 0, 1)), [], "still closed on Jan 1");
  assert.deepEqual(dates("Closed Dec 30 - Jan 2", new Date(2027, 0, 5)), ["2027-01-02"]);
});

test("today is not over yet; yesterday is", () => {
  assert.deepEqual(past("Prayer night September 24"), []);
  const [d] = past("Prayer night September 23");
  assert.equal(d.daysAgo, 1);
});

test("a recent explicit year is an announcement; an old one is history", () => {
  assert.deepEqual(dates("Registration closed March 23, 2025"), ["2025-03-23"]);
  assert.deepEqual(past("On October 31, 1517, Luther nailed the theses."), [], "a sermon's history is not stale");
  assert.deepEqual(past("May 29, 2022 “Series title”"), [], "an old series date, not this week's event");
});

test("abbreviations, full stops and ordinals are all read", () => {
  assert.deepEqual(dates("Men's breakfast Sat, April 12th"), ["2025-04-12"]);
  assert.deepEqual(dates("Starts Sept 9th"), ["2026-09-09"]);
  assert.deepEqual(dates("Deadline Aug. 3"), ["2026-08-03"]);
});

test("'may' the word is not 'May' the month", () => {
  assert.deepEqual(past("That we may know Him, and you may go in peace."), []);
  assert.deepEqual(dates("Support group Mondays at 6:30p, beginning May 20."), ["2026-05-20"]);
});

test("numeric fractions and scripture are never dates", () => {
  // Measured: the only N/N matches in the whole library were these.
  assert.deepEqual(past("Hindsight is 20/20. Split it 50/20."), []);
  assert.deepEqual(past("John 3:16 and Romans 8:28"), []);
});

test("impossible dates and weekdays that fit no nearby year stay silent", () => {
  assert.deepEqual(past("Join us February 30"), []);
  // September 24 fell on no Monday from 2020 to 2027 -- a mistyped weekday.
  // Not confident enough to call it stale, so it says nothing.
  assert.deepEqual(past("Monday, September 24"), []);
  // February 29 was a Saturday in 2020 and a Thursday in 2024: the weekday
  // picks the real one, and a Monday February 29 exists in neither.
  assert.deepEqual(dates("Saturday, February 29"), ["2020-02-29"]);
  assert.deepEqual(dates("Thursday, February 29"), ["2024-02-29"]);
  assert.deepEqual(past("Monday, February 29"), []);
});

test("tolerates empty and missing input", () => {
  assert.deepEqual(past(""), []);
  assert.deepEqual(past(null), []);
  assert.deepEqual(past(undefined), []);
});
