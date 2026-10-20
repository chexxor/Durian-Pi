// seatguard.test.mjs — the durian-pi-side guard's proof.
//
// The dangerous failure for a guard is not a wrong answer, it is a guard that silently never
// fires: a hook registered against a mistyped task name blocks nothing and looks installed. So
// the first assertion here is structural - that the hook is registered against the real built-in
// tool task - and only then the behaviour.

import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { SeatGuard, beforeTool } from "../src/seatguard.mjs";
import { afterTool } from "../src/secretredact.mjs";
import { authorEnv } from "../src/confine.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const root = await mkdtemp(join(tmpdir(), "durig-guard-"));
const context = {};

try {
	console.log("\nThe guard is registered against the built-in tool task, not a lookalike");
	check(
		'hooks are registered on the "pi.tool" task',
		SeatGuard.hooks?.length === 2 && SeatGuard.hooks.every((h) => h.task === "pi.tool"),
		JSON.stringify(SeatGuard.hooks),
	);
	check(
		"the beforeTool handler is this module's beforeTool",
		SeatGuard.hooks.find((h) => h.handlers.beforeTool)?.handlers.beforeTool === beforeTool,
	);
	check(
		"the sibling afterTool hook (redaction) is registered on the same task",
		SeatGuard.hooks.find((h) => h.handlers.afterTool)?.handlers.afterTool === afterTool,
	);
	check("the extension is named, so a collision would be reported rather than silent", SeatGuard.name === "durig.guard");

	console.log("\nCommands that leave the boundary are blocked, with the reason as the block text");
	for (const command of ["wsl ls", "docker ps", "docker-compose up", "git reset --hard HEAD~1", "git clean -fd", "git checkout -- ."]) {
		const verdict = await beforeTool({ type: "toolCall", id: "1", name: "bash", arguments: { command } });
		check(
			`blocked: ${command}`,
			verdict?.block?.includes("refused by durig"),
			JSON.stringify(verdict),
		);
	}

	console.log("\nOrdinary work is not blocked — a guard that blocks everything is an outage");
	for (const command of ["node demo/cli.test.mjs", "git status", "git diff HEAD", "npm test", "rg wanted src"]) {
		const verdict = await beforeTool({ type: "toolCall", id: "2", name: "powershell", arguments: { command } });
		check(`allowed: ${command}`, verdict === undefined, JSON.stringify(verdict));
	}

	console.log("\nOnly shell tools are inspected, and nested calls are covered too");
	const readCall = await beforeTool({ type: "toolCall", id: "3", name: "read", arguments: { path: "wsl ls" } });
	check("a non-shell tool is not inspected (its `path` is not a command)", readCall === undefined);
	const nested = await beforeTool({
		type: "toolCall",
		id: "4",
		name: "powershell",
		arguments: { command: "wsl ls" },
		parent: { taskId: "tool:1", callId: "c1" },
	});
	check("a nested call — how a codemode script reaches a tool — is blocked too", nested?.block?.includes("refused by durig"));
	const missing = await beforeTool({ type: "toolCall", id: "5", name: "bash", arguments: {} });
	check("a shell call with no command string is left alone rather than guessed at", missing === undefined);

	console.log("\nOne policy serves both layers (two lists would drift, and the drift would be a hole)");
	const envRefusal = await authorEnv(new NodeExecutionEnv({ cwd: root }), root).exec("wsl ls", {}, context);
	const guardRefusal = await beforeTool({ type: "toolCall", id: "6", name: "bash", arguments: { command: "wsl ls" } });
	const envReason = envRefusal.ok ? "" : envRefusal.error?.message ?? "";
	check(
		"the environment and the guard give the same reason for the same command",
		envReason.length > 0 && envReason === guardRefusal?.block,
		`env="${envReason}" guard="${guardRefusal?.block}"`,
	);

	console.log("\nPublishing is refused unless the OPERATOR granted it, which a seat cannot forge");
	const pushCall = (command, id) => ({ type: "toolCall", id, name: "powershell", arguments: { command } });
	const push = await beforeTool(pushCall("git push origin main", "7"));
	check("git push is refused by default", push?.block?.includes("operator's authorization"), JSON.stringify(push));

	// The exemption reads durian-pi's OWN environment, so an assignment the seat makes inside its own
	// command changes only that child process. This is the assertion that makes the grant worth
	// having: without it, "permissioned" would mean "a seat can permit itself".
	const forged = await beforeTool(pushCall("$env:DURIG_ALLOW_PUSH=1; git push origin main", "8"));
	check(
		"an inline assignment in the seat's own command does NOT grant it",
		forged?.block?.includes("refused by durig"),
		JSON.stringify(forged),
	);

	const priorGrant = process.env.DURIG_ALLOW_PUSH;
	process.env.DURIG_ALLOW_PUSH = "1";
	try {
		const granted = await beforeTool(pushCall("git push origin main", "9"));
		check("the operator's grant, set in durig's environment, allows it", granted === undefined, JSON.stringify(granted));
		// Everything else stays refused whatever the grant says: it is a push exemption, not a
		// general amnesty, and a grant that widened a different rule would be a silent hole.
		const stillRefused = await beforeTool(pushCall("wsl ls", "10"));
		check("the grant does not widen any other rule", stillRefused?.block?.includes("WSL is unsupported"));
	} finally {
		// Restore rather than delete: if the operator really had launched with the grant, a test
		// that cleared it would change the environment it ran in.
		if (priorGrant === undefined) delete process.env.DURIG_ALLOW_PUSH;
		else process.env.DURIG_ALLOW_PUSH = priorGrant;
	}
	check(
		"and the refusal returns once the grant is gone",
		(await beforeTool(pushCall("git push origin main", "11")))?.block?.includes("operator's authorization"),
	);

	console.log("\nWrite corruption (#673): a `write` that would serialize a multi-line source to one line is refused");
	const code_payload = "const a = 1; const b = 2; const c = 3;".repeat(20);
	const multiline_payload = Array.from({ length: 50 }, (_, i) => `line ${i} of new content`).join("\n");
	// `target.mjs` lives INSIDE the temp root with a 40-line prior: the demo
	// writes it through the same fs the guard reads, so the guard's disk peek
	// sees REAL pre-state rather than a fixture. The path argument is the
	// string that the guard inspects (absolute, as the confined tools pass it).
	const target = join(root, "target.mjs");
	writeFileSync(target, "const line1 = 1;\n".repeat(40), "utf8");
	const as_tool = (args) => ({ type: "toolCall", id: "w", name: "write", arguments: args });

	const corrupt = await beforeTool(as_tool({ path: target, content: code_payload }), {}, context);
	check(
		"the serialized-one-line overwrite is refused with the recovery wording",
		corrupt?.block?.includes("refused by durig") && /multi-line source file \(40 lines\)/.test(corrupt.block),
		JSON.stringify(corrupt).slice(0, 160),
	);

	const healthy = await beforeTool(as_tool({ path: target, content: multiline_payload }), {}, context);
	check("a healthy multi-line rewrite of the same file is allowed", healthy === undefined, JSON.stringify(healthy));

	const scratch = await beforeTool(as_tool({ path: join(root, "new-scratch.js"), content: code_payload }), {}, context);
	check("a one-line write to a file with no prior is allowed (new-file scratch)", scratch === undefined, JSON.stringify(scratch));

	const config1Liner = await beforeTool(as_tool({ path: join(root, "durig.config.json"), content: '{"note":"config","a":1}' }), {}, context);
	check("a one-line JSON config rewrite is allowed (not a source file)", config1Liner === undefined, JSON.stringify(config1Liner));

	const shellStill = await beforeTool(pushCall("git reset --hard HEAD~1", "12"));
	check("the write branch does not change the shell verdicts", shellStill?.block?.includes("refused by durig"), JSON.stringify(shellStill));

	console.log("\nControl-byte corruption (#780): a text write that introduces stray control bytes is refused");
	const bel = String.fromCharCode(0x07);
	const bs = String.fromCharCode(0x08);
	// A BEL where a word's leading letter should be — the shell-escape shape.
	const mangled = `const x = "see${bel}ranch -D";\nconst y = ${bs}dd -A;\n`;
	const mangledVerdict = await beforeTool(as_tool({ path: join(root, "mangled.js"), content: mangled }), {}, context);
	check(
		"a write introducing 0x07/0x08 is refused, naming the bytes",
		mangledVerdict?.block?.includes("refused by durig") && /0x07/.test(mangledVerdict.block) && /0x08/.test(mangledVerdict.block),
		JSON.stringify(mangledVerdict).slice(0, 200),
	);

	const tabsAndNewlines = await beforeTool(as_tool({ path: join(root, "clean.md"), content: "# title\n\tindented\nplain\n" }), {}, context);
	check("tab, LF and CR stay legal (\u0009/\u000a/\u000d are ordinary text)", tabsAndNewlines === undefined, JSON.stringify(tabsAndNewlines));

	const nonAscii = await beforeTool(as_tool({ path: join(root, "unicode.md"), content: "caf\u00e9 \u2014 \u4e2d\u6587 \u{1f600}\n" }), {}, context);
	check("non-ASCII text is not mistaken for control bytes (UTF-8 multibyte never drops below 0x80)", nonAscii === undefined, JSON.stringify(nonAscii));

	console.log("\n#3961: a seat whose cwd DEGRADED to the shared checkout must not write or commit there");
	// `complete_work` silently resets the persisted cwd to the broker's cwd (the shared tree), so the
	// NEXT item's relative write or commit lands in the shared tree. This guard refuses it.
	const degradedApi = { conversationId: "conv-degraded", snapshot: async () => ({ cwd: process.cwd() }) };
	const degradedWrite = await beforeTool(as_tool({ path: "scratch-relative.js", content: "const z = 1;\n" }), degradedApi, context);
	check(
		"a RELATIVE-path write from the degraded cwd is refused, naming prepare_workspace",
		degradedWrite?.block?.includes("SHARED checkout") && /prepare_workspace/.test(degradedWrite.block),
		JSON.stringify(degradedWrite).slice(0, 200),
	);
	const degradedCommit = await beforeTool(
		{ type: "toolCall", id: "d1", name: "bash", arguments: { command: "git commit -m x" } },
		degradedApi,
		context,
	);
	check(
		"a commit from the degraded cwd is refused (it would land ON main, bypassing the landing pass)",
		degradedCommit?.block?.includes("SHARED checkout") && /landing pass/.test(degradedCommit.block),
		JSON.stringify(degradedCommit).slice(0, 200),
	);
	// An ABSOLUTE path is a deliberate target — left to the existing guards, not this one.
	const degradedAbsolute = await beforeTool(as_tool({ path: join(root, "abs.js"), content: "const z = 1;\n" }), degradedApi, context);
	check("an ABSOLUTE-path write from the degraded cwd is NOT refused by this guard", degradedAbsolute === undefined, JSON.stringify(degradedAbsolute));
	// A seat whose persisted cwd is its OWN worktree (not the shared tree) is NOT refused.
	const ownApi = { conversationId: "conv-own", snapshot: async () => ({ cwd: root }) };
	const ownWrite = await beforeTool(as_tool({ path: "scratch-own.js", content: "const z = 1;\n" }), ownApi, context);
	check("a seat with its OWN worktree cwd is NOT refused", ownWrite === undefined, JSON.stringify(ownWrite));
	// #3992: from the degraded cwd a SHELL command is refused OUTRIGHT (it can destroy the shared tree).
	const degradedShell = await beforeTool(
		{ type: "toolCall", id: "d2", name: "bash", arguments: { command: "git checkout -- ." } },
		degradedApi,
		context,
	);
	check(
		"#3992: a shell command from the degraded cwd is refused, naming prepare_workspace",
		degradedShell?.block?.includes("SHARED checkout") && /prepare_workspace/.test(degradedShell.block),
		JSON.stringify(degradedShell).slice(0, 200),
	);
	const ownShell = await beforeTool(
		{ type: "toolCall", id: "d3", name: "bash", arguments: { command: "git status" } },
		ownApi,
		context,
	);
	check("#3992: a shell command from a seat's OWN worktree is NOT refused", ownShell === undefined, JSON.stringify(ownShell));

	console.log(failures === 0 ? "\nPASS — the guard holds" : `\nFAIL — ${failures} assertion(s) failed`);
} finally {
	await rm(root, { recursive: true, force: true });
}

// Exiting inside the `try` would skip the cleanup above (do not move this earlier).
process.exit(failures === 0 ? 0 : 1);
