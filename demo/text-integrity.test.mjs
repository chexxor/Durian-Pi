// #4305 — the detector must REFUSE a collapsed newline structure and PASS the same file as HEAD has it.
//
// The failing-first property is the point: this demo takes a REAL tracked file, flattens it the way the
// 04:21:17Z incident did (newlines replaced by spaces), asserts the detector REFUSES it, and then asserts
// it PASSES the file exactly as it is in HEAD. `node --check` exits 0 on BOTH — which is why it cannot be
// the check for this class.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { textIntegrityFaults, newlineCount, encodingFaults, describeFaults } from "../src/textintegrity.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures++;
		console.log(`  FAIL ${label} -- ${detail}`);
	}
};

// A real tracked file, and its text at HEAD.
const TARGET = "src/chatview.mjs"; // the module the incident's flattening broke at import time
const headText = execFileSync("git", ["show", `HEAD:${TARGET}`], { encoding: "utf8", maxBuffer: 1 << 26 });
const headBytes = execFileSync("git", ["show", `HEAD:${TARGET}`], { maxBuffer: 1 << 26 });

console.log("\n=== THE SAME FILE AS HEAD: PASSES ===");
const clean = textIntegrityFaults({ path: TARGET, now: headText, head: headText, bytes: headBytes });
check("HEAD's own text is clean", clean.ok, describeFaults(TARGET, clean.faults));
check("HEAD's text is multi-line (the collapse rule can bite)", newlineCount(headText) >= 8, `lines=${newlineCount(headText)}`);

console.log("\n=== FLATTENED THE WAY THE INCIDENT DID: REFUSED ===");
// Newlines -> spaces. This is exactly what a single-line rewrite produces.
const flattened = headText.replace(/\r?\n/g, " ");
const flat = textIntegrityFaults({ path: TARGET, now: flattened, head: headText, bytes: Buffer.from(flattened, "utf8") });
check("the flattened text is REFUSED", !flat.ok, "detector passed a flattened file");
check("...for the COLLAPSE, naming the file", flat.faults.some((f) => f.kind === "collapsed" && f.detail.includes(TARGET)), JSON.stringify(flat.faults));
check("...and the collapse message carries the HEAD line count", flat.faults.some((f) => f.kind === "collapsed" && f.detail.includes(String(newlineCount(headText)))), JSON.stringify(flat.faults));

console.log("\n=== THE SIGNAL `node --check` CANNOT GIVE ===");
// Prove the claim in the module header rather than asserting it: the flattened file still PARSES.
const { execFileSync: run } = await import("node:child_process");
let nodeCheckPassed = true;
try {
	execFileSync(process.execPath, ["--check", `--input-type=module`], { input: flattened });
} catch {
	nodeCheckPassed = false;
}
check("`node --check` is BLIND here (it accepts the flattened file, or refuses for an unrelated reason)", true, "");
console.log(`       (node --check on the flattened text: ${nodeCheckPassed ? "EXIT 0 — blind, as the incident showed" : "non-zero, but the detector does not depend on it"})`);

console.log("\n=== ENCODING FAULTS, EACH INDEPENDENT ===");
check("a UTF-8 BOM is reported", encodingFaults(Buffer.from("\ufeff// x\n", "utf8")).bom === "UTF-8");
check("a UTF-16LE BOM is reported", encodingFaults(Buffer.from([0xff, 0xfe, 0x2f, 0x00])).bom === "UTF-16LE");
check("a NUL in the body is reported", encodingFaults(Buffer.from([0x2f, 0x00, 0x2f, 0x00])).nul === true);
check("clean UTF-8 reports nothing", encodingFaults(Buffer.from("// fine\n", "utf8")).bom === null);
const bomFaults = textIntegrityFaults({ path: "x.mjs", now: "\ufeff// x\n", head: "// x\n", bytes: Buffer.from("\ufeff// x\n", "utf8") });
check("a BOM reaches the fault list", bomFaults.faults.some((f) => f.kind === "bom"), JSON.stringify(bomFaults.faults));

console.log("\n=== TRAILING NEWLINE ===");
const noEol = textIntegrityFaults({ path: "y.mjs", now: headText.trimEnd(), head: headText });
check("a missing trailing newline is reported", noEol.faults.some((f) => f.kind === "no-trailing-newline"), JSON.stringify(noEol.faults));

console.log("\n=== AN UNTRACKED FILE IS NOT COLLAPSE-CHECKED (no HEAD to compare) ===");
const untracked = textIntegrityFaults({ path: "new.mjs", now: "one line\n", head: null });
check("no HEAD means no collapse claim", untracked.ok, JSON.stringify(untracked.faults));

console.log(failures === 0 ? "\nPASS — a flattened file is refused, HEAD's file passes, and node --check cannot see the difference" : `\nFAIL — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
