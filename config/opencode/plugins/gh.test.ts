import { beforeAll, describe, expect, test } from "bun:test"
import gh from "./gh"
import {
  apiArgs,
  buildGhEnv,
  clampLimit,
  fileArgs,
  isValidApiPath,
  isValidFilePath,
  isValidJq,
  isValidQuery,
  isValidRef,
  isValidRepo,
  repoArgs,
  searchCodeArgs,
  searchIssuesArgs,
  searchReposArgs,
  toolResult,
  truncateOutput,
} from "./gh"

describe("clampLimit", () => {
  test("defaults to 10 when absent or invalid", () => {
    expect(clampLimit(undefined)).toBe(10)
    expect(clampLimit(null)).toBe(10)
    expect(clampLimit("abc")).toBe(10)
    expect(clampLimit(Number.NaN)).toBe(10)
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(10)
  })

  test("clamps into 1..30", () => {
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(-5)).toBe(1)
    expect(clampLimit(1)).toBe(1)
    expect(clampLimit(30)).toBe(30)
    expect(clampLimit(31)).toBe(30)
    expect(clampLimit(9999)).toBe(30)
  })

  test("accepts numeric strings and truncates fractions", () => {
    expect(clampLimit("5")).toBe(5)
    expect(clampLimit(5.9)).toBe(5)
  })
})

describe("isValidRepo", () => {
  test("accepts owner/repo", () => {
    expect(isValidRepo("anomalyco/opencode")).toBe(true)
    expect(isValidRepo("a/b")).toBe(true)
    expect(isValidRepo("DEVtheOPS/opencode-plugin-otel")).toBe(true)
    expect(isValidRepo("owner.name/repo_name-1")).toBe(true)
  })

  test("rejects malformed repos", () => {
    expect(isValidRepo("")).toBe(false)
    expect(isValidRepo("owner")).toBe(false)
    expect(isValidRepo("a/b/c")).toBe(false)
    expect(isValidRepo("a b/c")).toBe(false)
    expect(isValidRepo("a/b?ref=x")).toBe(false)
    expect(isValidRepo(42 as unknown as string)).toBe(false)
    expect(isValidRepo(undefined as unknown as string)).toBe(false)
  })
})

describe("isValidRef", () => {
  test("accepts branch/tag/commit refs", () => {
    expect(isValidRef("main")).toBe(true)
    expect(isValidRef("v1.0.0")).toBe(true)
    expect(isValidRef("feature/thing")).toBe(true)
    expect(isValidRef("refs/tags/v2.0.15")).toBe(true)
    expect(isValidRef("abc123def")).toBe(true)
  })

  test("rejects empty or unsafe refs", () => {
    expect(isValidRef("")).toBe(false)
    expect(isValidRef("v1; rm -rf /")).toBe(false)
    expect(isValidRef("v1 && echo x")).toBe(false)
    expect(isValidRef(undefined as unknown as string)).toBe(false)
  })

  test("rejects refs longer than 256 chars", () => {
    expect(isValidRef("a".repeat(256))).toBe(true)
    expect(isValidRef("a".repeat(257))).toBe(false)
  })
})

describe("isValidFilePath", () => {
  test("accepts repo-relative paths", () => {
    expect(isValidFilePath("packages/plugin/src/promise/tool.ts")).toBe(true)
    expect(isValidFilePath("README.md")).toBe(true)
  })

  test("rejects empty/unsafe paths", () => {
    expect(isValidFilePath("")).toBe(false)
    expect(isValidFilePath("a b.ts")).toBe(false)
    expect(isValidFilePath("a;b.ts")).toBe(false)
    expect(isValidFilePath(undefined as unknown as string)).toBe(false)
  })

  test("rejects paths longer than 1024 chars", () => {
    expect(isValidFilePath("a".repeat(1024))).toBe(true)
    expect(isValidFilePath("a".repeat(1025))).toBe(false)
  })

  test("rejects `..` segments", () => {
    expect(isValidFilePath("../etc/passwd")).toBe(false)
    expect(isValidFilePath("src/../../x.ts")).toBe(false)
    expect(isValidFilePath("src/..")).toBe(false)
    expect(isValidFilePath("src/.../x.ts")).toBe(true)
  })
})

