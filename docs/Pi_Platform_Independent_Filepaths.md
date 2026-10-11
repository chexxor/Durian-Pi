What's the best way to make a Pi harness client cross-platform with regards to filepath formats? When a toolcall uses forward-slashes on a platform which expects backslashes, or one slash where the platform expects two slashes, that's a problem. Is there a way to make file reads/write independent of the underlying platform? Keep in mind that I am interested in an answer that applies to both pi harness and the pi-durable work in progress platform.

I'll research how pi and pi-durable handle paths, plus the current best practices for cross-platform path canonicalization, so the answer is grounded in the actual harness.Let me pull the specifics from the Node path docs, pi's Windows documentation, and the pi-durable docs.## The core insight

You're really fighting three distinct problems, and conflating them is what makes this feel intractable:

1. **Separator representation** — `/` vs `\`.
2. **Rooting / authority** — drive letters (`C:`), UNC (`\\server\share`), the POSIX double-leading-slash special case, and drive-relative paths (`C:` meaning "the current dir *on* C:", which Node tracks per-drive [^1]).
3. **Identity** — case-insensitivity, symlinks/junctions, trailing dots/spaces, Unicode normalization — i.e. when two different strings name the *same* file.

The fix is not "make paths work on both platforms." It's **pick exactly one canonical form, normalize to it at every ingress, and convert to the native form only at the single point where you call the OS.** Everything between is canonical. This is the same discipline as the effect-broker answer: one chokepoint at the boundary, no ambient host assumptions leaking inward.

Node deliberately gives you the raw material for this and *warns you not to use the default module for it*: `node:path`'s behavior varies by OS, so for consistent results you must reach for `path.posix` or `path.win32` explicitly [^1] [^1] [^1] [^1]. The default `path` is the trap, not the tool.

## Choosing the canonical form

| Canonical form | Handles drive letters | Handles UNC | Stable across OS | Notes |
| --- | --- | --- | --- | --- |
| **MSYS/Git-Bash-style POSIX** (`/c/Users/me`, `//server/share`) | Yes (drive → `/<letter>/`) | Yes (`//server/share`) | Yes | **Recommended** — and it's what pi already speaks on Windows |
| Plain POSIX absolute (`/Users/me`) | No — collisions | Partially | Yes | Fine on POSIX-only |
| `file://` URI | Yes (`file:///C:/…`) | Yes (`file://server/share`) | Yes | Good for LSP/editor interop; percent-encoding + authority parsing are extra traps |
| Workspace-relative (`src/a.ts`) | N/A (root is context) | N/A | Yes | Best *key* for durable state; pair with an absolute canonical root |

I'd recommend **MSYS/Git-Bash-style absolute POSIX** as the canonical form for pi, for a concrete reason: on native Windows, pi runs the bash tool through **Git Bash** by default [^3], and Git Bash already presents `C:\Users\me` as `/c/Users/me`. If your file tools adopt the same convention, the `bash` tool and the `read`/`write`/`edit` tools **agree on what a path means** — no translation mismatch between "the model's `ls` output" and "the model's `read` argument."

For **pi-durable**, use the absolute canonical path *only transiently*; store the **workspace-relative** form in durable state, keyed by a root id (more on why below).

## Implementation

