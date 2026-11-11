// demo/store-open-refusal.test.mjs — a store-open refusal must NAME the dependency graph that
// produced it and the remedy, not just the vendor's version arithmetic (#6314)
//
// THE STATE, REPRODUCED (2026-11-11, worktree item-6314, native Windows host, node v24.22.1):
//   same tree, same store copy, only the dependency graph changed:
//     unlinked (lockfile `@earendil-works/pi-durable` 1.3.0):
//       node -e 'openNodeSqliteStorage(".spike/audit-copy.sqlite")' ->
//       REFUSED: "Durable SQLite schema version 2 is newer than supported version 1", exit 1
//     linked (`node scripts/sync-pi.mjs --sync --link`, 27 s, dependencySet "built-pin", 1.5.1):
//       the identical call -> "OPENED OK", exit 0
//   The same tree's audit tool exited 0 throughout, because tools/held-gate-audit.mjs reads through
//   src/readonlystore.mjs (node:sqlite, readOnly, NO migration), which never reads durable_schema -
//   that is why the refusal "did not fire" in item-6315: it is PATH-dependent, not tree-dependent.
//   The vendor predicate, read from the installed dist: applySqliteMigrationsForSchema throws when
//   `row.version > migrations.at(-1).version`. 1.3.0 declares [{version:1}]; the pinned 1.5.1 declares
//   [{version:1},{version:2}], where 2 rebuilds `tasks` to admit the `sleeping` status.
//
// WHAT THIS PINS:
//   1. `dependencyGraph` measures the graph from disk: built-pin when node_modules resolves into
//      vendor/pi-main, lockfile-released when it does not, not-installed when there is nothing there.
//   2. A schema-version refusal says which of those it is, gives the remedy, and names the forbidden
//      fix (lowering durable_schema.version, DECISIONS D128) — measured against the REAL vendor
//      refusal, not a hand-written string.
//   3. Any other open failure keeps its own text: the wrapper never invents a diagnosis.
//   4. A linked tree is told the truth too: syncing will not help there, the pin has to move.
//
// FAILING-FIRST: on the pre-fix tree `dependencyGraph` and `describeStoreOpenFailure` do not exist
// (the import fails), and both wrappers print `cannot open <path>: <vendor text>` with no graph and
// no remedy.
// Run: node demo/store-open-refusal.test.mjs   (exit 0 = pass)

import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dependencyGraph, describeStoreOpenFailure } from "../src/readclient.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const PIN = { sha: "a".repeat(40), ref: "v1.5.1", repo: "fixture/pi", packages: [{ name: "@earendil-works/pi-durable", dir: "packages/durable" }] };
const base = await mkdtemp(join(tmpdir(), "durig-store-refusal-"));

