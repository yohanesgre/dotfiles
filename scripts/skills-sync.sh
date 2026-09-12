#!/usr/bin/env bash
# skills-sync — install externalized agent skills from sources.json.
#
# The dotfiles repo commits only local-authored + wired skills (config/skills/).
# Every other third-party skill is declared in config/skills/sources.json and either
# installed globally on hm-switch (--global -> ~/.agents/skills) or per project on
# demand (--source -> <project>/.agents/skills) via `npx skills`.
#
# Usage:
#   skills-sync.sh --list                     # show declared sources
#   skills-sync.sh --check                    # exit 1 if project skills missing (no network)
#   skills-sync.sh --source ID [--force]      # install one source into the project
#   skills-sync.sh --all                      # install every project-scope source
#   skills-sync.sh                            # install from <project>/.agents/skills.sources.json
#   skills-sync.sh --global                   # install ALL project-scope sources globally (-g)
#   skills-sync.sh --global --source ID       # install one source globally
#   skills-sync.sh --wired [--dry-run]        # refresh committed wired skills from upstream
#   skills-sync.sh --dry-run                  # print npx commands only
#
# Options:
#   --global        install to the harness-agnostic global root ~/.agents/skills via
#                   `npx skills -a universal` (used by hm-switch)
#   --project DIR   target project (default: $PWD)
#   --agent NAME    npx skills agent (default: universal -> .agents/skills; ignored
#                   with --global, which always targets ~/.agents/skills)
#   --symlink       symlink instead of --copy
#   --force         reinstall even when SKILL.md already exists
#   --source ID     source id from sources.json (repeatable)
#   --all           all project-scope sources
#   --list/--check/--wired   see above
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$REPO_ROOT/config/skills/sources.json"
PROJECT_SOURCES=".agents/skills.sources.json"

MODE=install
PROJECT="$PWD"
AGENT=universal
AGENT_SET=false
COPY=true
FORCE=false
DRYRUN=false
ALL=false
GLOBAL=false
SOURCES=()

while [ $# -gt 0 ]; do
    case "$1" in
        --list) MODE=list; shift ;;
        --check) MODE=check; shift ;;
        --wired) MODE=wired; shift ;;
        --source) SOURCES+=("$2"); shift 2 ;;
        --all) ALL=true; shift ;;
        --global) GLOBAL=true; shift ;;
        --project) PROJECT="$2"; shift 2 ;;
        --agent) AGENT="$2"; AGENT_SET=true; shift 2 ;;
        --symlink) COPY=false; shift ;;
        --force) FORCE=true; shift ;;
        --dry-run) DRYRUN=true; shift ;;
        -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
        *) echo "skills-sync: unknown arg '$1'" >&2; exit 2 ;;
    esac
done

# Global installs are harness-agnostic: always the `universal` agent (whose project
# path is `.agents/skills/`) run from $HOME -> ~/.agents/skills. --agent is rejected
# with --global, since that would pin a harness-specific global root.
if [ "$GLOBAL" = true ]; then
    if [ "$AGENT_SET" = true ]; then
        echo "skills-sync: --global is harness-agnostic; --agent is not allowed with it" >&2
        exit 2
    fi
    AGENT=universal
fi

if [ ! -f "$MANIFEST" ]; then
    echo "skills-sync: manifest not found: $MANIFEST" >&2
    exit 2
fi

# TSV: id \t repo \t scope \t skills(space-joined)
_manifest_tsv() {
    python3 - "$MANIFEST" <<'PY'
import json, sys
man = json.load(open(sys.argv[1]))
for s in man.get("sources", []):
    print("%s\t%s\t%s\t%s" % (s.get("id", ""), s.get("repo") or "-",
                              s.get("scope", ""), " ".join(s.get("skills", []))))
PY
}

_scope_filter() {
    local wanted_scope="$1"
    _manifest_tsv | awk -F'\t' -v sc="$wanted_scope" '$3 == sc'
}

_print_source() {
    local id="$1" repo="$2" scope="$3" skills="$4"
    echo "  $id  [$scope]  $repo"
    echo "     skills: $skills"
}

# Harness-agnostic global root: every harness in the .agents group reads it.
_global_dir() {
    echo "$HOME/.agents/skills"
}

