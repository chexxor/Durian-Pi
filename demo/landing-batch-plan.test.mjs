// demo/landing-batch-plan.test.mjs — pins the batching rule of tools/landing-batch-plan.mjs.
// WHY: a landing pass is gated once, so a batch that contains two refs touching the same file is
// the batch that fails the whole pass. The tool's whole value is "which refs compose", and that
// verdict is only as good as the git invocation behind it — one missing `--` and every pair looks
// disjoint, the plan reports zero conflicts, and a seat lands a batch that cannot merge.
// Trigger: any change to tools/landing-batch-plan.mjs, or a landing pass that fails unexpectedly.
// Cost: measured 2026-11-12, Linux Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
// git 2.56.0 — 1.4 s, exit 0. No network, no store, no seat: a throwaway fixture repo.
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
// refD adds a file nobody else touches — disjoint, so it must land with refC.
git("checkout -q -b refD main");
writeFileSync(path.join(dir, "new.txt"), "D\n");
git("add -A && git commit -qm D");

const r = spawnSync("node", ["tools/landing-batch-plan.mjs", "--repo", dir, "--refs", "refA,refB,refC,refD", "--max", "2"], {
	cwd: rigRoot,
	timeout: 120000,
	maxBuffer: 32 * 1024 * 1024,
	encoding: "utf8",
});
if (r.status !== 0) {
	console.error("tool exited", r.status, r.stderr);
	process.exit(1);
}
const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));

const assert = (cond, msg) => {
	if (!cond) {
		console.error("FAIL:", msg, JSON.stringify(j));
		process.exit(1);
	}
};

assert(j.ok === true, "tool reported ok");
assert(j.refsNeedingLanding === 4, "census stub should carry 4 refs");
// The diff invocation must actually count files; without `--` git says "ambiguous argument" and
// every pair looks disjoint.
assert(j.pairsTested === 1, `pairsTested=${j.pairsTested} — expected exactly one shared-file pair; 0 means the diff invocation silently found nothing (the missing \`--\`)`);
assert(j.conflictingPairs === 1, `expected exactly one conflicting pair, got ${j.conflictingPairs}`);
const pair = (j.conflictPairs || []).length ? [j.conflictPairs[0].a, j.conflictPairs[0].b].sort().join(" ") : "";
assert(pair === "refA refB", `the conflicting pair should be refA/refB, got ${pair}`);
assert(j.excludedAsConflicting.length === 2 && j.excludedAsConflicting.includes("refA") && j.excludedAsConflicting.includes("refB"),
	"the conflicting refs must be excluded from the batches");
assert(j.batches.length === 1 && j.batches[0].refs.length === 2, `expected one batch of the two clean refs, got ${JSON.stringify(j.batches.map((b) => b.size))}`);
assert(j.batches[0].refs.includes("refC") && j.batches[0].refs.includes("refD"), "refC and refD must be in the batch");
assert(j.batches[0].command.startsWith("node scripts/land.mjs "), "the plan must print the land command, not a bare list");
assert(j.warning === null, "no coverage warning when pairs were actually tested");

rmSync(dir, { recursive: true, force: true });
console.log("PASS landing-batch-plan: 4 refs, 1 conflicting pair (refA/refB), batch of 2, land command printed");
