// Seeded-bug calibration. The ground truth is not hypothetical: these are the two REAL defects fixed in
// 3bff94a, both of which sat undetected by every seat and every check for months. The prompt gives the
// model the pre-fix source verbatim (extracted from git, not retyped) and asks what is wrong.
// Run against the PRIMARY first as a control, so the cross-family question has a baseline rather than an
// assumption: if the author family misses both and the verifier family catches them, the invariant is
// earning its keep; if both miss them, no verifier choice fixes the blind spot.
import { execFileSync } from "node:child_process";

const SNIPPETS = [
  {
    id: "A",
    file: "src/worktree.mjs",
    truth: "Spawns npm with a script PATH as npm's first positional word, so npm reports 'Unknown command: <path>' and dependency linking never runs at all (on any OS). The invocation was mis-composed: the resolver returns {cmd, prefixArgs} where prefixArgs must PRECEDE the script path.",
    code: execFileSync("git", ["show", "3bff94a^:src/worktree.mjs"], { encoding: "utf8" }).split("\n").slice(140, 200).join("\n"),
  },
  {
    id: "B",
    file: "src/job-object.mjs",
    truth: "On POSIX it checks liveness ONCE, sleeps 100 ms, checks again, and returns — the timeoutMs deadline is never polled. A process that dies 200+ ms later is reported 'still running' forever, so cleanup permanently refuses. The polling loop exists only in the Windows branch.",
    code: execFileSync("git", ["show", "3bff94a^:src/job-object.mjs"], { encoding: "utf8" }).split("\n").slice(255, 300).join("\n"),
  },
];
const KEYWORDS = {
  A: ["unknown command", "npm", "invocation", "prefix", "argv", "command", "spawn"],
  B: ["timeout", "deadline", "poll", "loop", "100", "once", "never", "wait"],
};
async function ask(baseUrl, model, code, file) {
  const body = {
    model,
    messages: [
      { role: "system", content: "You are a code reviewer. Find the defect that makes this code fail at RUNTIME on Linux. Be specific about the mechanism. If you see several, list them ranked by severity." },
      { role: "user", content: `File: ${file}\n\n\`\`\`js\n${code}\n\`\`\`\n\nWhat is wrong here? After thinking, give a concise answer: the single most severe runtime defect, its mechanism, and how it manifests. Under 150 words.` },
    ],
    temperature: 0.2,
    // max_tokens is not cosmetic: the FIRST run of this harness asked for 900 and the model spent all 900 on
    // reasoning, then returned an EMPTY answer with finish_reason=length. That is the exact failure mode that
    // makes a thinking-model verifier worse than no verifier — a confident-looking half-verdict, or none. Any
    // budget here must be large enough for reasoning PLUS the answer.
    max_tokens: Number(process.env.CAL_MAX_TOKENS || 3000),
  };
  const t0 = Date.now();
  const r = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  const dt = (Date.now() - t0) / 1000;
  const msg = d.choices?.[0]?.message ?? {};
  const u = d.usage ?? {};
  return { text: (msg.content || "").trim(), reasoning: (msg.reasoning_content || msg.reasoning || "").trim(), finish: d.choices?.[0]?.finish_reason, dt, u };
}
const [ , , baseUrl, model, label ] = process.argv;
if (!baseUrl || !model) { console.error("usage: node calibrate-verifier.mjs <baseUrl> <model> [label]"); process.exit(2); }
console.log(`\n${"=".repeat(72)}\nCALIBRATION: ${label || model} @ ${baseUrl}\nGround truth: the two defects fixed in 3bff94a. A model that cannot name the mechanism is not adding verification coverage.\n${"=".repeat(72)}`);
for (const s of SNIPPETS) {
  console.log(`\n--- snippet ${s.id} (${s.file}) ---`);
  console.log(`  TRUTH: ${s.truth}`);
  let res;
  try { res = await ask(baseUrl, model, s.code, s.file); } catch (e) { console.log("  REQUEST FAILED:", e.message); continue; }
  const hay = `${res.reasoning}\n${res.text}`.toLowerCase();
  const hits = KEYWORDS[s.id].filter((k) => hay.includes(k));
  console.log(`  ${res.dt.toFixed(1)}s  finish=${res.finish}  prompt=${res.u.prompt_tokens} completion=${res.u.completion_tokens} reasoning=${res.u.reasoning_tokens ?? (res.reasoning ? "present" : "absent")}`);
  console.log(`  keyword coverage (${hits.length}/${KEYWORDS[s.id].length}): ${hits.join(", ") || "none"}`);
  console.log(`  ANSWER:\n${res.text.split("\n").map((l) => "    " + l).join("\n")}`);
  if (res.reasoning) console.log(`  REASONING (first 600):\n    ${res.reasoning.slice(0, 600).replace(/\n/g, "\n    ")}`);
}
console.log(`\nVerdict is the READER'S, not this script's: keyword coverage is a hint, the answer text is the evidence.`);
