// Proper decode measurement. The earlier probes were non-streaming, so "decode tok/s" was
// completion_tokens / (prefill + decode) — meaningless for a long prompt. This streams and separates:
//   prefill rate = prompt_tokens / time-to-first-token,  decode rate = completion_tokens / (t_last - t_first).
// It also reports reasoning vs answer tokens, because a thinking model that runs out of budget returns an
// EMPTY answer with finish_reason=length — which looks like a tool-calling failure but is a budget failure.
import { performance } from "node:perf_hooks";

const arg = Object.fromEntries(process.argv.slice(2));
async function stream(baseUrl, model, content, maxTokens, tools) {
  const body = { model, messages: [{ role: "user", content }], max_tokens: maxTokens, temperature: 0.2, stream: true, stream_options: { include_usage: true } };
  if (tools) { body.tools = tools; body.tool_choice = "auto"; }
  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` };
  let ttft = null, last = t0, contentTok = 0, reasonTok = 0, chunks = 0, finish = null, usage = null, toolCalls = [];
  const dec = new TextDecoder(); let buf = "";
  for await (const raw of res.body) {
    buf += dec.decode(raw, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim(); if (payload === "[DONE]") continue;
      let j; try { j = JSON.parse(payload); } catch { continue; }
      const d = j.choices?.[0]; if (!d) continue;
      if (j.usage) usage = j.usage;
      if (d.finish_reason) finish = d.finish_reason;
      const dl = d.delta || {};
      const piece = (dl.content || "") + (dl.reasoning_content || "") + (dl.tool_calls?.length ? "x" : "");
      if (piece) { const now = performance.now(); if (ttft === null) ttft = now; last = now; chunks++; }
      if (dl.content) contentTok += 1;
      if (dl.reasoning_content) reasonTok += 1;
      if (dl.tool_calls) for (const tc of dl.tool_calls) { const k = toolCalls[tc.index] ||= { name: "", args: "" }; if (tc.function?.name) k.name += tc.function.name; if (tc.function?.arguments) k.args += tc.function.arguments; }
    }
  }
  const total = (performance.now() - t0) / 1000;
  return { ttft: ttft === null ? null : (ttft - t0) / 1000, total, chunks, finish, usage, tools: toolCalls.filter(Boolean) };
}
const M = arg.m || "mistralai/ministral-3-14b-reasoning";
const LM = "http://localhost:1234/v1";
const filler = "The rig runs a queue of work items with seats that claim and verify them. ";
console.log(`MINISTRAL 3 14B REASONING — streamed measurement (A4000, Q6_K, ctx as loaded)`);
for (const [label, n, mt] of [["tiny prompt (decode rate)", 1, 512], ["~3k prompt", 180, 512], ["~9k prompt (fits the 13,312 loaded ctx)", 180 * 6, 256]]) {
  const r = await stream(LM, M, filler.repeat(n) + "\nSummarize the above in one short sentence.", mt);
  if (r.error) { console.log(`  ${label}: ERROR ${r.error}`); continue; }
  const pt = r.usage?.prompt_tokens ?? "?";
  const pre = r.ttft ? (pt / r.ttft).toFixed(0) : "?";
  const dec = r.usage?.completion_tokens && r.total && r.ttft ? (r.usage.completion_tokens / (r.total - r.ttft)).toFixed(1) : "?";
  console.log(`  ${label}: ctx=${pt} TTFT=${r.ttft?.toFixed(2)}s -> prefill ${pre} tok/s | decode ${dec} tok/s over ${(r.total - (r.ttft || 0)).toFixed(1)}s | finish=${r.finish} | completion=${r.usage?.completion_tokens} reasoning=${r.usage?.completion_tokens_details?.reasoning_tokens}`);
}
console.log(`\nTOOL CALLING (the gate for a verifier seat) — budget raised so reasoning cannot eat the answer:`);
const tools = [{ type: "function", function: { name: "run_command", description: "Run a shell command in the seat worktree and return stdout", parameters: { type: "object", properties: { command: { type: "string", description: "the command line to run" } }, required: ["command"] } } }];
for (const mt of [512, 2048]) {
  const r = await stream(LM, M, "Use the run_command tool to list the files in the current directory.", mt, tools);
  if (r.error) { console.log(`  max_tokens=${mt}: ERROR ${r.error}`); continue; }
  console.log(`  max_tokens=${mt}: finish=${r.finish} reasoning=${r.usage?.completion_tokens_details?.reasoning_tokens} tool_calls=${JSON.stringify(r.tools).slice(0, 200)}`);
}
console.log(`\nPRIMARY collateral check (Strata on the 3090, measured the same way):`);
for (const [label, n] of [["tiny prompt", 1], ["~3k prompt", 180]]) {
  const r = await stream("http://127.0.0.1:47831/v1", "iq3_s", filler.repeat(n) + "\nSummarize in one short sentence.", 128);
  if (r.error) { console.log(`  ${label}: ERROR ${r.error}`); continue; }
  const pt = r.usage?.prompt_tokens ?? "?";
  console.log(`  ${label}: ctx=${pt} TTFT=${r.ttft?.toFixed(2)}s -> prefill ${(pt / r.ttft).toFixed(0)} tok/s | decode ${(r.usage.completion_tokens / (r.total - r.ttft)).toFixed(1)} tok/s | finish=${r.finish}`);
}
