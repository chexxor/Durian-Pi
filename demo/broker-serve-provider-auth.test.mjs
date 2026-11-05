// #5111: a health probe that asks an authenticated endpoint a question WITHOUT the credential it will later send
// does not measure the provider, it measures its own request. Measured on this host, in one run: `local: completes
// (finish=stop, prompt=57 tok, completion=28 tok)` AND `BLOCK provider-DURIG_LOCAL_-unreachable: ... HTTP 401`.
// The rule this demo pins: AN ANSWER IS AN ANSWER. Classify by what the server said — a connection failure is
// unreachable, 401/403 is reachable-but-unauthorized and must name the variable, 404 is a wrong path — and never
// let the two probes contradict each other.
// Run: node demo/broker-serve-provider-auth.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = process.env.DURIG_BROKER_TOOL ?? "tools/broker-serve.mjs";
const KEY = ["testkey", "durig", "probe", "loopback"].join("-"); // built here; never a scannable secret
const MODEL = "probe-model";

// A server that REQUIRES a key and answers completions correctly when it gets one. The requirement is the whole
// point: a demo run against an unauthenticated stub would not have caught this defect and must not count as proof.
const hits = { models: 0, completions: 0, withAuth: 0 };
const server = createServer((req, res) => {
	const auth = req.headers.authorization ?? "";
	const keyed = auth === `Bearer ${KEY}`;
	if (keyed) hits.withAuth++;
	if (req.url === "/v1/models") {
		hits.models++;
		if (!keyed) {
			res.writeHead(401, { "content-type": "application/json" });
			return res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
		}
		res.writeHead(200, { "content-type": "application/json" });
		return res.end(JSON.stringify({ data: [{ id: MODEL, object: "model" }] }));
	}
	if (req.url === "/v1/chat/completions") {
		hits.completions++;
		req.resume();
		if (!keyed) {
			res.writeHead(401, { "content-type": "application/json" });
			return res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
		}
		res.writeHead(200, { "content-type": "application/json" });
		return res.end(
			JSON.stringify({
				choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
				usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
			}),
		);
	}
	res.writeHead(404, { "content-type": "application/json" });
	res.end(JSON.stringify({ error: { message: "no such route" } }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// A scratch DURIG_DB, never a team store, and asserted-untouched below (#5090's self-guard discipline).
// ASYNC spawn, deliberately: the fixture server lives in THIS process, and `spawnSync` parks the event loop, so
// the child's request would never be answered and every probe would time out. That is how the first draft of this
// demo failed for a reason that had nothing to do with the defect - an instrument whose harness cannot answer its
// own questions measures nothing.
const dbDir = mkdtempSync(join(tmpdir(), "durig-auth-probe-"));
async function status({ key = true, baseUrl = `${base}/v1`, probe = true } = {}) {
	const env = {
		...process.env,
		DURIG_DB: join(dbDir, "probe-rig.sqlite"),
		DURIG_LOCAL_BASE_URL: baseUrl,
		DURIG_LOCAL_MODEL: MODEL,
		DURIG_LOCAL_CONTEXT: "4096",
	};
	if (key) env.DURIG_LOCAL_API_KEY = KEY;
	else delete env.DURIG_LOCAL_API_KEY;
	for (const k of Object.keys(env)) if (k.startsWith("DURIG_VERIFIER_")) delete env[k];
	const child = spawn(process.execPath, [TOOL, "--status", ...(probe ? [] : ["--no-probe"])], { env });
	let out = "";
	child.stdout.on("data", (d) => (out += d));
	child.stderr.on("data", (d) => (out += d));
	const status = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`broker-serve --status did not exit within 90s; output so far:\n${out}`));
		}, 90000);
		child.on("exit", (code) => (clearTimeout(timer), resolve(code)));
	});
	return { out, status };
}

