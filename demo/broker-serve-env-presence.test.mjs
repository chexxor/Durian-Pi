// demo/broker-serve-env-presence.test.mjs — #5700 (ROADMAP 295): the broker-serve preflight
// reports PRESENCE of a credential, never its value.
//
// WHY THIS EXISTS. `tools/broker-serve.mjs` prints the env it is about to hand the broker.
// Until #5700 that print spread every `DURIG_LOCAL_*` / `DURIG_VERIFIER_*` variable through
// `JSON.stringify`, so a credential env var's VALUE landed in the preflight report — the same
// report an operator pastes into a transcript, a chat line, or an item body. The product
// already has the right shape elsewhere: `src/config.mjs:558` reports
// `DEEPINFRA_API_KEY: "set" | "unset"`, and `tools/verifier-arm-probe.mjs` REFUSES to print a
// credential value at all. This tool was the one print site that did not.
//
// FAILING-FIRST: on main (no presence helper) the forged value IS printed and the first
// assertion fails. Run: node demo/broker-serve-env-presence.test.mjs  (exit 0 = pass)
//
// The demo never starts a broker: `--dry-run` is read-only and a missing store is reported,
// not created (that refusal is #4955's `assertStoreReadable` seam).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(ROOT, "tools", "broker-serve.mjs");

const dir = mkdtempSync(join(tmpdir(), "durig-broker-serve-presence-"));
const db = join(dir, "no-store.sqlite");

// Distinct, unmistakable probe values. They are not real credentials; they exist so the
// assertion "this string must not appear in the output" means something.
const FORGED_VERIFIER = "forged-verifier-key-9f2c7a4b1e";
const FORGED_LOCAL = "forged-local-key-77c1d2";

function preflight(env) {
  return spawnSync(process.execPath, [TOOL, "--dry-run", "--db", db], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    failures += 1;
    console.log(`  FAIL ${msg}`);
  }
};

try {
  // 1. THE LEAK: a credential env var must not reach the printed env, and its presence must
  //    still be legible.
  // A missing store is REFUSED by design (#4955), so exit 1 here is expected; what matters is
  // that the preflight ran and printed its env line rather than creating anything.
  const run = preflight({ DURIG_VERIFIER_API_KEY: FORGED_VERIFIER, DURIG_LOCAL_API_KEY: FORGED_LOCAL });
  check(
    run.status === 0 || run.stdout.includes("store-missing"),
    `the preflight ran without creating a store (exit ${run.status}, "store-missing" reported)`,
  );
  const envLine = (run.stdout || "").split("\n").find((l) => l.includes("env:")) ?? "";
  check(envLine.length > 0, "the preflight printed its env line at all (otherwise the assertion is vacuous)");
  check(!run.stdout.includes(FORGED_VERIFIER), `DURIG_VERIFIER_API_KEY's VALUE is not printed (found "${FORGED_VERIFIER}" in the output)`);
  check(!run.stdout.includes(FORGED_LOCAL), `DURIG_LOCAL_API_KEY's VALUE is not printed (found "${FORGED_LOCAL}" in the output)`);
  check(/DURIG_VERIFIER_API_KEY/.test(envLine), "DURIG_VERIFIER_API_KEY is still NAMED, so the operator can tell which credential is set");
  check(/DURIG_LOCAL_API_KEY/.test(envLine), "DURIG_LOCAL_API_KEY is still NAMED");
  const verifierNote = envLine.match(/"DURIG_VERIFIER_API_KEY":\s*"[^"]*"/)?.[0] ?? "";
  check(/set/.test(verifierNote) && /\d+/.test(verifierNote), `the credential reports set + length, not the value (got ${verifierNote || "nothing"})`);

  // 2. THE NEGATIVE CASE: an unset/empty credential reads as unset, so "set" is evidence, not noise.
  const unsetRun = preflight({ DURIG_VERIFIER_API_KEY: "" });
  const unsetLine = (unsetRun.stdout || "").split("\n").find((l) => l.includes("env:")) ?? "";
  check(/"DURIG_VERIFIER_API_KEY":\s*"unset"/.test(unsetLine), "an empty DURIG_VERIFIER_API_KEY reports \"unset\" (got " + (unsetLine.match(/"DURIG_VERIFIER_API_KEY":\s*"[^"]*"/)?.[0] ?? "absent") + ")");

  // 3. THE PRINT STAYS USEFUL: non-credential config is still shown as a value, because a
  //    preflight that reports nothing is not a preflight.
  const usefulRun = preflight({ DURIG_LOCAL_BASE_URL: "http://127.0.0.1:8080/v1" });
  const usefulLine = (usefulRun.stdout || "").split("\n").find((l) => l.includes("env:")) ?? "";
  check(usefulLine.includes("http://127.0.0.1:8080/v1"), "DURIG_LOCAL_BASE_URL is still printed as a value (the diagnostic must survive the masking)");

  if (failures > 0) {
    console.log(`FAIL — ${failures} check(s): the broker-serve preflight prints credential VALUES (#5700)`);
    process.exit(1);
  }
  console.log("PASS — broker-serve reports credential PRESENCE (set + length) and never the value; unset reads unset; non-credential config still prints");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
