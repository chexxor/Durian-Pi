// tools/compaction-guard-e2e.mjs — end-to-end proof that the compaction guard keeps a real
// compaction alive, using the real harness, the real extension file and the real local model.
//
//   node tools/compaction-guard-e2e.mjs
//   COMPACT_GUARD_E2E_MODE=auto node tools/compaction-guard-e2e.mjs
//
// MANUAL mode (default): seeds a conversation larger than the guard's input cap, loads
// .pi/extensions/compaction-guard.js the way the CLI does, captures the actual HTTP payload sent for
// the summarization call, and calls compact(). Exit 0 only when:
//   - compaction returned a summary (no "Auto-compaction failed" path taken),
//   - the request carried an explicit max_tokens far below the model's own output limit,
//   - the thinking phase was switched off for that request,
//   - the stored summary is at or under the guard's ceiling.
// Cost: one real local model call. The guard caps the summarization input at 60,000 chars, so the
// prompt is ~15k tokens and the call takes ~3-4 s on the local server (~83 tok/s prompt, ~156 tok/s
// generation). Override with COMPACT_GUARD_INPUT_CHARS / COMPACT_GUARD_OUTPUT_TOKENS.
// Turn count: pi's prepareCompaction() cuts the history where it has accumulated `keepRecentTokens`
// (default 20000; dist/core/settings-defaults.js:11) scanning backwards. A seeded branch under that has
// NO history to summarise and compact() throws "Nothing to compact (session too small)" — the guard is
// never reached. 160 turns seeds ~63k tokens, comfortably over the cut. Use COMPACT_GUARD_E2E_TURNS
// only for a bigger session, never a smaller one.
//
// AUTO mode: drives the path the operator actually hit — the harness's OWN threshold compaction inside
// a real turn (reason "threshold"), not a manual /compact call. It runs in an isolated scratch cwd
// (.spike/guard-auto-cwd) so the repo's .pi/ settings stay untouched, seeds just enough turns to cross
// `contextWindow - reserveTokens`, and fails if ANY `session_compact_failed` event fires. Measured
// 2026-11-09: 460 turns, 640,861-char span, guard took over, summarization call 8.4 s, whole run 14.6 s with the strata model; with the global default model (strata-server/qwen3.8-flash-next-iq3_xxs, reserveTokens 26214, threshold 104,858 tokens) the same run took 52 s.
// The same span WITHOUT the guard loads pi's default path and emits the operator's exact string:
// "Auto-compaction failed: Summarization failed: generation hit the token cap and the summary is
// incomplete" (control: .spike/control-unguarded-compaction.mjs).
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";

const cwd = process.cwd();
const logPath = process.env.COMPACT_GUARD_LOG ?? ".spike/compaction-guard.log.jsonl";

// Install the guard if this host has not run the installer yet (.pi/ is gitignored by design).
const dest = ".pi/extensions/compaction-guard.js";
const coreDest = ".pi/extensions/compaction-guard-core.mjs";
function ensureInstalled(targetDir) {
	mkdirSync(`${targetDir}/.pi/extensions`, { recursive: true });
	copyFileSync("tools/compaction-guard-extension.js", `${targetDir}/.pi/extensions/compaction-guard.js`);
	copyFileSync("tools/compaction-guard-core.mjs", `${targetDir}/.pi/extensions/compaction-guard-core.mjs`);
}
if (!existsSync(dest) || readFileSync(dest, "utf8") !== readFileSync("tools/compaction-guard-extension.js", "utf8") ||
	!existsSync(coreDest) || readFileSync(coreDest, "utf8") !== readFileSync("tools/compaction-guard-core.mjs", "utf8")) {
	ensureInstalled(cwd);
	console.log("installed .pi/extensions/compaction-guard.js + compaction-guard-core.mjs from the tracked source");
}

function lastGuardLog() {
	try {
		const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
		return JSON.parse(lines[lines.length - 1]);
	} catch { return null; }
}

