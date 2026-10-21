// demo/tui-durable-sanitize.test.mjs — the DURABLE render path must sanitise (#4009)
//
// THE PROBE FIRST, and it splits the item's premise in two again:
//   * ANSI / OSC ARE handled on this path — by pi, not by us. `dist/core/tools/render-utils.js:61`
//     runs `sanitizeBinaryOutput(stripAnsi(text))` over tool output, and `dist/utils/ansi.js:36`
//     builds its regex from OSC + CSI. (Cited, not run: pi's `exports` map refuses a direct import,
//     so the library's behaviour cannot be exercised from here.)
//   * UNICODE FORMAT CHARACTERS ARE NOT: stripAnsi covers OSC/CSI only, so a bidi override
//     (U+202A-202E, U+2066-2069) or a zero-width character passes pi untouched — the exact class
//     #3962 added to the shared sanitizer, and the one the durable path had no coverage for.
// So the item's "no sanitizer at all" is half right, and the half that is wrong is worth recording.
//
// THE SEAM: pi's InteractiveMode owns the components, so there is no hook inside it without forking.
// But every durable entry becomes renderable data at three functions in translate.mjs, so the rule
// lives in ONE exported helper (`sanitizeRenderable`) called at those three boundaries.
//
// FAILING-FIRST: before the change, a bidi override, an OSC 52 and a ZWSP all reached the renderable
// message verbatim (asserted below).
//
// Run: node demo/tui-durable-sanitize.test.mjs   (exit 0 = pass)

import {
	applyMessageChanges,
	sanitizeRenderable,
	sessionEntryFromDurable,
} from "../src/tui/durable/translate.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}
const show = (v) => JSON.stringify(v).slice(0, 140);

// The hostile string the item asks for: a bidi override, an OSC 52 clipboard write and a ZWSP.
const HOSTILE = "safe\u202eevil\x1b]52;c;SGVsbG8=\x07rm -rf\u200b /";
const entryFor = (text) => ({
	id: 42,
	kind: "message",
	// `messageOfEntry` reads the MODEL array: `entry.model[0]` (see translate.mjs).
	model: [{ role: "assistant", content: [{ type: "text", text }] }],
});

try {
	console.log("\n=== 1. THE PROBE: what reaches the durable renderable data ===");
	{
		const entry = sessionEntryFromDurable(entryFor(HOSTILE), 1_700_000_000_000);
		const rendered = JSON.stringify(entry);
		check("the bidi override does NOT reach the renderable message", !rendered.includes("\u202e"), show(rendered));
		check("the OSC 52 sequence does NOT reach it", !rendered.includes("\x1b]52"), show(rendered));
		check("...and neither does its payload", !rendered.includes("SGVsbG8"), show(rendered));
		check("the zero-width space does NOT reach it", !rendered.includes("\u200b"), show(rendered));
		check("the benign text SURVIVES (nothing over-stripped)", entry.message.content[0].text.includes("safe") && entry.message.content[0].text.includes("rm -rf"), show(rendered));
	}

	console.log("\n=== 2. THE SAME BOUNDARY FOR IN-FLIGHT DELTAS (a sequence split across two deltas) ===");
	{
		const base = { role: "assistant", content: [{ type: "text", text: "" }] };
		const one = applyMessageChanges(base, [{ type: "text_delta", contentIndex: 0, delta: "safe\u202e" }]);
		check("a bidi override arriving in a delta is stripped", !JSON.stringify(one).includes("\u202e"), show(one));
		// THE INTERESTING CASE, and the limit of sanitising the ACCUMULATED message: the introducer
		// arrives alone in one delta and is destroyed there, so the later payload cannot form a
		// sequence again. The invariant that matters is therefore "no LIVE escape reaches the
		// terminal" — the residual payload is INERT LITERAL TEXT (it cannot act without an
		// introducer). Asserting the stronger claim would be a lie; asserting this one is the truth.
		const a = applyMessageChanges(base, [{ type: "text_delta", contentIndex: 0, delta: "\x1b" }]);
		const b = applyMessageChanges(a, [{ type: "text_delta", contentIndex: 0, delta: "]52;c;SGVsbG8=\x07" }]);
		check(
			"a sequence SPLIT across two deltas cannot re-form: no live introducer survives",
			!JSON.stringify(b).includes("\\u001b") && !JSON.stringify(b).includes("\x1b"),
			show(b),
		);
		check(
			"...and what remains is inert literal text, not a clipboard write",
			b.content[0].text === "]52;c;SGVsbG8=",
			show(b.content[0].text),
		);
		const whole = applyMessageChanges(base, [{ type: "message", message: { role: "assistant", content: [{ type: "text", text: HOSTILE }] } }]);
		check("a whole-message change is sanitised too", !JSON.stringify(whole).includes("\u202e"), show(whole));
	}

	console.log("\n=== 3. THE ZWJ CARVE-OUT HOLDS ON THIS PATH (same shared module, asserted not assumed) ===");
	{
		const emoji = "\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67";
		const out = sanitizeRenderable({ content: [{ type: "text", text: emoji }] });
		check("ZWJ (U+200D) survives, so emoji clusters do not split", out.content[0].text === emoji, show(out));
		const cjk = sanitizeRenderable({ text: "日本語のテキスト" });
		check("CJK is untouched", cjk.text === "日本語のテキスト", show(cjk));
	}

	console.log("\n=== 4. REGRESSION GUARD: a bidi override cannot reorder a durable-rendered row ===");
	{
		// The rendered text must be the LITERAL order, so a component that measures it sees "safeevil".
		const entry = sessionEntryFromDurable(entryFor("safe\u202eevil"), 1);
		check("the rendered row is the literal order", entry.message.content[0].text === "safeevil", show(entry.message.content[0].text));
		const numbers = sanitizeRenderable({ a: 1, b: null, c: undefined, d: [1, "x\u202e"] });
		check("non-string values pass through unchanged (numbers, null, undefined)", numbers.a === 1 && numbers.b === null && numbers.c === undefined, show(numbers));
		check("arrays are walked", numbers.d[1] === "x", show(numbers));
	}

	console.log(
		failures === 0
			? "\nPASS — the durable path sanitises at ONE boundary: bidi, OSC and zero-width are gone, ZWJ and real text survive"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
