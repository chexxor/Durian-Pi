// from-openrig.mjs - convert an OpenRig rig.yaml into a durig rig v2 spec.
//
// Handles the REAL OpenRig topology (tutor-pi shape), not a flat agents[]:
//   pods[].members[].agent_ref (local:./agents/X) -> seats[]
//   agents/X/agent.yaml description              -> seats[].role
//   profiles.default.uses.skills [shared:S]      -> seats[].skills (names)
//                                                   + SKILL.md content inlined
//                                                   into instructions
//   pods[].startup.files guidance/pod-X.md       -> inlined into member
//                                                   instructions (pod context)
//   rig startup.files guidance/team-norms.md     -> inlined into EVERY seat
//                                                   (rig-layer delivery)
//   culture_file                                 -> constitution text inlined
//   delegates_to / pod edges                     -> send-permission edges;
//                                                   absent = open comms
//
// Skill and guidance CONTENT is inlined because durig has no separate skill
// loader yet; the optimizer (DURIG_OPTIMIZE=on at `up`) compresses the
// combined prompt. Total volume is bounded (~500 lines across all files).
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { load } from "js-yaml";

const [, , inputPath, outArg] = process.argv;
if (!inputPath) {
  console.error("usage: node scripts/from-openrig.mjs <rig.yaml> [out.json]");
  process.exit(2);
}

const rigDir = dirname(resolve(inputPath));
const doc = load(await readFile(inputPath, "utf8"));

const seats = [];
const edges = [];
const warnings = [];

const rigGuidance = [];
for (const f of doc.startup?.files ?? []) {
  if (f.delivery_hint === "guidance_merge") {
    rigGuidance.push(await readFile(join(rigDir, f.path), "utf8"));
  } else {
    warnings.push(`rig startup file ${f.path} (${f.delivery_hint}) dropped: no durig equivalent`);
  }
}

for (const pod of doc.pods ?? []) {
  const podGuidance = [];
  for (const f of pod.startup?.files ?? []) {
    if (f.delivery_hint === "send_text" || f.delivery_hint === "guidance_merge") {
      podGuidance.push(await readFile(join(rigDir, f.path), "utf8"));
    } else {
      warnings.push(`pod ${pod.id} file ${f.path} (${f.delivery_hint}) dropped`);
    }
  }

  for (const member of pod.members ?? []) {
    const ref = String(member.agent_ref ?? "");
    const m = ref.match(/^local:\.\/agents\/(.+)$/);
    if (!m) {
      warnings.push(`pod ${pod.id} member ${member.id}: unhandled agent_ref "${ref}"`);
      continue;
    }
    const agentDir = join(rigDir, "agents", m[1]);
    const agent = load(await readFile(join(agentDir, "agent.yaml"), "utf8"));

    // Skills: names go to capabilities; CONTENT is inlined so the seat can
    // actually follow the procedure without a loader durig does not have.
    const skillNames = [];
    const skillBlocks = [];
    for (const use of agent.profiles?.default?.uses?.skills ?? []) {
      const sm = String(use).match(/^shared:(.+)$/);
      if (!sm) {
        warnings.push(`${member.id}: unhandled skill ref "${use}"`);
        continue;
      }
      const skillDir = join(rigDir, "agents", "shared", "skills", sm[1]);
      let content;
      try {
        content = await readFile(join(skillDir, "SKILL.md"), "utf8");
      } catch (err) {
        warnings.push(`${member.id}: skill ${sm[1]} unreadable: ${err?.message ?? err}`);
        continue;
      }
      skillNames.push(sm[1]);
      skillBlocks.push(`## Skill: ${sm[1]}\n${content}`);
    }

    const instructionParts = [];
    if (podGuidance.length > 0) {
      instructionParts.push(`# Pod context (${pod.id}: ${pod.label})\n${pod.summary ?? ""}\n${podGuidance.join("\n")}`);
    }
    if (rigGuidance.length > 0) {
      instructionParts.push(`# Team norms\n${rigGuidance.join("\n")}`);
    }
    if (skillBlocks.length > 0) {
      instructionParts.push(skillBlocks.join("\n"));
    }

    const seat = {
      name: member.id,
      role: agent.description ?? member.id,
      // The pod summary is the closest OpenRig analogue to a goal.
      goal: pod.summary ?? undefined,
      capabilities: skillNames.length > 0 ? skillNames : undefined,
      instructions: instructionParts.length > 0 ? instructionParts.join("\n\n") : undefined,
    };
    seats.push(seat);

    for (const target of agent.delegates_to ?? []) {
      const to = typeof target === "string" ? target : target?.name;
      if (!to) continue;
      const existing = edges.find((e) => e.from === member.id);
      if (existing) existing.to.push(to);
      else edges.push({ from: member.id, to: [to] });
    }
  }

  for (const e of pod.edges ?? []) {
    const from = typeof e === "string" ? e : e?.from;
    const to = typeof e === "string" ? null : e?.to;
    if (!from || !to) continue;
    const existing = edges.find((x) => x.from === from);
    if (existing && !existing.to.includes(to)) existing.to.push(to);
    else if (!existing) edges.push({ from, to: [to] });
  }
}

// OpenRig expresses the PM's routing authority implicitly (intake +
// decomposition), but durig edges are explicit and restrictive-by-default.
// Grant coordinator seats (pm, lead) send permission to every other seat so
// a migrated org can actually route work.
for (const coord of ["pm", "lead"]) {
  if (!seats.some((s) => s.name === coord)) continue;
  const targets = seats.map((s) => s.name).filter((n) => n !== coord);
  const existing = edges.find((e) => e.from === coord);
  if (existing) {
    for (const t of targets) if (!existing.to.includes(t)) existing.to.push(t);
  } else {
    edges.push({ from: coord, to: targets });
  }
}

let constitution;
if (doc.culture_file) {
  constitution = await readFile(join(rigDir, doc.culture_file), "utf8");
}

const result = { version: 2, seats };
if (edges.length > 0) result.edges = edges.map((e) => ({ from: e.from, maySendTo: e.to }));
if (constitution !== undefined) result.constitutionInline = constitution;

if (outArg) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outArg, JSON.stringify(result, null, 2), "utf8");
  for (const w of warnings) console.error(`WARNING: ${w}`);
  console.log(`wrote ${outArg}: ${seats.length} seats, ${edges.length} edge groups, constitution ${constitution ? "inlined" : "absent"}, ${warnings.length} warnings`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
