// demo/queue-pressure.test.mjs — "the backlog is growing" is a rule that FAILS, not a sentence.
//
// THE STATE THIS NAMES (operator request 2026-11-15). `cli.mjs watch` printed ONE number for the queue and
// that number was not a count of work: measured with `node tools/queue-pressure.mjs` on this rig, of 1,656
// non-terminal rows 461 were protocol notices and 152 were ROADMAP registrations parked in the queue. A fleet
// cannot manage a number it cannot split, and a limit nobody measures is a limit that gets quietly raised (the
// inert-key class, ROADMAP 272).
//
// TWO SURFACES, ONE DERIVATION (the #5047 pair-of-spellings defect this tranche exists to close): the rule
// calls src/queueclass.mjs `queueShape` / `bandVerdict` / `burnRate` — the SAME predicates
// tools/queue-pressure.mjs prints. Both directions are proved: inside the band and not growing is a PASS,
// over the band or growing is a FAIL with exit code 1; then the wiring is proved: a real store holding real
// rows makes `node cli.mjs check` exit 1, and raising the band deliberately makes it exit 0.
//
// Run: node demo/queue-pressure.test.mjs   (exit 0 = pass)
// Cost: measured 2.7 s (the pure half is instant; the wiring half runs `up` + `check` twice and the promoted
// tool twice on the mocked fauxProvider plane — no network, no key).
// Cost CORRECTION 2026-11-15 at `0f14e998`: this demo measured 12.1 s while the fixture inherited the live rig's
// armed extension rules, and 2.7 s once the fixture names its own config and arms none — the ~9 s gap is `ready-ref-stale`,
// which ran `tools/self-merge-sla.mjs`'s landingHealth over the LIVE repo (55 refs, a merge-tree per ref) inside a
// fixture that has no business reading the live repo. `last_verified: 2026-11-15`, `node demo/queue-pressure.test.mjs`
// exit 0 / 43 checks / 2.7 s, `.err` 0 bytes.
// Measured on: Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { auditRig, formatCheck, RULES } from "../src/checkup.mjs";
import { bandVerdict, burnRate, queueShape } from "../src/queueclass.mjs";
import { fleetLedgerVerdict } from "../src/fleetledger.mjs";
import { DEFAULT_BAND_PER_SEAT, DEFAULT_MINT_BURST_CAP, DEFAULT_PRESSURE_WINDOW_DAYS } from "../src/config.mjs";
import { RigQueue, enqueueItem, Router } from "../src/rig.mjs";

