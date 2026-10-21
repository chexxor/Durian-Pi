# Verification for #3833 (#3821): failed sync-pi --link is now a recorded UNLINKED state

1. linkWorktreeDeps returns {attempted, ok, reason, detail} - failure names the cause, not "Command failed". CONFIRMED.
2. installWorktreeDeps returns a dependency record on every path: state = linked | unlinked | no-sync-script. No console.warn on the provisioning path. CONFIRMED.
3. Provisioning CONTINUES even on link failure - the worktree still exists. CONFIRMED.
4. prepareSeatWorkspace().dependencyNote is the sentence, appended to the TOOL RESULT. CONFIRMED.
5. Reused worktree reports dependency null (UNKNOWN), not "linked". CONFIRMED.

Demo: 7 sections, all exit 0. prepare-workspace.test.mjs exit 0. Syntax checks pass.
New runbook passes UTF-8/mojibake/BOM checks.

Known gap: seattools concatenation (workspace.dependencyNote ?? "") is code-read only - exercising it requires a live broker. All other claims verified.

Verdict: CORRECT. A failed sync-pi --link is now reported as DATA (UNLINKED state) with a reason and remedy, and the seat is told about it via dependencyNote in the tool result. Provisioning continues. No console.warn remains.
