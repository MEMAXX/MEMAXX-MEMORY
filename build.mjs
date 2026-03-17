#!/usr/bin/env node
/**
 * MEMAXX Memory-Local Build Script
 *
 * Bundles all source into a single file with esbuild,
 * then obfuscates with javascript-obfuscator to protect source code.
 *
 * Usage: node build.mjs
 */

import { build } from "esbuild";
import JavaScriptObfuscator from "javascript-obfuscator";
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "dist");
const OUTPUT = join(DIST, "memaxx-memory-local.mjs");

console.log("[build] Starting MEMAXX Memory-Local build...\n");

// ── Step 1: Create dist directory ────────────────────────────────────
mkdirSync(DIST, { recursive: true });

// ── Step 2: Bundle with esbuild ──────────────────────────────────────
console.log("[build] Bundling with esbuild...");

await build({
  entryPoints: [join(__dirname, "bin.mjs")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: OUTPUT,
  external: ["better-sqlite3", "sqlite-vec"],
  // No shebang banner here — added after obfuscation to avoid duplication
  minify: false,       // obfuscator handles this
  sourcemap: false,    // no sourcemaps in production
  treeShaking: true,
  logLevel: "info",
});

console.log("[build] Bundle complete.\n");

// ── Step 3: Obfuscate ────────────────────────────────────────────────
console.log("[build] Obfuscating...");

const bundledCode = readFileSync(OUTPUT, "utf-8");

// Strip any shebang before obfuscating (obfuscator chokes on it)
const shebang = "#!/usr/bin/env node\n";
const codeWithoutShebang = bundledCode.replace(/^#!.*\n/, "");

const obfuscated = JavaScriptObfuscator.obfuscate(codeWithoutShebang, {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.5,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  target: "node",
});

writeFileSync(OUTPUT, shebang + obfuscated.getObfuscatedCode());
console.log("[build] Obfuscation complete.\n");

// ── Step 4: Copy and patch package.json for dist ─────────────────────
console.log("[build] Preparing dist/package.json...");

const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));

// Point main and bin to the bundled file
pkg.main = "memaxx-memory-local.mjs";
pkg.bin = { "memaxx-memory-local": "memaxx-memory-local.mjs" };

// Remove devDependencies — dist doesn't need build tools
delete pkg.devDependencies;

// Remove files field — dist ships as-is
delete pkg.files;

// Remove build scripts that reference source
pkg.scripts = {
  start: "node memaxx-memory-local.mjs",
};

writeFileSync(join(DIST, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

// ── Step 5: Report ───────────────────────────────────────────────────
const { size } = await import("node:fs").then((fs) =>
  fs.statSync(OUTPUT)
);
const sizeMB = (size / 1024 / 1024).toFixed(2);

console.log(`[build] Done!`);
console.log(`[build] Output: ${OUTPUT}`);
console.log(`[build] Size:   ${sizeMB} MB`);
console.log(`[build] Test:   node dist/memaxx-memory-local.mjs --version`);
