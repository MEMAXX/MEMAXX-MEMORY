/**
 * LLM client for entity extraction and memory consolidation.
 * Supports OpenAI, OpenRouter, and Ollama chat completions.
 */

/**
 * Send a chat completion request.
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {{ provider: string, api_key: string|null, base_url: string, model: string }} config
 * @returns {Promise<string|null>}
 */
export async function chatCompletion(systemPrompt, userMessage, config) {
  if (!config) return null;

  try {
    if (config.provider === "ollama") {
      return await ollamaChat(systemPrompt, userMessage, config);
    }
    return await openaiChat(systemPrompt, userMessage, config);
  } catch (err) {
    log(`LLM error (${config.provider}/${config.model}): ${err.message}`);
    return null;
  }
}

async function openaiChat(systemPrompt, userMessage, config) {
  const res = await fetch(`${config.base_url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.api_key}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}

async function ollamaChat(systemPrompt, userMessage, config) {
  const res = await fetch(`${config.base_url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: false,
      options: { temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.message?.content || null;
}

/**
 * Extract entities and relations from memory content using LLM.
 * Returns { entities: [{ name, type }], relations: [{ source, target, relation }] }
 */
export async function extractEntities(content, memoryType, config) {
  if (!config) return { entities: [], relations: [] };

  const systemPrompt = `You extract structured entities and relations from developer memory notes.
Return ONLY valid JSON with this exact format:
{
  "entities": [{ "name": "exact_name", "type": "file|function|class|module|package|concept|person|service|api|database|config|pattern|bug" }],
  "relations": [{ "source": "entity_name", "target": "entity_name", "relation": "uses|imports|extends|implements|calls|depends_on|fixes|creates|modifies|contains|relates_to" }]
}
Rules:
- Extract 2-8 entities max (only significant ones)
- Names must be exact (file paths, function names, class names)
- Types must be from the allowed list
- Relations connect extracted entities
- If no clear entities, return empty arrays`;

  const userMsg = `Memory type: ${memoryType}\nContent: ${content.slice(0, 2000)}`;

  const response = await chatCompletion(systemPrompt, userMsg, config);
  if (!response) return { entities: [], relations: [] };

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonStr = response.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 8) : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations.slice(0, 10) : [],
    };
  } catch {
    log(`Failed to parse entity extraction response`);
    return { entities: [], relations: [] };
  }
}

function log(msg) {
  process.stderr.write(`[memaxx-local] ${msg}\n`);
}
