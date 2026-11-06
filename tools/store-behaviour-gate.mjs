#!/usr/bin/env node
// tools/store-behaviour-gate.mjs — "does a READ at a path with no store refuse, or manufacture a rig?"
//
// WHY THIS EXISTS. #4955 measured `main` answering a typo'd `DURIG_DB` with **exit 0** and a
// **122,880 B empty rig** (`{ok:true, seats:0}`): the cheap signal was the lie, and an exit-code-only
// check had already passed the defect. The fix is only a fix while a gate keeps asserting the whole
// behaviour, so the gate is promoted out of `.spike/` (it paid for itself twice: it is #4955's standing
// check, and it is the stage gate for every pi-pin move, #5095/#5096, where the store CANNOT be reopened
// by the previous upstream release and a careless gate is a hazard, not a helper).
//
// WHAT IT ASSERTS (all three, per verb, or it is not this gate):
//   1. exit code NON-ZERO for the read verbs given a `DURIG_DB` naming an ABSENT path;
//   2. the refusal NAMES the cause (`cause:"no_store"`) and echoes the ABSOLUTE `db` path;
//   3. the store file is **ABSENT afterwards** — `.sqlite`, `-wal`, `-shm` all absent, NOT "0 bytes
//      written". A manufactured store is the defect; an exit code alone cannot see it.
//
// THE SELF-GUARD IS PART OF THE DELIVERABLE. This tool sets `DURIG_DB` for the child it spawns, so a
// tool that could aim at the live store is a way to corrupt a rig. It therefore refuses, loudly, with a
// NAMED CAUSE (same vocabulary as `no_store`, `restart_limit`) naming the key it would have set:
//   `gate_target_refused` — the target is named for a live store (`selfdev.sqlite`, `rig.sqlite`) or
//                           resolves INSIDE the repo tree;
//   `gate_target_exists`  — the target is an existing file and `--allow-existing` was not passed.
// Refusals exit **2**, so "the gate could not run" is never mistaken for "the gate passed" (exit 0) or
// "the behaviour is defective" (exit 1). A gate that silently agrees to anything is how this rig got here.
//
// IT IS AN INSTRUMENT, NOT A FIX (tools/README.md rules). It writes nothing in this tree and never
// touches a store it did not create: the only path it may use is a scratch path it can prove is absent
// (or, with `--allow-existing`, prove unchanged by size+mtime). It opens no Harness and no store itself —
// it spawns `cli.mjs`, the same surface a seat uses, so the verdict is the product's behaviour.
//
// Usage: node tools/store-behaviour-gate.mjs [--target <abs-scratch-path>] [--verbs status,queue,ps,show]
//        [--cli <cli.mjs>] [--allow-existing] [--json <out.json>]
// Exit:  0 gate ran and every verb passed · 1 gate ran and a behaviour assertion FAILED ·
//        2 the gate could not run (self-guard, missing cli, unusable target).

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};

const CLI = resolve(ROOT, opt("cli", "cli.mjs"));
const VERBS = (opt("verbs", "status,queue,ps,show") || "")
	.split(",")
	.map((v) => v.trim())
	.filter(Boolean)
	.map((v) => (v === "show" ? ["show", "1"] : v.split(/\s+/)));
const ALLOW_EXISTING = flag("allow-existing");
const OUT = opt("json", null);
const LIVE_NAMES = ["selfdev.sqlite", "rig.sqlite"]; // never a gate target, under any flag
const t0 = Date.now();

/** A target is refused with a NAMED cause; the reason names the key the gate would have set. */
function guardTarget(target) {
	const base = target.split(sep).pop();
	if (LIVE_NAMES.includes(base)) {
		return { cause: "gate_target_refused", why: `"${base}" is a live store name; this gate never aims DURIG_DB at a live store` };
	}
	const rel = relative(ROOT, target);
	if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
		return { cause: "gate_target_refused", why: `the target resolves INSIDE this checkout (${rel}); a scratch store belongs outside the tree, where it cannot shadow or land a real one` };
	}
	if (existsSync(target) && !ALLOW_EXISTING) {
		return { cause: "gate_target_exists", why: `${target} already exists; the gate asserts a refusal at an ABSENT path. Point it at a path that does not exist, or pass --allow-existing to run the non-modification half` };
	}
	return null;
}

function snapshot(path) {
	try {
		const s = lstatSync(path);
		return { exists: true, size: s.size, mtimeMs: s.mtimeMs };
	} catch {
		return { exists: false, size: null, mtimeMs: null };
	}
}

