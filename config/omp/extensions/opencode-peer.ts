// opencode-peer — agent-to-agent delegation.
//
// An OMP session (this harness) hands a prompt to an OpenCode agent and gets the
// reply back, so OpenCode's free models are usable from OMP without a provider
// shim. Conversation continuity is kept per `peer` name, so a peer accumulates
// context across calls the way a colleague would.
//
// Why a subprocess and not a provider/HTTP bridge (surveyed 2026-10-16):
//   * OpenCode's free tier is gated server-side. A direct call to
//     https://opencode.ai/inference/openai/v1/chat/completions with the stored
//     OPENCODE_API_KEY returns 403 FreeTierError ("OpenCode's free tier can only
//     be used from within OpenCode"). No client header clears it — the
//     2026-10-11 survey tried x-opencode-session/-client/-project, X-Session-Id,
//     x-session-affinity and several User-Agents.
//   * The local server's stateless POST /api/experimental/generate returns 503
//     ServiceUnavailableError for the same models, and a session-bound
//     POST /api/session/{id}/generate is text-only (no tool calls), so neither is
//     a usable provider transport.
//   * `opencode run` works: it is the real client, so the gateway accepts it.
//
// Session continuity and the free-tier gate: `opencode run` MINTS the session id
// (ses_...) on the first turn, and reusing that id with `-s` continues the
// conversation. A caller-supplied/nonexistent id is rejected by the same gate
// (403 FreeTierError), so the id is always read back out of the event stream and
// never invented here. Ids live in module state, which OMP shares across subagent
// sessions (extension factories are rebound, module-level variables are not).
//
// Permissions: the peer runs under OpenCode's own permission envelope, not OMP's.
// On this box config/opencode/opencode.jsonc sets a global `permission: allow`,
// so `agent` selects the envelope rather than granting one:
//   "plan" (default) — no file edits; may still run read/shell tools.
//   "build" / other  — write-capable; pass it deliberately.
//
// A peer turn is not side-effect free, and its reach is wider than `cwd`: the
// peer inherits every configured MCP. Observed 2026-10-16 — the prompt
// "Remember the code word MANGO" made the peer call its `execute` tool
// (OpenCode's JS sandbox) to run `tools.engram.mem_save({...})` and then
// `mem_judge`, i.e. it WROTE an observation into the real engram store for this
// project. The tool list in the result footer is what surfaces that.
// The extension's own smoke tests created observations #759/#760; both were
// hard-deleted with `engram delete <id> --hard`. Expect similar writes when a
// prompt looks like something worth remembering.
//
// Cost: the `*-free` rows are $0 (verified: cost 0 in step_finish), so a peer
// turn cannot bill. Passing a non-free model id is allowed but is your call.

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/** Shorthand → OpenCode model id. Add aliases here, not at call sites. */
const MODELS: Record<string, string> = {
	glm: "opencode/glm-5.3-flash-free",
	dsf: "opencode/deepseek-v4.1-flash-free",
	deepseek: "opencode/deepseek-v4.1-flash-free",
};

const DEFAULT_MODEL = "glm";
const DEFAULT_AGENT = "build";
const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_PROMPT_CHARS = 120_000;

/**
 * Signals that the free quota ran out — the one failure an account switch fixes.
 * Deliberately excludes the FreeTierError gate text ("can only be used from within
 * OpenCode"): that is a client-identity gate, not a quota, and no account switch
 * clears it. Observed in the client binary: `AI.Error.QuotaExceeded`,
 * `RateLimitError`, HTTP 429.
 */
const LIMIT_ERROR_RE =
	/QuotaExceeded|RateLimitError|rate[ _-]?limit|usage limit|limit reached|too many requests|\b429\b/i;

/**
 * Peer-scoped OpenCode server (systemd unit `opencode-peer-serve`,
 * home/modules/opencode/default.nix). Runs go here instead of the shared background service
 * because agent definitions resolve in the server that LOADS the config: the free-tier
 * subagent pins live in that unit's OPENCODE_CONFIG_CONTENT, so they apply to peer-spawned
 * subagents only — never to the user's own harness, which keeps the config-file pins.
 *
 * The pins are static; no jev or any other judgment runs here at runtime. The unit holds
 * the map and its jev_classify triage. Password is the unit's loopback-only value.
 *
 * If the server is down the tool fails and names the unit, rather than silently falling
 * back to the shared service (which would quietly move peer subagents onto the Go-tier
 * config-file pins).
 */
const PEER_SERVER = "http://127.0.0.1:49375";
const PEER_PASSWORD = "omp-peer-loopback-7f3c1d90b2";

/** peer name → OpenCode session id minted by `opencode run`. */
const sessions = new Map<string, string>();

/**
 * A lane maps to one OpenCode session, so two calls on the same lane must not run
 * concurrently — both would drive that one session and race the remembered id.
 * Each call chains onto its lane's tail; different lanes never block each other.
 */
