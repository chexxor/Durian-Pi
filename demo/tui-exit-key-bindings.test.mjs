// demo/tui-exit-key-bindings.test.mjs — the exit key must be chosen against the SESSION'S ACTUAL
// BINDINGS (#4021), and NOT KNOWING them must not read as knowing they are empty (#4048).
//
// THE FINDING THIS PINS, measured against the real library rather than assumed:
//   pi-tui's `getKeybindings().getResolvedBindings()` binds `ctrl+]` to `tui.editor.jumpForward`.
//   So lead's ruled FIRST choice COLLIDES on a real session and the ladder falls to `ctrl+^` — the
//   ruling working as designed, because the order was specified precisely so a collision could be
//   absorbed without a second ruling.
//
// AND THE CORRECTION: the degrade used to be `[]`, WHICH IS FAIL-OPEN IN A SAFETY PATH. An empty list
// makes every key look free, so the ladder picks the first candidate — `ctrl+]`, the one key we know
// is taken — and the operator ends up stuck with no working exit key and no crash to explain it. The
// degrade is now an explicit UNKNOWN, which lands on the two-key fallback that cannot collide.
// This is the session's own principle: bindings unknown -> cannot confirm any candidate is free ->
// the fallback, NOT the optimistic guess.
//
// Run: node demo/tui-exit-key-bindings.test.mjs   (exit 0 = pass)

import { EXIT_KEY_CANDIDATES, resolveExitKey, sessionBindingsFrom } from "../src/tui/durable/launch.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

try {
	console.log("\n=== 1. THE REAL BINDINGS: ctrl+] is taken by pi-tui itself ===");
	const { getKeybindings } = await import("@earendil-works/pi-tui");
	const real = sessionBindingsFrom(getKeybindings);
	check("the source reports a KNOWN set", real.known === true, JSON.stringify(real.reason));
	check("it is non-empty", real.keys.length > 0, `${real.keys.length} keys`);
	check("ctrl+] IS in the session's bindings", real.keys.includes("ctrl+]"), real.keys.filter((k) => k.startsWith("ctrl+")).slice(0, 8).join(","));
	check("ctrl+^ is free", !real.keys.includes("ctrl+^"));
	check("ctrl+\\ is free", !real.keys.includes("ctrl+\\"));

	console.log("\n=== 2. SO THE LADDER FALLS TO THE FIRST KEY THAT ACTUALLY WORKS ===");
	const chosen = resolveExitKey(real);
	check("the chosen key is ctrl+^, NOT the colliding ctrl+]", chosen.key === "ctrl+^", JSON.stringify(chosen.key));
	check("the ladder records that it tried ctrl+] first", chosen.tried[0] === "ctrl+]", chosen.tried.join(" -> "));
	check("and it is not a rejection", chosen.rejected === false && chosen.unknown === false);

	console.log("\n=== 3. UNKNOWN IS NOT EMPTY — the fail-open this item corrects ===");
	{
		const noSource = sessionBindingsFrom(undefined);
		check("no source -> known:false, not an empty list", noSource.known === false, JSON.stringify(noSource));
		check("...with a reason attached", typeof noSource.reason === "string" && noSource.reason.length > 0, String(noSource.reason));
		const thrown = sessionBindingsFrom(() => {
			throw new Error("boom");
		});
		check("a throwing source -> known:false (still no throw: availability is kept)", thrown.known === false, JSON.stringify(thrown.reason));
		check("a source with no getResolvedBindings -> known:false", sessionBindingsFrom(() => ({})).known === false);

		const unknownLadder = resolveExitKey(noSource);
		check("UNKNOWN bindings yield NO key", unknownLadder.key === null, JSON.stringify(unknownLadder.key));
		check("...and are marked unknown, not merely rejected", unknownLadder.unknown === true);
		check(
			"...and land on the documented TWO-KEY sequence",
			/two-key sequence/i.test(unknownLadder.reason ?? ""),
			unknownLadder.reason,
		);
		check(
			"...naming the key it refused to assume free",
			unknownLadder.reason.includes(EXIT_KEY_CANDIDATES[0]),
			unknownLadder.reason,
		);

		// THE COROLLARY: "no argument" must not be the same as "no bindings". Both are UNKNOWN here,
		// and neither may silently become an empty (everything-free) set.
		check("a MISSING argument is UNKNOWN, not empty", resolveExitKey(undefined).key === null, JSON.stringify(resolveExitKey(undefined).key));
		check("null is UNKNOWN too", resolveExitKey(null).unknown === true);
		check("a {known:false} object is UNKNOWN", resolveExitKey({ known: false, keys: [], reason: "x" }).unknown === true);
	}

	console.log("\n=== 4. A KNOWN-EMPTY set is still legitimate: an ARRAY is an explicit claim ===");
	{
		// An empty ARRAY says \"I know the bindings, and nothing is bound\" — a different statement from
		// \"I do not know them\". That distinction is the whole correction, so both are asserted.
		const empty = resolveExitKey([]);
		check("an explicit empty ARRAY picks the first candidate", empty.key === EXIT_KEY_CANDIDATES[0], JSON.stringify(empty.key));
		check("...and is not flagged unknown", empty.unknown === false);
		check("with ctrl+] taken the array form falls to ctrl+^", resolveExitKey(["ctrl+]"]).key === "ctrl+^");
	}

	console.log("\n=== 5. THE REST OF THE LADDER, driven by the real set plus one addition ===");
	{
		const withCaret = { known: true, keys: [...real.keys, "ctrl+^"], reason: null };
		check("with ctrl+^ also taken the key is ctrl+\\", resolveExitKey(withCaret).key === "ctrl+\\");
		const withAll = { known: true, keys: [...real.keys, "ctrl+^", "ctrl+\\"], reason: null };
		const none = resolveExitKey(withAll);
		check("with all three taken there is NO key", none.key === null, JSON.stringify(none.key));
		check("...and the refusal points at the two-key fallback", /two-key sequence/.test(none.reason ?? ""), none.reason);
		check("...and it is a KNOWN rejection, not an unknown one", none.unknown === false && none.rejected === true);
	}

	console.log("\n=== 6. THE REJECTIONS HOLD AGAINST REAL BINDINGS TOO ===");
	check("Ctrl-C is not a candidate even though the session binds it", !EXIT_KEY_CANDIDATES.includes("ctrl+c") && real.keys.includes("ctrl+c"));
	check("Esc is not a candidate either", !EXIT_KEY_CANDIDATES.includes("esc"));

	console.log(
		failures === 0
			? "\nPASS — the exit key is chosen from the session's REAL bindings, the colliding first choice is skipped, and UNKNOWN is not mistaken for EMPTY"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
