// Final, defensible throughput probe. Three lessons from the earlier attempts, all mine:
//  1. Non-streaming probes computed decode as completion/(prefill+decode) -> the "31-39 tok/s" primary
//     baseline in earlier notes was that composite, not a decode rate. Corrected below.
//  2. LM Studio does not send `usage` on its stream even with stream_options.include_usage, so decode is
//     counted in CHUNKS (one delta per token for these servers) rather than in reported tokens.
//  3. The Strata primary prefix-caches repeated prompts: re-sending the same text made TTFT collapse to
//     0.15s and produced a laughable "19,359 tok/s prefill". Every probe here uses unique filler text.
// prefill rate comes from a max_tokens=1 non-streaming call (total ~= prefill + one token);
// decode rate comes from the streamed chunk count over (t_last - t_first).
//
// CAVEAT ADDED 2026-10-28 (Linux): **the prefill column of this script is not trustworthy for a reasoning
// server.** Run as-is it reported 5 / 23 / 59 tok/s for prompts of 189 / 451 / 1,072 tokens — a rate that
// RISES with prompt size, which is the tell. The strata server reports its own `timings`
// (prompt_ms / prompt_per_second / predicted_per_second) in the final SSE chunk, and those say
// 438 / 1,272 / 1,946 tok/s for the same sizes. The decode column is fine. Use
// `cold-prefill.mjs` for prefill from here on; see docs/reviews/delivery-channel-linux-2026-10-28.md §2.
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { meteredChat } from "./metered.mjs";

const WORDS = "the rig keeps a queue of work items that seats claim verify and land while a broker watches for stalls";
function fresh(n) { const tag = randomUUID().slice(0, 8); let s = `Case ${tag}: `; const w = WORDS.split(" "); for (let i = 0; i < n; i++) s += w[i % w.length] + " "; return s + "\nSummarize in one short sentence."; }
async function once(baseUrl, model, content, maxTokens) {
  const t0 = performance.now();
  // #5047 (acceptance P8): the accounted path. The prefill leg is a plain non-streaming call, so it fits the seam
  // exactly - credential attached, caps projected before sending, one 14-field row after (note says which probe).
  const call = await meteredChat({ baseUrl, body: { model, messages: [{ role: "user", content }], max_tokens: maxTokens, temperature: 0.2 }, env: process.env, note: "probe throughput.mjs (prefill leg)" });
  const ms = performance.now() - t0;
  let j = {};
  try { j = JSON.parse(call.text) ?? {}; } catch { /* a non-JSON body is the err branch below, accounted with usd null */ }
  return { ms, usage: j.usage, finish: j.choices?.[0]?.finish_reason, err: call.status === 200 ? null : `${call.status} ${String(call.text ?? "").slice(0, 160)}` };
}
async function streamed(baseUrl, model, content, maxTokens) {
  const t0 = performance.now();
  // #5047 (P8): taken RAW on purpose - this function's product IS the per-chunk clock, so the seam may not buffer
  // the body. It still owns the accounting through `account(usage)`, called after the clock stops.
  const call = await meteredChat({ baseUrl, body: { model, messages: [{ role: "user", content }], max_tokens: maxTokens, temperature: 0.2, stream: true }, env: process.env, raw: true, note: "probe throughput.mjs (decode leg, chunk-timed)" });
  const res = call.res;
  if (!res.ok) { const err = `${res.status} ${(await res.text()).slice(0, 200)}`; call.account(null, `probe throughput.mjs decode leg failed HTTP ${res.status}`); return { err }; }
  let first = null, last = t0, chunks = 0, finish = null, errLine = null;
  const dec = new TextDecoder(); let buf = "";
  for await (const raw of res.body) {
    buf += dec.decode(raw, { stream: true });
    let i; while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) { if (line && !line.startsWith("event:") && !line.startsWith("id:")) errLine ||= line.slice(0, 200); continue; }
      const p = line.slice(5).trim(); if (p === "[DONE]") continue;
      let j; try { j = JSON.parse(p); } catch { errLine ||= p.slice(0, 200); continue; }
      const d = j.choices?.[0];
      if (d?.finish_reason) finish = d.finish_reason;
      const dl = d?.delta || {};
      if ((dl.content || dl.reasoning_content || dl.tool_calls)) { const now = performance.now(); if (first === null) first = now; last = now; chunks++; }
    }
  }
  const out = { first: first === null ? null : (first - t0) / 1000, span: (last - (first ?? last)) / 1000, chunks, finish, errLine };
  // Accounted AFTER the numbers are computed: the ledger append must not enter the measurement it documents. These
  // servers send no `usage` on a stream (lesson 2 above), so the row is recorded with `usd: null` - UNKNOWN, never
  // $0.00 - which is exactly what the ledger's `unknownCostRows` counter exists to surface.
  call.account(null, "probe throughput.mjs decode leg: this server reports no usage block on a stream, so the cost is UNKNOWN");
  return out;
}
async function measure(label, baseUrl, model, nWords) {
  const p = fresh(nWords);
  const a = await once(baseUrl, model, p, 1);
  const b = await streamed(baseUrl, model, p, 512);
  const pt = a.usage?.prompt_tokens;
  const prefill = pt && a.ms ? (pt / (a.ms / 1000)).toFixed(0) : "?";
  const decode = b.span > 0.05 ? (b.chunks / b.span).toFixed(1) : "?";
  console.log(`  ${label.padEnd(26)} ctx=${String(pt ?? "?").padStart(6)} | prefill ${prefill.padStart(6)} tok/s (1-token call, ${a.ms.toFixed(0)}ms, finish=${a.finish}) | decode ${decode.padStart(5)} tok/s (${b.chunks} chunks over ${b.span.toFixed(1)}s, TTFT ${b.first?.toFixed(2)}s, finish=${b.finish})${a.err ? ` | prefill ERR ${a.err}` : ""}${b.errLine ? ` | stream note ${b.errLine}` : ""}`);
}
console.log(`MEASURED 2026-10-27 — unique prompts (no prefix cache), prefill via max_tokens=1, decode via stream chunks`);
console.log(`\nMinistral 3 14B Reasoning Q6_K on the A4000 (loaded ctx 13,312):`);
for (const [l, n] of [["short (~0.5k words)", 120], ["medium (~1.5k words)", 380], ["long (~4k words)", 1000]]) await measure(l, "http://localhost:1234/v1", "mistralai/ministral-3-14b-reasoning", n);
console.log(`\nPrimary iq3_s on the 3090 (same method, fresh text):`);
for (const [l, n] of [["short (~0.5k words)", 120], ["medium (~1.5k words)", 380], ["long (~4k words)", 1000]]) await measure(l, "http://127.0.0.1:47831/v1", "iq3_s", n);
console.log(`\nVRAM/RAM while Ministral is resident:`);
