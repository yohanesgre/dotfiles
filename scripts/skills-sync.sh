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
#   skills-sync.sh --wired --report           # drift report vs upstream (read-only, no writes)
#   skills-sync.sh --dry-run                  # print npx commands only
#
# Options:
#   --global        install to the harness-agnostic global root ~/.agents/skills via
#                   `npx skills -a universal` (used by hm-switch)
#   --project DIR   target project (default: $PWD)
#   --agent NAME    npx skills agent (default: universal -> .agents/skills; ignored
#                   with --global, which always targets ~/.agents/skills)
#   --symlink       symlink instead of --copy
#   --force         reinstall even when SKILL.md already exists; with --wired, overwrite
#                   skills that carry local modifications instead of skipping them
#   --report        with --wired: classify every committed wired skill against upstream
#                   (same / behind / local-mods / missing-upstream); clones into a scratch
#                   dir, never fetches via npx, never writes and never commits
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
REPORT=false
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
        --report) REPORT=true; shift ;;
        -h|--help) awk 'NR>1 && /^set -euo pipefail/{exit} NR>1' "$0"; exit 0 ;;
        *) echo "skills-sync: unknown arg '$1'" >&2; exit 2 ;;
    esac
done

if [ "$REPORT" = true ] && [ "$MODE" != wired ]; then
    echo "skills-sync: --report requires --wired" >&2
    exit 2
fi

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

# Locate the upstream skill dir (named exactly <skill>, containing SKILL.md) inside a
# cloned repo; the shortest matching path wins (repos sometimes mirror skills/ elsewhere).
_find_upstream_dir() {
    python3 - "$1" "$2" <<'PY'
import os, sys
root, skill = sys.argv[1], sys.argv[2]
best = ""
for dp, dn, fn in os.walk(root):
    dn[:] = [d for d in dn if d != ".git"]
    if os.path.basename(dp) == skill and "SKILL.md" in fn:
        if not best or len(dp) < len(best):
            best = dp
print(best)
PY
}

# Compare a committed skill dir against its upstream counterpart. Prints one TSV row:
#   status \t local_only \t upstream_only \t changed(<3 files | "N files" | "-")
# .openskills.json (npx install artifact) is ignored; SKILL.md hidden:true lines are dropped
# on both sides; whitespace-only lines and lines shorter than 8 chars are left out of the
# counts; a local line stops counting once it appears elsewhere in the upstream skill dir
# (content that moved/was duplicated into another upstream file, not local-only content).
_skill_diff() {
    python3 - "$1" "$2" <<'PY'
import os, re, sys

local, upstream = sys.argv[1], sys.argv[2]
HID = re.compile(r"^hidden:[ \t]*true[ \t]*$")

def rel_files(root):
    out = []
    if not os.path.isdir(root):
        return out
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d != ".git"]
        for f in fn:
            if f == ".openskills.json":
                continue
            out.append(os.path.relpath(os.path.join(dp, f), root))
    return out

def lines_of(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return []
    if os.path.basename(path) == "SKILL.md":
        lines = [l for l in lines if not HID.match(l)]
    return lines

def counted(line):
    return bool(line.strip()) and len(line) >= 8

lrel, urel = rel_files(local), rel_files(upstream)
utext = {r: "\n".join(lines_of(os.path.join(upstream, r))) for r in urel}

changed, lo_set, uo_set = [], set(), set()
for r in sorted(set(lrel) | set(urel)):
    lp, up = os.path.join(local, r), os.path.join(upstream, r)
    has_l, has_u = os.path.isfile(lp), os.path.isfile(up)
    ll = lines_of(lp) if has_l else []
    ul = lines_of(up) if has_u else []
    if has_l and has_u and ll == ul:
        continue
    changed.append(r)
    if has_l:
        base = set(ul) if has_u else set()
        elsewhere = "\n".join(t for o, t in utext.items() if o != r)
        lo_set |= {x for x in set(ll) - base if counted(x) and x not in elsewhere}
    if has_u:
        base = set(ll) if has_l else set()
        uo_set |= {x for x in set(ul) - base if counted(x)}

lo, uo = len(lo_set), len(uo_set)
if not changed:
    status, display = "same", "-"
else:
    status = "behind" if lo == 0 else "local-mods"
    display = ",".join(changed) if len(changed) <= 3 else "%d files" % len(changed)
print("%s\t%d\t%d\t%s" % (status, lo, uo, display))
PY
}

