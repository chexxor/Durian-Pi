#!/usr/bin/env node
// ESCAPE BASELINE — the six escapes `docs/reviews/security-seat-sandbox-position.md` gate G5 names, run against
// the guard as it exists today. Read-only: it calls the guard's own pure decision functions, it never spawns a
// shell, never touches the network, and never writes a file.
//
//   node docs/evidence/2026-11-09-milestone-m5/escape-baseline.mjs
//
// WHY this exists. G5 says the escape set "must be demonstrated to pass today and block after". Without a recorded
// baseline, "we added egress control" is unfalsifiable: there is no before. This file is the before. It is the
// acceptance instrument for ROADMAP 268 and the D2 task in docs/reviews/milestone-m5-solidified-2026-11-09.md.
//
// Exit 0 always; the point is the printed table, not a verdict. Re-run after any enforcement change and diff the
// table against the recorded baseline in this directory.
import { refusalFor } from "../../../src/confine.mjs";
import { shellWriteRefusal, withheldShellRefusal } from "../../../src/seatguard.mjs";
import { toolRemovalsFor } from "../../../src/seattools.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Derived, not hard-coded: the project must not depend on this machine's paths (D205).
// Nothing here is written to; the root is only a *shape* the guard reasons about.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."); // repo root
const SEAT = join(REPO, "item-5801");   // a real seat-root shape
const SIBLING = join(REPO, "item-5604");
const SEED = process.argv[2] || "2026-11-09";

const escapes = [
	{ name: "(a) read a key outside the seat root", cmd: "cat ~/.ssh/id_rsa", layer: "path containment" },
	{ name: "(b) TCP to an ungranted loopback port", cmd: "nc 127.0.0.1 8080", layer: "egress" },
	{ name: "(c) TCP to a LAN / TEST-NET address", cmd: "curl -s http://192.168.1.1/", layer: "egress" },
	{ name: "(c2) the link-local metadata endpoint", cmd: "wget http://169.254.169.254/metadata", layer: "egress" },
	{ name: "(d) git config --global core.hooksPath <outside>", cmd: "git config --global core.hooksPath /tmp/evil", layer: "git persistence" },
	{ name: "(e) rm -rf a sibling worktree", cmd: `rm -rf ${SIBLING}`, layer: "destructive write" },
	{ name: "(f) an npm lifecycle script writing outside", cmd: "npm install lodash", layer: "egress + write" },
	{ name: "(g) a redirect writing outside the root", cmd: "echo pwned > /etc/passwd", layer: "shell write" },
	{ name: "(h) push to a remote", cmd: "git push origin main", layer: "egress / grant" },
];

console.log(`ESCAPE BASELINE ${SEED} — guard as it stands. "ALLOWED" means no rule in the layer reached it.`);
console.log("".padEnd(96, "-"));
let allowed = 0;
for (const e of escapes) {
	const confine = refusalFor(e.cmd, { root: SEAT, cwd: SEAT });
	const shell = shellWriteRefusal({ command: e.cmd, root: SEAT, cwd: SEAT });
	const withheld = withheldShellRefusal("bash");
	const verdict = confine !== null || shell.block !== null ? "BLOCKED" : "ALLOWED";
	if (verdict === "ALLOWED") allowed++;
	const reason = confine !== null ? confine : shell.block !== null ? shell.block : "(no rule matched)";
	console.log(`${verdict.padEnd(8)}  ${e.name.padEnd(46)}  layer: ${e.layer.padEnd(18)}`);
	console.log(`          ${String(reason).slice(0, 90)}`);
}
console.log("".padEnd(96, "-"));
console.log(`${allowed} of ${escapes.length} escapes reach no rule today. That number is the baseline G5 requires.`);

// Reach, as it is computed today: per seat, decided at `up`, never per claim.
console.log("\nREACH TODAY (per seat, computed once at `up`):");
for (const s of ["impl", "qa", "lead", "pm", "security", "scribe"]) {
	const caps = { impl: ["implement", "code"], qa: ["verify", "review"], lead: ["decide"], pm: ["route"], security: ["security", "review"], scribe: ["implement"] }[s];
	const removed = toolRemovalsFor({ name: s, role: s, capabilities: caps });
	console.log(`  ${s.padEnd(9)} tools removed: ${removed.length}`);
}
console.log("\nNote the shape: the same seat gets the same reach for every claim it ever makes. There is no claim");
console.log("argument in the signature, and no rule data in the tree to consult (ROADMAP 173).");
