// Pass 2. Same rule as pass 1: every number is fetched in this run from HuggingFace, and a repo that
// publishes no benchmark row is reported as UNVERIFIED rather than guessed at.
// KV math corrected: full-attention layers cost bytes PER TOKEN; a sliding-window cache is a FIXED
// bound (window * slots), not per-token — pass 1 added it per-token and printed absurd numbers.
const A4000 = 16376 * 1024 * 1024; // measured ceiling of the card the verifier can go on
const SEARCHES = ["Devstral-Small-2 GGUF", "Mistral-Small-3.2-24B GGUF", "granite-4.0 gguf", "Ministral-3-8B GGUF", "Command R gguf"];
const FIXED = [
  ["lmstudio-community/Ministral-3-14B-Reasoning-2512-GGUF", "mistralai/Ministral-3-14B-Reasoning-2512"],
  ["lmstudio-community/phi-4-GGUF", "microsoft/phi-4"],
  ["lmstudio-community/gpt-oss-20b-GGUF", "openai/gpt-oss-20b"],
];
const get = async (u, raw = false) => { try { const r = await fetch(u, { headers: { "User-Agent": "durian-pi-verifier-survey" } }); return r.ok ? (raw ? await r.text() : await r.json()) : null; } catch { return null; } };
function kv(c) {
  const t = c.text_config || c;
  const L = t.num_hidden_layers, kvh = t.num_key_value_heads ?? t.num_attention_heads;
  const hd = t.head_dim ?? (t.hidden_size && t.num_attention_heads ? t.hidden_size / t.num_attention_heads : null);
  if (!L || !kvh || !hd) return null;
  const types = Array.isArray(t.layer_types) ? t.layer_types : null;
  const full = types ? types.filter((x) => x === "full_attention").length : L;
  const perTok = full * kvh * hd * 2 * 2;                       // fp16 K+V, full-attention layers only
  const fixed = types && t.sliding_window ? (L - full) * t.sliding_window * kvh * hd * 2 * 2 : 0; // bounded caches
  return { perTokMB: perTok / 1048576, fixedMB: fixed / 1048576, L, full, kvh, hd, ctx: t.max_position_embeddings, win: t.sliding_window || null };
}
function evalRows(md) {
  // A markdown table row counts as evidence when the header names a benchmark AND the row holds numbers.
  const lines = md.split("\n"); const out = []; const BENCH = /(SWE-?bench|LiveCodeBench|BFCL|tau-?bench|HumanEval|MBPP|BigCodeBench|FullCodeBench|MMLU|MATH|GPQA|AIME|EvalPlus|function.?calling|tool.?call)/i;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !BENCH.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(i + 14, lines.length); j++) {
      const l = lines[j].trim();
      if (!l.startsWith("|")) break;
      if (/^[\s|:-]+$/.test(l)) continue;
      const cells = l.split("|").map((s) => s.trim()).filter(Boolean);
      if (cells.some((c) => /^\**\d+(\.\d+)?\**$/.test(c))) out.push(cells.slice(0, 10).join(" | "));
    }
  }
  return out;
}
async function report(gguf, base) {
  console.log(`\n${"=".repeat(76)}\nGGUF ${gguf}`);
  const tree = await get(`https://huggingface.co/api/models/${gguf}/tree/main?recursive=true`);
  if (!Array.isArray(tree)) { console.log("  repo NOT FOUND"); return; }
  for (const f of tree.filter((x) => x.path.endsWith(".gguf") && !x.path.startsWith("mmproj")).sort((a, b) => a.size - b.size).slice(0, 8)) {
    const gb = f.size / 1e9;
    console.log(`  ${gb.toFixed(2).padStart(5)} GB  ${gb * 1e9 <= A4000 ? "under card" : "over card"}`);
  }
  const raw = await get(`https://huggingface.co/${base}/raw/main/config.json`, true);
  if (raw) try {
    const c = JSON.parse(raw); const k = kv(c); const t = c.text_config || c;
    console.log(`  arch=${(c.architectures || []).join(",")} type=${c.model_type || t.model_type} vocab=${t.vocab_size} layers=${k?.L}${k?.full !== k?.L ? ` (full-attn ${k.full})` : ""} kv_heads=${k?.kvh ?? k?.kv} head_dim=${k?.hd} ctx=${k?.ctx}${k?.win ? ` slide=${k.win}` : ""}`);
    if (k) console.log(`  KV fp16: ${(k.perTokMB * 1048576).toFixed(0)} B/token -> 8k=${(k.perTokMB * 8 * 1.048576).toFixed(2)}GB 16k=${(k.perTokMB * 16 * 1.048576).toFixed(2)}GB 32k=${(k.perTokMB * 32 * 1.048576).toFixed(2)}GB 64k=${(k.perTokMB * 64 * 1.048576).toFixed(2)}GB${k.fixedMB ? ` + fixed sliding ${k.fixedMB.toFixed(2)}GB` : ""}`);
    const moe = JSON.stringify(c).match(/"(num_local_experts|num_experts_per_tok)":\s*(\d+)/g);
    console.log(`  MoE: ${moe ? moe.join(" ") : "dense (no expert layers exist to park in RAM)"}`);
  } catch { console.log("  config parse failed"); } else console.log("  config gated/unreachable (Google-style license) -> architecture UNVERIFIED");
  const rd = await get(`https://huggingface.co/${base}/raw/main/README.md`, true);
  const rows = rd ? evalRows(rd) : [];
  console.log(`  CARD EVIDENCE (${rows.length} numeric benchmark rows):`);
  for (const r of rows.slice(0, 6)) console.log(`    ${r.slice(0, 200)}`);
  if (!rows.length) console.log("    NONE -> capability UNVERIFIED by the vendor (the Flint situation)");
}
for (const s of SEARCHES) {
  const r = await get(`https://huggingface.co/api/models?search=${encodeURIComponent(s)}&limit=6&sort=downloads&direction=-1`);
  console.log(`\n--- search "${s}" ---`);
  if (r) for (const m of r) console.log(`  ${m.modelId}`);
}
for (const [g, b] of FIXED) await report(g, b);
await report("mistralai/Devstral-Small-2-24B-Instruct-2507-GGUF", "mistralai/Devstral-Small-2-24B-Instruct-2507");
await report("mistralai/Mistral-Small-3.2-24B-Instruct-2505-GGUF", "mistralai/Mistral-Small-3.2-24B-Instruct-2505");
