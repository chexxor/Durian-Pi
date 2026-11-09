#!/usr/bin/env node
// tools/provider-slots-probe.mjs — how many requests can this model endpoint actually take AT ONCE,
// how many is it already holding, and what does it really serve? (Promoted from
// `.spike/delegate-20261107g/provider-slots-probe.mjs` under D236 (9) by #5617.)
//
// WHY THIS EXISTS. 2026-11-07T23:17Z a planned server restart landed inside a live broker window and the
// supervisor deferred 169 rows to the human in 25 s (docs/SELFDEV.md #107;
// docs/runbooks/session-start-cost.md §27). The 3-second read that prevents that is this one. The
// 2026-11-08 half of the same complaint is oversubscription: `127.0.0.1:8080` reports `total_slots 3`
// while **18 established TCP connections** pointed at it, and the LAN box `192.168.1.52:8080` had
// `total_slots 4` and **2** — so the fleet was queueing on the saturated box while the other sat idle.
// This probe prints slots AND held connections together, because a slot count without a held count is
// half a number.
//
// It also refuses to trust a DECLARED model id: `~/.pi/agent/models.json` claimed
// `qwen3.8-flash-next-iq3_s` for the LAN box while `GET /v1/models` served `_xxxs`, and that mismatch was
// a false claim rather than a broken call (llama.cpp re-routes a completion requested with the wrong id).
// The probe prints what the endpoint SERVES.
//
// usage (the key is named by ENV VAR; its value never reaches the output):
//   set -a; . "$HOME/.config/durig/env"; set +a
//   node tools/provider-slots-probe.mjs http://127.0.0.1:8080 DURIG_LOCAL_API_KEY [modelId] [--slots N] [--tokens N] [--props-only]
//   node tools/provider-slots-probe.mjs http://192.168.1.52:8080 DURIG_LOCAL2_API_KEY [modelId] --props-only
//
// `--props-only` answers capacity, served model and held connections with NO completion call. Use it on a
// box you are already loading: the default mode's completions ADD load, which is the thing being diagnosed.
// Probe budget: completions ask for `--tokens` (default 96, floored at 64). At 8 tokens the LAN box answers
// `finish_reason=length` with `content: null`, which reads like a dead endpoint — pitfall 117.
//
// Measured 2026-11-08 on Linux Fedora 45 7.2.15-300.fc45.x86_64, node v24.22.1:
//   127.0.0.1:8080    slots 3, n_ctx 204800, `_s`,     3 concurrent 3,436 ms vs 3 sequential 799 ms
//   192.168.1.52:8080 slots 4, n_ctx 131072, `_xxxs`,  2 concurrent 5,271 ms
// exit: 0 (a refusing endpoint is a MEASUREMENT, not a probe failure) · 2 usage error.

import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flags = new Set();
const numeric = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	if (a === "--slots" || a === "--tokens") {
		numeric[a.slice(2)] = Number(argv[++i]);
		continue;
	}
	if (a.startsWith("--")) {
		flags.add(a.slice(2));
		continue;
	}
	positional.push(a);
}
const [base, keyEnv, model] = positional;
if (!base || !keyEnv) {
	console.error(
		"usage: provider-slots-probe.mjs <baseUrl> <KEY_ENV_VAR_NAME> [modelId] [--slots N] [--tokens N] [--props-only]",
	);
	process.exit(2);
}
const propsOnly = flags.has("props-only");
const tokens = Math.max(64, Number.isFinite(numeric.tokens) ? numeric.tokens : 96); // pitfall 117
const key = process.env[keyEnv];
const H = key ? { authorization: `Bearer ${key}` } : {};

const get = (path, ms = 15000) =>
	fetch(`${base}${path}`, { headers: H, signal: AbortSignal.timeout(ms) })
		.then((r) => (r.ok ? r.json() : { http: r.status }))
		.catch((e) => ({ error: String(e).slice(0, 120) }));

