# Adding a design-system package

Upstream: `nexu-io/open-design` → `design-systems/<id>/` (Apache-2.0).

1. Append the id to `packages` in `selection.json` (or run `scripts/design-systems-sync.sh --add <id>`).
2. `bash scripts/design-systems-sync.sh --sync` — fetch, strip, pin provenance.
3. `bash scripts/design-systems-sync.sh --index` — rebuild INDEX (<=1200 words) + index.json.
4. `bash scripts/design-systems-sync.sh --check` — must be green before commit.

Strip rules live in `selection.json` (`keep`, `banned`). Never hand-edit files under `packages/` —
`--check` rule 6 detects it. Brand packages are aesthetic inspirations, not official assets.

## Known upstream defects (verified 2026-09-29)

- `trading-terminal/DESIGN.md` §2/§9 declares palette `#00D4AA` / `#FF4757`, but its
  `tokens.css` defines `--accent: #38bdf8`, `--success: #22c55e`, `--danger: #ef4444`.
  `tokens.css` is canonical (`design-tokens.json` sources from it); treat the DESIGN.md
  prose palette as stale.
- `trading-terminal/tokens.css` `--focus-ring: rgba(56,189,248,0.28)` composites to ~1.72:1
  against `--bg` — below the 3:1 non-text contrast minimum. Pair with a solid 1px accent
  outline when consuming it.
