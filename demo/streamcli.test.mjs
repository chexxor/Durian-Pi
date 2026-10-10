// CLI live-view tests: `send --stream` renders the seat-labelled transcript to
// STDERR while STDOUT stays a single JSON document, and `--no-stream` (and a
// non-tty run) stays quiet. The renderer itself is unit-tested in
// streamview.test.mjs; this covers the wiring in cli.mjs that test missed.
// Run: node demo/streamcli.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "durig-streamcli-"));
const db = join(dir, "rig.sqlite");
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db };

function cli(args) {
	const res = spawnSync(process.execPath, ["cli.mjs", ...args], {
		cwd: durigDir,
		env,
		encoding: "utf8",
	});
	return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

try {
	const up = cli(["up", join(durigDir, "rigs", "tutor-pi.rig.json")]);
	assert.equal(up.status, 0, `up failed: ${up.stderr.slice(0, 200)}`);

	// --- --stream: labelled transcript on stderr, JSON on stdout -----------
	const streamed = cli(["send", "pm", "hello", "--stream"]);
	assert.equal(streamed.status, 0, `send --stream failed: ${streamed.stderr.slice(0, 300)}`);
	assert.match(streamed.stderr, /── pm /, "stderr carries the seat-labelled header");
	assert.match(streamed.stderr, /faux\) acknowledged/, "the reply text streams to stderr");
	assert.match(streamed.stderr, /── pm done \(stop\)/, "stderr carries the closing footer");
	assert.ok(
		!/── pm /.test(streamed.stdout),
		"the live view never leaks into stdout",
	);
	const parsed = JSON.parse(streamed.stdout);
	assert.equal(parsed.ok, true, "stdout is still one JSON document");
	assert.equal(parsed.command, "send");
	assert.equal(parsed.seat, "pm");

	// --- --no-stream: no transcript, but the caller is still told ----------
	const quiet = cli(["send", "pm", "hello", "--no-stream"]);
	assert.equal(quiet.status, 0, `send --no-stream failed: ${quiet.stderr.slice(0, 300)}`);
	assert.ok(!/── pm /.test(quiet.stderr), "--no-stream renders no transcript");
	assert.match(quiet.stderr, /waiting for its run to settle/, "and explains the wait instead");
	assert.equal(JSON.parse(quiet.stdout).ok, true, "stdout stays JSON without the view");

	// --- non-tty default: quiet even though stdout is captured -------------
	const plain = cli(["send", "pm", "hello"]);
	assert.equal(plain.status, 0, `plain send failed: ${plain.stderr.slice(0, 300)}`);
	assert.ok(
		!/── pm /.test(plain.stderr),
		"a captured (non-tty) stderr gets no transcript by default, so LLM operators stay clean",
	);
	assert.equal(JSON.parse(plain.stdout).ok, true);

	console.log("STREAMCLI TEST PASS (stream/no-stream/non-tty + stdout contract)");
	process.exit(0);
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
