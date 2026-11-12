// demo/landing-batch-plan.test.mjs — pins the batching rule of tools/landing-batch-plan.mjs.
// WHY: a landing pass is gated once, so a batch that contains two refs that cannot merge is the
// batch that fails the whole pass. The tool's whole value is "which refs compose", and that
// verdict is only as good as the git invocation behind it: one missing `--` and every pair looks
// disjoint, the plan reports zero conflicts, and a seat lands a batch that cannot merge. The
// SECOND thing it pins is the chain: `git merge-tree --write-tree` cannot be chained on a tree
// object, so a sequential pass must be simulated with a scratch commit. If that promotion is
// wrong, the plan says "these 12 compose" for 12 refs that do not.
// Trigger: any change to tools/landing-batch-plan.mjs, or a landing pass that fails unexpectedly.
// Cost: measured 2026-11-12, Linux Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
// git 2.56.0 — 0.27 s, exit 0. No network, no store, no seat: a throwaway fixture repo.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rigRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const dir = mkdtempSync(path.join(os.tmpdir(), "landing-batch-fixture-"));

const git = (args) => execSync(`git ${args}`, { cwd: dir, shell: "/bin/bash", stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

git("init -q -b main");
git("config user.name fixture");
git("config user.email fixture@example.invalid");
writeFileSync(path.join(dir, "shared.txt"), "base\n");
writeFileSync(path.join(dir, "other.txt"), "base\n");
git("add -A && git commit -qm base");

// refA and refB both change shared.txt from the same base, in ways git cannot reconcile.
git("checkout -q -b refA main");
writeFileSync(path.join(dir, "shared.txt"), "A\n");
git("commit -qam A");
git("checkout -q -b refB main");
writeFileSync(path.join(dir, "shared.txt"), "B\n");
git("commit -qam B");
// refC touches a file nobody else touches.
git("checkout -q -b refC main");
writeFileSync(path.join(dir, "other.txt"), "C\n");
git("commit -qam C");
// refD adds a file nobody else touches — disjoint, so it must land with something.
git("checkout -q -b refD main");
writeFileSync(path.join(dir, "new.txt"), "D\n");
git("add -A && git commit -qm D");

const run = (extra) => spawnSync("node", ["tools/landing-batch-plan.mjs", "--repo", dir, "--refs", "refA,refB,refC,refD", "--max", "2", ...extra], {
	cwd: rigRoot,
	timeout: 120000,
	maxBuffer: 32 * 1024 * 1024,
	encoding: "utf8",
});

const assert = (cond, msg) => {
	if (!cond) {
		console.error("FAIL:", msg);
		rmSync(dir, { recursive: true, force: true });
		process.exit(1);
	}
};

// A) the chain — the primary answer.
const r = run([]);
if (r.status !== 0) {
	console.error("tool exited", r.status, r.stderr);
	rmSync(dir, { recursive: true, force: true });
	process.exit(1);
}
const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));

assert(j.ok === true, "tool reported ok");
assert(j.refsNeedingLanding === 4, `census stub should carry 4 refs, got ${j.refsNeedingLanding}`);
assert(j.bins.length === 2 && j.bins.every((b) => b.size === 2), `expected two bins of 2, got ${JSON.stringify(j.bins.map((b) => b.size))}`);
assert(j.bins.reduce((s, b) => s + b.refs.length, 0) === 4, "every ref must be placed in a bin — a plan that drops refs is not a plan");
const binOf = (ref) => j.bins.findIndex((b) => b.refs.includes(ref));
assert(binOf("refA") !== binOf("refB"), "refA and refB conflict, so they must not land in the same pass");
assert(binOf("refC") === binOf("refA") || binOf("refC") === binOf("refB"), "refC is disjoint and must be packed into a bin");
assert(j.bins[0].command.startsWith("node scripts/land.mjs "), "the plan must print the land command, not a bare list");

// The chain claim is a merge claim: re-verify the first bin independently, one merge at a time.
const seq = j.bins[0].refs;
let acc = git("rev-parse main");
for (const ref of seq) {
	const t = spawnSync("git", ["merge-tree", "--write-tree", acc, ref], { cwd: dir, timeout: 20000 });
	assert(t.status === 0, `bin 1 claims ${seq.join(" ")} compose, but merge-tree failed at ${ref}`);
	acc = spawnSync("git", ["commit-tree", t.stdout.toString().trim().split("\n")[0], "-p", acc, "-p", ref, "-m", "demo-verify"], { cwd: dir, timeout: 20000 }).stdout.toString().trim();
}

// B) the pairwise diagnostics, with the trap that makes them silently empty.
const p = run(["--pairwise"]);
assert(p.status === 0, `pairwise run exited ${p.status} ${p.stderr}`);
const pj = JSON.parse(p.stdout.slice(p.stdout.indexOf("{")));
assert(pj.pairsTested === 1, `pairsTested=${pj.pairsTested} — expected exactly one shared-file pair; 0 means the diff invocation silently found nothing (the missing \`--\`)`);
assert(pj.conflictingPairs === 1, `expected exactly one conflicting pair, got ${pj.conflictingPairs}`);
const pair = (pj.conflictPairs || []).length ? [pj.conflictPairs[0].a, pj.conflictPairs[0].b].sort().join(" ") : "";
assert(pair === "refA refB", `the conflicting pair should be refA/refB, got ${pair}`);

rmSync(dir, { recursive: true, force: true });
console.log("PASS landing-batch-plan: 4 refs -> 2 verified bins of 2; refA/refB separated; pairwise pins the `--` trap");
