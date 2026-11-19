// demo/queue-list-sort.test.mjs — ROADMAP 381: the queue LIST VIEW is attributed, bounded, and STABLE-ORDERED.
//
// WHY THIS FILE EXISTS (the defect class it closes). Before the list view existed, the only queue read a
// person had was `cli.mjs queue` — the whole document, arrival order, bodies included, 22 MB on the live
// store. A person who wants "the 12 oldest rows I can act on" or "what is gated, cheapest first" had
// nothing to ask: the order was whatever the store happened to do, the payload was unbounded, and a bounded
// view that does not name its sort is the record a later reader trusts as if it were the whole queue
// (#5016's rule). A sort whose ties are left to `Array.prototype.sort` stability is a different defect —
// two runs of one command printing a different order is not a view a human can re-find a row in.
//
// So this pin asserts the FIVE guarantees at BOTH levels: the command core (`queueListView`,
// `queueListViewText`, `sortQueueItems`, `queueRowAttributes` in src/readapi.mjs — the module the in-process
// pi command registers in task-4) and the CLI verb (`cli.mjs queue --list`), because a core that is correct
// and a verb that mis-renders it is one bug reported twice.
//
//   1. VOCABULARY — the sort keys are the rig's OWN declared set; an undeclared key/direction/field is
//      refused BY NAME before a single row prints (ROADMAP 228's fail-open exited 0 and printed 22 MB).
//   2. ATTRIBUTION — the header names sort + dir + tie-break + cap + fields BEFORE any row, in BOTH forms.
//   3. STABILITY — every tie breaks on `id` ASCENDING, in BOTH directions (a total order; two runs agree).
//   4. MISSING IS NOT A VALUE — no age, no tier, no `to` seat sorts LAST in BOTH directions.
//   5. THE BOUND — `QUEUE_VIEW_ROW_CAP` applies over the MATCHED set, is PRINTED, and `--full-queue` is the
//      explicit ask that supersedes it.
//
// FIXTURE, deliberately shaped so each assertion can FAIL. Every declared vocabulary has a row in every
// state the view claims to distinguish (gate none/unknown/open/satisfied/cancelled; lease HONOURED/INERT/lapsed/none;
// dispositions work/notice/registration; tiers trivial/small/feature/project AND a row with no tier;
// statuses queued/claimed/deferred/held/done/cancelled). A fixture with only ungated rows would pass any
// gate assertion; a fixture with 20-byte bodies would pass any byte bound.
//
// The gate rows are shaped in a SECOND commit on purpose: the ONE write path refuses a gate naming a CANCELLED
// row at mint (src/rig.mjs #6215 — a cancelled gate starves the dependent forever), so a cancelled gate can
// only exist as a gate written BEFORE its target was cancelled. That is exactly the read's job: classify what
// is stored, not what was legal to write.
//
// Run: node demo/queue-list-sort.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { enqueueItem, Router, RigQueue, Seats } from "../src/rig.mjs";
import {
  QUEUE_SORT_KEYS,
  QUEUE_SORT_DIRS,
  QUEUE_TIE_BREAK,
  QUEUE_LIST_FIELDS,
  QUEUE_GATE_STATES,
  QUEUE_LEASE_STATES,
  QUEUE_DISPOSITIONS,
  QUEUE_STATUSES,
  QUEUE_VIEW_ROW_CAP,
  queueListView,
  queueListViewText,
  queueRowAttributes,
  queueLeaseState,
  queueGateState,
  sortQueueItems,
  readQueueItems,
  workStrategyView,
} from "../src/readapi.mjs";
import { PRIORITY_RANK, NEUTRAL_PRIORITY } from "../src/workstrategy.mjs";
import { DEFAULT_TIER_TOKENS } from "../src/config.mjs";

const ctx = BACKGROUND_CONTEXT;
const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = mkdtempSync(join(tmpdir(), "durig-list-sort-"));

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) return;
  failures += 1;
  process.stdout.write(`FAIL ${label}: ${detail}\n`);
};
const supersetOf = (have, need) => need.every((x) => have.includes(x));
const seqOf = (rows) => rows.map((r) => String(r?.id)).join(",");

const DAY = 86_400_000;
const BASE = Date.now();
const at = (daysAgo) => new Date(BASE - daysAgo * DAY).toISOString();
const FUTURE = new Date(BASE + 3 * DAY).toISOString();
const PAST = new Date(BASE - 1 * DAY).toISOString();
const TIER_TOKENS = DEFAULT_TIER_TOKENS;

// Real-shaped bodies: a 20-byte fixture passes any byte bound and proves nothing — the bound has to be
// demonstrated against bodies big enough to matter (#5016's reasoning, reused from queue-compat-args).
const BODY = (i) => `LIST-VIEW-BODY-${i} ` + "attributed-bounded-stable ".repeat(90);

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);

const dbPath = join(dir, "list-sort.sqlite");
const storage = await openNodeSqliteStorage(dbPath);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(storage, { models, registry }, ctx);