function report(checks) {
	let failures = 0;
	for (const [name, ok, note] of checks) {
		console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok && note ? `  — ${note}` : ""}`);
		if (!ok) failures++;
	}
	console.log(failures === 0 ? "\nALL PASS (real harness, real extension, real model call)" : `\n${failures} FAILURES`);
	process.exit(failures === 0 ? 0 : 1);
}

if (process.env.COMPACT_GUARD_E2E_MODE === "auto") {
	const iso = ".spike/guard-auto-cwd";
	ensureInstalled(iso);
	const events = [];
	const loader = new DefaultResourceLoader({
		cwd: iso,
		agentDir: getAgentDir(),
		additionalExtensionPaths: [".pi/extensions/compaction-guard.js"],
		extensionFactories: [(pi) => {
			pi.on("compaction_start", (e) => events.push({ type: "compaction_start", reason: e.reason }));
			pi.on("compaction_end", (e) => events.push({ type: "compaction_end", reason: e.reason, summaryChars: e.result?.summary?.length, errorMessage: e.errorMessage }));
			pi.on("session_compact_failed", (e) => events.push({ type: "session_compact_failed", reason: e.reason, errorMessage: e.errorMessage }));
		}],
	});
	await loader.reload();
	const loadErrors = loader.extensionsResult?.errors ?? [];
	if (loadErrors.length) report([["the guard extension loaded", false, JSON.stringify(loadErrors)]]);

	const sm = SessionManager.inMemory(iso);
	const { session } = await createAgentSession({ cwd: iso, sessionManager: sm, resourceLoader: loader });
	const model = session.model;
	const settings = session.settingsManager.getCompactionSettings(model);
	const threshold = model.contextWindow - settings.reserveTokens;
	// Measured: one seeded turn projects to ~390 tokens. Seed past the threshold so the harness
	// compacts on its own, mid-turn, before the assistant response is built.
	const turns = Math.ceil((threshold + 5000) / 390);
	for (let i = 0; i < turns; i++) {
		sm.appendMessage({ role: "user", content: [{ type: "text", text: `turn ${i}: check src/module-${i}.mjs and fix the guard wiring ` + "-".repeat(600) }], timestamp: Date.now() });
		sm.appendMessage({ role: "assistant", content: [{ type: "text", text: `worked on module ${i}: ` + "x".repeat(900) }], timestamp: Date.now() });
	}
	console.log(`model: ${model.provider}/${model.id} contextWindow=${model.contextWindow} maxTokens=${model.maxTokens} reasoning=${model.reasoning}`);
	console.log(`compaction settings: ${JSON.stringify(settings)}  threshold=${threshold} tokens  seeded ${turns} turns (~${turns * 390} tokens)`);

	const t0 = Date.now();
	await session.prompt("Reply with exactly: guard-auto-ok");
	const elapsed = Date.now() - t0;
	const compactions = sm.getBranch().filter((e) => e.type === "compaction");
	const guardLog = lastGuardLog();
	console.log(`prompt took ${elapsed} ms; compaction entries: ${compactions.length}`);
	console.log(`events: ${JSON.stringify(events)}`);
	console.log(`guard log tail: ${JSON.stringify(guardLog)}`);
	report([
		["no compaction failure was emitted", !events.some((e) => e.errorMessage), `failures: ${events.filter((e) => e.errorMessage).length}`],
		["the harness compacted on its own (threshold path)", compactions.length > 0],
		["the guard produced that compaction", compactions[0]?.details?.guard === true, `details ${JSON.stringify(compactions[0]?.details)}`],
		["the guard bounded a span far above its cap", (guardLog?.spanChars ?? 0) > 60000, `span ${guardLog?.spanChars} chars`],
		["the summary call carried an explicit max_tokens", (guardLog?.sentMaxTokens ?? 0) > 0 && (guardLog?.sentMaxTokens ?? 0) <= 4000, `sent max_tokens ${guardLog?.sentMaxTokens}`],
		["the summary fits the ceiling", (compactions[0]?.summary?.length ?? 0) <= 12060, `${compactions[0]?.summary?.length} chars`],
	]);
}

let capturedPayload = null;
const loader = new DefaultResourceLoader({
	cwd,
	agentDir: getAgentDir(),
	additionalExtensionPaths: [".pi/extensions/compaction-guard.js"],
	extensionFactories: [(pi) => {
		pi.on("before_provider_request", (event) => {
			const payload = event.payload;
			if (payload && typeof payload === "object") capturedPayload = payload;
		});
	}],
});
await loader.reload();

const sessionManager = SessionManager.inMemory(cwd);
const turns = Number(process.env.COMPACT_GUARD_E2E_TURNS ?? 160);
for (let i = 0; i < turns; i++) {
	sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: `turn ${i}: check src/module-${i}.mjs and fix the guard wiring ` + "-".repeat(600) }], timestamp: Date.now() });
	sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: `worked on module ${i}: ` + "x".repeat(900) }], timestamp: Date.now() });
}

const { session } = await createAgentSession({ cwd, sessionManager, resourceLoader: loader });
const model = session.model;
console.log(`model: ${model?.provider}/${model?.id}  contextWindow=${model?.contextWindow} maxTokens=${model?.maxTokens} reasoning=${model?.reasoning}`);
console.log(`seeded ${turns} turns; the guard will bound the summarization input`);

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
	if (error.message.includes("too small")) {
		console.log(`  the seeded branch is under pi's keepRecentTokens cut (default 20000 tokens); seed more turns with COMPACT_GUARD_E2E_TURNS=160`);
	}
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

const guardLog = lastGuardLog();
report([
	["compaction returned a summary", summary.length > 0],
	["summary is under the guard ceiling", summary.length <= 12060],
	["the guard took over the summarization", guardLog?.event === "summary" && guardLog.spanChars > 60000, `span ${guardLog?.spanChars} chars`],
	["the request carried an explicit max_tokens", typeof guardLog?.sentMaxTokens === "number", `sent max_tokens=${guardLog?.sentMaxTokens}`],
	["that max_tokens is far below the model's own 32768 limit", (guardLog?.sentMaxTokens ?? 0) <= 4000],
	["the thinking phase was turned off for the summary call", guardLog?.thinkingOff === true],
	["the model answered within the cap", (guardLog?.usage?.output ?? 0) <= (guardLog?.sentMaxTokens ?? 0), `output ${guardLog?.usage?.output} tokens in ${guardLog?.elapsedMs} ms`],
	["the compaction is recorded in the session", sessionManager.getBranch().some((entry) => entry.type === "compaction")],
]);
