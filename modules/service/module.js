/**
 * Service -- the day's services, a timing rundown of what went live, and
 * lock-in for live events (handoff section 37, phase 1; issue #6). See
 * server/service-days.js and public/service.js.
 *
 * On by default (owner, 2026-10-06), switched on Settings > Features. It
 * needs nothing else -- service times and a shared folder are both optional.
 */
export default {
  id: "service",
  navLabel: "Day",
  icon: "calendar-days",
  nav: { group: "service", order: 3, page: "service" },
  client: { file: "service.js", init: "initService" },
  route: "/service",
  component: null,
  // Switchable on Settings > Features (server/features.js); off hides its
  // screen and its routes answer "switched off".
  feature: { default: true, label: "Service day", summary: "Timeline, checks, close-out", description: "The day's timeline of what went live, the pre-service checks, the checklist and End the day.", apiPrefixes: ["/api/service/"] },
};
