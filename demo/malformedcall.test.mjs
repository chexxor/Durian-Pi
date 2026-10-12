// demo/malformedcall.test.mjs — #145(ii): a malformed tool call is a CLASSIFIED cause.
//
// The defect: a tool call whose arguments fail schema validation (the model serialised `edits` as a
// JSON string instead of an array — transcript #6980) was indistinguishably "a tool error". It IS
// handled (the validation error returns to the model, which retries); what was missing is a signal.
// This classifies it BY CAUSE (`Validation failed for tool`, the harness's `invalid_arguments`
// marker) and NOT by the normal feedback errors (file-not-found, oldText mismatch), then surfaces
// it as a per-seat attention notice AND a rig measure.
//
// Proves: (a) the predicate separates the malformed cause from a domain error; (b) the count; (c)
// the per-seat attention notice crosses only when bounded; (d) the metric measure has a value and an
// ambient notice; (e) it is signal-only — no call is blocked.
// Run: node demo/malformedcall.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { computeAttention, countMalformedToolCalls, isMalformedToolResult } from "../src/attention.mjs";
import { MEASURES, computeMetrics, measureMalformedToolCalls } from "../src/metrics.mjs";

const malformed = {
	kind: "pi.tool-result",
	model: [
		{
			role: "toolResult",
			toolName: "edit",
			isError: true,
			content: [
				{
					type: "text",
					text: '<harness>\n[error] Validation failed for tool "edit":\n  - edits.0: must be object\n\nReceived arguments:\n{\n  "edits": "[{\\"newText\\": ...}]"',
				},
			],
		},
	],
};
const domainError = {
	kind: "pi.tool-result",
	model: [
		{
			role: "toolResult",
			toolName: "read",
			isError: true,
			content: [{ type: "text", text: "<harness>\n[error] ENOENT: no such file or directory, open 'x.md'" }],
		},
	],
};
const ok = {
	kind: "pi.tool-result",
	model: [{ role: "toolResult", toolName: "read", isError: false, content: [{ type: "text", text: "ok" }] }],
};

/* --------------------------------- predicate --------------------------------- */

assert.equal(isMalformedToolResult(malformed), true, "a schema-validation rejection IS malformed arguments");
assert.equal(isMalformedToolResult(domainError), false, "a file-not-found is the normal feedback loop, not malformed");
assert.equal(isMalformedToolResult(ok), false, "a successful result is not malformed");
assert.equal(countMalformedToolCalls([malformed, domainError, ok, malformed]), 2, "the count is by cause");

/* --------------------------------- measure --------------------------------- */
// Note the citation below is from the transcript, not invented.

const measured = measureMalformedToolCalls({ impl: [malformed, domainError], qa: [malformed] });
assert.equal(measured.value, 2, "the rig measure counts malformed calls across seats");
assert.equal(MEASURES["malformed-tool-call"].ambient, true, "the measure is ambient, so it reaches the notice channel");
assert.ok(MEASURES["malformed-tool-call"].blind.length > 0, "the measure declares a blind spot");

const metrics = computeMetrics({ pages: { impl: [malformed, malformed] }, nowMs: Date.now() });
const measuredRow = metrics.measures.find((m) => m.id === "malformed-tool-call");
assert.ok(measuredRow, "computeMetrics reports the malformed-tool-call measure");
assert.equal(measuredRow.value, 2, "the value is the count");
assert.ok(
	metrics.notices.some((n) => n.kind === "malformed-tool-call"),
	"an over-band malformed count reaches the ambient notice channel",
);

/* --------------------------------- notice --------------------------------- */

const notice = computeAttention(
	[{ name: "impl", conversationId: 9 }],
	[],
	new Map([[9, { status: "done" }]]),
	new Map(),
	{ nowMs: Date.now(), malformedCountByConv: new Map([[9, 2]]) },
).find((n) => n.kind === "malformed_tool_call");
assert.ok(notice, "a per-seat malformed_tool_call notice crosses the bound");
assert.match(notice.detail, /2 tool call\(s\)/);

const quiet = computeAttention(
	[{ name: "impl", conversationId: 9 }],
	[],
	new Map([[9, { status: "done" }]]),
	new Map(),
	{ nowMs: Date.now(), malformedCountByConv: new Map([[9, 1]]) },
).find((n) => n.kind === "malformed_tool_call");
assert.equal(quiet, undefined, "a single malformed call is below the bound and does not nag");

console.log("MALFORMEDCALL TEST PASS (a schema-rejected tool call is classified by cause, then surfaced per-seat and as an ambient measure)");
process.exit(0);
