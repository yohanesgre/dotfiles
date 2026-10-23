import { expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { CoordinatorStore, CoordinatorStateError, type GoalSpec } from './coordinator-state';

test('competing OS processes reserve one owner and process exit does not expire its intent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'h2h-owner-race-'));
  const repo_root = join(directory, 'repo');
  const plan_root = join(directory, 'state/work-plans/repo-race');
  mkdirSync(repo_root, { recursive: true });
  mkdirSync(join(plan_root, 'alpha'), { recursive: true });
  const spec: GoalSpec = {
    goal: 'Competing controllers', acceptance: ['Exactly one plan owner'], approval_revision: 'gate-1', max_running_coordinators: 1,
    plans: [{ plan_id: 'alpha', approved_revision: 'plan-1', scope: { in: ['Ownership fixture'], out: ['Real process dispatch'] },
      acceptance: ['One owner'], runtime: { harness: 'omp', runtime_version: '18.12.6', model: null }, lifecycle_permissions: ['launch', 'stop'] }],
  };
  const options = ['a', 'b'].map(id => ({ repo_root, plan_root, goal_id: `race-${id}`, manager: { harness: 'omp', session_id: `manager-${id}` } }));
  const source = new URL('./coordinator-state.ts', import.meta.url).href;
  const children: ChildProcess[] = [];
  const exits: Array<Promise<unknown>> = [];
  try {
    for (const option of options) new CoordinatorStore(option).createGoal(spec);
    const workers = options.map((option, index) => {
      const program = `
        import {CoordinatorStore} from ${JSON.stringify(source)};
        const store=new CoordinatorStore(${JSON.stringify(option)});
        process.stdin.once('data',()=>{
          const result=store.reserve('alpha',${JSON.stringify(`request-${index}`)});
          process.stdin.pause();
          process.stdout.write(JSON.stringify(result)+'\\n',()=>process.exit(0));
        });
        process.stdout.write('READY\\n');
      `;
      const child = spawn(process.execPath, ['--eval', program], { stdio: ['pipe', 'pipe', 'pipe'] });
      children.push(child);
      const exited = once(child, 'exit');
      exits.push(exited);
      let stderr = '';
      child.stderr!.on('data', chunk => { stderr += chunk.toString(); });
      const lines = createInterface({ input: child.stdout! })[Symbol.asyncIterator]();
      return { child, exited, lines, error: () => stderr };
    });
    await Promise.all(workers.map(async worker => {
      const line = await worker.lines.next();
      if (line.value !== 'READY') throw new Error('Reservation worker failed its startup barrier');
    }));
    for (const worker of workers) worker.child.stdin!.end('GO\n');
    const results = await Promise.all(workers.map(async worker => {
      const line = await worker.lines.next();
      const [code] = await worker.exited;
      if (code !== 0 || !line.value) throw new Error(`Reservation worker failed: ${worker.error()}`);
      return JSON.parse(line.value) as { status: string; reasons?: Array<{ kind: string }> };
    }));
    expect(results.map(result => result.status).sort()).toEqual(['blocked', 'reserved']);
    expect(results.find(result => result.status === 'blocked')?.reasons?.some(reason => reason.kind === 'owned_elsewhere')).toBe(true);

    const later = new CoordinatorStore({ repo_root, plan_root, goal_id: 'race-later', manager: { harness: 'opencode', session_id: 'new-manager' }, now: () => Date.now() + 86400000 });
    let conflict: unknown;
    try { later.createGoal(spec); } catch (error) { conflict = error; }
    expect(conflict instanceof CoordinatorStateError && conflict.code === 'conflict').toBe(true);
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.allSettled(exits);
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