const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "durig-queue-pressure-"));

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label} -- ${detail}`);
}

const SPEC = {
	version: 2,
	seats: [
		{ name: "pm", role: "Coordinator", capabilities: ["route"], model: "faux/model-a" },
		{ name: "impl", role: "Implementer (author)", capabilities: ["implement"], model: "faux/model-a" },
		{ name: "verifier", role: "Independent verifier", capabilities: ["verify"], model: "faux/model-b" },
	],
	edges: [
		{ from: "pm", maySendTo: ["impl", "verifier"] },
		{ from: "impl", maySendTo: ["pm", "verifier"] },
		{ from: "verifier", maySendTo: ["pm", "impl"] },
	],
	constitutionInline: "# Team culture\n\nGround every claim in a retrieved passage.\n",
	ownership: { "src-tools-harness": ["impl"], verification: ["verifier"] },
};

const audit = (queueItems, fleetLedger = null) =>
	auditRig({
		rig: "pressure.rig.json",
		spec: SPEC,
		specConstitution: SPEC.constitutionInline,
		stored: { reason: "read", text: SPEC.constitutionInline },
		storedSeats: SPEC.seats.map((s) => s.name),
		modelsBySeat: Object.fromEntries(SPEC.seats.map((s) => [s.name, s.model])),
		queueItems,
		fleetLedger,
		featureDocs: [],
		commitMessages: [],
		textIntegrity: [],
		citations: [],
		sharedTreeBranch: "main",
		contextBySeat: {},
		docCounts: [],
	});

const OLD = new Date(Date.now() - 40 * 86400000).toISOString();
const NOW = new Date().toISOString();
// A row whose `queued` transition is older than the window is NOT a mint in the window; a `done` row closed
// inside the window is a close. That is how a queue is made "not growing" without faking the arithmetic.
const row = (id, status = "queued", extra = {}) => ({
	id,
	from: "pm",
	to: "impl",
	status,
	subject: extra.subject ?? `task ${id}`,
	body: extra.body ?? "src/widget.mjs",
	blockedBy: [],
	transitions: extra.transitions ?? [{ at: OLD, event: "queued" }],
	...extra,
});

console.log("=== the rule is declared, not inferred ===");
const rule = RULES.find((r) => r.id === "queue-pressure");
check("queue-pressure is a declared rule", Boolean(rule), `RULES has ${RULES.length} entries`);
check("...and it is an ERROR, so `check` exits nonzero on it", rule?.severity === "error", String(rule?.severity));
check("the band numbers are DECLARED defaults, not read off the current backlog", DEFAULT_BAND_PER_SEAT === 10 && DEFAULT_MINT_BURST_CAP === 100 && DEFAULT_PRESSURE_WINDOW_DAYS === 7, JSON.stringify({ DEFAULT_BAND_PER_SEAT, DEFAULT_MINT_BURST_CAP, DEFAULT_PRESSURE_WINDOW_DAYS }));

console.log("\n=== over the band: 35 open work rows against 3 seats x 10 ===");
const over = audit([
	...Array.from({ length: 35 }, (_, i) => row(500 + i)),
	...Array.from({ length: 40 }, (_, i) => row(700 + i, "queued", { subject: `DONE #${i}: an acknowledgement`, notice: true })),
	...Array.from({ length: 10 }, (_, i) => row(800 + i, "held", { subject: "ROADMAP 92 (BACKLOG — hold, do not start)", registration: true })),
]);
const ids = over.findings.map((f) => f.id);
check("the rule fires", ids.includes("queue-pressure"), ids.join(", "));
check("...and it fails the run", over.exitCode === 1 && over.summary.error >= 1, JSON.stringify(over.summary));
const detail = over.findings.find((f) => f.id === "queue-pressure")?.detail ?? "";
check("the detail names the open count, the band and the over-by", detail.includes("35 open work rows") && detail.includes("band of 30") && detail.includes("over by 5"), detail);
check("the detail SPLITS the non-work rows out, so 35 is not confused with 85", detail.includes("40 are protocol notices") && detail.includes("10 are ROADMAP registrations"), detail);
check("the fix names a command that exists", /node tools\/queue-pressure\.mjs/.test(over.findings.find((f) => f.id === "queue-pressure")?.fix ?? ""), "no runnable fix");
check("the check list reports it as a fail, not a skip", over.checks.some((c) => c.id === "queue-pressure" && c.status === "fail"), JSON.stringify(over.checks.filter((c) => c.id === "queue-pressure")));

console.log("\n=== notices and registrations do NOT count against the band ===");
const inside = audit([
	...Array.from({ length: 25 }, (_, i) => row(600 + i)),
	...Array.from({ length: 40 }, (_, i) => row(700 + i, "queued", { subject: `DONE #${i}: an acknowledgement`, notice: true })),
	...Array.from({ length: 10 }, (_, i) => row(800 + i, "held", { subject: "ROADMAP 92 (BACKLOG — hold, do not start)", registration: true })),
]);
check("25 open work rows inside a band of 30 passes even with 50 non-work rows present", !inside.findings.map((f) => f.id).includes("queue-pressure"), JSON.stringify(inside.findings));
const shape = queueShape([
	...Array.from({ length: 25 }, (_, i) => row(600 + i)),
	...Array.from({ length: 40 }, (_, i) => row(700 + i, "queued", { subject: `DONE #${i}: an acknowledgement`, notice: true })),
	...Array.from({ length: 10 }, (_, i) => row(800 + i, "held", { subject: "ROADMAP 92 (BACKLOG — hold, do not start)", registration: true })),
	{ id: 900, from: "pm", to: "impl", status: "done", subject: "closed", transitions: [{ at: OLD, event: "queued" }, { at: NOW, event: "done" }] },
]);
check("queueShape's buckets sum to the live rows (25+40+10 = 75 of 76)", shape.work + shape.notice + shape.registration === shape.live && shape.live === 75, JSON.stringify(shape));
check("...and the claim lane is named separately from the non-work rows", shape.queuedWork === 25 && shape.openWorkBySeat.impl === 25, JSON.stringify({ queuedWork: shape.queuedWork, openWorkBySeat: shape.openWorkBySeat }));

