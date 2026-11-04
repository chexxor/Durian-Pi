// demo/read-no-create-store.test.mjs — a READ verb must never manufacture the rig it is observing (#4955).
//
// Observed defect (lead, delegate-verified from #4948; reproduced again by impl on 2026-10-31 and on
// 2026-11-04): pointing a read verb at a path that does not exist CREATES a 118,784 B store there and
// answers `ok: true` with zero seats. Two artifacts of the same size under different names, invisible to
// `git status` (`.gitignore` has `*.sqlite`), are the fingerprint of an instrument that made its own
// subject. The instrument then reports the rig it created as healthy: `demo/seat-turn-shape.test.mjs`
// threw `no seat named null`, and `tools/rig-portability-audit.mjs` (#4923) printed
// `seat roots read: 0` about a store it had just made.
//
// FAILING-FIRST: before the change, every read verb here creates the file and says `ok: true`.
//
// The layer that FORCES creation is named, not assumed: `@earendil-works/pi-durable`'s
// `openNodeSqliteDatabase` does `mkdir(dirname(path), {recursive:true})` then
// `new DatabaseSync(path, {timeout})`, and its option surface has no read-only mode
// (`walAutocheckpointPages`, `busyTimeoutMs` only). So the gate has to sit in durian-pi's own read seam,
// and section 5 proves the engine-level claim at runtime instead of trusting this comment.
//
// Run: node demo/read-no-create-store.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
// The cause comes from the vocabulary module, not from the module that raises it: that is the layering
// `src/causes.mjs` exists to keep (#5047), and it is what lets `cli.mjs`, the TUI and a script act on the
// same name without importing the read seam.
import { NO_STORE_CAUSE } from "../src/causes.mjs";
import { assertStoreReadable, readLocal } from "../src/readclient.mjs";

const repo = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "durig-nocreate-"));

// Strip the seat's own rig env: a child that inherits DURIG_DB/DURIG_SEAT_ROOT would be measured
// against the wrong store, which is the same class of error this demo is about.
function rigEnv(overrides = {}) {
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (key.startsWith("DURIG_") || key.startsWith("DURIAN_PI_")) delete env[key];
	}
	return { ...env, DURIG_PROVIDER: "faux", PATH: process.env.PATH, ...overrides };
}

const cli = (args, env) => {
	const res = spawnSync(process.execPath, [join(repo, "cli.mjs"), ...args], {
		cwd: repo,
		env,
		encoding: "utf8",
	});
	return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
};
const parse = (res) => JSON.parse(res.stdout.slice(res.stdout.indexOf("{")));

/** A store path that does not exist, under a directory that does not exist either: the engine
 *  `mkdir`s the parent, so asserting only the file would miss half the footprint. */
const absentUnder = (name) => join(dir, name, "no-store-here.sqlite");

