#!/usr/bin/env python3
"""Migrate legacy repository-local work-plans tracking into the external root.

The destination is printed by plan-root.sh (never re-derived here). Sources are
the ``status/`` directories of the control checkout and of every linked Git
worktree; ``--source`` overrides that discovery with explicit directories.

Safety model
  * dry-run (default) is a read-only inventory and emits a structured JSON map;
    it performs no filesystem writes at all.
  * apply requires ``--writers-paused``, holds the shared timeline writer flock
    (``<plan-root parent>/.locks/<repo-id>.timeline.lock``) for the whole apply,
    takes a destination lock, backs up every source outside the repository,
    stages a complete store on the destination filesystem, validates all staged
    plans/archives with ``plan-check.sh --root --``, re-checks every source and
    the existing destination, and only then activates.
  * before activation the originals remain authoritative. After activation a
    backup + manifest (outside the active root) allow recovery; new events
    appended to the external store after activation must be reconciled, so the
    migration never claims a lossless automatic rollback.
  * retirement never deletes original data: each source is moved with an atomic
    rename into a quarantine directory, the quarantined tree is re-verified
    against the inventory, and the exact recovery mapping is recorded in the
    manifest. A source recreated after the rename, or a quarantine that no
    longer matches the inventory, is reported as a race and the migration does
    not claim a single clean authority.
  * same-filesystem sources quarantine inside the external metadata directory;
    cross-filesystem sources quarantine outside every checkout on their own
    filesystem, and the run blocks before staging when no such location exists
    (never a copy+recursive-delete pretending to be atomic).
  * symlinks, tracked source artifacts, unknown loose files, plan-name
    collisions with different content, and changing sources all fail safely.

stdout carries one JSON report; diagnostics go to stderr.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import traceback

try:
    import fcntl
except ImportError:  # pragma: no cover - POSIX-only helper
    fcntl = None

TOOL = "migrate-status"
SCHEMA = 1

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_BLOCKED = 3
EXIT_RACE = 4
EXIT_FAILED = 5

PLAN_NAME_RE = re.compile(r"^[a-z0-9-]+$")
ARCHIVE_NAME_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$")
REPO_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})")
LANE_RE = re.compile(r"^lanes/[^/]+\.md$")
FENCE_RE = re.compile(r"^[ \t]*(```|~~~)")
EVIDENCE_RE = re.compile(r"\bgit\s+(?:log|show|diff|blame)\b")
PROMPT_RE = re.compile(r"^\s*\$\s")
ALLOWED_PLAN_FILES = ("plan.md", "status.md", "report.md")
REWRITABLE_PLAN_FILES = frozenset(ALLOWED_PLAN_FILES)
FAULT_ENV = "WORK_PLANS_MIGRATE_TEST_FAULT"

REWRITE_POLICY = (
    "rewrites only repository-local tracking links (status/TIMELINE.md, "
    "status/archive/, status/<known plan>) and absolute references into "
    "inventoried legacy status roots (including their TIMELINE.md, archive "
    "directories, plan directories, and inventoried files); fenced code blocks, "
    "shell prompts, git log/show/diff/blame evidence lines, implementation "
    "paths, and every other absolute or non-tracking byte are preserved"
)

USAGE = """usage: migrate-status.sh [--dry-run | --apply --writers-paused] [--source <absolute status dir>]...

Migrate repository-local work-plans tracking (status/) into the external XDG
state root printed by `bash scripts/plan-root.sh`.

  (default) / --dry-run   read-only inventory and JSON mapping; no writes
  --apply                 stage, validate, activate, then quarantine migrated
                          sources (atomic rename; originals retained; recovery
                          mapping recorded outside the active root)
  --writers-paused        required acknowledgment for --apply; migration cannot
                          force-pause writers, so re-checks and quarantine
                          verification detect races instead of assuming none
  --source <dir>          explicit absolute status directory; repeatable;
                          limits what is migrated, but every discovered legacy
                          status root is still inventoried: a nonempty omitted
                          root blocks apply and is reported as source_omitted

stdout: one structured JSON report. stderr: diagnostics.
exit codes: 0 ok, 2 usage/environment, 3 blocked (conflict/invalid/unknown),
            4 destination lock, source race, or quarantine/authority race,
            5 apply failure
dry-run always exits 0 when the inventory completes; read `would_apply`,
`omitted_sources`, and `blockers` for whether --apply would succeed. Apply
exits 3 on blockers.

Test-only fault injection (never set in normal use):
  WORK_PLANS_MIGRATE_TEST_FAULT=fail-before-activation
  WORK_PLANS_MIGRATE_TEST_FAULT=mutate-source-before-activation
  WORK_PLANS_MIGRATE_TEST_FAULT=mutate-source-after-recheck
  WORK_PLANS_MIGRATE_TEST_FAULT=recreate-source-after-quarantine
  WORK_PLANS_MIGRATE_TEST_FAULT=mutate-destination-before-activation
  WORK_PLANS_MIGRATE_TEST_FAULT=create-destination-before-activation
  WORK_PLANS_MIGRATE_TEST_FAULT=fail-after-retire-existing