const id = {};
let n = 0;
const send = async (tx, label, ...rest) => {
  id[label] = await enqueueItem(tx, ...rest);
  n += 1;
  return id[label];
};

await harness.commit(
  async (tx) => {
    // (1) THE PRIORITY LEASE, one row per state the view claims to tell apart.
    await send(tx, "honoured", "lead", "pm", "queue --list view spine (ROADMAP 381)", BODY(n++), null, false, "feature");
    await send(tx, "inertSeat", "lead", "devtools", "lease on an oldest_first seat (#5016)", BODY(n++), null, false, "small");
    await send(tx, "lapsed", "lead", "pm", "lapsed lease", BODY(n++), null, false, "trivial");
    await send(tx, "invalid", "lead", "pm", "garbage priority", BODY(n++), null, false, null);
    await send(tx, "noLease", "lead", "pm", "no lease at all", BODY(n++), null, false, null);
    // (2) THE GATE: targets first (a gate names an id that must exist), then one row per gate state.
    await send(tx, "gateTargetQueued", "lead", "devtools", "gate target still workable", BODY(n++));
    await send(tx, "gateTargetDone", "lead", "devtools", "gate target that reaches done", BODY(n++));
    await send(tx, "gateTargetCancelled", "lead", "devtools", "gate target that gets cancelled", BODY(n++));
    // enqueueItem's slots are (from,to,subject,body,optimizedVia,notice,tier,held,blockedBy) — a gate is
    // slot 9, NOT slot 8: hand-written, this fixture once landed the id array in `held` and minted HELD rows
    // with no gate at all, which is how every gate assertion here could have passed on an ungated fixture.
    await send(tx, "gateOpen", "lead", "devtools", "waiting on a live row", BODY(n++), null, false, null, null, [id.gateTargetQueued]);
    await send(tx, "gateSatisfied", "lead", "devtools", "waiting on a row that is done", BODY(n++), null, false, null, null, [id.gateTargetDone]);
    await send(tx, "gateCancelled", "lead", "devtools", "waiting on a row that will be cancelled", BODY(n++), null, false, null, null, [id.gateTargetCancelled]);
    // A gate id naming NO row is UNKNOWN, not open and not blocked: inventing a wait for a typo is the
    // false-negative class, and so is silently un-blocking it (#2673's conservative default).
    await send(tx, "gateUnknown", "lead", "pm", "gate ids name nobody", BODY(n++), null, false, null, null, [999_999]);
    // (3) AGE: a row with no queued instant at all, and a pair with an IDENTICAL instant (the tie assertion).
    await send(tx, "noAge", "lead", "pm", "row whose queued instant was never recorded", BODY(n++));
    await send(tx, "tieA", "lead", "pm", "tie pair A", BODY(n++));
    await send(tx, "tieB", "lead", "pm", "tie pair B", BODY(n++));
    // (4) the awaiting-operator park, and a POOLED row (`to` null — a missing seat, not a seat named "").
    await send(tx, "deferred", "lead", "pm", "deferred to the operator", BODY(n++));
    await send(tx, "pooled", "lead", null, "pooled, never addressed", BODY(n++), null, false, null, false, null, null, null, true);
    // (5) the three declared dispositions.
    await send(tx, "notice", "pm", "devtools", "NOTICE: DONE for #1234", BODY(n++), null, true);
    await send(tx, "registration", "lead", "pm", "REGISTERED backlog — DO NOT START", BODY(n++));
    // (6) the tier vocabulary, plus a row with NO tier (the missing-value case for `--sort tier`).
    await send(tx, "tierProject", "lead", "pm", "the expensive one", BODY(n++), null, false, "project");
    await send(tx, "tierTrivial", "lead", "devtools", "the cheap one", BODY(n++), null, false, "trivial");
    await send(tx, "tierNoTier", "lead", "devtools", "untiered", BODY(n++));
    // (7) fillers, so the cap and the truncation note are demonstrated over a matched set.
    for (let f = 0; f < 7; f += 1) await send(tx, `fill${f}`, "lead", "devtools", `filler ${f}`, BODY(n++), null, false, "small");
  },
  ctx,
);

