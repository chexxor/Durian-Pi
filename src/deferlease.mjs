/**
 * deferlease.mjs — PARKING ON THE HUMAN IS A LEASE, NOT A HOLE.
 *
 * OPERATOR RULING 2026-11-12T20:2xZ, accepting the delegate's recommendation "lead decides, pm routes, with a
 * 5-day lease": a row parked on the human operator must say UNTIL WHEN, and when the clock runs out `lead`
 * decides instead of the row idling forever.
 *
 * WHY (measured 20:1xZ on this rig, 7,502 rows): **493 rows carried `deferredTo: "human"`** — median age
 * 5 days, oldest 23, and that is 32% of the non-terminal queue. `status` printed it as nine alarms
 * ("71 item(s) parked on a question … waiting on human"), the operator was away, and 84 of those rows were
 * LANDING work, which is why the landing track looked stalled while the team had closed 35 rows in 4 h.
 *
 * THE SHAPE OF THE FIX, and why each half is here rather than in prose:
 *   1. `validateHumanDefer` — `defer_work` to the human REFUSES without `resumeBy` (an ISO instant ≤ 5 days
 *      out). A park with no clock is not a decision, it is a place for work to disappear.
 *   2. `escalations` — the census of parks whose clock has run out, INCLUDING the legacy rows that never had
 *      one (`no-clock`), because those are the 493 and a rule that only sees new rows fixes nothing.
 *   3. `selectWakes` wakes `lead` once per distinct escalation set, and `check` reports the census, so the
 *      escalation path has a reader like every other mechanism on this rig.
 *
 * Deliberately NOT here: changing `deferredTo` to `lead`. The row still records WHO WAS ASKED (the operator);
 * the escalation is a separate fact, and rewriting the audience would erase the evidence that the operator
 * never answered. `lead` decides by releasing, re-routing or answering — all existing verbs.
 *
 * Pure: no store, no clock capture, no imports from rig.mjs (so it is testable in milliseconds).
 */

/** The longest a row may be parked on the human operator. The operator ratified five days. */
export const MAX_HUMAN_DEFER_MS = 5 * 24 * 3600 * 1000;

/** The `deferredTo` value that means "parked on the human operator" (mirrors rig.mjs DEFERRED_TO_HUMAN). */
export const HUMAN = "human";

/**
 * Validate a human-targeted deferral. Returns the normalized `resumeBy`, or a refusal that tells the seat
 * what to do instead — the refusal is load-bearing: a seat that is refused needs a legal alternative in the
 * same breath (name a seat with authority, or hold with a lease).
 *
 * @param {{to?: string, resumeBy?: string}} args
 * @param {number} [now] epoch ms (injected so the bound is testable)
 * @returns {{ok: true, resumeBy: string} | {ok: false, refusal: string}}
 */
export function validateHumanDefer({ to, resumeBy } = {}, now = Date.now()) {
  if (to !== HUMAN) return { ok: true, resumeBy: resumeBy ?? null }; // a seat target keeps today's behaviour
  if (typeof resumeBy !== "string" || resumeBy.trim() === "") {
    return {
      ok: false,
      refusal:
        "a deferral to the human operator needs `resumeBy` (ISO-8601, at most 5 days out): a park with no clock is how work disappears " +
        "(493 rows were parked on the operator with a median age of 5 days). If you need a decision NOW, ask a seat with authority instead — " +
        "`to: \"lead\"` for a semantics/priority call, `to: \"pm\"` for routing — or `hold_work` it with a lease.",
    };
  }
  const until = Date.parse(resumeBy);
  if (!Number.isFinite(until)) {
    return { ok: false, refusal: `resumeBy must be an ISO-8601 instant, got: ${resumeBy}` };
  }
  if (until <= now) {
    return { ok: false, refusal: "resumeBy must be in the future: a deadline in the past parks the row in the same breath it is created" };
  }
  if (until - now > MAX_HUMAN_DEFER_MS) {
    return { ok: false, refusal: "resumeBy may be at most 5 days out — longer than that is the operator's call to make, not a park to sit in" };
  }
  return { ok: true, resumeBy: new Date(until).toISOString() };
}

/**
 * THE ESCALATION CENSUS: rows parked on the human whose clock has run out, plus the legacy rows that never
 * had one. `no-clock` is reported separately from `lapsed` because they need different sentences: one says
 * "the deadline passed", the other says "this park was created before parking had a deadline".
 *
 * @param {Array<object>} items queue rows ({id, status, deferredTo, deferLease, transitions})
 * @param {number} [now]
 * @returns {{count: number, rows: Array<{id: string, ageMs: number|null, resumeBy: string|null, why: "lapsed"|"no-clock"}>}}
 */
export function escalations(items = [], now = Date.now()) {
  const rows = [];
  for (const item of items) {
    if (item?.status !== "deferred") continue;
    if (item.deferredTo !== HUMAN) continue;
    const resumeBy = item?.deferLease?.resumeBy ?? null;
    const deferredAt = lastDeferAt(item);
    const ageMs = deferredAt === null ? null : Math.max(0, now - deferredAt);
    if (resumeBy === null) {
      rows.push({ id: String(item.id), ageMs, resumeBy: null, why: "no-clock" });
      continue;
    }
    const until = Date.parse(resumeBy);
    if (Number.isFinite(until) && until <= now) rows.push({ id: String(item.id), ageMs, resumeBy, why: "lapsed" });
  }
  rows.sort((a, b) => (b.ageMs ?? 0) - (a.ageMs ?? 0));
  return { count: rows.length, rows };
}

/** The instant of the LATEST `deferred` transition, or null. Used for the age a reader needs. */
export function lastDeferAt(item) {
  const ts = (item?.transitions ?? []).filter((t) => /defer/i.test(String(t?.event ?? ""))).map((t) => Date.parse(t.at)).filter(Number.isFinite);
  return ts.length === 0 ? null : Math.max(...ts);
}

/**
 * A stable signature of the escalation set, so `selectWakes` wakes `lead` when the SET changes rather than on
 * every pass — the same dedup rule #5740 applies to a parked seat, for the same reason (a wake that carries no
 * new information dirties the scheduler and sustains the loop).
 */
export function escalationSignature(list = []) {
  return list.map((r) => `${r.id}:${r.why}`).sort().join(",");
}

/** One line a reader can act on, used by `check` and by the wake reason. */
export function escalationText(census) {
  if (!census || census.count === 0) return "no deferral is parked past its clock";
  const oldest = census.rows[0];
  const days = oldest.ageMs === null ? "?" : (oldest.ageMs / 86_400_000).toFixed(1);
  const lapsed = census.rows.filter((r) => r.why === "lapsed").length;
  return `${census.count} row(s) parked on the operator past their decision clock (${lapsed} lapsed, ${census.count - lapsed} with no clock); oldest #${oldest.id} at ${days} d — lead decides, pm routes`;
}
