#!/usr/bin/env python3
"""
Sync Hermes configs: live (~/apps/hermes) → dotfiles (~/projects/dotfiles).

Strategy:
  - Reads all three profile configs from ~/apps/hermes/profiles/<name>/config.yaml
  - "Common" keys (shared across all profiles) are taken from the yohanes (primary) profile
  - Profile-specific keys (discord, gateway, etc.) are preserved per-profile
  - Writes back to ~/projects/dotfiles/dot_config/hermes/profiles/<name>/config.yaml
  - Auto-commits if changes detected
"""

import os
import sys
import subprocess
from pathlib import Path

HOME = Path.home()
LIVE_DIR = HOME / "apps/hermes/profiles"
DOTFILES_DIR = HOME / "projects/dotfiles/config/hermes/profiles"
DOTFILES_REPO = HOME / "projects/dotfiles"

PROFILES = ["yohanes", "game-dev-team", "yola"]

# Keys that are SHARED across all profiles (from yohanes primary)
COMMON_KEYS = {
    "model", "agent", "web", "browser", "display", "tts",
    "skills", "security", "tools", "onboarding", "updates",
    "session_reset", "platform_toolsets", "known_plugin_toolsets",
    "_config_version",
}

# Keys that are PROFILE-SPECIFIC (preserved per-profile, never overwritten by common sync)
PROFILE_KEYS = {
    "discord", "gateway",
}


def read_yaml_text(path: Path) -> str:
    """Read a YAML file as raw text (preserving comments and formatting)."""
    if not path.exists():
        return ""
    return path.read_text()


def parse_yaml_sections(text: str) -> dict[str, str]:
    """
    Parse YAML into top-level sections, preserving raw text per section.
    Returns {section_name: raw_section_text} for top-level keys.
    Handles both block and flow style.
    """
    sections = {}
    lines = text.split("\n")
    current_section = None
    current_lines = []
    comment_buffer = []  # Comments before a section

    for line in lines:
        # Top-level key (no indentation, ends with ':')
        if line and not line[0].isspace() and not line.startswith("#") and ":" in line:
            key = line.split(":")[0].strip()
            if key and not key.startswith("#"):
                # Save previous section
                if current_section is not None:
                    sections[current_section] = "\n".join(current_lines).rstrip()

                # Start new section (include preceding comments)
                current_section = key
                current_lines = comment_buffer + [line]
                comment_buffer = []
                continue

        # Track comments that precede sections
        if line.startswith("#") and current_section is None:
            comment_buffer.append(line)
            continue

        if current_section is not None:
            current_lines.append(line)

    # Save last section
    if current_section is not None:
        sections[current_section] = "\n".join(current_lines).rstrip()

    return sections


def assemble_yaml(sections: dict[str, str], order: list[str] | None = None) -> str:
    """Reassemble YAML from sections dict, preserving key order."""
    if order is None:
        order = list(sections.keys())

    parts = []
    for key in order:
        if key in sections and sections[key].strip():
            parts.append(sections[key])

    return "\n".join(parts) + "\n"


def sync_configs(profiles: list[str], dry_run: bool = False) -> bool:
    """Sync all profile configs from live to dotfiles. Returns True if changes made."""
    changes_made = False

    # Step 1: Read the primary (yohanes) live config to extract common sections
    primary_path = LIVE_DIR / "yohanes/config.yaml"
    if not primary_path.exists():
        print(f"ERROR: Primary config not found at {primary_path}", file=sys.stderr)
        return False

    primary_text = read_yaml_text(primary_path)
    primary_sections = parse_yaml_sections(primary_text)

    # Step 2: For each profile, read live config and build the output
    for profile in profiles:
        live_path = LIVE_DIR / profile / "config.yaml"
        dotfiles_path = DOTFILES_DIR / profile / "config.yaml"

        if not live_path.exists():
            print(f"WARNING: No live config for {profile}, skipping", file=sys.stderr)
            continue

        live_text = read_yaml_text(live_path)
        live_sections = parse_yaml_sections(live_text)

        # Build output: common keys from yohanes primary, profile keys from this profile
        output_sections = {}

        # Add common sections from primary
        for key in COMMON_KEYS:
            if key in primary_sections:
                output_sections[key] = primary_sections[key]

        # Add profile-specific sections from this profile's live config
        for key in PROFILE_KEYS:
            if key in live_sections:
                output_sections[key] = live_sections[key]

        # Maintain a sensible ordering
        desired_order = [
            "model", "agent", "web", "browser", "display", "tts",
            "skills", "security", "tools",
            "discord", "gateway",
            "onboarding", "updates", "_config_version",
            "session_reset", "platform_toolsets", "known_plugin_toolsets",
        ]
        # Add any keys not in desired_order at the end
        for key in output_sections:
            if key not in desired_order:
                desired_order.append(key)

        new_content = assemble_yaml(output_sections, desired_order)

        # Check if dotfiles needs updating
        old_content = read_yaml_text(dotfiles_path) if dotfiles_path.exists() else ""

        if new_content != old_content:
            print(f"  ✏️  {profile}: config changed")
            if not dry_run:
                dotfiles_path.parent.mkdir(parents=True, exist_ok=True)
                dotfiles_path.write_text(new_content)
            changes_made = True
        else:
            print(f"  ✓  {profile}: up to date")

    return changes_made


def git_commit(dry_run: bool = False) -> bool:
    """Commit changes in the dotfiles repo."""
    import subprocess

    try:
        # Check for changes
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=DOTFILES_REPO,
            capture_output=True,
            text=True,
        )
        if not result.stdout.strip():
            print("  No changes to commit")
            return False

        print(f"  Changes detected:\n{result.stdout}")

        if dry_run:
            return True

        # Stage hermes config changes (Nix: config/hermes, legacy: dot_config/hermes)
        for pattern in ["config/hermes/profiles/*/config.yaml", "dot_config/hermes/profiles/*/config.yaml"]:
            subprocess.run(
                ["git", "add", pattern],
                cwd=DOTFILES_REPO,
                capture_output=False,
            )

        # Commit
        subprocess.run(
            ["git", "commit", "-m", "chore: sync hermes configs from live [auto]"],
            cwd=DOTFILES_REPO,
            check=True,
        )
        print("  ✓ Committed")

        # Push (optional, can fail gracefully)
        result = subprocess.run(
            ["git", "push"],
            cwd=DOTFILES_REPO,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            print("  ✓ Pushed to remote")
        else:
            print(f"  ⚠ Push skipped (no remote or no access): {result.stderr.strip()}")

        return True
    except subprocess.CalledProcessError as e:
        print(f"  ✗ Git error: {e}", file=sys.stderr)
        return False


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Sync Hermes configs to dotfiles")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without writing")
    parser.add_argument("--no-commit", action="store_true", help="Sync files but don't git commit")
    parser.add_argument("--profile", choices=PROFILES, help="Sync only a specific profile")
    args = parser.parse_args()

    profiles_to_sync = [args.profile] if args.profile else PROFILES

    print("🔄 Syncing Hermes configs → dotfiles...")
    print(f"   Primary: yohanes (common keys source)")
    print(f"   Profiles: {', '.join(profiles_to_sync)}")
    print()

    changes = sync_configs(profiles_to_sync, dry_run=args.dry_run)
    print()

    if changes:
        print("✅ Sync complete — configs updated")
        if not args.dry_run and not args.no_commit:
            print()
            git_commit(dry_run=args.dry_run)
    else:
        print("✅ All configs already in sync")


if __name__ == "__main__":
    main()
