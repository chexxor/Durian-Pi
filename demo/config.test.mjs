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
	loadShippedDefaults,
	mergeConfig,
	streamSettings,
} from "../src/config.mjs";

// --- unit: merge precedence -------------------------------------------------
// NOTE #491 C6: mergeConfig now takes a defaults layer (lowest): the shipped
// defaults file's values, under the operator's runtime file, under the env.
assert.deepEqual(
	mergeConfig({ DURIG_DB: "from-file.sqlite" }, { DURIG_DB: "from-env.sqlite" }, { DURIG_DB: "from-defaults.sqlite" }),
	{ DURIG_DB: "from-env.sqlite" },
	"env wins over file and defaults",
);
assert.deepEqual(
	mergeConfig({ DURIG_DB: "from-file.sqlite" }, { DURIG_DB: "" }, { DURIG_DB: "from-defaults.sqlite" }),
	{ DURIG_DB: "from-file.sqlite" },
	"empty-string env var is treated as unset",
);
assert.deepEqual(
	mergeConfig({ DURIG_MODEL: "x" }, {}, { DURIG_MODEL: "from-defaults" }),
	{ DURIG_MODEL: "x" },
	"file value used when env silent",
);
assert.deepEqual(
	mergeConfig({}, {}, { DURIG_DB: "shipped.sqlite", DURIG_MAX_CONCURRENT_SEATS: "1" }),
	{ DURIG_DB: "shipped.sqlite", DURIG_MAX_CONCURRENT_SEATS: "1" },
	"defaults surface when neither env nor file speaks",
);
assert.deepEqual(
	mergeConfig({}, {}, null),
	{},
	"null defaults layer behaves as absent (back-compat)",
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

// A malformed SHIPPED defaults file must fail loudly too (same rule as the
// runtime config), not silently vanish into the built-in constants.
await assert.rejects(
	() =>
		loadShippedDefaults({ readFile: async () => "{ not json" }),
	/invalid JSON/,
	"a malformed defaults file is an error naming its path, never a silent fallback",
);

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
/** Run any CLI verb with an explicit env AND cwd (shared by both integration blocks). */
const runCliNew = (cwd, args, env) =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, [join(durigDir, "cli.mjs"), ...args], {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => (stdout += c));
		child.stderr.on("data", (c) => (stderr += c));
		child.once("exit", (code) => resolve({ code, stdout, stderr }));
	});

const runConfig = (env) => runCliNew(dir, ["config"], env);

// A child env stripped of every DURIG_* key, so the file is the only source.
const cleanEnv = { ...process.env };
for (const k of Object.keys(cleanEnv)) {
	if (k.startsWith("DURIG_") || k === "DEEPINFRA_API_KEY") delete cleanEnv[k];
}

