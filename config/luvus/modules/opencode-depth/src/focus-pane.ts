import { spawnSync } from "node:child_process";
import { resolveLuvusBin } from "./state.ts";

export const CLI_TIMEOUT_MS = 5000;

/** Dock rows carry a pane id; anything else is ignored rather than guessed. */
export function paneIdFromValue(value: string | undefined | null): string | null {
  const trimmed = (value ?? "").trim();
  return /^[1-9][0-9]{0,9}$/.test(trimmed) ? trimmed : null;
}

export function runFocusPane(
  deps: { env?: NodeJS.ProcessEnv; run?: (args: string[]) => { code: number } } = {},
): number {
  const env = deps.env ?? process.env;
  const paneId = paneIdFromValue(env.LUVUS_MODULE_ROW_VALUE);
  if (!paneId) {
    process.stderr.write("opencode.depth focus-pane: no valid pane id in LUVUS_MODULE_ROW_VALUE\n");
    return 0;
  }
  const run: (args: string[]) => { code: number } =
    deps.run ??
    ((args: string[]) => {
      const result = spawnSync(resolveLuvusBin(env), args, { encoding: "utf8", env, timeout: CLI_TIMEOUT_MS });
      return { code: result.status ?? 1 };
    });
  const result = run(["pane", "focus", paneId]);
  if (result.code !== 0) {
    process.stderr.write(`opencode.depth focus-pane: pane focus ${paneId} failed\n`);
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exit(runFocusPane());
