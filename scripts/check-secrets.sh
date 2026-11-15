#!/usr/bin/env bash
# check-secrets.sh — fail fast if real secrets are staged or tracked.
# Usage:
#   bash scripts/check-secrets.sh --staged   # pre-commit: staged content only
#   bash scripts/check-secrets.sh            # validate/CI: all tracked files
#   bash scripts/check-secrets.sh --history  # one-off: every reachable blob
# Prints file:line + pattern only (never line content).
set -euo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

MODE=tracked
case "${1:-}" in
  --staged) MODE=staged ;;
  --history) MODE=history ;;
  "") ;;
  *)
    echo "usage: $0 [--staged|--history]" >&2
    exit 2
    ;;
esac

# Files that must never enter git (match .gitignore + key material).
BLOCKED_RE='(^|/)(\.env($|\.)|\.git-credentials|\.npmrc|\.pypirc|\.netrc|auth\.json|id_(rsa|ed25519|ecdsa|dsa)(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore|kdbx|age)$|config/private/)'
ALLOW_PATH_RE='(^|/)(\.env\.example|\.env\.toml\.example)$'

# Real-secret patterns. Min lengths avoid placeholders like sk-..., ghp_..., xoxp-...
SECRET_RES=(
  '-----BEGIN (RSA |OPENSSH |EC |PGP |DSA )?PRIVATE KEY-----'
  'AGE-SECRET-KEY-1[A-Z0-9]{58}'
  '(^|[^A-Za-z0-9])sk-(proj-|ant-)?[A-Za-z0-9_-]{20,}'
  'gh[pousr]_[A-Za-z0-9]{20,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  'glpat-[A-Za-z0-9_-]{20,}'
  'npm_[A-Za-z0-9]{36}'
  'pypi-[A-Za-z0-9_-]{20,}'
  'dop_v1_[a-f0-9]{64}'
  'SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
  'AIza[0-9A-Za-z_-]{35}'
  'AKIA[0-9A-Z]{16}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  '[MN][A-Za-z0-9]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}'
  "(TOKEN|SECRET|API_KEY|APIKEY|API_TOKEN|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|BOT_TOKEN|PASSWORD|PASSWD|PRIVATE_KEY)[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9_./+=-]{16,}[\"']"
)

# Lines with these markers are docs/placeholders or known non-secrets.
ALLOW_RE='REPLACE_WITH|REPLACE_ME|CHANGEME|CHANGE_ME|your[_-]|YOUR_|placeholder|\.\.\.|omp-peer-loopback-'

FAILED=0

is_blocked_path() {
  printf '%s\n' "$1" | grep -qE "$BLOCKED_RE" &&
    ! printf '%s\n' "$1" | grep -qE "$ALLOW_PATH_RE"
}

report_blocked() {
  echo "BLOCKED $1 file: $2 (gitignored secret material)"
  FAILED=1
}

scan_staged() {
  local -a files=()
  local f re hits ln rest
  mapfile -d '' files < <(git diff --cached --name-only -z --diff-filter=ACMR 2>/dev/null || true)
  if [ "${#files[@]}" -eq 0 ]; then
    echo "check-secrets: no staged files"
    return 0
  fi
  for f in "${files[@]}"; do
    if is_blocked_path "$f"; then
      report_blocked staged "$f"
      continue
    fi
    # The scanner embeds every pattern as a regex literal; scanning itself is a false positive.
    if [ "$f" = "scripts/check-secrets.sh" ]; then
      continue
    fi
    git cat-file -e ":$f" 2>/dev/null || continue
    for re in "${SECRET_RES[@]}"; do
      hits=$(git show ":$f" | grep -I -n -E -e "$re" | grep -v -E -e "$ALLOW_RE" || true)
      if [ -n "$hits" ]; then
        while IFS=: read -r ln rest; do
          echo "SECRET pattern in staged $f:$ln"
          FAILED=1
        done <<< "$hits"
      fi
    done
  done
}

scan_tracked() {
  local f re hits ln rest
  while IFS= read -r f; do
    if is_blocked_path "$f"; then
      report_blocked tracked "$f"
    fi
  done < <(git ls-files)
  for re in "${SECRET_RES[@]}"; do
    hits=$(git grep -I -n -E -e "$re" -- . ':!scripts/check-secrets.sh' 2>/dev/null \
      | grep -v -E -e "$ALLOW_RE" || true)
    if [ -n "$hits" ]; then
      while IFS=: read -r f ln rest; do
        echo "SECRET pattern in tracked $f:$ln"
        FAILED=1
      done <<< "$hits"
    fi
  done
}

scan_history() {
  local f
  echo "check-secrets: scanning all reachable history..."
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if is_blocked_path "$f"; then
      report_blocked history "$f"
    fi
  done < <(git log --all --name-only --pretty=format: | sed '/^$/d' | sort -u)

  # Scan every unique historical blob once, applying the same allowlist as the
  # working-tree scan. Patterns are passed newline-delimited; the Python side
  # translates the POSIX [[:space:]] class.
  if SECRET_PATTERNS="$(printf '%s\n' "${SECRET_RES[@]}")" \
     ALLOW_RE="$ALLOW_RE" \
     python3 - <<'PY'
import os, re, subprocess, sys

patterns = [
    re.compile(p.replace("[[:space:]]", r"\s").encode())
    for p in os.environ["SECRET_PATTERNS"].splitlines()
    if p
]
allow = re.compile(os.environ["ALLOW_RE"].encode())

objects = subprocess.check_output(
    ["git", "rev-list", "--objects", "--all"], text=True, errors="replace"
)
blob_paths = {}
for line in objects.splitlines():
    if " " in line:
        sha, path = line.split(" ", 1)
        blob_paths.setdefault(sha, set()).add(path)

batch_check = subprocess.run(
    ["git", "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    input="\n".join(blob_paths),
    text=True,
    capture_output=True,
    check=True,
)
blobs = []
for line in batch_check.stdout.splitlines():
    parts = line.split()
    if len(parts) == 3 and parts[1] == "blob":
        blobs.append((parts[0], int(parts[2])))

if not blobs:
    raise SystemExit(0)

data = subprocess.run(
    ["git", "cat-file", "--batch"],
    input=("\n".join(sha for sha, _ in blobs) + "\n").encode(),
    capture_output=True,
    check=True,
).stdout

idx = 0
hits = 0
seen = set()
for sha, size in blobs:
    newline = data.index(b"\n", idx)
    content = data[newline + 1:newline + 1 + size]
    idx = newline + 1 + size + 1
    if b"\x00" in content[:8192]:
        continue
    paths = [p for p in blob_paths.get(sha, ()) if p != "scripts/check-secrets.sh"]
    if not paths:
        continue
    for lineno, line in enumerate(content.splitlines(), 1):
        if allow.search(line):
            continue
        for pattern in patterns:
            if not pattern.search(line):
                continue
            for path in paths:
                key = (path, lineno)
                if key in seen:
                    continue
                seen.add(key)
                print(f"SECRET pattern in history {path}:{lineno}")
                hits += 1

if hits:
    sys.exit(1)
PY
  then
    :
  else
    FAILED=1
  fi
}

case "$MODE" in
  staged) scan_staged ;;
  tracked) scan_tracked ;;
  history) scan_history ;;
esac

if [ "$FAILED" -ne 0 ]; then
  echo "check-secrets: FAIL — redact before committing"
  exit 1
fi
echo "check-secrets: PASS"
