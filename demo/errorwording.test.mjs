// --- #491 C7: error handling UX — error messages name the resolved DB_PATH ---
// A store-open failure used to surface bare sqlite wording ("unable to open
// database file") with no hint of WHICH store was in play, which is exactly
// the wrong-DB trap a fresh install falls into. The rule under test: whenever
// durig fails to open its storage, the error TEXT names the resolved path
// (the same value `status` reports as "db"), with the underlying cause after it.
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const durigDir = dirname(fileURLToPath(new URL("../cli.mjs", import.meta.url)));

/** Run any CLI verb with an explicit env; resolves { code, stdout, stderr }. */
const runCli = (args, env) =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, [join(durigDir, "cli.mjs"), ...args], {
			cwd: durigDir,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.once("exit", (code) => resolve({ code, stdout, stderr }));
	});

// An UNOPENABLE store: a directory. sqlite cannot open a directory as a
// database file, so the open fails deterministically on every platform — no
// locks, no races, no provider, no network. A child env that carries no
// DURIG_CONFIG and points DURIG_DB at that directory (env beats any config
// file, so the repo's local durig.config.json cannot redirect the probe).
const unopenable = mkdtempSync(join(tmpdir(), "durig-errorwording-"));
const probeEnv = { ...process.env, DURIG_DB: unopenable };
delete probeEnv.DURIG_CONFIG;

const { code, stdout } = await runCli(["status"], probeEnv);
assert.equal(code, 1, "a failed store open is a failure (exit 1)");
const failure = JSON.parse(stdout);
assert.equal(failure.ok, false, "the JSON failure contract is kept");
assert.match(
	failure.error,
	/^cannot open .*durig-errorwording-/,
	"the error names the resolved DB_PATH before its cause",
);
assert.ok(
	failure.error.includes(unopenable),
	`the error contains the exact resolved path (${unopenable}) in play, e.g. got: ${failure.error}`,
);
assert.match(failure.error, /unable to open database file/, "the underlying cause is kept after the path");

console.log("ERROR WORDING OK (store-open failures name the resolved DB_PATH)");
