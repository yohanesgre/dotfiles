#!/usr/bin/env bash
# Safe update: pull dotfiles, validate, then apply
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/lib.sh"
extend_path
VALIDATE="$ROOT_DIR/scripts/validate.sh"

echo "══════════════════════════════════════════════"
echo "  Dotfiles Safe Update"
echo "══════════════════════════════════════════════"
echo ""

# ── Step 1: Git pull ──
echo -e "${YELLOW}Step 1/4: Pulling latest from remote...${NC}"
cd "$ROOT_DIR"
if git pull 2>&1; then
    echo -e "${GREEN}  ✓ Pull complete${NC}"
else
    echo -e "${RED}  ✗ Pull failed. Aborting.${NC}"
    exit 1
fi
echo ""

# ── Step 2: Run validation ──
echo -e "${YELLOW}Step 2/4: Running validation...${NC}"
if bash "$VALIDATE" --ci; then
    echo -e "${GREEN}  ✓ Validation passed${NC}"
else
    echo ""
    echo -e "${RED}  ✗ Validation failed. Fix the issues before applying.${NC}"
    echo "    Run: cd $ROOT_DIR && bash scripts/validate.sh"
    echo ""
    exit 1
fi
echo ""

# ── Step 3: Chezmoi apply ──
echo -e "${YELLOW}Step 3/4: Applying config...${NC}"
if chezmoi apply 2>&1; then
    echo -e "${GREEN}  ✓ Config applied${NC}"
else
    echo -e "${RED}  ✗ chezmoi apply failed${NC}"
    exit 1
fi
echo ""

# ── Step 4: Validate local skills ──
echo -e "${YELLOW}Step 4/4: Validating local setup...${NC}"
if bash "$VALIDATE"; then
    echo -e "${GREEN}  ✓ Local setup validated${NC}"
else
    echo ""
    echo -e "${YELLOW}  ⚠  Config applied but local validation had warnings.${NC}"
    echo "    Run: bash $VALIDATE"
    echo ""
    exit 1
fi

echo ""
echo "══════════════════════════════════════════════"
echo -e "  ${GREEN}✓ All done — dotfiles up to date${NC}"
echo "══════════════════════════════════════════════"
