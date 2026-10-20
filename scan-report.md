# Dangling citations one-pass scan (item #3425)

Scope: 183 tracked *.md files at HEAD 13e60bc ("merge: land impl-item-2578 onto main").
Method: scan-dangling-cites.ps1 (this pass, v3) extracts path-like tokens (1+ separator + file
extension), skips http(s) URLs, angle-placeholder strip artifacts, .git/ interior paths,
abbreviated "..." paths, web domains in the first segment (.org/.com/.net/.io/.dev/.ai), and
bare extension lists (.js/.jsx/.mjs). Relative tokens resolve against BOTH the doc's directory
and the repo root; omitted when either resolves. Jammed tokens ending in an extension split at
each tracked prefix (e.g. demo/confine.test.mjs/demo/seatguard.test.mjs).
Output: scan-raw.csv (498 unique doc/missing pairs across 97 docs; cluster numbers below are unique pairs per doc).
Earlier passes: scan-raw-v2-multiline.csv (pre web-URL/extension-list exclusions, 651 rows).
Narrative citation INTENT is not auto-classified; prose context unchanged.

Headline clusters (doc -> unique flagged pairs):
$136): mostly narrated ".spike/delegate/*" scratch sources.
- docs/ARCH-COMPARISON-agency-agents.md (43), docs/NEXT.md (44), docs/ROADMAP.md (31): cites into sibling/vendor corpora absent from main
  (agency-agents role files, aider/*, agent-governance-python/*), plus root-theory docs never landed
  (docs/ARCHITECTURE.md, docs/PHILOSOPHY.md, docs/specs/*, docs/tutorials/*, docs/security/*).
- docs/ROADMAP.md (31) / docs/DECISIONS.md (22): dead root lib paths (src/host.mjs,
  pi-durable/dist/types.d.ts, vendor/pi-main/...), recurring borker typo src/borker.mjs.
- docs/reviews/tui-attach-vs-poll.md (15): dead src/harness/*.ts and test/examples/* narrative cites.
- docs/REVIEW-pi-durable-demos.md (12): doc-relative durable/* and vacation/* paths absent.
- Recurrent singletons: src/borker.mjs (typo; src/broker.mjs PRESENT as control), demo/test-areas{,.test}.js,
  .spike/durable-tui/HANDOFF.md, skills/tui-design/references/cli-basics.md, .agents/skills/durig/SKILL.md,
  references/{visual-patterns,interaction-patterns,exemplar-apps}.md cites satisfied by skills/ layout in
  some docs but absent in docs/*.md narrative cites.

Spot-check (git ls-files -- <path>): 9/9 sampled flagged paths ABSENT at HEAD;
controls src/broker.mjs and README.md PRESENT (docs/reviews/security-sec-m3-seat-tools.md also
came back ABSENT, corroborating its own flags in docs/SEAT-TOOLS.md L4 and docs/DECISIONS.md L1055).
One sequential pass; no fix items emitted, per item bounds. Method limits: extension whitelist may
skip docerate cites with unusual extensions; i cannont attest tokens inside codeblocks vs prose.

