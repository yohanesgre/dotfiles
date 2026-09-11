---
name: git-workflow
description: 'Enforce git workflow rules and guardrails — single-trunk branching, commits, pushes, PRs, merge discipline, submodules, and release flow. Use whenever the user or agent touches git: creating branches/worktrees, committing, pushing, merging, tagging releases, handling submodules, or asks about git rules, commit conventions, or "boleh commit/push?".'
---

# Git Workflow — Rules & Guardrails

Generic git discipline for any project. Project-specific git rules — gate
commands, submodule layout, release process, lane/status protocol — live
in the project's `AGENTS.md`; where they conflict, the project's rules win.

## 0. Trigger

Use this skill whenever:
- creating/switching branches or worktrees
- staging/committing, writing commit messages
- pushing, force-pushing, merging, rebasing, cherry-picking
- tagging releases
- touching a submodule
- answering "boleh commit/push/merge?" or reviewing git history
- any `git` command that mutates remote or branch state

If you skip this skill, you will break a guardrail. Read it first.

## 1. Non-negotiable guardrails

These are never negotiable — report conflict, don't "fix" it yourself:

1. **Single trunk: `main` never receives direct commits.** Every task creates a new branch from `main`, work there, then PR → merge. Even docs/one-liners follow this.
2. **No commit unless user explicitly asked.** "commit this", "commit with message X", or orchestrator approval. Never auto-commit after edits — and never on `main`.
3. **No push unless user explicitly asked.** Never `git push`, `git push --force`, or `gh` publish without exact instruction.
4. **No merge/rebase/cherry-pick unless user explicitly asked.** Present options, wait for choice (see `finishing-a-development-branch` skill for merge menu — default is push + PR).
5. **No scope creep.** Only files/changes in the brief. If something missing, report — don't add tables/columns/endpoints/error codes.
6. **Names exact.** Table/column/error code/route/config key must match the project's docs verbatim.
7. **Submodules are commit-inside-first.** See §6.
8. **No secrets.** Never commit `.env`, `*.pem`, `*.private-key.pem`, credential/config tokens, or any secret. CI runs secret scanning — it will block.
9. **Phase gates green before commit/PR/tag.** See §3.2 and the project's declared gate.
10. **Authorization is per-action, never transitive.** "commit dan push" covers exactly commit + push — never branch create, worktree add, PR open, merge, rebase, or force-push. Each mutating step needs its own explicit ask. Approval envelopes (e.g. `/goal` execution gates) must enumerate every lifecycle step they pre-authorize, including the branch name.

Violation = stop and ask user. Never silent-fallback.

## 2. Branching — single trunk (`main`)

- `main` is single trunk — never commit directly. Every change (feat/fix/chore/docs/refactor, even 1-line) starts from `main` in a separate branch, then PR → merge to `main`. No exceptions — `chore(release)` and hotfixes also via branch + PR.
- Branch naming:
  - Worktree lanes (preferred for parallel/risky work): `omos/<slug>` → path `.worktrees/<slug>`.
  - Simple fix/feature (single lane, low risk): `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>` — kebab-case, short.
  - Swarm lanes: branch per lane slug (orchestrator assigns).
  - Release branch: `chore/release-vX.Y.Z` (or `release/<version>`) → PR to `main`, tag after merge (see §7).
- Flow: `git checkout main && git pull && git checkout -b <branch>` (or `git worktree add -b <branch> .worktrees/<slug> main`). Keep branch rebased on `main` if trunk moves: `git fetch && git rebase origin/main` (or merge `main` into branch) — never rewrite `main`.
- Before `git worktree add` or `git checkout -b`:
  ```bash
  git status --porcelain  # must decide: stash or commit dirty state?
  git branch -a | grep <name>  # no collision local/remote
  git worktree list  # no path collision
  grep ".worktrees" .gitignore  # must be ignored when using worktrees
  ```
- Ask user confirmation before `worktree add`, branch create/delete/rename, `prune`, or any destructive op (`reset --hard`, `clean`, `push --force`, removing dirty worktree).

## 3. Commit rules

### 3.1 Conventional commits (enforced)

```
<type>(<scope>): <subject>
```
- `type`: `feat`, `fix`, `refactor`, `docs`, `chore`, `ci`, `test`, `perf`, `build` — lower case, no custom types.
- `scope` optional, kebab or one word: `auth`, `board`, `sync`, `cli`, `schema`.
- `subject`: imperative, ≤50 chars, no period. Example: `feat(board): add WIP limit guard`
- Body (when needed): explains WHY, not WHAT. Wrap at ~72 chars.
- Breaking change: `feat!: drop Node 18` + `BREAKING CHANGE:` footer if migration needed.

