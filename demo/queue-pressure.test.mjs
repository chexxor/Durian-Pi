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
// Cost: measured 5.5 s (the pure half is instant; the wiring half runs `up` + `check` three times, one
// `queue --json --no-body`, the promoted tool four times and the ledger writer twice on the mocked fauxProvider
// plane — no network, no key). Cost CORRECTION 2026-11-15 at the mint-refusal read path: 2.7 s -> 5.5 s because
// the demo grew 12 legs (43 -> 55 checks) for that path; the fixture store is small, so the whole demo stays under
// 6 s and the growth is per-surface plumbing, not the store.
// Cost CORRECTION 2026-11-15 at `0f14e998`: this demo measured 12.1 s while the fixture inherited the live rig's
// armed extension rules, and 2.7 s once the fixture names its own config and arms none — the ~9 s gap is `ready-ref-stale`,
// which ran `tools/self-merge-sla.mjs`'s landingHealth over the LIVE repo (55 refs, a merge-tree per ref) inside a
// fixture that has no business reading the live repo. `last_verified: 2026-11-15`, `node demo/queue-pressure.test.mjs`
// exit 0 / 43 checks / 2.7 s, `.err` 0 bytes.
// Cost ADDENDUM 2026-11-16 at `88dbaacde` (the mint-rate SANITY legs landed): `node demo/queue-pressure.test.mjs`
// exit 0 / 75 checks / 7.87 s / `.err` 0 bytes; the FULL suite at the tree this commit lands read 367/367 in
// 171.3 s exit 0 with 0 FAILED lines and stderr 0 bytes (host Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
// git 2.56.0). The `mint-rate SANITY` red witness is a measured artifact, not a word: the PRE-change tool (`git archive HEAD tools src | tar -x
// -C .spike/prechange-qp80`, pre-change proven by `grep -c 'mint-rate SANITY' .spike/prechange-qp80/tools/queue-pressure.mjs` -> 0)
// prints NO sanity line (grep count 0) while the shipped tool prints it (count 1), both on the SAME 3-row capture, both exit 0, both `.err` 0 bytes.
// Measured on: Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { auditRig, formatCheck, RULES } from "../src/checkup.mjs";
import { bandVerdict, burnRate, queueShape, mintRefusalCensus, MINT_REFUSAL_LEDGER_CAP } from "../src/queueclass.mjs";
import { fleetLedgerVerdict } from "../src/fleetledger.mjs";
import { DEFAULT_BAND_PER_SEAT, DEFAULT_MINT_BURST_CAP, DEFAULT_PRESSURE_WINDOW_DAYS } from "../src/config.mjs";
import { RigQueue, enqueueItem, Router, recordMintRefusal } from "../src/rig.mjs";

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
// THE FAN-OUT BUDGET'S RECORD HAS A READ PATH (the #3486 / ROADMAP 272 half of task-5).
// `mintGate` (src/rig.mjs) REFUSES an over-fan-out mint and `recordMintRefusal` RECORDS the refusal as a
// `queue.mintRefusals` event. Measured before this seam: `rg mintRefusals` over the repo found the writer, its
// demos and one ROADMAP row — NOTHING READ IT, so "the budget is biting" and "the cap got quietly raised" were
// the SAME view. These legs run ONE ledger through all three surfaces — the queue view's census (`cli.mjs queue
// --json --no-body` -> `mintRefusals`), `check`'s `queue-pressure` finding, and the promoted tool — so the three
// cannot spell the number differently (#5047), and they pin the two honesty branches: a FULL ledger is a FLOOR,
// and an audit/view handed NO ledger reads as NOT MEASURED rather than as zero.
const burstGate = { ok: false, refusal: "send_work refused: burst cap reached", burst: 101, windowDays: 7, band: null, lineage: null, duplicateOf: null };
const lineageGate = { ok: false, refusal: "send_work refused: the fleet is out of band", burst: 1, windowDays: 7, band: { open: 35, limit: 20, perSeat: 10, seats: 2, inside: false, overBy: 15 }, lineage: null, duplicateOf: null };
const wroteBurst = await recordMintRefusal(harness, BACKGROUND_CONTEXT, { by: "pm", to: "impl", subject: "pressure task 1", gate: burstGate });
const wroteLineage = await recordMintRefusal(harness, BACKGROUND_CONTEXT, { by: "pm", to: "impl", subject: "pressure task 2", gate: lineageGate });
check("the writer records both refusals and never throws", wroteBurst === true && wroteLineage === true, `${wroteBurst}/${wroteLineage}`);
const qview = await cli(["queue", "--json", "--no-body"], { DURIG_DB: db, DURIG_CONFIG: fixtureConfig });
const qpayload = (() => {
	try {
		return JSON.parse(qview.stdout.slice(qview.stdout.indexOf("{"), qview.stdout.lastIndexOf("}") + 1));
	} catch {
		return null;
	}
})();
check("the queue VIEW carries the census — the seam exists", qpayload !== null && qpayload.mintRefusals !== undefined && qpayload.mintRefusals !== null, `${qview.code}: ${qview.stderr.slice(0, 200)}`);
check("...and counts both refusals in the window, by kind", qpayload?.mintRefusals?.ledger === 2 && qpayload.mintRefusals.inWindow === 2 && qpayload.mintRefusals.inWindowByKind.burst === 1 && qpayload.mintRefusals.inWindowByKind.lineage === 1, JSON.stringify(qpayload?.mintRefusals ?? qview.stdout.slice(0, 200)));
check("...and names the seat they went to", Object.keys(qpayload?.mintRefusals?.bySeat ?? {}).join(",") === "impl", JSON.stringify(qpayload?.mintRefusals?.bySeat));
check("...and states the bound it enforces, so a reader knows the ledger is a signal", qpayload?.mintRefusals?.cap === MINT_REFUSAL_LEDGER_CAP && qpayload?.mintRefusals?.saturated === false, `cap ${qpayload?.mintRefusals?.cap} saturated ${qpayload?.mintRefusals?.saturated}`);
const refusalStore = await cli(["check", rigPath, "--json"], { DURIG_DB: db, DURIG_CONFIG: fixtureConfig });
const refusalDetail = (() => {
	try {
			return (JSON.parse(refusalStore.stdout).findings ?? []).find((f) => f.id === "queue-pressure")?.detail ?? "";
	} catch {
		return "";
	}
})();
check("`check`'s finding NAMES the refusals on the SAME store", /refused 2 mint\(s\) in \d+ d \(burst 1, lineage 1, duplicate 0\) of 2 on the ledger/.test(refusalDetail), refusalDetail.slice(0, 900));
const refTool = await tool(["--db", db], { DURIG_DB: db });
check("the promoted tool prints the SAME numbers on the SAME store", /mint refusals: 2 in \d+ d \(burst 1, lineage 1, duplicate 0\) of 2 on the ledger/.test(refTool.stdout), refTool.stdout.slice(0, 1200));
check("...and names which seat and which refusal is newest", /newest \d{4}-\d\d-\d\dT[\d:.]+Z (burst|lineage|duplicate) pm->impl/.test(refTool.stdout), refTool.stdout.slice(0, 1200));
// The window caveat, pinned: `--window-days` re-derives the ROW rate over the requested window, but the ledger
// census comes from the view, which measured over its own declared window. Labelling the view's number as the
// run's would be a lie; the tool says which is which.
const refTool1 = await tool(["--db", db, "--window-days", "1"], { DURIG_DB: db });
check("a narrower window says which number came from which, instead of labelling the view's census as the run's", /mint refusals: .* \(window 7 d \(the view's census\) vs 1 d \(this run\)\)/.test(refTool1.stdout), refTool1.stdout.slice(0, 900));
// A capture from a build that predates the seam must read as NOT MEASURED, not as "zero refusals" — an
// unmeasured budget is not a budget that is not biting (#3539's blind-pass shape, in the other direction).
const legacyCapture = join(dir, "legacy-capture.json");
writeFileSync(legacyCapture, JSON.stringify({ ok: true, command: "queue", items: [row(4100)] }));
const legacyTool = await tool(["--snapshot", legacyCapture], { DURIG_DB: db });
check("a capture WITHOUT the field says NOT MEASURED rather than 0", /mint refusals: NOT MEASURED/.test(legacyTool.stdout), `${legacyTool.code}: ${legacyTool.stdout.slice(0, 600)}`);
// The bound is a property of the LEDGER, and filling it to the cap is a 100-commit exercise the writer's own
// demo already pays (demo/notice-not-work.test.mjs §10). Here the census is what is pinned, over the same shape
// the writer emits — so the FLOOR statement is proven without re-paying the commits.
const fullLedger = mintRefusalCensus(Array.from({ length: MINT_REFUSAL_LEDGER_CAP }, (i) => ({ at: NOW, event: "mint-refused", by: "pm", to: "impl", subject: `task ${i}`, kind: "burst", reason: "burst" })), { windowDays: 7 });
check("a FULL ledger says the total is a FLOOR, not a count", fullLedger.saturated && fullLedger.ledger === MINT_REFUSAL_LEDGER_CAP, `ledger ${fullLedger.ledger} cap ${fullLedger.cap} saturated ${fullLedger.saturated}`);
check("an audit handed NO ledger read says NOT MEASURED, never 0", /NOT MEASURED here/.test(unreadLedger.findings.find((f) => f.id === "queue-pressure")?.detail ?? ""), JSON.stringify(unreadLedger.findings.find((f) => f.id === "queue-pressure")?.detail ?? ""));
console.log("\n=== --price-budget: the COUNTERFACTUAL — is the mint budget PRICED, or is it an outage? ===");
// THE CONTRACT THIS PINS. A RECORDED refusal says the gate FIRED; it says nothing about whether the cap that
// fired is sized to this fleet, and an unpriced cap is the same class of lie as an unread limit (ROADMAP 272).
// `--price-budget` replays the mints the store recorded inside the window through the SHIPPED rules — `mintGate`
// precedence (duplicate, then burst, then lineage), notices and parked rows exempt — and counts what each rule
// WOULD have refused. Measured 2026-11-15 on the live store: burst would have refused 506 of 1,153 work mints
// (43.9%) while lineage refused 6 (0.5%) — the BURST cap at 100/seat/7 d is an outage on real work at this
// fleet's own fan-out rate, the lineage rule is priced. The fixture is small enough that the expected numbers
// are stated exactly, which is what makes the leg red the moment the replay drifts.
const PRICE_NOW = new Date().toISOString();
const pmint = (id, to, subject, body, notice = false) => ({
	id,
	from: "pm",
	to,
	status: "queued",
	subject,
	body,
	...(notice ? { notice: true } : {}),
	transitions: [{ at: PRICE_NOW, event: "queued" }],
});
const PRICE_ROWS = [
	pmint(9201, "impl", "close src/a.mjs", "src/a.mjs"), // lineage: an artifact
	pmint(9202, "impl", "polish #411", ""), // lineage: a parent row
	pmint(9203, "impl", "parentless ask", "nothing names this"), // armed 2 < cap, band out -> lineage
	pmint(9204, "impl", "parentless two", "nothing names this"), // same
	pmint(9205, "impl", "ROADMAP 92 copy", ""), // lineage: a ledger item -> allowed (armed reaches the cap)
	pmint(9206, "impl", "src/b.mjs follow-up", ""), // armed 3 >= cap -> burst
	pmint(9207, "verifier", "same task twice #500", ""), // allowed (it names a parent)
	pmint(9208, "verifier", "same task twice #500", ""), // the mint gate's duplicate rule fires first
	pmint(9209, "impl", "DONE #411: an acknowledgement", "", true), // exempt: a notice is not work
];
const priceSnap = join(dir, "price-capture.json");
writeFileSync(priceSnap, JSON.stringify({ ok: true, command: "queue", items: PRICE_ROWS }));
const priceReport = join(dir, "price-report.json");
const priceRun = await tool(["--snapshot", priceSnap, "--price-budget", "--band-per-seat", "1", "--mint-burst-cap", "3", "--json", priceReport], { DURIG_DB: db });
const price = (() => {
	try {
		return JSON.parse(readFileSync(priceReport, "utf8")).mintBudgetPrice;
	} catch {
		return null;
	}
})();
check("the back-test is machine-readable — `--json` carries mintBudgetPrice", price !== null, `${priceRun.code}: ${priceRun.stderr.slice(0, 300)}`);
check("it replays the 8 work mints and exempts the notice", price?.work === 8 && price?.exempt?.notice === 1, JSON.stringify({ work: price?.work, exempt: price?.exempt }));
check("...and refuses 4 of 8 under the shipped precedence: 2 lineage, 1 burst, 1 duplicate", price?.refusedTotal === 4 && price.refused.lineage === 2 && price.refused.burst === 1 && price.refused.duplicate === 1 && price.allowed === 4, JSON.stringify({ refused: price?.refused, allowed: price?.allowed, total: price?.refusedTotal }));
check("...and the per-seat numbers come from the shipped mintedBySeat (the notice row rides with its seat)", JSON.stringify(price?.perSeatWindow) === JSON.stringify({ impl: 7, verifier: 2 }), JSON.stringify(price?.perSeatWindow));
check("...and the cap it priced is a KNOB the run asked for, stated as an override of the rig's own", price?.cap === 3 && price?.capOverride === true && price?.rigCap === 100 && price?.windowDays === 7, JSON.stringify({ cap: price?.cap, capOverride: price?.capOverride, rigCap: price?.rigCap, windowDays: price?.windowDays }));
check("...and says so on the printed line, so an override never reads as the fleet's setting", /this run priced 3 as an OVERRIDE/.test(priceRun.stdout), priceRun.stdout.slice(0, 1600));
// The band is what arms the lineage leg, so the SAME rows must read differently when the fleet is inside it.
const priceRunIn = await tool(["--snapshot", priceSnap, "--price-budget", "--band-per-seat", "500", "--mint-burst-cap", "3", "--json", priceReport], { DURIG_DB: db });
const priceIn = (() => {
	try {
		return JSON.parse(readFileSync(priceReport, "utf8")).mintBudgetPrice;
	} catch {
		return null;
	}
})();
check("an inside band UNARMS the lineage leg — the same rows price at 0 lineage refusals", priceIn !== null && priceIn.refused.lineage === 0 && priceIn.refused.burst === 3 && priceIn.bandArmed === false, JSON.stringify({ refused: priceIn?.refused, armed: priceIn?.bandArmed }));
check("...and the price verdict never changes the gate's exit code (the rows are inside band now)", priceRunIn.code === 0, `${priceRunIn.code}`);
// Honest-absent, the same discipline as the mint-refusal census: a body-less capture cannot measure lineage over
// body text, and must say which text it measured over rather than pass its subject-only number off as the number.
const priceSnapNoBody = join(dir, "price-capture-nobodies.json");
writeFileSync(priceSnapNoBody, JSON.stringify({ ok: true, command: "queue", items: PRICE_ROWS.map((it) => { const { body, ...rest } = it; return rest; }) }));
const priceRunNoBody = await tool(["--snapshot", priceSnapNoBody, "--price-budget", "--band-per-seat", "1"], { DURIG_DB: db });
check("a capture without bodies labels the lineage leg as SUBJECT TEXT ONLY instead of claiming the number", /SUBJECT TEXT ONLY/.test(priceRunNoBody.stdout), priceRunNoBody.stdout.slice(0, 1400));
// The empty-window edge: the seeded store's rows were backdated OUT of the window, so there is nothing to replay
// — a divide by zero would be a crash, and a zero printed as if it were a verdict would be a lie about a fleet
// that was never asked.
const priceStoreRun = await tool(["--db", db, "--price-budget"], { DURIG_DB: db });
check("a store with no mints inside the window replays 0 and still exits on the band verdict", /replayed: 0 /.test(priceStoreRun.stdout) && priceStoreRun.code === 1, `${priceStoreRun.code}: ${priceStoreRun.stdout.match(/.*replayed.*/)?.[0] ?? ""}`);
check("...and names which read the bodies came from, so a reader knows the lineage leg had body text at all", /read: bodies INCLUDED — a second bounded read/.test(priceStoreRun.stdout), priceStoreRun.stdout.slice(0, 1600));
check("...and a capture run says so too (no second read was paid)", /bodies (present in the capture|OMITTED — the lineage leg)/.test(priceRunNoBody.stdout), priceRunNoBody.stdout.slice(0, 1600));

console.log("\n=== mint-rate SANITY: the mint rate is a FLOOR while rows can be minted parked ===");
// THE CONTRACT THIS PINS (measured on the live store 2026-11-16: `minted 1688` against 1,721 rows BORN inside
// 7 d — 33 blind rows, 19 of them ROADMAP registrations, a 1.9 % undercount). `burnRate` counts a row's FIRST
// `queued` transition; `src/rig.mjs` writes the intake of a HELD / registration mint as `held`, so a row minted
// straight into a park is BORN and INVISIBLE to the rate the band rule and `check`'s `queue-pressure` finding quote.
// The undercount moves `netOpen` DOWN — it makes the backlog read calmer than the fleet is, which is the direction
// that matters. The tool NAMES the blind set (delegate plane); the base predicate is untouched, so this leg pins
// the READ, and the anti-vacuity pair below proves the leg answers to the data rather than printing a constant.
const SANITY_NOW = new Date().toISOString();
const mintedQueued = (id, to, subject) => ({ id, from: "pm", to, status: "queued", subject, transitions: [{ at: SANITY_NOW, event: "queued" }] });
const mintedHeld = (id, to, subject, registration) => ({ id, from: "pm", to, status: "held", subject, ...(registration ? { registration: true } : {}), transitions: [{ at: SANITY_NOW, event: "held" }] });
const SANITY_ROWS = [
	mintedQueued(9301, "impl", "close src/a.mjs"),
	mintedQueued(9302, "impl", "polish #411"),
	mintedQueued(9303, "verifier", "verify src/a.mjs"),
	mintedQueued(9304, "impl", "fix src/b.mjs"),
	mintedQueued(9305, "verifier", "check src/b.mjs"),
	mintedHeld(9306, "pm", "ROADMAP 92 (BACKLOG — hold, do not start)", true),
	mintedHeld(9307, "impl", "parked for a human answer"),
];
const sanitySnap = join(dir, "mint-sanity-capture.json");
writeFileSync(sanitySnap, JSON.stringify({ ok: true, command: "queue", items: SANITY_ROWS }));
const sanityReport = join(dir, "mint-sanity-report.json");
const sanityRun = await tool(["--snapshot", sanitySnap, "--band-per-seat", "500", "--json", sanityReport], { DURIG_DB: db });
const sanity = (() => {
	try {
		return JSON.parse(readFileSync(sanityReport, "utf8")).mintRateSanity;
	} catch {
		return null;
	}
})();
check("the report is machine-readable — `--json` carries mintRateSanity", sanity !== null, `${sanityRun.code}: ${sanityRun.stderr.slice(0, 300)}`);
check("it counts 5 of 7 rows BORN inside the window — 2 were minted straight into a park", sanity?.visibleMints === 5 && sanity?.bornInWindow === 7 && sanity?.blind === 2 && sanity?.shareOfBlind === 28.6, JSON.stringify({ visible: sanity?.visibleMints, born: sanity?.bornInWindow, blind: sanity?.blind, share: sanity?.shareOfBlind }));
check("...and says WHICH rows are blind (1 registration, 1 parked ask) and where they sit", sanity?.blindRegistration === 1 && sanity?.blindNotice === 0 && JSON.stringify(sanity?.blindStatuses) === JSON.stringify({ held: 2 }), JSON.stringify({ reg: sanity?.blindRegistration, notice: sanity?.blindNotice, statuses: sanity?.blindStatuses }));
check("...and the rate it quotes is the shipped burn (5 minted, net +5), so the sanity leg reads the SAME derivation", sanity?.windowDays === 7, JSON.stringify(sanity?.windowDays));
check("...and counting them would move netOpen +5 -> +7 and NOT flip this fixture's verdict", sanity?.netOpenIfCounted === 7 && sanity?.verdictIfCounted === "GROWING" && sanity?.verdictFlips === false, JSON.stringify({ netOpenIfCounted: sanity?.netOpenIfCounted, verdict: sanity?.verdictIfCounted, flips: sanity?.verdictFlips }));
check("...and prints the numbers, not a pointer at them", /mint-rate SANITY: that rate sees 5 of 7 rows BORN inside the 7 d window — 2 were minted/.test(sanityRun.stdout), sanityRun.stdout.slice(0, 1600));
// ANTI-VACUITY: the SAME 7 rows with the two parks re-labelled as ordinary `queued` intakes must read BLIND 0 —
// a leg that printed its live-store numbers regardless of the rows would pass here.
const SANITY_ROWS_QUEUED = SANITY_ROWS.map((it) => ({ ...it, transitions: it.transitions.map((t, k) => (k === 0 && t.event === "held") ? { ...t, event: "queued" } : t) }));
const sanitySnapQ = join(dir, "mint-sanity-capture-queued.json");
writeFileSync(sanitySnapQ, JSON.stringify({ ok: true, command: "queue", items: SANITY_ROWS_QUEUED }));
const sanityRunQ = await tool(["--snapshot", sanitySnapQ, "--band-per-seat", "500", "--json", sanityReport], { DURIG_DB: db });
const sanityQ = (() => {
	try {
		return JSON.parse(readFileSync(sanityReport, "utf8")).mintRateSanity;
	} catch {
		return null;
	}
})();
check("the same rows with `queued` intakes read BLIND 0 — the leg answers to the data, not to a constant", sanityQ !== null && sanityQ.blind === 0 && sanityQ.bornInWindow === 7 && sanityQ.visibleMints === 7 && sanityQ.shareOfBlind === 0, JSON.stringify({ blind: sanityQ?.blind, born: sanityQ?.bornInWindow, visible: sanityQ?.visibleMints, share: sanityQ?.shareOfBlind }));
check("...and the sanity leg never changes the gate's verdict (this fixture is inside the raised band either way)", sanityRun.code === 0 && sanityRunQ.code === 0, `${sanityRun.code}/${sanityRunQ.code}`);

await storage.close(BACKGROUND_CONTEXT);

console.log(failures === 0 ? "\nQUEUE PRESSURE TEST PASS (0 failures)" : `\nQUEUE PRESSURE TEST FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
