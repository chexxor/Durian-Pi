// Config-file tests: settings resolve as env > durig.config.json > built-in
// default, and the CLI reports them honestly.
// Run: node demo/config.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	describeConfig,
	loadConfig,
	mergeConfig,
	streamSettings,
} from "../src/config.mjs";

// --- unit: merge precedence -------------------------------------------------
assert.deepEqual(
	mergeConfig({ DURIG_DB: "from-file.sqlite" }, { DURIG_DB: "from-env.sqlite" }),
	{ DURIG_DB: "from-env.sqlite" },
	"env wins over file",
);
assert.deepEqual(
	mergeConfig({ DURIG_DB: "from-file.sqlite" }, { DURIG_DB: "" }),
	{ DURIG_DB: "from-file.sqlite" },
	"empty-string env var is treated as unset",
);
assert.deepEqual(
	mergeConfig({ DURIG_MODEL: "x" }, {}),
	{ DURIG_MODEL: "x" },
	"file value used when env silent",
);
console.log("MERGE PRECEDENCE OK");

// --- unit: discovery / error paths (injected readFile, no filesystem) ------
const fakeFiles = { "durig.config.json": JSON.stringify({ DURIG_DB: "found.sqlite" }) };
const readFake = async (p) => {
	if (fakeFiles[p] !== undefined) return fakeFiles[p];
	const err = new Error(`ENOENT: ${p}`);
	err.code = "ENOENT";
	throw err;
};

const discovered = await loadConfig({ env: {}, readFile: readFake });
assert.equal(discovered.source, "durig.config.json", "discovers ./durig.config.json");
assert.equal(discovered.config.DURIG_DB, "found.sqlite");

const explicit = await loadConfig({
	env: { DURIG_CONFIG: "durig.config.json" },
	readFile: readFake,
});
assert.equal(explicit.source, "durig.config.json");

await assert.rejects(
	() => loadConfig({ env: { DURIG_CONFIG: "nope.json" }, readFile: readFake }),
	/missing file/,
	"explicit DURIG_CONFIG that does not exist is an error, not a silent fallback",
);

await assert.rejects(
	() =>
		loadConfig({
			env: {},
			readFile: async () => "{ not json",
		}),
	/invalid JSON/,
	"malformed config file is surfaced with its path",
);

const noFile = await loadConfig({ env: {}, readFile: readFake0 });
async function readFake0(p) {
	const err = new Error(`ENOENT: ${p}`);
	err.code = "ENOENT";
	throw err;
}
assert.equal(noFile.source, null, "no config file anywhere -> built-in defaults");
assert.equal(noFile.config.DURIG_DB, undefined);

const described = describeConfig({
	config: { DEEPINFRA_API_KEY: "sk-secret", DURIG_DB: "a.sqlite" },
	source: "durig.config.json",
});
assert.equal(described.DEEPINFRA_API_KEY, "set", "secret reduced to a boolean");
assert.ok(
	!JSON.stringify(described).includes("sk-secret"),
	"describeConfig must never leak the key value",
);
console.log("DISCOVERY + REDACTION OK");

// --- integration: the real CLI honors a real config file -------------------
const dir = mkdtempSync(join(tmpdir(), "durig-config-"));
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const runConfig = (env) => runCli(["config"], env);

/** Run any CLI verb with an explicit env, for the wiring proofs below. */
const runCli = (args, env) =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, [join(durigDir, "cli.mjs"), ...args], {
			cwd: dir,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => (stdout += c));
		child.stderr.on("data", (c) => (stderr += c));
		child.once("exit", (code) => resolve({ code, stdout, stderr }));
	});

// A child env stripped of every DURIG_* key, so the file is the only source.
const cleanEnv = { ...process.env };
for (const k of Object.keys(cleanEnv)) {
	if (k.startsWith("DURIG_") || k === "DEEPINFRA_API_KEY") delete cleanEnv[k];
}

