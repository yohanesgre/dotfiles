#!/usr/bin/env bash
# sync-hermes-plugins.sh — push dotfiles-owned hermes plugins into every live profile.
#
# Source of truth: ~/projects/dotfiles/config/hermes/plugins/<name>/
# Target:          ~/apps/hermes/profiles/<profile>/plugins/<name>/
#
# Hermes discovers user plugins from <HERMES_HOME>/plugins (one dir per profile),
# so a plugin edited in dotfiles only reaches a profile after this copy. Live
# __pycache__ is cleared so the next import recompiles the new source.
set -euo pipefail

DOTFILES_PLUGINS="$HOME/projects/dotfiles/config/hermes/plugins"
LIVE_PROFILES="$HOME/apps/hermes/profiles"

if [ ! -d "$DOTFILES_PLUGINS" ]; then
  echo "sync-hermes-plugins: no source at $DOTFILES_PLUGINS — skipping"
  exit 0
fi
if [ ! -d "$LIVE_PROFILES" ]; then
  echo "sync-hermes-plugins: no live profiles at $LIVE_PROFILES — skipping"
  exit 0
fi

copied=0
for profile_dir in "$LIVE_PROFILES"/*/; do
  [ -d "$profile_dir" ] || continue
  mkdir -p "$profile_dir/plugins"
  for plug in "$DOTFILES_PLUGINS"/*/; do
    [ -d "$plug" ] || continue
    pname=$(basename "$plug")
    mkdir -p "$profile_dir/plugins/$pname"
    rm -rf "$profile_dir/plugins/$pname/__pycache__"
    cp -f "$plug"/* "$profile_dir/plugins/$pname/"
    copied=$((copied + 1))
  done
done

echo "sync-hermes-plugins: synced $copied plugin dir(s) across live profiles"
