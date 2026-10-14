Rules for this project. Every `#` heading is one rule; the text under it is what Jev judges against.
A `paths:` line limits a rule to matching files; a `source: <file>:<line>` line cites where the rule came from.

# No hardcoded secrets
Source code must not contain passwords, API keys, tokens, or connection URLs with credentials.
Read them from the environment, a function parameter, or the config module.

# Comments explain why, not what
A comment states a reason, a constraint, a workaround, or a non-obvious invariant. A comment
that restates what the next line plainly does is a violation.

# Errors are not swallowed
A `catch` block must handle the error, report it, or re-raise it. An empty catch block, or
one whose body is only a comment, is a violation.

# No partial implementations
Implement features fully. A violation is a comment containing "for now", "simplified",
"later", or "not implemented", or a function body that is empty, only `return undefined`,
or only `throw new Error("not implemented")`.

# Do not run destructive commands that erase uncommitted work
`git reset --hard`, `git checkout -- .`, `git clean -fd`, and similar commands that discard
untracked or uncommitted changes are forbidden. These destroy work that has no backup. If a
clean tree is needed, create a worktree instead or ask the user.

# No explicit any
paths: **/*.ts, **/*.tsx
Do not use the `any` type. Use a precise type, `unknown` with a runtime check, or a generic parameter.

# Exported functions declare their return type
paths: src/**/*.ts
Every exported function or method declares its return type instead of relying on inference.

# Native Windows only
source: AGENTS.md:39
A file, script, or configuration change must not invoke `wsl`, `docker`, or `docker-compose`.
This project runs natively on Windows; use the plain Node or Windows equivalent instead.

# No whole-filesystem searches
source: AGENTS.md:40
A command or script added to the repository must not search the whole filesystem, for example
`find /`, `grep -r /`, or `rg /`. Searches stay inside the project workspace.

# Keep docs/NEXT.md current
paths: docs/NEXT.md
source: AGENTS.md:29
A change to `docs/NEXT.md` must leave a `## NEXT SESSION` section that names the current item,
a queue id (`#NNN`), and an exact next command line containing `node cli.mjs`; a known blocker
is named there too.
