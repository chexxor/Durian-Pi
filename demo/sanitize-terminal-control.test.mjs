// demo/sanitize-terminal-control.test.mjs — TERMINAL CONTROL SEQUENCES vs the render layer (#3962)
//
// THE PROBE COMES FIRST, and it answers the item's own question: is the class already handled?
// Answer, measured: MOST OF IT IS, AND TWO CLASSES ARE NOT.
//   ALREADY HANDLED (src/sanitize.mjs, an ALLOWLIST over control sequences): ANSI CSI/SGR, cursor
//   addressing, OSC 52, DCS/PM/APC/SOS, the 8-bit C1 forms, C0 controls. The landing renderer
//   (src/tui/client.mjs) applies it at every seat/model/tool text site — 20+ call sites.
//   NOT HANDLED (this demo's RED assertions): BIDI OVERRIDES (U+202A-202E, U+2066-2069) and
//   INVISIBLE FORMAT characters (ZWSP, WJ, BOM, soft hyphen, LRM). They are not control codes, so
//   the control-sequence allowlist never sees them: `code < 0x20 || (0x7f..0x9f)` does not cover
//   U+200B-0x2069. A bidi override reorders what the operator READS — a rendered frame can say
//   something the data does not — and an invisible character can hide content inside a command.
//
// THE FIXTURE PROBE IS SECTION 1. Sections 2-3 are the properties the fix must satisfy: the class
// is stripped PER CLASS (bidi + invisible format out, ZWJ kept because it is structural for emoji
// clusters and textwidth already counts it), the renderer's OWN styling survives, and the landing
// screen does not leak the new class either.
//
// FAILING-FIRST: on the pre-fix tree the bidi and zero-width assertions fail — the sequences reach
// the output verbatim.
//
// Run: node demo/sanitize-terminal-control.test.mjs   (exit 0 = pass)

import { sanitizeTerminalText } from "../src/sanitize.mjs";
import { frameToLines, renderTui } from "../src/tui/client.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}
const show = (s) => JSON.stringify(s);

try {
	console.log("\n=== 1. THE PROBE: what the CURRENT render layer does, per class ===");
	console.log("    (handled = stripped or allowlisted; GAP = reaches the output today)");

	// ── already handled: control sequences ──────────────────────────────────────────────
	{
		const allowed = sanitizeTerminalText("a\x1b[31mred\x1b[39mz");
		check("ANSI SGR on the renderer's allowlist is PRESERVED (the UI's own styling)", allowed === "a\x1b[31mred\x1b[39mz", show(allowed));

		const offList = sanitizeTerminalText("a\x1b[38;5;9mred");
		check("ANSI SGR OFF the allowlist is stripped (256-colour)", offList === "ared", show(offList));

		const clear = sanitizeTerminalText("safe\x1b[2Jwiped");
		check("CSI clear-screen is stripped", clear === "safewiped", show(clear));

		const cursor = sanitizeTerminalText("safe\x1b[10;20Hoverwrite");
		check("CSI cursor addressing is stripped", cursor === "safeoverwrite", show(cursor));

		const osc = sanitizeTerminalText("a\x1b]52;c;SGVsbG8=\x07b");
		check("OSC 52 clipboard write is stripped", !osc.includes("\x1b]"), show(osc));
		check("...INCLUDING its payload (no fragment survives to be reinterpreted)", !osc.includes("SGVsbG8"), show(osc));

		const dcs = sanitizeTerminalText("a\x1bPq#0;2;0;0;0\x1b\\b");
		check("DCS is stripped", !dcs.includes("\x1b"), show(dcs));

		const c1 = sanitizeTerminalText("a\u009b2Jb\u009d0;x\u0007c");
		check("the 8-bit C1 forms (U+009B/U+009D) are stripped", !/[\u009b\u009d]/.test(c1), show(c1));

		const cr = sanitizeTerminalText("line1\rline2");
		check("carriage return is stripped (it can overwrite a line)", cr === "line1line2", show(cr));
	}

	// ── THE GAP: bidi and invisible format characters ───────────────────────────────────
	console.log("\n    --- the two classes the control-sequence allowlist never sees ---");
	{
		const rlo = sanitizeTerminalText("safe \u202eevil");
		check("GAP: bidi override (U+202E RLO) is stripped", !rlo.includes("\u202e"), show(rlo));
		const lri = sanitizeTerminalText("a\u2066b\u2069c");
		check("GAP: bidi isolates (U+2066/U+2069) are stripped", !/[\u2066\u2069]/.test(lri), show(lri));
		const lre = sanitizeTerminalText("a\u202ab");
		check("GAP: bidi embedding (U+202A) is stripped", !lre.includes("\u202a"), show(lre));

		const zwsp = sanitizeTerminalText("rm -rf\u200b /");
		check("GAP: zero-width space (U+200B) is stripped", !zwsp.includes("\u200b"), show(zwsp));
		const wj = sanitizeTerminalText("a\u2060b");
		check("GAP: word joiner (U+2060) is stripped", !wj.includes("\u2060"), show(wj));
		const bom = sanitizeTerminalText("\ufeffcmd");
		check("GAP: BOM / zero-width no-break space (U+FEFF) is stripped", !bom.includes("\ufeff"), show(bom));
		const shy = sanitizeTerminalText("pass\u00adword");
		check("GAP: soft hyphen (U+00AD) is stripped", !shy.includes("\u00ad"), show(shy));
		const lrm = sanitizeTerminalText("a\u200eb");
		check("GAP: left-to-right mark (U+200E) is stripped", !lrm.includes("\u200e"), show(lrm));
	}

	console.log("\n=== 2. PER CLASS, not a blanket strip: what must SURVIVE ===");
	{
		const zwj = sanitizeTerminalText("\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67");
		check("ZWJ (U+200D) SURVIVES — it is structural for emoji clusters", zwj.includes("\u200d"), show(zwj));
		const cjk = sanitizeTerminalText("日本語のテキスト");
		check("CJK text is untouched", cjk === "日本語のテキスト", show(cjk));
		const combining = sanitizeTerminalText("e\u0301cole");
		check("combining marks are untouched (they are not format characters)", combining === "e\u0301cole", show(combining));
		const plain = sanitizeTerminalText("  indented\tand tabbed\nnewline  ");
		check("spaces, tabs and newlines are layout, not control: preserved", plain === "  indented\tand tabbed\nnewline  ", show(plain));
	}

	console.log("\n=== 3. END TO END: the landing screen renders SEAT-CONTROLLED text today ===");
	{
		const seats = [{ name: "impl", role: "engineer" }];
		const hostile = "safe\u202eevil\x1b]52;c;SGVsbG8=\x07\u200bend";
		const queue = [{ id: 7, from: "pm", to: "impl", subject: hostile, status: "claimed" }];
		const lines = frameToLines(
			renderTui({ seats, health: { seats, queueItems: queue, attention: [] }, queueItems: queue, width: 100, height: 24 }),
		).join("\n");
		check("the OSC 52 payload never reaches the frame", !lines.includes("SGVsbG8"), "payload present");
		check("no raw ESC reaches the frame", !lines.includes("\x1b"), "raw escape present");
		check("the bidi override never reaches the frame", !lines.includes("\u202e"), "bidi override present");
		check("the zero-width space never reaches the frame", !lines.includes("\u200b"), "zero-width present");
		check("the benign part of the subject still renders", lines.includes("safe") && lines.includes("end"), "benign text lost");
	}

	console.log(
		failures === 0
			? "\nPASS — control sequences were already handled; bidi and invisible format characters are now stripped PER CLASS, with ZWJ and all real text preserved"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
