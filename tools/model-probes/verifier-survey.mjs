// Read-only survey of candidate verifier models. Every number printed here was fetched from
// HuggingFace in this run: GGUF file sizes from the repo's tree API, architecture from the base
// model's config.json, and benchmark claims from the base model's own README (quoted, not paraphrased).
// Nothing is asserted from memory; a repo with no eval table prints NONE so the gap is visible.
const CANDIDATES = [
  // [gguf repo (what LM Studio installs), base repo (config + README live here)]
  ["lmstudio-community/Ministral-3-14B-Reasoning-2512-GGUF", "mistralai/Ministral-3-14B-Reasoning-2512"],
  ["lmstudio-community/Ministral-3-14B-Instruct-2512-GGUF", "mistralai/Ministral-3-14B-Instruct-2512"],
  ["lmstudio-community/Devstral-Small-2-24B-Instruct-2507-GGUF", "mistralai/Devstral-Small-2-24B-Instruct-2507"],
  ["lmstudio-community/Mistral-Small-3.2-24B-Instruct-2505-GGUF", "mistralai/Mistral-Small-3.2-24B-Instruct-2505"],
  ["lmstudio-community/gpt-oss-20b-GGUF", "openai/gpt-oss-20b"],
  ["lmstudio-community/gpt-oss-120b-GGUF", "openai/gpt-oss-120b"],
  ["lmstudio-community/gemma-3-12b-it-qat-GGUF", "google/gemma-3-12b-it"],
  ["lmstudio-community/phi-4-GGUF", "microsoft/phi-4"],
  ["lmstudio-community/Granite-4.0-tiny-Instruct-GGUF", "ibm-granite/granite-4.0-tiny-preview"],
  ["unsloth/Devstral-Small-2-24B-Instruct-2507-GGUF", "mistralai/Devstral-Small-2-24B-Instruct-2507"],
];
const CARDS = new Set();
const get = async (url, raw = false) => {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "durian-pi-verifier-survey" } });
    if (!r.ok) return null;
    return raw ? await r.text() : await r.json();
  } catch { return null; }
};
const fmt = (b) => (b / 1e9).toFixed(2);
// KV cost per token, computed from the model's OWN config: elements = kv_heads * head_dim * 2 * layers.
// head_dim falls back to hidden_size / num_attention_heads when not declared.
const kvMath = (c) => {
  const t = c.text_config || c;
  const layers = t.num_hidden_layers, kv = t.num_key_value_heads ?? t.num_attention_heads;
  const hd = t.head_dim ?? (t.hidden_size && t.num_attention_heads ? t.hidden_size / t.num_attention_heads : null);
  if (!layers || !kv || !hd) return null;
  const bytesPerTok = layers * kv * hd * 2 * 2; // fp16 K and V
  const win = t.sliding_window || null;
  const types = Array.isArray(t.layer_types) ? t.layer_types : null;
  const full = types ? types.filter((x) => x === "full_attention").length : layers;
  const fullBytes = full * kv * hd * 2 * 2;
  const winBytes = win ? (layers - full) * win * kv * hd * 2 * 1 : 0; // sliding cache is 1 elem/token/slot
  return { bytesPerTok: bytesPerTok + winBytes, layers, kv, hd, ctx: t.max_position_embeddings, win, full };
};
const EVAL_RE = /(SWE-?bench|LiveCodeBench|BFCL|tau-?bench|function.?calling|tool.?calling|Aider|HumanEval|MBPP|BigCodeBench|FullCodeBench|MMLU|EvalPlus)/i;
for (const [gguf, base] of CANDIDATES) {
  console.log(`\n${"=".repeat(78)}\nGGUF: ${gguf}\nBASE: ${base}`);
  const tree = await get(`https://huggingface.co/api/models/${gguf}/tree/main?recursive=true`);
  if (!tree || !Array.isArray(tree)) { console.log("  GGUF repo NOT FOUND (skip)"); continue; }
  const files = tree.filter((x) => x.path.endsWith(".gguf") && !x.path.startsWith("mmproj")).sort((a, b) => a.size - b.size);
  for (const f of files.slice(0, 10)) {
    const gb = f.size / 1e9;
    // The card we can put a SECOND model on is the A4000: 16,376 MiB total. With the primary now on the
    // 3090 only, ~15.6 GiB is free. Print the fit against that, since that is the whole decision.
    const tag = gb <= 11.5 ? "FITS w/ KV room" : gb <= 14.0 ? "fits only small ctx" : gb <= 16.0 ? "TIGHT/offload" : "over card";
    console.log(`  ${fmt(f.size).padStart(6)} GB  ${tag.padEnd(18)} ${f.path.split("/").pop()}`);
  }
  if (!CARDS.has(base)) {
    const raw = await get(`https://huggingface.co/${base}/raw/main/config.json`, true);
    if (raw) {
      try {
        const c = JSON.parse(raw);
        const k = kvMath(c);
        console.log(`  arch=${(c.architectures || []).join(",")} type=${c.model_type || (c.text_config || {}).model_type}` +
          ` vocab=${(c.text_config || c).vocab_size}` +
          (k ? ` layers=${k.layers} kv_heads=${k.kv} head_dim=${k.hd} ctx=${k.ctx}${k.win ? ` slide=${k.win}` : ""}` +
            ` | KV fp16 ${fmt(k.bytesPerTok)} B/tok -> 16k=${(k.bytesPerTok * 16384 / 1e9).toFixed(2)}GB 32k=${(k.bytesPerTok * 32768 / 1e9).toFixed(2)}GB 64k=${(k.bytesPerTok * 65536 / 1e9).toFixed(2)}GB` : " KV=?"));
        const moe = JSON.stringify(c).match(/"(num_local_experts|num_experts|routed_expert[a-z_]*|num_experts_per_tok)"/g);
        console.log(`  MoE: ${moe ? [...new Set(moe)].join(" ") : "NONE in config (dense -> per-token every layer runs)"}`);
      } catch { console.log("  config parse failed"); }
    } else console.log("  config.json not reachable");
    const rd = await get(`https://huggingface.co/${base}/raw/main/README.md`, true);
    if (rd) {
      const hits = rd.split("\n").filter((l) => EVAL_RE.test(l) && /\d/.test(l)).map((l) => l.replace(/\|/g, " ").replace(/\s+/g, " ").trim());
      console.log(`  CARD EVIDENCE (${hits.length} lines with a benchmark number):`);
      for (const h of hits.slice(0, 8)) console.log(`    - ${h.slice(0, 220)}`);
      if (!hits.length) console.log("    NONE — the card publishes no benchmark line. Capability UNVERIFIED (the Flint situation).");
    } else console.log("  README not reachable");
    CARDS.add(base);
  }
}
console.log(`\nCard ceiling for reference: A4000 = 16,376 MiB total (measured 89 MiB free while Flint Q6_K is loaded).`);
