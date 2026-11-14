// #6374: a suite total is only comparable with a total from the SAME dependency plane.
// `node scripts/sync-pi.mjs --check` compares the PIN to UPSTREAM and says nothing about the tree
// you are standing in; src/worktree.mjs warns once at creation and then goes silent. Measured on
// 2026-11-11: the seat root resolved the VENDORED build of the pinned tag (pi-durable 1.5.1) while
// an item worktree installed the lockfile's released 1.3.0, and suite totals of 282/283 came out of
// trees resolving different versions of the same library.
//
// This test executes the entrypoints - src/depplane.mjs measures, src/checkup.mjs turns the
// measurement into a finding, cli.mjs wires the measurement into `check` and prints it - and it
// proves the store read is read-only by comparing the file and its sidecars before and after.
// Run: node demo/depplane.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { readDependencyPlane, pinVersion } from "../src/depplane.mjs";
import { auditRig, formatCheck, RULES } from "../src/checkup.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
// The scratch lives in THIS tree (gitignored). A fresh worktree - the lander's scratch, an item
// worktree - has no .scratch/ yet, so create it: mkdtempSync does not create the parent.
mkdirSync(join(ROOT, ".scratch"), { recursive: true });
const scratch = mkdtempSync(join(ROOT, ".scratch", "depplane-"));
const spec = () => ({ version: 2, seats: [{ name: "alpha", role: "Implementer (author)", capabilities: ["testing"] }] });
const ids = (r) => r.findings.map((f) => f.id);
const checkOf = (r, id) => r.checks.find((c) => c.id === id) ?? null;

/** A store whose durable_schema.version is `version`, written once, then never touched. */
function makeStore(path, version) {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE durable_schema (version INTEGER)");
  db.prepare("INSERT INTO durable_schema (version) VALUES (?)").run(version);
  db.close();
}

