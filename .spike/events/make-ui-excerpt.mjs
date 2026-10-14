import fs from "node:fs";
const src = fs.readFileSync("docs/UI-TUI-INITIAL-THINKING.md", "utf8");
const L = src.split("\n");
const slice = (a, b) => L.slice(a - 1, b).join("\n");
const parts = [
  "=== SOURCE: docs/UI-TUI-INITIAL-THINKING.md — verbatim excerpts ===",
  "extracted: " + new Date().toISOString(),
  "",
  "NOTE (grounding correction): the screen-model decision pm/lead call \"§7\" is actually in this doc's §6 (\"Screen model - the one real decision\"); this doc's own §7 is \"Level 2\". §4 carries the pi-tui TuiMainScreen/TuiAltScreen library facts.",
  "",
  "----- §7 in full (lines 196-242) -----",
  slice(196, 242),
  "",
  "----- §6 screen-model decision + Level 1 boundaries (lines 159-195) -----",
  slice(159, 195),
  "",
  "----- §4 pi-tui library facts incl. TuiMainScreen/TuiAltScreen + Git Bash note (lines 92-139) -----",
  slice(92, 139),
  "",
  "----- §10 Ask — already-decided constraints + non-goals (lines 271-285) -----",
  slice(271, 285),
  "",
  "----- §8 consultation checkpoints (lines 243-259) -----",
  slice(243, 259),
  "",
  "===== END EXCERPTS =====",
];
fs.writeFileSync(".spike/events/ui-tui-7-excerpt.md", parts.join("\n"), "utf8");
console.log("written chars=" + parts.join("\n").length);
