/**
 * Service -- the day's services, a timing rundown of what went live, and
 * lock-in for live events (handoff section 37, phase 1; issue #6). See
 * server/service-days.js and public/service.js.
 *
 * Off by default: a church that only wants search never sees it. Turned on
 * with `serviceModule.enabled` in config.json, and it needs nothing else --
 * service times and a shared folder are both optional.
 */
export default {
  id: "service",
  navLabel: "Service",
  icon: "calendar-clock",
  route: "/service",
  component: null,
  enabledByDefault: false,
};