console.log("\n=== inside the band and not growing: PASS ===");
const calm = audit([
	...Array.from({ length: 25 }, (_, i) => row(900 + i)),
	...Array.from({ length: 30 }, (_, i) => row(1000 + i, "done", { transitions: [{ at: OLD, event: "queued" }, { at: NOW, event: "done" }] })),
]);
check("no queue-pressure finding", !calm.findings.map((f) => f.id).includes("queue-pressure"), JSON.stringify(calm.findings));
check("...and the run is clean", calm.exitCode === 0, JSON.stringify(calm.summary));

console.log("\n=== growing PAST THE FLEET (net >= one full fleet band) fails even inside the band ===");
const growing = audit([
	...Array.from({ length: 30 }, (_, i) => row(1100 + i, "queued", { transitions: [{ at: NOW, event: "queued" }] })),
]);
check("30 open rows against a band of 30 is inside the band, so the GROWTH is what fires it", growing.findings.some((f) => f.id === "queue-pressure" && f.detail.includes("growing past the fleet")), JSON.stringify(growing.findings.filter((f) => f.id === "queue-pressure")));

console.log("\n=== the growth floor: net +4 is a Tuesday, not a crisis ===");
const smallGrowth = audit([
	...Array.from({ length: 4 }, (_, i) => row(1300 + i, "queued", { transitions: [{ at: NOW, event: "queued" }] })),
]);
check("net +4 inside a band of 30 does NOT fire — a floor of zero would fire on every fixture", !smallGrowth.findings.map((f) => f.id).includes("queue-pressure"), JSON.stringify(smallGrowth.findings));
check("...and the run is clean", smallGrowth.exitCode === 0, JSON.stringify(smallGrowth.summary));

console.log("\n=== the predicates themselves ===");
const burn = burnRate([row(1100, "queued", { transitions: [{ at: NOW, event: "queued" }] }), row(1101, "queued", { transitions: [{ at: NOW, event: "queued" }] }), row(1102, "done", { transitions: [{ at: OLD, event: "queued" }, { at: NOW, event: "done" }] })], { windowDays: 7 });
check("two mints and one close in the window is +1 and GROWING", burn.minted === 2 && burn.closed === 1 && burn.netOpen === 1 && burn.verdict === "GROWING", JSON.stringify(burn));
check("a notice minted in the window is counted as a notice, not work", burnRate([row(1103, "queued", { subject: "DONE #1: ack", notice: true, transitions: [{ at: NOW, event: "queued" }] })]).mintedNotice === 1, "mintedNotice");
check("bandVerdict says over-by, not a vague 'too many'", bandVerdict({ work: 35 }, { perSeat: 10, seats: 3 }).overBy === 5, JSON.stringify(bandVerdict({ work: 35 }, { perSeat: 10, seats: 3 })));

console.log("\n=== the rule cannot be quietly unavailable ===");
const unreadable = auditRig({ rig: "x", spec: SPEC, specConstitution: SPEC.constitutionInline, stored: { reason: "absent" } });
check("no queue means the rule is SKIPPED with a reason, never silently passed", unreadable.checks.some((c) => c.id === "queue-pressure" && c.status === "skipped"), JSON.stringify(unreadable.checks.filter((c) => c.id === "queue-pressure")));
const noSeats = auditRig({ rig: "x", spec: { version: 2, seats: [] }, specConstitution: "c", stored: { reason: "read", text: "c" }, queueItems: [] });
check("a rig with no seats cannot be judged against a per-seat band", noSeats.checks.some((c) => c.id === "queue-pressure" && c.status === "skipped"), JSON.stringify(noSeats.checks.filter((c) => c.id === "queue-pressure")));
check("the human report renders the finding", formatCheck(over, { rigDisplay: "pressure.rig.json", seats: 3, storeReason: "read" }).includes("queue-pressure"), "not rendered");