"""

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))


class MigrateError(Exception):
    def __init__(self, code, message, exit_code=EXIT_FAILED, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.details = details


def diag(message):
    sys.stderr.write("migrate-status: %s\n" % message)


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1 << 20)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def decode(data):
    return data.decode("utf-8", "surrogateescape")


def encode(text):
    return text.encode("utf-8", "surrogateescape")


def run(cmd, cwd=None, timeout=180):
    return subprocess.run(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )


def combined_output(proc):
    return decode(proc.stdout) + decode(proc.stderr)


def is_within(path, parent):
    return path == parent or path.startswith(parent + os.sep)


def nearest_existing(path):
    current = os.path.abspath(path)
    while not os.path.exists(current):
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return current


def path_components(path):
    """Every existing path component from the filesystem root down to ``path``."""
    absolute = os.path.abspath(path)
    parts = []
    while True:
        parent = os.path.dirname(absolute)
        if parent == absolute:
            break
        parts.append(absolute)
        absolute = parent
    parts.reverse()
    return [part for part in parts if os.path.lexists(part)]


def symlink_components(path):
    return [part for part in path_components(path) if os.path.islink(part)]


def assert_no_symlink_components(path, what):
    bad = symlink_components(path)
    if bad:
        raise MigrateError(
            "metadata_path_symlink",
            "%s has a symlink component: %s" % (what, bad[0]),
            EXIT_BLOCKED,
            {"path": path, "symlinks": bad},
        )


def problem(code, message, source=None, path=None, detail=None):
    return {
        "code": code,
        "message": message,
        "source": source,
        "path": path,
        "detail": detail,
    }


def new_report(mode):
    return {
        "tool": TOOL,
        "schema": SCHEMA,
        "mode": mode,
        "ok": False,
        "status": "init",
        "exit_code": EXIT_FAILED,
        "will_write": mode == "apply",
        "would_apply": False,
        "repo": None,
        "destination": None,
        "sources": [],
        "omitted_sources": [],
        "existing_destination": None,
        "plans": [],
        "archives": [],
        "timeline": {
            "entries": 0,
            "deduped": [],
            "blank_lines_dropped": 0,
            "malformed": 0,
        },
        "rewrites": {"total_replacements": 0, "files": [], "policy": REWRITE_POLICY},
        "conflicts": [],
        "invalid_plans": [],
        "unknown_entries": [],
        "tracked": [],
        "symlinks": [],
        "blockers": [],
        "validation": {"performed": False, "plans": [], "archives": []},
        "backup": None,
        "staging": None,
        "manifest": None,
        "activation": None,
        "retired_sources": [],
        "quarantined_sources": [],
        "retirement": None,
        "single_authority": True,
        "lock": None,
        "timeline_lock": None,
        "notes": [],
        "error": None,
    }


def classify_problems(report, problems):
    for item in problems:
        entry = {
            "code": item["code"],
            "message": item.get("message", item["code"]),
            "source": item.get("source"),
            "path": item.get("path"),
        }
        if item.get("detail"):
            entry["detail"] = item["detail"]
        report["blockers"].append(entry)
        code = item["code"]
        if code in ("plan_conflict", "archive_conflict", "existing_destination_conflict"):
            report["conflicts"].append(entry)
        elif code.startswith("invalid_") or code == "missing_plan_file":
            report["invalid_plans"].append(entry)
        elif code == "tracked_artifact":
            report["tracked"].append(entry)
        elif code in (
            "source_symlink",
            "destination_symlink",
            "metadata_path_symlink",
        ):
            report["symlinks"].append(entry)
        elif code in (
            "source_omitted",
            "destination_changed",
            "source_changed",
            "source_recreated",
        ):
            pass
        else:
            report["unknown_entries"].append(entry)


def repo_info(cwd):
    proc = run(["git", "rev-parse", "--show-toplevel"], cwd=cwd, timeout=60)
    if proc.returncode != 0:
        message = decode(proc.stderr).strip() or "git rev-parse failed"
        raise MigrateError("outside_git", "not inside a Git worktree: %s" % message, EXIT_USAGE)
    root = os.path.realpath(decode(proc.stdout).strip())
    proc = run(["git", "-C", root, "worktree", "list", "--porcelain"], cwd=root, timeout=60)
    if proc.returncode != 0:
        raise MigrateError(
            "git_failed",
            "git worktree list failed: %s" % decode(proc.stderr).strip(),
            EXIT_USAGE,
        )
    worktrees = []
    for line in decode(proc.stdout).splitlines():
        if line.startswith("worktree "):
            wt = os.path.realpath(line[len("worktree "):])
            if wt not in worktrees:
                worktrees.append(wt)
    if root in worktrees:
        worktrees.remove(root)
    worktrees.insert(0, root)
    return {"root": root, "worktrees": worktrees}


def resolve_root(cwd):
    resolver = os.path.join(SCRIPT_DIR, "plan-root.sh")
    if not os.path.isfile(resolver):
        raise MigrateError("resolver_missing", "resolver not found: %s" % resolver, EXIT_USAGE)
    try:
        proc = run(["bash", resolver], cwd=cwd, timeout=60)
    except subprocess.TimeoutExpired:
        raise MigrateError("resolver_failed", "plan-root.sh timed out", EXIT_USAGE)
    if proc.returncode != 0:
        message = decode(proc.stderr).strip()
        code = "outside_git" if "git" in message.lower() else "resolver_failed"
        raise MigrateError(code, message or "plan-root.sh exited %d" % proc.returncode, EXIT_USAGE)
    out = decode(proc.stdout).strip()
    if not out:
        raise MigrateError("resolver_output_invalid", "plan-root.sh printed no root", EXIT_USAGE)
    if "\n" in out:
        raise MigrateError(
            "resolver_output_invalid", "plan-root.sh printed more than one line", EXIT_USAGE
        )
    if not os.path.isabs(out):
        raise MigrateError(
            "resolver_output_invalid", "plan-root.sh printed a relative path: %s" % out, EXIT_USAGE
        )
    return os.path.normpath(out)


def meta_layout(root):
    root = os.path.normpath(root)
    parent = os.path.dirname(root)
    base = os.path.basename(root)
    if not base or base in (".", "..") or not REPO_ID_RE.match(base):
        raise MigrateError(
            "destination_invalid",
            "resolver returned an unusable destination basename: %r" % base,
            EXIT_USAGE,
        )
    meta_base = os.path.join(parent, ".migrations", base)
    return parent, meta_base, os.path.join(meta_base, "lock")


def acquire_lock(lock_path):
    parent = os.path.dirname(lock_path)
    assert_no_symlink_components(parent, "migration metadata directory")
    os.makedirs(parent, exist_ok=True)
    if os.path.islink(parent):
        raise MigrateError(
            "metadata_path_symlink",
            "migration metadata directory is a symlink: %s" % parent,
            EXIT_BLOCKED,
            {"path": parent},
        )
    try:
        handle = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise MigrateError(
            "destination_locked", "destination lock already held: %s" % lock_path, EXIT_RACE
        )
    try:
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        os.write(handle, ("pid=%d\nstarted=%s\n" % (os.getpid(), stamp)).encode())
    finally:
        os.close(handle)
    return lock_path


def release_lock(lock_path):
    if not lock_path:
        return
    try:
        with open(lock_path, "r", encoding="utf-8", errors="replace") as handle:
            content = handle.read()
    except OSError:
        return
    if ("pid=%d" % os.getpid()) in content:
        try:
            os.unlink(lock_path)
        except OSError:
            pass


def timeline_lock_path(root):
    """Shared writer flock path used by plan-event.sh and friends."""
    return os.path.join(
        os.path.dirname(root), ".locks", "%s.timeline.lock" % os.path.basename(root)
    )


def acquire_timeline_lock(path, timeout=15.0):
    """Hold the shared timeline flock so writer helpers serialize with apply."""
    if fcntl is None:  # pragma: no cover - POSIX-only helper
        raise MigrateError(
            "timeline_lock_unavailable", "fcntl is unavailable on this platform", EXIT_USAGE
        )
    directory = os.path.dirname(path)
    assert_no_symlink_components(directory, "timeline lock directory")
    os.makedirs(directory, exist_ok=True)
    if os.path.islink(directory):
        raise MigrateError(
            "metadata_path_symlink",
            "timeline lock directory is a symlink: %s" % directory,
            EXIT_BLOCKED,
            {"path": directory},
        )
    if os.path.islink(path):
        raise MigrateError(
            "metadata_path_symlink",
            "timeline lock file is a symlink: %s" % path,
            EXIT_BLOCKED,
            {"path": path},
        )
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    try:
        handle = os.open(path, flags, 0o600)
    except OSError as exc:
        raise MigrateError(
            "timeline_lock_failed", "cannot open timeline lock %s: %s" % (path, exc), EXIT_FAILED
        )
    deadline = time.monotonic() + timeout
    while True:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(handle)
                raise MigrateError(
                    "timeline_locked",
                    "timeline writer lock is held by another process: %s" % path,
                    EXIT_RACE,
                    {"path": path},
                )
            time.sleep(0.05)
        except OSError as exc:
            os.close(handle)
            raise MigrateError(
                "timeline_lock_failed", "cannot lock %s: %s" % (path, exc), EXIT_FAILED
            )
    return handle


def release_timeline_lock(handle):
    if handle is None:
        return
    try:
        fcntl.flock(handle, fcntl.LOCK_UN)
    except OSError:
        pass
    try:
        os.close(handle)
    except OSError:
        pass


def new_store(path, kind, index, worktree=None):
    return {
        "path": path,
        "kind": kind,
        "index": index,
        "worktree": worktree,
        "entries": [],
        "timeline_path": None,
        "timeline_lines": [],
        "timeline_record": None,
        "problems": [],
        "tracked": [],
        "root_dirs": [],
        "file_count": 0,
    }


def scan_entry(entry_dir, key, kind, source_path, problems):
    files = {}
    dirs = []
    for dirpath, dirnames, filenames in os.walk(entry_dir, followlinks=False):
        rel_dir = os.path.relpath(dirpath, entry_dir)
        if rel_dir != ".":
            dirs.append(rel_dir)
            if rel_dir != "lanes":
                problems.append(
                    problem(
                        "unknown_plan_dir",
                        "unexpected directory in %s %s: %s" % (kind, key, rel_dir),
                        source_path,
                        os.path.join(entry_dir, rel_dir),
                    )
                )
        kept = []
        for name in sorted(dirnames):
            path = os.path.join(dirpath, name)
            if os.path.islink(path):
                problems.append(
                    problem(
                        "source_symlink",
                        "symlink in %s %s is refused: %s" % (kind, key, name),
                        source_path,
                        path,
                    )
                )
            else:
                kept.append(name)
        dirnames[:] = kept
        for name in sorted(filenames):
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, entry_dir)
            if os.path.islink(path):
                problems.append(
                    problem(
                        "source_symlink",
                        "symlink in %s %s is refused: %s" % (kind, key, rel),
                        source_path,
                        path,
                    )
                )
                continue
            info = os.lstat(path)
            if not stat.S_ISREG(info.st_mode):
                problems.append(
                    problem(
                        "unknown_plan_file",
                        "non-regular file in %s %s: %s" % (kind, key, rel),
                        source_path,
                        path,
                    )
                )
                continue
            if rel not in ALLOWED_PLAN_FILES and not LANE_RE.match(rel):
                problems.append(
                    problem(
                        "unknown_plan_file",
                        "unexpected file in %s %s: %s" % (kind, key, rel),
                        source_path,
                        path,
                    )
                )
            files[rel] = {
                "rel": rel,
                "sha256": sha256_file(path),
                "size": info.st_size,
                "mtime_ns": info.st_mtime_ns,
                "mode": stat.S_IMODE(info.st_mode),
            }
    for required in ("plan.md", "status.md"):
        if required not in files:
            problems.append(
                problem(
                    "missing_plan_file",
                    "%s %s missing %s" % (kind, key, required),
                    source_path,
                    os.path.join(entry_dir, required),
                )
            )
    return files, dirs


def inventory_archive(inv, archive_dir):
    try:
        names = sorted(os.listdir(archive_dir))
    except OSError as exc:
        inv["problems"].append(
            problem("source_unreadable", "cannot list %s: %s" % (archive_dir, exc), archive_dir, archive_dir)
        )
        return
    for name in names:
        path = os.path.join(archive_dir, name)
        if os.path.islink(path):
            inv["problems"].append(
                problem("source_symlink", "symlink in archive is refused: %s" % name, archive_dir, path)
            )
            continue
        if not os.path.isdir(path):
            inv["problems"].append(
                problem("unknown_entry", "loose file in archive/: %s" % name, archive_dir, path)
            )
            continue
        if not ARCHIVE_NAME_RE.match(name):
            inv["problems"].append(
                problem(
                    "invalid_archive_name",
                    "invalid archive directory name: %r" % name,
                    archive_dir,
                    path,
                )
            )
            continue
        files, dirs = scan_entry(path, name, "archive", inv["path"], inv["problems"])
        inv["entries"].append(
            {
                "key": name,
                "kind": "archive",
                "source_index": inv["index"],
                "source_path": inv["path"],
                "path": path,
                "root_rel": os.path.join("archive", name),
                "files": files,
                "dirs": dirs,
            }
        )


def inventory_store(path, kind, index, worktree=None):
    inv = new_store(path, kind, index, worktree)
    if os.path.islink(path):
        inv["problems"].append(
            problem("source_symlink", "refusing symlinked tracking dir: %s" % path, path, path)
        )
        return inv
    if not os.path.isdir(path):
        inv["problems"].append(
            problem("source_not_directory", "tracking dir is not a directory: %s" % path, path, path)
        )
        return inv
    try:
        names = sorted(os.listdir(path))
    except OSError as exc:
        inv["problems"].append(problem("source_unreadable", "cannot list %s: %s" % (path, exc), path, path))
        return inv
    for name in names:
        entry_path = os.path.join(path, name)
        if os.path.islink(entry_path):
            inv["problems"].append(
                problem("source_symlink", "symlink is refused: %s" % name, path, entry_path)
            )
            continue
        if os.path.isdir(entry_path):
            inv["root_dirs"].append(name)
            if name == "archive":
                inventory_archive(inv, entry_path)
                continue
            if not PLAN_NAME_RE.match(name):
                inv["problems"].append(
                    problem(
                        "invalid_plan_name",
                        "invalid plan directory name: %r" % name,
                        path,
                        entry_path,
                    )
                )
                continue
            files, dirs = scan_entry(entry_path, name, "plan", path, inv["problems"])
            inv["entries"].append(
                {
                    "key": name,
                    "kind": "plan",
                    "source_index": index,
                    "source_path": path,
                    "path": entry_path,
                    "root_rel": name,
                    "files": files,
                    "dirs": dirs,
                }
            )
        elif os.path.isfile(entry_path):
            if name == "TIMELINE.md":
                inv["timeline_path"] = entry_path
            else:
                inv["problems"].append(
                    problem("unknown_entry", "loose file in tracking dir: %s" % name, path, entry_path)
                )
        else:
            inv["problems"].append(
                problem("unknown_entry", "unsupported tracking entry: %s" % name, path, entry_path)
            )
    if inv["timeline_path"]:
        info = os.lstat(inv["timeline_path"])
        inv["timeline_record"] = {
            "sha256": sha256_file(inv["timeline_path"]),
            "size": info.st_size,
            "mtime_ns": info.st_mtime_ns,
        }
        with open(inv["timeline_path"], "rb") as handle:
            lines = decode(handle.read()).split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        inv["timeline_lines"] = lines
    elif kind != "destination":
        inv["problems"].append(
            problem("missing_timeline", "tracking dir has no TIMELINE.md: %s" % path, path, path)
        )
    inv["file_count"] = sum(len(entry["files"]) for entry in inv["entries"])
    if inv["timeline_path"]:
        inv["file_count"] += 1
    return inv


def check_tracked(inv):
    worktree = inv["worktree"]
    if not worktree:
        return
    rel = os.path.relpath(inv["path"], worktree)
    if rel in (".", "..") or rel.startswith(".." + os.sep):
        inv["problems"].append(
            problem(
                "source_not_in_worktree",
                "source %s is not inside a single worktree" % inv["path"],
                inv["path"],
                inv["path"],
            )
        )
        return
    proc = run(["git", "-C", worktree, "ls-files", "-z", "--", rel], timeout=60)
    if proc.returncode != 0:
        inv["problems"].append(
            problem(
                "git_failed",
                "git ls-files failed for %s: %s" % (worktree, decode(proc.stderr).strip()),
                inv["path"],
                worktree,
            )
        )
        return
    tracked = [item for item in decode(proc.stdout).split("\0") if item]
    if tracked:
        inv["tracked"] = tracked
        inv["problems"].append(
            problem(
                "tracked_artifact",
                "tracked files under %s must be handled through normal repository review" % inv["path"],
                inv["path"],
                inv["path"],
                detail=", ".join(tracked[:20]),
            )
        )


def discover_all(repo, problems):
    """Every legacy status/ directory known from the control checkout and linked worktrees."""
    sources = []
    seen = set()
    for worktree in repo["worktrees"]:
        candidate = os.path.join(worktree, "status")
        if os.path.islink(candidate):
            problems.append(
                problem(
                    "source_symlink",
                    "refusing symlinked status dir: %s" % candidate,
                    candidate,
                    candidate,
                )
            )
            continue
        if not os.path.exists(candidate):
            continue
        if not os.path.isdir(candidate):
            problems.append(
                problem(
                    "source_not_directory",
                    "status path is not a directory: %s" % candidate,
                    candidate,
                    candidate,
                )
            )
            continue
        real = os.path.realpath(candidate)
        if real in seen:
            continue
        seen.add(real)
        sources.append(
            {
                "path": real,
                "kind": "control" if worktree == repo["root"] else "worktree",
                "worktree": worktree,
            }
        )
    return sources


def discover(repo, explicit, problems):
    """Selected sources plus an account of every discovered legacy root left out."""
    discovered = discover_all(repo, problems)
    if not explicit:
        return discovered, []
    selected = []
    seen = set()
    for raw in explicit:
        if not os.path.isabs(raw):
            raise MigrateError(
                "source_not_absolute", "--source must be absolute: %s" % raw, EXIT_USAGE
            )
        path = os.path.normpath(raw)
        real = os.path.realpath(path)
        if real in seen:
            continue
        seen.add(real)
        if os.path.basename(path) != "status":
            raise MigrateError(
                "source_not_status_dir",
                "--source must name a legacy status directory: %s" % raw,
                EXIT_USAGE,
            )
        if os.path.islink(path):
            raise MigrateError("source_symlink", "refusing symlinked source: %s" % raw, EXIT_BLOCKED)
        if not os.path.isdir(path):
            raise MigrateError("source_missing", "--source is not a directory: %s" % raw, EXIT_USAGE)
        worktree = None
        for candidate in repo["worktrees"]:
            if is_within(real, candidate) and (worktree is None or len(candidate) > len(worktree)):
                worktree = candidate
        if worktree is None:
            problems.append(
                problem(
                    "source_not_in_worktree",
                    "source is not inside a known worktree: %s" % real,
                    real,
                    real,
                )
            )
            kind = "explicit"
        elif worktree == repo["root"]:
            kind = "control"
        else:
            kind = "worktree"
        selected.append({"path": real, "kind": kind, "worktree": worktree})
    omitted = []
    selected_paths = {meta["path"] for meta in selected}
    for meta in discovered:
        if meta["path"] in selected_paths:
            continue
        nonempty = False
        try:
            nonempty = bool(os.listdir(meta["path"]))
        except OSError:
            nonempty = True
        row = {
            "path": meta["path"],
            "kind": meta["kind"],
            "worktree": meta["worktree"],
            "nonempty": nonempty,
        }
        omitted.append(row)
        if nonempty:
            problems.append(
                problem(
                    "source_omitted",
                    "legacy tracking root is not included in --source and is not empty: %s"
                    % meta["path"],
                    meta["path"],
                    meta["path"],
                    detail="include it with --source or migrate it before cutover",
                )
            )
    return selected, omitted


def same_files(left, right):
    if set(left) != set(right):
        return False
    for rel, rec in left.items():
        other = right[rel]
        if rec["sha256"] != other["sha256"] or rec["size"] != other["size"]:
            return False
    return True


def differing_files(left, right):
    differing = []
    for rel in sorted(set(left) | set(right)):
        if rel not in left or rel not in right:
            differing.append(rel)
        elif left[rel]["sha256"] != right[rel]["sha256"]:
            differing.append(rel)
    return differing


def merge_entries(stores):
    merged = {}
    problems = []
    for inv in stores:
        for entry in inv["entries"]:
            key = (entry["kind"], entry["key"])
            if key not in merged:
                merged[key] = {
                    "kind": entry["kind"],
                    "key": entry["key"],
                    "root_rel": entry["root_rel"],
                    "files": dict(entry["files"]),
                    "dirs": list(entry["dirs"]),
                    "entry": entry,
                    "sources": [inv["path"]],
                    "deduped": False,
                    "from_destination": inv["kind"] == "destination",
                }
                continue
            current = merged[key]
            if same_files(current["files"], entry["files"]):
                current["deduped"] = True
                if inv["path"] not in current["sources"]:
                    current["sources"].append(inv["path"])
                if inv["kind"] == "destination":
                    current["from_destination"] = True
                if len(entry["dirs"]) > len(current["dirs"]):
                    current["dirs"] = list(entry["dirs"])
                continue
            diff = differing_files(current["files"], entry["files"])
            conflict_code = "plan_conflict"
            if entry["kind"] == "archive":
                conflict_code = "archive_conflict"
            if inv["kind"] == "destination" or current["from_destination"]:
                conflict_code = "existing_destination_conflict"
            problems.append(
                problem(
                    conflict_code,
                    "%s name collision with different content: %s" % (entry["kind"], entry["key"]),
                    inv["path"],
                    entry["path"],
                    detail="differing files: " + ", ".join(diff),
                )
            )
    return merged, problems


def merge_timeline(stores):
    ordered = []
    seen = {}
    blank = 0
    for inv in stores:
        for line in inv["timeline_lines"]:
            if line.strip() == "":
                blank += 1
                continue
            if line in seen:
                seen[line]["count"] += 1
                if inv["path"] not in seen[line]["sources"]:
                    seen[line]["sources"].append(inv["path"])
            else:
                seen[line] = {"count": 1, "sources": [inv["path"]]}
                ordered.append(line)

    def date_key(line):
        match = DATE_RE.match(line)
        if match:
            return (0, match.group(1))
        return (1, "")

    lines = sorted(ordered, key=date_key)
    deduped = [
        {"line": line, "count": value["count"], "sources": value["sources"]}
        for line, value in seen.items()
        if value["count"] > 1
    ]
    malformed = sum(1 for line in lines if not DATE_RE.match(line))
    mtimes = [inv["timeline_record"]["mtime_ns"] for inv in stores if inv["timeline_record"]]
    return {
        "lines": lines,
        "deduped": deduped,
        "blank_lines_dropped": blank,
        "malformed": malformed,
        "mtime_ns": max(mtimes) if mtimes else None,
    }


def absolute_rewrite_rule(sources):
    """Map inventoried absolute tracking paths to their store-relative form."""
    mappings = {}
    for inv in sources:
        prefixes = {inv["path"]}
        if inv["worktree"]:
            prefixes.add(os.path.normpath(os.path.join(inv["worktree"], "status")))
        for prefix in sorted(prefixes):
            if inv["timeline_path"]:
                mappings.setdefault(prefix + "/TIMELINE.md", "TIMELINE.md")
            if "archive" in inv["root_dirs"]:
                mappings.setdefault(prefix + "/archive", "archive")
            for entry in inv["entries"]:
                mappings.setdefault(
                    prefix + "/" + entry["root_rel"], entry["root_rel"]
                )
                for rel in entry["files"]:
                    mappings[prefix + "/" + entry["root_rel"] + "/" + rel] = (
                        entry["root_rel"] + "/" + rel
                    )
    if not mappings:
        return []
    ordered = sorted(mappings, key=lambda value: (-len(value), value))
    pattern = re.compile(
        r"(?<![A-Za-z0-9._/-])(?:" + "|".join(re.escape(key) for key in ordered) + r")"
        r"(?![A-Za-z0-9._/-])"
    )
    return [("absolute tracking", pattern, lambda match: mappings[match.group(0)])]


def rewrite_rules(merged, sources=None):
    names = sorted({item["key"] for item in merged.values()}, key=lambda name: (-len(name), name))
    rules = [
        (
            "status/archive/",
            re.compile(r"(?<![A-Za-z0-9._/-])status/archive/"),
            lambda match: "archive/",
        ),
        (
            "status/TIMELINE.md",
            re.compile(
                r"(?<![A-Za-z0-9._/-])status/TIMELINE\.md"
                r"(?![A-Za-z0-9_-])(?!\.[A-Za-z0-9_-])"
            ),
            lambda match: "TIMELINE.md",
        ),
    ]
    if names:
        alternation = "|".join(re.escape(name) for name in names)
        rules.append(
            (
                "status/<plan>",
                re.compile(
                    r"(?<![A-Za-z0-9._/-])status/(?:" + alternation + r")"
                    r"(?![A-Za-z0-9_-])(?!\.[A-Za-z0-9_-])"
                ),
                lambda match: match.group(0)[len("status/"):],
            )
        )
    if sources:
        rules.extend(absolute_rewrite_rule(sources))
    return rules


def rewrite_text(text, rules):
    counts = {name: 0 for name, _rx, _repl in rules}
    fenced_skipped = 0
    evidence_skipped = 0
    lines = text.split("\n")
    fenced = False
    for index, line in enumerate(lines):
        if FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced:
            if any(rx.search(line) for _name, rx, _repl in rules):
                fenced_skipped += 1
            continue
        if EVIDENCE_RE.search(line) or PROMPT_RE.match(line):
            if any(rx.search(line) for _name, rx, _repl in rules):
                evidence_skipped += 1
            continue
        current = line
        for name, rx, repl in rules:
            current, replacements = rx.subn(repl, current)
            if replacements:
                counts[name] += replacements
        lines[index] = current
    return "\n".join(lines), counts, fenced_skipped, evidence_skipped


def read_verified(path, rec):
    try:
        with open(path, "rb") as handle:
            data = handle.read()
    except OSError as exc:
        raise MigrateError(
            "source_unreadable", "cannot read %s: %s" % (path, exc), EXIT_BLOCKED
        )
    if sha256_bytes(data) != rec["sha256"] or len(data) != rec["size"]:
        raise MigrateError(
            "source_changed", "source changed during migration: %s" % path, EXIT_RACE
        )
    return data


def compute_rewrite_plan(merged, timeline_text, rules, timeline_mtime_ns, timeline_sha_before):
    files = []
    total = 0
    expected = {}
    for item in sorted(merged.values(), key=lambda value: (value["kind"], value["key"])):
        base = item["root_rel"]
        for rel in sorted(item["files"]):
            rec = item["files"][rel]
            path = os.path.join(item["entry"]["path"], rel)
            data = read_verified(path, rec)
            if rel in REWRITABLE_PLAN_FILES:
                new_text, counts, fenced, evidence = rewrite_text(decode(data), rules)
                new_data = encode(new_text)
                replacements = sum(counts.values())
            else:
                new_data = data
                counts = {}
                fenced = 0
                evidence = 0
                replacements = 0
            staged_sha = sha256_bytes(new_data)
            stage_rel = base + "/" + rel
            if replacements or fenced or evidence:
                files.append(
                    {
                        "path": stage_rel,
                        "rules": {name: count for name, count in counts.items() if count},
                        "replacements": replacements,
                        "fenced_skipped": fenced,
                        "evidence_skipped": evidence,
                        "sha256_before": rec["sha256"],
                        "sha256_after": staged_sha,
                        "changed": staged_sha != rec["sha256"],
                    }
                )
                total += replacements
            expected[stage_rel] = {
                "sha256": staged_sha,
                "size": len(new_data),
                "mtime_ns": rec["mtime_ns"],
                "mode": rec["mode"],
                "data": new_data,
            }
    rewritten_timeline, counts, fenced, evidence = rewrite_text(timeline_text, rules)
    timeline_data = encode(rewritten_timeline)
    timeline_sha = sha256_bytes(timeline_data)
    if any(counts.values()) or fenced or evidence:
        files.append(
            {
                "path": "TIMELINE.md",
                "rules": {name: count for name, count in counts.items() if count},
                "replacements": sum(counts.values()),
                "fenced_skipped": fenced,
                "evidence_skipped": evidence,
                "sha256_before": timeline_sha_before,
                "sha256_after": timeline_sha,
                "changed": timeline_sha != timeline_sha_before,
            }
        )
    total += sum(counts.values())
    expected["TIMELINE.md"] = {
        "sha256": timeline_sha,
        "size": len(timeline_data),
        "mtime_ns": timeline_mtime_ns if timeline_mtime_ns is not None else time.time_ns(),
        "mode": 0o644,
        "data": timeline_data,
    }
    return {"total_replacements": total, "files": files}, expected


def expected_dirs(merged):
    dirs = set()
    for item in merged.values():
        base = item["root_rel"]
        dirs.add(base)
        for rel_dir in item["dirs"]:
            dirs.add(os.path.join(base, rel_dir))
        if item["kind"] == "archive":
            dirs.add("archive")
    return dirs


def write_file(path, data, mode, mtime_ns):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)
    os.chmod(path, mode)
    os.utime(path, ns=(mtime_ns, mtime_ns))


def snapshot_tree(root):
    snapshot = {}
    dirs = set()
    bad = []
    if not os.path.isdir(root):
        return snapshot, dirs, bad
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir != ".":
            dirs.add(rel_dir)
        kept = []
        for name in sorted(dirnames):
            path = os.path.join(dirpath, name)
            if os.path.islink(path):
                bad.append(os.path.relpath(path, root))
            else:
                kept.append(name)
        dirnames[:] = kept
        for name in sorted(filenames):
            path = os.path.join(dirpath, name)
            if os.path.islink(path):
                bad.append(os.path.relpath(path, root))
                continue
            info = os.lstat(path)
            if not stat.S_ISREG(info.st_mode):
                bad.append(os.path.relpath(path, root))
                continue
            rel = os.path.relpath(path, root)
            snapshot[rel] = {
                "sha256": sha256_file(path),
                "size": info.st_size,
                "mtime_ns": info.st_mtime_ns,
            }
    return snapshot, dirs, bad


def verify_tree(root, expected, expected_dir_set, code):
    snapshot, dirs, bad = snapshot_tree(root)
    if bad:
        raise MigrateError(
            code,
            "unsafe entries in %s: %s" % (root, ", ".join(sorted(bad)[:10])),
            EXIT_FAILED,
        )
    if set(snapshot) != set(expected):
        missing = sorted(set(expected) - set(snapshot))
        extra = sorted(set(snapshot) - set(expected))
        raise MigrateError(
            code,
            "file set mismatch in %s" % root,
            EXIT_FAILED,
            {"missing": missing[:20], "extra": extra[:20]},
        )
    for rel, rec in expected.items():
        actual = snapshot[rel]
        if actual["sha256"] != rec["sha256"] or actual["size"] != rec["size"]:
            raise MigrateError(code, "content mismatch: %s" % rel, EXIT_FAILED)
        if rec.get("mtime_ns") is not None and actual["mtime_ns"] != rec["mtime_ns"]:
            raise MigrateError(code, "timestamp not preserved: %s" % rel, EXIT_FAILED)
    if set(dirs) != set(expected_dir_set):
        raise MigrateError(code, "directory set mismatch in %s" % root, EXIT_FAILED)


def build_stage(stage, expected, merged):
    os.makedirs(stage, exist_ok=True)
    dirs = expected_dirs(merged)
    for rel_dir in sorted(dirs):
        os.makedirs(os.path.join(stage, rel_dir), exist_ok=True)
    for rel in sorted(expected):
        rec = expected[rel]
        write_file(os.path.join(stage, rel), rec["data"], rec["mode"], rec["mtime_ns"])
    return dirs


def inv_snapshot(inv):
    snapshot = {}
    for entry in inv["entries"]:
        for rel, rec in entry["files"].items():
            snapshot[entry["root_rel"] + "/" + rel] = {
                "sha256": rec["sha256"],
                "size": rec["size"],
                "mtime_ns": rec["mtime_ns"],
            }
    if inv["timeline_record"]:
        snapshot["TIMELINE.md"] = {
            "sha256": inv["timeline_record"]["sha256"],
            "size": inv["timeline_record"]["size"],
            "mtime_ns": inv["timeline_record"]["mtime_ns"],
        }
    return snapshot


def inv_dirs(inv):
    dirs = set(inv["root_dirs"])
    for entry in inv["entries"]:
        dirs.add(entry["root_rel"])
        for rel_dir in entry["dirs"]:
            dirs.add(os.path.join(entry["root_rel"], rel_dir))
    return dirs


def recheck_tree(inv, code, label):
    snapshot, dirs, bad = snapshot_tree(inv["path"])
    expected = inv_snapshot(inv)
    if bad:
        raise MigrateError(
            code,
            "%s now contains unsafe symlinks/non-regular files: %s" % (label, inv["path"]),
            EXIT_RACE,
            {"paths": sorted(bad)[:20]},
        )
    if set(snapshot) != set(expected):
        missing = sorted(set(expected) - set(snapshot))
        added = sorted(set(snapshot) - set(expected))
        raise MigrateError(
            code,
            "%s file set changed: %s" % (label, inv["path"]),
            EXIT_RACE,
            {"missing": missing[:20], "added": added[:20]},
        )
    for rel, rec in expected.items():
        actual = snapshot[rel]
        if (
            actual["sha256"] != rec["sha256"]
            or actual["size"] != rec["size"]
            or actual["mtime_ns"] != rec["mtime_ns"]
        ):
            raise MigrateError(
                code,
                "%s content changed: %s" % (label, os.path.join(inv["path"], rel)),
                EXIT_RACE,
            )
    if dirs != inv_dirs(inv):
        raise MigrateError(
            code, "%s directory set changed: %s" % (label, inv["path"]), EXIT_RACE
        )


def recheck_source(inv):
    recheck_tree(inv, "source_changed", "source")


def recheck_destination(existing, root):
    if existing is None:
        if os.path.lexists(root):
            raise MigrateError(
                "destination_changed",
                "destination root appeared after the inventory was taken: %s" % root,
                EXIT_RACE,
                {"path": root},
            )
        return
    if os.path.islink(root) or not os.path.isdir(root):
        raise MigrateError(
            "destination_changed",
            "destination root changed type after the inventory was taken: %s" % root,
            EXIT_RACE,
            {"path": root},
        )
    recheck_tree(existing, "destination_changed", "destination")


def copy_tree_verified(src_root, dst_root, expected):
    os.makedirs(dst_root, exist_ok=True)
    for rel in sorted(expected):
        source = os.path.join(src_root, rel)
        target = os.path.join(dst_root, rel)
        parent = os.path.dirname(target)
        if parent:
            os.makedirs(parent, exist_ok=True)
        shutil.copy2(source, target)
        info = os.stat(target)
        rec = expected[rel]
        if sha256_file(target) != rec["sha256"]:
            raise MigrateError(
                "backup_verify_failed", "backup checksum mismatch: %s" % rel, EXIT_FAILED
            )
        if info.st_mtime_ns != rec["mtime_ns"]:
            raise MigrateError(
                "backup_verify_failed", "backup timestamp changed: %s" % rel, EXIT_FAILED
            )
    return len(expected)


def call_validator(validator, root, name, cwd):
    try:
        proc = run(["bash", validator, "--root", root, "--", name], cwd=cwd, timeout=180)
    except subprocess.TimeoutExpired:
        raise MigrateError(
            "validator_failed", "plan-check.sh timed out for %s" % name, EXIT_BLOCKED
        )
    output = combined_output(proc)
    if proc.returncode == 2 and "usage:" in output.lower():
        raise MigrateError(
            "validator_interface_mismatch",
            "plan-check.sh does not accept --root/--; the frozen interface is "
            "`plan-check.sh --root <absolute existing root> -- <plan>`",
            EXIT_BLOCKED,
            {"output": output[-4000:]},
        )
    return proc.returncode, output


def validate_stage(stage, merged, validator, cwd):
    results = {
        "performed": True,
        "root": stage,
        "plans": [],
        "archives": [],
        "failures": [],
        "exemptions": [],
    }
    archive_root = os.path.join(stage, "archive")
    for item in sorted(merged.values(), key=lambda value: (value["kind"], value["key"])):
        name = item["key"]
        if item["kind"] == "plan":
            rc, output = call_validator(validator, stage, name, cwd)
            ok = rc == 0
            results["plans"].append(
                {"name": name, "ok": ok, "exit": rc, "output": output.strip()[-4000:]}
            )
            if not ok:
                results["failures"].append(
                    {"name": name, "scope": "active", "exit": rc, "output": output.strip()[-4000:]}
                )
            continue
        rc, output = call_validator(validator, archive_root, name, cwd)
        exempt = False
        if rc != 0:
            fails = [
                line.strip()
                for line in output.splitlines()
                if line.strip().startswith("fail:")
            ]
            if fails and all(
                fail == "fail: TIMELINE missing %s" % name for fail in fails
            ):
                exempt = True
        ok = rc == 0 or exempt
        results["archives"].append(
            {
                "name": name,
                "ok": ok,
                "exit": rc,
                "timeline_exempt": exempt,
                "output": output.strip()[-4000:],
            }
        )
        if exempt:
            results["exemptions"].append(
                {
                    "name": name,
                    "reason": "archived plans are indexed in TIMELINE.md by their original "
                    "plan name, not by the archive directory name",
                }
            )
        if not ok:
            results["failures"].append(
                {"name": name, "scope": "archive", "exit": rc, "output": output.strip()[-4000:]}
            )
    return results


def activate(root, stage, meta, expected, dirs, existing, stamp):
    previous = None
    if existing is not None:
        previous = os.path.join(meta, "previous-root")
        os.rename(root, previous)
        try:
            # All bytes of the replaced root must survive the swap; a writer that
            # raced past the pre-swap re-check is preserved here, not dropped.
            verify_tree(
                previous,
                inv_snapshot(existing),
                inv_dirs(existing),
                "destination_verify_failed",
            )
        except Exception:
            os.rename(previous, root)
            raise
        if os.environ.get(FAULT_ENV) == "fail-after-retire-existing":
            os.rename(previous, root)
            raise MigrateError(
                "simulated_fault", "test fault fail-after-retire-existing", EXIT_FAILED
            )
    elif os.path.lexists(root):
        raise MigrateError(
            "destination_changed",
            "destination root appeared after the re-check; refusing to replace it: %s" % root,
            EXIT_RACE,
            {"path": root},
        )
    try:
        os.rename(stage, root)
        verify_tree(root, expected, dirs, "activation_verify_failed")
    except Exception:
        if os.path.isdir(root) and not os.path.islink(root):
            failed = os.path.join(
                meta, "failed-root-%s-%d" % (stamp, os.getpid())
            )
            suffix = 1
            while os.path.lexists(failed):
                failed = os.path.join(
                    meta, "failed-root-%s-%d-%d" % (stamp, os.getpid(), suffix)
                )
                suffix += 1
            os.rename(root, failed)
        if previous is not None and not os.path.exists(root):
            os.rename(previous, root)
        raise
    return previous


def quarantine_base(inv, meta, checkouts):
    """Quarantine directory on the source filesystem, outside every checkout."""
    source = inv["path"]
    source_device = os.stat(source).st_dev
    if source_device == os.stat(nearest_existing(meta)).st_dev:
        return os.path.join(meta, "quarantine")
    anchor = os.path.dirname(inv["worktree"] or source)
    current = os.path.abspath(anchor)
    while True:
        outside = not any(is_within(current, checkout) for checkout in checkouts)
        if outside and os.path.dirname(current) != current and os.stat(current).st_dev == source_device:
            return os.path.join(current, ".work-plans-quarantine")
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    raise MigrateError(
        "quarantine_unavailable",
        "no quarantine directory outside every checkout on the source filesystem for %s; "
        "move the legacy status tree onto the external filesystem first" % source,
        EXIT_BLOCKED,
        {"source": source},
    )


def quarantine_location(inv, meta, stamp, checkouts):
    base = quarantine_base(inv, meta, checkouts)
    assert_no_symlink_components(base, "quarantine directory")
    os.makedirs(base, mode=0o700, exist_ok=True)
    if os.path.islink(base):
        raise MigrateError(
            "metadata_path_symlink",
            "quarantine directory is a symlink: %s" % base,
            EXIT_BLOCKED,
            {"path": base},
        )
    name = "%s-%02d-%s" % (inv["kind"], inv["index"], stamp)
    target = os.path.join(base, name)
    suffix = 1
    while os.path.lexists(target):
        target = os.path.join(base, "%s-%d" % (name, suffix))
        suffix += 1
    inside_repository = any(is_within(base, checkout) for checkout in checkouts)
    return target, inside_repository


def quarantine_source(inv, meta, stamp, checkouts):
    """Atomically move a source aside; never recursively delete original data."""
    source = inv["path"]
    target, inside_repository = quarantine_location(inv, meta, stamp, checkouts)
    try:
        os.rename(source, target)
    except OSError as exc:
        raise MigrateError(
            "retire_failed",
            "quarantining %s failed; the original was left in place: %s" % (source, exc),
            EXIT_FAILED,
            {"source": source},
        )
    record = {
        "source": source,
        "quarantine": target,
        "inside_repository": inside_repository,
        "files": inv["file_count"],
        "verified": False,
    }
    try:
        # Re-check the quarantined tree itself: bytes a writer added between the
        # earlier re-check and the rename land here, so they must be observed.
        verify_tree(target, inv_snapshot(inv), inv_dirs(inv), "quarantine_verify_failed")
    except MigrateError as exc:
        details = dict(exc.details or {})
        details["retirement"] = record
        raise MigrateError(exc.code, exc.message, EXIT_RACE, details)
    record["verified"] = True
    maybe_recreate_source(inv)
    if os.path.lexists(source):
        record["recreated"] = True
        raise MigrateError(
            "source_recreated",
            "source was recreated after it was quarantined: %s" % source,
            EXIT_RACE,
            {"retirement": record},
        )
    return record


def maybe_recreate_source(inv):
    if os.environ.get(FAULT_ENV) != "recreate-source-after-quarantine":
        return
    plan_dir = inv["path"]
    for entry in inv["entries"]:
        if entry["kind"] == "plan":
            plan_dir = os.path.join(inv["path"], entry["root_rel"])
            break
    os.makedirs(plan_dir, exist_ok=True)
    with open(os.path.join(plan_dir, "plan.md"), "wb") as handle:
        handle.write(b"# Plan: recreated\n\n## Scope\n- Out: simulated late writer\n")


def maybe_mutate_source_after_recheck(inv):
    if os.environ.get(FAULT_ENV) != "mutate-source-after-recheck":
        return
    for entry in inv["entries"]:
        if "plan.md" in entry["files"]:
            with open(os.path.join(entry["path"], "plan.md"), "ab") as handle:
                handle.write(b"\n<!-- simulated late writer mutation -->\n")
            return


def maybe_mutate_destination(existing, root):
    fault = os.environ.get(FAULT_ENV)
    if fault == "mutate-destination-before-activation" and existing is not None:
        if existing["timeline_path"]:
            with open(existing["timeline_path"], "ab") as handle:
                handle.write(b"2026-01-09 | gamma | WORKING | simulated late writer | gamma/plan.md\n")
        return
    if fault == "create-destination-before-activation" and existing is None:
        os.makedirs(root, exist_ok=True)
        with open(os.path.join(root, "late-writer.md"), "wb") as handle:
            handle.write(b"simulated destination created after inventory\n")



def maybe_fault(name):
    if os.environ.get(FAULT_ENV) == name:
        raise MigrateError("simulated_fault", "test fault %s" % name, EXIT_FAILED)


def maybe_mutate_source(sources):
    if os.environ.get(FAULT_ENV) != "mutate-source-before-activation":
        return
    for inv in sources:
        for entry in inv["entries"]:
            if "plan.md" in entry["files"]:
                with open(os.path.join(entry["path"], "plan.md"), "ab") as handle:
                    handle.write(b"\n<!-- simulated writer mutation -->\n")
                return


def plan_summaries(merged):
    plans = []
    archives = []
    for item in sorted(merged.values(), key=lambda value: (value["kind"], value["key"])):
        row = {
            "name": item["key"],
            "files": len(item["files"]),
            "sources": item["sources"],
            "deduped": item["deduped"],
            "from_destination": item["from_destination"],
        }
        if item["kind"] == "plan":
            plans.append(row)
        else:
            archives.append(row)
    return plans, archives


def prepare(repo, root, explicit_sources, pre_problems):
    problems = list(pre_problems)
    source_meta, omitted = discover(repo, explicit_sources, problems)
    sources = []
    for index, meta in enumerate(source_meta):
        inv = inventory_store(meta["path"], meta["kind"], index, meta["worktree"])
        check_tracked(inv)
        problems.extend(inv["problems"])
        sources.append(inv)
    existing = None
    if os.path.isdir(root) and not os.path.islink(root):
        existing = inventory_store(root, "destination", -1, None)
        problems.extend(existing["problems"])
    if not sources:
        problems.append(
            problem(
                "no_sources",
                "no legacy status/ directory found in the control checkout or linked worktrees",
                repo["root"],
                repo["root"],
            )
        )
    merge_inputs = ([existing] if existing else []) + sources
    merged, conflicts = merge_entries(merge_inputs)
    problems.extend(conflicts)
    timeline = merge_timeline(merge_inputs)
    rules = rewrite_rules(merged, sources)
    timeline_text = "\n".join(timeline["lines"])
    if timeline["lines"]:
        timeline_text += "\n"
    rewrites, expected = compute_rewrite_plan(
        merged,
        timeline_text,
        rules,
        timeline["mtime_ns"],
        sha256_bytes(encode(timeline_text)),
    )
    return {
        "repo": repo,
        "root": root,
        "sources": sources,
        "omitted": omitted,
        "existing": existing,
        "merged": merged,
        "timeline": timeline,
        "rewrites": rewrites,
        "expected": expected,
        "problems": problems,
        "validator": os.path.join(SCRIPT_DIR, "plan-check.sh"),
    }


def fill_report(report, ctx):
    report["repo"] = {"root": ctx["repo"]["root"], "worktrees": ctx["repo"]["worktrees"]}
    root = ctx["root"]
    report["destination"] = {
        "root": root,
        "exists": os.path.exists(root),
        "symlink": os.path.islink(root),
        "combined": ctx["existing"] is not None,
    }
    source_rows = []
    for inv in ctx["sources"]:
        source_rows.append(
            {
                "path": inv["path"],
                "kind": inv["kind"],
                "worktree": inv["worktree"],
                "plans": sum(1 for entry in inv["entries"] if entry["kind"] == "plan"),
                "archives": sum(1 for entry in inv["entries"] if entry["kind"] == "archive"),
                "files": inv["file_count"],
                "timeline_lines": len(inv["timeline_lines"]),
                "tracked": inv["tracked"],
                "retired": False,
            }
        )
    report["sources"] = source_rows
    report["omitted_sources"] = ctx["omitted"]
    if ctx["existing"] is not None:
        report["existing_destination"] = {
            "path": root,
            "plans": sum(1 for entry in ctx["existing"]["entries"] if entry["kind"] == "plan"),
            "archives": sum(1 for entry in ctx["existing"]["entries"] if entry["kind"] == "archive"),
            "files": ctx["existing"]["file_count"],
            "timeline_lines": len(ctx["existing"]["timeline_lines"]),
        }
    plans, archives = plan_summaries(ctx["merged"])
    report["plans"] = plans
    report["archives"] = archives
    timeline = ctx["timeline"]
    report["timeline"] = {
        "entries": len(timeline["lines"]),
        "deduped": timeline["deduped"],
        "blank_lines_dropped": timeline["blank_lines_dropped"],
        "malformed": timeline["malformed"],
    }
    report["rewrites"] = ctx["rewrites"]


def save_manifest(path, manifest):
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def build_manifest(ctx, meta):
    root = ctx["root"]
    plans, archives = plan_summaries(ctx["merged"])
    return {
        "schema": SCHEMA,
        "tool": TOOL,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mode": "apply",
        "state": "prepared",
        "repo_root": ctx["repo"]["root"],
        "worktrees": ctx["repo"]["worktrees"],
        "destination_root": root,
        "meta_dir": meta,
        "sources": [
            {
                "index": inv["index"],
                "path": inv["path"],
                "kind": inv["kind"],
                "worktree": inv["worktree"],
                "files": inv["file_count"],
                "timeline_lines": len(inv["timeline_lines"]),
                "retired": False,
            }
            for inv in ctx["sources"]
        ],
        "omitted_sources": ctx["omitted"],
        "existing_destination": (
            {"path": root, "files": ctx["existing"]["file_count"]}
            if ctx["existing"] is not None
            else None
        ),
        "timeline_lock": None,
        "single_authority": True,
        "timeline": {
            "entries": len(ctx["timeline"]["lines"]),
            "deduped": ctx["timeline"]["deduped"],
            "blank_lines_dropped": ctx["timeline"]["blank_lines_dropped"],
            "malformed": ctx["timeline"]["malformed"],
        },
        "inventory": {
            inv["path"]: inv_snapshot(inv)
            for inv in (
                ([ctx["existing"]] if ctx["existing"] is not None else []) + ctx["sources"]
            )
        },
        "rewrites": ctx["rewrites"],
        "plans": plans,
        "archives": archives,
        "backup": None,
        "staging": None,
        "validation": None,
        "activation": None,
        "retired_sources": [],
        "retirement": {
            "method": "atomic-rename-quarantine",
            "retired": [],
            "remaining": [inv["path"] for inv in ctx["sources"]],
            "quarantined": [],
            "recovery": {},
            "verified": False,
            "caveat": "Originals are moved by atomic rename and never deleted. Writers "
            "holding an open handle can still append to the quarantined tree after the "
            "verification; any mismatch is reported and both trees are retained.",
        },
        "rollback": {
            "available": False,
            "backup_root": None,
            "previous_root": None,
            "caveat": "Before activation the repository-local status/ trees stay "
            "authoritative. After activation, reconcile any events written to the "
            "external root before restoring this backup; never run both stores as "
            "active.",
        },
        "error": None,
    }


def record_quarantine(manifest, record):
    quarantined = manifest["retirement"]["quarantined"]
    for index, item in enumerate(quarantined):
        if item["source"] == record["source"]:
            quarantined[index] = record
            break
    else:
        quarantined.append(record)
    manifest["retirement"]["recovery"][record["source"]] = record["quarantine"]
    retired = [item["source"] for item in quarantined if item.get("verified")]
    manifest["retirement"]["retired"] = retired
    manifest["retired_sources"] = retired
    manifest["retirement"]["remaining"] = [
        row["path"] for row in manifest["sources"] if row["path"] not in retired
    ]
    for row in manifest["sources"]:
        if row["path"] in retired:
            row["retired"] = True


def run_apply(ctx, report):
    root = ctx["root"]
    sources = ctx["sources"]
    existing = ctx["existing"]
    validator = ctx["validator"]
    if not os.path.isfile(validator):
        raise MigrateError("validator_missing", "validator not found: %s" % validator, EXIT_BLOCKED)
    _parent, meta_base, _lock = meta_layout(root)
    assert_no_symlink_components(meta_base, "migration metadata directory")
    meta_device = os.stat(nearest_existing(meta_base)).st_dev
    destination_device = os.stat(nearest_existing(root)).st_dev
    if meta_device != destination_device:
        raise MigrateError(
            "staging_not_same_filesystem",
            "staging area and destination root are on different filesystems",
            EXIT_FAILED,
        )
    checkouts = list(ctx["repo"]["worktrees"])
    for inv in sources:
        # Fail before any staging/activation when a source filesystem offers no
        # quarantine location outside every checkout: no copy+delete fallback.
        quarantine_base(inv, meta_base, checkouts)
    os.makedirs(meta_base, exist_ok=True)
    if os.path.islink(meta_base):
        raise MigrateError(
            "metadata_path_symlink",
            "migration metadata directory is a symlink: %s" % meta_base,
            EXIT_BLOCKED,
            {"path": meta_base},
        )
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    meta = os.path.join(meta_base, "%s-%d" % (stamp, os.getpid()))
    suffix = 1
    while os.path.exists(meta):
        meta = os.path.join(meta_base, "%s-%d-%d" % (stamp, os.getpid(), suffix))
        suffix += 1
    os.makedirs(meta)
    if os.path.islink(meta):
        raise MigrateError(
            "metadata_path_symlink",
            "migration run directory is a symlink: %s" % meta,
            EXIT_BLOCKED,
            {"path": meta},
        )
    manifest = build_manifest(ctx, meta)
    manifest["timeline_lock"] = report.get("timeline_lock")
    manifest_path = os.path.join(meta, "manifest.json")
    save_manifest(manifest_path, manifest)
    report["manifest"] = {"path": manifest_path, "state": manifest["state"]}
    try:
        backup_root = os.path.join(meta, "backup")
        assert_no_symlink_components(backup_root, "backup directory")
        os.makedirs(backup_root, exist_ok=True)
        backups = []
        stores = ([existing] if existing is not None else []) + sources
        for inv in stores:
            label = "destination" if inv["kind"] == "destination" else "source-%d" % inv["index"]
            target = os.path.join(backup_root, label)
            count = copy_tree_verified(inv["path"], target, inv_snapshot(inv))
            backups.append(
                {"source": inv["path"], "kind": inv["kind"], "backup": target, "files": count}
            )
        manifest["backup"] = {"root": backup_root, "verified": True, "stores": backups}
        manifest["rollback"]["available"] = True
        manifest["rollback"]["backup_root"] = backup_root
        manifest["state"] = "backed-up"
        save_manifest(manifest_path, manifest)
        report["backup"] = {"root": backup_root, "verified": True, "stores": backups}

        stage = os.path.join(meta, "stage")
        assert_no_symlink_components(stage, "staging directory")
        dirs = build_stage(stage, ctx["expected"], ctx["merged"])
        verify_tree(stage, ctx["expected"], dirs, "stage_verify_failed")
        diag("staged %d file(s) at %s" % (len(ctx["expected"]), stage))
        manifest["staging"] = {
            "path": stage,
            "files": len(ctx["expected"]),
            "verified": True,
            "expected": {
                rel: {
                    "sha256": rec["sha256"],
                    "size": rec["size"],
                    "mtime_ns": rec["mtime_ns"],
                }
                for rel, rec in ctx["expected"].items()
            },
        }
        manifest["state"] = "staged"
        save_manifest(manifest_path, manifest)
        report["staging"] = {"path": stage, "files": len(ctx["expected"]), "verified": True}

        validation = validate_stage(stage, ctx["merged"], validator, ctx["repo"]["root"])
        report["validation"] = validation
        manifest["validation"] = validation
        save_manifest(manifest_path, manifest)
        for exemption in validation["exemptions"]:
            report["notes"].append(
                "archive %s validated without TIMELINE membership: %s"
                % (exemption["name"], exemption["reason"])
            )
        if validation["failures"]:
            added = []
            for failure in validation["failures"]:
                added.append(
                    problem(
                        "invalid_plan",
                        "plan-check RED for %s (%s)" % (failure["name"], failure["scope"]),
                        None,
                        None,
                        detail=failure.get("output", ""),
                    )
                )
            ctx["problems"].extend(added)
            classify_problems(report, added)
            raise MigrateError(
                "invalid_plan",
                "staged plans failed validation; nothing was activated",
                EXIT_BLOCKED,
                {"failures": validation["failures"]},
            )

        maybe_mutate_source(sources)
        for inv in sources:
            recheck_source(inv)
        maybe_mutate_destination(existing, root)
        # Re-check the destination under the migration lock and the shared
        # timeline flock: a store created or mutated after the inventory must
        # never be silently replaced.
        recheck_destination(existing, root)
        maybe_fault("fail-before-activation")
        manifest["state"] = "validated"
        save_manifest(manifest_path, manifest)

        previous = activate(
            root, stage, meta, ctx["expected"], dirs, existing, stamp
        )
        activation = {
            "activated": True,
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "method": "replace-existing" if previous else "create",
            "previous_root": previous,
        }
        manifest["activation"] = activation
        manifest["rollback"]["previous_root"] = previous
        manifest["state"] = "activated"
        save_manifest(manifest_path, manifest)
        report["activation"] = dict(activation)
        report["manifest"]["state"] = "activated"
        diag("activated %s (%s)" % (root, activation["method"]))

        retired = []
        for inv in sources:
            recheck_source(inv)
            maybe_mutate_source_after_recheck(inv)
            record = quarantine_source(inv, meta, stamp, checkouts)
            record_quarantine(manifest, record)
            retired.append(record["source"])
            save_manifest(manifest_path, manifest)
            diag("quarantined %s at %s" % (record["source"], record["quarantine"]))

        inventory_by_source = {inv["path"]: inv for inv in sources}
        for record in list(manifest["retirement"]["quarantined"]):
            inv = inventory_by_source[record["source"]]
            try:
                # Final pass: a writer holding an open handle can still touch the
                # renamed tree, so success is only claimed after re-observing it.
                verify_tree(
                    record["quarantine"],
                    inv_snapshot(inv),
                    inv_dirs(inv),
                    "quarantine_verify_failed",
                )
            except MigrateError as exc:
                record["verified"] = False
                details = dict(exc.details or {})
                details["retirement"] = record
                raise MigrateError(exc.code, exc.message, EXIT_RACE, details)
            if os.path.lexists(record["source"]):
                record["recreated"] = True
                raise MigrateError(
                    "source_recreated",
                    "source was recreated after it was quarantined: %s" % record["source"],
                    EXIT_RACE,
                    {"retirement": record},
                )

        manifest["state"] = "retired"
        manifest["retirement"]["verified"] = True
        save_manifest(manifest_path, manifest)
        diag("quarantined %d source(s)" % len(retired))
        report["manifest"]["state"] = "retired"
        report["retired_sources"] = retired
        report["retirement"] = manifest["retirement"]
        report["quarantined_sources"] = manifest["retirement"]["quarantined"]
        for row in report["sources"]:
            if row["path"] in retired:
                row["retired"] = True
    except MigrateError as exc:
        manifest["error"] = {
            "code": exc.code,
            "message": exc.message,
            "details": exc.details,
        }
        record = None
        if isinstance(exc.details, dict):
            record = exc.details.get("retirement")
        if record:
            record_quarantine(manifest, record)
            manifest["single_authority"] = False
            report["single_authority"] = False
        elif manifest.get("state") in ("activated", "activated-unretired"):
            manifest["single_authority"] = False
            report["single_authority"] = False
        if manifest.get("state") in ("activated", "activated-unretired") or record:
            manifest["state"] = "activated-unretired"
        else:
            manifest["state"] = "failed"
        save_manifest(manifest_path, manifest)
        if report["manifest"] is not None:
            report["manifest"]["state"] = manifest["state"]
        report["retirement"] = manifest["retirement"]
        report["quarantined_sources"] = manifest["retirement"]["quarantined"]
        if record:
            report["notes"].append(
                "recovery mapping recorded in %s; original data was retained, not deleted"
                % manifest_path
            )
        raise
    except Exception as exc:  # keep the manifest truthful on unexpected failure
        traceback.print_exc()
        manifest["error"] = {"code": "internal", "message": str(exc) or exc.__class__.__name__}
        if manifest.get("state") in ("activated", "activated-unretired"):
            manifest["state"] = "activated-unretired"
            manifest["single_authority"] = False
            report["single_authority"] = False
        else:
            manifest["state"] = "failed"
        save_manifest(manifest_path, manifest)
        if report["manifest"] is not None:
            report["manifest"]["state"] = manifest["state"]
        report["retirement"] = manifest["retirement"]
        report["quarantined_sources"] = manifest["retirement"]["quarantined"]
        raise MigrateError("internal", str(exc) or exc.__class__.__name__, EXIT_FAILED)


def parse_args(argv):
    opts = {"apply": False, "dry_run": False, "writers_paused": False, "sources": [], "help": False}
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--apply":
            opts["apply"] = True
        elif arg == "--dry-run":
            opts["dry_run"] = True
        elif arg == "--writers-paused":
            opts["writers_paused"] = True
        elif arg == "--source":
            index += 1
            if index >= len(argv):
                raise MigrateError("usage", "--source requires a value", EXIT_USAGE)
            opts["sources"].append(argv[index])
        elif arg.startswith("--source="):
            opts["sources"].append(arg.split("=", 1)[1])
        elif arg in ("-h", "--help"):
            opts["help"] = True
        else:
            raise MigrateError("usage", "unknown argument: %s" % arg, EXIT_USAGE)
        index += 1
    if opts["apply"] and opts["dry_run"]:
        raise MigrateError("usage", "--apply and --dry-run are mutually exclusive", EXIT_USAGE)
    return opts


def emit(report):
    sys.stdout.write(json.dumps(report, indent=2, sort_keys=False) + "\n")
    sys.stdout.flush()
    return report["exit_code"]


def fail_report(report, exc):
    report["ok"] = False
    report["exit_code"] = exc.exit_code
    report["status"] = "blocked" if exc.exit_code == EXIT_BLOCKED else "failed"
    report["error"] = {"code": exc.code, "message": exc.message, "details": exc.details}
    report["blockers"].append({"code": exc.code, "message": exc.message})


def migrate(argv, report, state):
    opts = parse_args(argv)
    mode = "apply" if opts["apply"] else "dry-run"
    report["mode"] = mode
    report["will_write"] = mode == "apply"
    if opts["apply"] and not opts["writers_paused"]:
        raise MigrateError(
            "writers_not_paused",
            "--apply requires --writers-paused; stop all tracking writers first",
            EXIT_USAGE,
        )
    if opts["writers_paused"] and not opts["apply"]:
        raise MigrateError("usage", "--writers-paused requires --apply", EXIT_USAGE)

    cwd = os.getcwd()
    repo = repo_info(cwd)
    root = resolve_root(cwd)
    diag("mode=%s repository=%s destination=%s" % (mode, repo["root"], root))
    report["repo"] = {"root": repo["root"], "worktrees": repo["worktrees"]}
    report["destination"] = {
        "root": root,
        "exists": os.path.exists(root),
        "symlink": os.path.islink(root),
        "combined": False,
    }

    pre = []
    _parent, meta_base, lock_path = meta_layout(root)
    if os.path.islink(root):
        pre.append(
            problem(
                "destination_symlink",
                "destination root is a symlink: %s" % root,
                root,
                root,
            )
        )
    for component in symlink_components(meta_base):
        pre.append(
            problem(
                "metadata_path_symlink",
                "migration metadata path has a symlink component: %s" % component,
                root,
                component,
            )
        )
    timeline_lock = timeline_lock_path(root)
    for component in symlink_components(os.path.dirname(timeline_lock)):
        pre.append(
            problem(
                "metadata_path_symlink",
                "timeline lock path has a symlink component: %s" % component,
                root,
                component,
            )
        )
    if os.path.islink(timeline_lock):
        pre.append(
            problem(
                "metadata_path_symlink",
                "timeline lock file is a symlink: %s" % timeline_lock,
                root,
                timeline_lock,
            )
        )
    if os.path.exists(root) and not os.path.isdir(root):
        pre.append(
            problem("destination_not_directory", "destination root is not a directory: %s" % root, root, root)
        )

    if mode == "apply" and not pre:
        state["lock"] = acquire_lock(lock_path)
        state["acquired"] = True
        report["lock"] = {"path": state["lock"], "acquired": True}
        state["timeline_lock"] = timeline_lock
        state["timeline_handle"] = acquire_timeline_lock(timeline_lock)
        report["timeline_lock"] = {"path": timeline_lock, "acquired": True}

    ctx = prepare(repo, root, opts["sources"], pre)
    fill_report(report, ctx)
    classify_problems(report, ctx["problems"])
    report["would_apply"] = not ctx["problems"]
    if ctx["problems"]:
        report["ok"] = False
        report["status"] = "blocked"
        report["exit_code"] = EXIT_OK if mode == "dry-run" else EXIT_BLOCKED
        return
    if mode == "dry-run":
        report["validation"] = {
            "performed": False,
            "reason": "dry-run performs no writes; plan-check.sh --root runs on the staged store during --apply",
            "planned": sorted(item["key"] for item in ctx["merged"].values()),
        }
        report["ok"] = True
        report["status"] = "inventory"
        report["exit_code"] = EXIT_OK
        return

    run_apply(ctx, report)
    report["ok"] = True
    report["status"] = "applied"
    report["exit_code"] = EXIT_OK
    report["notes"].append(
        "sources were quarantined by atomic rename after activation verification and a "
        "final source re-check; originals are retained and mapped in the manifest"
    )
    report["notes"].append(
        "the shared timeline flock serializes only writers that use it; legacy writers "
        "are covered by --writers-paused, the pre-swap re-checks, and quarantine "
        "verification, and any detected race is reported instead of ignored"
    )


def main(argv):
    if any(arg in ("-h", "--help") for arg in argv):
        sys.stdout.write(USAGE)
        return 0
    report = new_report("dry-run")
    state = {"lock": None, "acquired": False, "timeline_lock": None, "timeline_handle": None}
    try:
        migrate(argv, report, state)
    except MigrateError as exc:
        fail_report(report, exc)
    except Exception as exc:  # pragma: no cover - defensive
        traceback.print_exc()
        fail_report(report, MigrateError("internal", str(exc) or exc.__class__.__name__, EXIT_FAILED))
    finally:
        if state["timeline_handle"] is not None:
            release_timeline_lock(state["timeline_handle"])
            report["timeline_lock"] = {
                "path": state["timeline_lock"],
                "acquired": False,
                "released": True,
            }
        if state["lock"] is not None:
            if state["acquired"]:
                release_lock(state["lock"])
            report["lock"] = {
                "path": state["lock"],
                "acquired": False,
                "released": True,
            }
    return emit(report)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
