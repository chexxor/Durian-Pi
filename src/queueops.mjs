/**
 * queueops.mjs — WHO MAY CHANGE THE QUEUE, AND WHAT EXACTLY CHANGES (#7278 thread, operator ruling
 * 2026-11-12T17:5xZ).
 *
 * WHY THIS MODULE EXISTS. The operator asked for operator/delegate control over the team's queue and
 * named one risk: an internally inconsistent state the team should heal from. Measured, the team cannot
 * heal it and the inconsistency is already here (docs/reviews/operator-queue-control-seam.md):
 *
 *   - `workable()` (src/rig.mjs) returns `gate-cancelled:#<id>` for a row whose prerequisite was
 *     CANCELLED. That is a POSITIVE non-workability by the lead-ratified definition (#2677: "terminal" !=
 *     "done"), so the dependent can NEVER become claimable — and nothing repairs a `blockedBy` chain when
 *     a gate goes terminal.
 *   - `node tools/queue-drain-audit.mjs` found 151 such rows on this rig, and the first hour of the
 *     operator's own zero-build close stranded two more (#3503 and #5885, both gated on cancelled #3377).
 *
 * So this module does three things, and it is PURE (no store, no clock, no I/O) so all three are testable
 * without a broker:
 *
 *   1. `strandedGates(items)` — the CENSUS: non-terminal rows whose gate is terminal-and-not-done. This is
 *      the reader the 151 orphans never had (the same "instrument with no reader" defect as #7271).
 *   2. `planRepairGates` / `planPriority` / `planCancel` — PLANS: exactly the transitions a mutation would
 *      append, computed before anything is written. That is what makes "propose" and "apply" the same code
 *      path, differing only in whether the caller commits.
 *   3. The AUTHORITY and BLAST-RADIUS rules that keep operator/delegate apply-authority from becoming a
 *      foot-gun: append-only transitions, a lease on every priority, a refusal on claimed rows, a warning
 *      that names the rows a cancel would strand, and a confirmation threshold.
 *
 * WHAT IS DELIBERATELY NOT HERE: routing. Minting rows, editing `blockedBy` to add a dependency, and
 * assigning a row to a seat are the PM's decomposition. This module only REPAIRS a dead gate (removing a
 * prerequisite that can never be satisfied), reorders a row, or retires one.
 */

/** Priority values `priority_first` knows how to sort (src/workstrategy.mjs). */
export const PRIORITIES = ["now", "next", "later"];

/** A plan touching more changes than this must be confirmed explicitly (blast-radius rule). */
export const CONFIRM_THRESHOLD = 20;

const TERMINAL = new Set(["done", "cancelled"]);

// THE SAME CLASSIFICATION every surface uses (src/queueclass.mjs): a notice is an acknowledgement, a
// registration is a ROADMAP ledger copy. Re-spelling these predicates here is the pair-of-spellings defect
// #5047 records, so the plan and the census read the imported predicate.
import { classifyRow, isNoticeItem, isTerminalRow, queueShape } from "./queueclass.mjs";

// THE SAME park lease `defer_work` enforces (src/rig.mjs Router calls this at :2022 before it writes
// `status = "deferred"`). One rule, two surfaces: the seat's tool and the operator plane's verb cannot
// disagree about whether a park on the human needs a clock.
import { validateHumanDefer, HUMAN as DEFERRED_TO_HUMAN } from "./deferlease.mjs";

const isTerminal = (item) => item != null && TERMINAL.has(item.status);

/**
 * THE CENSUS. A row is STRANDED when it is non-terminal, `queued` or `held`, and one of its `blockedBy`
 * entries names a row that is CANCELLED.
 *
 * Why exactly this predicate, and not "any terminal gate":
 *   - `done` gates are already SATISFIED by `workable()` (`src/rig.mjs`, `if (target.status === "done")
 *     continue;`), so they are not stranded — they are ordinary progress.
 *   - `open` gates are ordinary back-pressure (`gate-open:#N(queued|claimed|held)`), which is the normal
 *     shape of a chain and must NOT be reported as a defect.
 *   - a gate id that names NOTHING is the documented ambiguity case: `workable()` treats it as workable
 *     ("the conservative default says workable", src/rig.mjs), so it is not stranded either.
 *   - `claimed`/`deferred` dependents are reported too: they cannot be claimed while the gate is dead,
 *     and a deferred row is precisely where a dead gate hides longest.
 *
 * Returns `{ count, rows }` where each row carries the SEAT, the dead gate id, and a subject excerpt —
 * enough to route a repair without opening the store again.
 */