try {
	writeFileSync(
		join(dir, "durig.config.json"),
		JSON.stringify({
			DURIG_DB: "tutor-pi.sqlite",
			DURIG_PROVIDER: "faux",
			DURIG_MODEL: "faux-seat",
		}),
	);

	const fromFile = await runConfig(cleanEnv);
	assert.equal(fromFile.code, 0, `config from file failed: ${fromFile.stderr.slice(0, 200)}`);
	const a = JSON.parse(fromFile.stdout);
	assert.equal(a.DURIG_DB, "tutor-pi.sqlite", "file DB reaches the CLI");
	assert.equal(a.source, "durig.config.json", "CLI reports the config source");
	assert.equal(a.DURIG_PROVIDER, "faux", "file provider reaches the CLI");

	const envOverrides = await runConfig({ ...cleanEnv, DURIG_DB: "env-wins.sqlite" });
	assert.equal(envOverrides.code, 0, envOverrides.stderr.slice(0, 200));
	const b = JSON.parse(envOverrides.stdout);
	assert.equal(b.DURIG_DB, "env-wins.sqlite", "env still beats the file");

	const missing = await runConfig({ ...cleanEnv, DURIG_CONFIG: "does-not-exist.json" });
	assert.equal(missing.code, 1, "missing explicit config exits nonzero");
	const c = JSON.parse(missing.stderr.trim().split("\n").pop());
	assert.equal(c.ok, false, "config failure uses the JSON contract");
	assert.match(c.error, /missing file/, "and names the problem");

	console.log("CLI INTEGRATION OK (file, env override, error contract)");

	/* ------------------- the stream timeout: the one setting durig could not reach */

	// Nothing set means no override, so the platform default stands rather than a
	// made-up durig number. This is the assertion that keeps the default honest.
	assert.deepEqual(streamSettings({}), {}, "an unset timeout must not invent a value");
	assert.deepEqual(streamSettings({ DURIG_STREAM_TIMEOUT_MS: "" }), {}, "an empty value is unset");
	assert.deepEqual(
		streamSettings({ DURIG_STREAM_TIMEOUT_MS: "900000" }),
		{ stream: { timeoutMs: 900000 } },
		"a set timeout reaches pi-durable's stream options",
	);
	// A bad value must fail rather than quietly fall back: a timeout that was set and
	// silently ignored is worse than one never set, and it would only show under load.
	for (const bad of ["soon", "-5", "0", "NaN"]) {
		assert.throws(
			() => streamSettings({ DURIG_STREAM_TIMEOUT_MS: bad }),
			/must be a positive number of milliseconds/,
			`${JSON.stringify(bad)} must be rejected, not ignored`,
		);
	}

	// The wiring, not just the function: a settings builder nothing calls is the
	// defect this project keeps finding. Read cli.mjs and require that the value
	// actually reaches Harness.open.
	const cliSource = readFileSync(join(durigDir, "cli.mjs"), "utf8");
	assert.match(
		cliSource,
		/settings:\s*streamSettings\(CFG\)/,
		"openHarness must pass streamSettings(CFG) as the harness settings",
	);

	// And through the real open path: a bad value must surface at Harness.open,
	// which is what proves this is in the path rather than merely exported.
	const badOpen = await runCli(["ps"], {
		...cleanEnv,
		DURIG_PROVIDER: "faux",
		DURIG_DB: join(dir, "stream.sqlite"),
		DURIG_STREAM_TIMEOUT_MS: "soon",
	});
	assert.equal(badOpen.code, 1, "an invalid stream timeout must fail the command, not be ignored");
	assert.match(
		`${badOpen.stdout}${badOpen.stderr}`,
		/DURIG_STREAM_TIMEOUT_MS must be a positive number/,
		"and it must name the setting",
	);

	// A valid one opens the harness normally, so the check above is not failing for
	// an unrelated reason.
	const goodOpen = await runCli(["ps"], {
		...cleanEnv,
		DURIG_PROVIDER: "faux",
		DURIG_DB: join(dir, "stream.sqlite"),
		DURIG_STREAM_TIMEOUT_MS: "900000",
	});
	assert.equal(goodOpen.code, 0, `a valid stream timeout must open fine: ${goodOpen.stderr.slice(0, 200)}`);
	console.log("STREAM TIMEOUT OK (default stands, override reaches Harness.open, bad value fails)");

	console.log("CONFIG TEST PASS");
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}

// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