try {
	// --- A. keyed: both probes answer, and NOTHING about this provider is blocked ---------------------------
	{
		const { out } = await status({ key: true });
		assert.match(out, /local: answers, advertises \d+ model\(s\) including probe-model/, `A: the listing must be read as an answer\n${out}`);
		assert.match(out, /local: completes \(finish=stop, prompt=5 tok, completion=1 tok\)/, `A: the completion must be reported\n${out}`);
		assert.ok(!out.includes("provider-DURIG_LOCAL_-unreachable"), `A: no credential, no credential — but no LIE either\n${out}`);
		assert.ok(!out.includes("provider-DURIG_LOCAL_-unauthorized"), `A: a keyed listing is not unauthorized\n${out}`);
		assert.ok(hits.withAuth >= 2, "the probe must actually SEND the credential it reads (models + completions)");
	}

	// --- B. unkeyed against a key-protected server: reachable, unauthorized, and it NAMES the variable -------
	{
		const { out } = await status({ key: false });
		assert.match(out, /provider-DURIG_LOCAL_-unauthorized/, `B: a 401 is an ANSWER and must be classified as such\n${out}`);
		assert.match(out, /REACHABLE/, `B: the word the old instrument got wrong\n${out}`);
		assert.match(out, /DURIG_LOCAL_API_KEY/, "B: the fix must name the variable to set (s.apiKeyEnv)");
		assert.ok(!out.includes("provider-DURIG_LOCAL_-unreachable"), `B: 401 reported as unreachable is the defect\n${out}`);
		assert.ok(!KEY.split("-").some((p) => out.includes(p) && out.includes("Bearer")), "the probe must not print the credential it sends");
		// Both probes were refused here, so the inference block is EVIDENCE, not a guess — that is the honest shape.
		// (The completion-side findings are named from `s.id`, the listing-side ones from `s.prefix`; that mixed
		// vocabulary is pre-existing and I did NOT rename it — renaming a finding id can break a runbook citation.)
		assert.match(out, /refuses-inference/, "B: a 401 on the completion is still a real block");
	}

	// --- B2. the fast path (`--no-probe`) must not LOSE the verdict -----------------------------------------
	// An earlier draft of this fix sat the verdict inside the completion-probe block, so the runbook's fast
	// preflight reported NOTHING about a 401 — strictly worse than the defect. This case is that regression.
	{
		const { out } = await status({ key: false, probe: false });
		assert.match(out, /provider-DURIG_LOCAL_-unauthorized/, `B2: --no-probe must still name the answer\n${out}`);
		assert.match(out, /REACHABLE/, "B2: and must still say reachable");
		assert.match(out, /unproven/, "B2: it must admit inference was not probed, not invent a verdict");
		assert.ok(!out.includes("provider-DURIG_LOCAL_-unreachable"), `B2: still not unreachability\n${out}`);
	}

	// --- C. 404: reachable, wrong path — never "unreachable" -----------------------------------------------
	{
		const { out } = await status({ key: true, baseUrl: `${base}/not-a-v1-root`, probe: false });
		assert.match(out, /provider-DURIG_LOCAL_-models-not-found/, `C: a 404 is a path answer\n${out}`);
		assert.match(out, /REACHABLE/, `C: the endpoint answered; the probe must say so\n${out}`);
		assert.ok(!out.includes("provider-DURIG_LOCAL_-unreachable"), `C: 404 is not unreachability\n${out}`);
	}

	// --- D. a NON-answer is still unreachability: the fix must not have deleted the true case ----------------
	{
		const { out } = await status({ key: true, baseUrl: "http://127.0.0.1:1/v1", probe: false });
		assert.match(out, /provider-DURIG_LOCAL_-unreachable/, `D: connection refused must stay unreachable\n${out}`);
		assert.ok(!out.includes("provider-DURIG_LOCAL_-unauthorized"), "D: nothing answered, so nothing authorized");
	}

	// --- E. the instrument touched no store ---------------------------------------------------------------
	const { readdirSync, existsSync } = await import("node:fs");
	assert.ok(!existsSync(join(dbDir, "probe-rig.sqlite")), "a --status preflight must not manufacture a store (#4955)");
	assert.deepEqual(readdirSync(dbDir), [], `scratch db dir must stay empty: ${readdirSync(dbDir).join(", ")}`);
} finally {
	server.close();
	rmSync(dbDir, { recursive: true, force: true });
}
// Case D never reaches this server (port 1 refuses) and case C lands on the 404 route, so the /v1/models counter
// is 3, not 5 — asserted that way on purpose, because a fixture that counts its own absence would hide a scenario
// that silently stopped running.
assert.ok(hits.models >= 3 && hits.completions >= 2, `the scenarios must actually have reached the server (models=${hits.models} completions=${hits.completions})`);

console.log(`broker-serve-provider-auth: OK (${hits.models} listing hits, ${hits.completions} completion hits, ${hits.withAuth} carrying the credential)`);