export function strandedGates(items = []) {
  const byId = new Map(items.map((it) => [String(it.id), it]));
  const rows = [];
  for (const item of items) {
    if (isTerminal(item)) continue;
    for (const raw of item.blockedBy ?? []) {
      const gate = byId.get(String(raw));
      if (gate && gate.status === "cancelled") {
        rows.push({
          id: String(item.id),
          status: item.status,
          to: item.to ?? null,
          gateId: String(raw),
          gateSubject: excerpt(gate.subject),
          subject: excerpt(item.subject),
        });
        break; // one dead gate is enough; the repair removes all of them in one transition
      }
    }
  }
  return { count: rows.length, rows };
}

function excerpt(text, max = 90) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Resolve the requested ids against the queue, refusing ids that name nothing. */
function selectRows(items, ids, { allow = null } = {}) {
  const byId = new Map(items.map((it) => [String(it.id), it]));
  const picked = [];
  const unknown = [];
  for (const id of ids) {
    const item = byId.get(String(id));
    if (!item) {
      unknown.push(String(id));
      continue;
    }
    if (allow && !allow.includes(item.status)) {
      return { ok: false, refusal: `item #${id} is ${item.status}; this action touches ${allow.join(" or ")} rows only` };
    }
    picked.push(item);
  }
  if (unknown.length > 0) return { ok: false, refusal: `unknown item(s): ${unknown.map((u) => `#${u}`).join(", ")}` };
  return { ok: true, rows: picked };
}

function authorityOf(request = {}) {
  const who = request.from ?? request.by ?? "operator";
  // The AUTHORITY is the caller's, named. `set_priority` already records sender/recipient/coordinator;
  // this extends that vocabulary to the operator plane rather than inventing a second field.
  const authority =
    who === "operator" ? "operator" : who === "delegate" ? "delegate (operator-authorised)" : String(request.authority ?? who);
  return { by: String(who), authority };
}

/**
 * PLAN: repair a dead gate.
 *
 * A cancelled prerequisite can never be satisfied, so the ONLY faithful repair is to REMOVE it from the
 * dependent's `blockedBy` and say so in a transition. This is deliberately NOT a reinterpretation of
 * `workable()`: the lead-ratified definition (#2677) says a cancelled gate is positive non-workability,
 * and flipping that silently would make abandoned work look satisfied. Repair is an explicit act.
 *
 * Refuses ids that are not in the census, so a repair can never quietly edit a live chain.
 */
export function planRepairGates(items, request = {}) {
  const { by, authority } = authorityOf(request);
  const at = request.at ?? new Date().toISOString();
  const census = strandedGates(items);
  const strandedIds = new Set(census.rows.map((r) => r.id));
  const wanted = request.ids?.length ? request.ids.map(String) : [...strandedIds];
  if (wanted.length === 0) return { ok: true, changes: [], transitions: [], note: "no stranded rows; nothing to repair" };
  const notStranded = wanted.filter((id) => !strandedIds.has(id));
  if (notStranded.length > 0) {
    return {
      ok: false,
      refusal: `refusing: #${notStranded.join(", #")} is not gated on a cancelled row (a repair only removes a DEAD gate; a live chain is the pm's to edit)`,
    };
  }
  const byId = new Map(items.map((it) => [String(it.id), it]));
  const changes = [];
  const transitions = [];
  for (const id of wanted) {
    const item = byId.get(id);
    const dead = (item.blockedBy ?? []).filter((g) => byId.get(String(g))?.status === "cancelled").map(String);
    if (dead.length === 0) continue;
    changes.push({ id, gateReleased: dead });
    transitions.push({
      at,
      event: "gate-released",
      by,
      authority,
      gate: dead,
      reason: String(request.reason ?? "prerequisite cancelled; the dependent was stranded and is released"),
    });
  }
  return { ok: true, changes, transitions };
}

/**
 * PLAN: set a priority LEASE.
 *
 * Reuses `set_priority`'s semantics exactly (src/workstrategy.mjs: a reason, an `expiresAt` in the future,
 * at most 30 days) because a priority that does not expire is how urgency becomes a permanent park. The
 * only new thing is WHO: `by`/`authority` name the operator plane instead of a seat.
 */
export function planPriority(items, request = {}) {
  const { by, authority } = authorityOf(request);
  const at = request.at ?? new Date().toISOString();
  const priority = request.priority;
  if (!PRIORITIES.includes(priority)) return { ok: false, refusal: `priority must be one of ${PRIORITIES.join("|")}, got: ${priority}` };
  const reason = String(request.reason ?? "").trim();
  if (reason === "") return { ok: false, refusal: "a priority needs a reason (it is a lease with an author)" };
  const until = request.expiresAt ? Date.parse(request.expiresAt) : NaN;
  if (!Number.isFinite(until)) return { ok: false, refusal: `expiresAt must be an ISO-8601 instant, got: ${request.expiresAt}` };
  if (until <= Date.parse(at)) return { ok: false, refusal: "expiresAt must be in the future (a lease, not a flag)" };
  if (until - Date.parse(at) > 30 * 24 * 3600 * 1000) return { ok: false, refusal: "expiresAt may be at most 30 days out" };
  const ids = (request.ids ?? []).map(String);
  if (ids.length === 0) return { ok: false, refusal: "priority needs at least one --id" };
  // `set_priority` refuses a row already in flight: ordering a claimed row would race the turn acting on it.
  const sel = selectRows(items, ids, { allow: ["queued", "held"] });
  if (!sel.ok) return { ok: false, refusal: sel.refusal };
  const changes = sel.rows.map((item) => ({ id: String(item.id), from: item.priority ?? null, to: priority }));
  const transitions = sel.rows.map((item) => ({
    at,
    event: "priority",
    by,
    authority,
    priority,
    reason,
    expiresAt: request.expiresAt,
    ...(item.priority && item.priority !== priority ? { was: item.priority } : {}),
  }));
  return { ok: true, changes, transitions, lease: { priority, reason, expiresAt: request.expiresAt, by, authority } };
}

/**
 * PLAN: a scoped, leased DIRECTIVE.
 *
 * A directive is the operator's POLICY ("landing is the priority, for these rows, until then"), expressed
 * ONCE and evaluated at claim time by `orderCandidates` (src/workstrategy.mjs). The alternative — writing
 * `now` onto the rows that exist today — is a copied value: every row minted afterwards silently misses it,
 * which is the recorded-census-goes-stale defect this repo already paid for (pitfall 294). Measured cost of
 * the fan-out mistake once: 33 rows promoted by hand while 444 real queued rows kept minting.
 *
 * SCOPE IS REQUIRED and deliberately narrow — seats and/or a subject substring — because a directive that
 * scopes to "everything" is an untraceable global reorder. Same lease rules as a row priority: a reason, an
 * `expiresAt` in the future, at most 30 days.
 */
export function planDirective(request = {}) {
  const { by, authority } = authorityOf(request);
  const at = request.at ?? new Date().toISOString();
  const priority = request.priority;
  if (!PRIORITIES.includes(priority)) return { ok: false, refusal: `directive priority must be one of ${PRIORITIES.join("|")}, got: ${priority}` };
  const reason = String(request.reason ?? "").trim();
  if (reason === "") return { ok: false, refusal: "a directive needs a reason: it reorders other people's work" };
  const until = request.expiresAt ? Date.parse(request.expiresAt) : NaN;
  if (!Number.isFinite(until)) return { ok: false, refusal: `directive expiresAt must be an ISO-8601 instant, got: ${request.expiresAt}` };
  if (until <= Date.parse(at)) return { ok: false, refusal: "directive expiresAt must be in the future (a lease, not a flag)" };
  if (until - Date.parse(at) > 30 * 24 * 3600 * 1000) return { ok: false, refusal: "directive expiresAt may be at most 30 days out" };
  const seats = Array.isArray(request.seats) ? request.seats.map(String).filter((x) => x !== "") : [];
  const requestedSubjects = Array.isArray(request.subjectContains)
    ? request.subjectContains
    : typeof request.subjectContains === "string"
      ? [request.subjectContains]
      : [];
  const subjectContains = requestedSubjects.map((x) => String(x ?? "").trim()).filter((x) => x !== "");
  if (seats.length === 0 && subjectContains.length === 0)
    return { ok: false, refusal: "a directive needs a SCOPE: --seat <name> (repeatable) and/or --subject <substring>; an unscoped directive would reorder the whole queue" };
  const directive = {
    priority,
    reason,
    expiresAt: request.expiresAt,
    at,
    by,
    authority,
    ...(seats.length > 0 ? { seats } : {}),
    // One token is stored as one string (the readable shape); several as a list.
    ...(subjectContains.length === 1 ? { subjectContains: subjectContains[0] } : {}),
    ...(subjectContains.length > 1 ? { subjectContains } : {}),
  };
  return { ok: true, directive, changes: [{ id: "control", to: `directive:${priority}` }], transitions: [] };
}

/**
 * PLAN: DEFER rows — park them on the human operator with a decision clock. THE MIRROR OF `planRelease`.
 *
 * WHY THIS IS THE OTHER HALF OF THE MISSING VERB. `planRelease` below explains that 493 rows sat
 * `deferredTo: "human"` and nothing in the operator plane could UN-park them; the shipped `release` fixed
 * that half. The other half was never shipped: nothing in the operator plane could PARK a row, so the end
 * user could not say "wait on this one — ask me", and `readapi.mjs`'s `awaitingOperator` attribute (derived
 * from `deferredTo === DEFERRED_TO_HUMAN`) was a state the VIEW could read but the surface could not SET.
 *
 * WHAT IT REUSES, unchanged: `validateHumanDefer` (src/deferlease.mjs) — the SAME rule `src/rig.mjs` calls
 * before `defer_work` writes, so the operator verb and the seat tool cannot drift on whether a park needs
 * a clock. Refuses a `claimed` row (in flight, the same rule `planCancel` states) and a terminal row, BY NAME
 * and by id.
 *
 * `--until` is the park's clock: a `resumeBy` instant at most 5 days out, after which `lead` decides instead
 * of the row sitting parked (operator ruling 2026-11-12T20:2xZ).
 */
export function planDefer(items, request = {}) {
  const { by, authority } = authorityOf(request);
  const at = request.at ?? new Date().toISOString();
  const atMs = request.atMs ?? (Number.isFinite(Date.parse(at)) ? Date.parse(at) : Date.now());
  const reason = String(request.reason ?? "").trim();
  if (reason === "") return { ok: false, refusal: "a defer needs a reason (what the park is waiting on)" };
  const ids = (request.ids ?? []).map(String);
  if (ids.length === 0) return { ok: false, refusal: "defer needs at least one --id" };
  const sel = selectRows(items, ids, { allow: ["queued", "held"] });
  if (!sel.ok) return { ok: false, refusal: sel.refusal };
  const lease = validateHumanDefer({ to: DEFERRED_TO_HUMAN, resumeBy: request.resumeBy ?? request.expiresAt }, atMs);
  if (!lease.ok) return { ok: false, refusal: lease.refusal };
  const changes = sel.rows.map((item) => ({ id: String(item.id), from: item.status, to: "deferred", deferredTo: DEFERRED_TO_HUMAN, resumeBy: lease.resumeBy }));
  const transitions = sel.rows.map((item) => ({
    at,
    event: "deferred",
    by,
    authority,
    reason,
    to: DEFERRED_TO_HUMAN,
    resumeBy: lease.resumeBy,
    ...(item.heldReason ? { leftHeld: true } : {}),
  }));
  return { ok: true, changes, transitions, lease: { resumeBy: lease.resumeBy, by, authority, at } };
}

/**
 * PLAN: RELEASE rows — take them out of a park (held / deferred-to-an-audience) and back to `queued`, so a
 * seat can claim them.
 *
 * WHY THIS IS THE MISSING VERB (measured 2026-11-12T20:1xZ): **493 rows were `deferredTo: "human"`**, median
 * age 5 days, and **84 of them were landing work** — parked on an operator who was away. Nothing in the
 * delegate plane could un-park them: `cancel` is terminal, `priority` only reorders claimable rows, and
 * `hold`/`defer` are seat tools. A row parked "on the operator" with a decision the operator has ALREADY
 * given ("landing is the priority") is not waiting on anything; it is stuck.
 *
 * Refuses a `claimed` row (it is in flight) and a terminal row. Records `released` with the audience it
 * left, so the park is not silently erased from the record.
 */
export function planRelease(items, request = {}) {
  const { by, authority } = authorityOf(request);
  const at = request.at ?? new Date().toISOString();
  const reason = String(request.reason ?? "").trim();
  if (reason === "") return { ok: false, refusal: "a release needs a reason (a park the reader can explain)" };
  const ids = (request.ids ?? []).map(String);
  if (ids.length === 0) return { ok: false, refusal: "release needs at least one --id" };
  const sel = selectRows(items, ids, { allow: ["queued", "held", "deferred"] });
  if (!sel.ok) return { ok: false, refusal: sel.refusal };
  const changes = sel.rows.map((item) => ({ id: String(item.id), from: item.status, to: "queued", wasDeferredTo: item.deferredTo ?? null }));
  const transitions = sel.rows.map((item) => ({
    at,
    event: "released",
    by,
    authority,
    reason,
    ...(item.deferredTo ? { from: item.deferredTo } : {}),
  }));
  return { ok: true, changes, transitions };
}

/**
 * PLAN: cancel rows — and NAME WHAT THIS WOULD STRAND.
 *
 * The stranding warning is the whole point. Cancelling #3377 is what put #3503 and #5885 in limbo, and the
 * canceller never saw it. This plan reports, in the same breath, every non-terminal dependent that would
 * become permanently unclaimable — so the operator can repair it in the same apply.
 *
 * Refuses `claimed` rows: cancelling under a running turn is a modelled inconsistent state (the race the
 * `preempt` mechanism exists to avoid). Retire a claimed row by stopping the seat first.
 */
export function planCancel(items, request = {}) {
  const { by, authority } = authorityOf(request);
  const at = request.at ?? new Date().toISOString();
  const reason = String(request.reason ?? "").trim();
  if (reason === "") return { ok: false, refusal: "a cancel needs a reason (it is terminal and never woken for)" };
  const ids = (request.ids ?? []).map(String);
  if (ids.length === 0) return { ok: false, refusal: "cancel needs at least one --id" };
  const byId = new Map(items.map((it) => [String(it.id), it]));
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) return { ok: false, refusal: `unknown item: #${id}` };
    if (isTerminal(item)) return { ok: false, refusal: `item #${id} is already ${item.status}` };
    if (item.status === "claimed")
      return {
        ok: false,
        refusal: `item #${id} is CLAIMED — cancelling under a running turn races it. Stop the seat first (a preempt releases the claim to queued), then cancel`,
      };
  }
  const cancelled = new Set(ids);
  const strands = [];
  for (const item of items) {
    if (isTerminal(item)) continue;
    if (cancelled.has(String(item.id))) continue; // also being cancelled: not stranded
    for (const gate of item.blockedBy ?? []) {
      if (cancelled.has(String(gate))) {
        strands.push({ id: String(item.id), status: item.status, to: item.to ?? null, gateId: String(gate), subject: excerpt(item.subject) });
        break;
      }
    }
  }
  const changes = ids.map((id) => ({ id, from: byId.get(id).status, to: "cancelled" }));
  const transitions = ids.map((id) => ({ at, event: "cancelled", by, authority, reason }));
  return { ok: true, changes, transitions, strands };
}