describe("isValidApiPath", () => {
  test("accepts leading-slash read paths", () => {
    expect(isValidApiPath("/repos/anomalyco/opencode")).toBe(true)
    expect(isValidApiPath("/repos/anomalyco/opencode/releases/latest")).toBe(true)
    expect(isValidApiPath("/repos/a/b/contents/x/y.ts")).toBe(true)
  })

  test("rejects no-slash, leading-dash, query, and unsafe paths", () => {
    expect(isValidApiPath("repos/a/b")).toBe(false)
    expect(isValidApiPath("")).toBe(false)
    expect(isValidApiPath("/repos/a/b?ref=x")).toBe(false)
    expect(isValidApiPath("/-X/foo")).toBe(false)
    expect(isValidApiPath("/repos/a/b -X GET")).toBe(false)
    expect(isValidApiPath(undefined as unknown as string)).toBe(false)
  })

  test("rejects `..` segments", () => {
    expect(isValidApiPath("/repos/../secrets")).toBe(false)
    expect(isValidApiPath("/repos/a/..")).toBe(false)
    expect(isValidApiPath("/repos/a/.../b")).toBe(true)
  })
})

describe("isValidQuery", () => {
  test("accepts non-empty queries up to 500 chars", () => {
    expect(isValidQuery("opencode plugin")).toBe(true)
    expect(isValidQuery("a".repeat(500))).toBe(true)
  })

  test("rejects empty/whitespace/oversized", () => {
    expect(isValidQuery("")).toBe(false)
    expect(isValidQuery("   ")).toBe(false)
    expect(isValidQuery("a".repeat(501))).toBe(false)
    expect(isValidQuery(undefined as unknown as string)).toBe(false)
  })

  test("rejects leading-dash queries", () => {
    expect(isValidQuery("-foo")).toBe(false)
    expect(isValidQuery("  -foo")).toBe(false)
    expect(isValidQuery("foo -bar")).toBe(true)
  })
})

describe("isValidJq", () => {
  test("accepts plain field filters, including `.environment`", () => {
    expect(isValidJq(".tag_name")).toBe(true)
    expect(isValidJq(".rate.remaining")).toBe(true)
    expect(isValidJq("{full_name,description}")).toBe(true)
    expect(isValidJq(".environment")).toBe(true)
    expect(isValidJq(".environment.vars")).toBe(true)
  })

  test("rejects non-strings, oversize, `$`, and side-effect builtins", () => {
    expect(isValidJq(undefined)).toBe(false)
    expect(isValidJq(42)).toBe(false)
    expect(isValidJq("a".repeat(201))).toBe(false)
    expect(isValidJq("$ENV|keys|length")).toBe(false)
    expect(isValidJq(".x | $ENV")).toBe(false)
    expect(isValidJq("env")).toBe(false)
    expect(isValidJq(".env")).toBe(false)
    expect(isValidJq("input")).toBe(false)
    expect(isValidJq("inputs")).toBe(false)
    expect(isValidJq("debug")).toBe(false)
    expect(isValidJq("halt")).toBe(false)
    expect(isValidJq("halt_error")).toBe(false)
    expect(isValidJq("include \"x\"")).toBe(false)
    expect(isValidJq("import \"x\" as y")).toBe(false)
    expect(isValidJq("system")).toBe(false)
    expect(isValidJq("exec")).toBe(false)
    expect(isValidJq("builtins")).toBe(false)
  })
})

describe("truncateOutput", () => {
  test("passes short output through unchanged", () => {
    expect(truncateOutput("hello")).toBe("hello")
    expect(truncateOutput("")).toBe("")
  })

  test("caps at 40000 chars with a marker", () => {
    const big = "x".repeat(40001)
    const out = truncateOutput(big)
    expect(out.endsWith("\n...[truncated]")).toBe(true)
    expect(out.length).toBe(40000 + "\n...[truncated]".length)
  })

  test("coerces non-strings to empty", () => {
    expect(truncateOutput(undefined)).toBe("")
    expect(truncateOutput(123 as unknown as string)).toBe("")
  })
})

describe("toolResult", () => {
  test("returns fn output, or a placeholder for empty output", async () => {
    expect(await toolResult(async () => "ok")).toEqual({ content: "ok" })
    expect(await toolResult(async () => "")).toEqual({ content: "(no output)" })
  })

  test("wraps errors as ERROR and truncates oversized messages", async () => {
    const short = await toolResult(async () => {
      throw new Error("boom")
    })
    expect(short).toEqual({ content: "ERROR: boom" })

    const long = await toolResult(async () => {
      throw new Error("x".repeat(50000))
    })
    expect(long.content.startsWith("ERROR: ")).toBe(true)
    expect(long.content.endsWith("\n...[truncated]")).toBe(true)
    expect(long.content.length).toBe(40000 + "\n...[truncated]".length)
  })
})

