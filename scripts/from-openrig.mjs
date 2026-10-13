// from-openrig.mjs - convert an OpenRig rig.yaml into a durig rig v2 spec.
//
// Handles the REAL OpenRig topology (tutor-pi shape), not a flat agents[]:
//   pods[].members[].agent_ref (local:./agents/X) -> seats[]
//   agents/X/agent.yaml description              -> seats[].role
//   agents/X/guidance/role.md (resources.guidance) -> inlined as the seat's
//                                                   `# Role` persona text
//   profiles.default.uses.skills [shared:S]      -> seats[].skills (names)
//                                                   + SKILL.md content inlined
//                                                   into instructions
//   pods[].startup.files guidance/pod-X.md       -> inlined into member
//                                                   instructions (pod context)
//   rig startup.files guidance/team-norms.md     -> inlined into EVERY seat
//                                                   (rig-layer delivery)
//   culture_file                                 -> constitution text inlined
//   delegates_to / pod edges / rig-level edges   -> send-permission edges;
//                                                   absent = open comms
//
// Skill and guidance CONTENT is inlined because durig has no separate skill
// loader yet; the optimizer (DURIG_OPTIMIZE=on at `up`) compresses the
// combined prompt. Total volume is bounded (~500 lines across all files).
//
// Rig-level edges are where CROSS-POD relationships live (escalates_to,
// collaborates_with, can_observe); pod-level edges only ever describe a pod's
// own members. This list used to be ignored entirely, which silently dropped
// every cross-pod permission - sec/dev/ux ended up with no outgoing edge at
// all and qa/qa2/student lost their declared escalation path (D26).
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

// The pod shape is not optional: an older flat `agents:` rig deserializes
// `pods` as something uniterable, which used to surface as a bare TypeError.
// Name the expected shape instead - this converter is an entry point, and a
// stack trace tells the operator nothing about what to fix.
if (!Array.isArray(doc.pods)) {
  console.error(
    `error: ${inputPath} has no pods[] array. This converter reads OpenRig's pod shape ` +
      `(pods[].members[].agent_ref), not the older flat agents[] format.`,
  );
  process.exit(2);
}
const pods = doc.pods;

/** member id -> owning pod id, for resolving "pod.member" references. */
const memberPod = new Map();
for (const pod of pods) {
  for (const member of pod.members ?? []) memberPod.set(member.id, pod.id);
}

/**
 * Resolve an edge endpoint to a bare seat name.
 *
 * Rig-level edges address seats as "pod.member" while the spec keys seats by
 * bare member id, so the prefix is stripped - but only when it names the pod
 * that actually holds that member, so a stale prefix is caught instead of
 * quietly pointing at the wrong seat. Returns null for anything unknown: a
 * dropped permission must be a warning, never silence.
 */
function seatName(ref) {
  const name = String(ref ?? "");
  const dot = name.indexOf(".");
  if (dot < 0) return memberPod.has(name) ? name : null;
  const pod = name.slice(0, dot);
  const member = name.slice(dot + 1);
  return memberPod.get(member) === pod ? member : null;
}

/** Add a from->to send permission once; repeats collapse. */
function addEdge(from, to) {
  const existing = edges.find((e) => e.from === from);
  if (existing) {
    if (!existing.to.includes(to)) existing.to.push(to);
  } else {
    edges.push({ from, to: [to] });
  }
}

const rigGuidance = [];
for (const f of doc.startup?.files ?? []) {
  if (f.delivery_hint === "guidance_merge") {
    rigGuidance.push(await readFile(join(rigDir, f.path), "utf8"));
  } else {
    warnings.push(`rig startup file ${f.path} (${f.delivery_hint}) dropped: no durig equivalent`);
  }
}

for (const pod of pods) {
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

    // Role guidance: OpenRig delivers agents/<seat>/guidance/role.md at launch;
    // durig has no separate guidance loader, so inline it as the seat's
    // `# Role` persona. This is distinct from the pod SOP and the shared skills
    // and was previously dropped entirely.
    const roleBlocks = [];
    for (const g of agent.resources?.guidance ?? []) {
      if (!g?.path) continue;
      try {
        roleBlocks.push(await readFile(join(agentDir, g.path), "utf8"));
      } catch (err) {
        warnings.push(`${member.id}: guidance ${g.path} unreadable: ${err?.message ?? err}`);
      }
    }

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
    if (roleBlocks.length > 0) {
      instructionParts.push(`# Role\n${roleBlocks.join("\n")}`);
    }
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
      const resolved = seatName(to);
      if (!resolved) warnings.push(`${member.id}: delegates_to "${to}" is not a seat, dropped`);
      else addEdge(member.id, resolved);
    }
  }

  for (const e of pod.edges ?? []) {
    if (typeof e === "string") {
      warnings.push(`pod ${pod.id} edge "${e}" ignored: string form carries no target`);
      continue;
    }
    const from = seatName(e?.from);
    const to = seatName(e?.to);
    if (!from || !to) {
      warnings.push(`pod ${pod.id} edge ${e?.kind ?? "?"} ${e?.from} -> ${e?.to}: unknown seat, dropped`);
      continue;
    }
    addEdge(from, to);
  }
}

// Cross-pod edges live at rig level, not inside a pod (D26). Read after the
// pods so member ids are known and duplicates collapse.
for (const e of doc.edges ?? []) {
  const from = seatName(e?.from);
  const to = seatName(e?.to);
  if (!from || !to) {
    warnings.push(`rig edge ${e?.kind ?? "?"} ${e?.from} -> ${e?.to}: unknown seat, dropped`);
    continue;
  }
  addEdge(from, to);
}

// OpenRig expresses the PM's routing authority implicitly (intake +
// decomposition), but durig edges are explicit and restrictive-by-default.
// Grant coordinator seats (pm, lead) send permission to every other seat so
// a migrated org can actually route work.
for (const coord of ["pm", "lead"]) {
  if (!seats.some((s) => s.name === coord)) continue;
  const targets = seats.map((s) => s.name).filter((n) => n !== coord);
  for (const t of targets) addEdge(coord, t);
}

let constitution;
if (doc.culture_file) {
  constitution = await readFile(join(rigDir, doc.culture_file), "utf8");
}

const result = { version: 2, seats };
if (edges.length > 0) result.edges = edges.map((e) => ({ from: e.from, maySendTo: e.to }));
if (constitution !== undefined) result.constitutionInline = constitution;

// Warnings go to stderr on both paths. They were only printed when an output
// file was named, so piping the spec to stdout - the interactive way to use
// this - silently dropped every "edge ignored" notice.
for (const w of warnings) console.error(`WARNING: ${w}`);

if (outArg) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outArg, JSON.stringify(result, null, 2), "utf8");
  console.error(`wrote ${outArg}: ${seats.length} seats, ${edges.length} edge groups, constitution ${constitution ? "inlined" : "absent"}, ${warnings.length} warnings`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
