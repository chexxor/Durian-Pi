// Final, defensible throughput probe. Three lessons from the earlier attempts, all mine:
//  1. Non-streaming probes computed decode as completion/(prefill+decode) -> the "31-39 tok/s" primary
//     baseline in earlier notes was that composite, not a decode rate. Corrected below.
//  2. LM Studio does not send `usage` on its stream even with stream_options.include_usage, so decode is
//     counted in CHUNKS (one delta per token for these servers) rather than in reported tokens.
//  3. The Strata primary prefix-caches repeated prompts: re-sending the same text made TTFT collapse to
//     0.15s and produced a laughable "19,359 tok/s prefill". Every probe here uses unique filler text.
// prefill rate comes from a max_tokens=1 non-streaming call (total ~= prefill + one token);
// decode rate comes from the streamed chunk count over (t_last - t_first).
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

const WORDS = "the rig keeps a queue of work items that seats claim verify and land while a broker watches for stalls";
function fresh(n) { const tag = randomUUID().slice(0, 8); let s = `Case ${tag}: `; const w = WORDS.split(" "); for (let i = 0; i < n; i++) s += w[i % w.length] + " "; return s + "\nSummarize in one short sentence."; }
async function once(baseUrl, model, content, maxTokens) {
  const t0 = performance.now();
  const r = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: maxTokens, temperature: 0.2 }) });
  const j = await r.json().catch(() => ({}));
  return { ms: performance.now() - t0, usage: j.usage, finish: j.choices?.[0]?.finish_reason, err: r.ok ? null : `${r.status} ${JSON.stringify(j).slice(0, 160)}` };
}
async function streamed(baseUrl, model, content, maxTokens) {
  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: maxTokens, temperature: 0.2, stream: true }) });
  if (!res.ok) return { err: `${res.status} ${(await res.text()).slice(0, 200)}` };
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
  return { first: first === null ? null : (first - t0) / 1000, span: (last - (first ?? last)) / 1000, chunks, finish, errLine };
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