const laneQueues = new Map<string, Promise<void>>();

function withLane<T>(peer: string, fn: () => Promise<T>): Promise<T> {
	const run = (laneQueues.get(peer) ?? Promise.resolve()).then(fn, fn);
	const settled = run.then(
		() => undefined,
		() => undefined,
	);
	laneQueues.set(peer, settled);
	void settled.then(() => {
		if (laneQueues.get(peer) === settled) laneQueues.delete(peer);
	});
	return run;
}

interface PeerRun {
	text: string;
	sessionId?: string;
	tools: string[];
	error?: string;
}

/**
 * Parse `opencode run --format json` NDJSON.
 *
 * Observed event types: step_start, text (part.text), tool_use (part.tool),
 * step_finish, error (error.message). `opencode run` exits 0 even when the
 * provider call failed, so provider failures MUST come from the stream.
 * Text parts are de-duplicated by part id in case of replay.
 */
/** Narrow a parsed JSON value to an object's own fields without `any`. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function parseRun(stdout: string): PeerRun {
	const parts: string[] = [];
	const seen = new Set<string>();
	const tools = new Set<string>();
	let sessionId: string | undefined;
	let error: string | undefined;

	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const event = asRecord(parsed);
		if (!event) continue;

		if (typeof event.sessionID === "string" && event.sessionID) {
			sessionId = event.sessionID;
		}
		const part = asRecord(event.part);
		switch (event.type) {
			case "text": {
				const text = part?.text;
				if (typeof text !== "string" || !text.trim()) break;
				const id = typeof part?.id === "string" ? part.id : `${parts.length}`;
				if (seen.has(id)) break;
				seen.add(id);
				parts.push(text.trim());
				break;
			}
			case "tool_use": {
				const tool = part?.tool;
				if (typeof tool === "string" && tool) tools.add(tool);
				break;
			}
			case "error": {
				const message = asRecord(event.error)?.message;
				error =
					typeof message === "string" && message ? message : "opencode run reported an error";
				break;
			}
		}
	}

	return { text: parts.join("\n\n"), sessionId, tools: [...tools], error };
}

/**
 * Stored credential labels for one integration, in listing order.
 * `opencode auth list --format json` is the machine-readable, secret-free form.
 * Environment connections are skipped — `auth switch` cannot activate those.
 */
async function credentialLabels(pi: ExtensionAPI, integrationId: string): Promise<string[]> {
	try {
		const result = await pi.exec("opencode", ["auth", "list", "--format", "json"], { timeout: 30_000 });
		const parsed: unknown = JSON.parse(result.stdout || "[]");
		if (!Array.isArray(parsed)) return [];
		const labels: string[] = [];
		for (const entry of parsed) {
			const integration = asRecord(entry);
			if (integration?.id !== integrationId || !Array.isArray(integration.connections)) continue;
			for (const connection of integration.connections) {
				const record = asRecord(connection);
				if (record?.type !== "credential") continue;
				if (typeof record.label === "string" && record.label) labels.push(record.label);
			}
		}
		return labels;
	} catch {
		return [];
	}
}

async function switchAccount(pi: ExtensionAPI, integrationId: string, label: string): Promise<boolean> {
	try {
		const result = await pi.exec("opencode", ["auth", "switch", integrationId, label], { timeout: 60_000 });
		return result.code === 0 && !result.killed;
	} catch {
		return false;
	}
}

