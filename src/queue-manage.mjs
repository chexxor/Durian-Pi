/**
 * queue-manage.mjs — THE OPERATOR'S QUEUE SURFACE: select an item, change a property of it, or hand it
 * to the team to discuss (ROADMAP 381, goal mwn0dyqj-5pfi52 task-3, operator request 2026-11-18).
 *
 * WHY THIS IS A MODULE AND NOT A VERB. The operator asked to "view and manage the queue in a human-friendly
 * way", and the same core must serve TWO surfaces: the scripted/audit path (`node cli.mjs queue --manage …`)
 * and the in-process pi command (task-4). D334's rule is that ONE backend-agnostic core gets TWO thin
 * registrations — a second core is a second rule that can drift. So everything DECIDING lives here, and
 * nothing here prints to a terminal or opens a store.
 *
 * WHAT IT DELIBERATELY IS NOT: a write path. The plan rules are `src/queueops.mjs`'s (one rule, two surfaces —
 * the module's own header says "the driver calls this … and the operator/delegate verb calls the SAME
 * function"); the APPLY is the broker's command spool (`src/broker.mjs` `applyRequest`'s `op === "queue"`
 * branch, which commits with the broker's own harness). This module never calls a commit of its own, never opens
 * a `Harness`/`Storage` (one owner per process — `src/brokerread.mjs:3`), and never routes: minting, claiming
 * and assigning remain the PM's (AGENTS.md: the delegate never does the team's work).
 *
 * THE SHAPE OF AN ACT, therefore, is fixed once: PROPOSE FIRST (`planQueueAction` + `confirmGate`, writes
 * nothing), then SPOOL one intent file the broker drains. `apply` is never the default: a queue mutation nobody
 * reviewed is how #3377's cancellation stranded #3503/#5885 (docs/reviews/operator-queue-control-seam.md).
 *
 * COST (so a reader knows what an act costs): the plan is PURE — 0 I/O, under a millisecond on a 7,742-row
 * queue. An apply costs ONE spool file plus the broker's drain; awaiting the broker's reply is bounded by
 * `DEFAULT_SPOOL_WAIT_MS` (120 s, the same bound `src/readclient.mjs` uses) and the broker's own pass rate,
 * measured this window at ~1–10 s for broker start/stop. The pin (`demo/queue-manage-surface.test.mjs`) drives
 * the drain directly through the `drain` seam, so the whole surface is hermetic in ~5 s on the mocked
 * `fauxProvider` plane (`docs/runbooks/slow-loop.md`).
 */

import {
  CONFIRM_THRESHOLD,
  PRIORITIES,
  planAcknowledgeNotices,
  planCancel,
  planDirective,
  planPriority,
  planQueueAction,
  planRelease,
  planRepairGates,
  registrationCensus,
  strandedGates,
  confirmGate,
} from "./queueops.mjs";

import {
  authorizeSpoolRequest,
  brokerAlive,
  awaitIntentResult,
  intentErrorDir,
  intentResultDir,
  pendingIntentCensus,
  readBrokerState,
  readIntentError,
  readIntentResult,
  writeIntent,
  SPOOL_OPS,
  DELEGATE,
  OPERATOR,
} from "./broker.mjs";

/** How long a spooled act waits for the broker's reply before calling the outcome UNKNOWN. */
export const DEFAULT_SPOOL_WAIT_MS = 120_000;

/** The producer identity this surface stamps by default — the delegate, on the operator's authority. */
const DEFAULT_FROM = DELEGATE;

/**
 * THE ACTION VOCABULARY — declared here as the CLI's `--manage` value set, and checked against the ONE
 * dispatcher (`planQueueAction`'s own refusal text names the same ten). An action that is not in this list
 * is REFUSED BY NAME at the surface, never handed to the dispatcher as free text.
 */
export const MANAGE_ACTIONS = [
  "cancel",
  "release",
  "priority",
  "repair-gates",
  "directive",
  "directive-clear",
  "acknowledge-notices",
  "stranded",
  "registrations",
  "pressure",
];

/** Which of those WRITE something (a plan whose `changes` are applied) vs. which only COUNT. */
export const MANAGE_MUTATING = ["cancel", "release", "priority", "repair-gates", "directive", "directive-clear", "acknowledge-notices"];
export const MANAGE_CENSUS = ["stranded", "registrations", "pressure"];

/**
 * THE VERB TABLE — action -> the queueops function it calls. This exists so a PIN can NAME the function behind
 * each verb (the verification contract asks for exactly that) rather than infer it from behaviour, and so a
 * reader of the surface can see that every verb reaches `src/queueops.mjs` and nothing else.
 * `stranded`/`registrations`/`pressure` reach their census through the dispatcher, so the row names both.
 */
