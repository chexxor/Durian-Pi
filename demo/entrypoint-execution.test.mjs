// demo/entrypoint-execution.test.mjs - the EXECUTION vs TEXT classifier (#6377)
//
// WHAT THIS PROVES. That the instrument distinguishes a demo that RUNS an entrypoint from one
// that only reads its source, and that the distinction is computed from the demo text. The
// synthetic fixtures use a fixture entrypoint named `ent.mjs` deliberately: if this file put a
// literal `ui.mjs` inside a spawn call, the instrument would count its own fixture as evidence
// that ui.mjs is executed - exactly the error it exists to catch.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { classifyDemo, mentions, scan } from "../tools/entrypoint-execution.mjs";

let fails = 0;
const check = (label, cond, detail = "") => {
	if (cond) console.log(`PASS ${label}`);
	else { fails++; console.log(`FAIL ${label} - ${detail}`); }
};

// 1. the four kinds, from synthetic sources, so the rule itself is testable
const spawnedSrc = 'const r = spawnSync(process.execPath, [join(root, "ent.mjs"), "--help"], { timeout: 5000 });';
check("a spawn call is EXECUTION", classifyDemo(spawnedSrc, "ent.mjs").has("spawned"), JSON.stringify([...classifyDemo(spawnedSrc, "ent.mjs")]));

const textSrc = 'const ent = readFileSync(join(root, "ent.mjs"), "utf8"); check("wires enter", /enterHandler/.test(ent));';
const textKinds = classifyDemo(textSrc, "ent.mjs");
check("reading + regex is SOURCE-TEXT", textKinds.has("source-text") && !textKinds.has("spawned"), JSON.stringify([...textKinds]));

const mentionSrc = '// ent.mjs is the entrypoint; this demo asserts nothing about it\nconsole.log("see ent.mjs");';
check("a bare mention is NOT coverage", classifyDemo(mentionSrc, "ent.mjs").has("mention"), JSON.stringify([...classifyDemo(mentionSrc, "ent.mjs")]));

const bothSrc = 'import { parse } from "./cliargs.mjs";\nconst r = spawnSync(process.execPath, ["cli.mjs", "queue"]);';
check("an import is a separate kind from a spawn", classifyDemo(bothSrc, "cliargs.mjs").has("imported") && classifyDemo(bothSrc, "cli.mjs").has("spawned"), JSON.stringify([...classifyDemo(bothSrc, "cliargs.mjs")]));

// 2. the collision a substring match gets wrong: running a demo is not running the test runner
check("demo/x.test.mjs is not a mention of test.mjs", !mentions("spawnSync('node', ['demo/x.test.mjs'])", "test.mjs"), "substring match swallowed the suffix");
check("scripts/test.mjs IS a mention of test.mjs", mentions("spawnSync('node', ['scripts/test.mjs'])", "test.mjs"), "the boundary rule dropped a real mention");

// 3. a fixture suite: the scan itself, on sources we control
const dir = mkdtempSync(join(process.cwd(), ".eo-fixture-"));
try {
	writeFileSync(join(dir, "runs-a.test.mjs"), 'spawnSync(process.execPath, ["ent.mjs"], { timeout: 4000 });');
	writeFileSync(join(dir, "reads-b.test.mjs"), 'const s = readFileSync("ent.mjs", "utf8"); /enter/.test(s);');
	writeFileSync(join(dir, "names-c.test.mjs"), '// ent.mjs is mentioned here, nothing asserted');
	const entry = scan(dir, [join(dir, "ent.mjs")]).entries[0];
	check("the scan counts the demo that ran it", entry.spawned === 1, `got ${entry.spawned}`);
	check("the scan counts the demo that read it", entry.sourceText === 1, `got ${entry.sourceText}`);
	check("the scan reports the mention separately, not as coverage", entry.demosTouching === 2 && entry.mentionOnly === 1, `rows ${entry.demosTouching}, mentionOnly ${entry.mentionOnly}`);
	check("the two counts sit side by side", entry.spawned + entry.sourceText === 2, JSON.stringify(entry));
} finally {
	rmSync(dir, { recursive: true, force: true });
}

// 4. the live claim: on this tree ui.mjs is asserted by reading, never by running
const live = scan(join(process.cwd(), "demo"), [join(process.cwd(), "cli.mjs"), join(process.cwd(), "ui.mjs")]);
const ui = live.entries.find((e) => e.name === "ui.mjs");
const cli = live.entries.find((e) => e.name === "cli.mjs");
check("ui.mjs has ZERO spawned demos on this tree", ui.spawned === 0, `got ${ui.spawned} (${ui.rows.filter((r) => r.kinds.includes("spawned")).map((r) => r.demo).join(", ")})`);
check("ui.mjs has source-text demos - that is the gap", ui.sourceText > 0, `got ${ui.sourceText}`);
check("at least one entrypoint IS executed: cli.mjs", cli.spawned > 0, `got ${cli.spawned}`);

// 5. the tool runs and exits 0 - a measurement is not a fault
const run = spawnSync(process.execPath, ["tools/entrypoint-execution.mjs", "--entry", "cli.mjs"], { timeout: 30000, encoding: "utf8" });
check("the tool exits 0", run.status === 0, `exit ${run.status}: ${run.stderr.slice(0, 200)}`);
check("the tool prints both counts", /spawned=\d+\s+imported=\d+\s+source-text=\d+/.test(run.stdout), run.stdout.slice(0, 200));

console.log(fails ? `ENTRYPOINT-EXECUTION: ${fails} FAIL(S)` : "ENTRYPOINT-EXECUTION: all checks pass");
process.exit(fails ? 1 : 0);
