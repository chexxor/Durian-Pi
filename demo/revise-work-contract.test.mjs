// demo/revise-work-contract.test.mjs — #3435: a `revise_work` call must never be SILENT
// about what it did.
//
// THE DEFECT: a revise that produced no change was indistinguishable from a revise that was
// DROPPED — both came back as a success-shaped sentence ("item #N unchanged"). A caller
// therefore could not tell "nothing to change" from "your change was lost", and the only
// way to find out was to re-read the item afterwards, which nobody does on a success path.
// It cost a convention amendment that had to be re-homed by hand.
//
// THE CONTRACT NOW, one shape per outcome:
//   revised    -> names the fields that LANDED + the stored body digest + byte count
//   no-change  -> says "no change" and "nothing was written", with the digest
//   mismatch   -> `REVISE_WORK_ERROR:` (a submitted change that did NOT land is an ERROR)
//
// FAILING-FIRST: before #3435 `applyRevise`/`bodyDigest`/`reviseMessage` do not exist and
// the single "unchanged" string covers both the no-op and the dropped-write cases, so every
// assertion below fails.
//
// Run: node demo/revise-work-contract.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import { applyRevise, bodyDigest, reviseMessage } from "../src/rig.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

// A plain queue item, exactly the shape the tool reads.
const mkItem = (over = {}) => ({ id: 3354, from: "lead", to: "impl", subject: "carry the amendments", body: "old text", status: "queued", transitions: [], ...over });

try {
	console.log("\n=== revised: a changed body is written, and the outcome says so ===");
	const item = mkItem();
	const first = applyRevise(item, { body: "the amendment that must travel" });
	check("status is revised", first.status === "revised", JSON.stringify(first));
	check("it names the field that landed", JSON.stringify(first.fields) === JSON.stringify(["body"]), JSON.stringify(first.fields));
	check("the item actually holds the new text", item.body === "the amendment that must travel", item.body);
	check("the digest is of the STORED body", first.digest === bodyDigest("the amendment that must travel"));
	check("the byte count is of the stored body", first.bodyBytes === Buffer.byteLength("the amendment that must travel", "utf8"), String(first.bodyBytes));
	const firstMsg = reviseMessage(item, first);
	check("the message says 'revised' and names the field", firstMsg.includes("revised (body)"), firstMsg);
	check("the message carries the digest so the caller can verify the write", firstMsg.includes(`sha256=${first.digest}`), firstMsg);
	check("the message does NOT claim 'no change'", !firstMsg.includes("no change"), firstMsg);
	check("the message is not an error", !firstMsg.startsWith("REVISE_WORK_ERROR"), firstMsg);

	console.log("\n=== no-change: the SAME body again is reported as no-change, not as success ===");
	const second = applyRevise(item, { body: "the amendment that must travel" });
	check("status is no-change", second.status === "no-change", JSON.stringify(second));
	check("no field is claimed as landed", second.fields.length === 0, JSON.stringify(second.fields));
	check("the submitted field is still reported, so the caller sees what was compared", JSON.stringify(second.submitted) === JSON.stringify(["body"]), JSON.stringify(second.submitted));
	const secondMsg = reviseMessage(item, second);
	check("the message says 'no change' in those words", secondMsg.includes("no change"), secondMsg);
	check("and says NOTHING was written", secondMsg.includes("nothing was written"), secondMsg);
	check("it still carries the digest, so the caller can compare with what they meant", secondMsg.includes(`sha256=${second.digest}`), secondMsg);
	check("the two messages are DIFFERENT shapes (the defect was that they were the same)", firstMsg !== secondMsg);

	console.log("\n=== mismatch: a submitted change that does NOT land is an ERROR, never a success ===");
	// A field whose setter silently ignores writes: the exact 'the tool accepted my edit and
	// did nothing' case, made deterministic instead of timing-dependent.
	const stuck = mkItem({ body: "cannot be changed" });
	Object.defineProperty(stuck, "body", { get: () => "cannot be changed", set: () => {}, configurable: true });
	const third = applyRevise(stuck, { body: "this will not stick" });
	check("status is mismatch", third.status === "mismatch", JSON.stringify(third));
	check("it names the field that failed", JSON.stringify(third.fields) === JSON.stringify(["body"]), JSON.stringify(third.fields));
	const thirdMsg = reviseMessage(stuck, third);
	check("the message is ERROR-shaped", thirdMsg.startsWith("REVISE_WORK_ERROR:"), thirdMsg);
	check("the message says nothing was changed", thirdMsg.includes("nothing was changed"), thirdMsg);
	check("the message is not mistakable for success", !/^item #\d+ revised/.test(thirdMsg) && !thirdMsg.includes("no change"), thirdMsg);

	console.log("\n=== subject and body are independent ===");
	const both = mkItem();
	const r = applyRevise(both, { subject: "new subject", body: "new body" });
	check("both fields land", JSON.stringify(r.fields) === JSON.stringify(["subject", "body"]), JSON.stringify(r.fields));
	check("the digest tracks the body only", r.digest === bodyDigest("new body"));
	const subjectOnly = applyRevise(both, { subject: "another subject" });
	check("a subject-only revise reports only the subject", JSON.stringify(subjectOnly.fields) === JSON.stringify(["subject"]), JSON.stringify(subjectOnly.fields));
	check("and the digest is unchanged, because the body did not move", subjectOnly.digest === bodyDigest("new body"));

	console.log("\n=== the digest is a stable, short handle ===");
	check("same text -> same digest", bodyDigest("abc") === bodyDigest("abc"));
	check("different text -> different digest", bodyDigest("abc") !== bodyDigest("abd"));
	check("16 hex chars", /^[0-9a-f]{16}$/.test(bodyDigest("anything")), bodyDigest("anything"));
	check("an absent body digests like an empty one", bodyDigest(undefined) === bodyDigest(""));

	assert.ok(true);
	console.log(
		failures === 0
			? "\nREVISE CONTRACT PASS (revised / no-change / mismatch are distinct and checkable)"
			: `\nREVISE CONTRACT FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