try {
	writeFileSync(
		join(dir, "durig.config.json"),
		JSON.stringify({
			DURIG_DB: "example.sqlite",
			DURIG_PROVIDER: "faux",
			DURIG_MODEL: "faux-seat",
		}),
	);

	const fromFile = await runConfig(cleanEnv);
	assert.equal(fromFile.code, 0, `config from file failed: ${fromFile.stderr.slice(0, 200)}`);
	const a = JSON.parse(fromFile.stdout);
	assert.equal(a.DURIG_DB, "example.sqlite", "file DB reaches the CLI");
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

/* ------------- #491 C6: the SHIPPED defaults file -------------
 * A fresh durig runs without a hand-written config: durig.config.default.json
 * ships, is discovered by the same three-path rule, and lands UNDER the runtime
 * file/env. Proven on the REAL filesystem AND through the real CLI, so this is
 * wiring, not just a merge function. */

// 1. The shipped file EXISTS in the repo and parses (the distribution artifact).
const { fileURLToPath: fU2P } = await import("node:url");
const repoDurig = fU2P(new URL("../durig.config.default.json", import.meta.url));
const defaultsOnDisk = JSON.parse(readFileSync(repoDurig, "utf8"));
assert.equal(defaultsOnDisk.DURIG_MAX_CONCURRENT_SEATS, "1", "the shipped cap is 1 (a bare install must not stampede a local model)");
assert.equal(defaultsOnDisk.DURIG_OPTIMIZE, "off", "the optimizer ships off");
assert.ok(typeof defaultsOnDisk.DURIG_DB === "string" && defaultsOnDisk.DURIG_DB.length > 0, "a storage path ships");
console.log("SHIPPED DEFAULTS FILE OK (exists, parses, sane values)");

// 2. loadShippedDefaults reaches the anchored repo copy and reports the source.
const realFsRead = (p, enc) => import("node:fs/promises").then((m) => m.readFile(p, enc));
const shipped = await loadShippedDefaults({
	readFile: realFsRead,
	anchors: [fU2P(new URL("../durig.config.default.json", import.meta.url))],
});
assert.ok(
	typeof shipped.source === "string" && shipped.source.endsWith("durig.config.default.json"),
	"the shipped file is the named source",
);
assert.equal(shipped.values.DURIG_DB, defaultsOnDisk.DURIG_DB, "values pass through unmodified");

// 3. A fresh CWD with NO runtime config: the defaults are the effective config
//    (via the REAL CLI, as an operator would run it).
const freshDir = mkdtempSync(join(tmpdir(), "durig-fresh-"));
const fromShipped = await runCliNew(freshDir, ["config"], cleanEnv);
assert.equal(fromShipped.code, 0, fromShipped.stderr.slice(0, 300));
const d = JSON.parse(fromShipped.stdout);
assert.equal(d.DURIG_DB, defaultsOnDisk.DURIG_DB, "fresh-install effective DB comes from the shipped defaults");
assert.ok(
	typeof d.defaultsSource === "string" && d.defaultsSource.endsWith("durig.config.default.json"),
	"the CLI names the defaults source (anchored path ends with the shipped file name)",
);
assert.equal(d.DURIG_MAX_CONCURRENT_SEATS, "1", "shipped cap reaches the CLI on a fresh install");
rmSync(freshDir, { recursive: true, force: true });

// 4. The operator's runtime file BEATS the shipped defaults; env beats both.
const bothDir = mkdtempSync(join(tmpdir(), "durig-both-"));
writeFileSync(join(bothDir, "durig.config.json"), JSON.stringify({ DURIG_DB: "operator.sqlite" }));
const fromBoth = await runCliNew(bothDir, ["config"], { ...cleanEnv, DURIG_MAX_CONCURRENT_SEATS: "3" });
const e = JSON.parse(fromBoth.stdout);
assert.equal(e.DURIG_DB, "operator.sqlite", "runtime file beats shipped defaults");
assert.equal(e.DURIG_MAX_CONCURRENT_SEATS, "3", "env beats file beats defaults");
assert.equal(e.DURIG_OPTIMIZE, defaultsOnDisk.DURIG_OPTIMIZE, "unset-by-operator keys come from the shipped defaults");
rmSync(bothDir, { recursive: true, force: true });
console.log("SHIPPED DEFAULTS INTEGRATION OK (fresh install runs; file/env override)");

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
	// #491 C6: the shipped defaults must be in the REAL load path (wiring, not just
	// exports): the cli anchors the shipped file to its own install directory.
	assert.match(
		cliSource,
		/loadShippedDefaults\(\{\s*\n\s*readFile,/,
		"cli.mjs must read the shipped defaults file in its real load path",
	);

	// And through the real open path: a bad value must surface at Harness.open,
	// which is what proves this is in the path rather than merely exported.
	// The vehicle is `resume` (it opens a harness). `ps`/`queue` are READS now and
	// open no harness (ROADMAP 69), so they can no longer carry this check.
	const badOpen = await runCliNew(dir, ["resume"], {
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
	const goodOpen = await runCliNew(dir, ["resume"], {
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
