#!/usr/bin/env bash
# Self-test for plan-root.sh: external tracking-root identity and path rules.
# Hermetic: temporary HOME/XDG_STATE_HOME, temporary Git repositories, no network.
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RESOLVER="$SCRIPT_DIR/plan-root.sh"

TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT

PASS=0
fail() { echo "SELFTEST FAIL: $*" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); echo "ok - $*"; }
contains() { grep -Fq -- "$2" <<<"$1"; }

[ -f "$RESOLVER" ] || fail "plan-root.sh not found at $RESOLVER"

HOME_TMP="$TMP/home"
mkdir -p "$HOME_TMP"

OUT=""
ERR=""
RC=0
# resolve <cwd> [env args...] — caller supplies HOME/XDG_STATE_HOME explicitly.
resolve() {
  local dir=$1; shift
  OUT=$(cd "$dir" && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR \
    -u XDG_STATE_HOME -u HOME GIT_CEILING_DIRECTORIES="$TMP" \
    "$@" bash "$RESOLVER" 2>"$TMP/err")
  RC=$?
  ERR=$(cat "$TMP/err")
}

init_repo() {
  mkdir -p "$1"
  git -C "$1" init -q || fail "git init failed for $1"
  git -C "$1" -c user.name=selftest -c user.email=selftest@example.invalid \
    commit -q --allow-empty -m init || fail "git commit failed for $1"
}