export const MANAGE_VERBS = {
  cancel: "planCancel (src/queueops.mjs)",
  release: "planRelease (src/queueops.mjs)",
  priority: "planPriority (src/queueops.mjs)",
  "repair-gates": "planRepairGates (src/queueops.mjs)",
  directive: "planDirective (src/queueops.mjs)",
  "directive-clear": "planQueueAction -> directive:null (src/queueops.mjs)",
  "acknowledge-notices": "planAcknowledgeNotices (src/queueops.mjs)",
  stranded: "planQueueAction -> strandedGates (src/queueops.mjs)",
  registrations: "planQueueAction -> registrationCensus (src/queueops.mjs)",
  pressure: "planQueueAction -> queueShape (src/queueclass.mjs)",
};

/** The priority vocabulary, re-exported so a registration validates `--priority` against the SAME set. */
export const MANAGE_PRIORITIES = PRIORITIES;

/**
 * PROPOSE: the plan for one action over the given rows, plus the blast-radius gate. PURE — it takes the items
 * the CALLER already read (the CLI reads them once through the read seam, the broker re-computes them from its
 * own live snapshot at apply time, so the two can never hold different rules).
 *
 * Returns `{ok:false, refusal}` when the plan or the confirm gate refuses, and otherwise the plan plus `verb`
 * (the function reached) and `authority`/`by` (who the transitions will be stamped with) — because a change
 * nobody can attribute is a change nobody can review.
 */
export function queueManagePlan(items = [], request = {}) {
  const action = String(request.action ?? "");
  if (!MANAGE_ACTIONS.includes(action)) {
    return { ok: false, refusal: `unknown manage action: ${action} (known: ${MANAGE_ACTIONS.join(", ")})` };
  }
  const plan = planQueueAction(action, items, request);
  if (!plan.ok) return { ok: false, refusal: `queue ${action}: ${plan.refusal}` };
  const gate = confirmGate(plan, request);
  if (!gate.ok) return { ok: false, refusal: `queue ${action}: ${gate.refusal}` };
  const { by, authority } = authorityOf(request);
  return {
    ok: true,
    action,
    verb: MANAGE_VERBS[action],
    proposed: plan.changes?.length ?? 0,
    changes: plan.changes ?? [],
    transitions: plan.transitions ?? [],
    strands: plan.strands ?? [],
    ...(plan.census ? { census: plan.census } : {}),
    ...(plan.lease ? { lease: plan.lease } : {}),
    ...(plan.directive ? { directive: plan.directive } : {}),
    ...(plan.note ? { note: plan.note } : {}),
    by,
    authority,
  };
}

/** The SAME authority rule queueops uses, kept here so the spool stamp and the plan stamp cannot disagree. */
function authorityOf(request = {}) {
  const who = request.from ?? request.by ?? DEFAULT_FROM;
  const authority =
    who === OPERATOR ? OPERATOR : who === DELEGATE ? "delegate (operator-authorised)" : String(request.authority ?? who);
  return { by: String(who), authority };
}

/**
 * THE CHANGE REGISTER — what an act did, in a form a human reads once.
 *
 * WHY A SEPARATE RENDERER. The JSON reply is the scripted half (byte-stable, already pinned for the read
 * verbs); the register is the human half, and its whole job is to answer "what exactly changed, who did it,
 * and what did it strand" without opening the store again. It is built from the REPLY, not from a re-read, so
 * what is printed is what was applied — a register computed from a second read is the record-goes-stale class.
 */
