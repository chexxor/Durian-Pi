// One-off repair: clear a corrupt `pi.live` document (P5/#110 — the F14 shape:
// base {} plus an orphaned append that makes materialization throw
// `unresolvable path: [...,"content",0]`). A root-replace delta does NOT reset
// the materialization base, so it still threw. A corrupt incarnation is RETIRED
// instead: `readLiveState` then finds no current `pi.live` and reads it as idle
// (`{}`), and the next run re-creates a clean one. Run:
//   node repair-pi-live.mjs <db> <conversationId>
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const db = process.argv[2];
const conversationId = Number(process.argv[3]);
if (!db || !Number.isFinite(conversationId)) {
	console.error("usage: node repair-pi-live.mjs <db> <conversationId>");
	process.exit(2);
}

const storage = await openNodeSqliteStorage(db);
try {
	const page = await storage.scanDocuments(
		{ scope: { kind: "conversation", conversationId }, at: "current", kind: "pi.live" },
		50,
		undefined,
		BACKGROUND_CONTEXT,
	);
	const corrupt = [];
	for (const d of page.items) {
		try {
			await storage.document(d.id, "current", BACKGROUND_CONTEXT);
		} catch (err) {
			corrupt.push({ id: d.id, error: err?.message ?? String(err) });
		}
	}
	if (corrupt.length === 0) {
		console.log(JSON.stringify({ ok: true, conversationId, note: "no unreadable pi.live; nothing retired" }));
	} else {
		const writes = corrupt.map(({ id }) => ({ type: "document.retire", id }));
		const seq = await storage.commit(writes, BACKGROUND_CONTEXT);
		console.log(JSON.stringify({ ok: true, conversationId, retired: corrupt, seq }));
	}
} finally {
	await storage.close(BACKGROUND_CONTEXT);
}
