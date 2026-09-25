import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const encoder = new TextEncoder();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test(
  "watcher reports a mapped pane, then releases it on SIGTERM",
  async () => {
    const tmp = mkdtempSync(join(tmpdir(), "depth-live-"));
    const stateDir = join(tmp, "state");
    const dir = join(tmp, "repo");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(dir, { recursive: true });

    const cliLog = join(tmp, "cli.log");
    const fakeCli = join(tmp, "luvus");
    writeFileSync(fakeCli, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${cliLog}"\nexit 0\n`, "utf8");
    chmodSync(fakeCli, 0o755);

    const sockPath = join(tmp, "luvus.sock");
    const uhp = createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const request = JSON.parse(line) as { id?: string };
          const result = {
            event_sequence: 1,
            workspaces: [
              {
                cwd: dir,
                tabs: [
                  {
                    panes: [
                      {
                        pane_id: "30",
                        agent: "opencode",
                        agent_session: "ses_root",
                        cwd: dir,
                        kind: "terminal",
                        focused: true,
                        root_process: { pid: 1, start_marker: "x" },
                        agent_authority: null,
                        agent_status: "idle",
                      },
                    ],
                  },
                ],
              },
            ],
          };
          socket.write(`${JSON.stringify({ id: request.id, result })}\n`);
          newline = buffer.indexOf("\n");
        }
      });
    });
    await new Promise<void>((resolve) => uhp.listen(sockPath, resolve));

    let port = 0;
    const http = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        const json = (value: unknown) =>
          new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
        if (path === "/api/info") return json({ version: "test", urls: [`http://127.0.0.1:${port}`] });
        if (path === "/api/session") {
          return json({
            data: [{ id: "ses_root", parentID: null, agent: "opencode", title: "root", location: { directory: dir }, time: { created: 1, updated: 1 } }],
            cursor: {},
          });
        }
        if (path === "/api/session/active") return json({ data: {} });
        if (path === "/api/permission/request") return json({ location: {}, data: [] });
        if (path === "/api/event") {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(": heartbeat\n\n"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    port = http.port ?? 0;

    const servicePath = join(tmp, "service.json");
    writeFileSync(servicePath, JSON.stringify({ id: "test", password: "testpass", pid: 0, url: `http://127.0.0.1:${port}`, version: "test" }));

    const watcherPath = fileURLToPath(new URL("../src/watcher.ts", import.meta.url));
    const proc = Bun.spawn([process.execPath, "run", watcherPath], {
      cwd: tmp,
      env: {
        ...process.env,
        LUVUS_BIN_PATH: fakeCli,
        LUVUS_SOCKET_PATH: sockPath,
        LUVUS_MODULE_STATE_DIR: stateDir,
        OPENCODE_SERVICE_FILE: servicePath,
        LUVUS_SETTING_TTL_S: "900",
        LUVUS_SETTING_BAR: "false",
        LUVUS_SETTING_TITLE: "false",
      },
      stdout: "ignore",
      stderr: "ignore",
    });

    try {
      const deadline = Date.now() + 8000;
      let reported = false;
      while (Date.now() < deadline) {
        if (existsSync(cliLog) && readFileSync(cliLog, "utf8").includes("agent report")) {
          reported = true;
          break;
        }
        await sleep(100);
      }
      expect(reported).toBe(true);

      proc.kill("SIGTERM");
      const code = await proc.exited;
      expect(code).toBe(0);
      expect(readFileSync(cliLog, "utf8")).toContain("agent release");
    } finally {
      proc.kill("SIGKILL");
      http.stop(true);
      await new Promise<void>((resolve) => uhp.close(() => resolve()));
    }
  },
  20_000,
);
