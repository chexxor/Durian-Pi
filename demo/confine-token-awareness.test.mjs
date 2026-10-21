// #4572 — the CONTROL CANARY, both halves in one test.
//
// A substring guard and a token-aware guard are indistinguishable until you put a refused verb inside a
// QUOTED STRING: the substring guard refuses it, the token-aware one allows it. And they are
// indistinguishable again until you invoke the same verb for real: both must refuse that. EITHER HALF ALONE
// IS SATISFIABLE BY A BROKEN IMPLEMENTATION — an always-allow passes the quoted case, an always-deny passes
// the invocation case.
import { refusalFor } from "../src/confine.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures++;
		console.log(`  FAIL ${label} -- ${detail}`);
	}
};

console.log("\n=== A REFUSED VERB INSIDE A QUOTED STRING IS ALLOWED ===");
// Each of these is a command whose ONLY occurrence of the verb is DATA.
for (const cmd of [
	`Select-String -Path src/*.mjs -Pattern 'git stash'`,
	`rg "git reset --hard" docs/`,
	`grep -rn "git clean -fd" .`,
	`echo "git restore . would discard work"`,
	`node -e "console.log('git revert is refused')"`,
]) {
	const r = refusalFor(cmd);
	check(`quoted mention is ALLOWED: ${cmd.slice(0, 52)}`, r === null, String(r).slice(0, 90));
}

console.log("\n=== THE SAME VERBS AS ACTUAL INVOCATIONS ARE REFUSED ===");
for (const cmd of [
	"git reset --hard",
	"git switch main",
	"git restore .",
	"git revert HEAD",
	"git clean -fd",
	"git stash",
	"git -C ../other reset --hard",
]) {
	const r = refusalFor(cmd);
	check(`invocation is REFUSED: ${cmd}`, typeof r === "string", "allowed — the guard has been widened into uselessness");
}

console.log("\n=== AND THE ONE THAT WAS ALREADY RIGHT IS UNCHANGED ===");
check("`git branch -D` still refused", typeof refusalFor("git branch -D feature") === "string");
check("`git branch -d` still allowed", refusalFor("git branch -d feature") === null);

console.log(failures === 0 ? "\nPASS — quoted mentions are data, invocations are refused, and neither half alone would prove it" : `\nFAIL — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