export function queueManageRegisterText(result, { db = null } = {}) {
  const lines = [];
  // Accept EITHER the broker's result wrapper (`{requestId,op,ok,result,at}`) or the reply itself, so a
  // registration cannot print a register whose `action`/`applied` came out `undefined` — an undefined field
  // in a printed change register reads as "nothing happened" on a row that did change.
  const head = result?.result ?? result?.head ?? result;
  const n = (v) => Number(v ?? 0);
  lines.push(`queue manage — ${head.action}${db ? `  db=${db}` : ""}`);
  lines.push(
    `proposed ${n(head.proposed)} · applied ${n(head.applied)} · by ${head.by ?? "delegate"} · authority ${JSON.stringify(head.authority ?? "delegate (operator-authorised)")}`,
  );
  const strands = head.strands ?? [];
  const changes = head.changes ?? [];
  for (const c of changes) {
    const id = String(c.id);
    if (c.gateReleased) lines.push(`  #${id} gate released: ${c.gateReleased.map((g) => `#${g}`).join(", ")}`);
    else lines.push(`  #${id} ${c.from ?? "?"} -> ${c.to}`);
  }
  for (const t of head.transitions ?? []) {
    lines.push(`  transition ${t.event} at ${t.at} by ${t.by}${t.authority ? ` (${t.authority})` : ""}${t.reason ? ` reason=${JSON.stringify(t.reason)}` : ""}${t.expiresAt ? ` until=${t.expiresAt}` : ""}`);
  }
  if (strands.length) {
    lines.push(`  THIS WOULD STRAND ${strands.length} row(s) — their gate becomes terminal-and-not-done, so they can never be claimed:`);
    for (const s of strands) lines.push(`    #${s.id} ${s.status}${s.to ? ` ->${s.to}` : ""} gated on #${s.gateId}: ${s.subject}`);
    lines.push(`  repair them in the same act: --manage repair-gates`);
  }
  if (head.census) {
    lines.push(`  census: ${head.census.count} row(s)`);
    for (const r of (head.census.rows ?? []).slice(0, 20)) lines.push(`    #${r.id} ${r.status}${r.to ? ` ->${r.to}` : ""} ${r.subject}`);
    if (head.census.count > 20) lines.push(`    … ${head.census.count - 20} more (the JSON reply carries them all)`);
  }
  if (head.scope) lines.push(`  scope now: ${head.scope.matchedNow} row(s) match — ${head.scope.ids.slice(0, 20).map((i) => `#${i}`).join(", ")}`);
  if (head.note) lines.push(`  note: ${head.note}`);
  if (n(head.applied) === 0 && n(head.proposed) > 0)
    lines.push(`  NOTHING WAS WRITTEN — this was a propose. Add --apply to write these ${n(head.proposed)} change(s).`);
  return lines.join("\n") + "\n";
}

/**
 * APPLY — send the act to the broker's spool and report the broker's OUTCOME, not a guess.
 *
 * THREE rules are enforced HERE rather than left to the caller, because the caller is the thing being
 * constrained:
 *
 *  1. AUTHORIZATION first (`authorizeSpoolRequest`): `queue` is a queue-control op, so only the operator or
 *     the delegate may spool it; a SEAT is refused with the structured code `not-operator-plane`. The residual
 *     is the broker's own — `from` is producer-stamped and same-user forgeable (detect-and-layer, security #2223).
 *  2. NO ORPHAN SPOOL. `intent.mjs` never checks that a broker is alive, so a spooled act with no broker sits
 *     in `<db>.broker.inbox` forever and reports success: a SILENT NO-OP, measured this window (`tools/broker-serve.mjs
 *     --status` reads `broker: down`, and `.broker.inbox.error` holds 90 dead-letter files nobody re-drained).
 *     So unless a `drain` is supplied (the test seam, or the broker itself driving), a store with no live broker
 *     is REFUSED before a file is written, and the spool census is printed so the caller sees what is sitting there.
 *  3. THE OUTCOME IS READ BACK. A refusal is DEAD-LETTERED, not answered; `readIntentError` names the reason, so
 *     "accepted and ignored" cannot be mistaken for "applied".
 */
export async function queueManageSpool(dbPath, request = {}, { drain = null, requireBroker = true, requestId = null, timeoutMs = DEFAULT_SPOOL_WAIT_MS, from = DEFAULT_FROM, at = null } = {}) {
  const op = "queue";
  const auth = authorizeSpoolRequest({ op, from });
  if (!auth.allowed) {
    return { ok: false, code: auth.code, refusal: auth.detail, spool: null };
  }
  const seam = typeof drain === "function" ? drain : null;
  if (requireBroker !== true || seam !== null) {
    // a caller that supplies its own `drain` IS the driver — the liveness check would be a lie here
  } else {
    const state = readBrokerState(dbPath);
    if (!brokerAlive(state)) {
      const spool = pendingIntentCensus(dbPath);
      return {
        ok: false,
        code: "no-live-broker",
        refusal: `no live broker owns ${dbPath}'s spool, so an intent written here would never be drained (today's behaviour is a silent no-op). Start the broker (or use a read-only propose) — spool now: pending=${spool.count} mutations=${spool.mutations} oldest=${spool.oldestAgeMs === null ? "n/a" : `${spool.oldestAgeMs}ms`}`,
        spool: null,
        spool_census: spool,
      };
    }
  }
  const rid = requestId ?? `qm-${String(Date.now()).padStart(16, "0")}-${Math.random().toString(36).slice(2, 8)}`;
  const intent = {
    op,
    to: "queue",
    from,
    requestId: rid,
    createdAt: at ?? new Date().toISOString(),
    ...request,
  };
  const file = writeIntent(dbPath, intent);
  if (seam !== null) await seam();
  else await awaitIntentResult(dbPath, rid, { timeoutMs });
  const result = readIntentResult(dbPath, rid);
  if (result) return { ok: true, requestId: rid, spool: file, reply: result.result ?? result, result };
  const reason = readIntentError(dbPath, rid);
  if (reason) return { ok: false, code: "dead-lettered", refusal: String(reason).trim(), spool: file };
  return {
    ok: false,
    code: "no-result-yet",
    refusal: `the intent was written but no result or dead-letter arrived for ${rid}`,
    spool: file,
    spool_census: pendingIntentCensus(dbPath),
  };
}

/**
 * THE DISCUSS/REVISE HAND-OFF — pure composition, then ONE spooled `message`.
 *
 * This is the second tier of the operator's request ("discuss or revise this item … and have that seat take
 * actions related to it — decompose, assign, claim, create items, delete items — within the bounds of
 * authorized actions for that delegate/seat"). The SURFACE takes NO queue action of its own: it composes a
 * sentence and puts it in the seat's conversation, where the seat's OWN authorized tools do the work. That is
 * why `queueActions` is a declared empty list — the pin asserts it, and asserts the queue rows are byte-identical
 * afterwards. An affordance that quietly also reordered the queue would be indistinguishable from the seat's act.
 *
 * The audience must be a REGISTERED SEAT: the broker's `message` op looks up `seats[request.to]` and throws for
 * anything else (dead-lettered). "Discuss it with the delegate" is therefore this session itself — the operator's
 * words, not a spool.
 */
export function queueDiscussDraft({ item = null, to = null, note = "", action = "discuss" } = {}) {
  const aud = String(to ?? "").trim();
  if (aud === "") return { ok: false, refusal: "a discuss/revise hand-off needs an audience: --to <seat>" };
  const verb = String(action || "discuss").trim().toLowerCase();
  if (!["discuss", "revise"].includes(verb)) {
    return { ok: false, refusal: `hand-off action must be discuss or revise, got: ${action}` };
  }
  const id = item ? `#${item.id} ` : "";
  const subject = item?.subject ? String(item.subject) : "";
  const lines = [
    `${verb === "revise" ? "REVISE" : "DISCUSS"} — queue item ${id || "(unstated)"}${subject ? `: ${subject}` : ""}`.trim(),
    "",
    String(note ?? "").trim(),
    "",
    "Act within this seat's authorized tools (decompose, claim, re-order, open/close rows as your role allows).",
    "The queue surface that sent this changed NOTHING itself — see `cli.mjs queue` and `cli.mjs events` for what your tools wrote.",
  ].filter((l) => l !== undefined);
  return {
    ok: true,
    action: verb,
    to: aud,
    item: item ? { id: String(item.id), status: item.status ?? null, subject } : null,
    content: lines.join("\n"),
    // DECLARED, and asserted by the pin: this hand-off performs no queue action.
    queueActions: [],
    spool: { op: "message", to: aud, content: lines.join("\n") },
  };
}

/** Send one discuss/revise hand-off. `message` is the spool op that submits into a seat's conversation. */
export async function queueDiscussSpool(dbPath, draft, { drain = null, requireBroker = true, requestId = null, at = null, from = DEFAULT_FROM } = {}) {
  if (!draft?.ok) return { ok: false, code: "draft-refused", refusal: draft?.refusal ?? "no draft" };
  const auth = authorizeSpoolRequest({ op: "message", from });
  if (!auth.allowed) return { ok: false, code: auth.code, refusal: auth.detail, spool: null };
  const seam = typeof drain === "function" ? drain : null;
  if (requireBroker !== true || seam === null) {
    // same rule as the queue apply: a message with nobody to drain it is a silent no-op too
    const state = readBrokerState(dbPath);
    if (!brokerAlive(state)) {
      return { ok: false, code: "no-live-broker", refusal: `no live broker owns ${dbPath}'s spool; the message would never reach the seat.`, spool: null };
    }
  }
  const rid = requestId ?? `qm-msg-${String(Date.now()).padStart(16, "0")}-${Math.random().toString(36).slice(2, 8)}`;
  const file = writeIntent(dbPath, { op: "message", to: draft.to, content: draft.content, requestId: rid, from, createdAt: at ?? new Date().toISOString() });
  if (seam !== null) await seam();
  else await awaitIntentResult(dbPath, rid, { timeoutMs: DEFAULT_SPOOL_WAIT_MS });
  const result = readIntentResult(dbPath, rid);
  if (result) return { ok: true, requestId: rid, spool: file, reply: result.result ?? result, result, queueActions: [] };
  const reason = readIntentError(dbPath, rid);
  if (reason) return { ok: false, code: "dead-lettered", refusal: String(reason).trim(), spool: file };
  return { ok: false, code: "no-result-yet", refusal: `no reply for ${rid}`, spool: file };
}

/** The spool dirs a caller may need to read the outcome from (re-exported so a registration has one source). */
export const MANAGE_INTENT_DIRS = { inbox: (db) => `${db}.broker.inbox`, out: intentResultDir, error: intentErrorDir };