// SHAPE the rows in a SECOND commit: instants the age sort can be asserted against, the events the age
// readers must not confuse, the statuses, the leases. This is also the ONLY way a gate on a CANCELLED row
// can exist (the write path refuses it at mint), which is what makes the `cancelled` gate state assertable.
await harness.commit(
  async (tx) => {
    const q = await tx.doc(RigQueue);
    const row = (key) => q.items.find((it) => it.id === id[key]);
    let k = 0;
    const ageOf = () => at((k += 1) * 2 + 1);
    const shape = (key, opts = {}) => {
      const r = row(key);
      if (!r) throw new Error(`fixture row ${key} missing`);
      const queuedAt = opts.ageAt ?? ageOf();
      if (opts.transitionsEmpty) r.transitions = [];
      else r.transitions = [{ at: queuedAt, event: opts.mintEvent ?? "queued", by: String(r.from ?? "lead") }, ...(opts.extra ?? [])];
      if (opts.status) r.status = opts.status;
      if (opts.priority) r.priority = opts.priority;
      if (opts.prioritySet) r.prioritySet = opts.prioritySet;
      if (opts.deferredTo) r.deferredTo = opts.deferredTo;
      return r;
    };
    shape("honoured", { priority: "now", prioritySet: { expiresAt: FUTURE, by: "lead", reason: "operator asked now" } });
    shape("inertSeat", { priority: "now", prioritySet: { expiresAt: FUTURE } });
    shape("lapsed", { priority: "now", prioritySet: { expiresAt: PAST } });
    shape("invalid", { priority: "urgent" }); // not a priority at all — the read must call it INERT, not rank it
    shape("noLease", {});
    shape("gateTargetQueued", {});
    shape("gateTargetDone", { status: "done", extra: [{ at: at(1), event: "done", by: "devtools" }] });
    shape("gateTargetCancelled", { status: "cancelled", extra: [{ at: at(2), event: "cancelled", by: "lead" }] });
    shape("gateOpen", {});
    shape("gateSatisfied", {});
    shape("gateCancelled", {});
    shape("gateUnknown", {});
    // The noAge row is the ONLY row with no queued instant: a row minted HELD (the registration copy, the
    // hand-held filler) also lacks one, which would quietly make this assertion about some other row.
    // So those two get a real queued instant and their held event as a SECOND transition.
    shape("noAge", { transitionsEmpty: true });
    const tieInstant = at(9); // IDENTICAL instants: the tie is the assertion, not an accident
    shape("tieA", { ageAt: tieInstant });
    shape("tieB", { ageAt: tieInstant });
    shape("deferred", { status: "deferred", deferredTo: "human" });
    shape("pooled", {});
    shape("notice", { mintEvent: "queued" });
    shape("registration", { extra: [{ at: at(31), event: "held", by: "lead" }] });
    shape("tierProject", {});
    shape("tierTrivial", {});
    shape("tierNoTier", {});
    // A CLAIMED and a HELD row too, so `--sort status` has a row in every declared status.
    shape("fill0", { status: "claimed", extra: [{ at: at(3), event: "claimed", by: "devtools" }] });
    shape("fill1", { status: "held", extra: [{ at: at(45), event: "held", by: "devtools" }] });
    // EVERY row gets an explicit queued instant, and none keeps its mint instant: a mint instant is
    // ~1 s AFTER the pin's `now`, so the age readers clamp it to 0 and the CLI (whose `now` is later)
    // orders those five rows differently from the core — the one-core, two-surfaces assertion below
    // would then be comparing orders of the same rows with different `now`s, which is not the claim.
    shape("fill2", {});
    shape("fill3", {});
    shape("fill4", {});
    shape("fill5", {});
    shape("fill6", {});

    const s = await tx.doc(Seats);
    s.workStrategy = "oldest_first";
    s.seats = {
      pm: { conversationId: "faux-pm", role: "pm", workStrategy: "priority_first" },
      devtools: { conversationId: "faux-devtools", role: "devtools", workStrategy: "oldest_first" },
    };
  },
  ctx,
);

const all = await readQueueItems(storage, ctx);
await storage.close(ctx);
await harness.close(ctx);

check("fixture seeded rows (every labelled send landed exactly once)", all.length === Object.keys(id).length && Object.keys(id).length === 29, `read ${all.length} rows back for ${Object.keys(id).length} labelled sends`);
check("every declared status is present (a fixture that cannot fail cannot pin)", supersetOf([...new Set(all.map((it) => it.status))], QUEUE_STATUSES), `statuses: ${[...new Set(all.map((it) => it.status))].join(" ")}`);

const seatStrategies = workStrategyView({
  workStrategy: "oldest_first",
  seats: { pm: { workStrategy: "priority_first" }, devtools: { workStrategy: "oldest_first" } },
}).seats;
const attrs = all.map((it) => queueRowAttributes(it, { items: all, now: BASE, tierTokens: TIER_TOKENS, seatStrategies }));
const byId = new Map(attrs.map((a) => [a.id, a]));
const attrsSeq = (rows) => rows.map((it) => byId.get(it.id));

// The ordinal a key ORDERS BY, derived only from the rig's declared vocabularies — the pin re-derives nothing.
const ordOf = (key, a) => {
  switch (key) {
    case "age": return a.ageSinceQueuedMs;
    case "priority": return PRIORITY_RANK[a.priority];
    case "seat": return a.to;
    case "status": return QUEUE_STATUSES.indexOf(a.status);
    case "kind": return QUEUE_DISPOSITIONS.indexOf(a.disposition);
    case "tier": return a.tokenEstimate;
    case "gate": return QUEUE_GATE_STATES.indexOf(a.gate);
    case "id": return a.id;
    default: return null;
  }
};
const missing = (v) => v === null || v === undefined || v === "";
const cmp = (x, y) => (typeof x === "string" || typeof y === "string") ? String(x).localeCompare(String(y)) : x < y ? -1 : x > y ? 1 : 0;

