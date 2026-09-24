// GitHub read-only tools for OpenCode V2 — wraps the authenticated `gh` CLI.
//
// Shape: `export default { id, async setup(ctx) { await ctx.tool.transform(...) } }`
// (same V2 plugin shape as icm.ts / rtk.ts). The only import is the Node
// builtin `node:child_process` — the V2 loader resolves it in the Bun runtime;
// a bare `@opencode/plugin` specifier would not resolve server-side.
//
// Six direct (non-Code-Mode) tools, each `options: { codemode: false, permission: "gh" }`
// so the effective permission action is `gh` (see researcher.md allow rule):
//   gh_search_code, gh_search_repos, gh_search_issues, gh_file, gh_repo, gh_api
//
// `execFile("gh", args)` only — never a shell string. Every argument is built
// from validated, bounded input, and only fixed read-only gh subcommands run.

import { execFile } from "node:child_process"

const TIMEOUT_MS = 20000
const MAX_BUFFER = 4 * 1024 * 1024
const MAX_OUTPUT = 40000
const LIMIT_MIN = 1
const LIMIT_MAX = 30
const LIMIT_DEFAULT = 10
const QUERY_MAX = 500

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const REF_RE = /^[A-Za-z0-9_./-]+$/
const API_PATH_RE = /^\/[A-Za-z0-9._/{}-]+$/
const FILE_PATH_RE = /^[A-Za-z0-9._/-]+$/

const REF_MAX = 256
const FILE_PATH_MAX = 1024
const JQ_MAX = 200
// jq builtins that reach outside the input document (env/system/import/...).
// Word-boundary anchored so `.environment` stays allowed while `.env` does not.
const JQ_FORBIDDEN_RE = /\b(?:env|input|inputs|debug|halt|halt_error|include|import|system|exec|builtins)\b/

// Explicit allowlist of the child env `gh` needs (auth via keyring or token);
// never inherit the full parent environment.
const GH_ENV_KEYS = [
  "PATH",
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "GH_CONFIG_DIR",
  "GH_TOKEN",
  "GITHUB_TOKEN",
] as const

/// Clamp a user-supplied limit into 1..30, defaulting to 10 when absent/invalid.
export function clampLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return LIMIT_DEFAULT
  const n = Number(value)
  if (!Number.isFinite(n)) return LIMIT_DEFAULT
  const i = Math.trunc(n)
  if (i < LIMIT_MIN) return LIMIT_MIN
  if (i > LIMIT_MAX) return LIMIT_MAX
  return i
}

/// `owner/repo` only — exactly one slash, GitHub-safe characters.
export function isValidRepo(repo: unknown): boolean {
  return typeof repo === "string" && REPO_RE.test(repo)
}

/// Git ref / tag name — non-empty, GitHub-safe characters, ≤256 chars.
export function isValidRef(ref: unknown): boolean {
  return typeof ref === "string" && ref.length > 0 && ref.length <= REF_MAX && REF_RE.test(ref)
}

/// Repo-relative file path — non-empty, no spaces/quotes/options, ≤1024 chars, no `..`.
export function isValidFilePath(path: unknown): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > FILE_PATH_MAX) return false
  if (!FILE_PATH_RE.test(path)) return false
  return !path.split("/").some((segment) => segment === "..")
}

/// Read-only REST API path: must start `/`, no leading-dash segments, no `..`, no query.
export function isValidApiPath(path: unknown): boolean {
  if (typeof path !== "string" || !API_PATH_RE.test(path)) return false
  const segments = path.split("/")
  // No path segment may start with `-` (option-injection guard), nor be `..`.
  return !segments.some((segment) => segment.startsWith("-") || segment === "..")
}

/// Search query — non-empty after trim, at most 500 chars, no leading dash.
export function isValidQuery(query: unknown): boolean {
  if (typeof query !== "string") return false
  const trimmed = query.trim()
  return trimmed.length > 0 && query.length <= QUERY_MAX && !trimmed.startsWith("-")
}

/// jq filter expression — a bounded string with no `$` and no side-effect builtins.
export function isValidJq(expr: unknown): boolean {
  return (
    typeof expr === "string" &&
    expr.length <= JQ_MAX &&
    !expr.includes("$") &&
    !JQ_FORBIDDEN_RE.test(expr)
  )
}

