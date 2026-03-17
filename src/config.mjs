/**
 * Config management for MEMAXX Memory Local.
 * Stores provider settings in ~/.memaxx/local-config.json
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CONFIG_DIR = join(homedir(), ".memaxx");
const CONFIG_PATH = join(CONFIG_DIR, "local-config.json");
const DB_PATH = join(CONFIG_DIR, "memories.db");

/** Default embedding dimensions per provider/model */
const EMBEDDING_DIMS = {
  "openai:text-embedding-3-small": 1536,
  "openai:text-embedding-3-large": 3072,
  "openrouter:openai/text-embedding-3-small": 1536,
  "openrouter:openai/text-embedding-3-large": 3072,
  "ollama:nomic-embed-text": 768,
  "ollama:mxbai-embed-large": 1024,
  "ollama:all-minilm": 384,
  "ollama:snowflake-arctic-embed": 1024,
  "ollama:bge-large": 1024,
};

/** Default models per provider */
const DEFAULT_MODELS = {
  openai: "text-embedding-3-small",
  openrouter: "openai/text-embedding-3-small",
  ollama: "nomic-embed-text",
};

/** Default API URLs */
const PROVIDER_URLS = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434",
};

export function getConfigDir() {
  return CONFIG_DIR;
}

export function getDbPath() {
  return DB_PATH;
}

export function configExists() {
  try {
    statSync(CONFIG_PATH);
    return true;
  } catch {
    return false;
  }
}

export function expandPath(p) {
  if (!p) return p;
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1));
  }
  return p;
}

export function readConfig() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (config.db_path) config.db_path = expandPath(config.db_path);
    return config;
  } catch {
    return null;
  }
}

export function writeConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  if (platform() === "win32") {
    try {
      const username = process.env.USERNAME || process.env.USER;
      if (username) {
        execFileSync("icacls", [CONFIG_PATH, "/inheritance:r", "/grant:r", `${username}:(F)`], {
          stdio: "ignore", windowsHide: true,
        });
      }
    } catch { /* non-critical */ }
  }
}

export function getEmbeddingDimension(provider, model) {
  const key = `${provider}:${model}`;
  return EMBEDDING_DIMS[key] || 1536; // fallback
}

export function getDefaultModel(provider) {
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;
}

export function getProviderUrl(provider) {
  return PROVIDER_URLS[provider] || PROVIDER_URLS.openai;
}

export { EMBEDDING_DIMS, DEFAULT_MODELS, PROVIDER_URLS };