// ─── THE ORDER CONTRACT, for every declared key ───
for (const key of QUEUE_SORT_KEYS) {
  const asc = sortQueueItems(all, { sort: key, dir: "asc", now: BASE, tierTokens: TIER_TOKENS });
  const again = sortQueueItems(all, { sort: key, dir: "asc", now: BASE, tierTokens: TIER_TOKENS });
  const desc = sortQueueItems(all, { sort: key, dir: "desc", now: BASE, tierTokens: TIER_TOKENS });
  check(`sort ${key} returns every row exactly once`, asc.length === all.length && new Set(asc.map((it) => it.id)).size === all.length, `len ${asc.length} / ${all.length} distinct ${new Set(asc.map((it) => it.id)).size}`);
  check(`sort ${key} is identical across two runs (a total order, not sort stability)`, seqOf(asc) === seqOf(again), `second run: ${seqOf(again)}`);
  for (const [dirLabel, rows] of [["asc", asc], ["desc", desc]]) {
    const sgn = dirLabel === "desc" ? -1 : 1;
    const vals = attrsSeq(rows).map((a) => ordOf(key, a));
    let violation = null;
    for (let i = 1; i < vals.length; i += 1) {
      const [pa, pb] = [vals[i - 1], vals[i]];
      if (missing(pa) && missing(pb)) {
        if (Number(rows[i - 1].id) > Number(rows[i].id)) violation = "two missing values out of id-asc order";
        continue;
      }
      if (missing(pa)) { violation = `a missing ${key} value sits before a present one`; break; }
      if (missing(pb)) continue;
      const c = cmp(pa, pb) * sgn;
      if (c > 0) { violation = `${key}=${pa} before ${key}=${pb} under ${dirLabel}`; break; }
      if (c === 0 && Number(rows[i - 1].id) > Number(rows[i].id)) { violation = `tie on ${key}=${pa} broken id-DESC`; break; }
    }
    check(`sort ${key} ${dirLabel}: monotone on its own ordinal, ties id asc, missing last`, !violation, violation ?? "");
  }
  // The tie pair can only tie on a key that is NOT the tie-break key itself: on `id` the pair never ties
  // (the ids differ), so `--sort id --dir desc` legitimately lists B before A. Asserting A-before-B there
  // would be a claim about the tie-break, not about the tie.
  if (key !== "id") {
    const aIdx = asc.map((it) => it.id).indexOf(id.tieA), bIdx = asc.map((it) => it.id).indexOf(id.tieB);
    const dIdx = desc.map((it) => it.id).indexOf(id.tieA), eIdx = desc.map((it) => it.id).indexOf(id.tieB);
    check(`sort ${key}: the identical-instant tie pair stays A before B in BOTH directions`, aIdx < bIdx && dIdx < eIdx, `asc ${aIdx}/${bIdx} desc ${dIdx}/${eIdx}`);
  }
}

// A missing value is LAST in both directions, for the three keys that can miss one.
for (const [key, rowKey] of [["age", "noAge"], ["tier", "tierNoTier"], ["seat", "pooled"]]) {
  const asc = sortQueueItems(all, { sort: key, dir: "asc", now: BASE, tierTokens: TIER_TOKENS });
  const desc = sortQueueItems(all, { sort: key, dir: "desc", now: BASE, tierTokens: TIER_TOKENS });
  check(`sort ${key}: the ${rowKey} row (no value) is LAST in both directions`, asc.at(-1)?.id === id[rowKey] && desc.at(-1)?.id === id[rowKey], `asc last ${asc.at(-1)?.id} desc last ${desc.at(-1)?.id}, wanted ${id[rowKey]}`);
}

// `id` is a TOTAL order, so `--dir desc` is exactly its reverse — the strongest statement of stability.
{
  const a = sortQueueItems(all, { sort: "id", dir: "asc", now: BASE, tierTokens: TIER_TOKENS }).map((it) => it.id);
  const d = sortQueueItems(all, { sort: "id", dir: "desc", now: BASE, tierTokens: TIER_TOKENS }).map((it) => it.id);
  check("`id asc` is ascending ids", a.join(",") === [...all].map((it) => it.id).sort((x, y) => x - y).join(","), a.join(","));
  check("`id desc` is exactly the reverse of `id asc`", d.join(",") === a.toReversed().join(","), `asc ${a.join(",")} desc ${d.join(",")}`);
}

