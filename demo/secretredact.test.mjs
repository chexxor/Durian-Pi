// demo/secretredact.test.mjs — prove the in-harness redaction extension (#837).
//
// Failing-first: before src/secretredact.mjs exists, `node demo/secretredact.test.mjs`
// cannot run. After: it proves the extension is registered on the REAL tool task,
// that the afterTool hook replaces a secret-bearing result, and — end to end on a
// real harness — that a tool whose result carries a secret is committed REDACTED.
// The binding rule is asserted throughout: the redaction NAMES WHERE and NEVER
// echoes the value.
//
// Run: node demo/secretredact.test.mjs  (exit 0 = pass)

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	configure,
	createRegistry,
	defineExtension,
	defineTool,
	Harness,
	MemoryStorage,
} from "@earendil-works/pi-durable";

import {
	afterTool,
	redactText,
	redactionMarker,
	secretSpans,
} from "../src/secretredact.mjs";
import { SeatGuard } from "../src/seatguard.mjs";

const ctx = BACKGROUND_CONTEXT;
let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const SECRET = `sk-${"z".repeat(24)}`;
const toolCall = (name, args) => ({ type: "toolCall", id: "1", name, arguments: args });

/* ─── 1. structural: registered on the REAL tool task, not a lookalike ───── */
console.log("\nThe redaction hook is registered on the built-in tool task");
check(
	'the durig.guard extension carries an afterTool hook on the "pi.tool" task',
	SeatGuard.hooks?.some((h) => h.task === "pi.tool" && h.handlers.afterTool === afterTool),
	JSON.stringify(SeatGuard.hooks),
);
check(
	"the guard's own beforeTool hook still rides the same task",
	SeatGuard.hooks?.some((h) => h.task === "pi.tool" && h.handlers.beforeTool),
);
check(
	"the extension is named, so a collision is reported rather than silent",
	SeatGuard.name === "durig.guard",
);

/* ─── 2. the span finder ─────────────────────────────────────────────────── */
console.log("\nsecretSpans — exact spans, never the value");
const spans = secretSpans(`key=${SECRET} done`);
check("one span", spans.length === 1, JSON.stringify(spans));
check("span covers the value only, not the `key=` prefix", spans[0]?.start === 4, JSON.stringify(spans));
check("span JSON contains no value", !JSON.stringify(spans).includes(SECRET));
check("no span for ordinary prose", secretSpans("the quick brown fox").length === 0);

/* ─── 3. afterTool: replaces the result, names WHERE, never echoes ───────── */
console.log("\nafterTool — a secret-bearing result is replaced");
const call = toolCall("read", { path: ".env" });
const leaky = { content: [{ type: "text", text: `DEEPINFRA_API_KEY=${SECRET}\nnote=ok\n` }] };
const redacted = afterTool(call, leaky);
check("a changed result is returned", redacted !== undefined && redacted !== leaky);
const redactedText = redacted?.content?.[0]?.text ?? "";
check("the value is gone from the content", !redactedText.includes(SECRET), redactedText);
check("the marker names the family", redactedText.includes("openai-key"), redactedText);
check("the marker names the tool", redactedText.includes("read"), redactedText);
check("the marker names the file (WHERE)", redactedText.includes(".env"), redactedText);
check("the result is redacted in place, keeping the rest", redactedText.includes("note=ok"), redactedText);

console.log("\nafterTool — leaves a clean result untouched");
check(
	"a clean result returns undefined (the harness keeps the original)",
	afterTool(call, { content: [{ type: "text", text: "nothing to hide\n" }] }) === undefined,
);

console.log("\nafterTool — preserves non-text parts");
const mixed = afterTool(call, {
	content: [
		{ type: "text", text: `token ${SECRET}` },
		{ type: "image", data: "AAAA", mimeType: "image/png" },
	],
});
check("the image part survives", mixed?.content?.[1]?.type === "image");
check("the text part is redacted", !JSON.stringify(mixed).includes(SECRET));

console.log("\nafterTool — every secret in a part is redacted");
const many = afterTool(call, {
	content: [{ type: "text", text: `a=${SECRET}\nb=ghp_${"Q".repeat(24)}\n` }],
});
const manyText = many?.content?.[0]?.text ?? "";
check("both values are gone", !manyText.includes(SECRET) && !manyText.includes("ghp_QQQQ"));
check("both families are named", manyText.includes("openai-key") && manyText.includes("github-pat"));

console.log("\nthe marker never echoes a secret hidden in the call's own arguments");
const shellCall = toolCall("bash", { command: `export KEY=${SECRET}` });
const marker = redactionMarker(shellCall, "openai-key");
check("a secret-bearing command is NOT named in the marker", !marker.includes(SECRET), marker);
check("a safe path IS named", redactionMarker(call, "openai-key").includes(".env"));
check("redactText is a no-op on clean text", redactText("hello world", call) === "hello world");

/* ─── 4. end to end: a real tool result is committed redacted ────────────── */
console.log("\nend-to-end — a secret-bearing tool result is redacted BEFORE commit");
// A test-only tool whose result carries a secret, so the afterTool hook has
// something real to intercept on a real harness.
const LeakTool = defineExtension({
	name: "demo.leak",
	tools: [
		defineTool({
			name: "read_env",
			description: "read a file's contents",
			parameters: Type.Object({ path: Type.String() }),
			replay: "safe",
			execute: async () => {
				const content = [{ type: "text", text: `DEEPINFRA_API_KEY=${SECRET}\nnote=ok\n` }];
				return { content, output: content };
			},
		}),
	],
});

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(LeakTool);
registry.install(SeatGuard);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

try {
	let convId = null;
	await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		convId = c.id;
	}, ctx);

	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("read_env", { path: ".env" })], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("done")),
	]);
	const conv = await harness.conversation(convId, ctx);
	await (await conv.submit({ type: "input", content: "read the env file" }, ctx)).wait(ctx);

	const page = await conv.entries({}, 200, undefined, ctx);
	const committed = JSON.stringify(page.items);
	const toolResults = page.items.filter((e) => e.kind === "pi.tool-result");
	check("the tool ran and its result was committed", toolResults.length >= 1, JSON.stringify(toolResults).slice(0, 200));
	check("the committed transcript contains NO secret value", !committed.includes(SECRET));
	check("the committed result carries the redaction marker", committed.includes("redacted by durig"), committed.slice(0, 300));
	check("the marker names WHERE (tool + file)", committed.includes("read_env") && committed.includes(".env"));
	check("the marker names the family", committed.includes("openai-key"));
} finally {
	await harness.close(ctx);
}

console.log(failures === 0 ? "\nPASS — tool results are redacted before commit" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
