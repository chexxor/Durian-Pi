// seattools.test.mjs — proof that the controls are WIRED, not merely defined.
//
// A module that is never installed protects nothing while looking finished, which is the same
// failure the guard's own test opens with. So this test reads cli.mjs and holds it to the calls
// that install the guard, install the tools, supply the environment and narrow the verifiers -
// then proves the behaviour of each piece.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COORDINATOR_REMOVALS, VERIFIER_REMOVALS, SeatTools, fillRoster, makeSeatEnv, toolRemovalsFor } from "../src/seattools.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const root = await mkdtemp(join(tmpdir(), "durig-seattools-"));
const context = {};

try {
	console.log("\nThe tool set is what the design says, and bash is deliberately absent");
	const names = SeatTools.tools.map((tool) => tool.name).sort();
	check("read, write, edit, a shell, prepare_workspace and seat_root are bundled", JSON.stringify(names) === JSON.stringify(["edit", "powershell", "prepare_workspace", "read", "seat_root", "write"]), JSON.stringify(names));
	check("no bash tool — native-Windows bash is an undeclared Git Bash dependency", !names.includes("bash"));
	check("a verifier loses write and edit", JSON.stringify(VERIFIER_REMOVALS.map((t) => t.name).sort()) === JSON.stringify(["edit", "write"]));

	console.log("\ncli.mjs actually installs and scopes them (an uninstalled control is not a control)");
	const cli = await readFile(new URL("../cli.mjs", import.meta.url), "utf8");
	for (const [label, needle] of [
		["the guard is installed", "registry.install(SeatGuard);"],
		["the seat tools are installed", "registry.install(SeatTools);"],
		["the harness is given the confining environment", "env: makeSeatEnv(seatRoster),"],
		["the roster is filled from the store", "fillRoster(seatRoster, rosterDoc?.value?.seats);"],
		["seat tools are scoped at `up`", "scopeSeatTools(configure, tx, seatsDoc.seats);"],
	]) {
		check(label, cli.includes(needle), `cli.mjs does not contain ${JSON.stringify(needle)}`);
	}

	console.log("\nThe tool set follows each seat's DECLARED CAPABILITIES, so routing is enforced by capability (F9)");
	const removalNames = (removals) => removals.map((t) => t.name).sort();
	check(
		"an implementer keeps every working tool",
		toolRemovalsFor({ name: "impl", role: "implementation engineer", capabilities: ["implement", "code"] }).length === 0,
	);
	check(
		"a coordinator loses read, write, edit, the shell AND prepare_workspace, so it can only route",
		JSON.stringify(removalNames(toolRemovalsFor({ name: "pm", role: "program manager", capabilities: ["route", "plan"] }))) ===
			JSON.stringify(["edit", "powershell", "prepare_workspace", "read", "write"]),
	);
	check(
		"a verifier loses write and edit but keeps read, the shell AND prepare_workspace, so it can still re-run in its own tree",
		JSON.stringify(removalNames(toolRemovalsFor({ name: "qa", role: "independent verifier", capabilities: ["verify", "review"] }))) ===
			JSON.stringify(["edit", "write"]),
	);
	check(
		"a seat declaring NOTHING is treated as a coordinator - fail closed for tools, and check reports it",
		toolRemovalsFor({ name: "mystery", role: "unknown", capabilities: [] }).length === COORDINATOR_REMOVALS.length,
	);

	console.log("\nThe environment chosen per seat — and it fails CLOSED");
	const roster = new Map([
		["conv-impl", { name: "impl", role: "implementation engineer", verifier: false }],
		["conv-qa", { name: "qa", role: "verifier", verifier: true }],
	]);
	const envFor = makeSeatEnv(roster, { fallbackRoot: root });

	const authorWrite = await envFor({ conversationId: "conv-impl", cwd: root }).writeFile(join(root, "author.txt"), "x", context);
	check("an author seat can write inside its root", authorWrite.ok === true, authorWrite.ok ? "" : authorWrite.error?.message);

	const verifierWrite = await envFor({ conversationId: "conv-qa", cwd: root }).writeFile(join(root, "verifier.txt"), "x", context);
	check(
		"a verifier seat cannot write, whatever tools it was offered",
		verifierWrite.ok === false && verifierWrite.error?.code === "permission_denied",
		verifierWrite.ok ? "the write succeeded" : `code=${verifierWrite.error?.code}`,
	);

	const unknownWrite = await envFor({ conversationId: "conv-nobody", cwd: root }).writeFile(join(root, "unknown.txt"), "x", context);
	check(
		"an unknown conversation fails closed (read-only), not open",
		unknownWrite.ok === false && unknownWrite.error?.code === "permission_denied",
		unknownWrite.ok ? "the write succeeded" : `code=${unknownWrite.error?.code}`,
	);

	const outside = await envFor({ conversationId: "conv-impl", cwd: root }).readTextFile(join(tmpdir(), "not-in-root.txt"), context);
	check(
		"every seat's environment is rooted, so an escape is refused even for an author",
		outside.ok === false && outside.error?.code === "permission_denied",
		outside.ok ? "the read succeeded" : `code=${outside.error?.code}`,
	);

	console.log("\nThe roster reuses `check`'s verifier judgement rather than inventing a second one");
	const filled = fillRoster(new Map(), {
		impl: { conversationId: "c1", role: "implementation engineer" },
		qa: { conversationId: "c2", role: "independent verifier" },
		editor: { conversationId: "c3", role: "editor" },
	});
	check("an author is not marked a verifier", filled.get("c1").verifier === false);
	check("a qa seat is", filled.get("c2").verifier === true);
	check("an editor seat is (the same vocabulary `check` uses)", filled.get("c3").verifier === true);

	console.log(failures === 0 ? "\nPASS — the controls are wired" : `\nFAIL — ${failures} assertion(s) failed`);
} finally {
	await rm(root, { recursive: true, force: true });
}

// Exiting inside the `try` would skip the cleanup above (do not move this earlier).
process.exit(failures === 0 ? 0 : 1);