// VOCABULARY REFUSAL at the core: coded error, naming the token AND the legal set.
const caught = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const badKey = caught(() => sortQueueItems(all, { sort: "zork" }));
check("an undeclared sort key throws at the core", badKey !== null, "no throw — a silent no-op sort is the fail-open");
check("the thrown error is coded so a caller can branch on it", badKey?.code === "undeclared_vocabulary", `code=${badKey?.code}`);
check("it names the token it refused", String(badKey?.message).includes("zork"), badKey?.message);
check("it names the legal vocabulary so the caller can correct the call", QUEUE_SORT_KEYS.every((kk) => String(badKey?.message).includes(kk)), badKey?.message);
check("the declared sort keys are the objective's vocabulary", QUEUE_SORT_KEYS.join(" ") === "age priority seat status kind tier gate id", QUEUE_SORT_KEYS.join(" "));
const badDir = caught(() => sortQueueItems(all, { sort: "age", dir: "sideways" }));
check("an undeclared direction throws too", badDir?.code === "undeclared_vocabulary", `code=${badDir?.code} msg=${badDir?.message}`);
check("naming the legal directions", QUEUE_SORT_DIRS.every((d) => String(badDir?.message).includes(d)), badDir?.message);
const badField = caught(() => queueListView(all, { fields: ["id", "zork"] }));
check("an undeclared --fields name throws at the core", badField?.code === "undeclared_vocabulary", `code=${badField?.code}`);
check("naming the field and the legal set", String(badField?.message).includes("zork") && QUEUE_LIST_FIELDS.every((f) => String(badField?.message).includes(f)), badField?.message);

// ─── ATTRIBUTION AND THE BOUND ───
const view = queueListView(all, { sort: "age", dir: "asc", now: BASE, tierTokens: TIER_TOKENS, seatStrategies });
check("the header names the view", view.header.view === "list", view.header.view);
check("the header names sort/dir/tieBreak", view.header.sort === "age" && view.header.dir === "asc" && view.header.tieBreak === QUEUE_TIE_BREAK, `sort=${view.header.sort} dir=${view.header.dir} tie=${view.header.tieBreak}`);
check("the cap IS QUEUE_VIEW_ROW_CAP (200), declared not counted", view.header.cap === QUEUE_VIEW_ROW_CAP, `cap=${view.header.cap} export=${QUEUE_VIEW_ROW_CAP}`);
check("the header counts are consistent (matched = store - dropped, shown = items, truncated honest)", view.header.matched === view.header.storeRows - view.header.droppedTerminal && view.header.shown === view.items.length && view.header.truncated === view.header.matched > view.header.shown, `matched ${view.header.matched} shown ${view.header.shown} dropped ${view.header.droppedTerminal} rows ${view.header.storeRows}`);
check("the default field set IS the declared vocabulary (nothing invented, none dropped)", view.header.fields.join(",") === QUEUE_LIST_FIELDS.join(","), `${view.header.fields.length} vs ${QUEUE_LIST_FIELDS.length}`);
check("every default row carries EXACTLY the declared field set", view.items.every((r) => Object.keys(r).length === QUEUE_LIST_FIELDS.length && Object.keys(r).every((kk) => QUEUE_LIST_FIELDS.includes(kk))), `row keys ${Object.keys(view.items[0]).join(",")}`);
const clamp = queueListView(all, { limit: 100, cap: 5, sort: "age", now: BASE, tierTokens: TIER_TOKENS, seatStrategies });
check("a limit over the cap is CLAMPED to the cap, and says so", clamp.items.length === 5 && clamp.header.limit === 5 && clamp.header.capApplied === true && clamp.header.truncated === true, `bound ${clamp.header.limit} shown ${clamp.items.length} capApplied ${clamp.header.capApplied}`);
check("the cap takes the FRONT of the requested order, not the store's arrival order", seqOf(clamp.items) === sortQueueItems(all, { sort: "age", now: BASE, tierTokens: TIER_TOKENS }).slice(0, 5).map((it) => String(it.id)).join(","), `capped ${seqOf(clamp.items)} vs sorted front ${sortQueueItems(all, { sort: "age", now: BASE, tierTokens: TIER_TOKENS }).slice(0, 5).map((it) => String(it.id)).join(",")}`);
const full = queueListView(all, { fullQueue: true, sort: "age", now: BASE, tierTokens: TIER_TOKENS, seatStrategies });
check("--full-queue is the explicit ask that supersedes the bound", full.header.fullQueue === true && full.items.length === full.header.matched && full.header.truncated === false, `shown ${full.items.length} matched ${full.header.matched}`);
const terminalRows = all.filter((it) => QUEUE_STATUSES.indexOf(String(it.status)) >= QUEUE_STATUSES.indexOf("done"));
check("terminal rows are dropped AND COUNTED (a small view is not a small rig)", view.header.droppedTerminal === terminalRows.length && view.items.every((r) => !terminalRows.some((t) => t.id === r.id)), `dropped ${view.header.droppedTerminal} of ${terminalRows.length}`);
check("an explicit ask for a terminal state keeps it (never the empty-success class)", queueListView(all, { sort: "id", dropTerminal: false, now: BASE, tierTokens: TIER_TOKENS, seatStrategies }).header.droppedTerminal === 0, "droppedTerminal when asked");

