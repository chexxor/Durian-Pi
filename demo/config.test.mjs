// Config-file tests: settings resolve as env > durig.config.json > built-in
// default, and the CLI reports them honestly.
// Run: node demo/config.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	describeConfig,
	loadConfig,
	mergeConfig,
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
const runConfig = (env) =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, [join(durigDir, "cli.mjs"), "config"], {
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