/// Cap tool output at 40 KB with an explicit truncation marker.
export function truncateOutput(text: unknown): string {
  if (typeof text !== "string") return ""
  if (text.length <= MAX_OUTPUT) return text
  return text.slice(0, MAX_OUTPUT) + "\n...[truncated]"
}

// ── argv builders (pure, unit-tested) ───────────────────────────────────────

export function searchCodeArgs(query: string, repo?: string, limit?: unknown): string[] {
  return [
    "search",
    "code",
    query,
    ...(repo ? ["--repo", repo] : []),
    "--limit",
    String(clampLimit(limit)),
    "--json",
    "path,url,repository",
  ]
}

export function searchReposArgs(query: string, limit?: unknown): string[] {
  return [
    "search",
    "repos",
    query,
    "--limit",
    String(clampLimit(limit)),
    "--json",
    "fullName,description,stargazersCount,updatedAt,url,language",
  ]
}

export function searchIssuesArgs(query: string, repo?: string, limit?: unknown): string[] {
  return [
    "search",
    "issues",
    query,
    ...(repo ? ["--repo", repo] : []),
    "--limit",
    String(clampLimit(limit)),
    "--json",
    "title,number,state,url,updatedAt,repository",
  ]
}

export function fileArgs(repo: string, path: string, ref?: string): string[] {
  const endpoint = `repos/${repo}/contents/${path}${ref ? `?ref=${ref}` : ""}`
  return ["api", endpoint, "-H", "Accept: application/vnd.github.raw"]
}

export function repoArgs(repo: string): string[] {
  return [
    "api",
    `repos/${repo}`,
    "--jq",
    "{full_name,description,stargazers_count,default_branch,pushed_at,license:.license.spdx_id,topics,html_url,archived}",
  ]
}

export function apiArgs(path: string, jq?: string): string[] {
  return ["api", "--method", "GET", path, ...(jq ? ["--jq", jq] : [])]
}

// ── execution ───────────────────────────────────────────────────────────────

/// Child environment for `gh`: an explicit allowlist of only defined vars, plus
/// the non-interactive flags. Never inherits the full parent environment.
export function buildGhEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    NO_COLOR: "1",
  }
  for (const key of GH_ENV_KEYS) {
    const value = env[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

function runGh(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      {
        cwd,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        signal,
        env: buildGhEnv(),
      },
      (err: any, stdout: string, stderr: string) => {
        if (err) {
          const detail = String(stderr || err?.message || err || "").trim()
          reject(new Error(detail || "gh command failed"))
          return
        }
        resolve(String(stdout ?? ""))
      },
    )
  })
}

/// Normalise failures into a bounded `ERROR:` content string (never throw).
export async function toolResult(fn: () => Promise<string>): Promise<{ content: string }> {
  try {
    return { content: (await fn()) || "(no output)" }
  } catch (e: any) {
    return { content: truncateOutput(`ERROR: ${e instanceof Error ? e.message : String(e)}`) }
  }
}