case "$MODE" in
    list)
        echo "Externalized skill sources ($MANIFEST):"
        while IFS=$'\t' read -r id repo scope skills; do
            _print_source "$id" "$repo" "$scope" "$skills"
        done < <(_manifest_tsv)
        echo
        echo "Install into a project:  skills-sync.sh --source <id> [--project DIR]"
        exit 0
        ;;
    check|install)
        if [ "$GLOBAL" = true ]; then
            DEST_DIR="$(_global_dir)"
            # old layout: ~/.agents/skills was a symlink to the repo. Writing a global
            # install through it would mutate the dotfiles repo. Only safe once hm-switch
            # has materialized it as a real directory.
            if [ -L "$DEST_DIR" ] && [ "$DRYRUN" != true ]; then
                echo "skills-sync: $DEST_DIR is still a symlink (old layout) — run hm-switch first" >&2
                exit 2
            fi
        else
            DEST_DIR="$PROJECT/.agents/skills"
        fi

        TMPD="$(mktemp -d)"
        PROJECT_TSV="$TMPD/project.tsv"
        SELECTED="$TMPD/selected.tsv"
        trap 'rm -rf "$TMPD"' EXIT
        _scope_filter project > "$PROJECT_TSV"
        : > "$SELECTED"

        if [ "$ALL" = true ] \
            || { [ "$GLOBAL" = true ] && [ "${#SOURCES[@]}" -eq 0 ] && [ ! -f "$PROJECT/$PROJECT_SOURCES" ]; }; then
            cat "$PROJECT_TSV" > "$SELECTED"
        elif [ "${#SOURCES[@]}" -gt 0 ]; then
            for want in "${SOURCES[@]}"; do
                awk -F'\t' -v w="$want" '$1 == w' "$PROJECT_TSV" >> "$SELECTED"
            done
            if [ ! -s "$SELECTED" ]; then
                echo "skills-sync: no project-scope source matches: ${SOURCES[*]}" >&2
                echo "  try: skills-sync.sh --list" >&2
                exit 2
            fi
        elif [ -f "$PROJECT/$PROJECT_SOURCES" ]; then
            while IFS=$'\t' read -r id repo scope skills; do
                sel=$(python3 - "$PROJECT/$PROJECT_SOURCES" "$id" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1]))
want = sys.argv[2]
for e in entries:
    if e.get("source") == want:
        print(" ".join(e.get("skills", [])) or "*")
        break
PY
)
                [ -n "$sel" ] || continue
                if [ "$sel" = "*" ]; then sel="$skills"; fi
                printf '%s\t%s\t%s\t%s\n' "$id" "$repo" "$scope" "$sel" >> "$SELECTED"
            done < "$PROJECT_TSV"
        else
            echo "skills-sync: nothing to do — no $PROJECT_SOURCES in $PROJECT and no --source/--all/--global given." >&2
            echo "  run with --list to see sources." >&2
            exit 0
        fi

        MISSING=0
        while IFS=$'\t' read -r id repo scope skills; do
            [ -n "$id" ] || continue
            ADD_ARGS=()
            for s in $skills; do
                if [ -f "$DEST_DIR/$s/SKILL.md" ] && [ "$FORCE" != true ]; then
                    continue
                fi
                ADD_ARGS+=(--skill "$s")
                MISSING=$((MISSING + 1))
            done
            [ "${#ADD_ARGS[@]}" -eq 0 ] && continue
            if [ "$MODE" = check ]; then
                echo "MISSING  $id: ${ADD_ARGS[*]//--skill /}"
                continue
            fi
            CMD=(npx -y skills add "$repo" "${ADD_ARGS[@]}" -y -a "$AGENT")
            [ "$COPY" = true ] && CMD+=(--copy)
            RUN_DIR="$HOME"
            [ "$GLOBAL" != true ] && RUN_DIR="$PROJECT"
            if [ "$DRYRUN" = true ]; then
                echo "(dry-run) (cd $RUN_DIR && ${CMD[*]})"
            else
                ( cd "$RUN_DIR" && "${CMD[@]}" ) || echo "  ! $id: install failed (continuing)" >&2
            fi
        done < "$SELECTED"
        if [ "$MODE" = check ]; then
            if [ "$MISSING" -gt 0 ]; then
                echo "skills-sync: $MISSING skill(s) missing in $DEST_DIR" >&2
                exit 1
            fi
            echo "skills-sync: skills present in $DEST_DIR"
        fi
        exit 0
        ;;
    wired)
        # Harness-agnostic refresh of committed wired skills: fetch into a scratch dir
        # via `-a universal` (project path .agents/skills/), then copy each skill into
        # config/skills/. Never writes through ~/.agents/skills (that root holds
        # per-skill symlinks back into the repo).
        echo "Wired upstream exceptions -> config/skills/:"
        SCRATCH="$(mktemp -d)"
        trap 'rm -rf "$SCRATCH"' EXIT
        while IFS=$'\t' read -r id repo scope skills; do
            [ "$repo" = "-" ] && continue
            ADD_ARGS=()
            for s in $skills; do
                ADD_ARGS+=(--skill "$s")
            done
            CMD=(npx -y skills add "$repo" "${ADD_ARGS[@]}" -y -a universal --copy)
            echo "  $repo: $skills"
            echo "    (cd $SCRATCH && ${CMD[*]})"
            if [ "$DRYRUN" != true ]; then
                ( cd "$SCRATCH" && "${CMD[@]}" ) || { echo "  ! $repo fetch failed (continuing)" >&2; continue; }
                for s in $skills; do
                    if [ -d "$SCRATCH/.agents/skills/$s" ]; then
                        rm -rf "$REPO_ROOT/config/skills/$s"
                        cp -a "$SCRATCH/.agents/skills/$s" "$REPO_ROOT/config/skills/$s"
                        # strip non-standard keys upstream re-ships (e.g. agent-browser hidden: true)
                        sed -i -E '/^hidden:[[:space:]]*true[[:space:]]*$/d' "$REPO_ROOT/config/skills/$s/SKILL.md"
                    fi
                done
            fi
        done < <(_scope_filter wired)
        if [ "$DRYRUN" != true ]; then
            echo
            echo "git status --short config/skills:"
            git -C "$REPO_ROOT" status --short config/skills || true
            echo "Review the diff; nothing is committed automatically."
        fi
        exit 0
        ;;
esac
