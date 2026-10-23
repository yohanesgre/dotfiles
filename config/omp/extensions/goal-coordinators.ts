import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { handleControl } from '../../skills/goal/runtime/command-center';

export default function goalCoordinators(pi: ExtensionAPI): void {
  const z = pi.zod;
  let runtime: Promise<{ handleControl: typeof handleControl }> | undefined;

  // Input hooks precede builtin /goal dispatch; extension commands do not.
  // Keep explicit native controls separate from workflow intake.
  pi.on('input', event => {
    if (process.env.WORK_PLANS_H2H_ROLE === 'coordinator') return;
    const text = event.text.trim();
    if (/^\/goal\s+(?:set|show|pause|resume|drop|budget)(?:\s|$)/i.test(text)) return;
    const match = /^\/goal(?:\s+([\s\S]+))?$/i.exec(text);
    if (!match) return;
    return { text: match[1] ? `/skill:goal ${match[1].trim()}` : '/skill:goal' };
  });

  pi.registerTool({
    name: 'h2h_control',
    label: 'Plan coordinators',
    description: 'Manage /goal plan coordinators through shared H2H. Pass request with action and goal_id; plan mutations also need plan_id and stable request_id. Actions: create_goal, revise_goal, complete_goal, status, start, send, permission, cancel, stop, reconcile, wait, verify, reopen_plan. Start obtains no-work ACK; send starts work. Review pending permission scope through status before allowing. Frozen approval required; cancel is not shutdown.',
    parameters: z.object({ request: z.record(z.string(), z.unknown()) }),
    async execute(_id, { request }, signal, onUpdate, ctx) {
      const session_id = ctx.sessionManager.getSessionId();
      if (!session_id) throw new Error('H2H requires an authoritative current OMP session');
      const api = await (runtime ??= import(pathToFileURL(join(
        process.env.WORK_PLANS_H2H_RUNTIME
          ? resolve(process.env.WORK_PLANS_H2H_RUNTIME)
          : join(homedir(), '.agents/skills/goal/runtime'),
        'command-center.ts',
      )).href));
      const result = await api.handleControl(request, { harness: 'omp', session_id, cwd: ctx.cwd }, {
        signal,
        progress(value) {
          onUpdate?.({ content: [{ type: 'text', text: JSON.stringify(value) }], details: value });
        },
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  });
}