# Independent oracle for the expected root (name + full SHA-256 of canonical common dir).
expected_root() {
  local repo=$1 xdg=$2 common canonical readable name hash
  common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
  canonical=$(realpath -e -- "$common")
  readable=$(basename -- "$(dirname -- "$canonical")")
  name=$(printf '%s' "$readable" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//')
  [ -n "$name" ] || name=repo
  hash=$(printf '%s' "$canonical" | sha256sum | awk '{print $1}')
  realpath -m -- "${xdg%/}/work-plans/${name}-${hash}"
}

# --- (a) main checkout: absolute root built from XDG override ----------------
A="$TMP/a/proj"
init_repo "$A"
XA="$TMP/state-a"
resolve "$A" HOME="$HOME_TMP" XDG_STATE_HOME="$XA"
[ "$RC" -eq 0 ] || fail "(a) resolver failed: $ERR"
A_ROOT="$OUT"
EXPECT=$(expected_root "$A" "$XA")
[ "$OUT" = "$EXPECT" ] || fail "(a) root mismatch: got '$OUT' want '$EXPECT'"
case "$OUT" in /*) ;; *) fail "(a) root is not absolute: '$OUT'" ;; esac
[ "$(printf '%s\n' "$OUT" | wc -l)" -eq 1 ] || fail "(a) root is not exactly one line"
[[ "$OUT" =~ -[0-9a-f]{64}$ ]] || fail "(a) root lacks a full sha256 suffix: '$OUT'"
contains "$OUT" "/work-plans/proj-" || fail "(a) root lacks sanitized repo name: '$OUT'"
ok "(a) main checkout resolves an absolute hashed root under XDG_STATE_HOME"

# --- (b) linked worktree and nested dir resolve the same root ----------------
mkdir -p "$TMP/linked"
git -C "$A" worktree add -q "$TMP/linked/wt" -b lane || fail "(b) worktree add failed"
resolve "$TMP/linked/wt" HOME="$HOME_TMP" XDG_STATE_HOME="$XA"
[ "$RC" -eq 0 ] || fail "(b) resolver failed in linked worktree: $ERR"
[ "$OUT" = "$A_ROOT" ] || fail "(b) linked worktree root '$OUT' != control root '$A_ROOT'"
mkdir -p "$TMP/linked/wt/sub/dir"
resolve "$TMP/linked/wt/sub/dir" HOME="$HOME_TMP" XDG_STATE_HOME="$XA"
[ "$OUT" = "$A_ROOT" ] || fail "(b) nested worktree dir root '$OUT' != control root '$A_ROOT'"
ok "(b) linked worktree and nested dirs share the control checkout root"

# --- (c) separate same-name repositories do not collide ----------------------
B="$TMP/b/proj"
init_repo "$B"
resolve "$B" HOME="$HOME_TMP" XDG_STATE_HOME="$XA"
[ "$RC" -eq 0 ] || fail "(c) resolver failed for second repo: $ERR"
[ "$OUT" != "$A_ROOT" ] || fail "(c) same-name repositories collided on '$OUT'"
contains "$OUT" "/work-plans/proj-" || fail "(c) second repo lacks readable name: '$OUT'"
ok "(c) separate repositories with the same directory name get distinct roots"

# --- (d) unset XDG_STATE_HOME falls back to HOME/.local/state ----------------
HB="$TMP/home-b"
mkdir -p "$HB"
resolve "$A" HOME="$HB"
[ "$RC" -eq 0 ] || fail "(d) resolver failed without XDG_STATE_HOME: $ERR"
[ "$OUT" = "$(expected_root "$A" "$HB/.local/state")" ] \
  || fail "(d) fallback root mismatch: '$OUT'"
ok "(d) unset XDG_STATE_HOME falls back to HOME/.local/state"

# --- (e) empty XDG_STATE_HOME also falls back --------------------------------
resolve "$A" HOME="$HB" XDG_STATE_HOME=
[ "$RC" -eq 0 ] || fail "(e) resolver failed with empty XDG_STATE_HOME: $ERR"
[ "$OUT" = "$(expected_root "$A" "$HB/.local/state")" ] \
  || fail "(e) empty XDG fallback root mismatch: '$OUT'"
ok "(e) empty XDG_STATE_HOME falls back to HOME/.local/state"

# --- (f) spaces in repo and state paths are preserved -----------------------
S="$TMP/space repo"
init_repo "$S"
XS="$TMP/xdg state"
resolve "$S" HOME="$HOME_TMP" XDG_STATE_HOME="$XS"
[ "$RC" -eq 0 ] || fail "(f) resolver failed on spaced paths: $ERR"
[ "$OUT" = "$(expected_root "$S" "$XS")" ] || fail "(f) spaced root mismatch: '$OUT'"
contains "$OUT" "$(realpath -m -- "$XS")/work-plans/space-repo-" || fail "(f) spaced XDG or sanitized name lost: '$OUT'"
ok "(f) spaces in repository and state paths are preserved"

# --- (g) non-repository invocation fails clearly -----------------------------
NR="$TMP/notrepo"
mkdir -p "$NR"
resolve "$NR" HOME="$HOME_TMP" XDG_STATE_HOME="$XA"
[ "$RC" -ne 0 ] || fail "(g) expected failure outside a Git repository"
[ -z "$OUT" ] || fail "(g) resolver printed a root outside Git: '$OUT'"
contains "$ERR" "not inside a Git work tree" || fail "(g) missing clear non-repo diagnostic: $ERR"
ok "(g) non-repository invocation fails without falling back to cwd"

# --- (h) relative XDG_STATE_HOME is rejected --------------------------------
resolve "$A" HOME="$HOME_TMP" XDG_STATE_HOME="relative/state"
[ "$RC" -ne 0 ] || fail "(h) expected failure for relative XDG_STATE_HOME"
[ -z "$OUT" ] || fail "(h) resolver printed a root for relative XDG: '$OUT'"
contains "$ERR" "must be an absolute path" || fail "(h) missing absolute-path diagnostic: $ERR"
ok "(h) non-empty relative XDG_STATE_HOME is rejected"

# --- (i) missing HOME and XDG fails clearly ---------------------------------
resolve "$A"
[ "$RC" -ne 0 ] || fail "(i) expected failure with neither HOME nor XDG_STATE_HOME"
contains "$ERR" "neither XDG_STATE_HOME nor HOME is set" \
  || fail "(i) missing env diagnostic: $ERR"
ok "(i) missing HOME and XDG_STATE_HOME fails clearly"

# --- (j) resolution performs no filesystem writes ---------------------------
XZ="$TMP/state-now"
Z="$TMP/now/proj"
init_repo "$Z"
BEFORE=$(find "$TMP/now" "$XZ" -print 2>/dev/null | sort)
REPO_BEFORE=$(git -C "$Z" status --porcelain)
resolve "$Z" HOME="$HOME_TMP" XDG_STATE_HOME="$XZ"
[ "$RC" -eq 0 ] || fail "(j) resolver failed: $ERR"
AFTER=$(find "$TMP/now" "$XZ" -print 2>/dev/null | sort)
[ "$BEFORE" = "$AFTER" ] || fail "(j) resolver changed the filesystem"
[ ! -e "$XZ" ] || fail "(j) resolver created the state directory '$XZ'"
[ ! -e "$XZ/work-plans" ] || fail "(j) resolver created the work-plans directory"
[ -z "$REPO_BEFORE" ] || fail "(j) fixture repo was already dirty"
[ -z "$(git -C "$Z" status --porcelain)" ] || fail "(j) resolver dirtied the repo"
ok "(j) root resolution creates nothing"

# --- (k) absolute XDG_STATE_HOME physically inside a checkout is rejected ---
for inside in "$A" "$A/state" "$A/.git" "$A/.git/state" "$TMP/linked/wt/state"; do
  resolve "$A" HOME="$HOME_TMP" XDG_STATE_HOME="$inside"
  [ "$RC" -ne 0 ] || fail "(k) expected rejection for in-repo state root '$inside'"
  [ -z "$OUT" ] || fail "(k) resolver printed a root for in-repo state '$inside': '$OUT'"
  contains "$ERR" "physically inside" \
    || fail "(k) missing containment diagnostic for '$inside': $ERR"
done
resolve "$TMP/linked/wt" HOME="$HOME_TMP" XDG_STATE_HOME="$TMP/linked/wt/state"
[ "$RC" -ne 0 ] || fail "(k) expected rejection from a linked worktree"
contains "$ERR" "physically inside" || fail "(k) missing worktree containment diagnostic: $ERR"
[ ! -e "$A/state" ] || fail "(k) rejection created '$A/state'"
[ ! -e "$A/.git/state" ] || fail "(k) rejection created '$A/.git/state'"
[ ! -e "$TMP/linked/wt/state" ] || fail "(k) rejection created a linked-worktree state dir"
ok "(k) absolute state roots inside the checkout or its metadata are rejected"

# --- (l) symlink aliases of a checkout are rejected physically --------------
ln -s "$A" "$TMP/repo-link" || fail "(l) cannot create repo symlink"
resolve "$A" HOME="$HOME_TMP" XDG_STATE_HOME="$TMP/repo-link"
[ "$RC" -ne 0 ] || fail "(l) expected rejection for a symlink to the checkout"
contains "$ERR" "physically inside" || fail "(l) missing symlink containment diagnostic: $ERR"

ln -s "$A" "$TMP/anc-link" || fail "(l) cannot create ancestor symlink"
resolve "$A" HOME="$HOME_TMP" XDG_STATE_HOME="$TMP/anc-link/state"
[ "$RC" -ne 0 ] || fail "(l) expected rejection through an ancestor symlink"
contains "$ERR" "physically inside" || fail "(l) missing ancestor containment diagnostic: $ERR"

ln -s "$TMP/linked/wt" "$TMP/wt-link" || fail "(l) cannot create worktree symlink"
resolve "$A" HOME="$HOME_TMP" XDG_STATE_HOME="$TMP/wt-link/state"
[ "$RC" -ne 0 ] || fail "(l) expected rejection for a symlink to a linked worktree"
contains "$ERR" "physically inside" || fail "(l) missing worktree symlink diagnostic: $ERR"
ok "(l) external symlink aliases of a checkout are rejected by physical path"

# --- (m) external XDG symlink is accepted and printed canonically -----------
REAL="$TMP/state-real"
mkdir -p "$REAL"
ln -s "$REAL" "$TMP/state-link" || fail "(m) cannot create external state symlink"
resolve "$A" HOME="$HOME_TMP" XDG_STATE_HOME="$TMP/state-link"
[ "$RC" -eq 0 ] || fail "(m) resolver rejected a physically external symlink: $ERR"
[ "$OUT" = "$(expected_root "$A" "$REAL")" ] \
  || fail "(m) root is not canonical/physical: got '$OUT'"
contains "$OUT" "$REAL/work-plans/proj-" || fail "(m) canonical root lost its target: '$OUT'"
[ ! -e "$REAL/work-plans" ] || fail "(m) resolver created the canonical state directory"
ok "(m) physically external XDG symlink is accepted and returned canonically"

# --- (n) tracking root symlinked into a checkout is rejected -----------------
TRAP="$TMP/state-trap"
mkdir -p "$TRAP"
ln -s "$A" "$TRAP/work-plans" || fail "(n) cannot create trapped work-plans symlink"
resolve "$A" HOME="$HOME_TMP" XDG_STATE_HOME="$TRAP"
[ "$RC" -ne 0 ] || fail "(n) expected rejection for a tracking root inside the checkout"
contains "$ERR" "tracking root is physically inside" \
  || fail "(n) missing tracking-root containment diagnostic: $ERR"
ok "(n) tracking root physically inside a checkout is rejected"

# --- (o) a repository root cannot alias another repository's state ----------
ALIAS_STATE="$TMP/state-alias"
A_ALIAS="$(expected_root "$A" "$ALIAS_STATE")"
B_STORE="$(expected_root "$B" "$ALIAS_STATE")"
mkdir -p "$B_STORE"
printf 'untouched\\n' > "$B_STORE/marker"
ln -s "$B_STORE" "$A_ALIAS"
resolve "$A" HOME="$HOME_TMP" XDG_STATE_HOME="$ALIAS_STATE"
[ "$RC" -ne 0 ] && [ -z "$OUT" ] || fail "(o) adopted another repository's store"
contains "$ERR" "must not be a symlink" || fail "(o) missing identity-alias diagnostic"
[ -L "$A_ALIAS" ] && [ "$(cat "$B_STORE/marker")" = 'untouched\n' ] \
  || fail "(o) identity rejection mutated either store"
ok "(o) hashed repository-root symlink cannot adopt another external store"

# --- (p) namespace links below a canonical state base are also rejected -----
NAMESPACE_STATE="$TMP/state-namespace"
mkdir -p "$NAMESPACE_STATE" "$TMP/shared-tracking"
ln -s "$TMP/shared-tracking" "$NAMESPACE_STATE/work-plans"
resolve "$A" HOME="$HOME_TMP" XDG_STATE_HOME="$NAMESPACE_STATE"
[ "$RC" -ne 0 ] && [ -z "$OUT" ] || fail "(p) accepted symlinked work-plans namespace"
contains "$ERR" "namespace must not be a symlink" || fail "(p) missing namespace diagnostic"
[ -z "$(find "$TMP/shared-tracking" -mindepth 1 -print)" ] \
  || fail "(p) namespace rejection created tracking files"
ok "(p) symlinked tracking namespace is rejected without writes"

echo
echo "all $PASS checks passed"
exit 0
