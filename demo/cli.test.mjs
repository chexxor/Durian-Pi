// CLI surface tests: every command's JSON contract, exit code and stderr
// behaviour, driven through the real cli.mjs in faux mode (offline, fast).
// Feature-specific behaviour lives in the other demo tests; this file is the
// contract test - shape of stdout, exit codes, and the error surface an LLM
// operator depends on.
// Run: node demo/cli.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "durig-cli-"));
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const db = join(dir, "rig.sqlite");
const rigFile = join(dir, "rig.json");

// A two-seat rig keeps this contract test fast; the 13-seat tutor-pi rig is
// exercised by seatmodel/refresh/streamcli tests.
writeFileSync(
	rigFile,
	JSON.stringify({
		version: 2,
		seats: [
			{ name: "alpha", role: "alpha role", instructions: "a" },
			{ name: "beta", role: "beta role", instructions: "b" },
		],
		edges: [{ from: "alpha", maySendTo: ["beta"] }],
	}),
);

const fauxEnv = { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db };
const cli = (args, env = fauxEnv) => {
	const res = spawnSync(process.execPath, ["cli.mjs", ...args], {
		cwd: durigDir,
		env,
		encoding: "utf8",
	});
	return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
};
const json = (res) => JSON.parse(res.stdout);

try {
	// --- up: creates exactly what the spec declares ------------------------
	const up = cli(["up", rigFile]);
	assert.equal(up.code, 0, `up exit 0 (stderr: ${up.stderr.slice(0, 200)})`);
	const upJson = json(up);
	assert.equal(upJson.ok, true);
	assert.equal(upJson.db, db, "up reports where it wrote the rig");
	assert.deepEqual(upJson.created, ["alpha", "beta"]);
	assert.deepEqual(upJson.existing, []);

	// up again: idempotent, reports existing rather than duplicating.
	const up2 = json(cli(["up", rigFile]));
	assert.deepEqual(up2.created, []);
	assert.deepEqual(up2.existing, ["alpha", "beta"]);

	// --- ps: roster with ids and roles -------------------------------------
	const ps = json(cli(["ps"]));
	assert.equal(ps.ok, true);
	assert.equal(ps.command, "ps");
	assert.equal(ps.db, db, "ps reports the database it read");
	assert.deepEqual(ps.seats.map((s) => s.name).sort(), ["alpha", "beta"]);
	for (const seat of ps.seats) {
		assert.equal(typeof seat.conversationId, "number", `${seat.name} has an id`);
		assert.ok(seat.role.length > 0, `${seat.name} has a role`);
	}

	// --- queue: an empty rig still answers with the full document ----------
	const q = json(cli(["queue"]));
	assert.equal(q.ok, true);
	assert.equal(q.command, "queue");
	assert.deepEqual(q.items, [], "freshly bootstrapped queue is present and empty");

	// --- status: seats + queue + attention, all arrays ---------------------
	const status = json(cli(["status"]));
	assert.equal(status.ok, true);
	assert.equal(status.command, "status");
	assert.equal(status.seats.length, 2);
	assert.ok(Array.isArray(status.queueItems));
	assert.ok(Array.isArray(status.attention), "attention is always an array");

	// --- watch --once: exactly one NDJSON snapshot -------------------------
	const watch = cli(["watch", "--once"]);
	assert.equal(watch.code, 0);
	const lines = watch.stdout.trim().split("\n");
	assert.equal(lines.length, 1, "one snapshot line");
	const w = JSON.parse(lines[0]);
	assert.equal(w.ok, true);
	assert.equal(w.command, "watch");
	assert.equal(w.seq, 1, "the snapshot is sequence 1");

	// --- send: settles and reports the outcome -----------------------------
	const send = cli(["send", "alpha", "hello"]);
	assert.equal(send.code, 0, `send exit 0 (stderr: ${send.stderr.slice(0, 200)})`);
	const sent = json(send);
	assert.equal(sent.ok, true);
	assert.equal(sent.seat, "alpha");
	assert.equal(sent.settledStatus, "done");
	assert.ok(
		Array.isArray(sent.reply) && sent.reply.length > 0,
		"a completed send reports the reply it produced",
	);
	assert.match(send.stderr, /waiting for its run to settle/, "the wait is explained");

	// --- log: transcript shape, and the limit argument ---------------------
	const log = json(cli(["log", "alpha", "10"]));
	assert.equal(log.ok, true);
	assert.equal(log.seat, "alpha");
	assert.ok(log.entries.length >= 2, "user and assistant entries landed");
	assert.ok(
		log.entries.some((e) => e.kind === "pi.assistant"),
		"the assistant reply is in the transcript",
	);

	// --- send --body-file: the prompt must arrive VERBATIM --------------------
	// A backtick in an inline shell argument is command substitution, so text can
	// arrive silently mangled while the run still looks fine (dogfood F1). The
	// file form exists to remove that class, so the proof is that the STORED
	// prompt equals the file byte for byte - not merely that the send succeeded.
	const promptText =
		"Backtick `echo hi` plus $HOME and $(whoami) must survive.\nSecond line.";
	const promptFile = join(dir, "prompt.txt");
	writeFileSync(promptFile, promptText);
	const viaFile = cli(["send", "alpha", "--body-file", promptFile]);
	assert.equal(
		viaFile.code,
		0,
		`send --body-file exit 0 (stderr: ${viaFile.stderr.slice(0, 200)})`,
	);
	const afterFile = json(cli(["log", "alpha", "5"]));
	const lastUser = [...afterFile.entries].reverse().find((e) => e.kind === "pi.user");
	assert.equal(
		lastUser?.text,
		promptText,
		"the prompt must be stored verbatim, not shell-mangled",
	);

	// --- log on an empty transcript must SAY it is empty ----------------------
	// Otherwise "has never run" and "broken" look identical, and --follow waits
	// forever in silence (dogfood F2). The note goes on stderr so the JSON
	// contract on stdout is unchanged.
	const emptyLog = cli(["log", "beta", "5"]);
	assert.equal(emptyLog.code, 0, "an empty transcript is not an error");
	assert.deepEqual(
		json(emptyLog).entries,
		[],
		"the JSON contract still reports an empty array",
	);
	assert.match(
		emptyLog.stderr,
		/beta has no entries yet/,
		"the CLI says the transcript is empty rather than printing nothing",
	);

	// --body-file needs a path when it is given at all.
	const noPath = cli(["send", "alpha", "--body-file"]);
	assert.equal(noPath.code, 1, "--body-file without a path exits 1");
	assert.match(json(noPath).error, /--body-file needs a path/);

	// --- config: reports the effective database ----------------------------
	const cfg = json(cli(["config"]));
	assert.equal(cfg.ok, true);
	assert.equal(cfg.command, "config");
	assert.equal(cfg.DURIG_DB, db, "config reports the database actually in use");
	assert.equal(cfg.DURIG_PROVIDER, "faux");
	assert.ok(!cfg.DEEPINFRA_API_KEY || cfg.DEEPINFRA_API_KEY === "unset" || cfg.DEEPINFRA_API_KEY === "set", "the key is boolean, never a value");

	// --- non-done settle speaks up on stderr -------------------------------
	// Booted with faux (seats reference provider "faux") but sent under a
	// registry that only has deepinfra: the run cannot pick a model, so it
	// settles unanswered WITHOUT streaming anything or calling the network.
	const noModel = cli(["send", "alpha", "hi", "--stream"], {
		...process.env,
		DURIG_PROVIDER: "deepinfra",
		DURIG_DB: db,
		DEEPINFRA_API_KEY: "unused-because-no-generation-happens",
	});
	assert.equal(noModel.code, 0, "an unanswered settle is not a CLI failure");
	const nm = json(noModel);
	assert.equal(nm.ok, true);
	assert.equal(nm.settledStatus, "unanswered");
	assert.equal(nm.settledReason, "no_model");
	assert.equal(nm.reply, null);
	assert.match(
		noModel.stderr,
		/note: alpha finished as unanswered \(no_model\)/,
		"a non-done settle is announced on stderr instead of looking idle",
	);

	// ...and a SECOND unanswered send must not resurrect an earlier reply. The
	// seat now holds two assistant entries, which is exactly what exposes the
	// watermark bug: diffing against the newest assistant id finds an OLDER one
	// that also differs, and reports it as this run's reply (dogfood F7).
	const noModel2 = cli(["send", "alpha", "again", "--stream"], {
		...process.env,
		DURIG_PROVIDER: "deepinfra",
		DURIG_DB: db,
		DEEPINFRA_API_KEY: "unused-because-no-generation-happens",
	});
	assert.equal(json(noModel2).settledReason, "no_model");
	assert.equal(
		json(noModel2).reply,
		null,
		"an unanswered run must never report an earlier send's reply",
	);

	console.log("--- wrong-database guardrail ---");

	// A second terminal that forgot DURIG_DB is the classic new-user trap: the
	// default ./rig.sqlite is created on demand, so every read command answers
	// ok with zero seats and looks healthy. The note must name the database.
	const strayDb = join(dir, "stray", "rig.sqlite");
	const strayEnv = { DURIG_PROVIDER: "faux", DURIG_DB: strayDb, PATH: process.env.PATH };
	for (const args of [["ps"], ["status"], ["watch", "--once"]]) {
		const res = cli(args, strayEnv);
		assert.equal(res.code, 0, `${args[0]} on a fresh database still succeeds`);
		const parsedRes = json(res);
		assert.equal(parsedRes.ok, true, `${args[0]} keeps the JSON contract`);
		assert.equal(parsedRes.db, strayDb, `${args[0]} names the database it used`);
		assert.match(
			res.stderr,
			/note: no seats in .* If you meant a different rig/,
			`${args[0]} warns instead of looking healthy on an empty rig`,
		);
	}

	// Sending to a seat that does not exist in an empty database explains the
	// database, not just the name.
	const straySend = cli(["send", "alpha", "hi"], strayEnv);
	assert.equal(straySend.code, 1);
	assert.match(json(straySend).error, /unknown seat: alpha/);
	assert.match(straySend.stderr, /note: no seats in /, "the real cause is named too");

	console.log("--- error contract ---");

	// --- error surface: failures are JSON with a nonzero exit --------------
	const noSeat = cli(["log"]);
	assert.equal(noSeat.code, 1, "missing argument exits 1");
	assert.equal(json(noSeat).ok, false);
	assert.match(json(noSeat).error, /log needs <seat>/);

	const unknown = cli(["send", "ghost", "hi"]);
	assert.equal(unknown.code, 1);
	assert.equal(json(unknown).ok, false);
	assert.match(json(unknown).error, /unknown seat: ghost/);

	const noText = cli(["send", "alpha"]);
	assert.equal(noText.code, 1, "send without text exits 1");
	assert.match(json(noText).error, /send needs <seat> <text>/);

	const noOpt = cli(["optimize"]);
	assert.equal(noOpt.code, 1, "optimize without text exits 1");
	assert.match(json(noOpt).error, /optimize needs <text>/);

	const bogus = cli(["frobnicate"]);
	assert.equal(bogus.code, 2, "an unknown command exits 2");
	const bogusJson = json(bogus);
	assert.equal(bogusJson.ok, false);
	assert.match(bogusJson.usage, /node cli\.mjs up/, "usage is returned to the caller");

	console.log("CLI TEST PASS (contracts, exit codes, stderr, error surface)");
	process.exit(0);
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
