#!/usr/bin/env bash
# Opencode Dotfiles — Validation Test Suite
# Usage:
#   bash scripts/validate.sh          # Full validation (local machine)
#   bash scripts/validate.sh --ci     # CI mode (skip machine-local checks)
#
# Exit code 0 if all checks pass, 1 if any fail.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OC_DIR="$REPO_ROOT/config/opencode"
HOME_AGENTS="$HOME/AGENTS.md"

source "$SCRIPT_DIR/lib.sh"
extend_path

# Include the server's existing Bun installation without adding a dependency.
export PATH="$PATH:/data/host-bun/bin"
cd "$REPO_ROOT"
TRACKED_FILES=()
git ls-files >/dev/null
while IFS= read -r -d '' rel; do
    TRACKED_FILES+=("$rel")
done < <(git ls-files -z)

JS_RUNTIME=""
for runtime in node bun; do
    if command -v "$runtime" >/dev/null 2>&1; then
        JS_RUNTIME="$runtime"
        break
    fi
done
JSON_RUNTIME=""
for runtime in jq node bun; do
    if command -v "$runtime" >/dev/null 2>&1; then
        JSON_RUNTIME="$runtime"
        break
    fi
done
FAILED=0
SKIPPED=0
PASSED=0
CI_MODE=false

# ── Parse flags ────────────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --ci) CI_MODE=true ;;
    esac
done

# ── Header ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Dotfiles Validation Suite${NC}"
if [ "$CI_MODE" = true ]; then
    echo -e "  Mode: ${YELLOW}CI${NC} (skipping machine-local checks)"
else
    echo -e "  Mode: ${GREEN}Local${NC} (full validation)"
fi
echo -e "${BOLD}══════════════════════════════════════════════${NC}"
echo ""

# ── Helper functions ───────────────────────────────────────────────────────
check() {
    local name="$1"
    shift
    if "$@"; then
        echo -e "  ${GREEN}[PASS]${NC} $name"
        PASSED=$((PASSED + 1))
    else
        echo -e "  ${RED}[FAIL]${NC} $name"
        FAILED=$((FAILED + 1))
    fi
}

skip() {
    echo -e "  ${YELLOW}SKIP:${NC} $1"
    SKIPPED=$((SKIPPED + 1))
}

# Helper: test if a file has valid JSON content (for non-JSONC files)
_json_valid() {
    if [ "$JSON_RUNTIME" = jq ]; then
        jq -s -e 'length == 1' "$1" >/dev/null 2>&1
    else
        "$JSON_RUNTIME" -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$1" >/dev/null 2>&1
    fi
}

# Preserve strings while stripping JSONC comments and trailing commas.
# Pass paths as arguments, not interpolated JavaScript source.
_jsonc_query() {
    "$JS_RUNTIME" -e '
        const raw = require("fs").readFileSync(process.argv[1], "utf8")
            .replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
                token => token.startsWith("\"") ? token : " ")
            .replace(/("(?:\\.|[^"\\])*")|,\s*(?=[}\]])/g,
                (token, string) => string || "");
        const data = JSON.parse(raw);
        if (process.argv[2] === "validate") process.exit(0);
        for (const cfg of Object.values(data.mcp || {})) {
            if (process.argv[2] === "commands" && cfg.type === "local" &&
                cfg.enabled !== false && cfg.command?.length) console.log(cfg.command[0]);
            if (process.argv[2] === "urls" && cfg.type === "remote" &&
                cfg.url !== undefined) console.log(cfg.url);
        }
    ' "$1" "${2:-validate}"
}

_jsonc_valid() { _jsonc_query "$1" >/dev/null 2>&1; }

# Helper: check skill exists in at least one skill directory
_skill_dir_exists() {
    local skill="$1"
    for dir in "$HOME/.agents/skills" "$REPO_ROOT/config/skills"; do
        [ -d "$dir/$skill" ] && return 0
    done
    return 1
}

_cmd_exists() { check_cmd "$1"; }