/**
 * THE BLAST-RADIUS RULE. One apply that touches more rows than `CONFIRM_THRESHOLD` needs `confirm: true`
 * in the request, and the refusal NAMES the size so the caller can decide rather than guess.
 */
export function confirmGate(plan, request = {}) {
  const n = plan.changes?.length ?? 0;
  if (n > CONFIRM_THRESHOLD && request.confirm !== true) {
    return { ok: false, refusal: `this plan touches ${n} rows (threshold ${CONFIRM_THRESHOLD}); re-send with confirm=true if that is intended` };
  }
  return { ok: true };
}

/**
 * How many CURRENT rows does this scope catch? A directive's blast radius must be visible BEFORE it is
 * applied: "prioritise landing work" is a claim about a set, and the set is whatever matches right now
 * plus whatever is minted later. Pure, so it is testable and the proposal can print it.
 */
export function scopeMatches(directive, items = []) {
  if (!directive || typeof directive !== "object") return [];
  const seats = Array.isArray(directive.seats) ? directive.seats : [];
  const tokens = Array.isArray(directive.subjectContains)
    ? directive.subjectContains
    : typeof directive.subjectContains === "string"
      ? [directive.subjectContains]
      : [];
  const needles = tokens.map((t) => String(t ?? "").trim().toLowerCase()).filter((t) => t !== "");
  return items.filter((item) => {
    if (isTerminal(item)) return false;
    if (seats.length > 0 && seats.includes(item.to)) return true;
    const subject = String(item?.subject ?? "").toLowerCase();
    return needles.some((n) => subject.includes(n));
  });
}

