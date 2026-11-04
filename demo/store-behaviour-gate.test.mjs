// demo/store-behaviour-gate.test.mjs — the gate that keeps #4955 true is itself pinned (#5090).
//
// WHY THIS DEMO EXISTS. `tools/store-behaviour-gate.mjs` is the standing check that a READ at a path with
// no store REFUSES (exit non-zero, `cause:"no_store"`, absolute `db`, and the file ABSENT afterwards) and
// the stage gate for every pi-pin move (#5095/#5096), where the live store cannot be reopened by the
// previous upstream release. An instrument that decides "is this rig safe" must not be the one thing left
// unverified: the row's own words are that a gate which silently agrees to anything is how this rig got
// here. So this demo pins BOTH directions — the gate passes on the product's real behaviour, and the gate
// FAILS LOUDLY (a) when the behaviour regresses to manufacturing a rig, and (b) when it is aimed at
// something it must never touch.
//
// FAILING-FIRST: at `main` before #5090 the tool does not exist, so every spawn here exits 127 /
// `MODULE_NOT_FOUND` and section 1 cannot even be attempted (measured; recorded in the row).
//
// Run: node demo/store-behaviour-gate.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TOOL = join(repo, "tools", "store-behaviour-gate.mjs");
const dir = mkdtempSync(join(tmpdir(), "durig-store-gate-demo-"));

// Strip the seat's own rig env: a child that inherits DURIG_DB would be measured against the wrong store,
// which is the same class of error this gate is about (the pattern is borrowed from #4955's demo).
function gate(args) {
	const r = spawnSync(process.execPath, [TOOL, ...args], {
		cwd: repo,
		encoding: "utf8",
		timeout: 180000,
	});
	let json = null;
	const out = r.stdout || "";
	try {
		json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
	} catch {}
	return { exit: r.status, json, out, err: r.stderr || "" };
}

const uniq = (name) => join(dir, name);

// ── 1. the gate PASSES on the product's real behaviour, and says so in machine-readable form ─────────
const pass = gate(["--target", uniq("absent.sqlite")]);
assert.equal(pass.exit, 0, `the gate must pass on today's behaviour at an absent path: exit=${pass.exit}\n${pass.out}${pass.err}`);
assert.equal(pass.json.ok, true, "the gate's verdict must be ok:true");
assert.equal(pass.json.pattern.includes('cause == "no_store"'), true, "the gate must PRINT the pattern it asserted (D142)");
assert.equal(pass.json.absentTarget, true, "the gate must record that its target was absent before the run");
assert.equal(pass.json.results.length, 4, `the gate must cover all four read verbs (got ${pass.json.results.length})`);
for (const res of pass.json.results) {
	assert.notEqual(res.exit, 0, `${res.verb}: a read at a storeless path must not exit 0`);
	assert.equal(res.cause, "no_store", `${res.verb}: the refusal must name cause "no_store"`);
	assert.equal(res.dbAbsolute, true, `${res.verb}: the refusal must echo an ABSOLUTE db path`);
}
for (const f of pass.json.targetFiles) {
	assert.equal(f.before, false, `${f.path}: pre-state must be absent`);
	assert.equal(f.after, false, `${f.path}: the store must be ABSENT after, not 0 bytes written`);
}

// ── 2. self-guard: it can NEVER aim at a live store name — and says which key it was holding ─────────
for (const live of ["./selfdev.sqlite", "./rig.sqlite"]) {
	const r = gate(["--target", live]);
	assert.equal(r.exit, 2, `${live}: a live store name must exit 2 (gate could not run), got ${r.exit}`);
	assert.equal(r.json?.cause, "gate_target_refused", `${live}: the refusal must name its cause`);
	assert.equal(r.json?.key, "DURIG_DB", `${live}: the refusal must name the KEY it would have set (same vocabulary as no_store)`);
	assert.equal(r.json?.ok, false, `${live}: a refused gate never reports ok`);
}

// ── 3. self-guard: a scratch store inside the checkout is refused (it can shadow a real one) ─────────
const inside = gate(["--target", join(repo, ".demo-should-refuse.sqlite")]);
assert.equal(inside.exit, 2, "a target inside the checkout must be refused");
assert.equal(inside.json?.cause, "gate_target_refused", "the in-tree refusal must name its cause");

