// src/verifierrole.mjs — WHO counts as an independent verifier: ONE definition, in the
// lowest layer that needs it.
//
// WHY this is its own module (landing safety, lead #1164): the judgement is needed by
// `metrics` and by the per-seat tool scoping at RUNTIME, not only by the `check` audit.
// It used to live in src/checkup.mjs, and src/metrics.mjs / src/seattools.mjs imported it
// from there — so a mid-merge/conflicted src/checkup.mjs made the whole CLI fail to LOAD
// (2026-10-17: a `<<<<<<<` marker in checkup.mjs left `status`, `queue`, `run` and
// `serve` all dead with a SyntaxError) even once cli.mjs stopped importing checkup
// itself. A shared predicate belongs in a module that carries no audit machinery, so the
// audit can be broken without taking the rig down.
//
// Pure: plain data in, boolean out. No store, no provider, no I/O.

/**
 * Terms that mark a seat as an independent verifier, matched as substrings of the seat's
 * NAME and ROLE text. Deliberately excludes this rig's shared `peer-review` capability:
 * `impl`/`impl2` advertise it too, so matching on capabilities would call the authors
 * verifiers and report an all-clear on the exact gap the rule exists to catch. `audit` is
 * excluded for the same reason — a security seat audits its own surface, not other
 * seats' work.
 */
export const VERIFIER_TERMS = ["verif", "qa", "review", "editor"];

/**
 * A seat counts as a verifier when its name or role says so. One definition, because the
 * `check` rule and the config-derived metrics measure must agree — two copies would drift.
 */
export function seatsAreVerifier(seat) {
  const haystack = `${seat.name ?? ""} ${seat.role ?? ""}`.toLowerCase();
  return VERIFIER_TERMS.some((term) => haystack.includes(term));
}