function verdict(payload) {
	const text = JSON.stringify(payload, null, 2);
	console.log(text);
	if (OUT) {
		mkdirSync(resolve(ROOT, OUT).split(sep).slice(0, -1).join(sep) || ROOT, { recursive: true });
		writeFileSync(resolve(ROOT, OUT), `${text}\n`);
	}
}

if (!existsSync(CLI)) {
	verdict({ ok: false, command: "store-behaviour-gate", cause: "cli_not_found", cli: CLI, key: "--cli" });
	process.exit(2);
}

const target = resolve(ROOT, opt("target", join(tmpdir(), "durig-store-gate", "no-store-gate.sqlite")));
const ref = guardTarget(target);
if (ref) {
	verdict({ ok: false, command: "store-behaviour-gate", ...ref, target, key: "DURIG_DB", ms: Date.now() - t0 });
	process.exit(2);
}

// The gate asserts a pattern; print it, because a gate whose rule is invisible cannot be argued with (D142).
const PATTERN = 'per verb: exit != 0 AND cause == "no_store" AND db echoed absolute AND {"" ,"-wal","-shm"} ABSENT after';
const sidecars = [target, `${target}-wal`, `${target}-shm`];
if (!ALLOW_EXISTING) {
	for (const p of sidecars) rmSync(p, { force: true });
	mkdirSync(target.split(sep).slice(0, -1).join(sep), { recursive: true });
}
const before = sidecars.map(snapshot);

const results = [];
for (const verb of VERBS) {
	const r = spawnSync(process.execPath, [CLI, ...verb], {
		cwd: ROOT,
		env: { ...process.env, DURIG_DB: target, DURIG_NO_SERVE: "1", DURIG_TUI_DISABLE_EXIT_HOOK: "1" },
		encoding: "utf8",
		timeout: 120000,
	});
	const out = r.stdout || "";
	let parsed = null;
	try {
		parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
	} catch {}
	const cause = parsed?.cause ?? parsed?.error?.cause ?? null;
	const db = parsed?.db ?? parsed?.store ?? null;
	const absolute = typeof db === "string" && isAbsolute(db);
	results.push({
		verb: verb.join(" "),
		exit: r.status,
		ok: parsed?.ok ?? null,
		cause,
		db,
		dbAbsolute: absolute,
		stdoutHead: out.slice(0, 140).replace(/\s+/g, " "),
		stderrHead: (r.stderr || "").slice(0, 140).replace(/\s+/g, " "),
	});
}

const after = sidecars.map(snapshot);
const failures = [];
for (const res of results) {
	if (res.exit === 0) failures.push(`${res.verb}: exited 0 — a read at a storeless path manufactured a rig (the #4955 shape)`);
	if (res.cause !== "no_store") failures.push(`${res.verb}: refusal did not name cause "no_store" (got ${JSON.stringify(res.cause)})`);
	if (!res.dbAbsolute) failures.push(`${res.verb}: refusal did not echo an ABSOLUTE db path (got ${JSON.stringify(res.db)})`);
}
if (!ALLOW_EXISTING) {
	for (const [i, p] of sidecars.entries()) {
		if (after[i].exists) failures.push(`${p}: EXISTS after the run (${after[i].size} B) — the gate's whole point is that nothing is written`);
	}
} else {
	for (const [i, p] of sidecars.entries()) {
		if (before[i].exists && (after[i].size !== before[i].size || after[i].mtimeMs !== before[i].mtimeMs)) {
			failures.push(`${p}: MODIFIED by the run (size ${before[i].size}→${after[i].size}, mtime moved) — a gate must never be the thing that clobbers a store`);
		}
	}
}

const created = !ALLOW_EXISTING ? sidecars.map((p, i) => ({ path: p, before: before[i].exists, after: after[i].exists })) : null;
const payload = {
	ok: failures.length === 0,
	command: "store-behaviour-gate",
	pattern: PATTERN,
	target,
	absentTarget: !before.some((b) => b.exists),
	verbs: VERBS.map((v) => v.join(" ")),
	cli: relative(ROOT, CLI),
	results,
	targetFiles: created,
	failures,
	captured: new Date().toISOString(),
	ms: Date.now() - t0,
	provenance: "gate promoted from .spike/delegate-20261104b/gate2.mjs (#5090); #4955/#5079/#5083 measured the defect it guards",
};
verdict(payload);
if (!ALLOW_EXISTING) for (const p of sidecars) rmSync(p, { force: true });
process.exit(failures.length === 0 ? 0 : 1);