_url_valid() { [[ "$1" =~ ^https?:// ]]; }

_goal_h2h_tests() {
    local runtime="$REPO_ROOT/config/skills/goal/runtime"
    (
        cd "$runtime" &&
        bun install --frozen-lockfile --ignore-scripts &&
        bun run typecheck &&
        bun test
    )
}

# Helper: check if a string contains a line exactly matching the given value
_in_lines() {
    local value="$1" lines="$2"
    echo "$lines" | grep -qxF "$value"
}

# Helper: print a warning
_warn() { echo -e "  ${YELLOW}[WARN]${NC} $*"; }
# Helper: print a suggestion after a SKIP
_suggest() { echo -e "         ${CYAN}→ $*${NC}"; }

# ── Check 1: JSON Validity ─────────────────────────────────────────────────
echo -e "${BOLD}Check 1: JSON Validity${NC}"
echo -e "  JSON parser: ${JSON_RUNTIME:-none}; JSONC parser: ${JS_RUNTIME:-none}"

if [ -z "$JSON_RUNTIME" ]; then
    skip "JSON parsing unavailable — install jq, node, or bun (also checked /data/host-bun/bin/bun)"
fi
if [ -z "$JS_RUNTIME" ]; then
    skip "JSONC parsing unavailable — node or bun required"
fi
for rel in "${TRACKED_FILES[@]}"; do
    f="$REPO_ROOT/$rel"
    case "$rel" in
        *.jsonc) [ -z "$JS_RUNTIME" ] || check "parse $rel" _jsonc_valid "$f" ;;
        *.json) [ -z "$JSON_RUNTIME" ] || check "parse $rel" _json_valid "$f" ;;
    esac
done
echo ""


# ── Check 1b: Nix Flake (check + fmt + deadnix) ──────────────────────────
echo -e "${BOLD}Check 1b: Nix Flake${NC}"

if ! command -v nix >/dev/null 2>&1; then
    skip "nix not in PATH"
else
    check "nix flake check --no-build" nix flake check --no-build
    if nix fmt -- --check flake.nix home/ </dev/null >/dev/null 2>&1; then
        check "nix fmt --check clean" true
    else
        check "nix fmt clean (run: nix fmt)" false
    fi
    # deadnix lint — skip when nix can't provide the tool
    if nix run nixpkgs#deadnix -- --version >/dev/null 2>&1; then
        if nix run nixpkgs#deadnix -- -L --fail flake.nix home/ >/dev/null 2>&1; then
            check "deadnix clean" true
        else
            check "deadnix clean" false
        fi
    else
        skip "deadnix not available via nix run"
    fi
fi
echo ""

# ── Check 3: AGENTS.md Skill References ────────────────────────────────────
echo -e "${BOLD}Check 3: AGENTS.md Skill References (home-level)${NC}"

if [ "$CI_MODE" = true ]; then
    skip "CI mode — skipping local skill directory checks"
elif [ ! -f "$HOME_AGENTS" ]; then
    skip "~/AGENTS.md not found"
    _suggest "skills auto-discover from ~/.agents/skills/; externalized skills install per project via scripts/skills-sync.sh"
elif ! command -v python3 >/dev/null 2>&1; then
    skip "home skill references — python3 not in PATH"
else
    if ! SKILL_NAMES=$(python3 -c "
import re
with open('$HOME_AGENTS') as f:
    print('\n'.join(re.findall(r'<name>(.*?)</name>', f.read())))
" 2>/dev/null); then
        check "read skill references from ~/AGENTS.md" false
    elif [ -z "$SKILL_NAMES" ]; then
        skip "no skill <name> entries found in ~/AGENTS.md"
    else
        while IFS= read -r skill; do
            [ -z "$skill" ] && continue
            check "skill '$skill' exists on disk" _skill_dir_exists "$skill"
        done <<< "$SKILL_NAMES"
    fi
fi
echo ""

# ── Check 5: File Existence (MCP commands, plugin paths) ───────────────────
echo -e "${BOLD}Check 5: Path Existence (MCP commands, binaries)${NC}"

if [ "$CI_MODE" = true ]; then
    skip "CI mode — skipping local binary path checks"
else
    OPENCODE_CONFIG="$OC_DIR/opencode.jsonc"
    if [ ! -f "$OPENCODE_CONFIG" ]; then
        skip "config/opencode/opencode.jsonc not found"
    elif [ -z "$JS_RUNTIME" ]; then
        skip "MCP binary paths — JSONC reader requires node or bun"
    elif ! COMMANDS=$(_jsonc_query "$OPENCODE_CONFIG" commands); then
        check "read MCP commands from config/opencode/opencode.jsonc" false
    else

        while IFS= read -r exe; do
            [ -z "$exe" ] && continue
            if [[ "$exe" == *"/"* ]]; then
                check "MCP binary '$exe' exists" test -x "$exe"
            else
                check "MCP runtime '$exe' in PATH" _cmd_exists "$exe"
            fi
        done <<< "$COMMANDS"
    fi
fi
echo ""

# ── Check 6: No Duplicate Skill Names ──────────────────────────────────────
echo -e "${BOLD}Check 6: No Duplicate Skill Names${NC}"

for agents_file in "$OC_DIR/AGENTS.md" "$HOME_AGENTS"; do
    fname=$(basename "$agents_file")
    dir_label=""
    if [ "$agents_file" = "$OC_DIR/AGENTS.md" ]; then
        dir_label=" (config-level)"
    else
        dir_label=" (home-level)"
    fi

    if [ ! -f "$agents_file" ]; then
        skip "$fname$dir_label not found"
        if [ "$agents_file" = "$HOME_AGENTS" ]; then
            _suggest "skills auto-discover from ~/.agents/skills/; externalized skills install per project via scripts/skills-sync.sh"
        else
            _suggest "run: bash scripts/hm-switch.sh (redeploys config-level AGENTS.md)"
        fi
        continue
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        skip "duplicate names in $fname$dir_label — python3 not in PATH"
        continue
    fi

    if ! DUPES=$(python3 -c "
import re
from collections import Counter
with open('$agents_file') as f:
    names = re.findall(r'<name>(.*?)</name>', f.read())
dupes = [name for name, count in Counter(names).items() if count > 1]
if dupes:
    print('\n'.join(dupes))
" 2>/dev/null); then
        check "read skill names from $fname$dir_label" false
        continue
    fi

    if [ -n "$DUPES" ]; then
        check "no duplicate names in $fname$dir_label" false
        while IFS= read -r dupe; do
            echo -e "         ${RED}→ duplicate: $dupe${NC}"
        done <<< "$DUPES"
    else
        check "no duplicate names in $fname$dir_label" true
    fi
done
echo ""

# ── Check 7: Agent Skills Format (agentskills.io spec) ─────────────────────
echo -e "${BOLD}Check 7: Agent Skills Format${NC}"

if [ ! -f "$SCRIPT_DIR/validate-skills.sh" ]; then
    skip "scripts/validate-skills.sh not found"
elif ! command -v python3 >/dev/null 2>&1; then
    skip "Agent Skills spec validation — python3 not in PATH"
else
    if [ -f "$REPO_ROOT/config/skills/sources.json" ]; then
        check "config/skills conform to Agent Skills spec + sources manifest" \
            bash "$SCRIPT_DIR/validate-skills.sh" --dir "$REPO_ROOT/config/skills" --manifest "$REPO_ROOT/config/skills/sources.json"
    else
        check "config/skills conform to Agent Skills spec" \
            bash "$SCRIPT_DIR/validate-skills.sh" --dir "$REPO_ROOT/config/skills"
    fi
fi
echo ""

# ── Check 7b: OpenCode Plugin Tests ─────────────────────────────────────────
echo -e "${BOLD}Check 7b: OpenCode Plugin Tests${NC}"

if ! command -v bun >/dev/null 2>&1; then
    skip "bun not in PATH"
else
    check "OpenCode GitHub plugin bun tests" bun test "$OC_DIR/plugins/gh.test.ts"
    for plugin in opencode-go-limit opencode-subagents; do
        # bun's global cache can resolve require() while `bun test` still cannot
        # load the preload/JSX runtime, so gate on the package's own install.
        if [ ! -d "$OC_DIR/plugins/$plugin/node_modules" ]; then
            skip "$plugin tests — dependencies not installed (run bun install in config/opencode/plugins/$plugin)"
        elif [ "$plugin" = opencode-go-limit ]; then
            check "$plugin bun tests" bun --cwd "$OC_DIR/plugins/$plugin" test
        else
            check "$plugin bun tests" bun test \
                "$OC_DIR/plugins/$plugin/MoreDialog.test.tsx" \
                "$OC_DIR/plugins/$plugin/variants.test.ts" \
                "$OC_DIR/plugins/$plugin/useSubagents.test.ts"
        fi
    done
fi
echo ""

echo -e "${BOLD}Check 7c: Goal H2H Runtime${NC}"
if [ "$CI_MODE" = true ]; then
    skip "CI mode — Goal H2H runtime tests probe installed omp/opencode versions"
elif ! command -v bun >/dev/null 2>&1; then
    skip "bun not in PATH"
else
    check "Goal H2H runtime typecheck and tests" _goal_h2h_tests
fi
echo ""

# ── Check 8: MCP URL Validity ──────────────────────────────────────────────
echo -e "${BOLD}Check 8: MCP URL Validity${NC}"

OPENCODE_CONFIG="$OC_DIR/opencode.jsonc"
if [ ! -f "$OPENCODE_CONFIG" ]; then
    skip "config/opencode/opencode.jsonc not found"
elif [ -z "$JS_RUNTIME" ]; then
    skip "MCP URL validation — JSONC reader requires node or bun"
elif ! URLS=$(_jsonc_query "$OPENCODE_CONFIG" urls); then
    check "read MCP URLs from config/opencode/opencode.jsonc" false
elif [ -z "$URLS" ]; then
    skip "no remote MCP URLs in config/opencode/opencode.jsonc"
else
    while IFS= read -r url; do
        [ -z "$url" ] && continue
        check "valid URL format: $url" _url_valid "$url"
    done <<< "$URLS"
fi
echo ""

# ── Check 10: No Leaked Secrets (tracked files) ─────────────────────────
echo -e "${BOLD}Check 10: No Leaked Secrets${NC}"

if [ ! -f "$REPO_ROOT/scripts/check-secrets.sh" ]; then
    skip "scripts/check-secrets.sh not found"
else
    check "no secrets in tracked files" bash "$REPO_ROOT/scripts/check-secrets.sh"
fi

# Hermes configs must use placeholders, never raw snowflake IDs.
for rel in "${TRACKED_FILES[@]}"; do
    [[ "$rel" == config/hermes/profiles/* ]] || continue
    if grep -Eq "'[0-9]{17,19}'" "$rel"; then
        check "$rel uses placeholders (no raw channel IDs)" false
    else
        check "$rel uses placeholders (no raw channel IDs)" true
    fi
done
echo ""

# ── Check 11: Design-Systems Corpus Gate ───────────────────────────────────
echo -e "${BOLD}Check 11: Design-Systems Corpus Gate${NC}"

if [ ! -d "$REPO_ROOT/config/skills/designer/references/design-systems" ]; then
    skip "design-systems corpus not present"
elif ! command -v jq >/dev/null 2>&1; then
    skip "design-systems corpus gate — jq not in PATH"
else
    check "design-systems corpus gate (--check)" \
        bash "$REPO_ROOT/scripts/design-systems-sync.sh" --check
fi
echo ""

# ── Additional Checks ──────────────────────────────────────────────────────
echo -e "${BOLD}Additional Checks${NC}"

for rel in "${TRACKED_FILES[@]}"; do
    if [ -L "$rel" ]; then
        check "symlink $rel resolves" test -e "$rel"
    fi
    case "$rel" in
        scripts/*.sh) check "$rel is executable" test -x "$rel" ;;
    esac
done
echo ""

# ── Summary ─────────────────────────────────────────────────────────────────
TOTAL=$((PASSED + FAILED + SKIPPED))
echo -e "${BOLD}══════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Validation Summary${NC}"
echo -e "${BOLD}══════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${GREEN}Passed:${NC}  $PASSED"
echo -e "  ${RED}Failed:${NC}  $FAILED"
echo -e "  ${YELLOW}Skipped:${NC} $SKIPPED"
echo -e "  ${CYAN}Total:${NC}   $TOTAL"
echo ""

if [ "$FAILED" -gt 0 ]; then
    echo -e "  ${RED}${BOLD}✗ VALIDATION FAILED${NC} — $FAILED check(s) failed"
    echo ""
    exit 1
else
    echo -e "  ${GREEN}${BOLD}✓ All checks passed${NC}"
    echo ""
    exit 0
fi
