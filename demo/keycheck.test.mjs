// `tools/keycheck.mjs` pinned at the only point that matters to a human: it names the credential VARIABLE and never
// prints a VALUE — including on the paths where a probe actually leaks (a response body echoed into the report, an
// endpoint that hands back a token-shaped id). A green "success line" assertion would pass a tool that leaks on
// failure, so every case here asserts the ABSENCE of the planted value, and one case asserts the tool REFUSES
// outright rather than quoting something secret-shaped.
//
// It also pins the free/PAID split behaviourally, not by reading a comment: at `--level=auth` the loopback server
// records ZERO requests, which is what "checkAuth makes no network call" means at this altitude. The vendored API
// fact behind it: `checkAuth` returns `AuthCheck {source?, type}` (`node_modules/@earendil-works/pi-ai/dist/models.js:283-293`,
// `.../pi-ai/dist/auth/types.d.ts:94-97`), and our resolvers return the variable NAME as that source
// (`src/providers/local.mjs:314`) — so the printed string IS the credential variable name (ROADMAP 326's
// "presence visible, values not").
// Run: node demo/keycheck.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Built by concatenation (the `config-credential-surface` convention): the sentinel must be secret-shaped so the
// tool's shape self-check has something to catch, it must NOT appear as a literal in this file, and an absence
// assertion on a value that is also present in this file's text is worth nothing.
const SENTINEL = ["sk-", "durig", "keycheck", "demo", "7Qm4Ld8Zr"].join("") + "20261107"; // 40+ mixed chars
const FOREIGN_TOKEN = ["sk-", "foreign", "endpoint", "leaked", "T3v6Bq1Xc"].join("") + "20261107"; // never in env

