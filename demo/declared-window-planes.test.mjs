// demo/declared-window-planes.test.mjs — #6066: declaredContextWindow must read the PLANE keys a rig
// actually sets (DURIG_VERIFIER_CONTEXT, DURIG_LOCAL_CONTEXT, DURIG_LOCAL2_CONTEXT), not only the
// global DURIG_CONTEXT_WINDOW.
//
// The defect, measured (docs/evidence/2026-11-08-context-window/README.md): a rig that declares
// `DURIG_LOCAL_CONTEXT = 204800` and `DURIG_VERIFIER_CONTEXT = 24576` reported
// `declaredWindow=null` for every seat, because src/config.mjs:417 read only DURIG_CONTEXT_WINDOW.
// Every occupancy fraction in ROADMAP 331/#5870 and every alarm threshold in #5929 is expressed
// against a declared window, so a null denominator leaves those numbers unanchored.
//
// Failing-first: before #6066 the assertions below return null and this demo exits 1.
// Run: node demo/declared-window-planes.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { contextConsumption } from "../src/context.mjs";
import { declaredContextWindow } from "../src/config.mjs";
import { inflightWindow } from "../src/inflight.mjs";
import { declaredLocalWindow, localProviderSpecs } from "../src/providers/local.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

// A rig shaped exactly like the live one: two GPU families plus a LAN box, each with its own keys.
// No DURIG_CONTEXT_WINDOW anywhere - which is precisely the case that used to return null.
const RIG = {
	DURIG_LOCAL_BASE_URL: "http://127.0.0.1:8081/v1",
	DURIG_LOCAL_MODEL: "qwen3.8-flash-next-q2_0",
	DURIG_LOCAL_CONTEXT: "204800",
	DURIG_LOCAL_MAX_TOKENS: "8192",
	DURIG_VERIFIER_BASE_URL: "https://inference.example.test/v1",
	DURIG_VERIFIER_MODEL: "gpt-oss-120b",
	DURIG_VERIFIER_CONTEXT: "24576",
	DURIG_VERIFIER_MAX_TOKENS: "6000",
	DURIG_LOCAL2_BASE_URL: "http://127.0.0.1:8082/v1",
	DURIG_LOCAL2_MODEL: "llama-3.3",
	DURIG_LOCAL2_CONTEXT: "131072",
};

console.log("\n=== #6066: the declared window comes from the family's own key ===\n");

console.log("1. each declared family resolves to ITS OWN window");
check("a verifier model id gets the verifier window", declaredContextWindow(RIG, "verifier/openai/gpt-oss-120b") === 24576, String(declaredContextWindow(RIG, "verifier/openai/gpt-oss-120b")));
check("a local model id gets the local window", declaredContextWindow(RIG, "local/qwen3.8-flash-next-q2_0") === 204800, String(declaredContextWindow(RIG, "local/qwen3.8-flash-next-q2_0")));
check("the third box (local2) is not left out", declaredContextWindow(RIG, "local2/llama-3.3") === 131072, String(declaredContextWindow(RIG, "local2/llama-3.3")));
check("the provider id is derived from the prefix, so the key and the id cannot drift", declaredContextWindow(RIG, "verifier/gpt-oss-120b") === 24576, "bare id under the verifier prefix");

console.log("\n2. the denominator AGREES with the window the harness opens");
for (const spec of localProviderSpecs(RIG)) {
	const key = `${spec.id}/${spec.modelId}`;
	check(
		`${key}: declared == the spec's contextWindow (${spec.contextWindow})`,
		declaredContextWindow(RIG, key) === spec.contextWindow,
		`got ${declaredContextWindow(RIG, key)}`,
	);
	// The read surface (readapi.mjs) resolves local windows through declaredLocalWindow; the two
	// paths must not disagree, or `status` and `compact` would report different denominators.
	check(`${key}: the two resolution paths agree`, declaredContextWindow(RIG, key) === declaredLocalWindow(localProviderSpecs(RIG), key), `${declaredContextWindow(RIG, key)} vs ${declaredLocalWindow(localProviderSpecs(RIG), key)}`);
}

