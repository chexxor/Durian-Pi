// demo/shared-cwd-read-verbs.test.mjs — #4790: a degraded-cwd seat may run a BARE READ verb.
//
// THE DEADLOCK THIS CLOSES, measured by two seats: after `complete_work` the cwd degrades to the shared
// checkout; the guard refuses EVERY shell command there; and `prepare_workspace` refuses because the
// seat holds no claimed item. SO AN IDLE SEAT COULD NOT RUN `status`, COULD NOT RUN `queue`, AND COULD
// NOT PREPARE A WORKSPACE TO GET OUT. The guard's refusal told the seat to inspect "from a correct cwd
// one call later" — but there was no call it could make.
//
// THE PAIR IS THE ASSERTION: reads are allowed AND a WRITE verb is still refused. A change that opened
// the shared checkout to everything would pass the first half alone.
//
// Run: node demo/shared-cwd-read-verbs.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { isReadOnlyCliInvocation } from "../src/seatguard.mjs";

let failures = 0;
const check = (label, cond, detail = "") => {
	if (cond) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
};

console.log("\n#4790 — the ALLOW half: bare read verbs from the shared checkout");
for (const cmd of [
	"node cli.mjs status",
	"node cli.mjs queue",
	"node cli.mjs status --json",
	"node cli.mjs queue --waiting",
	"node.exe cli.mjs status",
]) {
	check(`ALLOWED: ${cmd}`, isReadOnlyCliInvocation(cmd) === true);
}

console.log("\n#4790 — the REFUSE half: a WRITE verb, and every way a read becomes one");
for (const cmd of [
	"node cli.mjs pause", //                a WRITE verb, not on the read allow list
	"node cli.mjs up",
	"node cli.mjs check", //                reads, but it is not on the ALLOW LIST: default is refuse
	"node cli.mjs status; Set-Content x 1", // CHAINING is how a read becomes a write
	"node cli.mjs status && rm -rf x",
	"node cli.mjs queue | Out-File x",
	"node cli.mjs status > out.txt", //     a REDIRECT
	"node cli.mjs status & node cli.mjs pause",
	"echo hi",
	"cli.mjs status", //                    NOT runnable without `node` on this host: not an invocation
	"node other.mjs status", //             a different program
	"node cli.mjs", //                      no verb
	"",
]) {
	check(`REFUSED: ${JSON.stringify(cmd)}`, isReadOnlyCliInvocation(cmd) === false);
}

console.log("\n#4790 — the DEFAULT is the safety, not the list");
// The allow list names what is PERMITTED; everything else stays refused. That is the OPPOSITE of the
// write guard, where a list names every refusal and a missing entry is a hole.
check("an unknown verb is refused (a verb nobody thought of stays refused)", isReadOnlyCliInvocation("node cli.mjs somethingNew") === false);
check("a bare `node` is refused", isReadOnlyCliInvocation("node") === false);

assert.equal(failures, 0, `${failures} check(s) failed`);
console.log("\nSHARED-CWD-READ-VERBS TEST PASS (bare read verbs allowed from the shared checkout; writes, chaining and redirects still refused)");
process.exit(0);
