// demo/commit-message-encoding.test.mjs — #4349: a commit message must not carry a UTF-8 BOM.
//
// Four commits in one session carried a BOM in the subject because PowerShell's
// `Set-Content -Encoding utf8` writes one; each was caught by hand. FOUR CATCHES IS NOT A CATCH
// RATE, IT IS A MECHANISM THAT DOES NOT EXIST — and a BOM is INVISIBLE IN EVERY NORMAL VIEW
// (`git log --oneline` renders it, `git show` renders it), so it surfaces only in a byte read.
// That is what a check is for. The WHOLE message is checked, not just the subject: a body BOM
// corrupts a `Co-authored-by` trailer or a `Fixes #N` line.
//
// Run: node demo/commit-message-encoding.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { messageDefects, parseCommitMsgLog } from "../src/commitmsg.mjs";
import { auditRig } from "../src/checkup.mjs";

const SPEC = {
	version: 2,
	seats: [
		{ name: "author", role: "implementation engineer", capabilities: ["implement", "code"], model: "faux/m1" },
		{ name: "qa", role: "independent verifier", capabilities: ["verify"], model: "faux/m2" },
	],
	edges: [
		{ from: "author", maySendTo: ["qa"] },
		{ from: "qa", maySendTo: ["author"] },
	],
	constitutionInline: "# constitution\nbe good\n",
};
const BASE = {
	rig: "rig.json",
	spec: SPEC,
	specConstitution: SPEC.constitutionInline,
	stored: { reason: "read", text: SPEC.constitutionInline },
	storedSeats: ["author", "qa"],
	modelsBySeat: { author: "faux/m1", qa: "faux/m2" },
};
const hasFinding = (r, id) => (r.findings ?? []).some((f) => f.id === id);
const ruleStatus = (r, id) => (r.checks ?? []).find((c) => c.id === id)?.status;

/* ─── 1. the pure predicate ──────────────────────────────────────────────── */
console.log("\nmessageDefects — the ONE definition of a bad commit message");
assert.equal(messageDefects({ subject: "fix(x): y (#1)", body: "why\n\nFixes #2" }).length, 0, "a clean message has no defects");
assert.deepEqual(messageDefects({ subject: "\uFEFFfix(x): y" }), [{ field: "subject", kind: "BOM" }], "a leading BOM in the subject");
assert.deepEqual(messageDefects({ subject: "ok", body: "a\n\uFEFFCo-authored-by: x" }), [{ field: "body", kind: "BOM-in-line" }], "a body BOM that would corrupt a trailer");
assert.deepEqual(messageDefects({ subject: "a\rb" }), [{ field: "subject", kind: "CR" }], "a stray CR in the subject");
assert.deepEqual(messageDefects({ subject: "a\u0000b" }), [{ field: "subject", kind: "NUL" }], "a NUL in the subject");
assert.deepEqual(messageDefects({ subject: "ok", body: "a\r\nb" }), [{ field: "body", kind: "CR" }], "a CRLF body");
console.log("  ok   BOM (subject + body line), CR and NUL are each seen; a clean message is silent");

/* ─── 2. the parser keeps the body, BOM intact ───────────────────────────── */
console.log("\nparseCommitMsgLog — the body survives, so a body BOM is visible");
const raw = "@@@abc123\x1ffix: thing\x1fbody line\nCo-authored-by: z\x1e@@@def456\x1f\uFEFFbom subject\x1f\x1e";
const parsed = parseCommitMsgLog(raw);
assert.equal(parsed.length, 2, "two records");
assert.equal(parsed[0].subject, "fix: thing");
assert.equal(parsed[0].body, "body line\nCo-authored-by: z", "the body keeps its newlines");
assert.equal(parsed[1].subject, "\uFEFFbom subject", "the BOM is PRESERVED, not stripped — the check must see it");
console.log("  ok   the body is kept and the BOM is not silently stripped");

/* ─── 3. the rule: a BOM FAILS, a clean message PASSES ───────────────────── */
console.log("\nauditRig — commit-message-encoding");
const clean = auditRig({ ...BASE, commitMessages: [{ sha: "aaaaaaa1", subject: "fix: thing (#1)", body: "why" }] });
assert.equal(hasFinding(clean, "commit-message-encoding"), false, "a clean message passes");
assert.equal(ruleStatus(clean, "commit-message-encoding"), "pass");

const bom = auditRig({ ...BASE, commitMessages: [{ sha: "bbbbbbb2", subject: "\uFEFFfix: thing (#2)", body: "" }] });
assert.equal(hasFinding(bom, "commit-message-encoding"), true, "a BOM subject is a finding");
assert.equal(ruleStatus(bom, "commit-message-encoding"), "fail");
assert.match(bom.findings.find((f) => f.id === "commit-message-encoding").fix, /amend/, "the remedy says how to fix it");
assert.match(bom.findings.find((f) => f.id === "commit-message-encoding").fix, /Set-Content/, "...and names the tool that added it");

const bodyBom = auditRig({ ...BASE, commitMessages: [{ sha: "ccccccc3", subject: "fix: thing (#3)", body: "a\n\uFEFFCo-authored-by: z" }] });
assert.equal(hasFinding(bodyBom, "commit-message-encoding"), true, "a BODY BOM is a finding too (a trailer would be corrupted)");

const unread = auditRig({ ...BASE, commitMessages: null });
assert.equal(ruleStatus(unread, "commit-message-encoding"), "skipped", "an unread history is SKIPPED, never passed");
assert.equal(hasFinding(unread, "commit-message-encoding"), false, "and reports no finding it cannot ground");
console.log("  ok   BOM (subject and body) FAILS; clean PASSES; unread history SKIPPED");

console.log("\nCOMMIT-MESSAGE-ENCODING TEST PASS (a BOM in a commit subject or body is caught, and the refusal names the remedy)");
process.exit(0);