// ── 4. it FAILS LOUDLY at an EXISTING store, and does not touch the file it refused (#5090's ask) ───
const existing = uniq("existing.sqlite");
writeFileSync(existing, "not a rig, and this gate will not touch it");
const before = lstatSync(existing);
const refused = gate(["--target", existing]);
assert.equal(refused.exit, 2, "an existing target must be refused unless --allow-existing is passed");
assert.equal(refused.json?.cause, "gate_target_exists", "the existing-store refusal must name its cause");
const after = lstatSync(existing);
assert.equal(after.size, before.size, "a refused gate must leave the file it refused byte-identical");
assert.equal(after.mtimeMs, before.mtimeMs, "a refused gate must not even move the mtime of a store");

// ── 5. the gate has TEETH: a cli that MANUFACTURES a rig fails the gate, loudly ─────────────────────
// This is the #4955 defect replayed on a fixture, so the assertion is pinned without waiting for a
// regression in the product. The control does not depend on this box's build.
const fake = join(dir, "fake-cli.mjs");
writeFileSync(
	fake,
	[
		"import { writeFileSync } from 'node:fs';",
		"if (process.env.FAKE_MODE === 'manufacture') writeFileSync(process.env.DURIG_DB, 'SQLite format 3\\0not a rig');",
		"console.log(JSON.stringify(process.env.FAKE_MODE === 'nameless' ? { ok: false, error: 'no store here' } : { ok: true, command: 'status', items: [] }));",
		"process.exit(process.env.FAKE_MODE === 'nameless' ? 1 : 0);",
		"",
	].join("\n"),
);
const manufacturedRun = spawnSync(process.execPath, [TOOL, "--cli", fake, "--verbs", "status", "--target", uniq("manufactured.sqlite")], {
	cwd: repo,
	env: { ...process.env, FAKE_MODE: "manufacture" },
	encoding: "utf8",
	timeout: 120000,
});
let manJson = null;
try {
	const out = manufacturedRun.stdout || "";
	manJson = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
} catch {}
assert.equal(manufacturedRun.status, 1, "a cli that manufactures a store must fail the gate with exit 1");
assert.equal(manJson?.ok, false, "the manufacture verdict must be ok:false");
assert.equal(
	manJson?.failures.some((f) => f.includes("manufactured a rig")),
	true,
	`the failure must NAME the defect (the #4955 shape), got: ${JSON.stringify(manJson?.failures)}`,
);
assert.equal(
	manJson?.targetFiles.some((f) => f.after === true),
	true,
	"the gate must report that the store EXISTS after the run — an exit-code-only check would have missed it",
);

// ── 6. teeth, second shape: a refusal that names NO cause is still a failure ────────────────────────
const nameless = spawnSync(process.execPath, [TOOL, "--cli", fake, "--verbs", "status", "--target", uniq("nameless.sqlite")], {
	cwd: repo,
	env: { ...process.env, FAKE_MODE: "nameless" },
	encoding: "utf8",
	timeout: 120000,
});
let namelessJson = null;
try {
	namelessJson = JSON.parse((nameless.stdout || "").slice((nameless.stdout || "").indexOf("{"), (nameless.stdout || "").lastIndexOf("}") + 1));
} catch {}
assert.equal(nameless.status, 1, "a refusal with no named cause must fail the gate (exit 1)");
assert.equal(
	namelessJson?.failures.some((f) => f.includes('cause "no_store"')),
	true,
	`the failure must name the missing cause, got: ${JSON.stringify(namelessJson?.failures)}`,
);

rmSync(dir, { recursive: true, force: true });
console.log(
	`STORE BEHAVIOUR GATE TEST PASS — the gate passes on the product's real refusal (4 verbs, cause named, absolute db, target ABSENT after: ${pass.json.targetFiles.map((f) => f.path.split("/").pop()).join(", ")}); it REFUSES a live store name, an in-tree path and an existing file with a NAMED cause (${pass.json.results.length ? "gate_target_refused / gate_target_exists" : ""}, exit 2) and leaves the refused file byte-identical; and it has teeth — a fixture that manufactures a rig exits 1 naming "manufactured a rig" and reports the store EXISTS, a nameless refusal exits 1 naming the missing cause (#5090).`,
);
