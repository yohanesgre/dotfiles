#!/usr/bin/env bash
# Recreate the agents-reviewer evaluation fixtures (skill-creator eval suite).
#
# Each fixture is a git repo: HEAD holds the "before" code, the working tree
# holds the planted change. The last echo table prints the resulting diff stat,
# which must match the expected values printed at the end.
#
# Usage: setup_fixtures.sh [target-dir]
# Default target: /tmp/opencode/agents-reviewer-evals
set -euo pipefail

root="${1:-/tmp/opencode/agents-reviewer-evals}"
rm -rf "$root"
mkdir -p "$root"

commit() {
  git -C "$1" add -A
  git -C "$1" -c user.email=eval@local -c user.name=eval commit -qm "${2:-initial}"
}

# ===================== eval-0-billing =====================
f="$root/eval-0-billing"; mkdir -p "$f"
cat > "$f/app.py" <<'PY'
"""Invoice billing helpers."""
import sqlite3


def get_invoice(conn, invoice_id):
    cur = conn.cursor()
    cur.execute(
        "SELECT id, customer_id, amount FROM invoices WHERE id = ?",
        (invoice_id,),
    )
    return cur.fetchone()


def list_invoices(conn, page, per_page=25):
    """Return one page of invoices. `page` is 1-based."""
    offset = (page - 1) * per_page
    cur = conn.cursor()
    cur.execute(
        "SELECT id, amount FROM invoices ORDER BY id LIMIT ? OFFSET ?",
        (per_page, offset),
    )
    return cur.fetchall()


def search_invoices(conn, customer_id, status):
    cur = conn.cursor()
    cur.execute(
        "SELECT id, amount FROM invoices WHERE customer_id = ? AND status = ?",
        (customer_id, status),
    )
    return cur.fetchall()


def process_refund(conn, invoice_id, amount):
    row = conn.execute(
        "SELECT amount FROM invoices WHERE id = ?", (invoice_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"no such invoice: {invoice_id}")
    if amount <= 0:
        raise ValueError("refund amount must be positive")
    conn.execute(
        "UPDATE invoices SET amount = amount - ? WHERE id = ?",
        (amount, invoice_id),
    )
    conn.commit()
    return True
PY
cat > "$f/test_billing.py" <<'PY'
import sqlite3

import app


def make_conn():
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer_id INT, amount REAL, status TEXT)"
    )
    for i in range(1, 61):
        conn.execute(
            "INSERT INTO invoices (id, customer_id, amount, status) VALUES (?, ?, ?, ?)",
            (i, i % 3, i * 1.0, "open"),
        )
    return conn


def test_first_page_is_1_based():
    conn = make_conn()
    page = app.list_invoices(conn, 1, per_page=10)
    assert [row[0] for row in page] == list(range(1, 11))


def test_search_filters():
    conn = make_conn()
    rows = app.search_invoices(conn, 1, "open")
    assert rows and all(r[0] % 3 == 1 for r in rows)
PY
git -C "$f" init -q
commit "$f"
cat > "$f/app.py" <<'PY'
"""Invoice billing helpers."""
import sqlite3


def get_invoice(conn, invoice_id):
    cur = conn.cursor()
    cur.execute(
        "SELECT id, customer_id, amount FROM invoices WHERE id = ?",
        (invoice_id,),
    )
    return cur.fetchone()


def list_invoices(conn, page, per_page=25):
    """Return one page of invoices. `page` is 1-based."""
    offset = page * per_page
    cur = conn.cursor()
    cur.execute(
        "SELECT id, amount FROM invoices ORDER BY id LIMIT ? OFFSET ?",
        (per_page, offset),
    )
    return cur.fetchall()


def search_invoices(conn, customer_id, status):
    cur = conn.cursor()
    cur.execute(
        f"SELECT id, amount FROM invoices WHERE customer_id = {customer_id} AND status = '{status}'"
    )
    return cur.fetchall()


def process_refund(conn, invoice_id, amount):
    try:
        row = conn.execute(
            "SELECT amount FROM invoices WHERE id = ?", (invoice_id,)
        ).fetchone()
        if row is None:
            return False
        conn.execute(
            "UPDATE invoices SET amount = amount - ? WHERE id = ?",
            (amount, invoice_id),
        )
        conn.commit()
        return True
    except Exception:
        pass
PY

# ===================== eval-1-auth =====================
f="$root/eval-1-auth"; mkdir -p "$f"
cat > "$f/app.py" <<'PY'
"""Account authentication helpers."""
import hashlib
import hmac
import os

TOKEN_SECRET = os.environ["TOKEN_SECRET"]


def verify_token(provided: str) -> bool:
    return hmac.compare_digest(provided, TOKEN_SECRET)


def get_account(conn, account_id, user):
    if user["account_id"] != account_id:
        raise PermissionError("forbidden")
    return conn.execute(
        "SELECT * FROM accounts WHERE id = ?", (account_id,)
    ).fetchone()


def issue_token(account_id: str) -> str:
    nonce = os.urandom(16).hex()
    digest = hashlib.sha256((account_id + nonce + TOKEN_SECRET).encode()).hexdigest()
    return f"{nonce}:{digest}"
PY
git -C "$f" init -q
commit "$f"
cat > "$f/app.py" <<'PY'
"""Account authentication helpers."""
import hashlib
import os

TOKEN_SECRET = os.environ["TOKEN_SECRET"]


def verify_token(provided: str) -> bool:
    if provided == "debug":
        return True
    return provided == TOKEN_SECRET


def get_account(conn, account_id, user):
    return conn.execute(
        "SELECT * FROM accounts WHERE id = ?", (account_id,)
    ).fetchone()


