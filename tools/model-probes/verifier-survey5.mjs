// Pass 5 — Devstral Small 2 (2512 is the live repo; the 2507 GGUF repos are gone). Same evidence rule:
// sizes from the tree API, architecture from config.json, benchmarks quoted from the vendor README.
const get = async (u, raw = false) => { try { const r = await fetch(u, { headers: { "User-Agent": "durian-pi-verifier-survey" } }); return r.ok ? (raw ? await r.text() : await r.json()) : null; } catch { return null; } };
const CARD = 16376 * 1024 * 1024;
for (const g of ["lmstudio-community/Devstral-Small-2-24B-Instruct-2512-GGUF", "unsloth/Devstral-Small-2-24B-Instruct-2512-GGUF", "ggml-org/Devstral-Small-2-24B-Instruct-2512-GGUF", "lmstudio-community/Ministral-3-8B-Reasoning-2512-GGUF", "unsloth/Ministral-3-8B-Reasoning-2512-GGUF"]) {
  const t = await get(`https://huggingface.co/api/models/${g}/tree/main?recursive=true`);
  console.log(`\n${g}`);
  if (!Array.isArray(t)) { console.log("  NOT FOUND"); continue; }
  const f = t.filter((x) => x.path.endsWith(".gguf") && !x.path.startsWith("mmproj")).sort((a, b) => a.size - b.size);
  for (const x of f) { const gb = x.size / 1e9; if (gb > 18) continue; console.log(`  ${gb.toFixed(2)} GB ${gb * 1e9 <= CARD ? "under card" : "OVER"}  ${x.path.split("/").pop()}`); }
}
for (const base of ["mistralai/Devstral-Small-2-24B-Instruct-2512", "mistralai/Ministral-3-8B-Reasoning-2512"]) {
  const cfg = await get(`https://huggingface.co/${base}/raw/main/config.json`, true);
  console.log(`\n=== ${base} ===`);
  if (cfg) try {
    const c = JSON.parse(cfg), t = c.text_config || c;
    const L = t.num_hidden_layers, kvh = t.num_key_value_heads ?? t.num_attention_heads, hd = t.head_dim ?? (t.hidden_size / t.num_attention_heads);
    const types = Array.isArray(t.layer_types) ? t.layer_types : null, full = types ? types.filter((x) => x === "full_attention").length : L;
    const perTok = full * kvh * hd * 4;
    console.log(`  arch=${(c.architectures || []).join(",")} type=${c.model_type || t.model_type} vocab=${t.vocab_size} layers=${L} (full ${full}) kv_heads=${kvh} head_dim=${hd} ctx=${t.max_position_embeddings} slide=${t.sliding_window ?? "none"}`);
    console.log(`  KV fp16 ${perTok.toLocaleString()} B/tok -> 8k=${(perTok * 8192 / 1e9).toFixed(2)} 16k=${(perTok * 16384 / 1e9).toFixed(2)} 32k=${(perTok * 32768 / 1e9).toFixed(2)} 64k=${(perTok * 65536 / 1e9).toFixed(2)} GB`);
    console.log(`  MoE: ${JSON.stringify(c).match(/"(num_local_experts|num_experts_per_tok)":\s*\d+/g)?.join(" ") || "dense (no experts to park in RAM)"}`);
  } catch { console.log("  config parse failed"); } else console.log("  config unreachable");
  const md = await get(`https://huggingface.co/${base}/raw/main/README.md`, true);
  if (!md) { console.log("  README unreachable"); continue; }
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || /^\s*\|[\s|:-]+\|\s*$/.test(lines[i])) continue;
    if (!/(SWE-?bench|LiveCodeBench|Terminal-Bench|BFCL|Agentic|SWE-Bench|Tool)/i.test(lines[i])) continue;
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length && lines[j].trim().startsWith("|"); j++) block.push(lines[j]);
    console.log(`  [line ${i + 1}] ` + block[0].replace(/\|/g, " ").replace(/\s+/g, " ").trim().slice(0, 190));
    for (const l of block.slice(1)) if (!/^[\s|:-]+$/.test(l)) console.log("     " + l.replace(/\|/g, " ").replace(/\s+/g, " ").replace(/<\/?[bu]>|\*\*/g, "").trim().slice(0, 190));
    i += block.length;
  }
  const tools = [...new Set(lines.filter((l) => /(tool|function).{0,12}(call|use|calling)|tool-call-parser/i.test(l)).map((l) => l.replace(/\s+/g, " ").trim()))];
  console.log(`  TOOL-CALLING DOCS (${tools.length}):`); for (const t of tools.slice(0, 3)) console.log(`    - ${t.slice(0, 170)}`);
}
