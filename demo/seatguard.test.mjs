// seatguard.test.mjs — the durig-side guard's proof.
//
// The dangerous failure for a guard is not a wrong answer, it is a guard that silently never
// fires: a hook registered against a mistyped task name blocks nothing and looks installed. So
// the first assertion here is structural - that the hook is registered against the real built-in
// tool task - and only then the behaviour.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { SeatGuard, beforeTool } from "../src/seatguard.mjs";
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
		'a hook is registered on the "pi.tool" task',
		SeatGuard.hooks?.length === 1 && SeatGuard.hooks[0].task === "pi.tool",
		JSON.stringify(SeatGuard.hooks),
	);
	check("the handler the hook runs is this module's beforeTool", SeatGuard.hooks[0].handlers.beforeTool === beforeTool);
	check("the extension is named, so a collision would be reported rather than silent", SeatGuard.name === "durig.guard");

	console.log("\nCommands that leave the boundary are blocked, with the reason as the block text");
	for (const command of ["wsl ls", "docker ps", "docker-compose up", "git reset --hard HEAD~1", "git clean -fd", "git checkout -- ."]) {
		const verdict = beforeTool({ type: "toolCall", id: "1", name: "bash", arguments: { command } });
		check(
			`blocked: ${command}`,
			verdict?.block?.includes("refused by durig"),
			JSON.stringify(verdict),
		);
	}

	console.log("\nOrdinary work is not blocked — a guard that blocks everything is an outage");
	for (const command of ["node demo/cli.test.mjs", "git status", "git diff HEAD", "npm test", "rg wanted src"]) {
		const verdict = beforeTool({ type: "toolCall", id: "2", name: "powershell", arguments: { command } });
		check(`allowed: ${command}`, verdict === undefined, JSON.stringify(verdict));
	}

	console.log("\nOnly shell tools are inspected, and nested calls are covered too");
	const readCall = beforeTool({ type: "toolCall", id: "3", name: "read", arguments: { path: "wsl ls" } });
	check("a non-shell tool is not inspected (its `path` is not a command)", readCall === undefined);
	const nested = beforeTool({
		type: "toolCall",
		id: "4",
		name: "powershell",
		arguments: { command: "wsl ls" },
		parent: { taskId: "tool:1", callId: "c1" },
	});
	check("a nested call — how a codemode script reaches a tool — is blocked too", nested?.block?.includes("refused by durig"));
	const missing = beforeTool({ type: "toolCall", id: "5", name: "bash", arguments: {} });
	check("a shell call with no command string is left alone rather than guessed at", missing === undefined);

	console.log("\nOne policy serves both layers (two lists would drift, and the drift would be a hole)");
	const envRefusal = await authorEnv(new NodeExecutionEnv({ cwd: root }), root).exec("wsl ls", {}, context);
	const guardRefusal = beforeTool({ type: "toolCall", id: "6", name: "bash", arguments: { command: "wsl ls" } });
	const envReason = envRefusal.ok ? "" : envRefusal.error?.message ?? "";
	check(
		"the environment and the guard give the same reason for the same command",
		envReason.length > 0 && envReason === guardRefusal?.block,
		`env="${envReason}" guard="${guardRefusal?.block}"`,
	);

	console.log("\nPublishing is refused unless the OPERATOR granted it, which a seat cannot forge");
	const pushCall = (command, id) => ({ type: "toolCall", id, name: "powershell", arguments: { command } });
	const push = beforeTool(pushCall("git push origin main", "7"));
	check("git push is refused by default", push?.block?.includes("operator's authorization"), JSON.stringify(push));

	// The exemption reads durig's OWN environment, so an assignment the seat makes inside its own
	// command changes only that child process. This is the assertion that makes the grant worth
	// having: without it, "permissioned" would mean "a seat can permit itself".
	const forged = beforeTool(pushCall("$env:DURIG_ALLOW_PUSH=1; git push origin main", "8"));
	check(
		"an inline assignment in the seat's own command does NOT grant it",
		forged?.block?.includes("refused by durig"),
		JSON.stringify(forged),
	);

	const priorGrant = process.env.DURIG_ALLOW_PUSH;
	process.env.DURIG_ALLOW_PUSH = "1";
	try {
		const granted = beforeTool(pushCall("git push origin main", "9"));
		check("the operator's grant, set in durig's environment, allows it", granted === undefined, JSON.stringify(granted));
		// Everything else stays refused whatever the grant says: it is a push exemption, not a
		// general amnesty, and a grant that widened a different rule would be a silent hole.
		const stillRefused = beforeTool(pushCall("wsl ls", "10"));
		check("the grant does not widen any other rule", stillRefused?.block?.includes("WSL is unsupported"));
	} finally {
		// Restore rather than delete: if the operator really had launched with the grant, a test
		// that cleared it would change the environment it ran in.
		if (priorGrant === undefined) delete process.env.DURIG_ALLOW_PUSH;
		else process.env.DURIG_ALLOW_PUSH = priorGrant;
	}
	check(
		"and the refusal returns once the grant is gone",
		beforeTool(pushCall("git push origin main", "11"))?.block?.includes("operator's authorization"),
	);

	console.log(failures === 0 ? "\nPASS — the guard holds" : `\nFAIL — ${failures} assertion(s) failed`);
} finally {
	await rm(root, { recursive: true, force: true });
}

// Exiting inside the `try` would skip the cleanup above (do not move this earlier).
process.exit(failures === 0 ? 0 : 1);
