// The OpenRig converter is how a migration happens, and until now it had no
// test at all. The committed `test-fixture-rig.yaml` was worse than useless: it
// was written in an older flat `agents:` format the converter never read, so
// running it crashed with a bare TypeError while three documents - including
// ACCEPTANCE.md UAR-5, marked PASS - cited it as the proof.
//
// The regression this locks down is D26: cross-pod relationships live in
// OpenRig's RIG-LEVEL `edges:` list, which the converter ignored entirely. Every
// `escalates_to` / `collaborates_with` / `can_observe` between pods vanished, so
// sec/dev/ux ended up with no outgoing edge at all.
// Run: node demo/converter.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "durig-converter-"));
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function write(rel, content) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const AGENT = (name, desc, delegatesTo = []) => `name: ${name}
version: "2.0"
description: "${desc}"

defaults:
  runtime: pi

imports:
  - ref: local:../shared

profiles:
  default:
    uses:
      skills: [shared:grounding]
      guidance: []
      subagents: []

resources:
  guidance:
    - id: role
      path: guidance/role.md

startup:
  files:
    - path: guidance/role.md
      delivery_hint: send_text
      required: true
  actions: []
${
  delegatesTo.length
    ? `delegates_to:\n${delegatesTo.map((d) => `  - ${d}`).join("\n")}\n`
    : ""
}`;

const POD = (id, label, summary, member, agentDir) => `  - id: ${id}
    label: ${label}
    summary: ${summary}
    startup:
      files:
        - path: guidance/pod-a.md
          delivery_hint: send_text
          required: true
      actions: []
    members:
      - id: ${member}
        agent_ref: "local:./agents/${agentDir}"
        runtime: pi
        profile: default
        cwd: "../../.."
    edges: []
`;

// A rig in the shape the converter actually reads: pods[].members[].agent_ref.
const RIG = `version: "0.2"
name: fixture
summary: A converter fixture.

culture_file: CULTURE.md

startup:
  files:
    - path: guidance/team-norms.md
      delivery_hint: guidance_merge
      required: true
  actions: []

pods:
${POD("alpha-pod", "Alpha", "The alpha pod.", "alpha", "alpha")}${POD("beta-pod", "Beta", "The beta pod.", "beta", "beta")}
edges:
  - kind: escalates_to
    from: alpha-pod.alpha
    to: beta-pod.beta
  - kind: can_observe
    from: beta-pod.beta
    to: alpha-pod.alpha
  - kind: delegates_to
    from: wrong-pod.alpha
    to: beta-pod.beta
`;

const run = (yamlPath) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/from-openrig.mjs", yamlPath], {
      cwd: durigDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });

try {
  write("CULTURE.md", "# Fixture culture\n\nGround every claim.\n");
  write("guidance/team-norms.md", "# Team norms\n\nOne concern per change.\n");
  write("guidance/pod-a.md", "# Pod SOP — Alpha\n\nRead the actual work.\n");
  write("agents/shared/skills/grounding/SKILL.md", "---\nname: grounding\n---\n# Grounding\n\nRetrieve first.\n");
  write("agents/alpha/agent.yaml", AGENT("fixture-alpha", "Seat role: Alpha", []));
  write("agents/alpha/guidance/role.md", "You are Alpha.\n");
  // delegates_to is the other edge source, and it points at a seat that a
  // rig-level edge already covers, so it also exercises the dedupe.
  write("agents/beta/agent.yaml", AGENT("fixture-beta", "Seat role: Beta", ["alpha"]));
  write("agents/beta/guidance/role.md", "You are Beta.\n");
  write("rig.yaml", RIG);

  const res = await run(join(dir, "rig.yaml"));
  assert.equal(res.code, 0, `converter failed: ${res.stderr.slice(0, 300)}`);
  const spec = JSON.parse(res.stdout);

  // 1. Seats come from pod members, keyed by bare member id.
  assert.deepEqual(
    spec.seats.map((s) => s.name).sort(),
    ["alpha", "beta"],
    "one seat per pod member",
  );

  // 2. THE regression: a rig-level edge between two pods reaches the spec, with
  //    its pod-qualified id resolved to the bare seat name.
  const alpha = spec.edges.find((e) => e.from === "alpha");
  assert.ok(alpha, "alpha has an outgoing edge at all");
  assert.ok(alpha.maySendTo.includes("beta"), "rig-level escalates_to landed as a send permission");

  // 3. Both directions, the same way - this is what sec/dev/ux lost (D26).
  const beta = spec.edges.find((e) => e.from === "beta");
  assert.ok(beta?.maySendTo.includes("alpha"), "the reverse rig-level edge landed too");

  // 4. A mis-prefixed id is a warning, never a silent drop and never a wrong
  //    seat: `wrong-pod.alpha` must not resolve to bare `alpha`.
  assert.match(res.stderr, /wrong-pod\.alpha -> beta-pod\.beta: unknown seat, dropped/, "bad prefix is reported");
  assert.equal(spec.edges.length, 2, "the mis-prefixed edge added no group");
  assert.ok(!spec.edges.some((e) => e.from === "wrong-pod"), "no phantom seat came from the bad prefix");

  // 5. Persona assembly still works: role, pod guidance, rig norms, skill
  //    content, capabilities, and the culture as an inline constitution.
  assert.equal(spec.seats.find((s) => s.name === "alpha").role, "Seat role: Alpha");
  const instr = spec.seats.find((s) => s.name === "alpha").instructions;
  assert.match(instr, /# Role\nYou are Alpha\./, "the seat's role.md persona is inlined");
  assert.match(instr, /Pod SOP — Alpha/, "pod guidance is inlined");
  assert.match(instr, /One concern per change/, "rig norms are inlined");
  assert.match(instr, /Retrieve first/, "skill content is inlined");
  assert.deepEqual(spec.seats.find((s) => s.name === "alpha").capabilities, ["grounding"]);
  assert.equal(spec.constitutionInline, "# Fixture culture\n\nGround every claim.\n");

  // 6. The old flat format fails with a sentence naming the expected shape,
  //    not a TypeError from iterating a map.
  write("flat.yaml", "pods:\n  build:\n    - impl\nagents:\n  - name: impl\n    role: builder\n");
  const flat = await run(join(dir, "flat.yaml"));
  assert.equal(flat.code, 2, "the old format is refused");
  assert.match(flat.stderr, /no pods\[\] array/, "the refusal names what is wrong");
  assert.match(flat.stderr, /older flat agents\[\] format/, "the refusal names the format it got");
  assert.ok(!/TypeError/.test(flat.stderr), "no bare stack trace");

  console.log("CONVERTER TEST PASS (rig-level edges, id normalisation, bad prefix, persona assembly, old format)");
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
}

// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