/**
 * PLAN: acknowledge the notices. ROADMAP 39 named two fixes for the notice chain — suppress a notice of a
 * notice, or make notices non-claimable — and only the first shipped. Measured on this rig before the change
 * (`node tools/queue-pressure.mjs`): 461 live notices, 322 of them `queued`, 321 of those passing `workable()`,
 * and notices were 792 of the 2,002 rows minted in a 7-day window.
 *
 * A notice is RETAINED (the audit trail is the point: who was told what, and when) but it is not work, so on
 * the recipient's next read it is closed with an `acknowledged` transition rather than claimed and completed.
 * The parent id is pulled out of the subject so the trail names the item the notice is ABOUT.
 *
 * Pure: the driver calls this on the pass that wakes a seat, and the operator/delegate verb calls the SAME
 * function for a bulk sweep — one rule, two surfaces.
 */
export function planAcknowledgeNotices(items = [], request = {}) {
  const { by, authority } = authorityOf(request);
  const at = request.at ?? new Date().toISOString();
  const seats = Array.isArray(request.seats) && request.seats.length > 0 ? request.seats.map(String) : null;
  const live = (items ?? []).filter((it) => !isTerminalRow(it) && isNoticeItem(it) && (seats === null || seats.includes(it.to)));
  // A CLAIMED notice is in flight, and the module's own authority rule says a bulk plan never touches a row
  // in flight (`planCancel` refuses the same shape). The driver pre-filters `queued`, so this only guards the
  // BULK verb — the sweep over 461 live notices, five of which sat `claimed` when this was measured
  // (`node tools/queue-pressure.mjs`, noticeByStatus {"deferred":126,"held":8,"queued":322,"claimed":5}).
  // The claim releases on the seat's own turn end, and the NEXT pass acknowledges it once it is `queued`.
  const rows = live.filter((it) => it.status !== "claimed");
  const skippedClaimed = live.filter((it) => it.status === "claimed");
  const changes = rows.map((it) => ({ id: String(it.id), from: it.status, to: "done" }));
  const transitions = rows.map((it) => ({
    at,
    event: "acknowledged",
    by,
    authority,
    about: Number((String(it.subject ?? "").match(/#(\d+)/) ?? [])[1]) ?? null,
    reason: request.reason ?? "a notice is an acknowledgement, not work: closed on the recipient's read",
  }));
  return {
    ok: true,
    changes,
    transitions,
    census: { count: rows.length, skippedClaimed: skippedClaimed.map((it) => String(it.id)) },
    note: skippedClaimed.length > 0 ? `${skippedClaimed.length} notice(s) are CLAIMED and were left alone (a bulk plan never touches a row in flight); they return to queued on the seat's turn end and the next pass acknowledges them` : undefined,
  };
}

/**
 * THE REGISTRATION CENSUS: rows that are ROADMAP ledger copies sitting in the queue. `docs/ROADMAP.md` is the
 * ledger; the queue is holding a duplicate of it. The census is the plan the pm can act on — it decides
 * nothing, it only names the rows.
 */
export function registrationCensus(items = []) {
  const rows = (items ?? []).filter((it) => !isTerminalRow(it) && classifyRow(it) === "registration");
  return { count: rows.length, rows: rows.map((it) => ({ id: String(it.id), status: it.status, to: it.to ?? null, subject: excerpt(it.subject) })) };
}

/** Dispatch by action name — the single entry the broker calls, so the op has no second rule. */
export function planQueueAction(action, items, request = {}) {
  if (action === "repair-gates") return planRepairGates(items, request);
  if (action === "priority") return planPriority(items, request);
  if (action === "cancel") return planCancel(items, request);
  if (action === "defer") return planDefer(items, request);
  if (action === "directive") return planDirective(request);
  if (action === "release") return planRelease(items, request);
  if (action === "directive-clear") return { ok: true, directive: null, changes: [{ id: "control", to: "directive:none" }], transitions: [] };
  if (action === "stranded") return { ok: true, changes: [], transitions: [], census: strandedGates(items) };
  if (action === "acknowledge-notices") return planAcknowledgeNotices(items, request);
  if (action === "registrations") return { ok: true, changes: [], transitions: [], census: registrationCensus(items) };
  if (action === "pressure") return { ok: true, changes: [], transitions: [], census: queueShape(items) };
  return { ok: false, refusal: `unknown queue action: ${action} (known: repair-gates, priority, cancel, defer, release, directive, directive-clear, stranded, acknowledge-notices, registrations, pressure)` };
}
