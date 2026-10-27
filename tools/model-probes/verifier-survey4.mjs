// Pass 4. Fixes pass 3's bug (the search fetch defaulted to raw text, so every modelId was undefined).
// Goal: (1) the vendor's full comparison table for Ministral 3 14B including the Qwen rows, since the
// rig's primary IS a Qwen-family model and a same-table head-to-head is the only cross-family evidence
// available without running it ourselves; (2) Devstral's real GGUF repos and its agentic/code numbers.
const get = async (u, raw = false) => { try { const r = await fetch(u, { headers: { "User-Agent": "durian-pi-verifier-survey" } }); return r.ok ? (raw ? await r.text() : await r.json()) : null; } catch { return null; } };
const md = await get("https://huggingface.co/mistralai/Ministral-3-14B-Reasoning-2512/raw/main/README.md", true);
const lines = md.split("\n");
console.log("=== Ministral 3 14B Reasoning card: every benchmark table, all rows ===");
for (let i = 0; i < lines.length; i++) {
  if (!/^\s*\|/.test(lines[i]) || /^\s*\|[\s|:-]+\|\s*$/.test(lines[i])) continue;
  if (!/(AIME|GPQA|LiveCodeBench|Arena Hard|MMLU|MTBench|WildBench)/i.test(lines[i])) continue;
  const block = [lines[i]];
  for (let j = i + 1; j < lines.length && lines[j].trim().startsWith("|"); j++) block.push(lines[j]);
  console.log(`\n  [line ${i + 1}] ` + block[0].replace(/\|/g, " ").replace(/\s+/g, " ").trim());
  for (const l of block.slice(1)) if (!/^[\s|:-]+$/.test(l)) console.log("     " + l.replace(/\|/g, " ").replace(/\s+/g, " ").replace(/<\/?u>/g, "").trim());
  i += block.length;
}
for (const q of ["Devstral GGUF", "Devstral-Small-2-24B"]) {
  const r = await get(`https://huggingface.co/api/models?search=${encodeURIComponent(q)}&limit=8&sort=downloads&direction=-1`);
  console.log(`\nsearch "${q}":`); if (Array.isArray(r)) for (const m of r) console.log("  " + m.modelId); else console.log("  (no json)", r);
}
for (const g of ["unsloth/Devstral-Small-2-24B-Instruct-2507-GGUF", "lmstudio-community/Devstral-Small-2-24B-Instruct-2507-GGUF", "bartowski/mistralai_Devstral-Small-2-24B-Instruct-2507-GGUF", "mistralai/Devstral-Small-2-24B-Instruct-2507-GGUF"]) {
  const t = await get(`https://huggingface.co/api/models/${g}/tree/main?recursive=true`);
  console.log(`\n${g}`);
  if (!Array.isArray(t)) { console.log("  NOT FOUND"); continue; }
  for (const f of t.filter((x) => x.path.endsWith(".gguf") && !x.path.startsWith("mmproj")).sort((a, b) => a.size - b.size)) {
    const gb = f.size / 1e9; if (gb > 17.5) continue;
    console.log(`  ${gb.toFixed(2)} GB  ${gb * 1e9 <= 16376 * 1024 * 1024 ? "under card" : "OVER"}  ${f.path.split("/").pop()}`);
  }
}
const dev = await get("https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2507/raw/main/README.md", true);
if (dev) {
  const rows = dev.split("\n").filter((l) => /^\s*\|/.test(l) && /(SWE-?bench|LiveCodeBench|Terminal-Bench|BFCL|ToolBench|Agentic)/i.test(l));
  console.log(`\n=== Devstral-Small-2 card, benchmark-bearing rows (${rows.length}) ===`);
  for (const r of rows.slice(0, 12)) console.log("  " + r.replace(/\|/g, " ").replace(/\s+/g, " ").replace(/<\/?u>|<\/?b>|\*\*/g, "").trim().slice(0, 200));
  const cfg = await get("https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2507/raw/main/config.json", true);
  if (cfg) { const c = JSON.parse(cfg); const t = c.text_config || c;
    const layers = t.num_hidden_layers, kvh = t.num_key_value_heads ?? t.num_attention_heads, hd = t.head_dim ?? (t.hidden_size / t.num_attention_heads);
    console.log(`  arch=${(c.architectures || []).join(",")} vocab=${t.vocab_size} layers=${layers} kv_heads=${kvh} head_dim=${hd} ctx=${t.max_position_embeddings} slide=${t.sliding_window ?? "none"}` +
      ` | KV fp16 ${(layers * kvh * hd * 4).toLocaleString()} B/tok -> 16k=${((layers * kvh * hd * 4 * 16384) / 1e9).toFixed(2)}GB 32k=${((layers * kvh * hd * 4 * 32768) / 1e9).toFixed(2)}GB`);
    console.log(`  MoE in config: ${JSON.stringify(c).match(/"(num_local_experts|num_experts_per_tok)":\s*\d+/g)?.join(" ") || "dense"}`); }
}
