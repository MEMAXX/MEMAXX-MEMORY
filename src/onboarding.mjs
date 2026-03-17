/**
 * Interactive first-run onboarding for MEMAXX Memory Local.
 * Prompts user for embedding provider + API key via stdin/stderr.
 *
 * Note: All UI output goes to stderr (stdout is reserved for MCP JSON-RPC).
 */

import { createInterface } from "node:readline";
import {
  configExists, readConfig, writeConfig, getConfigDir, getDbPath,
  getDefaultModel, getProviderUrl, getEmbeddingDimension,
  PROVIDER_URLS,
} from "./config.mjs";

const rl = createInterface({ input: process.stdin, output: process.stderr });

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function print(msg = "") {
  process.stderr.write(msg + "\n");
}

/**
 * Verify an API key by making a test embedding request.
 * Returns { ok: true, dimension } or { ok: false, error }.
 */
async function verifyProvider(provider, apiKey, model, baseUrl) {
  const testText = "MEMAXX connection test";

  try {
    if (provider === "ollama") {
      // Ollama: POST /api/embeddings
      const res = await fetch(`${baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: testText }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 404 || text.includes("not found")) {
          return { ok: false, error: `Model "${model}" not found. Run: ollama pull ${model}` };
        }
        return { ok: false, error: `Ollama returned ${res.status}: ${text.slice(0, 200)}` };
      }

      const data = await res.json();
      const embedding = data.embedding || data.embeddings?.[0];
      if (!embedding || !Array.isArray(embedding)) {
        return { ok: false, error: "Unexpected response format from Ollama" };
      }
      return { ok: true, dimension: embedding.length };
    }

    // OpenAI / OpenRouter: POST /embeddings
    const url = provider === "openrouter"
      ? `${baseUrl}/embeddings`
      : `${baseUrl}/embeddings`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: testText }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401) return { ok: false, error: "Invalid API key" };
      if (res.status === 404) return { ok: false, error: `Model "${model}" not found` };
      return { ok: false, error: `API returned ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    const dim = data.data?.[0]?.embedding?.length;
    if (!dim) return { ok: false, error: "Unexpected response format" };
    return { ok: true, dimension: dim };

  } catch (err) {
    if (err.cause?.code === "ECONNREFUSED") {
      return { ok: false, error: `Cannot connect to ${baseUrl}. Is the service running?` };
    }
    return { ok: false, error: err.message };
  }
}

/**
 * Run the onboarding flow.
 * Returns { success: true, config, isFirstSetup: boolean } on success.
 * isFirstSetup is true when no prior config existed (fresh install).
 */
export async function runOnboarding() {
  const wasFirstSetup = !configExists();
  print();
  print("  ┌─────────────────────────────────────────────┐");
  print("  │   MEMAXX Memory — Self-Hosted Setup        │");
  print("  └─────────────────────────────────────────────┘");
  print();
  print("  MEMAXX needs an embedding provider for semantic search.");
  print("  Your data stays 100% local — only embedding API calls leave your machine.");
  print();
  print("  Choose a provider:");
  print();
  print("  [1] OpenRouter  — access to many models, one key");
  print("  [2] OpenAI      — text-embedding-3-small (recommended quality)");
  print("  [3] Ollama      — fully local, no API key needed");
  print();

  let provider;
  while (true) {
    const choice = await ask("  Enter choice (1/2/3): ");
    if (choice === "1") { provider = "openrouter"; break; }
    if (choice === "2") { provider = "openai"; break; }
    if (choice === "3") { provider = "ollama"; break; }
    print("  Invalid choice. Enter 1, 2, or 3.");
  }

  let apiKey = "";
  let baseUrl = getProviderUrl(provider);
  let model = getDefaultModel(provider);

  // API Key (not needed for Ollama)
  if (provider !== "ollama") {
    print();
    apiKey = await ask(`  Enter your ${provider === "openrouter" ? "OpenRouter" : "OpenAI"} API key: `);
    if (!apiKey) {
      print("  No key provided. Exiting.");
      process.exit(1);
    }
  } else {
    print();
    const customUrl = await ask(`  Ollama URL [${baseUrl}]: `);
    if (customUrl) baseUrl = customUrl;
  }

  // Model selection
  print();
  const customModel = await ask(`  Embedding model [${model}]: `);
  if (customModel) model = customModel;

  // Verify
  print();
  print("  Verifying connection...");

  const result = await verifyProvider(provider, apiKey, model, baseUrl);
  if (!result.ok) {
    print(`  Error: ${result.error}`);
    print();
    const retry = await ask("  Try again? (y/n): ");
    if (retry.toLowerCase() === "y") {
      rl.close();
      return runOnboarding();
    }
    process.exit(1);
  }

  print(`  Connected! Embedding dimension: ${result.dimension}`);

  // LLM for entity extraction (optional)
  print();
  print("  MEMAXX can extract entities from memories for the Knowledge Graph.");
  print("  This requires an LLM (chat model). You can skip this for now.");
  print();

  let llmProvider = "";
  let llmApiKey = "";
  let llmModel = "";
  let llmBaseUrl = "";

  const wantLlm = await ask("  Enable entity extraction? (y/n) [y]: ");
  if (wantLlm.toLowerCase() !== "n") {
    if (provider === "ollama") {
      llmProvider = "ollama";
      llmBaseUrl = baseUrl;
      llmModel = "llama3.2";
      const customLlm = await ask(`  Ollama chat model [${llmModel}]: `);
      if (customLlm) llmModel = customLlm;
    } else if (provider === "openrouter") {
      llmProvider = "openrouter";
      llmApiKey = apiKey; // reuse same key
      llmModel = "anthropic/claude-3.5-haiku";
      llmBaseUrl = baseUrl;
      const customLlm = await ask(`  LLM model [${llmModel}]: `);
      if (customLlm) llmModel = customLlm;
    } else {
      llmProvider = "openai";
      llmApiKey = apiKey;
      llmModel = "gpt-4o-mini";
      llmBaseUrl = baseUrl;
      const customLlm = await ask(`  LLM model [${llmModel}]: `);
      if (customLlm) llmModel = customLlm;
    }
  }

  const config = {
    version: 1,
    embedding: {
      provider,
      api_key: apiKey || null,
      base_url: baseUrl,
      model,
      dimension: result.dimension,
    },
    llm: llmProvider ? {
      provider: llmProvider,
      api_key: llmApiKey || null,
      base_url: llmBaseUrl,
      model: llmModel,
    } : null,
    db_path: getDbPath(),
    created_at: new Date().toISOString(),
  };

  writeConfig(config);

  print();
  print(`  Config saved to ${getConfigDir()}/local-config.json`);
  print(`  Database will be at ${config.db_path}`);
  print();
  print("  Setup complete! MEMAXX Memory is ready.");
  if (wasFirstSetup) {
    print("  Opening dashboard...");
  }
  print();

  rl.close();
  return { success: true, config, isFirstSetup: wasFirstSetup };
}

/**
 * Ensure config exists. If not, run onboarding.
 * If running inside an MCP context (non-TTY stdin), skip interactive onboarding
 * and return null to signal that setup is needed.
 *
 * Returns the config object directly (not the onboarding result wrapper)
 * for backwards compatibility.
 */
export async function ensureConfig() {
  const existing = readConfig();
  if (existing) return existing;

  // Check if stdin is a TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    return null; // Can't do interactive onboarding in MCP mode
  }

  const result = await runOnboarding();
  return result?.config || result;
}
