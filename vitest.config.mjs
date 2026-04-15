/**
 * Vitest configuration for MEMAXX Memory smoke tests.
 *
 * Two test layers:
 *   - tests/unit/       → pure function tests, no I/O, <10ms each
 *   - tests/integration/ → live Docker container at localhost:3100
 *
 * Integration tests require the Memory server to be running:
 *   docker compose up -d
 *
 * Run:
 *   npm test             — all tests
 *   npm run test:unit    — only unit (fast, no server needed)
 *   npm run test:watch   — watch mode for development
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    reporters: ["default"],
    testTimeout: 10_000,        // 10s — integration tests hit WebSocket + HTTP
    hookTimeout: 15_000,        // 15s — beforeAll may wait for container
    include: ["tests/**/*.test.mjs"],
    exclude: ["node_modules", "dist", ".memaxx", ".memaxx-backups"],
  },
});
