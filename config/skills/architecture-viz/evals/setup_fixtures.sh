#!/usr/bin/env bash
# Recreate the architecture-viz evaluation fixtures (skill-creator eval suite).
#
# Fixtures are generated, not committed. Three projects exercise routing and
# scale:
#   fixture-app   small multi-module app (~7 modules) + planted gaps for the
#                 honesty/watch-items eval
#   fixture-tiny  single-file project (scale-down case: must not fabricate nodes)
#   fixture-large 20 modules across 4 subsystems (scale-up case: must group)
#
# Usage: setup_fixtures.sh [target-dir]
# Default target: /tmp/opencode/architecture-viz-evals
set -euo pipefail

root="${1:-/tmp/opencode/architecture-viz-evals}"
rm -rf "$root"
mkdir -p "$root"

# ===================== fixture-app =====================
app="$root/fixture-app"
mkdir -p "$app/src" "$app/tests"

cat > "$app/src/config.py" <<'PY'
"""Configuration loading."""
import os

DEFAULT_TIMEOUT = 30


def load_config(name):
    """Return settings for a named config, applying defaults."""
    return {"timeout": DEFAULT_TIMEOUT, "name": name}


def resolve_env(prefix):
    """Resolve environment overrides for a prefix."""
    return {k: v for k, v in os.environ.items() if k.startswith(prefix)}
PY

cat > "$app/src/store.py" <<'PY'
"""Persistence layer."""


class Store:
    def __init__(self, root):
        self.root = root
        self._rows = {}

    def save(self, key, value):
        self._rows[key] = value
        return True

    def load(self, key):
        return self._rows.get(key)
PY

cat > "$app/src/engine.py" <<'PY'
"""Core engine: turns requests into stored results."""
from store import Store


class Engine:
    def __init__(self, store: Store):
        self.store = store

    def run(self, request):
        result = {"request": request, "status": "ok"}
        self.store.save(request["id"], result)
        return result
PY

cat > "$app/src/services.py" <<'PY'
"""Service layer built on the engine."""
from engine import Engine


class Service:
    def __init__(self, engine: Engine):
        self.engine = engine

    def handle(self, request):
        return self.engine.run(request)
PY

cat > "$app/src/bootstrap.py" <<'PY'
"""Composition root: wires config, store, engine, and services."""
from config import load_config
from engine import Engine
from services import Service
from store import Store


def build():
    cfg = load_config("app")
    cfg.setdefault("timeout", 30)  # duplicated default; should import config.DEFAULT_TIMEOUT
    store = Store(root="/var/lib/app")
    engine = Engine(store)
    service = Service(engine)
    return {"config": cfg, "service": service}
PY

cat > "$app/src/cli.py" <<'PY'
"""CLI consumer."""
from bootstrap import build


def main(argv):
    app = build()
    return app["service"].handle({"id": argv[0] if argv else "default"})
PY

cat > "$app/src/legacy.py" <<'PY'
"""Old entry point kept around during the split; nothing imports it."""
# TODO: delete once the migration lands
def old_main():
    raise SystemExit("legacy entry point")
PY

cat > "$app/tests/test_services.py" <<'PY'
from engine import Engine
from services import Service
from store import Store


def test_service_roundtrip():
    service = Service(Engine(Store("/tmp")))
    assert service.handle({"id": "1"})["status"] == "ok"
PY

# ===================== fixture-tiny =====================
tiny="$root/fixture-tiny"
mkdir -p "$tiny"
cat > "$tiny/main.py" <<'PY'
"""A single-file utility: uppercase text and count words."""
import sys


def transform(text):
    return text.upper()


def count_words(text):
    return len(text.split())


def main(argv):
    text = " ".join(argv) or "hello world"
    print(transform(text), count_words(text))


if __name__ == "__main__":
    main(sys.argv[1:])
PY

# ===================== fixture-large =====================
large="$root/fixture-large"
mkdir -p "$large"
for area in services consumers engine config; do
  mkdir -p "$large/$area"
  for n in 1 2 3 4 5; do
    cat > "$large/$area/mod${n}.py" <<PY
"""$area module $n."""
from ${area}.mod$(( (n % 5) + 1 )) import helper_${n}  # placeholder dependency


def run_${n}(request):
    return {"module": "$area.mod${n}", "request": request}
PY
  done
done
cat > "$large/README.md" <<'MD'
# fixture-large

Twenty modules grouped into four subsystems: services, consumers, engine,
config. The architecture map must group them (one box per subsystem) rather
than drawing twenty nodes.
MD

echo "fixtures written to $root"
for d in "$root"/*/; do
  echo "  $(basename "$d"): $(find "$d" -type f | wc -l) files"
done