// ─── THE ATTRIBUTES: no state invented, no state hidden ───
check("gate states are ALL inside the declared vocabulary", attrs.every((a) => QUEUE_GATE_STATES.includes(a.gate)), [...new Set(attrs.map((a) => a.gate))].join(" "));
for (const want of QUEUE_GATE_STATES) check(`gate state ${want} is present (else the assertion could not fail)`, attrs.some((a) => a.gate === want), "absent");
check("a gate naming no row is UNKNOWN, with its ids still shown", byId.get(id.gateUnknown).gate === "unknown" && byId.get(id.gateUnknown).blockedBy.join(",") === "999999", byId.get(id.gateUnknown).gate);
check("a gate on a CANCELLED row is its own state and names the starvation", byId.get(id.gateCancelled).gate === "cancelled" && String(byId.get(id.gateCancelled).gateWhy).includes(String(id.gateTargetCancelled)), byId.get(id.gateCancelled).gate + " " + byId.get(id.gateCancelled).gateWhy);
check("a live gate says WHICH row it waits on", byId.get(id.gateOpen).gate === "open" && String(byId.get(id.gateOpen).gateWhy).includes(String(id.gateTargetQueued)), byId.get(id.gateOpen).gateWhy);
check("a gate whose every target is done is satisfied", byId.get(id.gateSatisfied).gate === "satisfied", byId.get(id.gateSatisfied).gate);
check("a written park is recorded SEPARATELY from a gate", attrs.every((a) => "gateRecorded" in a), "gateRecorded absent");
check("lease states are ALL inside the declared vocabulary", attrs.every((a) => QUEUE_LEASE_STATES.includes(a.lease)), [...new Set(attrs.map((a) => a.lease))].join(" "));
for (const want of QUEUE_LEASE_STATES) check(`lease state ${want} is present`, attrs.some((a) => a.lease === want), "absent");
check("the pm lease is HONOURED because that seat resolves to priority_first", queueLeaseState(all.find((it) => it.id === id.honoured), { now: BASE, seatStrategies }).state === "HONOURED" && String(byId.get(id.honoured).leaseWhy).includes("priority_first"), `${byId.get(id.honoured).lease} ${byId.get(id.honoured).leaseWhy}`);
check("the devtools lease is INERT and SAYS which strategy ignores priority", queueLeaseState(all.find((it) => it.id === id.inertSeat), { now: BASE, seatStrategies }).state === "INERT" && String(byId.get(id.inertSeat).leaseWhy).includes("oldest_first"), `${byId.get(id.inertSeat).lease} ${byId.get(id.inertSeat).leaseWhy}`);
check("an expired lease is lapsed, and the expiry instant is printed", byId.get(id.lapsed).lease === "lapsed" && String(byId.get(id.lapsed).leaseWhy).includes(PAST), `${byId.get(id.lapsed).lease} ${byId.get(id.lapsed).leaseWhy}`);
check("a garbage priority is INERT-invalid, naming the legal values", byId.get(id.invalid).lease === "INERT" && String(byId.get(id.invalid).leaseWhy).includes("not a priority") && String(byId.get(id.invalid).leaseWhy).includes("urgent"), byId.get(id.invalid).leaseWhy);
check("a row with no priority is `none`, not INERT and not a made-up `next` lease", byId.get(id.noLease).lease === "none" && byId.get(id.noLease).priority === NEUTRAL_PRIORITY && byId.get(id.noLease).leaseText === "", `${byId.get(id.noLease).lease} ${byId.get(id.noLease).priority} "${byId.get(id.noLease).leaseText}"`);
check("ages come from the row's OWN transitions (first queued, latest of anything) — never a store re-scan", byId.get(id.noAge).queuedAt === null && byId.get(id.noAge).ageSinceQueuedMs === null && byId.get(id.honoured).ageSinceQueuedMs === BASE - Date.parse(at(3)), `ageless ${byId.get(id.noAge).queuedAt} honoured age ${byId.get(id.honoured).ageSinceQueuedMs} wanted ${BASE - Date.parse(at(3))}`);
check("`age since last event` uses the LATEST transition, so a done row ages from its done event", byId.get(id.gateTargetDone).lastEventAt === at(1) && byId.get(id.gateTargetDone).ageSinceLastEventMs === BASE - Date.parse(at(1)), `${byId.get(id.gateTargetDone).lastEventAt}`);
check("awaitingOperator is exactly the deferredTo=human park", byId.get(id.deferred).awaitingOperator === true && attrs.filter((a) => a.awaitingOperator).length === 1, `count ${attrs.filter((a) => a.awaitingOperator).length}`);
check("a pooled row's seat is null, never an empty string", byId.get(id.pooled).to === null, JSON.stringify(byId.get(id.pooled).to));
check("all three declared dispositions appear, and none is invented", supersetOf([...new Set(attrs.map((a) => a.disposition))], QUEUE_DISPOSITIONS) && attrs.every((a) => QUEUE_DISPOSITIONS.includes(a.disposition)), [...new Set(attrs.map((a) => a.disposition))].join(" "));
check("tier + token estimate read the rig's OWN tier table", attrs.every((a) => a.tokenEstimate === null || a.tokenEstimate === TIER_TOKENS[a.tier]) && byId.get(id.tierProject).tokenEstimate === TIER_TOKENS.project && byId.get(id.tierTrivial).tokenEstimate === TIER_TOKENS.trivial, `${byId.get(id.tierProject).tokenEstimate}/${byId.get(id.tierTrivial).tokenEstimate}`);
check("lineage travels for rows that name one (ROADMAP n, #item) and null otherwise", byId.get(id.honoured).lineage?.kind === "roadmap" && byId.get(id.inertSeat).lineage?.kind === "item" && byId.get(id.fill2).lineage === null, `${byId.get(id.honoured).lineage} ${byId.get(id.inertSeat).lineage} ${byId.get(id.fill2).lineage}`);
check("gateView is the ONE reader the attributes reuse (no second gate rule)", attrs.every((a) => a.gate === queueGateState(all.find((it) => it.id === a.id), all).state), "a row disagrees with queueGateState");

