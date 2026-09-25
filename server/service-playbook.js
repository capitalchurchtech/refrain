/**
 * The run-of-show checklist (issue #3; handoff section 37, phase 3).
 *
 * **Data, not code.** Phases and steps come from `serviceModule.phases` in
 * config.json when a church writes its own, and from the short default below
 * otherwise. The default names nothing specific to one building. A step is
 * either something a person ticks ("Screens on") or a link to the automatic
 * checks. A phase is once a day ("day"), once per service ("service"), or
 * after every service but the last ("between"): there is no "between" after
 * the final service, so its steps would only ever read as skipped.
 *
 * **During the service there is deliberately no phase.** That stretch is
 * quiet by design: flags and the timeline run on their own, and nothing asks
 * for attention.
 */

export const DEFAULT_PHASES = [
  {
    id: "arrive",
    name: "Arrive",
    scope: "day",
    steps: [
      { id: "propresenter", label: "ProPresenter open and answering" },
      { id: "screens", label: "Screens and projectors on" },
      { id: "stage", label: "Stage display showing" },
      { id: "playback", label: "Audio and video playback checked" },
    ],
  },
  {
    id: "before",
    name: "Before the service",
    scope: "service",
    steps: [
      { id: "checks", label: "Run the pre-service checks", checks: true },
      { id: "playlist", label: "The right playlist is loaded" },
    ],
  },
  {
    id: "between",
    name: "Between services",
    scope: "between",
    steps: [
      { id: "clear", label: "Screens cleared" },
      { id: "timer", label: "Stage timer reset" },
      { id: "preroll", label: "Pre-service loop back up" },
    ],
  },
  {
    id: "after",
    name: "After the service",
    scope: "day",
    steps: [
      { id: "flags", label: "Work through today's flags", link: "#slide-flags" },
      { id: "end", label: "End the day", end: true },
    ],
  },
];

const slug = (s) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The phases to use, and anything wrong with a configured list. A malformed
 * entry is dropped with a message rather than breaking the screen; an empty
 * or missing list means the default.
 */
export function playbookPhases(configured) {
  if (configured == null) return { phases: DEFAULT_PHASES, problems: [] };
  if (!Array.isArray(configured) || !configured.length) {
    return { phases: DEFAULT_PHASES, problems: ["serviceModule.phases should be a non-empty list; using the default."] };
  }
  const problems = [];
  const seen = new Set();
  const phases = [];
  configured.forEach((p, i) => {
    const id = slug(p?.id ?? p?.name);
    if (!id || seen.has(id)) {
      problems.push(`Phase ${i + 1} needs a unique name.`);
      return;
    }
    seen.add(id);
    const steps = [];
    const stepIds = new Set();
    (Array.isArray(p.steps) ? p.steps : []).forEach((st, j) => {
      const label = typeof st === "string" ? st : st?.label;
      const sid = slug(typeof st === "string" ? st : (st?.id ?? st?.label));
      if (!label || !sid || stepIds.has(sid)) {
        problems.push(`Phase "${p.name ?? id}", step ${j + 1} needs a unique label.`);
        return;
      }
      stepIds.add(sid);
      steps.push({ id: sid, label: String(label), ...(st?.checks ? { checks: true } : {}), ...(st?.end ? { end: true } : {}), ...(st?.link ? { link: String(st.link) } : {}) });
    });
    phases.push({ id, name: String(p.name ?? id), scope: ["service", "between"].includes(p.scope) ? p.scope : "day", steps });
  });
  return phases.length ? { phases, problems } : { phases: DEFAULT_PHASES, problems: [...problems, "No usable phases; using the default."] };
}

/**
 * Each step with whether it's done. Checks steps count as done once the
 * checks have been run for that service; the End step once the day is ended.
 * @param {(key: string) => boolean|undefined} isDone
 */
export function checklistState(phases, { services, isDone, checksRun, dayEnded, stepKey }) {
  const out = [];
  for (const phase of phases) {
    const perService = services.map((s) => ({ serviceId: s.serviceId, serviceName: s.name }));
    const scopes =
      phase.scope === "service" ? perService : phase.scope === "between" ? perService.slice(0, -1) : [{ serviceId: null, serviceName: null }];
    for (const scope of scopes) {
      out.push({
        phaseId: phase.id,
        name: phase.name,
        scope: phase.scope,
        ...scope,
        steps: phase.steps.map((st) => ({
          ...st,
          done: st.checks ? Boolean(checksRun(scope.serviceId)) : st.end ? Boolean(dayEnded) : Boolean(isDone(stepKey(phase.id, st.id, scope.serviceId))),
        })),
      });
    }
  }
  return out;
}

/** Steps that weren't done, for the day summary. Only phases that apply: a per-service phase with no services has none. */
export function skippedSteps(checklist) {
  return checklist.flatMap((p) => p.steps.filter((s) => !s.done && !s.end).map((s) => ({ phase: p.name, service: p.serviceName, step: s.label })));
}
