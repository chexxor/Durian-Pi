// demo/ctxline.test.mjs — ROADMAP 98 / #1108: the TUI's context read-surface LINE.
//
// What it proves: the ctx line renders item 27's measure VERBATIM (src/context.mjs) in its
// three denominator states, and the width FLOOR keeps the pair atomic.
//
// Failing-first: before #1108 there is no src/tui/ctxline.mjs (import error). The pinned
// strings are the spec's own examples (#1108 FINAL SPEC):
//   measured <=100%   `ctx 31.4%/300k`
//   measured >100%    `ctx 314K/300K eff · 105%`
//   declared          `ctx 31.4%/300k ·decl`
//   advertised-only   `ctx 302.1k/1.0M advertised`  (no `%` on the line)
//   missing usage     `ctx n/a`
// plus the ladder invariants: never a basis-less percent, never cut mid-string, tokens
// always survive.
//
// Run: node demo/ctxline.test.mjs   (exit 0 = pass)
import { formatContextLine, CONTEXT_BANDS } from "../src/tui/ctxline.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

/** A measure shaped exactly as `readRigHealth(...).context[seat]` (src/context.mjs). */
const measure = (consumed, denominator = null, value = null) => ({
	consumed,
	usage: null,
	window: { denominator, value, candidates: { measured: null, declared: null, advertised: null } },
	fraction: consumed !== null && value !== null ? consumed / value : null,
});

const ESC = /\x1b\[/;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

console.log("\n=== ctx line: the three denominator states ===");

{
	// missing usage -> `ctx n/a`, never `0%`, and no band.
	const line = formatContextLine(measure(null), { width: 80 });
	check("missing usage reads `ctx n/a`", strip(line) === "  ctx n/a", JSON.stringify(line));
	check("missing usage never reads `0%`", !line.includes("%"), line);
}

{
	// no window at all -> the bare token count is honest (fixture: `ctx 302.1k`).
	const line = formatContextLine(measure(302100), { width: 80 });
	check("no window: tokens only", strip(line) === "  ctx 302.1k", JSON.stringify(line));
}

{
	// advertised-only -> the FULL word, and NO percent on the line.
	const line = formatContextLine(measure(302100, "advertised", 1000000), { width: 80 });
	check(
		"advertised-only names the basis in full",
		strip(line) === "  ctx 302.1k/1.0M advertised",
		JSON.stringify(strip(line)),
	);
	check("advertised-only withholds the percent", !line.includes("%"), line);
}

{
	// measured <=100% -> `ctx 31.4%/300k` (no band below 60%).
	const line = formatContextLine(measure(94200, "measured", 300000), { width: 80 });
	check("measured <=100% reads `ctx 31.4%/300k`", strip(line) === "  ctx 31.4%/300k", JSON.stringify(strip(line)));
}

{
	// measured >100% -> tokens + basis word + UNCLAMPED percent.
	const line = formatContextLine(measure(314000, "measured", 300000), { width: 80 });
	check(
		"measured >100% reads `ctx 314K/300K eff · 105%`",
		strip(line) === "  ctx 314K/300K eff · 105%",
		JSON.stringify(strip(line)),
	);
}

{
	// declared -> the badge rides the pair.
	const line = formatContextLine(measure(94200, "declared", 300000), { width: 80 });
	check("declared reads `ctx 31.4%/300k ·decl`", strip(line) === "  ctx 31.4%/300k ·decl", JSON.stringify(strip(line)));
}

console.log("\n=== bands (word carries it; colour is an accent) ===");

check(
	"band thresholds are 60% (high) and 90% (crit)",
	CONTEXT_BANDS.map((b) => `${b.word}@${b.min}`).join(",") === "crit@0.9,high@0.6",
	JSON.stringify(CONTEXT_BANDS),
);

{
	const high = formatContextLine(measure(201000, "measured", 300000), { width: 80 });
	check("67.0% carries [high]", strip(high) === "  ctx 67.0%/300k [high]", JSON.stringify(strip(high)));
	const crit = formatContextLine(measure(291000, "measured", 300000), { width: 80 });
	check("97.0% carries [crit]", strip(crit) === "  ctx 97.0%/300k [crit]", JSON.stringify(strip(crit)));
	const low = formatContextLine(measure(94200, "measured", 300000), { width: 80 });
	check("31.4% carries no band", !low.includes("["), low);
}

{
	// NO_COLOR: the same line, byte-identical but for the escapes.
	const plain = formatContextLine(measure(201000, "measured", 300000), { width: 80, color: false });
	const colored = formatContextLine(measure(201000, "measured", 300000), { width: 80, color: true });
	check("NO_COLOR: no escapes", !ESC.test(plain), JSON.stringify(plain));
	check("colour: escapes present", ESC.test(colored), JSON.stringify(colored));
	check("colour: the band WORD survives stripping", strip(colored) === strip(plain), JSON.stringify(strip(colored)));
}

console.log("\n=== the floor: whole-piece ladder, never a basis-less percent ===");

{
	// Narrow: the pair drops WHOLE. A percent must never appear without its denominator.
	const narrow = formatContextLine(measure(94200, "measured", 300000), { width: 12 });
	check("narrow: tokens survive", strip(narrow).includes("94.2k"), JSON.stringify(strip(narrow)));
	check(
		"narrow: no basis-less percent (no `%` without a denominator)",
		!narrow.includes("%") || narrow.includes("300k"),
		JSON.stringify(strip(narrow)),
	);
	check("narrow: never cut mid-string", !strip(narrow).includes("…"), JSON.stringify(strip(narrow)));
}

{
	// The advertised form has no pair to drop, so it falls back to tokens only.
	const narrow = formatContextLine(measure(302100, "advertised", 1000000), { width: 24 });
	check("narrow advertised: tokens only, no `%`", strip(narrow) === "  ctx 302.1k", JSON.stringify(strip(narrow)));
}

{
	// The widest rung is taken when nothing is narrower than the terminal.
	const wide = formatContextLine(measure(302100), { width: 5 });
	check(
		"floor rung is still the whole token count",
		strip(wide) === "  ctx 302.1k" || strip(wide) === "  ctx 302K",
		JSON.stringify(strip(wide)),
	);
}

console.log(
	failures === 0
		? "\nPASS - the ctx line renders the measure verbatim and the floor keeps the pair atomic"
		: `\nFAIL - ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