try {
	// ---------------------------------------------------------------- 1. the seam refuses, and creates nothing
	const missing = absentUnder("seam");
	let seamError = null;
	try {
		await readLocal(missing, async () => "must not run");
	} catch (err) {
		seamError = err;
	}
	assert.ok(seamError, "readLocal against an absent store must REFUSE rather than open it");
	assert.equal(
		seamError.code,
		NO_STORE_CAUSE,
		`and carries the named cause, not prose the caller has to pattern-match (got ${seamError.code})`,
	);
	assert.match(seamError.message, /no store at /, "the refusal says what is missing");
	assert.ok(
		seamError.message.includes(missing),
		`the refusal NAMES the subject it could not observe: ${seamError.message}`,
	);
	assert.ok(seamError.db === missing, "and carries the path structured, so a surface can print it as a field");
	assert.ok(!existsSync(missing), "NO FILE at the path afterwards — this is the whole point (#4955)");
	assert.ok(
		!existsSync(dirname(missing)),
		"and NO parent directory either: the engine mkdirs the parent, so the gate must run BEFORE any open",
	);

	// The helper is the single predicate every read site uses, and it is total: an existing file passes.
	const present = join(dir, "present.sqlite");
	writeFileSync(present, "not a store, and nothing here opens it");
	assert.doesNotThrow(() => assertStoreReadable(present), "an existing path passes the gate (the check is existence, not validity)");
	assert.throws(() => assertStoreReadable(absentUnder("helper")), (err) => err.code === NO_STORE_CAUSE);

	// ---------------------------------------------------------------- 2. every read VERB refuses and leaves nothing
	// `check` is deliberately in this list: it audits a rig SPEC, and its store reads are already
	// tolerated as "unreadable" — the point there is that tolerating them must not mean creating them.
	const readVerbs = [
		["status"],
		["watch", "--once"],
		["ps"],
		["queue"],
		["log", "alpha"],
		["metrics"],
		["check"],
	];
	const refusals = [];
	for (const args of readVerbs) {
		const db = absentUnder(`verb-${args[0]}`);
		const res = cli(args, rigEnv({ DURIG_DB: db }));
		assert.ok(!existsSync(db), `${args.join(" ")} created a store at ${db} (exit ${res.code})`);
		const parsed = parse(res);
		if (args[0] === "check") {
			// `check` audits the rig SPEC it was handed, so a missing store is a recorded condition rather than a
			// stop. Its report already distinguishes `store: "absent"`; what is asserted here is that it can say
			// so WITHOUT creating the store it is reporting on.
			assert.equal(parsed.store, "absent", `check records the store as absent (got ${JSON.stringify(parsed.store)})`);
		} else {
			assert.equal(parsed.ok, false, `${args.join(" ")} must not answer ok:true about a rig that does not exist`);
			assert.equal(parsed.cause, NO_STORE_CAUSE, `${args.join(" ")} reports the named cause`);
			assert.equal(parsed.db, db, `${args.join(" ")} names the database it was pointed at`);
			assert.match(parsed.error, /no store at /, `${args.join(" ")} says what is missing`);
			assert.notEqual(res.code, 0, `${args.join(" ")} exits nonzero on a rig that does not exist`);
			refusals.push(args[0]);
		}
		// The wrong-rig trap stays answered: the classic symptom is a terminal that forgot DURIG_DB.
		assert.match(
			res.stderr,
			/If you meant a different rig/,
			`${args.join(" ")} still points at the fix, not just the failure`,
		);
		assert.match(
			res.stderr,
			/does not create|reading.*create/,
			`${args.join(" ")} says the file is absent rather than empty, so the absence is legible`,
		);
	}

	// ---------------------------------------------------------------- 3. a WRITE verb still creates a rig
	// Without this the change could "fix" the defect by making a fresh rig impossible to make.
	const fresh = join(dir, "made-by-a-write", "rig.sqlite");
	const writeEnv = rigEnv({ DURIG_DB: fresh });
	const send = cli(["send", "alpha", "hi"], writeEnv);
	assert.equal(send.code, 1, "sending to a seat that is not in the (still absent) rig fails");
	assert.match(parse(send).error, /unknown seat: alpha/, "for the reason it always gave");
	assert.ok(existsSync(fresh), "and a WRITE verb still creates the store: creation belongs to the write path");
	assert.match(send.stderr, /note: no seats in /, "the empty-rig note still explains the database it used");

	// Now that the store legitimately exists, the read verbs answer about it — emptiness is NOT absence.
	const status = cli(["status"], writeEnv);
	assert.equal(status.code, 0, `status on a real, empty rig succeeds (stderr: ${status.stderr.slice(0, 200)})`);
	assert.equal(parse(status).ok, true, "a real empty rig is a real answer");
	assert.ok(!parse(status).cause, "and it carries no no_store cause");

	// ---------------------------------------------------------------- 4. the read sites that open storage themselves are gated
	// Three sites open `openNodeSqliteStorage` outside the seam. Pin that each one gates first, by the
	// name they share — a source-level pin is what keeps a fourth site from reappearing silently.
	const { readFileSync } = await import("node:fs");
	const gatedSites = [
		["src/readclient.mjs", "assertStoreReadable"],
		["src/tui/durable/enter.mjs", "assertStoreReadable"],
		["scripts/read-constitution.mjs", "assertStoreReadable"],
		["scripts/repair-pi-live.mjs", "assertStoreReadable"],
	];
	for (const [file, needle] of gatedSites) {
		const text = readFileSync(join(repo, file), "utf8");
		assert.match(
			text,
			new RegExp(needle),
			`${file} opens storage itself, so it must pass through the shared gate (${needle})`,
		);
	}
	// The TUI's writer probe must not misread absence as contention, so it reports it apart.
	assert.match(
		readFileSync(join(repo, "src/tui/durable/enter.mjs"), "utf8"),
		/missing/,
		"the writer probe distinguishes 'no store' from 'held by a writer', so it stops retrying on absence",
	);

	// ---------------------------------------------------------------- 5. the engine really does create (the layer claim, measured)
	// The refusal's remedy names pi-durable's open as the layer that forces creation; if the engine ever
	// gains a read-only mode, this assertion is where we find out and can move the gate down a layer.
	const engineProbe = absentUnder("engine");
	const storage = await openNodeSqliteStorage(engineProbe);
	await storage.close();
	assert.ok(
		existsSync(engineProbe),
		"pi-durable's open CREATES the file: this is why the gate lives in durian-pi's read seam",
	);

	console.log(
		`READ NO-CREATE PASS (${refusals.length} read verbs refuse with cause=${NO_STORE_CAUSE} and create nothing; ` +
			`1 write verb still creates; ${gatedSites.length} direct-open sites gated by name; ` +
			`the engine open still creates - measured, not asserted in prose)`,
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
