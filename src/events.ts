/** The events with a formatter of their own. Anything else still works, typed in "Other events". */
const KNOWN: { value: string; label: string; hint?: string }[] = [
  { value: "push", label: "Pushes" },
  { value: "pull_request", label: "Pull requests" },
  { value: "issues", label: "Issues" },
  { value: "issue_comment", label: "Issue comments" },
  {
    value: "release",
    label: "Releases",
    // one release arrives as several deliveries, which surprises everyone the
    // first time, so the row that causes it is where the way out is explained
    hint: "Every release action. For just one, put release:published in Other events instead.",
  },
  { value: "star", label: "Stars" },
  { value: "workflow_run", label: "Workflow runs" },
];

const isKnown = (event: string) => KNOWN.some((known) => known.value === event);

const split = (events: string) =>
  events
    .split(",")
    .map((event) => event.trim())
    .filter(Boolean);

/**
 * Reads a stored events string into the three things the form edits.
 *
 * `*` is a mode, not an event: it has to leave the lists empty, or turning
 * "everything" off would leave a literal `*` behind in "Other events" and the
 * webhook would keep logging everything.
 */
const parseEvents = (events: string) => {
  const all = events.trim() === "*";
  const listed = all ? [] : split(events);

  return {
    all,
    picked: listed.filter(isKnown),
    other: listed.filter((event) => !isKnown(event)).join(", "),
  };
};

/** The inverse: what the form holds, as the string the server stores. */
const buildEvents = (all: boolean, picked: string[], other: string) =>
  all ? "*" : [...picked, ...split(other)].join(", ");

export { buildEvents, isKnown, KNOWN, parseEvents, split };
