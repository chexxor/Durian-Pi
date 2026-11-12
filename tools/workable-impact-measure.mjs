#!/usr/bin/env node
// tools/workable-impact-measure.mjs — #6639: how many CLAIM-BY-ID attempts would `workable()`
// refuse, by class, BEFORE the predicate is applied to the by-id path (#6667).
//
// WHY THIS EXISTS: the oldest-claim path and the wake predicate already run `workable`
// (src/rig.mjs `selectOldestWorkable`, landed in ce79c354, 2026-10-20), but `claim_work`
// with an explicit itemId checks only `to === me && status === "queued"` (src/rig.mjs:854-856).
// Flipping the predicate without knowing the refusal rate reddens seats that routinely claim
// gated rows by id, and a rule that starts red gets disabled (#3539).
//
// READ-ONLY. It never writes the store. Run:
//   node tools/workable-impact-measure.mjs [--db <path>]
// exit 0 always; a missing/unreadable store exits 1.
import { openReadOnlyStore } from "../src/readonlystore.mjs";
import { workable } from "../src/rig.mjs";

const DB = process.argv.find((a) => a.startsWith("--db="))?.slice(5) ?? process.env.DURIG_DB ?? "./selfdev.sqlite";
const RULE_LANDED = "2026-10-20T00:00:00.000Z"; // ce79c354: workable/selectOldestWorkable in src/rig.mjs
const EVT = { queued: "queued", revised: "queued", claimed: "claimed", deferred: "deferred", held: "held", resumed: "claimed", released: "queued", done: "done", cancelled: "cancelled" };
const statusAt = (item, at) => {
	let s = "queued";
	for (const tr of item.transitions ?? []) if (tr.at <= at && EVT[tr.event]) s = EVT[tr.event];
	return s;
};

const store = openReadOnlyStore(DB);
const readDoc = async (kind) => {
	const rec = await store.findDocument({ kind, scope: { kind: "session" } }, "current", { note: "measure" });
	if (!rec) return null;
	return (await store.document(rec.id, "current", { note: "measure" }))?.value ?? null;
};
const queue = await readDoc("durig.queue");
const seatsDoc = await readDoc("durig.seats");
if (!queue?.items) { console.error(`no durig.queue document in ${DB}`); process.exit(1); }
const items = queue.items;
const caps = (name) => seatsDoc?.seats?.[name]?.capabilities ?? [];

const classify = (item) => {
	let open = 0, cancelled = 0, unknown = 0;
	for (const id of item.blockedBy ?? []) {
		const target = items.find((x) => x.id === id);
		if (!target) { unknown++; continue; } // conservative default: unknown gate is not a refusal
		const st = target.status;
		if (st === "done") continue;
		if (st === "cancelled") cancelled++; else open++;
	}
	const req = typeof item.requires === "string" ? item.requires.trim() : "";
	const reqFail = req !== "" && !caps(item.to).includes(req);
	return { open, cancelled, unknown, reqFail };
};

const bucket = (row) => row.cancelled ? "gate-cancelled" : row.open ? "gate-open" : row.reqFail ? "requires" : "workable";

console.log(JSON.stringify({
	db: DB,
	snapshotAt: new Date().toISOString(),
	rowsInQueueDocument: items.length,
	seats: Object.keys(seatsDoc?.seats ?? {}).length,
	A_live_queued_rows_a_by_id_claim_would_newly_refuse: (() => {
		const queued = items.filter((i) => i.status === "queued");
	 const byClass = {}; const bySeat = {};
	 for (const it of queued) {
		const c = classify(it); const b = bucket(c);
		byClass[b] = (byClass[b] ?? 0) + 1;
		if (b !== "workable") bySeat[it.to] = (bySeat[it.to] ?? 0) + 1;
		if (c.unknown) byClass["gate-id-names-no-row (default: workable)"] = (byClass["gate-id-names-no-row (default: workable)"] ?? 0) + 1;
	 }
	 return { total: queued.length, byClass, refusedBySeat: bySeat };
	})(),
	B_parked_rows_that_would_refuse_if_released: (() => {
		const out = {};
	 for (const it of items) {
		if (["done", "cancelled"].includes(it.status)) continue;
		const key = `${it.status} | ${bucket(classify(it))}`;
		out[key] = (out[key] ?? 0) + 1;
	 }
	 return out;
	})(),
	C_historical_claim_events_would_have_been_refused: (() => {
	 const before = { claims: 0, refused: 0 }, after = { claims: 0, refused: 0, "gate-open": 0, "gate-cancelled": 0, requires: 0 };
	 const bySeat = {};
	 for (const it of items) {
		for (const tr of it.transitions ?? []) {
		if (tr.event !== "claimed") continue;
		let open = 0, dead = 0;
		for (const id of it.blockedBy ?? []) {
		const target = items.find((x) => x.id === id);
		if (!target) continue;
		const st = statusAt(target, tr.at);
		if (st === "done") continue;
		if (st === "cancelled") dead++; else open++;
		}
	 const req = (typeof it.requires === "string" ? it.requires.trim() : "");
	 const reqFail = req !== "" && !caps(it.to).includes(req);
	 const refused = open > 0 || dead > 0 || reqFail;
	 const bucketName = dead ? "gate-cancelled" : open ? "gate-open" : reqFail ? "requires" : "workable";
	 if (tr.at < RULE_LANDED) { before.claims++; if (refused) before.refused++; continue; }
	 after.claims++;
	 if (refused) { after.refused++; after[bucketName] = (after[bucketName] ?? 0) + 1; bySeat[it.to] = (bySeat[it.to] ?? 0) + 1; }
		}
	 }
	 return { ruleLanded: RULE_LANDED, claimsBeforeRule: before, claimsAfterRule: after, refusedBySeat: bySeat };
	})(),
}, null, 2));