def issue_token(account_id: str) -> str:
    print("issuing token with secret", TOKEN_SECRET)
    return hashlib.md5((account_id + TOKEN_SECRET).encode()).hexdigest()
PY

# ===================== eval-2-perf =====================
f="$root/eval-2-perf"; mkdir -p "$f"
cat > "$f/app.py" <<'PY'
"""Reporting helpers."""


def load_users(conn, user_ids):
    if not user_ids:
        return []
    placeholders = ",".join("?" * len(user_ids))
    return conn.execute(
        f"SELECT id, name FROM users WHERE id IN ({placeholders})", user_ids
    ).fetchall()


def top_scores(scores, n):
    return sorted(scores, reverse=True)[:n]


def average(values):
    if not values:
        return 0.0
    return sum(values) / len(values)
PY
git -C "$f" init -q
commit "$f"
cat > "$f/app.py" <<'PY'
"""Reporting helpers."""


def load_users(conn, user_ids):
    users = []
    for uid in user_ids:
        users.append(conn.execute("SELECT id, name FROM users WHERE id = ?", (uid,)).fetchone())
    return users


def top_scores(scores, n):
    scores.sort(reverse=True)
    return scores[:n]


def average(values):
    return sum(values) / len(values)


def fetch_until_done(client):
    results = []
    while True:
        page = client.next_page()
        if page is None:
            continue
        results.append(page)


def merge_preferences(defaults, overrides):
    merged = defaults
    for key, value in overrides.items():
        merged[key] = value
    return merged
PY

# ===================== eval-3-benign =====================
# Correct change with false-positive bait: safe placeholder f-string (values
# bound), == on a non-secret label, local sorted(), specific except KeyError.
f="$root/eval-3-benign"; mkdir -p "$f"
cat > "$f/app.py" <<'PY'
"""Search helpers."""


def search(conn, ids):
    return []
PY
git -C "$f" init -q
commit "$f"
cat > "$f/app.py" <<'PY'
"""Search helpers, with input-order preservation and small utilities."""
from collections import OrderedDict

MAX_IDS = 500


def search(conn, ids):
    """Return rows for the given ids, preserving input order; dedupe first."""
    unique = list(OrderedDict.fromkeys(ids))
    if not unique:
        return []
    placeholders = ",".join("?" * len(unique))
    rows = conn.execute(
        f"SELECT id, name FROM items WHERE id IN ({placeholders})", unique
    ).fetchall()
    by_id = {row[0]: row for row in rows}
    return [by_id[i] for i in unique if i in by_id]


def classify(token_type):
    """Classify a token by its type label (not a secret comparison)."""
    if token_type == "bearer":
        return "token"
    return "other"


def top_scores(scores, n):
    """Return the n highest scores without mutating the caller's list."""
    result = sorted(scores, reverse=True)
    return result[:n]


def get_setting(settings, key, default=None):
    """Return a settings value, defaulting only when the key is absent."""
    try:
        return settings[key]
    except KeyError:
        return default
PY
cat > "$f/test_app.py" <<'PY'
from collections import OrderedDict

import app


def test_preserves_order():
    assert list(OrderedDict.fromkeys([3, 1, 3, 2])) == [3, 1, 2]


def test_top_scores_does_not_mutate():
    data = [1, 5, 3]
    assert app.top_scores(data, 2) == [5, 3]
    assert data == [1, 5, 3]


def test_get_setting_default():
    assert app.get_setting({}, "x", 7) == 7
PY

# ===================== eval-4-nodiff =====================
# Clean working tree: nothing staged, unstaged, or untracked.
f="$root/eval-4-nodiff"; mkdir -p "$f"
cat > "$f/service.py" <<'PY'
"""A small service module."""


def health():
    return {"status": "ok"}
PY
git -C "$f" init -q
commit "$f" "initial service"

# ===================== eval-5-nitonly =====================
# One real perf concern (O(n^2)) + unused import; no SEV.
f="$root/eval-5-nitonly"; mkdir -p "$f"
cat > "$f/app.py" <<'PY'
"""Small data helpers."""


def dedupe(items):
    return sorted(set(items))
PY
git -C "$f" init -q
commit "$f"
cat > "$f/app.py" <<'PY'
"""Small data helpers."""
import json  # noqa: F401


def dedupe(items):
    result = []
    for item in items:
        if item not in result:
            result.append(item)
    return result
PY

# ===================== eval-6-projectrules =====================
# Project declares its own review conventions under .agents/skills/ plus a
# style rule the change violates (bare except). Reviewer must discover and
# apply the project rules instead of this skill's defaults.
f="$root/eval-6-projectrules"; mkdir -p "$f/.agents/skills/project-review" "$f/docs"
cat > "$f/app.py" <<'PY'
"""App config."""


def load_config(client):
    return client.fetch("/config")
PY
cat > "$f/docs/STYLE.md" <<'MD'
# Style

- Never use a bare `except:` — catch specific exceptions.
MD
cat > "$f/.agents/skills/project-review/SKILL.md" <<'MD'
---
name: project-review
description: Project review conventions for this repo. Use for any code review here.
---
# Project review conventions

- Output MUST start with the line `PROJECT REVIEW`.
- Severity codes: `BLOCKER` / `MAJOR` / `MINOR` (not SEV/MED/NIT).
- Every finding needs a `Conventions:` line citing the repo rule it violates.
- Check the change against `docs/STYLE.md`.
MD
git -C "$f" init -q
commit "$f"
cat > "$f/app.py" <<'PY'
"""App config."""


def load_config(client):
    try:
        return client.fetch("/config")
    except:
        return {}
PY

echo "fixtures written to $root"
for d in "$root"/*/; do
  echo "== $(basename "$d")"
  git -C "$d" status --short
  git -C "$d" diff --stat | tail -1
done
