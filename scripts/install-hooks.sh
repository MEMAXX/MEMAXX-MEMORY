#!/usr/bin/env bash
# Install git hooks for the MEMAXX Memory repo.
# Runs automatically via `postinstall` in package.json.
# Safe to run multiple times — idempotent.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_DIR="$ROOT/.git/hooks"

# Skip gracefully if not a git checkout (e.g. npm install in a tarball)
if [ ! -d "$ROOT/.git" ]; then
  exit 0
fi

mkdir -p "$HOOK_DIR"

cat > "$HOOK_DIR/pre-push" <<'HOOK'
#!/usr/bin/env bash
# MEMAXX Memory — pre-push hook
# Runs the full test suite before allowing a push. Blocks on failure.
# Bypass with `git push --no-verify` in emergencies.

# pipefail is critical: without it, `npm test | tail` returns tail's exit
# code (always 0) and failed tests would silently pass the hook.
set -eo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "▶ Running MEMAXX smoke tests..."
# Capture output to a temp file so we can show tail on failure AND
# use npm test's real exit code (not tail's).
TMPFILE=$(mktemp)
if npm test --silent > "$TMPFILE" 2>&1; then
  rm -f "$TMPFILE"
  echo "✓ All tests green — proceeding with push."
else
  EXIT_CODE=$?
  echo ""
  echo "── Test output (last 30 lines) ──"
  tail -30 "$TMPFILE"
  rm -f "$TMPFILE"
  echo ""
  echo "✖ Tests failed (exit $EXIT_CODE) — push blocked."
  echo "  Bypass: git push --no-verify (not recommended)"
  exit 1
fi
HOOK

chmod +x "$HOOK_DIR/pre-push"
echo "✓ Installed pre-push hook at $HOOK_DIR/pre-push"
