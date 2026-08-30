#!/usr/bin/env python3
"""List the docs warehouse (~/docs-hub) as a tree with .dev marking and URLs."""
import os
import sys

WAREHOUSE = os.path.expanduser("~/docs-hub")
MAX_DEPTH = 4
PUBLIC = "https://docs.example.com"
LOCAL = "http://127.0.0.1:8088"

def is_doc(name):
    return name.lower().endswith((".md", ".markdown", ".html", ".htm"))

def list_dir(base, rel, depth, limit, prefix):
    if depth > limit:
        return
    try:
        entries = sorted(os.listdir(os.path.join(base, rel)))
    except OSError as e:
        print(f"{prefix}error: {e}")
        return
    dirs = [e for e in entries if os.path.isdir(os.path.join(base, rel, e))]
    files = [e for e in entries if not os.path.isdir(os.path.join(base, rel, e))]
    for e in dirs + files:
        path = os.path.join(rel, e)
        full = os.path.join(base, path)
        is_dev = e == ".dev" or ".dev" in rel.split(os.sep)
        marker = " [dev]" if is_dev else ""
        print(f"{prefix}{e}/{marker}" if os.path.isdir(full) else f"{prefix}{e}{marker}")
        if os.path.isdir(full):
            list_dir(base, path, depth + 1, limit, prefix + "  ")
        elif is_doc(e):
            url = LOCAL + "/docs/" + path.replace(os.sep, "/")
            print(f"{prefix}  {url}")

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not os.path.isdir(WAREHOUSE):
        print(f"warehouse not found: {WAREHOUSE}", file=sys.stderr)
        sys.exit(1)
    sub = ""
    limit = MAX_DEPTH
    rest = list(args)
    if rest and rest[0].isdigit():
        limit = int(rest.pop(0))
    if rest:
        sub = rest.pop(0)
    if rest and rest[0].isdigit():
        limit = int(rest[0])
    if sub:
        target = os.path.join(WAREHOUSE, sub)
        if not os.path.isdir(target):
            print(f"not a folder: {target}", file=sys.stderr)
            sys.exit(1)
        print(f"{sub}/")
        list_dir(WAREHOUSE, sub, 1, limit, "  ")
    else:
        print("~/docs-hub/")
        list_dir(WAREHOUSE, "", 0, limit, "  ")

if __name__ == "__main__":
    main()