export default {
  id: "gh",
  async setup(ctx: any) {
    const cwd = String(ctx?.location?.directory ?? process.cwd())

    await ctx.tool.transform((editor: any) => {
      const add = (name: string, description: string, input: any, execute: any) =>
        editor.add({
          name,
          description,
          input,
          options: { codemode: false, permission: "gh" },
          execute,
        })

      add(
        "gh_search_code",
        "Search GitHub code via the authenticated `gh` CLI (read-only). Returns path, url, and repository as compact JSON.",
        {
          type: "object",
          properties: {
            query: { type: "string", description: "Code search query (GitHub search syntax)" },
            repo: { type: "string", description: "Restrict to owner/repo (optional)" },
            limit: { type: "integer", default: 10, minimum: 1, maximum: 30, description: "Max results (clamped 1..30)" },
          },
          required: ["query"],
        },
        (input: any, context: any) =>
          toolResult(async () => {
            if (!isValidQuery(input?.query)) throw new Error("invalid query")
            if (input?.repo !== undefined && !isValidRepo(input.repo)) throw new Error("invalid repo")
            const out = await runGh(searchCodeArgs(input.query, input.repo, input.limit), cwd, context?.signal)
            return truncateOutput(out)
          }),
      )

      add(
        "gh_search_repos",
        "Search GitHub repositories via the authenticated `gh` CLI (read-only). Returns fullName, description, stars, updatedAt, url, language as compact JSON.",
        {
          type: "object",
          properties: {
            query: { type: "string", description: "Repository search query" },
            limit: { type: "integer", default: 10, minimum: 1, maximum: 30, description: "Max results (clamped 1..30)" },
          },
          required: ["query"],
        },
        (input: any, context: any) =>
          toolResult(async () => {
            if (!isValidQuery(input?.query)) throw new Error("invalid query")
            const out = await runGh(searchReposArgs(input.query, input.limit), cwd, context?.signal)
            return truncateOutput(out)
          }),
      )

      add(
        "gh_search_issues",
        "Search GitHub issues/PRs via the authenticated `gh` CLI (read-only). Returns title, number, state, url, updatedAt, repository as compact JSON.",
        {
          type: "object",
          properties: {
            query: { type: "string", description: "Issue/PR search query" },
            repo: { type: "string", description: "Restrict to owner/repo (optional)" },
            limit: { type: "integer", default: 10, minimum: 1, maximum: 30, description: "Max results (clamped 1..30)" },
          },
          required: ["query"],
        },
        (input: any, context: any) =>
          toolResult(async () => {
            if (!isValidQuery(input?.query)) throw new Error("invalid query")
            if (input?.repo !== undefined && !isValidRepo(input.repo)) throw new Error("invalid repo")
            const out = await runGh(searchIssuesArgs(input.query, input.repo, input.limit), cwd, context?.signal)
            return truncateOutput(out)
          }),
      )

      add(
        "gh_file",
        "Fetch a raw file from a GitHub repository at a ref/tag via the authenticated `gh` CLI (read-only). Returns the file's raw text.",
        {
          type: "object",
          properties: {
            repo: { type: "string", description: "owner/repo" },
            path: { type: "string", description: "Repo-relative file path" },
            ref: { type: "string", description: "Branch/tag/commit (optional; default branch when omitted)" },
          },
          required: ["repo", "path"],
        },
        (input: any, context: any) =>
          toolResult(async () => {
            if (!isValidRepo(input?.repo)) throw new Error("invalid repo")
            if (!isValidFilePath(input?.path)) throw new Error("invalid path")
            if (input?.ref !== undefined && !isValidRef(input.ref)) throw new Error("invalid ref")
            const out = await runGh(fileArgs(input.repo, input.path, input.ref), cwd, context?.signal)
            return truncateOutput(out)
          }),
      )

      add(
        "gh_repo",
        "Get repository metadata via the authenticated `gh` CLI (read-only): full_name, description, stars, default_branch, pushed_at, license, topics, html_url, archived.",
        {
          type: "object",
          properties: {
            repo: { type: "string", description: "owner/repo" },
          },
          required: ["repo"],
        },
        (input: any, context: any) =>
          toolResult(async () => {
            if (!isValidRepo(input?.repo)) throw new Error("invalid repo")
            const out = await runGh(repoArgs(input.repo), cwd, context?.signal)
            return truncateOutput(out)
          }),
      )

      add(
        "gh_api",
        "Make a read-only GET request to the GitHub REST API via the authenticated `gh` CLI. The path must start with `/` and contain no query string; optional `jq` filters the JSON.",
        {
          type: "object",
          properties: {
            path: { type: "string", description: "API path, e.g. /repos/owner/repo/releases/latest" },
            jq: { type: "string", description: "Optional jq expression applied to the response" },
          },
          required: ["path"],
        },
        (input: any, context: any) =>
          toolResult(async () => {
            if (!isValidApiPath(input?.path)) throw new Error("invalid api path")
            if (input?.jq !== undefined && !isValidJq(input.jq)) throw new Error("invalid jq")
            const out = await runGh(apiArgs(input.path, input.jq), cwd, context?.signal)
            return truncateOutput(out)
          }),
      )
    })
  },
}