function snapshot(path) {
  const st = statSync(path);
  return { size: st.size, mtimeMs: st.mtimeMs, wal: existsSync(`${path}-wal`), shm: existsSync(`${path}-shm`) };
}

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`ok   ${label}`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${label}: ${err.message}`);
  }
};

try {
  // 1. The pin's version is read from the ref it NAMES, and a ref that names no version is UNKNOWN,
  //    not a pass.
  check("pinVersion reads a tag ref", () => assert.equal(pinVersion({ ref: "v1.5.1" }), "1.5.1"));
  check("pinVersion reads a bare version", () => assert.equal(pinVersion({ ref: "1.3.0" }), "1.3.0"));
  check("pinVersion on no ref is null", () => assert.equal(pinVersion({ ref: null, sha: "abc" }), null));

  // 2. The real tree: every leg measured, and the line is a string a human can read.
  const plane = await readDependencyPlane({ root: ROOT });
  check("plane resolves a pi version", () => assert.ok(plane.resolved, `no pi-durable resolved in ${ROOT}`));
  check("plane names the pin version", () => assert.ok(plane.pinVersion, "the pin names no version"));
  check("plane says which path it resolved through", () => assert.ok(plane.resolvedPath && plane.resolvedVia));
  check("plane line contains both numbers", () => {
    assert.ok(typeof plane.line === "string" && plane.line.includes(plane.resolved) && plane.line.includes(plane.pinVersion), plane.line);
  });
  check("versionAgrees is a measured boolean, not a default", () =>
    assert.equal(plane.versionAgrees, plane.resolved === plane.pinVersion));

  // 3. The store leg is READ-ONLY: the schema version is read without creating, migrating or touching
  //    the file, and no -wal/-shm sidecar appears.
  const store = join(scratch, "plane-store.sqlite");
  // Built ONE version ABOVE whatever the resolved pi-durable actually supports: the "store newer than
  // the code" case then exists in EVERY dependency plane. Hard-coding 2 assumed the resolved code
  // supports 1, which is false on the pin (1.5.1 supports 2) - the assertion went red in the lander's
  // scratch while passing in a tree on the older release. Measured 2026-11-14.
  const newerThan = (plane.supportedSchema ?? 1) + 1;
  makeStore(store, newerThan);
  const before = snapshot(store);
  const measured = await readDependencyPlane({ root: ROOT, db: store });
  const after = snapshot(store);
  check("store schema version is read", () => assert.equal(measured.storeSchema, newerThan));
  check("a store newer than the resolved code is flagged as disagreeing", () => {
    assert.ok(measured.supportedSchema !== null, "the resolved pi-durable did not expose CURRENT_SQLITE_SCHEMA_VERSION");
    assert.equal(measured.schemaAgrees, measured.storeSchema <= measured.supportedSchema);
    assert.equal(measured.storeSchema > measured.supportedSchema, true, "the store is newer than the code supports but the leg says it agrees");
  });
  check("the read did not touch the store", () => {
    assert.equal(after.size, before.size, "the store's size changed under a read-only open");
    assert.equal(after.mtimeMs, before.mtimeMs, "the store's mtime changed under a read-only open");
    assert.equal(after.wal, false, "a -wal sidecar appeared");
    assert.equal(after.shm, false, "a -shm sidecar appeared");
  });
  const none = await readDependencyPlane({ root: ROOT, db: join(scratch, "no-store-here.sqlite") });
  check("a missing store reports why instead of a number", () => {
    assert.equal(none.storeSchema, null);
    assert.ok(none.storeSchemaWhy, "no reason given for the unreadable store");
  });

  // 4. The rule: a mismatch is a FINDING (fix-now), and an unmeasured leg is a SKIP with a reason -
  //    never a silent pass. `check` reports, it does not decide: fix-now cannot fail the run.
  const mismatch = auditRig({
    rig: "test.rig.json",
    spec: spec(),
    specConstitution: null,
    stored: { reason: "absent" },
    dependencyPlane: {
      package: "@earendil-works/pi-durable",
      resolved: "1.3.0",
      resolvedVia: "released package (lockfile)",
      resolvedPath: "node_modules/@earendil-works/pi-durable/package.json",
      pinRef: "v1.5.1",
      pinSha: "dd30101c",
      pinnedAt: "2026-11-10T06:49:26.320Z",
      pinVersion: "1.5.1",
      versionAgrees: false,
      storeSchema: 2,
      storeSchemaWhy: null,
      supportedSchema: 1,
      supportedVia: "CURRENT_SQLITE_SCHEMA_VERSION from the resolved package",
      supportedMigrations: [1, 2],
      schemaAgrees: false,
      db: "selfdev.sqlite",
      line: "pi-durable 1.3.0 (released package (lockfile)) · pin v1.5.1 · store schema 2 vs supported 1",
    },
  });
  check("the rule fires on a version mismatch", () => {
    assert.ok(ids(mismatch).includes("pi-dependency-plane"), `no finding; ids=${JSON.stringify(ids(mismatch))}`);
  });
  check("the rule fires on a schema-version mismatch too", () => {
    const both = mismatch.findings.filter((f) => f.id === "pi-dependency-plane");
    assert.equal(both.length, 2, `expected a version finding and a schema finding, got ${both.length}`);
    assert.ok(both[1].detail.includes("newer than supported version 1"), both[1].detail);
  });
  check("fix-now never fails the audit (report, not gate)", () => {
    assert.equal(mismatch.summary["fix-now"] > 0, true);
    assert.equal(mismatch.exitCode, 0, "a fix-now finding exited 1");
    assert.equal(mismatch.pass, true);
  });
  check("an unmeasured plane is UNKNOWN with a reason, never a silent pass", () => {
    const r = auditRig({ rig: "test.rig.json", spec: spec(), specConstitution: null, stored: { reason: "absent" } });
    const c = checkOf(r, "pi-dependency-plane");
    assert.ok(c, "the rule is not in the checks list at all");
    assert.equal(c.status, "unknown", `status was ${c.status}: ${c.why ?? "(no reason)"}`);
    assert.ok((c.why ?? "").length > 0, "unknown with no reason is indistinguishable from a pass");
  });
  check("a plane on the pin raises nothing", () => {
    const r = auditRig({
      rig: "test.rig.json",
      spec: spec(),
      specConstitution: null,
      stored: { reason: "absent" },
      dependencyPlane: {
        package: "@earendil-works/pi-durable",
        resolved: "1.5.1",
        resolvedVia: "vendored build (sync-pi --link)",
        resolvedPath: "vendor/pi-main/packages/durable/package.json",
        pinRef: "v1.5.1",
        pinVersion: "1.5.1",
        versionAgrees: true,
        storeSchema: 1,
        supportedSchema: 1,
        schemaAgrees: true,
        db: "selfdev.sqlite",
        line: "pi-durable 1.5.1 (vendored build) · pin v1.5.1 · store schema 1 vs supported 1",
      },
    });
    assert.equal(ids(r).includes("pi-dependency-plane"), false);
  });
  check("the rule is declared in RULES", () => {
    const rule = RULES.find((r) => r.id === "pi-dependency-plane");
    assert.ok(rule, "the rule is not in RULES, so the report cannot list it");
    assert.equal(rule.severity, "fix-now");
  });
  check("formatCheck prints the plane as a line, not an object", () => {
    const out = formatCheck(mismatch, { rigDisplay: "test.rig.json", seats: 1, storeReason: "absent" });
    assert.ok(out.includes("dependency plane: pi-durable 1.3.0"), out.split("\n").filter((l) => l.includes("plane")).join("\n"));
    assert.ok(!out.includes("[object Object]"), "the plane printed as an object");
  });

  // 5. The CLI wiring: `check` carries the plane in both output forms - the human line and the JSON
  //    field a pipe reads - and exits 0, because a check reports, it does not decide.
  const runCli = (args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ["cli.mjs", ...args], {
        cwd: ROOT,
        env: { ...process.env, DURIG_PROVIDER: "faux" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      child.once("exit", (code) => resolve({ code, stdout, stderr }));
    });
  const human = await runCli(["check", "--rig", "rig.selfdev.json", "--human"]);
  const json = await runCli(["check", "--rig", "rig.selfdev.json", "--json"]);
  check("human check exits 0 and prints the dependency plane", () => {
    assert.equal(human.code, 0, `cli check exited ${human.code}: ${human.stderr}`);
    assert.ok(/dependency plane: pi-durable \d+\.\d+\.\d+/.test(human.stdout), `no plane line in output:\n${human.stdout}`);
    assert.ok(
      human.stdout.includes("pi-dependency-plane") === !JSON.parse(json.stdout).plane.versionAgrees,
      "the report names the dependency rule exactly when the measured plane disagrees with the pin",
    );
  });
  check("json check carries the measured plane as data", () => {
    assert.equal(json.code, 0, `cli check --json exited ${json.code}: ${json.stderr}`);
    const payload = JSON.parse(json.stdout);
    assert.ok(payload.plane && payload.plane.line, "no plane field in the JSON payload");
    assert.equal(payload.plane.resolved, plane.resolved, "the CLI measured a different version than the module");
    assert.ok(payload.checks.some((c) => c.id === "pi-dependency-plane"), "the rule is missing from the checks list");
  });
  console.log(`\ncli check plane line: ${(human.stdout.match(/dependency plane: .*/) || ["(none)"])[0]}`);
  console.log(`${failures === 0 ? "PASS" : "FAIL"} depplane: ${failures} failing assertion(s)`);
  process.exit(failures === 0 ? 0 : 1);
} catch (err) {
  console.error(`depplane test crashed: ${err.stack}`);
  process.exit(1);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
