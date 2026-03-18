/**
 * Multi-provider embedding client.
 * Supports OpenAI, Gemini, Mistral, Voyage, OpenRouter, Ollama, and any OpenAI-compatible provider.
 */

/** @type {Map<string, { embedding: Float32Array, ts: number }>} */
const cache = new Map();
const CACHE_TTL_MS = 300_000; // 5 min
const MAX_CACHE = 500;

/**
 * Generate an embedding vector for the given text.
 * @param {string} text
 * @param {{ provider: string, api_key: string|null, base_url: string, model: string, dimension: number }} config
 * @returns {Promise<Float32Array|null>}
 */
export async function generateEmbedding(text, config) {
  if (!text || text.trim().length < 3) return null;

  // Truncate to ~8000 tokens (~32000 chars) to stay within model limits
  const truncated = text.slice(0, 32000);

  // Cache check
  const cacheKey = `${config.model}:${truncated.slice(0, 200)}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.embedding;
  }

  try {
    const embedding = config.provider === "ollama"
      ? await ollamaEmbed(truncated, config)
      : await openaiEmbed(truncated, config);

    if (embedding) {
      // Evict old entries if cache is full
      if (cache.size >= MAX_CACHE) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
      }
      cache.set(cacheKey, { embedding, ts: Date.now() });
    }

    return embedding;
  } catch (err) {
    log(`Embedding error (${config.provider}): ${err.message}`);
    return null;
  }
}

/**
 * Generate embeddings for multiple texts in a batch.
 * OpenAI/OpenRouter support native batching. Ollama falls back to sequential.
 * @param {string[]} texts
 * @param {object} config
 * @returns {Promise<(Float32Array|null)[]>}
 */
export async function generateEmbeddingBatch(texts, config) {
  if (config.provider === "ollama") {
    // Ollama doesn't support batch — sequential
    return Promise.all(texts.map(t => generateEmbedding(t, config)));
  }

  // OpenAI / OpenRouter batch API
  const validTexts = texts.map(t => (t || "").slice(0, 32000));

  try {
    const res = await fetch(`${config.base_url}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.api_key}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: validTexts,
      }),
    });

    if (!res.ok) {
      log(`Batch embedding error: ${res.status}`);
      // Fallback to individual requests
      return Promise.all(texts.map(t => generateEmbedding(t, config)));
    }

    const data = await res.json();
    return data.data.map(item => {
      const arr = new Float32Array(item.embedding);
      return arr;
    });
  } catch (err) {
    log(`Batch embedding error: ${err.message}`);
    return Promise.all(texts.map(t => generateEmbedding(t, config)));
  }
}

/** OpenAI / OpenRouter embedding */
async function openaiEmbed(text, config) {
  const res = await fetch(`${config.base_url}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.api_key}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const vec = data.data?.[0]?.embedding;
  if (!vec) throw new Error("No embedding in response");

  return new Float32Array(vec);
}

/** Ollama embedding */
async function ollamaEmbed(text, config) {
  const res = await fetch(`${config.base_url}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      prompt: text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const vec = data.embedding || data.embeddings?.[0];
  if (!vec || !Array.isArray(vec)) throw new Error("No embedding in response");

  return new Float32Array(vec);
}

/**
 * Compute cosine similarity between two Float32Arrays.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} similarity between -1 and 1
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function log(msg) {
  process.stderr.write(`[memaxx-local] ${msg}\n`);
}