console.log("\n=== A REGISTRATION IN THE CLAIM LANE is its own rule, both directions ===");
// The other half of "the queue is not a ledger" (task-6): `enqueueItem` parks a registration mint as `held`
// (src/rig.mjs), so the mint path cannot write this shape — but the rows already in the store can, and a
// seat "completing" a ledger copy writes nothing into docs/ROADMAP.md. The rule fires on the CLAIMABLE
// registration and stays silent on a parked one, which is what makes it a rule about the mint, not a
// complaint about the ledger copy existing at all (queue-pressure owns that count).
const regRule = RULES.find((r) => r.id === "registration-as-work");
check("registration-as-work is a declared rule", Boolean(regRule), `RULES has ${RULES.length} entries`);
check("...and it is fix-now, not a permanent error", regRule?.severity === "fix-now", String(regRule?.severity));
const regFixture = (id, status) => [
	...Array.from({ length: 5 }, (_, i) => row(1200 + i)),
	row(id, status, { subject: "ROADMAP 92 (BACKLOG — hold, do not start)", registration: true }),
];
const withReg = audit(regFixture(910, "queued"));
check("a QUEUED registration fires it", withReg.findings.some((f) => f.id === "registration-as-work" && f.detail.includes("#910")), JSON.stringify(withReg.findings.filter((f) => f.id === "registration-as-work")));
const parkedReg = audit(regFixture(910, "held"));
check("...a PARKED one does not — the rule is about the mint, not about the ledger copy", !parkedReg.findings.map((f) => f.id).includes("registration-as-work"), JSON.stringify(parkedReg.findings));
const noticeNotReg = audit([...Array.from({ length: 5 }, (_, i) => row(1300 + i)), row(911, "queued", { subject: "CANCELLED #1088: ROADMAP 92 (BACKLOG — hold, do not start)", notice: true })]);
check("...and a NOTICE whose subject names registration words is not one either", !noticeNotReg.findings.map((f) => f.id).includes("registration-as-work"), JSON.stringify(noticeNotReg.findings));

console.log("\n=== WIRING: a real store makes `node cli.mjs check` exit 1 (and the tool agree with it) ===");
const run = (entry, args, env) =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, [entry, ...args], {
			cwd: durigDir,
			env: { ...process.env, DURIG_PROVIDER: "faux", ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => (stdout += c));
		child.stderr.on("data", (c) => (stderr += c));
		child.once("exit", (code) => resolve({ code, stdout, stderr }));
	});
const cli = (args, env) => run("cli.mjs", args, env);
const tool = (args, env) => run("tools/queue-pressure.mjs", args, env);

