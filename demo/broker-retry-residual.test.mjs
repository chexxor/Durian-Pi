// demo/broker-retry-residual.test.mjs — the retry RESIDUAL: jitter + class + budget (#2483 / ROADMAP 158 / F6).
//
// The pre-fix retry schedule (src/broker.mjs, post-pass) was `min(wakeRetryMs * 2**(n-1),
// wakeRetryMaxMs)` — deterministic, capped, and NEVER terminal: no jitter (two brokers can
// resynchronize), no class (every failure looked the same), no budget (a persistent throw
// retries forever with only a capped backoff). This proves the fixed shape:
//   - `classifyError` names the class (`overload` for contention, `storage` for I/O, `unknown` otherwise)
//   - the backoff is JITTERED (two runs with different randomness differ)
//   - retries are BUDGET-BOUNDED and end in a TERMINAL, surfaced diagnostic (once)
//
// Run: node demo/broker-retry-residual.test.mjs  (exit 0 = pass)

import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classifyError, RETRYABLE_CLASSES, runWakeLoop } from "../src/broker.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const base = mkdtempSync(join(tmpdir(), "durig-retryres-"));
let seq = 0;

// A fake broker whose pass ALWAYS throws a wrapped storage-contention failure — the residual
// shape the demos of #2237 use (`SessionFailed` -> `database is locked`). `onAttempt` fires
// once per pass attempt: a THROWING pass never increments the loop's own `passes` counter, so
// the demo bounds the loop with `isStopping` rather than `maxPasses`.
function throwingHarness(onAttempt) {
	const inner = Object.assign(new Error("database is locked"), { errcode: 5, errstr: "database is locked" });
	const outer = Object.assign(new Error("session failed while reading a document"), { cause: inner });
	return {
		documentState: async () => ({ value: {} }),
		inspect: async () => {
			onAttempt();
			throw outer;
		},
		waitForIdle: async () => {},
		conversation: async () => null,
	};
}

const fakeStorage = {
	findDocument: async () => null,
	scanDocuments: async () => ({ items: [] }),
	document: async () => null,
	scanSubmissions: async () => ({ items: [] }),
};

function fakeScheduler() {
	return {
		markDirty() {},
		shouldRun: () => true,
		beginPass() {},
		endPass() {},
		seatFilter: () => true,
		recordWakes() {},
		msUntilSeatReady: () => Infinity,
		clearSeatCooldown() {},
		delayUntilReady: () => 0,
	};
}

async function runLoop({ budget, randomValues, retryMs = 1000 }) {
	const dbPath = join(base, `t${++seq}.db`);
	const diags = [];
	let i = 0;
	let attempts = 0;
	const limit = budget + 4;
	const random = () => (randomValues === null ? 0.5 : randomValues[i++ % randomValues.length]);
	await runWakeLoop({
		harness: throwingHarness(() => {
			attempts += 1;
		}),
		probeStorage: fakeStorage,
		scheduler: fakeScheduler(),
		signal: { raise() {}, wait: async () => {} },
		context: {},
		dbPath,
		wakeRetryMs: retryMs,
		wakeRetryMaxMs: 60_000,
		wakeRetryBudget: budget,
		retryJitter: 0.25,
		random,
		// A THROWING pass never bumps `passes`, so `maxPasses` cannot bound this loop; stop it
		// from the outside instead.
		isStopping: () => attempts > limit,
		onDiagnostic: (d) => diags.push(d),
	});
	const logPath = `${dbPath}.broker.log`;
	const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
	return { diags, log, attempts };
}

try {
	console.log("\n=== retry residual: jitter + class + budget ===\n");

	/* --- classifyError --- */
	const wrapped = Object.assign(new Error("session failed"), {
		cause: Object.assign(new Error("database is locked"), { errcode: 5 }),
	});
	check("a wrapped 'database is locked' classifies as overload", classifyError(wrapped) === "overload", classifyError(wrapped));
	check("a bare SQLITE_BUSY code classifies as overload", classifyError(Object.assign(new Error("busy"), { code: "SQLITE_BUSY" })) === "overload");
	check("an overloaded/429 message classifies as overload", classifyError(new Error("server overloaded (429)")) === "overload");
	check("an I/O timeout classifies as storage", classifyError(new Error("disk I/O error: ETIMEDOUT")) === "storage");
	check("an unremarkable error classifies as unknown", classifyError(new Error("supervise boom")) === "unknown");
	check("no error classifies as unknown", classifyError(null) === "unknown");
	check(
		"every class is retry-eligible (the retried unit is an idempotent pass)",
		["overload", "storage", "unknown"].every((c) => RETRYABLE_CLASSES.has(c)),
	);

	/* --- budget: bounded retries, then a TERMINAL surfaced diagnostic --- */
	const BUDGET = 3;
	const { diags, log } = await runLoop({ budget: BUDGET, randomValues: null });

	const retryLines = log.split("\n").filter((l) => l.includes("WAKE-RETRY in="));
	const exhausted = log.split("\n").filter((l) => l.includes("WAKE-RETRY-EXHAUSTED"));
	check("the retry chain is BUDGET-BOUNDED (no retry past the budget)", retryLines.length === BUDGET, `retryLines=${retryLines.length}\n${log}`);
	check("every retry line names its class", retryLines.every((l) => /class=overload/.test(l)), log);
	check("every retry line names its position against the budget", retryLines.every((l, idx) => l.includes(`n=${idx + 1}/${BUDGET}`)), log);
	check("the budget ends in a TERMINAL log line", exhausted.length === 1 && exhausted[0].includes(`n=${BUDGET + 1}`), JSON.stringify(exhausted));
	check(
		"the terminal state is SURFACED as a diagnostic, exactly once",
		diags.filter((d) => d.kind === "retry-budget-exhausted").length === 1,
		JSON.stringify(diags.filter((d) => d.kind === "retry-budget-exhausted")),
	);
	const terminal = diags.find((d) => d.kind === "retry-budget-exhausted");
	check("the terminal diagnostic carries the class", terminal?.class === "overload", JSON.stringify(terminal));

	/* --- jitter: the same budget, different randomness, different backoff --- */
	const low = await runLoop({ budget: 1, randomValues: [0] });
	const high = await runLoop({ budget: 1, randomValues: [1] });
	const inOf = (l) => {
		const m = /WAKE-RETRY in=(\d+)ms/.exec(l);
		return m ? Number(m[1]) : null;
	};
	const lowIn = inOf(low.log.split("\n").find((l) => l.includes("WAKE-RETRY in=")) ?? "");
	const highIn = inOf(high.log.split("\n").find((l) => l.includes("WAKE-RETRY in=")) ?? "");
	check("jitter: random()=0 gives the low end of the band", lowIn === 750, `lowIn=${lowIn}`);
	check("jitter: random()=1 gives the high end of the band", highIn === 1250, `highIn=${highIn}`);
	check("jitter: the two runs do NOT resynchronize", lowIn !== highIn, `${lowIn} vs ${highIn}`);

	console.log(failures === 0 ? "\nPASS — retry residual verified" : `\nFAIL — ${failures} check(s) failed`);
} finally {
	try {
		rmSync(base, { recursive: true, force: true });
	} catch (err) {
		console.warn(`cleanup: could not remove ${base}: ${err.message}`);
	}
}

process.exit(failures === 0 ? 0 : 1);
