import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const moduleURL = new URL('./command-center.ts', import.meta.url).href;
const resolver = fileURLToPath(new URL('../../work-plans/scripts/plan-root.sh', import.meta.url));

async function scenario(body: string): Promise<Record<string, unknown>> {
  const directory = await mkdtemp(join(tmpdir(), 'h2h-controller-test-'));
  const setup = `
    import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
    import { join, dirname, basename } from 'node:path';
    import { execFileSync } from 'node:child_process';
    import { handleControl } from ${JSON.stringify(moduleURL)};
    const cwd = ${JSON.stringify(repository)};
    const root = execFileSync('bash', [${JSON.stringify(resolver)}], {cwd, encoding:'utf8'}).trim();
    const owner = {harness:'omp',session_id:'controller-test-owner',cwd};
    const other = {...owner,session_id:'controller-test-other'};
    const request = {goal_id:'fixture-goal'};
    const spec = {goal:'Read-only fixture',acceptance:['Required outcome evidenced'],approval_revision:'gate-1',max_running_coordinators:1,plans:[{
      plan_id:'alpha',approved_revision:'plan-1',scope:{in:['Read fixture'],out:['Repository mutation']},acceptance:['Read fixture'],
      runtime:{harness:'omp',runtime_version:'18.12.6',model:null},lifecycle_permissions:['launch','stop'],worktree:cwd,
    }]};
    function prepare(state='PLAN') {
      const dir=join(root,'alpha'); mkdirSync(dir,{recursive:true});
      writeFileSync(join(dir,'plan.md'),'# Fixture\\n## Scope\\nIn: read fixture\\nOut: repository mutation\\n');
      writeFileSync(join(dir,'status.md'),'state: '+state+'\\nts: 1000\\nmsg: fixture\\n');
      writeFileSync(join(dir,'report.md'),'# Report: alpha\\nresult: done\\ntests: fixture evidence\\n');
      return dir;
    }
  `;
  try {
    const child = Bun.spawn(['bun', '--eval', setup + body], {
      cwd: repository,
      env: { ...process.env, XDG_STATE_HOME: join(directory, 'state'), WORK_PLANS_H2H_ROLE: 'center' },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Controller scenario failed (${code}): ${stderr}`);
    return JSON.parse(stdout.trim()) as Record<string, unknown>;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('command-center ownership and acceptance', () => {
  test('unknown status does not create tracking or manager state', async () => {
    const result = await scenario(`
      const result = await handleControl({...request,action:'status'},owner);
      console.log(JSON.stringify({exists:result.exists,tracking_created:existsSync(root),manager_created:existsSync(join(dirname(root),'.goals',basename(root)))}));
    `);
    expect(result).toEqual({ exists: false, tracking_created: false, manager_created: false });
  });

  test('foreign manager can observe but cannot revise an owned goal', async () => {
    const result = await scenario(`
      prepare();
      await handleControl({...request,action:'create_goal',payload:{spec}},owner);
      const before = await handleControl({...request,action:'status'},owner);
      const view = await handleControl({...request,action:'status'},other);
      let rejected=false;
      try { await handleControl({...request,action:'revise_goal',payload:{spec:{...spec,approval_revision:'gate-2'}}},other); } catch { rejected=true; }
      const after = await handleControl({...request,action:'status'},owner);
      console.log(JSON.stringify({rejected,read_only:view.read_only,before_revision:before.record.approval_revision,after_revision:after.record.approval_revision,owner:after.record.manager.session_id}));
    `);
    expect(result).toEqual({ rejected: true, read_only: true, before_revision: 'gate-1', after_revision: 'gate-1', owner: 'controller-test-owner' });
  });

  test('coordinator role cannot create a recursive center', async () => {
    const result = await scenario(`
      prepare();
      process.env.WORK_PLANS_H2H_ROLE='coordinator';
      let rejected=false;
      try { await handleControl({...request,action:'create_goal',payload:{spec}},owner); } catch { rejected=true; }
      console.log(JSON.stringify({rejected,manager_created:existsSync(join(dirname(root),'.goals',basename(root)))}));
    `);
    expect(result).toEqual({ rejected: true, manager_created: false });
  });

  test('relative and nested coordinator paths fail before launch ownership is reserved', async () => {
    for (const worktree of ['.', join(repository, 'config')]) {
      const result = await scenario(`
        prepare();
        spec.plans[0].worktree=${JSON.stringify(worktree)};
        await handleControl({...request,action:'create_goal',payload:{spec}},owner);
        const before=await handleControl({...request,action:'status'},owner);
        let rejected=false;
        try { await handleControl({...request,action:'start',plan_id:'alpha',request_id:'unsafe-path'},owner); } catch { rejected=true; }
        const after=await handleControl({...request,action:'status'},owner);
        console.log(JSON.stringify({rejected,coordinator:after.record.plans[0].coordinator,journal_unchanged:before.record.applied_seq===after.record.applied_seq}));
      `);
      expect(result).toEqual({ rejected: true, coordinator: null, journal_unchanged: true });
    }
  });

  test('verified adopted child outcome does not implicitly complete the goal', async () => {
    const result = await scenario(`
      const dir=prepare('DONE');
      const originalReport=readFileSync(join(dir,'report.md'),'utf8');
      spec.plans[0].adoption={state:'DONE',evidence:['fixture-read'],report_path:join(dir,'report.md')};
      await handleControl({...request,action:'create_goal',payload:{spec}},owner);
      const before=await handleControl({...request,action:'status'},owner);
      const done=await handleControl({...request,action:'complete_goal',payload:{approval_revision:'gate-1',evidence:['Required outcome evidenced']}},owner);
      const after=await handleControl({...request,action:'status'},owner);
      console.log(JSON.stringify({before:before.record.completion,completed:after.record.completion.approval_revision,aggregate_exists:existsSync(done.report_path),child_report_preserved:readFileSync(join(dir,'report.md'),'utf8')===originalReport}));
    `);
    expect(result).toEqual({ before: null, completed: 'gate-1', aggregate_exists: true, child_report_preserved: true });
  });
});
