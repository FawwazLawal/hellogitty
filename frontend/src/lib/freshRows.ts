/**
 * Fresh-row tracking for live lists (currently the /feed page).
 *
 * The templated page kept a `known` object seeded from the initial
 * server-rendered rows and marked any id not in it as "fresh" so the
 * CSS animation ran on arrival. The React port does the same, but
 * because React doesn't own the DOM at mount time (the first render
 * IS the first data load), the "seed, then diff" split has to be
 * stated explicitly.
 *
 * `step` takes the previous known set and the current row ids and
 * returns the next known set plus the ids that are newly fresh. The
 * caller holds the known set across renders and renders the fresh
 * set with a one-shot class.
 *
 * Why separate from the component: the rule — "the first data load
 * seeds; later loads diff" — is the kind of off-by-one that reads as
 * trivial in prose and then ships wrong. A pure function pins it.
 */

export type FreshStep = {
  nextKnown: Set<string>
  freshIds: Set<string>
}

/**
 * - When `prevKnown` is null, this is the first data load: seed from
 *   `currentIds`, flash nothing.
 * - When `prevKnown` is a Set, flash every id in `currentIds` that is
 *   not already in it; the returned `nextKnown` is the union.
 */
export function stepFresh(
  prevKnown: Set<string> | null,
  currentIds: Iterable<string>,
): FreshStep {
  if (prevKnown === null) {
    return { nextKnown: new Set(currentIds), freshIds: new Set() }
  }
  const next = new Set(prevKnown)
  const fresh = new Set<string>()
  for (const id of currentIds) {
    if (!next.has(id)) {
      next.add(id)
      fresh.add(id)
    }
  }
  return { nextKnown: next, freshIds: fresh }
}
