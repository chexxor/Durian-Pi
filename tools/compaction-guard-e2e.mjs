// tools/compaction-guard-e2e.mjs — end-to-end proof that the compaction guard keeps a real
// compaction alive, using the real harness, the real extension file and the real local model.
//
//   node tools/compaction-guard-e2e.mjs
//
// It seeds an in-memory session with a conversation larger than the guard's input cap, loads
// .pi/extensions/compaction-guard.js the way the CLI does, captures the actual HTTP payload sent
// for the summarization call, and then compacts. Exit 0 only when:
//   - compaction returned a summary (no "Auto-compaction failed" path taken),
//   - the request carried an explicit max_tokens far below the model's 32768 output limit,
//   - the thinking phase was switched off for that request,
//   - the stored summary is at or under the guard's ceiling.
// Cost: one real local model call. With the default caps the prompt is ~15k tokens; the local
// server runs ~83 tok/s on prompt and ~156 tok/s on generation, so expect ~3-4 minutes.
// Speed the loop up with COMPACT_GUARD_INPUT_CHARS=12000 COMPACT_GUARD_OUTPUT_TOKENS=800.
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";

const cwd = process.cwd();

// Install the guard if this host has not run the installer yet (.pi/ is gitignored by design).
const dest = ".pi/extensions/compaction-guard.js";
if (!existsSync(dest) || readFileSync(dest, "utf8") !== readFileSync("tools/compaction-guard-extension.js", "utf8")) {
	mkdirSync(".pi/extensions", { recursive: true });
	copyFileSync("tools/compaction-guard-extension.js", dest);
	console.log("installed .pi/extensions/compaction-guard.js from the tracked source");
}
const loader = new DefaultResourceLoader({
	cwd,
	agentDir: getAgentDir(),
	additionalExtensionPaths: [".pi/extensions/compaction-guard.js"],
	extensionFactories: [probe],
});
await loader.reload();

let capturedPayload = null;
function probe(pi) {
	pi.on("before_provider_request", (event) => {
		const payload = event.payload;
		if (payload && typeof payload === "object") capturedPayload = payload;
	});
}

const sessionManager = SessionManager.inMemory(cwd);
const turns = Number(process.env.COMPACT_GUARD_E2E_TURNS ?? 40);
for (let i = 0; i < turns; i++) {
	sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: `turn ${i}: check src/module-${i}.mjs and fix the guard wiring ` + "-".repeat(600) }], timestamp: Date.now() });
	sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: `worked on module ${i}: ` + "x".repeat(900) }], timestamp: Date.now() });
}

const { session } = await createAgentSession({
	cwd,
	sessionManager,
	resourceLoader: loader,
});

const model = session.model;
console.log(`model: ${model?.provider}/${model?.id}  contextWindow=${model?.contextWindow} maxTokens=${model?.maxTokens} reasoning=${model?.reasoning}`);

const seededChars = sessionManager.getBranch().length * 700;
console.log(`seeded ${turns} turns; guard will bound the summarization input`);

let result;
let error;
const started = Date.now();
try {
	result = await session.compact();
} catch (err) {
	error = err;
}
const elapsed = Date.now() - started;

console.log(`compact() took ${elapsed} ms`);
if (error) {
	console.log(`FAIL  compaction threw: ${error.message}`);
	session.dispose();
	process.exit(1);
}

const summary = result?.summary ?? "";
console.log(`summary: ${summary.length} chars, firstKeptEntryId=${result?.firstKeptEntryId ? "present" : "missing"}, tokensBefore=${result?.tokensBefore}`);
console.log(`details: ${JSON.stringify(result?.details)}`);
if (capturedPayload) {
	const maxTokensField = capturedPayload.max_tokens ?? capturedPayload.max_completion_tokens;
	console.log(`request: max_tokens=${maxTokensField} enable_thinking=${capturedPayload.chat_template_kwargs?.enable_thinking} messages=${capturedPayload.messages?.length}`);
}

const logPath = process.env.COMPACT_GUARD_LOG ?? ".spike/compaction-guard.log.jsonl";
let guardLog = null;
try {
	const lines = (await import("node:fs")).readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
	guardLog = JSON.parse(lines[lines.length - 1]);
} catch { /* no log */ }
const checks = [
	["compaction returned a summary", summary.length > 0],
	["summary is under the guard ceiling", summary.length <= 12060],
	["the guard took over the summarization", guardLog?.event === "summary" && guardLog.spanChars > 60000, `span ${guardLog?.spanChars} chars`],
	["the request carried an explicit max_tokens", typeof guardLog?.sentMaxTokens === "number", `sent max_tokens=${guardLog?.sentMaxTokens}`],
	["that max_tokens is far below the model's own 32768 limit", (guardLog?.sentMaxTokens ?? 0) <= 4000],
	["the thinking phase was turned off for the summary call", guardLog?.thinkingOff === true],
	["the model answered within the cap", (guardLog?.usage?.output ?? 0) <= (guardLog?.sentMaxTokens ?? 0), `output ${guardLog?.usage?.output} tokens in ${guardLog?.elapsedMs} ms`],
	["the compaction is recorded in the session", sessionManager.getBranch().some((entry) => entry.type === "compaction")],
];
let failures = 0;
for (const [name, ok] of checks) {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
	if (!ok) failures++;
}
console.log(failures === 0 ? "\nALL PASS (real harness, real extension, real model call)" : `\n${failures} FAILURES`);
session.dispose();
process.exit(failures === 0 ? 0 : 1);
