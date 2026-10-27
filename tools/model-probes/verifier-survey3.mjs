// Pass 3 — pull the vendor's OWN numbers for the shortlist, with their table headers, plus any
// documented tool/function-calling support. Quoted rows only; no paraphrased scores.
const TARGETS = [
  ["mistralai/Ministral-3-14B-Reasoning-2512", "Ministral 3 14B"],
  ["mistralai/Ministral-3-14B-Instruct-2512", "Ministral 3 14B"],
  ["openai/gpt-oss-20b", "gpt-oss-20b"],
  ["microsoft/phi-4", "phi-4"],
];
const TOOLRE = /(tool|function).{0,12}(call|use|calling)|tool_calling|native tool/i;
const get = async (u, raw = true) => { try { const r = await fetch(u, { headers: { "User-Agent": "durian-pi-verifier-survey" } }); return r.ok ? (raw ? await r.text() : await r.json()) : null; } catch { return null; } };
for (const [repo, want] of TARGETS) {
  const md = await get(`https://huggingface.co/${repo}/raw/main/README.md`);
  console.log(`\n${"=".repeat(74)}\n${repo}`);
  if (!md) { console.log("  README unreachable"); continue; }
  const lines = md.split("\n");
  // print each table whose header mentions a benchmark, if any row names the target model
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || lines[i].includes("---")) continue;
    const hdr = lines[i];
    const block = [hdr];
    for (let j = i + 1; j < lines.length && lines[j].trim().startsWith("|"); j++) block.push(lines[j]);
    if (!block.some((l) => new RegExp(want, "i").test(l))) continue;
    if (!/(AIME|GPQA|LiveCodeBench|MMLU|MATH|HumanEval|SWE|DROP|SimpleQA|MMMU|IFBench|MT-Bench|Arena)/i.test(hdr)) continue;
    console.log(`  TABLE @line ${i + 1}: ${hdr.replace(/\|/g, " ").replace(/\s+/g, " ").trim().slice(0, 190)}`);
    for (const l of block) if (new RegExp(want, "i").test(l)) console.log(`    ROW ${l.replace(/\|/g, " ").replace(/\s+/g, " ").trim().slice(0, 190)}`);
    i += block.length;
  }
  const tools = lines.filter((l) => TOOLRE.test(l)).map((l) => l.replace(/\s+/g, " ").trim());
  console.log(`  TOOL/FUNCTION-CALLING MENTIONS (${tools.length}):`);
  for (const t of [...new Set(tools)].slice(0, 4)) console.log(`    - ${t.slice(0, 190)}`);
  if (!tools.length) console.log("    NONE documented on the card");
}
// Devstral is the code/agent-specialised Mistral family member; find its real GGUF repos.
for (const q of ["Devstral GGUF", "Devstral-Small-2"]) {
  const r = await get(`https://huggingface.co/api/models?search=${encodeURIComponent(q)}&limit=8&sort=downloads&direction=-1`);
  console.log(`\nsearch "${q}":`); if (r) for (const m of r) console.log(`  ${m.modelId}`);
}
for (const g of ["unsloth/Devstral-Small-2-24B-Instruct-2507-GGUF", "lmstudio-community/Devstral-Small-2-24B-Instruct-2507-GGUF", "bartowski/mistralai_Devstral-Small-2-24B-Instruct-2507-GGUF"]) {
  const t = await get(`https://huggingface.co/api/models/${g}/tree/main?recursive=true`, false);
  console.log(`\n${g}`);
  if (!Array.isArray(t)) { console.log("  NOT FOUND"); continue; }
  for (const f of t.filter((x) => x.path.endsWith(".gguf") && !x.path.startsWith("mmproj")).sort((a, b) => a.size - b.size)) {
    const gb = f.size / 1e9; if (gb > 17) continue;
    console.log(`  ${gb.toFixed(2)} GB  ${gb * 1e9 <= 16376 * 1024 * 1024 ? "under card" : "over"}  ${f.path.split("/").pop()}`);
  }
}
