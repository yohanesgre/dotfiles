import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { handleControl } from '../../skills/goal/runtime/command-center';

type ToolContext = {
  sessionID: string;
  signal: AbortSignal;
  progress(value: unknown): Promise<void>;
};
type PluginContext = {
  session: { get(input: { sessionID: string }): Promise<{ location?: { directory?: string } }> };
  tool: {
    transform(callback: (editor: {
      add(definition: {
        name: string;
        description: string;
        input: Record<string, unknown>;
        options: { codemode: boolean };
        execute(input: unknown, context: ToolContext): Promise<{ content: string }>;
      }): void;
    }) => void): Promise<{ dispose(): Promise<void> }>;
  };
};

export default {
  id: 'goal-coordinators',
  async setup(ctx: PluginContext) {
    let runtime: Promise<{ handleControl: typeof handleControl }> | undefined;
    const registration = await ctx.tool.transform(editor => {
      editor.add({
        name: 'h2h_control',
        description: 'Manage /goal plan coordinators through shared H2H. Pass request with action and goal_id; plan mutations also need plan_id and stable request_id. Actions: create_goal, revise_goal, complete_goal, status, start, send, permission, cancel, stop, reconcile, wait, verify, reopen_plan. Start obtains no-work ACK; send starts work. Review pending permission scope through status before allowing. Frozen approval required; cancel is not shutdown.',
        input: {
          type: 'object',
          properties: { request: { type: 'object', additionalProperties: true } },
          required: ['request'],
          additionalProperties: false,
        },
        options: { codemode: true },
        async execute(input, context) {
          if (!context.sessionID) throw new Error('H2H requires an authoritative current OpenCode session');
          const session = await ctx.session.get({ sessionID: context.sessionID });
          const cwd = session.location?.directory;
          if (!cwd) throw new Error('H2H cannot resolve the current OpenCode session directory');
          const api = await (runtime ??= import(pathToFileURL(join(
            process.env.WORK_PLANS_H2H_RUNTIME
              ? resolve(process.env.WORK_PLANS_H2H_RUNTIME)
              : join(homedir(), '.agents/skills/goal/runtime'),
            'command-center.ts',
          )).href));
          if (!input || typeof input !== 'object' || !('request' in input)) throw new Error('Missing H2H request');
          const result = await api.handleControl(input.request, {
            harness: 'opencode', session_id: context.sessionID, cwd,
          }, { signal: context.signal, progress: context.progress.bind(context) });
          return { content: JSON.stringify(result) };
        },
      });
    });
    return () => registration.dispose();
  },
};
