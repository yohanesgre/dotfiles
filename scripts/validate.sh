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
if [ -d "$REPO_ROOT/config/opencode" ]; then
    OC_DIR="$REPO_ROOT/config/opencode"
else
    OC_DIR="$REPO_ROOT/dot_config/opencode"
fi
HOME_AGENTS="$HOME/AGENTS.md"

source "$SCRIPT_DIR/lib.sh"
extend_path

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
    echo -e "  ${YELLOW}[SKIP]${NC} $1"
    SKIPPED=$((SKIPPED + 1))
}

# Helper: test if a file has valid JSON content (for non-JSONC files)
_json_valid() { python3 -m json.tool "$1" > /dev/null 2>&1; }

# Helper: test if a file has valid JSONC content (strips // comments at line start + trailing commas)
_jsonc_valid() {
    node -e "
        var fs = require('fs');
        var raw = fs.readFileSync('$1', 'utf8')
            .replace(/^\\s*\\/\\/.*\$/gm, '')
            .replace(/,(\s*[}\\]])/g, '\$1');
        JSON.parse(raw);
    " > /dev/null 2>&1
}

# Helper: check balanced {{ }} braces in a file
_balanced_braces() {
    local content open close
    content=$(cat "$1")
    open=$(echo "$content" | grep -o '{{' | wc -l)
    close=$(echo "$content" | grep -o '}}' | wc -l)
    [ "$open" -eq "$close" ]
}

# Helper: check skill exists in at least one skill directory
_skill_dir_exists() {
    local skill="$1"
    for dir in "$HOME/.agents/skills" "$HOME/.agents/skills" "$HOME/.config/opencode/skills" "$REPO_ROOT/dot_config/opencode/skills"; do
        [ -d "$dir/$skill" ] && return 0
    done
    return 1
}

_cmd_exists() { check_cmd "$1"; }

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

for f in $(find "$REPO_ROOT" -type f \( -name '*.json' -o -name '*.jsonc' \) \
    ! -path '*/node_modules/*' ! -path '*/.git/*' 2>/dev/null | sort); do
    rel="${f#$REPO_ROOT/}"
    if [[ "$f" == *.jsonc ]]; then
        check "parse $rel" _jsonc_valid "$f"
    else
        check "parse $rel" _json_valid "$f"
    fi
done
echo ""


# ── Check 2: Chezmoi Template Syntax ───────────────────────────────────────
echo -e "${BOLD}Check 2: Chezmoi Template Syntax${NC}"

for f in $(find "$REPO_ROOT" -type f -name '*.tmpl' ! -path '*/.git/*' 2>/dev/null | sort); do
    rel="${f#$REPO_ROOT/}"
    check "balanced braces in $rel" _balanced_braces "$f"
done
echo ""

# ── Check 3: AGENTS.md Skill References ────────────────────────────────────
echo -e "${BOLD}Check 3: AGENTS.md Skill References (home-level)${NC}"

if [ "$CI_MODE" = true ]; then
    skip "CI mode — skipping local skill directory checks"
elif [ ! -f "$HOME_AGENTS" ]; then
    skip "~/AGENTS.md not found"
    _suggest "run: npx openskills sync -y  (after installing skills)"