/**
 * Established TCP connections this host holds to `host:port`, via `ss` (Linux) or `netstat` (elsewhere).
 * Synchronous on purpose: the count belongs in the SAME JSON document as the slot count, or a reader
 * pairs one box's slots with another box's connections.
 */
export function heldConnections(host, port) {
	// `ss -Htn state established` does NOT print a state column — the query is the filter — so requiring the
	// literal ESTAB there counted 0 while `ss -Htn state established | grep -c ':8080'` counted 15 on this
	// box (measured 2026-11-08, same minute). `netstat -an` prints every state, so THERE the column must be
	// matched. One pattern per tool, and both are printed with the count (D142).
	const tools = [
		{ via: "ss", cmd: "ss", args: ["-Htn", "state", "established"], needsStateColumn: false },
		{ via: "netstat", cmd: "netstat", args: ["-an", "-p", "tcp"], needsStateColumn: true },
	];
	for (const { via, cmd, args, needsStateColumn } of tools) {
		let out;
		try {
			out = execFileSync(cmd, args, { encoding: "utf8", timeout: 8000 });
		} catch {
			continue; // tool absent on this host
		}
		const peer = `${host}:${port}`;
		const peers = out
			.split(/\r?\n/)
			.filter((l) => l.includes(peer) && (!needsStateColumn || /ESTAB/i.test(l)));
		return {
			via,
			established: peers.length,
			pattern: needsStateColumn ? `${peer} + ESTABLISHED` : `ss state established + ${peer}`,
		};
	}
	return { via: "none", established: null, pattern: null, note: "neither ss nor netstat answered on this host" };
}

const props = await get("/props");
const models = await get("/v1/models");
const u = new URL(base);
const held = heldConnections(u.hostname, u.port || "80");
const slots = Number(props?.total_slots ?? 0);

let timed = null;
if (!propsOnly) {
	const n = slots > 0 ? Math.min(slots, Number.isFinite(numeric.slots) ? numeric.slots : 4) : 2;
	const one = () => {
		const t0 = Date.now();
		return fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json", ...H },
			body: JSON.stringify({
				model: model || models?.data?.[0]?.id || "default",
				messages: [{ role: "user", content: "Reply with the single word OK." }],
				max_tokens: tokens,
			}),
			signal: AbortSignal.timeout(120000),
		})
			.then((r) => r.json())
			.then((j) => ({
				ms: Date.now() - t0,
				finish: j.choices?.[0]?.finish_reason ?? null,
				err: j.error ? JSON.stringify(j.error).slice(0, 120) : null,
			}))
			.catch((e) => ({ ms: Date.now() - t0, err: String(e).slice(0, 120) }));
	};
	const c0 = Date.now();
	const rs = await Promise.all(Array.from({ length: n }, one));
	const concurrentWall = Date.now() - c0;
	const s0 = Date.now();
	const sq = [];
	for (let i = 0; i < Math.min(n, 3); i++) sq.push(await one());
	timed = {
		n,
		concurrent_wall_ms: concurrentWall,
		concurrent_each_ms: rs.map((r) => r.ms),
		finish: rs.map((r) => r.finish),
		thin_content_risk: rs.some((r) => r.finish === "length") ? `finish=length at ${tokens} tokens — raise --tokens (pitfall 117)` : null,
		errors: rs.map((r) => r.err).filter(Boolean),
		sequential_n: sq.length,
		sequential_wall_ms: Date.now() - s0,
		sequential_each_ms: sq.map((r) => r.ms),
	};
}

console.log(
	JSON.stringify(
		{
			base,
			slots,
			held,
			oversubscribed:
				held.established !== null && slots > 0 && held.established > slots
					? `YES — ${held.established} connections held against ${slots} slots`
					: "no",
			servedModel: models?.data?.[0]?.id ?? null,
			n_ctx:
				props?.default_generation_settings?.n_ctx ??
				props?.model_params?.find((p) => p.name === "n_ctx")?.value ??
				null,
			propsError: props?.error ?? props?.http ?? null,
			probeTokens: propsOnly ? null : tokens,
			timed,
		},
		null,
		1,
	),
);
