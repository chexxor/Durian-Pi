// demo/tui-cliargs.test.mjs — `tui.mjs`'s flags are PARSED AND ENFORCED, not silently ignored (#4164)
//
// THE GAP THIS PINS: `enter.mjs` passed `--select <seat>` to `tui.mjs` for a whole item, and `tui.mjs`
// did not accept it — the flag was silently discarded, so the caller's argv said something the child
// never did. Every test that only looked at the caller passed. A FLAG THAT IS SILENTLY DISCARDED IS A
// FLAG THAT LIES.
//
// WHY THE PARSER IS A MODULE AND NOT TESTED THROUGH THE ENTRYPOINT: `tui.mjs` is an entrypoint —
// importing it runs a program, and spawning it with a VALID argv opens a real store and starts a TUI.
// The parser is extracted so the rules are assertable with no store, no TTY and no child.
//
// Run: node demo/tui-cliargs.test.mjs   (exit 0 = pass)

import { readFileSync } from "node:fs";
import { KNOWN_FLAGS, parseTuiArgs } from "../src/tui/durable/cliargs.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

try {
	console.log("\n=== THE GENERAL RULE: an unknown flag is REJECTED, not ignored ===");
	{
		const bad = parseTuiArgs(["--bogus"]);
		check("an unknown flag produces an error", bad.errors.length === 1, JSON.stringify(bad.errors));
		check("...naming the flag", /--bogus/.test(bad.errors[0] ?? ""), bad.errors[0]);
		check("...and listing the known flags", /--db/.test(bad.errors[0] ?? "") && /--select/.test(bad.errors[0] ?? ""), bad.errors[0]);
		const unexpected = parseTuiArgs(["stray"]);
		check("a bare positional is rejected too", unexpected.errors.length === 1, JSON.stringify(unexpected.errors));
		const missing = parseTuiArgs(["--db"]);
		check("a value flag with no value is rejected", missing.errors.length === 1, JSON.stringify(missing.errors));
		const nextFlag = parseTuiArgs(["--db", "--select", "qa"]);
		check("a value flag followed by another flag is rejected (no silent swallowing)", nextFlag.errors.length >= 1, JSON.stringify(nextFlag.errors));
	}

	console.log("\n=== `--select` IS NOW ACCEPTED AND CARRIED ===");
	{
		const parsed = parseTuiArgs(["--db", "/tmp/x.sqlite", "--select", "qa"]);
		check("no errors", parsed.errors.length === 0, JSON.stringify(parsed.errors));
		check("--db is carried", parsed.db === "/tmp/x.sqlite", String(parsed.db));
		check("--select is CARRIED (the seat is no longer discarded)", parsed.select === "qa", String(parsed.select));
		const eq = parseTuiArgs(["--db=/tmp/y.sqlite", "--select=impl"]);
		check("the --flag=value form works for both", eq.db === "/tmp/y.sqlite" && eq.select === "impl", JSON.stringify(eq));
		const noSelect = parseTuiArgs(["--db", "/tmp/z.sqlite"]);
		check("omitting --select is not an error (the entrypoint has a default store)", noSelect.errors.length === 0 && noSelect.select === null);
	}

	console.log("\n=== `--help` short-circuits, and the known set is what the help text lists ===");
	{
		const help = parseTuiArgs(["--help"]);
		check("--help is recognised", help.help === true);
		check("-h is recognised", parseTuiArgs(["-h"]).help === true);
		check("the known set contains --db, --select and the help forms", KNOWN_FLAGS.has("--db") && KNOWN_FLAGS.has("--select") && KNOWN_FLAGS.has("--help"));
	}

	console.log("\n=== AND THE ENTRYPOINT ACTUALLY USES THE PARSER (structural) ===");
	{
		// tui.mjs is an entrypoint: importing it runs a program, so this is a source assertion and is
		// labelled as weaker than a behavioural test rather than passed off as one.
		const tui = readFileSync(new URL("../tui.mjs", import.meta.url), "utf8");
		check("tui.mjs imports the parser", /from "\.\/src\/tui\/durable\/cliargs\.mjs"/.test(tui), "no import");
		check("tui.mjs calls parseTuiArgs", /parseTuiArgs\s*\(/.test(tui), "not called");
		check("tui.mjs exits on parse errors (a flag is never silently ignored)", /parsed\.errors\.length\s*>\s*0/.test(tui) && /process\.exit\(1\)/.test(tui), "no exit on errors");
		check("tui.mjs wires --select through argValue", /argValue\("--select"\)|parsed\[[^\]]*select[^\]]*\]/.test(tui) || /"select"/.test(tui), "select not wired");
	}

	console.log(
		failures === 0
			? "\nPASS — unknown flags are rejected, `--select` is carried rather than discarded, and the entrypoint uses the parser"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
