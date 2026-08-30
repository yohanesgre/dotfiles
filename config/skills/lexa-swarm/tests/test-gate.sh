#!/usr/bin/env bash
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q -b main
mkdir -p "$TMP/wireframes"
printf '#!/usr/bin/env bash\necho "wf-ok"\n' > "$TMP/wireframes/build.sh"
chmod +x "$TMP/wireframes/build.sh"
mkdir -p "$TMP/node_modules/.bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/node_modules/.bin/tsc"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/node_modules/.bin/vitest"
chmod +x "$TMP/node_modules/.bin/tsc" "$TMP/node_modules/.bin/vitest"
REPO="$TMP" bash "$TEST_DIR/../scripts/gate.sh"
echo "PASS"