try {
	// Fixture A: the LOCKFILE graph - a real directory in node_modules, no vendored build.
	const lockfileTree = join(base, "unlinked-tree");
	await mkdir(join(lockfileTree, "node_modules", "@earendil-works", "pi-durable"), { recursive: true });
	await writeFile(join(lockfileTree, "pi-main.pin.json"), `${JSON.stringify(PIN)}\n`);
	await writeFile(join(lockfileTree, "node_modules", "@earendil-works", "pi-durable", "package.json"), '{ "name": "@earendil-works/pi-durable", "version": "1.3.0" }\n');

	// Fixture B: the PINNED graph - node_modules resolves into the vendored build.
	const linkedTree = join(base, "linked-tree");
	await mkdir(join(linkedTree, "node_modules", "@earendil-works"), { recursive: true });
	await mkdir(join(linkedTree, "vendor", "pi-main", "packages", "durable", "dist"), { recursive: true });
	await writeFile(join(linkedTree, "pi-main.pin.json"), `${JSON.stringify(PIN)}\n`);
	await writeFile(join(linkedTree, "vendor", "pi-main", "packages", "durable", "package.json"), '{ "name": "@earendil-works/pi-durable", "version": "1.5.1" }\n');
	await writeFile(join(linkedTree, "vendor", "pi-main", "packages", "durable", "dist", "index.js"), "export {};\n");
	symlinkSync(join(linkedTree, "vendor", "pi-main", "packages", "durable"), join(linkedTree, "node_modules", "@earendil-works", "pi-durable"));

	console.log("\n1. The graph is MEASURED, not assumed");
	const a = dependencyGraph(lockfileTree);
	check("an un-linked tree reads as lockfile-released", a.graph === "lockfile-released", JSON.stringify(a));
	check("it reports the installed version", a.version === "1.3.0", String(a.version));
	check("it reports nothing built in that tree", a.builtHere === false, JSON.stringify(a));
	check("it names the pin the tree is meant to run", a.pin?.ref === "v1.5.1", JSON.stringify(a.pin));

	const b = dependencyGraph(linkedTree);
	check("a tree whose node_modules resolves into vendor/pi-main reads as built-pin", b.graph === "built-pin", JSON.stringify(b));
	check("and reports the build is present", b.builtHere === true, JSON.stringify(b));

	const empty = join(base, "nothing-installed");
	await mkdir(empty, { recursive: true });
	await writeFile(join(empty, "pi-main.pin.json"), `${JSON.stringify(PIN)}\n`);
	check("a tree with no package at all is 'not-installed', not 'lockfile-released'", dependencyGraph(empty).graph === "not-installed", JSON.stringify(dependencyGraph(empty)));

	console.log("\n2. END TO END against the vendor's own refusal (not a hand-written string)");
	// A store whose durable_schema version is ahead of ANY installed pi (the pinned build supports 2).
	const store = join(base, "ahead-store.sqlite");
	const sqlite = new DatabaseSync(store);
	sqlite.exec(`CREATE TABLE durable_schema (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version >= 0)) STRICT`);
	sqlite.prepare("INSERT INTO durable_schema (singleton, version) VALUES (1, 9)").run();
	sqlite.close();
	const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
	let vendorError = null;
	try {
	 const s = await openNodeSqliteStorage(store);
		await s.close();
	} catch (err) {
		vendorError = err;
	}
	check("the installed pi-durable really refuses a store ahead of its migrations", vendorError !== null, vendorError === null ? "it opened it" : "");
	check("and the refusal is the one this row is about", /schema version \d+ is newer than supported version \d+/.test(String(vendorError?.message)), String(vendorError?.message));

	const fromUnlinked = describeStoreOpenFailure(store, vendorError, lockfileTree);
	check("it keeps the vendor's own sentence", /cannot open .*schema version 9 is newer than supported version 2/.test(fromUnlinked) || /schema version 9 is newer/.test(fromUnlinked), fromUnlinked.slice(0, 160));
	check("it says the store is NOT corrupt", /not corrupt/.test(fromUnlinked), fromUnlinked.slice(0, 240));
	check("it names the graph: the lockfile release", /LOCKFILE/.test(fromUnlinked) && /1\.3\.0/.test(fromUnlinked), fromUnlinked.slice(0, 300));
	check("it names the remedy command", /node scripts\/sync-pi\.mjs --sync --link/.test(fromUnlinked), fromUnlinked.slice(-300));
	check("it names the forbidden fix", /Do NOT lower durable_schema\.version/.test(fromUnlinked), fromUnlinked.slice(-300));
	check("it warns that --unlink is not a rollback", /--unlink is not a rollback/.test(fromUnlinked), fromUnlinked.slice(-300));
	check("it points at the runbook", /docs\/runbooks\/worktree-unlinked-deps\.md/.test(fromUnlinked), fromUnlinked.slice(-200));

	const fromLinked = describeStoreOpenFailure(store, vendorError, linkedTree);
	check("in a linked tree it says so instead of telling the reader to sync", /IS on the pinned build/.test(fromLinked), fromLinked.slice(0, 240));
	check("and sends the reader to the pin runbook", /pi-pin-update\.md/.test(fromLinked), fromLinked.slice(-240));
	check("and does NOT claim the lockfile is the problem", !/LOCKFILE/.test(fromLinked), fromLinked.slice(0, 240));

	console.log("\n3. Every other failure keeps its own text (no invented diagnosis)");
	const plain = describeStoreOpenFailure("./rig.sqlite", new Error("unable to open database file"), lockfileTree);
	check("unchanged apart from the path prefix", plain === "cannot open ./rig.sqlite: unable to open database file", plain);
	check("no remedy is attached to an unrelated cause", !/sync-pi/.test(plain), plain);
	check("a refusal whose version numbers are the other way round is not re-labelled", describeStoreOpenFailure("./rig.sqlite", new Error("Durable SQLite schema metadata is missing"), lockfileTree) === "cannot open ./rig.sqlite: Durable SQLite schema metadata is missing", "");

	console.log("\n4. The probe is honest about a tree it cannot read");
	const noPin = join(base, "no-pin-tree");
	await mkdir(join(noPin, "node_modules", "@earendil-works", "pi-durable"), { recursive: true });
	await writeFile(join(noPin, "node_modules", "@earendil-works", "pi-durable", "package.json"), '{ "name": "@earendil-works/pi-durable", "version": "1.3.0" }\n');
	const sentence = describeStoreOpenFailure("./rig.sqlite", new Error("Durable SQLite schema version 2 is newer than supported version 1"), noPin);
	check("the pin is named as unreadable rather than guessed", /the pin \(unreadable\)/.test(sentence), sentence.slice(0, 260));
	check("the graph is still reported", /1\.3\.0/.test(sentence), sentence.slice(0, 260));
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

console.log(
	failures === 0
		? "\nPASS — a schema-version refusal names the graph that produced it, the remedy, and the forbidden fix; nothing else is re-labelled"
		: `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
