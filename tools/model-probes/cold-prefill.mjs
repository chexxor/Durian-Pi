#!/usr/bin/env node
// tools/model-probes/cold-prefill.mjs — what does the FIRST turn of a seat cost on the resident
// local model, as opposed to a re-send of an already-cached prefix?
//
// Why this exists: `throughput.mjs` (D136) computes prefill from a `max_tokens: 1`
// NON-streaming call. On a reasoning server that number is not a prefill rate — it mixes in
// whatever the engine does before it is willing to emit one token, and on 2026-10-28 (Linux) it
// reported 5 / 23 / 59 tok/s for prompt sizes of 189 / 451 / 1,072 tokens, i.e. LARGER prompts
// reading FASTER. A rate that rises with prompt size is not a rate. The streaming TTFT in the
// same run (7.30 s / 3.77 s / 4.94 s) tells the same story from a different leg: the first token
// of a FRESH prompt takes seconds, and every later call reuses a cached prefix.
//
// So this probe separates the two states on purpose:
//   COLD  — a prompt no previous call has seen (unique filler text, fresh uuid per call)
//   WARM  — the SAME prompt re-sent, which is what a seat's next turn actually is
// and it captures the machine state (MemAvailable, SwapUsed, load) next to every number,
// because "the model is slow" and "the box is out of memory for experts" look identical from
// the endpoint alone (SELFDEV pitfall: check the machine before blaming the rig).
//
// Read-only against the rig: it never opens the store, never starts a server. It costs the
// model wall-clock, so it is deliberately small.

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const BASE = process.argv[2] ?? "http://127.0.0.1:47831/v1";
const MODEL = process.argv[3] ?? "iq3_s";

function machine() {
	// Linux-only for now: `/proc/loadavg` and `free` are the cheapest honest read. On Windows the
	// equivalent is GlobalMemoryStatusEx (see SELFDEV pitfall "check the machine first"); leaving
	// this unimplemented is better than a number that is wrong on the other OS.
	if (process.platform !== "linux") return `machine state: not probed on ${process.platform}`;
	const mem = execSync("free -b | awk '/^Mem:/{print $2, $7, $3}'").toString().trim().split(" ");
	const swap = execSync("free -b | awk '/^Swap:/{print $2, $3}'").toString().trim().split(" ");
	const load = execSync("cat /proc/loadavg").toString().trim().split(" ").slice(0, 3).join(" ");
	return `mem total ${(mem[0] / 2 ** 30).toFixed(0)}G avail ${(mem[1] / 2 ** 30).toFixed(1)}G used ${(mem[2] / 2 ** 30).toFixed(0)}G | swap used ${(swap[1] / 2 ** 30).toFixed(1)}G | load ${load}`;
}

// Unique words per call: the engine prefix-caches repeated prompts, and re-sending filler is
// how a "19,359 tok/s prefill" artifact got produced once already (throughput.mjs lesson 3).
const WORDS = "the rig keeps a queue of work items that seats claim verify and land while a broker watches for stalls and a delegate reports evidence";
function unique(nWords) {
	const tag = randomUUID().replace(/-/g, "");
	let s = `${tag.slice(0, 12)} `;
	for (let i = 0; i < nWords; i++) s += `${WORDS.split(" ")[i % WORDS.split(" ").length]}${(i * 7919) % 97} `;
	return s + "\nReply with exactly the single word: OK";
}

async function turn(prompt) {
	const t0 = performance.now();
	const res = await fetch(`${BASE}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		// `stream: true` is required for this server to report `usage` at all on a stream, and
		// `stream_options.include_usage` is what carries it (LM Studio omits it — throughput.mjs
		// lesson 2). The strata server also emits `timings`, which is the RAWEST material here:
		// the engine's own prompt_ms / prompt_per_second / predicted_per_second. Prefer those over
		// any inference from TTFT; inference is what produced the 5 tok/s artifact.
		body: JSON.stringify({
			model: MODEL,
			messages: [{ role: "user", content: prompt }],
			max_tokens: 8,
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
		}),
	});
	if (!res.ok) return { err: `HTTP ${res.status} ${(await res.text()).slice(0, 160)}` };
	let first = null;
	let usage = null;
	let timings = null;
	const dec = new TextDecoder();
	let buf = "";
	for await (const raw of res.body) {
		buf += dec.decode(raw, { stream: true });
		let i;
		while ((i = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, i).trim();
			buf = buf.slice(i + 1);
			if (!line.startsWith("data:")) continue; // `: keep-alive` comment lines are not events
			const p = line.slice(5).trim();
			if (p === "[DONE]") continue;
			let j;
			try { j = JSON.parse(p); } catch { continue; }
			if (j.usage) usage = j.usage;
			if (j.timings) timings = j.timings; // engine-reported, arrives on the final chunk
			const d = j.choices?.[0]?.delta || {};
			if ((d.content || d.reasoning_content || d.tool_calls) && first === null) first = performance.now();
		}
	}
	return {
		ttftMs: first === null ? null : first - t0,
		promptTokens: usage?.prompt_tokens ?? timings?.prompt_n ?? null,
		cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? timings?.cache_n ?? null,
		// Engine-reported prefill of the UNCACHED part of the prompt, and decode, in tok/s.
		prefillTokS: timings?.prompt_per_second ?? null,
		decodeTokS: timings?.predicted_per_second ?? null,
		promptMs: timings?.prompt_ms ?? null,
	};
}

console.log(`COLD/WARM PREFILL — ${process.platform} · ${BASE} · model=${MODEL}`);
console.log(`method: the server's OWN \`timings\` (prompt_per_second = the uncached part of the prompt; predicted_per_second = decode), plus a byte-identical re-send for WARM.\n        TTFT is reported alongside only as a cross-check — inferring prefill from TTFT or from a max_tokens=1 call is what produced the 5 tok/s artifact in throughput.mjs.\n`);
for (const words of [120, 900, 3000]) {
	const cold = unique(words);
	const a = await turn(cold);
	const b = await turn(cold); // same bytes: the prefix-cached state a seat's second turn is in
	const fmt = (v) => (v === null || v === undefined ? "?" : typeof v === "number" ? v.toFixed(1) : String(v));
	console.log(`  ${String(words).padStart(5)} words | COLD prompt=${String(a.promptTokens ?? "?").padStart(6)} cached=${String(a.cachedTokens ?? "?").padStart(6)} prefill ${fmt(a.prefillTokS)} tok/s (${fmt(a.promptMs)}ms) decode ${fmt(a.decodeTokS)} tok/s TTFT ${fmt(a.ttftMs)}ms${a.err ? ` ERR ${a.err}` : ""}`);
	console.log(`  ${" ".repeat(5)} words | WARM prompt=${String(b.promptTokens ?? "?").padStart(6)} cached=${String(b.cachedTokens ?? "?").padStart(6)} prefill ${fmt(b.prefillTokS)} tok/s (${fmt(b.promptMs)}ms) decode ${fmt(b.decodeTokS)} tok/s TTFT ${fmt(b.ttftMs)}ms${b.err ? ` ERR ${b.err}` : ""}`);
	console.log(`      machine: ${machine()}`);
}
