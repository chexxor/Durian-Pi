// demo/tui-exit-key-bindings.test.mjs — the exit key must be chosen against the SESSION'S ACTUAL
// BINDINGS (#4021), not a hardcoded guess.
//
// THE FINDING THIS PINS, measured against the real library rather than assumed:
//   pi-tui's `getKeybindings().getResolvedBindings()` binds `ctrl+]` to `tui.editor.jumpForward`.
//   So lead's ruled FIRST choice COLLIDES on a real session, and the ladder must fall to `ctrl+^`.
//   The decision layer (#4006) computes that ladder correctly but can only do so from the bindings it
//   is handed — handed an empty list it would pick `ctrl+]` and the operator would be stuck in a
//   session with no working exit key.
//
// WHY THIS IS AUTOMATABLE AT ALL, since the item assumed a TTY was needed: pi-tui exports `Terminal`
// as an INTERFACE and `InteractiveModeOptions` takes `terminal?: Terminal`, so the terminal is
// injectable and a fake can be driven headlessly. This demo does not need one — it only needs the
// binding source — but the seam is why the rest of the live wiring is buildable rather than blocked.
//
// FAILING-FIRST: before `sessionBindingsFrom`, the ladder could only be exercised against a list the
// test made up, which is exactly how a colliding key ships.
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
	check("the binding source returns a non-empty set", real.length > 0, `${real.length} keys`);
	check("ctrl+] IS in the session's bindings", real.includes("ctrl+]"), real.filter((k) => k.startsWith("ctrl+")).slice(0, 8).join(","));
	check("ctrl+^ is free", !real.includes("ctrl+^"));
	check("ctrl+\\ is free", !real.includes("ctrl+\\"));

	console.log("\n=== 2. SO THE LADDER FALLS TO THE FIRST KEY THAT ACTUALLY WORKS ===");
	const chosen = resolveExitKey(real);
	check("the chosen key is ctrl+^, NOT the colliding ctrl+]", chosen.key === "ctrl+^", JSON.stringify(chosen.key));
	check("the ladder records that it tried ctrl+] first", chosen.tried[0] === "ctrl+]", chosen.tried.join(" -> "));
	check("and it is not a rejection", chosen.rejected === false);

	console.log("\n=== 3. THE REST OF THE LADDER, driven by the same real set plus one addition ===");
	const withCaret = [...real, "ctrl+^"];
	check("with ctrl+^ also taken the key is ctrl+\\", resolveExitKey(withCaret).key === "ctrl+\\");
	const withAll = [...real, "ctrl+^", "ctrl+\\"];
	const none = resolveExitKey(withAll);
	check("with all three taken there is NO key", none.key === null, JSON.stringify(none.key));
	check("...and the refusal points at the two-key fallback", /two-key sequence/.test(none.reason ?? ""), none.reason);

	console.log("\n=== 4. THE REJECTIONS HOLD AGAINST REAL BINDINGS TOO ===");
	check("Ctrl-C is not a candidate even though the session binds it", !EXIT_KEY_CANDIDATES.includes("ctrl+c") && real.includes("ctrl+c"));
	check("Esc is not a candidate either", !EXIT_KEY_CANDIDATES.includes("esc"));
	check("a broken binding source degrades to an empty list, not a throw", sessionBindingsFrom(() => { throw new Error("boom"); }).length === 0);
	check("a missing manager degrades to an empty list", sessionBindingsFrom(undefined).length === 0);
	check("a manager without getResolvedBindings degrades to an empty list", sessionBindingsFrom(() => ({})).length === 0);

	console.log(
		failures === 0
			? "\nPASS — the exit key is chosen from the session's REAL bindings, and the colliding first choice is skipped"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
