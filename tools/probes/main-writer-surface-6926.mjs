// probe for #6926: which verbs can move `main`, and is the mode decision a base rule or a hook?
// Run: node tools/probes/main-writer-surface-6926.mjs
import { refusalFor } from "../../src/confine.mjs";

const cases = [
	["seat moves main by ref", "git update-ref refs/heads/main deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"],
	["seat fast-forwards main in its worktree", "git merge --ff-only item-6926"],
	["seat re-points main", "git branch -f main item-6926"],
	["seat commits in its own worktree", "git commit -m names its item #6926"],
	["seat attaches a stray worktree to main", "git worktree add /tmp/x main"],
	["seat moves its own item branch", "git update-ref refs/heads/item-6926 HEAD"],
	["operator promote verb exists", "node cli.mjs promote"],
	["operator lands a branch", "node scripts/land.mjs item-6926 --suite"],
];

console.log("=== confine.mjs refusalFor: what a SEAT may run against refs/heads/main ===");
let allowed = 0;
for (const [what, cmd] of cases) {
	const r = refusalFor(cmd, { root: process.cwd(), cwd: process.cwd() });
	if (r) {
		console.log(`  REFUSED  ${what}: ${cmd.slice(0, 48)}`);
	} else {
		allowed++;
		console.log(`  ALLOWED  ${what}: ${cmd.slice(0, 48)}`);
	}
}
console.log(`  ${allowed} of ${cases.length} allowed`);