# Record the fetched upstream revision on a wired source entry in the manifest.
_record_upstream() {
    python3 - "$MANIFEST" "$1" "$2" "$3" <<'PY'
import json, sys
path, sid, sha, day = sys.argv[1:5]
with open(path, encoding="utf-8") as fh:
    man = json.load(fh)
for src in man.get("sources", []):
    if src.get("id") == sid:
        src["upstream_sha"] = sha
        src["upstream_imported"] = day
        break
else:
    sys.exit(0)
with open(path, "w", encoding="utf-8") as fh:
    json.dump(man, fh, indent=2, ensure_ascii=True)
    fh.write("\n")
PY
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
        # Read-only drift report: shallow-clone each wired source and classify every
        # committed skill against upstream. Never fetches via npx, never writes.
        if [ "$REPORT" = true ]; then
            SCRATCH="$(mktemp -d)"
            trap 'rm -rf "$SCRATCH"' EXIT
            ROWS="$SCRATCH/rows.tsv"
            : > "$ROWS"
            while IFS=$'\t' read -r id repo scope skills; do
                [ "$repo" = "-" ] && continue
                slug="${repo//\//-}"
                clone="$SCRATCH/$slug"
                if ! git clone --depth 1 --quiet "https://github.com/$repo" "$clone" 2>/dev/null; then
                    echo "  ! $repo: clone failed (continuing)" >&2
                    continue
                fi
                rev=""; rdate=""
                read -r rev rdate < <(git -C "$clone" log -1 --format='%h %cs' 2>/dev/null) || true
                for s in $skills; do
                    ldir="$REPO_ROOT/config/skills/$s"
                    udir="$(_find_upstream_dir "$clone" "$s" || true)"
                    if [ -z "$udir" ]; then
                        printf '%s\t%s\tmissing-upstream\t-\t-\t%s\t%s\n' "$s" "$repo" "$rev" "$rdate" >> "$ROWS"
                        continue
                    fi
                    out="$(_skill_diff "$ldir" "$udir" || true)"
                    st=""; lo=""; uo=""; chg=""
                    IFS=$'\t' read -r st lo uo chg <<<"$out" || true
                    if [ -z "$st" ]; then
                        printf '%s\t%s\tcompare-failed\t-\t-\t%s\t%s\n' "$s" "$repo" "$rev" "$rdate" >> "$ROWS"
                        continue
                    fi
                    printf '%s\t%s\t%s\t%s\t%s/%s\t%s\t%s\n' \
                        "$s" "$repo" "$st" "$chg" "$lo" "$uo" "$rev" "$rdate" >> "$ROWS"
                done
            done < <(_scope_filter wired)
            { printf 'skill\trepo\tstatus\tchanged\tlocal/upstream\tupstream_sha\tupstream_date\n'
              cat "$ROWS"; } | column -t -s $'\t'
            echo
            awk -F'\t' '
                $3 == "same" { same++ }
                $3 == "behind" { behind++ }
                $3 == "local-mods" { mods++ }
                $3 == "missing-upstream" { miss++ }
                END { printf "summary: same=%d behind=%d local-mods=%d missing-upstream=%d\n",
                      same + 0, behind + 0, mods + 0, miss + 0 }
            ' "$ROWS"
            exit 0
        fi
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
                COPIED=0
                for s in $skills; do
                    src="$SCRATCH/.agents/skills/$s"
                    dst="$REPO_ROOT/config/skills/$s"
                    [ -d "$src" ] || continue
                    out="$(_skill_diff "$dst" "$src" || true)"
                    st=""; lo=""; uo=""; chg=""
                    IFS=$'\t' read -r st lo uo chg <<<"$out" || true
                    if [ -z "$st" ]; then
                        echo "  ! $s: comparison failed; skipping" >&2
                        continue
                    fi
                    if [ "$st" = local-mods ] && [ "$FORCE" != true ]; then
                        echo "  ! $s: local modifications detected ($lo lines); use --force to overwrite" >&2
                        continue
                    fi
                    rm -rf "$dst"
                    cp -a "$src" "$dst"
                    rm -f "$dst/.openskills.json"
                    # strip non-standard keys upstream re-ships (e.g. agent-browser hidden: true)
                    sed -i -E '/^hidden:[[:space:]]*true[[:space:]]*$/d' "$dst/SKILL.md"
                    COPIED=$((COPIED + 1))
                done
                if [ "$COPIED" -gt 0 ]; then
                    if upstream_sha="$(git ls-remote "https://github.com/$repo" HEAD 2>/dev/null | cut -c1-7)" \
                        && [ -n "$upstream_sha" ]; then
                        _record_upstream "$id" "$upstream_sha" "$(date +%F)"
                    else
                        echo "  ! $repo: could not read upstream sha (revision not recorded)" >&2
                    fi
                fi
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