console.log("\n=== the finding QUOTES the tools/backlog-burn.mjs burn-rate verdict (one derivation, two surfaces) ===");
// THE CONTRACT THIS PINS. The goal says the `queue-pressure` finding must QUOTE the burn-rate verdict, not
// paraphrase it: "the gate says GROWING and the instrument says shrinking" is the #5047 pair-of-spellings defect
// in prose form. The fixture below is the JSONL `tools/broker-keepalive.mjs:272` appends, and the SAME text is
// pushed through both surfaces: src/fleetledger.mjs derives it once, src/checkup.mjs quotes it, tools/backlog-burn.mjs
// prints it. Asserting the two sentences are EQUAL (not merely similar) is what turns red if either side re-spells it.
const LEDGER_FIXTURE = [
	{ at: OLD, queue: { done: 10, cancelled: 2, held: 5, deferred: 4, claimed: 1, queued: 8 }, refs: 10, worktrees: 6, mainSha: "aaaaaaa1" },
	{ at: NOW, queue: { done: 22, cancelled: 6, held: 3, deferred: 2, claimed: 2, queued: 20 }, refs: 14, worktrees: 9, mainSha: "bbbbbbb2" },
].map((s) => JSON.stringify(s)).join("\n") + "\n";
const ledgerPath = join(dir, "fleet-ledger-fixture.jsonl");
writeFileSync(ledgerPath, LEDGER_FIXTURE);
const sharedVerdict = fleetLedgerVerdict(LEDGER_FIXTURE);
const overRows = [
	...Array.from({ length: 35 }, (_, i) => row(2500 + i)),
	row(2600, "queued", { subject: "DONE #2500: an acknowledgement", notice: true }),
];
const overLedger = audit(overRows, { ok: true, path: ledgerPath, bytes: LEDGER_FIXTURE.length, truncated: false, text: LEDGER_FIXTURE });
const ledgerDetail = overLedger.findings.find((f) => f.id === "queue-pressure")?.detail ?? "";
check("the finding quotes the SHARED verdict sentence verbatim", ledgerDetail.includes(`"${sharedVerdict.verdictLine}"`), ledgerDetail.slice(0, 600));
check("...and names the window it was quoted over", ledgerDetail.includes(sharedVerdict.firstAt) && ledgerDetail.includes(sharedVerdict.lastAt) && ledgerDetail.includes(`${sharedVerdict.spanMins} min window`), ledgerDetail.slice(0, 600));
check("...and states the ledger-staleness caveat, not a bare number", /stops being appended while the broker is down/.test(ledgerDetail), ledgerDetail.slice(0, 600));
const burnTool = await run("tools/backlog-burn.mjs", ["--ledger", ledgerPath], {});
const toolLine = (burnTool.stdout.match(/verdict: (.*)/) ?? [, ""])[1].trim();
check("the SAME fixture through tools/backlog-burn.mjs prints the SAME sentence the finding quoted", toolLine === sharedVerdict.verdictLine, `tool: ${toolLine} :: rule: ${sharedVerdict.verdictLine} (exit ${burnTool.code})`);
const unreadLedger = audit(overRows, { ok: false, path: ledgerPath, reason: "no fleet ledger at .spike/fleet-ledger.jsonl" });
check("an unreadable ledger says WHICH cross-check is missing, instead of silently dropping it", /no fleet-ledger burn-rate verdict could be quoted/.test(unreadLedger.findings.find((f) => f.id === "queue-pressure")?.detail ?? ""), JSON.stringify(unreadLedger.findings));
check("...and quoting the ledger does not change the verdict: the rule still FAILS because of the band", unreadLedger.findings.some((f) => f.id === "queue-pressure" && f.detail.includes("out of band")), JSON.stringify(unreadLedger.findings.filter((f) => f.id === "queue-pressure")));


const rigPath = join(dir, "pressure.rig.json");
const db = join(dir, "pressure.sqlite");
writeFileSync(rigPath, JSON.stringify(SPEC));
// THE FIXTURE MUST BE HERMETIC (found 2026-11-15 at `0f14e998`). `cli.mjs check` runs EVERY armed rule over
// `process.cwd()`, so a fixture rig that inherits the LIVE rig's config inherits the live rig's extension rules
// and the live repo's refs: `ready-ref-stale` reported `item-3570-recut` ready and 24.1 h past its 24 h SLA,
// which turned the assertion below red while NOTHING inside the fixture changed (it had passed the same day at
// `c5947cc2b`, 24.0 h — the SLA crossed mid-window, pitfall 398's rolling-window shape again). A fixture rig is
// the BASE surface, so the fixture names its own config: `DURIG_CONFIG` is precedence 1 in src/config.mjs,
// and arming NOTHING keeps the exit code about the fixture store alone.
const fixtureConfig = join(dir, "durig.config.json");
writeFileSync(fixtureConfig, JSON.stringify({ DURIG_EXTENSIONS: "" }));
const up = await cli(["up", rigPath], { DURIG_DB: db, DURIG_CONTEXT_WINDOW: JSON.stringify({ "faux/model-a": 65536, "faux/model-b": 40960 }) });
check("`up` built the rig", up.code === 0, up.stderr.slice(0, 300));