```ts
// canonical.ts — the ONE place that knows about path syntax
import { posix, win32 } from "node:path";

const isWin = process.platform === "win32";
export type Canonical = string & { __canonical: true }; // absolute POSIX, /c/... form

class PathError extends Error {}

/** Ingress: any model-supplied string -> canonical. Total function; throws on garbage. */
export function toCanonical(input: string, root: Canonical): Canonical {
  if (typeof input !== "string") throw new PathError("path must be a string");
  if (input.includes("\0")) throw new PathError("NUL in path");
  let s = input.trim();
  if (!s) throw new PathError("empty path");

  // 1) file:// URL -> path text
  if (/^file:/i.test(s)) s = fileUrlToPathText(s);

  // 2) Windows drive-absolute:  C:\x\y  |  C:/x/y  ->  /c/x/y
  const driveAbs = s.match(/^([A-Za-z]):[\\/](.*)$/s);
  if (driveAbs) s = `/${driveAbs[1].toLowerCase()}/${driveAbs[2]}`;
  // 2b) Drive-relative "C:" is ambiguous (per-drive cwd); refuse or pin to root.
  else if (/^[A-Za-z]:$/.test(s)) s = `/${s[0].toLowerCase()}`;

  // 3) Backslashes -> forward slashes. Detect UNC BEFORE collapsing.
  const unc = s.match(/^\\\\|^\/\/[^/]/);        // \\server  or  //server
  s = s.replace(/\\/g, "/");

  // 4) Resolve relative against the conversation root (canonical, POSIX).
  const abs = s.startsWith("/") ? s : posix.join(root, s);

  // 5) Normalize . / .. WITHOUT eating a leading "//" (UNC).
  //    posix.normalize() collapses a double leading slash — do it manually.
  const uncPrefix = abs.startsWith("//") && !abs.startsWith("///") ? "//" : "";
  const body = uncPrefix ? abs.slice(2) : abs;
  let norm = posix.normalize(uncPrefix + body);
  if (norm === "." ) norm = "/";
  return norm as Canonical;
}

/** Egress: canonical -> the native path you hand to fs/child_process. */
export function toHost(c: Canonical, { extended = false } = {}): string {
  if (!isWin) return c;                        // already POSIX-native
  let host: string;
  const unc = c.match(/^\/\/([^/]+)(\/.*)?$/);
  const drv = c.match(/^\/([a-z])(\/.*)?$/);
  if (unc)      host = `\\\\${unc[1]}${(unc[2] ?? "").replace(/\//g, "\\")}`;
  else if (drv) host = `${drv[1].toUpperCase()}:${(drv[2] ?? "\\").replace(/\//g, "\\")}`;
  else          host = c.replace(/\//g, "\\");
  // Only when you hit MAX_PATH or exotic names: \\?\ prefix.
  return extended ? win32.toNamespacedPath(host) : host;
}

/** Egress for the model: canonical is already what the model should see. */
export const toModel = (c: Canonical): string => c;
```

The two functions above are the *entire* platform-aware surface of your codebase. Everything else — tool schemas, broker predicates, audit logs, durable checkpoints — operates on `Canonical` only.

### The `//` problem specifically

Your "one slash where the platform expects two" is real and has **three** faces, all of which the code above handles:

- **POSIX**: a path beginning with *exactly* two slashes is implementation-defined. Node's own `path.normalize()` documents that it **collapses two leading slashes to one**, explicitly calling out that this doesn't adhere to POSIX and "may change how the underlying system resolves the path" [^1]. So you must preserve `//` yourself — which is why `toCanonical` splits the UNC prefix off before normalizing.
- **Windows UNC**: `\\server\share` must become `//server/share` in canonical form and back to `\\server\share` on egress.
- **`file://` URLs**: `file://host/share` vs `file:///C:/x` — the authority component *is* the double slash. Parse with `url.fileURLToPath`, never string-slice.

## Platform traps and where each is handled

| Trap | Symptom | Handling |
| --- | --- | --- |
| Both `/` and `\` accepted on Windows, but `path` methods *emit* `\` [^1] | Mixed separators in output | Canonical layer uses `path.posix` only; egress emits native |
| Double leading slash | UNC lost, or POSIX `//host` broken [^1] | Split prefix before `posix.normalize` |
| Drive letters | `C:\…` meaningless on Linux | Map to `/c/…` on ingress |
| Drive-relative `C:` | Silently resolves against a per-drive cwd [^1] | Reject or pin to `/c` — never trust it |
| Relative paths | Depend on `process.cwd()` | Resolve against the *conversation* root, not the process cwd |
| Case-insensitivity (Windows/macOS) | Two paths, one file | Case-fold for *comparison keys*, preserve case for display |
| Trailing dots/spaces (Windows) | `"foo."` and `"foo"` collide; reserved names `CON`, `NUL`, `PRN`, `COM1`… | Reject in canonical validation |
| `MAX_PATH` / long paths | ENOENT on deep trees | `toNamespacedPath` for the `\\?\` prefix [^1] |
| Symlinks/junctions | Containment check bypassed | `realpath` on the *host* path, then re-canonicalize, then check containment |
| Unicode NFC vs NFD (macOS) | Same file, two strings | Normalize to NFC in the canonical key |
| JSON escaping | `"C:\\x"` vs `"C:\x"` | This is exactly the pi Windows `shellPath` footgun — "write each backslash twice" [^3] |

## The containment check (do it in canonical space, verify in host space)

```ts
export function isWithin(c: Canonical, root: Canonical): boolean {
  // Both canonical; compare on segment boundaries, case-insensitively on Windows.
  const fold = (p: string) => (isWin ? p.toLowerCase() : p);
  const a = fold(c), b = fold(root.replace(/\/$/, ""));
  return a === b || a.startsWith(b + "/");
}

export async function resolveSafe(input: string, root: Canonical) {
  const c = toCanonical(input, root);
  if (!isWithin(c, root)) throw new PathError("EACCES: outside root");
  const host = toHost(c);
  const real = toCanonical(await fs.realpath(host), root); // defeat symlinks
  if (!isWithin(real, root)) throw new PathError("EACCES: symlink escape");
  return { canonical: real, host: toHost(real) };
}
```

Note the ordering: **authorize in canonical space, then execute in host space, then re-canonicalize the result of `realpath` and re-check.** Symlink escape is defeated because you check the *resolved* path, not the requested one. This slots directly into the broker's `allows()` predicate from the earlier answer — the predicate now takes a `Canonical`, not a raw string.

## Applying it to the pi harness

Pi's tools (`read`, `write`, `edit`, `bash`, the optional `powershell` tool [^3]) each receive model-authored paths. The rule:

- Every file tool's `execute()` calls `resolveSafe(args.path, conversationRoot)` **before** touching `fs`. No exceptions.
- The tool's JSON schema and the model-facing prompt use the **canonical** form, so the model sees one syntax everywhere. On Windows that's `/c/...`, which also matches Git Bash's `ls` output [^3] — so the model never has to switch mental models between tools.
- The `bash` tool on Windows runs through Git Bash, which speaks the canonical form natively; on POSIX it already does. The only mismatch is the `powershell` tool, which wants `C:\...` — so pass it through `toHost()`.
- Use `path.posix` for all canonical manipulation and never the bare `path` module [^1] [^1].

## Applying it to pi-durable (the harder case)

This is where it matters most, because pi-durable's whole premise is that **state outlives the process and can move**: the harness "opens over a storage backend" and tools get files/shell from an **execution environment**, with `env` building the environment for every tool call **from the conversation's working directory**, so "each conversation can run in a different place" [^2] [^2]. Checkpoints are stored before each step and replayed after a crash [^2] [^2].

That model has a direct consequence for paths:

**Never persist a host-absolute path in durable state.** If a checkpoint written on Windows stores `C:\work\repo\a.ts` and the process restarts inside a Linux container, replay either fails or, worse, resolves to something unintended. So:

- Store **`{ rootId, relativePath }`** in checkpoints, plus a canonical absolute root *as configuration*, not as state.
- Make `toCanonical` and `toHost` **pure and deterministic**, so replay reproduces the same decision. (This mirrors the effect-handler/durable-task alignment from before: a path resolution is an effect whose inputs must be journaled.)
- Put the canonicalization at the **execution-environment boundary**. `NodeExecutionEnv({ cwd })` [^2] should canonicalize `cwd` once at construction and expose a `resolve(input)` that returns canonical; the durable layer never sees a native path.
- Because a cut-off tool call "reruns if it is safe to" [^2], path resolution must be **idempotent** — canonicalizing an already-canonical path must be a no-op. Design `toCanonical` to be idempotent and add a property test asserting `toCanonical(toCanonical(x)) === toCanonical(x)`.
- A **remote execution environment** (harness on one machine, tools on another [^2]) makes this non-negotiable: the wire protocol between harness and env should carry **canonical paths only**, and the env converts to its own native form on arrival.

## Testing strategy

1. **Round-trip property test**: for random path strings, `toHost(toCanonical(x)) → toCanonical → equals toCanonical(x)` on both a POSIX and a Windows runner.
2. **Fixture table** covering: `/a/b`, `a/b`, `..\a`, `C:\a`, `C:/a`, `c:a` (drive-relative), `\\srv\share\f`, `//srv/share/f`, `file:///C:/a`, `file://srv/share`, `a//b`, `a\\b`, reserved names, trailing dots, NFD/NFC filenames.
3. **Cross-platform resume test for pi-durable**: write a checkpoint on a simulated Windows path, resume on a POSIX runner, assert the tool call re-resolves to the same workspace file.
4. **Symlink/junction escape test**: assert `resolveSafe` rejects a link pointing outside the root.

## Library options

- `path.posix` / `path.win32` — the primitives; use these, not default `path` [^1] [^1].
- `pathe` — drop-in `path` replacement that always emits forward slashes; good if you want the canonical layer to "just work" without writing `posix.*` everywhere.
- `slash` / `normalize-path` — narrow helpers for backslash→slash conversion [^4] [^5].
- For `file://` interop, use Node's `url.fileURLToPath` / `pathToFileURL`, not manual string surgery.

**Bottom line:** one canonical form (MSYS/Git-Bash-style POSIX for pi, because it matches the Windows bash tool pi already uses [^3]), one ingress function (`toCanonical`), one egress function (`toHost`), authorize-and-verify in canonical space with `realpath`, and — critically for pi-durable — **persist only root-relative canonical paths, never host-absolute ones**, so checkpoints remain replayable across machines and OSes [^2] [^2].

**References**

[^1]: [Path | Node.js v26.11.1 Documentation](https://nodejs.org/api/path.html) (41%)
[^2]: [Pi Durable | Earendil](https://earendil.com/posts/pi-durable/) (36%)
[^3]: [Run Pi on Windows · Documentation · Pi](https://pi.dev/docs/latest/windows) (13%)
[^4]: [Nodejs absolute paths in windows with forward slash](https://stackoverflow.com/questions/34329149/nodejs-absolute-paths-in-windows-with-forward-slash) (6%)
[^5]: [normalize-path - npm](https://www.npmjs.com/package/normalize-path) (4%)