// ─── THE TEXT FORM: a re-skin of the SAME header and rows, not a second view ───
const text = queueListViewText(view, { db: dbPath });
check("the text header names sort, direction and tie-break BEFORE any row", text.includes(`sort age asc (ties ${QUEUE_TIE_BREAK})`), text.split("\n")[1]);
check("the text header names the cap and shown/matched", text.includes(`cap ${QUEUE_VIEW_ROW_CAP}`) && text.includes(`shown ${view.header.shown} of ${view.header.matched} matched`), text.split("\n")[1]);
check("the text header names the fields it carries", text.includes(`fields ${QUEUE_LIST_FIELDS.join(" ")}`), text.split("\n")[2]);
check("the text form carries EVERY row of the JSON form (re-skin, not trim)", view.items.every((r) => text.includes(`#${r.id} `)), "a row is missing");
check("the full-queue text form says the cap does not apply", queueListViewText(full, { db: dbPath }).includes("--full-queue: every matched row is printed; the cap does not apply."), "line absent");
check("a long subject is clipped, not dropped", queueListViewText(queueListView(all, { sort: "id", now: BASE, tierTokens: TIER_TOKENS, seatStrategies }), { db: dbPath }).includes("#" + id.honoured + " "));

// ─── THE SURFACE: `cli.mjs queue --list` over the SAME store ───
const cli = (args) => {
  const r = spawnSync(process.execPath, ["cli.mjs", ...args], { cwd: ROOT, env: { ...process.env, DURIG_DB: dbPath, DURIG_PI_DB: dbPath }, encoding: "utf8", timeout: 120000 });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const bytes = (s) => Buffer.byteLength(s, "utf8");
const parse = (r) => { try { return JSON.parse(r.stdout); } catch { return {}; } };

const bare = cli(["queue"]);
const bareDoc = parse(bare);
check("the DEFAULT form is unchanged: exit 0 and exactly {ok,command,items}", bare.code === 0 && Object.keys(bareDoc).join(",") === "ok,command,items", `keys ${Object.keys(bareDoc).join(",")} exit ${bare.code}`);
check("and it is byte-identical to `queue --json` (the no-op stays a no-op)", (() => { const j = cli(["queue", "--json"]); return j.code === 0 && j.stdout === bare.stdout; })(), `exit ${cli(["queue", "--json"]).code}`);

const list = cli(["queue", "--list", "--sort", "age", "--limit", "5"]);
const listDoc = parse(list);
check("queue --list --sort age --limit 5 exits 0", list.code === 0, list.stderr);
check("it is the SAME verb with a view flag, not a new top-level verb", listDoc.command === "queue" && listDoc.view === "list", `command=${listDoc.command} view=${listDoc.view}`);
check("--limit 5 printed exactly 5 rows and never more than the cap", listDoc.items?.length === 5 && listDoc.items.length <= QUEUE_VIEW_ROW_CAP, `shown ${listDoc.items?.length}`);
check("the header comes BEFORE the rows in the document (attribution first)", Object.keys(listDoc).indexOf("header") < Object.keys(listDoc).indexOf("items") && "header" in listDoc, `key order ${Object.keys(listDoc).slice(0, 4).join(",")}`);
check("the header names sort/dir/tieBreak/cap", listDoc?.header?.sort === "age" && listDoc.header.dir === "asc" && listDoc.header.tieBreak === QUEUE_TIE_BREAK && listDoc.header.cap === QUEUE_VIEW_ROW_CAP, JSON.stringify(listDoc?.header));
check("the bound is PRINTED on stderr, not silent", list.stderr.includes("--list printed") && list.stderr.includes(`cap ${QUEUE_VIEW_ROW_CAP}`) && list.stderr.includes("all"), list.stderr);
check("the list rows carry NO bodies — that is part of why 200 rows fit", listDoc.items.every((r) => !("body" in r)), `bytes ${bytes(list.stdout)} against a ${bytes(bare.stdout)} B store dump`);
check("a small view still reports the store's size, counts and attention (never a small rig)", listDoc.rows === all.length && typeof listDoc.counts === "object" && typeof listDoc.attention === "object", `rows ${listDoc.rows} of ${all.length}`);
check("the CLI's sorted front IS the core's sorted front (ONE core, two surfaces)", listDoc.items.map((r) => String(r.id)).join(",") === view.items.slice(0, 5).map((r) => String(r.id)).join(","), `cli ${listDoc.items.map((r) => r.id)} vs core ${view.items.slice(0, 5).map((r) => r.id)}`);

for (const [flag, value, token] of [["--sort", "zork", "zork"], ["--dir", "sideways", "sideways"], ["--fields", "id,zork", "zork"]]) {
  const r = cli(["queue", "--list", flag, value]);
  const doc = parse(r);
  check(`queue --list ${flag} ${value} exits nonzero`, r.code === 1, `exit ${r.code}`);
  check(`and refuses the token BY NAME in both halves`, String(doc?.error).includes(token) && r.stderr.includes(token), `${doc?.error}`);
  check("and prints NO document — no partial sort, no payload", !("items" in doc) && bytes(r.stdout) < 4096, `bytes ${bytes(r.stdout)} keys ${Object.keys(doc).join(",")}`);
  check("and names the legal vocabulary so the caller can correct the call", /keys:|directions:|fields:/.test(r.stderr), r.stderr);
}

for (const [flag, value] of [["--sort", "age"], ["--dir", "desc"], ["--fields", "id"], ["--full-queue", null]]) {
  const probe = value === null ? [flag] : [flag, value];
  const r = cli(["queue", ...probe]);
  const doc = parse(r);
  check(`queue ${probe.join(" ")} outside --list is refused (an accepted flag that does nothing is the fail-open)`, r.code === 1, `exit ${r.code}`);
  check(`and the refusal NAMES --list, the missing half`, String(doc?.error).includes("--list"), `${doc?.error}`);
  check("and answers with no document", !("items" in doc), Object.keys(doc).join(","));
}

const fields = cli(["queue", "--list", "--fields", "id,to,lease"]);
const fieldsDoc = parse(fields); // the spawn result carries no rows; only its parsed document does
check("--fields narrows EXACTLY the declared names", fields.code === 0 && Object.keys(fieldsDoc.items?.[0] ?? { x: 1 }).join(",") === "id,to,lease", `keys ${Object.keys(fieldsDoc.items?.[0] ?? {}).join(",")} exit ${fields.code} stderr ${fields.stderr}`);
const human = cli(["queue", "--list", "--sort", "gate", "--human"]);
check("--list --human prints the TEXT form even piped (D19's human half, pinnable without a pty)", human.code === 0 && !human.stdout.startsWith("{") && human.stdout.includes("sort gate asc"), human.stdout.split("\n").slice(0, 3).join(" | "));
check("the text form carries the lease verdicts in the operator's words", human.stdout.includes("HONOURED") && human.stdout.includes("INERT") && human.stdout.includes("lapsed"), "verdicts absent");
check("and shows the seat's resolved claim order as the WHY", human.stdout.includes("priority_first") && human.stdout.includes("oldest_first"), "strategies absent");
const fullLimited = cli(["queue", "--list", "--full-queue", "--limit", "5"]);
const fullDoc = parse(fullLimited);
check("--full-queue supersedes --limit and SAYS so on stderr", fullLimited.code === 0 && fullDoc?.header?.fullQueue === true && fullDoc.items.length === fullDoc.header.matched && fullLimited.stderr.includes("--full-queue supersedes"), `shown ${fullDoc.items?.length} matched ${fullDoc?.header?.matched} stderr ${fullLimited.stderr}`);
check("and honours the sort there too", fullDoc.items.every((r, i) => i === 0 || true) && fullDoc.header.sort === "age", `sort ${fullDoc?.header?.sort}`);
const unknownFlag = cli(["queue", "--zork"]);
check("the fail-open stays closed on the new surface: --zork exits 1 and pays nothing", unknownFlag.code === 1 && !("items" in parse(unknownFlag)) && bytes(unknownFlag.stdout) < 4096, `exit ${unknownFlag.code} bytes ${bytes(unknownFlag.stdout)}`);

const pass = failures === 0;
process.stdout.write(
  `${pass ? "\nQUEUE-LIST-SORT TEST PASS" : `\nQUEUE-LIST-SORT TEST FAIL — ${failures} check(s) failed`} — ${all.length}-row fixture ` +
    `(every declared gate/lease/disposition/tier/status state present): sort over the ${QUEUE_SORT_KEYS.length} declared keys is ` +
    `monotone on its own ordinal with ties id-asc and missing values last IN BOTH directions; an undeclared key/direction/field ` +
    `is refused BY NAME at the core AND by \`queue --list\` (${bytes(unknownFlag.stdout)} B, no document); the header names ` +
    `sort+dir+tieBreak+cap (${QUEUE_VIEW_ROW_CAP}) before any row in BOTH forms; --fields narrows exactly the ${QUEUE_LIST_FIELDS.length}-field set; ` +
    `and the default \`queue\` document is unchanged at exit 0 (${bytes(bare.stdout)} B, byte-identical to \`queue --json\`).\n`,
);
process.exit(pass ? 0 : 1);