// Seed the store the way a seat does: the SAME enqueueItem send_work calls. The mint gate is opened wide for
// seeding (so this measures the CHECK rule, not the mint gate), and the rows are backdated so the burn rate is
// not an artefact of the seeding itself.
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = await openNodeSqliteStorage(db);
const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);
harness.resume();
process.env.DURIG_MINT_BURST_CAP = "500";
process.env.DURIG_BAND_PER_SEAT = "500";
await harness.commit(async (tx) => {
	for (let i = 0; i < 35; i += 1) await enqueueItem(tx, "pm", "impl", `pressure task ${i}`, "src/widget.mjs");
	const queue = await tx.doc(RigQueue);
	queue.items = queue.items.map((it) => ({ ...it, transitions: [{ at: OLD, event: "queued" }] }));
}, BACKGROUND_CONTEXT);
delete process.env.DURIG_MINT_BURST_CAP;
delete process.env.DURIG_BAND_PER_SEAT;

const overStore = await cli(["check", rigPath, "--json"], { DURIG_DB: db, DURIG_CONFIG: fixtureConfig });
check("`check` exits 1 when open work exceeds the band", overStore.code === 1, `${overStore.code}: ${overStore.stderr.slice(0, 200)}`);
check("...and names the rule in the report", overStore.stdout.includes("queue-pressure"), overStore.stdout.slice(0, 300));
const insideStore = await cli(["check", rigPath, "--json"], { DURIG_DB: db, DURIG_BAND_PER_SEAT: "500", DURIG_CONFIG: fixtureConfig });
check("`check` exits 0 when the band is raised deliberately", insideStore.code === 0, `${insideStore.code}: ${insideStore.stdout.slice(0, 400)}`);
// The leak this closes, pinned rather than assumed: every finding the fixture reports must be a rule the BASE
// declares (`RULES`, src/checkup.mjs) — an extension rule from the live rig in here is a fixture that measures
// its own host repo, and its verdict changes with the host's landing debt, not with the code under test.
const baseRuleIds = new Set(RULES.map((r) => r.id));
let insideReport = null;
try {
 insideReport = JSON.parse(insideStore.stdout);
} catch {
 /* the check below names the parse failure as the finding */
}
const foreign = insideReport === null ? ["STDOUT IS NOT A REPORT"] : (insideReport.findings ?? []).filter((f) => !baseRuleIds.has(f.id)).map((f) => `${f.id}/${f.severity}`);
check("the fixture audit stays on the BASE rules — no live-rig extension rule leaks in", foreign.length === 0, JSON.stringify(foreign));
// THE TOOL'S OWN SURFACE (task-1's exit-code contract, not just the derivation): the promoted instrument is
// run against the SAME seeded store, so the gate and the view are shown to agree on one store.
const overTool = await tool(["--db", db], {});
check("the tool exits 1 on the out-of-band store", overTool.code === 1, `${overTool.code}: ${overTool.stdout.slice(0, 300)}`);
check("...and says the band, the over-by and the cost/host line", /over by \d+/.test(overTool.stdout) && /host: Linux/.test(overTool.stdout), overTool.stdout.slice(0, 900));
const insideTool = await tool(["--db", db, "--band-per-seat", "500"], {});
check("...and exits 0 once the band is raised deliberately", insideTool.code === 0, `${insideTool.code}: ${insideTool.stdout.slice(0, 600)}`);
// The trap this closes: `--json` writes a REPORT, `--snapshot` reads a CAPTURE. Feeding one to the other must
// refuse by name, not die as a TypeError three frames deep.
const notACapture = join(dir, "not-a-capture.json");
writeFileSync(notACapture, JSON.stringify({ host: "n/a", rows: 0 }));
const badSnap = await tool(["--snapshot", notACapture], {});
check("a snapshot that is not a queue capture is REFUSED by name, not a TypeError", /has no items\[\]/.test(badSnap.stderr), `${badSnap.code}: ${badSnap.stderr.slice(0, 300)}`);
await storage.close(BACKGROUND_CONTEXT);

console.log(failures === 0 ? "\nQUEUE PRESSURE TEST PASS (0 failures)" : `\nQUEUE PRESSURE TEST FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
