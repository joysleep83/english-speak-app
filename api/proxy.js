export const config = { runtime: 'edge' };

const ALLOWED_MODELS = new Set([
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-20b:free',
]);
const MAX_TOKENS_LIMIT = 600;
const MAX_MESSAGES     = 22; // MAX_TURNS(10) * 2 + system

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: 'Server misconfiguration' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Validate model
  if (!ALLOWED_MODELS.has(body.model)) {
    return new Response(
      JSON.stringify({ error: { message: 'Model not allowed' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Validate messages
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: 'Invalid messages' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Build a clean, server-controlled payload — never pass raw body
  const safeBody = {
    model:      body.model,
    messages:   body.messages.slice(0, MAX_MESSAGES).map(m => ({
      role:    m.role === 'user' || m.role === 'assistant' || m.role === 'system' ? m.role : 'user',
      content: String(m.content).slice(0, 8000),
    })),
    stream:     body.stream === true,
    max_tokens: Math.min(Number(body.max_tokens) || 300, MAX_TOKENS_LIMIT),
  };

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': req.headers.get('origin') ?? '',
      'X-Title': 'EnglishAI Chat',
    },
    body: JSON.stringify(safeBody),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': safeBody.stream ? 'text/event-stream' : 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
}