console.log("\n3. the fallback is a fallback, not a disappearance");
check("no plane key -> the global DURIG_CONTEXT_WINDOW is used", declaredContextWindow({ DURIG_VERIFIER_BASE_URL: "https://x.test/v1", DURIG_CONTEXT_WINDOW: "128000" }, "verifier/x") === 128000, String(declaredContextWindow({ DURIG_VERIFIER_BASE_URL: "https://x.test/v1", DURIG_CONTEXT_WINDOW: "128000" }, "verifier/x")));
check("a malformed plane key falls through rather than becoming a guess", declaredContextWindow({ DURIG_VERIFIER_BASE_URL: "https://x.test/v1", DURIG_VERIFIER_CONTEXT: "24576abc", DURIG_CONTEXT_WINDOW: "128000" }, "verifier/x") === 128000, String(declaredContextWindow({ DURIG_VERIFIER_BASE_URL: "https://x.test/v1", DURIG_VERIFIER_CONTEXT: "24576abc", DURIG_CONTEXT_WINDOW: "128000" }, "verifier/x")));
check("the spec's built-in 65,536 is NOT reported as a declaration", declaredContextWindow({ DURIG_VERIFIER_BASE_URL: "https://x.test/v1" }, "verifier/x") === null, String(declaredContextWindow({ DURIG_VERIFIER_BASE_URL: "https://x.test/v1" }, "verifier/x")));
check("the global per-model map still works for a family with no plane key", declaredContextWindow({ DURIG_VERIFIER_BASE_URL: "https://x.test/v1", DURIG_CONTEXT_WINDOW: '{"gpt-oss-120b": 15000}' }, "verifier/gpt-oss-120b") === 15000, String(declaredContextWindow({ DURIG_VERIFIER_BASE_URL: "https://x.test/v1", DURIG_CONTEXT_WINDOW: '{"gpt-oss-120b": 15000}' }, "verifier/gpt-oss-120b")));
check("the plane key beats the global number for that family (the harness cannot honour more than it opens with)", declaredContextWindow({ ...RIG, DURIG_CONTEXT_WINDOW: "1000000" }, "verifier/openai/gpt-oss-120b") === 24576, String(declaredContextWindow({ ...RIG, DURIG_CONTEXT_WINDOW: "1000000" }, "verifier/openai/gpt-oss-120b")));

console.log("\n4. nothing is invented, and no family borrows another's window");
check("a remote seat does not inherit a local window", declaredContextWindow(RIG, "deepinfra/zai-org/GLM-5.3-Flash") === null, String(declaredContextWindow(RIG, "deepinfra/zai-org/GLM-5.3-Flash")));
check("a plane key set WITHOUT a BASE_URL is inert, not a declaration", declaredContextWindow({ DURIG_VERIFIER_CONTEXT: "24576" }, "verifier/x") === null, String(declaredContextWindow({ DURIG_VERIFIER_CONTEXT: "24576" }, "verifier/x")));
check("no model key -> no family chosen -> the global declaration only", declaredContextWindow(RIG, null) === null && declaredContextWindow({ ...RIG, DURIG_CONTEXT_WINDOW: "128000" }, null) === 128000);
check("durig.config.default.json as shipped declares DURIG_LOCAL_CONTEXT but registers no provider -> null", declaredContextWindow(JSON.parse(readFileSync("durig.config.default.json", "utf8")), "local/phi4") === null, "the shipped file has no DURIG_LOCAL_BASE_URL, so there is no family to read a window from");

console.log("\n5. the consumers that were getting null now get a denominator");
{
	// src/inflight.mjs#1705: the degenerate-turn alarm divides streamed tokens by this window (#5929).
	const window = inflightWindow(RIG, "verifier/openai/gpt-oss-120b");
	check("inflightWindow resolves the verifier window", window === 24576, String(window));
	// cli.mjs cmdCompact passes exactly this call into contextConsumption.
	const consumption = contextConsumption([{ kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "x" }], usage: { input: 18000, output: 300, cacheRead: 0, cacheWrite: 0 } }] }], { declared: declaredContextWindow(RIG, "verifier/openai/gpt-oss-120b") });
	check("the compact report can state a fraction against the family window", consumption.consumed === 18300 && consumption.window?.value === 24576 && consumption.window?.denominator === "declared", JSON.stringify({ consumed: consumption.consumed, window: consumption.window }));
}

console.log("\n=== #6066: declaredContextWindow now anchors the denominator ===\n");
if (failures > 0) {
	console.log(`${failures} check(s) FAILED`);
	process.exit(1);
}
console.log("ALL CHECKS PASS (each declared family resolves to its own key; the global DURIG_CONTEXT_WINDOW is the fallback; an unregistered or unreadable plane returns null rather than a guess)");
