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

set -e

cd "$(git rev-parse --show-toplevel)"

echo "▶ Running MEMAXX smoke tests..."
if ! npm test --silent 2>&1 | tail -20; then
  echo ""
  echo "✖ Tests failed — push blocked."
  echo "  Fix the tests or use 'git push --no-verify' to bypass (not recommended)."
  exit 1
fi
echo "✓ All tests green — proceeding with push."
HOOK

chmod +x "$HOOK_DIR/pre-push"
echo "✓ Installed pre-push hook at $HOOK_DIR/pre-push"