Bad: `update fix`, `WIP`, `feat: stuff`. Good: `fix(sync): suppress echo via github_synced_state`.

### 3.2 Commit guardrail checklist (run before `git commit`)

Every commit must pass — if any fails, fix first, don't commit:

- [ ] The project's declared gate is green: typecheck, the test suites for touched areas, invariant checks, and the design build when design artifacts changed
- [ ] No `any` outside JSON boundaries, no stray debug logging, no secrets staged (`git diff --cached --name-only`)
- [ ] No file outside the task scope
- [ ] Commit message follows §3.1 and `git diff --cached --stat` matches intent

Run the project's one-shot gate script if it declares one (e.g. a `scripts/` gate script); otherwise run the project's documented commands.

### 3.3 Staging

- Stage explicitly: `git add <file> <file>` — never `git add -A` without reviewing `git status`.
- Verify staged: `git diff --cached` before committing.

## 4. Push rules

- No push without user saying "push", "push branch X", or picking the PR option in the finishing menu.
- Before push:
  ```bash
  git status
  git log --oneline origin/main..HEAD  # what you're about to publish
  git diff origin/main...HEAD --stat
  ```
- Never `push --force` on `main` or a shared branch. Force only on your own feature branch with explicit "force push" permission, and prefer `--force-with-lease`.
- Push naming: `git push -u origin <branch>` (or `HEAD:refs/heads/<branch>` for detached HEAD).

## 5. PR & merge rules — branch → PR → trunk

- Always `branch → push → PR → review → merge to main`. Never `commit on main` or `merge locally without PR` unless user explicitly says "merge locally" (then still via menu).
- Use the `finishing-a-development-branch` skill menu verbatim when work complete. Default choice = **2. Push and create PR** (trunk workflow). Option 1 (merge locally) only if user explicitly wants local integration without GitHub review.
- Branch must be green before PR: run the project's gate.
  ```bash
  git log --oneline origin/main..HEAD
  git diff origin/main...HEAD --stat
  ```
- PR: base = `main` (confirm if plan says otherwise), title = conventional commit style, description = what/why, docs conflicts (if any), gate outputs, testing notes. Use template if repo has one.
- After PR approved and CI green, merge via GitHub (squash or merge commit per repo setting — don't force-push to `main`). After `git merge <feature>` locally (only when user picks local merge), re-run the project's gate on the merged result before pushing.
- Never delete worktree/branch until PR merged or user typed `discard` (finishing skill rule). Keep worktree for PR feedback.

## 6. Submodules

- Never edit generated output inside a submodule.
- Edit source → run the submodule's build.
- Commit **inside** the submodule first:
  ```bash
  cd <submodule> && git add <files> && git commit -m "<type>(scope): <msg>" && git push
  cd .. && git add <submodule> && git commit -m "chore: bump <submodule> to <sha> (<desc>)"
  ```
- Parent commit must record the new pointer; the submodule must be pushed so clones resolve.
- If the project ports design tokens from a design artifact into app styles, do it in the same change (project rule).

## 7. Release (project-declared) — via branch + PR

Follow the project's release doc — never improvise:

1. Create branch `chore/release-vX.Y.Z` from `main`.
2. Fill the project's changelog(s) with dated sections.
3. Run the project's full gate on the branch.
4. Commit on branch: `chore(release): vX.Y.Z` (one commit, all bumps).
5. Push branch → PR to `main` → merge after review. Then on `main` (after pull):
   ```bash
   git tag -a vX.Y.Z -m "<one-line summary>"
   git push origin vX.Y.Z   # only after user approval
   ```
   Multiple release artifacts (e.g. web + CLI) use independent tags, both bumped in the same PR.
Direct tag/commit on `main` without PR is blocked — release also goes through branch + PR.

## 8. Emergency & recovery

- Bad commit on feature branch (not pushed): `git reset --soft HEAD~1` or `git commit --amend` with user approval.
- Bad push on feature branch: revert commit `git revert <sha>` preferred over force. Force only with explicit approval.
- Bad merge to `main`: `git revert -m 1 <merge-sha>` — never `reset --hard` on `main`.
- Secrets leaked: rotate the secret immediately, `git rm --cached` + commit, don't rewrite history without user + infra approval.

## 9. Quick reference

| Action | Needs user ask? | Gate |
|---|---|---|
| `worktree add` / branch create | yes | §2 checks |
| `git commit` | yes | §3.2 checklist + project gate |
| `git push` | yes | §4 checks |
| `git merge/rebase` | yes | menu + re-verify gate |
| `git tag` release | yes | §7 checklist |
| `push --force` | explicit "force" | `--force-with-lease` only |

When in doubt: stop, state what you'd do, ask. Guessing on git history is expensive to undo.