else
    SKILL_NAMES=$(python3 -c "
import re
with open('$HOME_AGENTS') as f:
    print('\n'.join(re.findall(r'<name>(.*?)</name>', f.read())))
" 2>/dev/null || true)

    if [ -z "$SKILL_NAMES" ]; then
        skip "no skill <name> entries found in ~/AGENTS.md"
    else
            while IFS= read -r skill; do
                [ -z "$skill" ] && continue
                if _skill_dir_exists "$skill"; then
                    check "skill '$skill' exists on disk" true
                else
                    check "skill '$skill' exists on disk" false
                fi
        done <<< "$SKILL_NAMES"
    fi
fi
echo ""

# ── Check 4: Cross-Reference Designer Skills ───────────────────────────────
echo -e "${BOLD}Check 4: Cross-Reference Designer Skills${NC}"

SLIM_JSON="$OC_DIR/oh-my-opencode-slim.json"

if [ ! -f "$SLIM_JSON" ]; then
    skip "oh-my-opencode-slim.json not found"
elif [ ! -f "$HOME_AGENTS" ]; then
    skip "~/AGENTS.md not found"
    _suggest "run: npx openskills sync -y"
else
    PRESET=$(python3 -c "
import json
with open('$SLIM_JSON') as f:
    data = json.load(f)
print(data.get('preset', ''))
" 2>/dev/null || echo "")

    if [ -z "$PRESET" ]; then
        skip "no preset field found in oh-my-opencode-slim.json"
    else
        DESIGNER_SKILLS=$(python3 -c "
import json
with open('$SLIM_JSON') as f:
    data = json.load(f)
preset = data.get('preset', '')
skills = data.get('presets', {}).get(preset, {}).get('designer', {}).get('skills', [])
for s in skills:
    print(s)
" 2>/dev/null || echo "")

        if [ -z "$DESIGNER_SKILLS" ]; then
            skip "no designer skills found for preset '$PRESET'"
        else
            AGENTS_SKILLS=$(python3 -c "
import re
with open('$HOME_AGENTS') as f:
    content = f.read()
blocks = re.findall(r'<skill>(.*?)</skill>', content, re.DOTALL)
for block in blocks:
    name_m = re.search(r'<name>(.*?)</name>', block)
    loc_m = re.search(r'<location>(.*?)</location>', block)
    if name_m and loc_m and loc_m.group(1) == 'project':
        print(name_m.group(1))
" 2>/dev/null || echo "")

            while IFS= read -r skill; do
                [ -z "$skill" ] && continue
                if _in_lines "$skill" "$AGENTS_SKILLS"; then
                    check "designer skill '$skill' in ~/AGENTS.md (location=project)" true
                elif _skill_dir_exists "$skill"; then
                    _warn "designer skill '$skill' not in ~/AGENTS.md (exists on disk)"
                else
                    check "designer skill '$skill' in ~/AGENTS.md (location=project)" false
                fi
            done <<< "$DESIGNER_SKILLS"
        fi
    fi
fi
echo ""

# ── Check 5: File Existence (MCP commands, plugin paths) ───────────────────
echo -e "${BOLD}Check 5: Path Existence (MCP commands, binaries)${NC}"

if [ "$CI_MODE" = true ]; then
    skip "CI mode — skipping local binary path checks"
else
    OPENCODE_TMPL="$OC_DIR/opencode.json.tmpl"
    if [ ! -f "$OPENCODE_TMPL" ]; then
        skip "opencode.json.tmpl not found"
    else
        RESOLVED=$(sed "s|{{ \.chezmoi\.homeDir }}|$HOME|g" "$OPENCODE_TMPL")

        COMMANDS=$(echo "$RESOLVED" | python3 -c "
import json, sys, os
data = json.load(sys.stdin)
# Extend PATH to include common install locations
os.environ['PATH'] += ':' + os.path.expanduser('~/.bun/bin:/opt/homebrew/bin:/usr/local/bin')
for name, cfg in data.get('mcp', {}).items():
    if cfg.get('type') != 'local' or cfg.get('enabled') == False:
        continue
    cmd = cfg.get('command', [])
    if cmd:
        exe = cmd[0].replace('{{ .chezmoi.homeDir }}', os.environ.get('HOME', ''))
        print(exe)
" 2>/dev/null || echo "")

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
            _suggest "run: npx openskills sync -y"
        else
            _suggest "run: chezmoi apply  (deploys config-level AGENTS.md)"
        fi
        continue
    fi

    DUPES=$(python3 -c "
import re
from collections import Counter
with open('$agents_file') as f:
    names = re.findall(r'<name>(.*?)</name>', f.read())
dupes = [name for name, count in Counter(names).items() if count > 1]
if dupes:
    print('\n'.join(dupes))
" 2>/dev/null || true)

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

# ── Check 7: Chezmoi Dry-Run ───────────────────────────────────────────────
echo -e "${BOLD}Check 7: Chezmoi Dry-Run${NC}"

if [ "$CI_MODE" = true ]; then
    skip "CI mode — chezmoi not configured in CI"
elif ! command -v chezmoi >/dev/null 2>&1; then
    skip "chezmoi not installed"
elif ! chezmoi apply --dry-run >/dev/null 2>&1; then
    check "chezmoi apply --dry-run succeeds" false
    echo "         ${YELLOW}→ run 'chezmoi init --source=~/projects/dotfiles' first${NC}"
else
    check "chezmoi apply --dry-run succeeds" true
fi
echo ""

# ── Check 8: MCP URL Validity ──────────────────────────────────────────────
echo -e "${BOLD}Check 8: MCP URL Validity${NC}"

OPENCODE_TMPL="$OC_DIR/opencode.json.tmpl"
if [ ! -f "$OPENCODE_TMPL" ]; then
    skip "opencode.json.tmpl not found"
else
    URLS=$(python3 -c "
import json
with open('$OPENCODE_TMPL') as f:
    data = json.load(f)
for name, cfg in data.get('mcp', {}).items():
    if cfg.get('type') == 'remote' and 'url' in cfg:
        print(cfg['url'])
" 2>/dev/null || echo "")

    if [ -z "$URLS" ]; then
        skip "no remote MCP URLs found"
    else
        while IFS= read -r url; do
            [ -z "$url" ] && continue
            check "valid URL format: $url" bash -c "
                [[ '$url' =~ ^https?:// ]]
            "
        done <<< "$URLS"
    fi
fi
echo ""

# ── Check 9: .chezmoi.toml.tmpl Validity ──────────────────────────────────
echo -e "${BOLD}Check 9: .chezmoi.toml.tmpl Validity${NC}"

CHEZMOI_TOML="$REPO_ROOT/.chezmoi.toml.tmpl"
if [ ! -f "$CHEZMOI_TOML" ]; then
    skip ".chezmoi.toml.tmpl not found"
else
    check ".chezmoi.toml.tmpl has sourceDir" grep -q 'sourceDir' "$CHEZMOI_TOML"
    check ".chezmoi.toml.tmpl has balanced braces" _balanced_braces "$CHEZMOI_TOML"
fi
echo ""

# ── Additional Checks ──────────────────────────────────────────────────────
echo -e "${BOLD}Additional Checks${NC}"

check "no broken symlinks in repo" bash -c "
    broken=\$(find '$REPO_ROOT' -type l ! -exec test -e {} \; -print 2>/dev/null)
    [ -z \"\$broken\" ]
"

for script in "$SCRIPT_DIR"/*.sh; do
    [ ! -f "$script" ] && continue
    rel="${script#$REPO_ROOT/}"
    check "$rel is executable" test -x "$script"
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