describe("buildGhEnv", () => {
  test("keeps only allowlisted defined vars plus the three flags", () => {
    const env = buildGhEnv({
      PATH: "/usr/bin",
      HOME: "/home/u",
      GH_TOKEN: "t",
      SECRET: "leak",
      AWS_SECRET_ACCESS_KEY: "leak",
    } as unknown as NodeJS.ProcessEnv)
    expect(env).toEqual({
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      NO_COLOR: "1",
      PATH: "/usr/bin",
      HOME: "/home/u",
      GH_TOKEN: "t",
    })
    expect("SECRET" in env).toBe(false)
    expect("AWS_SECRET_ACCESS_KEY" in env).toBe(false)
  })

  test("omits undefined allowlisted vars", () => {
    const env = buildGhEnv({ PATH: "/bin" } as unknown as NodeJS.ProcessEnv)
    expect("HOME" in env).toBe(false)
    expect(env.PATH).toBe("/bin")
  })
})

describe("arg builders", () => {
  test("searchCodeArgs", () => {
    expect(searchCodeArgs("clampLimit", "anomalyco/opencode", 5)).toEqual([
      "search",
      "code",
      "clampLimit",
      "--repo",
      "anomalyco/opencode",
      "--limit",
      "5",
      "--json",
      "path,url,repository",
    ])
    expect(searchCodeArgs("q", undefined, 100)).toEqual([
      "search",
      "code",
      "q",
      "--limit",
      "30",
      "--json",
      "path,url,repository",
    ])
  })

  test("searchReposArgs", () => {
    expect(searchReposArgs("opencode plugin", 2)).toEqual([
      "search",
      "repos",
      "opencode plugin",
      "--limit",
      "2",
      "--json",
      "fullName,description,stargazersCount,updatedAt,url,language",
    ])
  })

  test("searchIssuesArgs", () => {
    expect(searchIssuesArgs("plugin api", "anomalyco/opencode", 2)).toEqual([
      "search",
      "issues",
      "plugin api",
      "--repo",
      "anomalyco/opencode",
      "--limit",
      "2",
      "--json",
      "title,number,state,url,updatedAt,repository",
    ])
  })

  test("fileArgs with and without ref", () => {
    expect(fileArgs("anomalyco/opencode", "packages/plugin/src/promise/tool.ts", "v2.0.15")).toEqual([
      "api",
      "repos/anomalyco/opencode/contents/packages/plugin/src/promise/tool.ts?ref=v2.0.15",
      "-H",
      "Accept: application/vnd.github.raw",
    ])
    expect(fileArgs("anomalyco/opencode", "README.md")).toEqual([
      "api",
      "repos/anomalyco/opencode/contents/README.md",
      "-H",
      "Accept: application/vnd.github.raw",
    ])
  })

  test("repoArgs", () => {
    expect(repoArgs("anomalyco/opencode")).toEqual([
      "api",
      "repos/anomalyco/opencode",
      "--jq",
      "{full_name,description,stargazers_count,default_branch,pushed_at,license:.license.spdx_id,topics,html_url,archived}",
    ])
  })

  test("apiArgs with and without jq", () => {
    expect(apiArgs("/repos/anomalyco/opencode/releases/latest", ".tag_name")).toEqual([
      "api",
      "--method",
      "GET",
      "/repos/anomalyco/opencode/releases/latest",
      "--jq",
      ".tag_name",
    ])
    expect(apiArgs("/repos/anomalyco/opencode")).toEqual([
      "api",
      "--method",
      "GET",
      "/repos/anomalyco/opencode",
    ])
  })
})

describe("setup tool wiring", () => {
  const tools: Record<string, any> = {}
  const names = [
    "gh_search_code",
    "gh_search_repos",
    "gh_search_issues",
    "gh_file",
    "gh_repo",
    "gh_api",
  ]

  beforeAll(async () => {
    await gh.setup({
      location: { directory: process.cwd() },
      tool: {
        transform: async (fn: any) =>
          fn({
            add: (t: any) => {
              tools[t.name] = t
            },
          }),
      },
    })
  })

  test("registers all six gh tools with gh permission and codemode disabled", () => {
    expect(Object.keys(tools).sort()).toEqual([...names].sort())
    for (const name of names) {
      expect(tools[name].options).toEqual({ codemode: false, permission: "gh" })
    }
  })

  test("gh_api.execute rejects a forbidden jq expression", async () => {
    const res = await tools.gh_api.execute({ path: "/rate_limit", jq: "$ENV|keys|length" }, {})
    expect(res.content.startsWith("ERROR: invalid jq")).toBe(true)
  })

  test("gh_file.execute rejects an oversized path", async () => {
    const res = await tools.gh_file.execute({ repo: "a/b", path: "x".repeat(1025) }, {})
    expect(res.content).toBe("ERROR: invalid path")
  })

  test("gh_search_repos.execute rejects a leading-dash query", async () => {
    const res = await tools.gh_search_repos.execute({ query: "-flag" }, {})
    expect(res.content).toBe("ERROR: invalid query")
  })
})
