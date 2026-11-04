// Print the constitution the broker actually applies. The constitution is a session
// DOCUMENT (injected into every seat prompt), not `constitution.txt`; editing the file
// only reaches seats after it is re-applied (`node cli.mjs up rig.selfdev.json --refresh`).
// READ-ONLY and it refuses a store that is not there (#4955): the engine's open CREATES a
// 118,784 B database, so a typo in `db` used to answer "no durig.constitution document"
// about a rig that never existed.
// Run: node scripts/read-constitution.mjs [db]
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { assertStoreReadable } from "../src/readclient.mjs";

const db = process.argv[2] ?? "./selfdev.sqlite";
try {
	assertStoreReadable(db);
} catch (err) {
	console.log(JSON.stringify({ ok: false, error: String(err?.message ?? err), cause: err?.code, db: err?.db }));
	process.exit(1);
}
const storage = await openNodeSqliteStorage(db);
try {
	const rec = await storage.findDocument(
		{ kind: "durig.constitution", scope: { kind: "session" } },
		"current",
		BACKGROUND_CONTEXT,
	);
	if (!rec) {
		console.log(JSON.stringify({ ok: false, error: "no durig.constitution document" }));
		process.exit(1);
	}
	const doc = await storage.document(rec.id, "current", BACKGROUND_CONTEXT);
	const text = doc?.value?.text ?? "";
	console.log(
		JSON.stringify(
			{
				ok: true,
				docId: rec.id,
				hasPrepareWorkspace: /prepare_workspace/.test(text),
				hasP3Language: /P3 Language/.test(text),
				text,
			},
			null,
			2,
		),
	);
} finally {
	await storage.close(BACKGROUND_CONTEXT);
}