export default function opencodePeer(pi: ExtensionAPI): void {
	const z = pi.zod;

	pi.setLabel("OpenCode peer");

	pi.registerTool({
		name: "opencode_peer",
		label: "OpenCode Peer",
		description:
			"Ask an OpenCode agent (free OpenCode-hosted model) and get its reply. " +
			"Runs the real `opencode` client, so it can use OpenCode's own tools in `cwd`. " +
			"Conversation context persists per `peer` name across calls; pass new=true to reset one. " +
			"Models: glm (glm-5.3-flash-free, default) or dsf (deepseek-v4.1-flash-free, faster); " +
			"both are $0 with a 200000-token context window and 32000 max output tokens. " +
			"Default agent is plan (no file edits).",
		parameters: z.object({
			prompt: z.string().describe("The message to send to the peer."),
			peer: z
				.string()
				.optional()
				.describe("Conversation lane; reuse the same name for continuity (default \"default\")."),
			model: z
				.string()
				.optional()
				.describe("Model alias (glm, dsf) or a full OpenCode provider/model id."),
			agent: z
				.string()
				.optional()
				.describe("OpenCode agent to run as (default plan; build is write-capable)."),
			cwd: z.string().optional().describe("Working directory for the peer (default this session's cwd)."),
			new: z.boolean().optional().describe("Drop any remembered session for this peer first."),
			timeout_ms: z.number().optional().describe("Overall timeout (default 600000)."),
			switch_auth: z
				.boolean()
				.optional()
				.describe(
					"On a free-limit error, rotate the OpenCode account with `opencode auth switch` and retry in place (default true).",
				),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const peer = (params.peer ?? "default").trim() || "default";
			const agent = (params.agent ?? DEFAULT_AGENT).trim() || DEFAULT_AGENT;
			const requested = (params.model ?? DEFAULT_MODEL).trim();
			const model = MODELS[requested.toLowerCase()] ?? (requested.includes("/") ? requested : undefined);
			if (!model) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Unknown model "${requested}". Use an alias (${Object.keys(MODELS).join(", ")}) or a full provider/model id.`,
						},
					],
					isError: true,
				};
			}

			const prompt = params.prompt;
			if (prompt.length > MAX_PROMPT_CHARS) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Prompt is ${prompt.length} chars; cap is ${MAX_PROMPT_CHARS}. Send the context as a file instead.`,
						},
					],
					isError: true,
				};
			}

			return withLane(peer, async () => {
				if (params.new) sessions.delete(peer);
				const integration = model.includes("/") ? model.slice(0, model.indexOf("/")) : model;
				const switchedTo: string[] = [];
				let labels: string[] | undefined;

				for (;;) {
					const sessionId = sessions.get(peer);

					// --server pins this run to the peer server (PEER_SERVER), whose config carries
					// the free-tier subagent map. Never the shared service: that one resolves the
					// user's own agent pins.
					const args = ["run", "--server", PEER_SERVER];
					args.push("--format", "json", "-m", model, "--agent", agent);
					if (sessionId) args.push("-s", sessionId);
					args.push(prompt);

					const started = Date.now();
					onUpdate?.({
						content: [{ type: "text" as const, text: `waiting on ${peer} (${model}, agent ${agent})…` }],
					});

					let stdout = "";
					let stderr = "";
					let code = -1;
					let killed = false;
					try {
						// pi.exec has no `env` option, so the peer server password rides in via env(1).
						const result = await pi.exec(
							"env",
							[`OPENCODE_PASSWORD=${PEER_PASSWORD}`, "opencode", ...args],
							{
								cwd: params.cwd ?? ctx.cwd,
								timeout: params.timeout_ms ?? DEFAULT_TIMEOUT_MS,
								signal,
							},
						);
						stdout = result.stdout ?? "";
						stderr = result.stderr ?? "";
						code = result.code;
						killed = result.killed;
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return {
							content: [{ type: "text" as const, text: `opencode peer failed to start: ${message}` }],
							isError: true,
							details: { peer, model, agent },
						};
					}

					const run = parseRun(stdout);
					if (run.sessionId) sessions.set(peer, run.sessionId);
					const elapsedMs = Date.now() - started;

					// Quota exhausted: rotate to the next stored account and retry in place.
					// Bounded by the credential count, and only when a switch is possible.
					if (run.error && params.switch_auth !== false && LIMIT_ERROR_RE.test(run.error)) {
						labels ??= await credentialLabels(pi, integration);
						const next = labels[switchedTo.length];
						if (labels.length > 1 && next !== undefined && (await switchAccount(pi, integration, next))) {
							switchedTo.push(next);
							onUpdate?.({
								content: [
									{
										type: "text" as const,
										text: `free limit hit — switched ${integration} auth to "${next}", retrying…`,
									},
								],
							});
							continue;
						}
					}

					if (run.error || (code !== 0 && !run.text)) {
						const detail = run.error ?? (killed ? `timed out after ${elapsedMs}ms` : stderr.trim() || `exit ${code}`);
						const serverDown = /ECONNREFUSED|connection refused|fetch failed|unable to connect/i.test(detail)
							? `\n\nPeer server ${PEER_SERVER} looks unreachable — start it with: systemctl --user start opencode-peer-serve`
							: "";
						const note = switchedTo.length
							? `\n\n[auth switched to ${switchedTo.map((label) => `"${label}"`).join(" → ")} after a limit error, and it still failed]`
							: "";
						return {
							content: [{ type: "text" as const, text: `opencode peer error: ${detail}${note}${serverDown}` }],
							isError: true,
							details: { peer, model, agent, sessionId: run.sessionId, elapsedMs, switchedAuth: switchedTo },
						};
					}

					const usedTools = run.tools.length > 0 ? `\n\n[peer used: ${run.tools.join(", ")}]` : "";
					const switchNote = switchedTo.length
						? `\n\n[auth switched to "${switchedTo[switchedTo.length - 1]}" after a free-limit error]`
						: "";
					return {
						content: [
							{ type: "text" as const, text: (run.text || "(peer returned no text)") + usedTools + switchNote },
						],
						details: {
							peer,
							model,
							agent,
							sessionId: run.sessionId,
							tools: run.tools,
							elapsedMs,
							fresh: !sessionId,
							switchedAuth: switchedTo,
						},
					};
				}
			});
		},
	});
}
