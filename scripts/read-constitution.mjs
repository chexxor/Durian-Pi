// Print the constitution the broker actually applies. The constitution is a session
// DOCUMENT (injected into every seat prompt), not `constitution.txt`; editing the file
// only reaches seats after it is re-applied (`node cli.mjs up rig.selfdev.json --refresh`).
// Run: node scripts/read-constitution.mjs [db]
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const db = process.argv[2] ?? "./selfdev.sqlite";
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
