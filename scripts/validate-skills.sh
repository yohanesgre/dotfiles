#!/usr/bin/env bash
# Agent Skills conformance validator (agentskills.io spec).
#
# Required frontmatter: name (kebab, == dir, <=64), description (<=1024).
# Optional standard fields: license, compatibility, metadata, allowed-tools.
# Known extensions (Claude Code argument-hint/user-invocable/
# disable-model-invocation) are recognized; other unknown top-level fields and
# >500-line bodies are reported as warnings.
#
# Usage:
#   bash scripts/validate-skills.sh            # scan repo config/skills
#   bash scripts/validate-skills.sh --dir DIR  # scan another skills root
#   bash scripts/validate-skills.sh --strict   # warnings fail the run
#   bash scripts/validate-skills.sh --verbose  # list every warning
#
# Exit 0 if no errors (and no warnings under --strict), 1 otherwise.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SKILLS_DIR="$REPO_ROOT/config/skills"
STRICT=false
VERBOSE=false

while [ $# -gt 0 ]; do
    case "$1" in
        --dir) SKILLS_DIR="$2"; shift 2 ;;
        --strict) STRICT=true; shift ;;
        --verbose) VERBOSE=true; shift ;;
        -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
        *) echo "validate-skills: unknown arg '$1'" >&2; exit 2 ;;
    esac
done

if [ ! -d "$SKILLS_DIR" ]; then
    echo "validate-skills: skills dir not found: $SKILLS_DIR" >&2
    exit 2
fi

if [ "$STRICT" = true ]; then export VS_STRICT=1; else export VS_STRICT=0; fi
if [ "$STRICT" = true ] || [ "$VERBOSE" = true ]; then
    export VS_VERBOSE=1
else
    export VS_VERBOSE=0
fi

echo "Agent Skills validation — $SKILLS_DIR"

python3 - "$SKILLS_DIR" <<'PY'
import os, re, sys, glob

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML not available (python3 -c 'import yaml')", file=sys.stderr)
    sys.exit(2)

root = sys.argv[1]
verbose = os.environ.get("VS_VERBOSE") == "1"
strict = os.environ.get("VS_STRICT") == "1"

STANDARD = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
# Consumed by Claude Code; keep top-level (moving to metadata disables them).
KNOWN_EXTENSIONS = {"argument-hint", "user-invocable", "disable-model-invocation"}
NAME_RE = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)

errors, warnings = [], []
files = sorted(glob.glob(os.path.join(root, "**", "SKILL.md"), recursive=True))
known_dirs, known_names = set(), set()

for path in files:
    skill_dir = os.path.basename(os.path.dirname(path))
    rel = os.path.relpath(path, root)
    text = open(path, encoding="utf-8").read()
    m = FM_RE.match(text)
    if not m:
        errors.append((rel, "no YAML frontmatter"))
        continue
    try:
        fm = yaml.safe_load(m.group(1))
    except Exception as e:
        errors.append((rel, f"invalid YAML frontmatter: {str(e).splitlines()[-1].strip()}"))
        continue
    if not isinstance(fm, dict):
        errors.append((rel, "frontmatter is not a mapping"))
        continue

    name = fm.get("name")
    desc = fm.get("description")

    known_dirs.add(skill_dir)
    if not isinstance(name, str) or not name:
        errors.append((rel, "missing required 'name'"))
    else:
        known_names.add(name)
        if len(name) > 64:
            errors.append((rel, f"'name' exceeds 64 chars ({len(name)})"))
        if not NAME_RE.fullmatch(name):
            errors.append((rel, f"'name' not lowercase-kebab: {name!r}"))
        if name != skill_dir:
            if rel.count(os.sep) > 1:
                warnings.append((rel, f"'name' {name!r} != dir {skill_dir!r} (nested namespace)"))
            else:
                errors.append((rel, f"'name' {name!r} != directory {skill_dir!r}"))

    if not isinstance(desc, str) or not desc.strip():
        errors.append((rel, "missing required 'description'"))
    elif len(desc) > 1024:
        errors.append((rel, f"'description' exceeds 1024 chars ({len(desc)})"))

    comp = fm.get("compatibility")
    if comp is not None and (not isinstance(comp, str) or len(comp) > 500):
        errors.append((rel, "'compatibility' must be a string <=500 chars"))

    meta = fm.get("metadata")
    if meta is not None and not isinstance(meta, dict):
        errors.append((rel, "'metadata' must be a mapping"))

    extra = sorted(set(fm.keys()) - STANDARD - KNOWN_EXTENSIONS)
    if extra:
        warnings.append((rel, f"unknown top-level keys: {', '.join(extra)}"))

    body_lines = len(text.splitlines())
    if body_lines > 500:
        warnings.append((rel, f"body is {body_lines} lines (spec recommends <=500; move detail to references/)"))

print(f"scanned {len(files)} skills\n")

if errors:
    print(f"ERRORS ({len(errors)}):")
    for rel, msg in errors:
        print(f"  {rel}: {msg}")
    print()

if warnings:
    print(f"WARNINGS: {len(warnings)}")
    if verbose:
        for rel, msg in warnings:
            print(f"  {rel}: {msg}")
    else:
        print("  (re-run with --verbose to list)")
    print()

failed = bool(errors) or (strict and bool(warnings))
if failed:
    print("✗ skill validation FAILED")
    sys.exit(1)
print(f"✓ skill validation passed ({len(files)} skills, {len(warnings)} warning(s))")
PY