const hits = [];
let nextBody = null;
const server = createServer((req, res) => {
	hits.push({ url: req.url, authorization: req.headers.authorization ?? null });
	res.statusCode = 200;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(nextBody()));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const BASE = `http://127.0.0.1:${server.address().port}/v1`;

// ASYNC on purpose. `spawnSync` blocks this process's event loop, so the fixture server above never answers and the
// child's request times out — the demo would fail for a reason that has nothing to do with the tool.
function run(args, env = {}) {
	return new Promise((finished) => {
		const child = spawn(process.execPath, ["tools/keycheck.mjs", ...args], {
			cwd: ROOT,
			env: {
				...process.env,
				DURIG_LOCAL_BASE_URL: BASE,
				DURIG_LOCAL_MODEL: "keycheck/demo-model",
				DURIG_LOCAL_API_KEY: SENTINEL,
				DURIG_VERIFIER_BASE_URL: "", // env precedence: blank makes the verifier spec absent (localProviderSpec:150-152)
				...env,
			},
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.on("close", (status) => finished({ status, stdout, stderr }));
	});
}
const assertNoSecret = (text, label) => {
	assert.ok(!text.includes(SENTINEL), `${label}: the credential VALUE leaked into the output`);
	assert.ok(!text.includes(FOREIGN_TOKEN), `${label}: a foreign token leaked into the output`);
};

// --- (1) the FREE half: names the variable, resolves auth, and opens NO socket ------------------------------
nextBody = () => {
	throw new Error("the free half must not reach the endpoint at all");
};
let r = await run(["--level=auth", "--family=LOCAL"]);
assert.equal(r.status, 0, `auth level must be green for a configured loopback endpoint:\n${r.stdout}\n${r.stderr}`);
assert.equal(hits.length, 0, "--level=auth opened a socket: the free half is no longer free");
assertNoSecret(`${r.stdout}\n${r.stderr}`, "auth level");
// The NAME of the variable is the report's `credentialSource` — that is the whole of 326's criterion.
assert.match(r.stdout, /"credentialSource":"DURIG_LOCAL_API_KEY"/, "the credential VARIABLE NAME must be printed");
assert.match(r.stdout, /"auth":"complete"/, "checkAuth must report complete configuration");
assert.match(r.stdout, /"endpoint":"loopback"/, "the endpoint class must be reported (keys are per box)");
assert.match(r.stdout, /SCOPE keys are PER BOX/, "the tool must state its per-box scope in its own header (326)");
assert.match(r.stdout, /"reachable":null/, "auth level must report reach as UNKNOWN, never as a verdict");

// --- (2) the reach half: a body echoed into the report, carrying the key -> redacted, not quoted -------------
// Realistic failure mode: an OpenAI-compat server that echoes the credential it was sent (a proxy, a debug handler,
// or a vendor error body). The tool puts `data[].id` into `advertised`, so this is the leak path the tool is judged on.
hits.length = 0;
nextBody = () => ({ data: [{ id: "keycheck/demo-model" }, { id: SENTINEL }] });
r = await run(["--level=reach", "--family=LOCAL", "--timeout-ms=4000"]);
assert.equal(r.status, 0, `reach level must be green against a live loopback endpoint:\n${r.stdout}\n${r.stderr}`);
assert.equal(hits.length, 1, `reach must make exactly one request, made ${hits.length}`);
assert.equal(hits[0].url, "/v1/models", "the reach probe must hit the OpenAI-compat model list, not a completion");
assert.equal(hits[0].authorization, `Bearer ${SENTINEL}`, "the probe must SEND the credential — presence alone never exercises the leak path");
assertNoSecret(`${r.stdout}\n${r.stderr}`, "reach level");
assert.match(r.stdout, /"advertised":\[[^\]]*<redacted:DURIG_LOCAL_API_KEY>/, "the echoed credential must be redacted with the variable it came from named");
assert.match(r.stdout, /"advertisedSource":"endpoint-list"/, "an advertised list that came from the endpoint must say so");
assert.match(r.stdout, /"latencyMs":\d+/, "the reach half owes a latency number");
assert.match(r.stdout, /"reachable":true/, "a 200 from the endpoint is reachable");

// --- (3) a token-shaped value that is NOBODY'S env value: refuse, print nothing -----------------------------
// The half that a success-line demo cannot catch: the leak is not a copy of a local variable, so substring redaction
// cannot find it. The shape self-check must fire, and it must fire WITHOUT quoting the token it caught.
hits.length = 0;
nextBody = () => ({ data: [{ id: "keycheck/demo-model" }, { id: FOREIGN_TOKEN }] });
r = await run(["--level=reach", "--family=LOCAL", "--timeout-ms=4000"]);
assert.equal(r.status, 2, `a secret-shaped token in the report must REFUSE the run, not quote it:\n${r.stdout}`);
assert.equal(r.stdout, "", "a refused run must print NOTHING — a report that leaks half its lines is still a leak");
assert.match(r.stderr, /cause:self_check_output_shape/, "the refusal must name its cause");
assert.match(r.stderr, /DURIG_LOCAL_API_KEY/, "the refusal must name the variables in play, not their values");
assertNoSecret(`${r.stdout}\n${r.stderr}`, "refusal path");

// --- (4) the PAID half is gated: no ceiling, no request, and it says which gate stopped it -------------------
hits.length = 0;
nextBody = () => ({ data: [{ id: "keycheck/demo-model" }] });
r = await run(["--level=spend", "--family=LOCAL", "--timeout-ms=4000"]);
assert.match(r.stdout, /"cause":"ceiling-required"/, "--level=spend without --ceiling must refuse, naming the gate");
assert.ok(hits.every((h) => !/completion|chat/.test(h.url)), `the gated probe must not send a completion: ${JSON.stringify(hits)}`);
assertNoSecret(`${r.stdout}\n${r.stderr}`, "spend gate");

// --- (5) a metered endpoint with NO key: presence visible, value absent, and the cause is named --------------
r = await run(["--level=auth", "--family=LOCAL"], {
	DURIG_LOCAL_BASE_URL: "https://keycheck.invalid/v1",
	DURIG_LOCAL_MODEL: "m",
	DURIG_VERIFIER_BASE_URL: "",
	DURIG_LOCAL_API_KEY: "",
});
assert.equal(r.status, 1, "an unkeyed metered endpoint is a finding, not a green");
assert.match(r.stdout, /"endpoint":"metered"/, "endpoint class decides what a missing key means");
assert.match(r.stdout, /"credentialSource":null/, "an absent credential is reported as absent — presence, never a value");
assert.match(r.stdout, /metered-endpoint-unkeyed/, "the refusal from createLocalProvider belongs in the report (src/providers/local.mjs:256)");
assertNoSecret(`${r.stdout}\n${r.stderr}`, "unkeyed metered");

server.close();
console.log("PASS keycheck: names the variable, never the value; zero sockets at auth level; redacts the echoed credential; refuses on a token-shaped body; spends nothing without a ceiling");
