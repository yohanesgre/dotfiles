# Adding a design-system package

Upstream: `nexu-io/open-design` → `design-systems/<id>/` (Apache-2.0).

1. Append the id to `packages` in `selection.json` (or run `scripts/design-systems-sync.sh --add <id>`).
2. `bash scripts/design-systems-sync.sh --sync` — fetch, strip, pin provenance.
3. `bash scripts/design-systems-sync.sh --index` — rebuild INDEX (<=1200 words) + index.json.
4. `bash scripts/design-systems-sync.sh --check` — must be green before commit.

Strip rules live in `selection.json` (`keep`, `banned`). Never hand-edit files under `packages/` —
`--check` rule 6 detects it. Brand packages are aesthetic inspirations, not official assets.
