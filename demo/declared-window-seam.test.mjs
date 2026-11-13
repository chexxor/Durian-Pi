// demo/declared-window-seam.test.mjs — the seam the size gate was missing.
//
// WHY THIS FILE EXISTS (a measurement, not a guess). `up --refresh` is the only writer of a seat's
// `usableWindow` (docs/POOL-QUEUE-SPEC.md §6.2, N19 row 5), and it calls `usableContextBudget`. Measured
// 2026-11-13 on this rig (Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node
// v24.22.1): after `up --refresh` every one of the 12 seats carried `usableWindow: null`, because
// `declaredContextWindow` reads ONLY `DURIG_CONTEXT_WINDOW` and this rig declares its windows on the
// provider specs instead (`DURIG_LOCAL_CONTEXT` 204800, `DURIG_VERIFIER_CONTEXT` 24576). The trap is
// already named in docs/evidence/2026-11-08-context-window/README.md §11. The effect: `pool.seatsWithoutWindow =
// all 12` and the 70 % gate is DISARMED — not because the fleet has no window, but because the wire was
// missing. FAILING-FIRST: before the fallback, assertion 2 below fails and the gate refuses nothing.
//
// Pure-function probe: no harness, no store, no model, no network.
// Run: node demo/declared-window-seam.test.mjs   (exit 0 = pass)   Cost: measured 0.1 s.
import { declaredContextWindow, usableContextBudget } from "../src/config.mjs";
import { POOL_SIZE_GATE_FRACTION, sizeVerdict } from "../src/rig.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
}

// The shape this rig actually has: two local-family providers with declared windows, no DURIG_CONTEXT_WINDOW.
const RIG_SHAPE = {
	DURIG_LOCAL_BASE_URL: "http://127.0.0.1:8080/v1",
	DURIG_LOCAL_MODEL: "qwen3.8-flash-next-q2_0",
	DURIG_LOCAL_CONTEXT: 204800,
	DURIG_VERIFIER_BASE_URL: "https://api.deepinfra.com/v1/openai",
	DURIG_VERIFIER_MODEL: "openai/gpt-oss-120b",
	DURIG_VERIFIER_CONTEXT: 24576,
	DURIG_COMPACTION_MODEL_OVERRIDES: '{"verifier/*":{"reserveTokens":4096,"keepRecentTokens":8192}}',
};

console.log("\n=== nothing declared anywhere is NOT a measurement ===");
check("an empty config declares no window", usableContextBudget({}, "local/x").window === null && usableContextBudget({}, "local/x").usable === null);
check("the generic resolver ALONE still sees nothing for this rig (the trap the fallback removes)", declaredContextWindow(RIG_SHAPE, "local/qwen3.8-flash-next-q2_0") === null);
check("a provider with no BASE_URL is not a provider, so it declares no window", usableContextBudget({ DURIG_LOCAL_CONTEXT: 204800 }, "local/x").usable === null);

console.log("\n=== the provider declaration counts as a DECLARED window ===");
const local = usableContextBudget(RIG_SHAPE, "local/qwen3.8-flash-next-q2_0");
check("the local-family seat gets its 204800-token window", local.window === 204800, JSON.stringify(local));
check("usable = window - reserve - keepRecent, and it is a number the gate can divide by", local.usable === 204800 - 16384 - 20000, JSON.stringify(local));
const verifier = usableContextBudget(RIG_SHAPE, "verifier/openai/gpt-oss-120b");
check("the verifier-class seat gets 24576 and its own compaction override", verifier.window === 24576 && verifier.reserveTokens === 4096 && verifier.keepRecentTokens === 8192, JSON.stringify(verifier));
check("verifier usable is 12288, positive, so the gate can actually run", verifier.usable === 12288, JSON.stringify(verifier));
check("DURIG_CONTEXT_WINDOW still wins over the provider declaration (explicit beats implicit)", usableContextBudget({ ...RIG_SHAPE, DURIG_CONTEXT_WINDOW: '{"local/qwen3.8-flash-next-q2_0":100000}' }, "local/qwen3.8-flash-next-q2_0").window === 100000);
check("a remote seat does not inherit a local window", usableContextBudget(RIG_SHAPE, "deepinfra/zai-org/GLM-5.3-Flash").usable === null);

console.log("\n=== the gate bites on the numbers this rig now has ===");
const projectRow = { tier: "project" };
const smallRow = { tier: "small" };
const tierTokens = { trivial: 3400, small: 6100, feature: 6200, project: 120000 };
const verdictLocal = sizeVerdict(projectRow, { tierTokens, usableWindow: local.usable });
const verdictVerifier = sizeVerdict(projectRow, { tierTokens, usableWindow: verifier.usable });
check(`a project row is refused for the local-family seat: 120000 > ${Math.floor(POOL_SIZE_GATE_FRACTION * local.usable)} (${Math.round(POOL_SIZE_GATE_FRACTION * 100)}% of ${local.usable})`, verdictLocal.gated && verdictLocal.reason.includes("too-big:project"), JSON.stringify(verdictLocal));
check("a project row is refused for the verifier-class seat too", verdictVerifier.gated, JSON.stringify(verdictVerifier));
check("a small row is NOT refused for either seat, so the gate does not starve ordinary work", !sizeVerdict(smallRow, { tierTokens, usableWindow: local.usable }).gated && !sizeVerdict(smallRow, { tierTokens, usableWindow: verifier.usable }).gated);
check("an undeclared window refuses nothing and says why in the warning", sizeVerdict(projectRow, { tierTokens, usableWindow: null }).warning === "no usable window declared for this seat");
check("usable <= 0 reports no usable budget instead of dividing by it", sizeVerdict(projectRow, { tierTokens, usableWindow: -15424 }).warning.includes("no usable budget declared"));

console.log(failures === 0 ? "\nDECLARED-WINDOW SEAM PASS (the provider declaration reaches the gate, and the gate bites)" : `\nDECLARED-WINDOW SEAM FAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
