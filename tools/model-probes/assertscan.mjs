// tools/model-probes/assertscan.mjs — does a model's answer ASSERT a defect, or is it DECLINING one? (#5027)
//
// WHY THIS IS A MODULE AND NOT A FEW LINES INSIDE gate.mjs. gate.mjs has no import guard: importing it RUNS the
// gate, i.e. spends the operator's GPU and API budget. So the scorer that decides every clean-side verdict on
// record had no hermetic test, and the defect below sat there through 24 runs and 552 clean turns precisely
// because nothing could ask it a question without paying for an answer.
//
// THE DEFECT (#5027). `asserted = ASSERT.some((a) => ans.includes(a))` ran on the RAW answer while `CLEAN-PASSED`
// required `declined && !asserted` (gate.mjs:216-218). The two lists are not disjoint: 5 of the 12 DECLINE
// phrases CONTAIN an ASSERT substring — "no defect"⊃"defect", "nothing wrong"⊃"wrong", "no bug"⊃"bug",
// "no runtime defect"⊃"defect", "no actual defect"⊃"defect". So any decline phrased in those words sets
// `asserted`, and the clean verdict was UNREACHABLE: measured over the 18 saved transcripts, 552 clean turns
// scored CLEAN-PASSED 0 / FALSE-ALARM 468.
//
// WHAT THIS DOES NOT CLAIM. Stripping DECLINE phrases rescues only 15 of those 468 (measured, delegate 2026-11-02
// and re-measured in #5027). The other 453 assert an ASSERT token OUTSIDE any decline phrase — "as written it is
// correct, but the off-by-one breaks the export" — and no substring rule can judge those. They are a judgement,
// and the honest instrument reports them as it judges them, not as a pass.
//
// THREE ARMS, so the size of the fix is measurable instead of asserted. `GATE_SCORER` selects one and the gate's
// own `--rescore` mode re-runs saved transcripts through it without spending a prompt:
//   raw        the shipped scorer before #5027 — kept so the "before" number is reproducible, not remembered
//   strip      variant (i): DECLINE phrases removed from the text, then a plain substring scan
//   strip+neg  variant (ii), the default: as above, plus per-OCCURRENCE negation — an ASSERT token preceded (within
//              NEGATION_WINDOW chars) by a negator word does not count as an assertion
export const DECLINE = [
	"no defect",
	"nothing wrong",
	"no bug",
	"looks correct",
	"is correct",
	"seems correct",
	"appears correct",
	"no runtime defect",
	"nothing that would",
	"no issue",
	"as written it is correct",
	"no actual defect",
];

// Asserting a defect at all — the raw material of a false alarm on a clean control.
export const ASSERT = [
	"bug",
	"defect",
	"will throw",
	"would throw",
	"throws",
	"crash",
	"race",
	"fails",
	"breaks",
	"incorrect",
	"wrong",
	"never",
	"off by one",
	"off-by-one",
];

// Words that turn an ASSERT token into a DECLINE in ordinary prose. Checked per occurrence, in the text BEFORE
// the token, because "the bug is not handled" asserts while "there is no bug here" declines.
export const NEGATORS = ["no", "not", "never", "nothing", "without", "free of"];

// How far back a negator may sit and still bind. 30 characters is a few words of English: enough for "there is
// clearly no " before "defect", short enough that a negator from the previous clause cannot launder an assertion.
export const NEGATION_WINDOW = 30;

export const SCORER_ARMS = ["raw", "strip", "strip+neg"];

/** Which arm this process scores with. An unknown name is an ERROR, never a silent fallback to the shipped one. */
export function scorerArm(env = process.env) {
	const arm = env.GATE_SCORER ?? "strip+neg";
	if (!SCORER_ARMS.includes(arm))
		throw new Error(`GATE_SCORER=${arm} is not one of ${SCORER_ARMS.join("|")}`);
	return arm;
}

/**
 * The ASSERT tokens an answer actually asserts, under an arm.
 *
 * Returns the HITS, not a boolean: a verdict a human cannot audit is not a verdict, and the transcript carries
 * this list so a reviewer can see WHY a turn was called a false alarm.
 */
export function assertedTokens(
	ans,
	{ arm = scorerArm(), text = String(ans ?? "").toLowerCase() } = {},
) {
	if (arm !== "raw") {
		// variant (i): a DECLINE phrase is not evidence of an assertion. Removed, not replaced, so a token that only
		// appeared INSIDE the phrase cannot be found at all.
		for (const d of DECLINE) text = text.split(d.toLowerCase()).join(" ");
	}
	const negationAware = arm === "strip+neg";
	const hits = [];
	for (const token of ASSERT) {
		const t = token.toLowerCase();
		let at = text.indexOf(t);
		while (at !== -1) {
			const before = text.slice(Math.max(0, at - NEGATION_WINDOW), at);
			const negated =
				negationAware &&
				NEGATORS.some((n) =>
					new RegExp(`(^|[^a-z])${n.replace(/ /g, "\\s+")}([^a-z]|$)`, "i").test(before),
				);
			if (!negated) {
				hits.push(token);
				break; // one un-negated occurrence is enough to assert
			}
			at = text.indexOf(t, at + t.length);
		}
	}
	return hits;
}

/** Did the answer decline? Same list the strip uses, so the two halves of the verdict cannot drift apart. */
export function declinedText(ans, { text = String(ans ?? "").toLowerCase() } = {}) {
	return DECLINE.some((d) => text.includes(d.toLowerCase()));
}
