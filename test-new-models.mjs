import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const envVars = Object.fromEntries(
  readFileSync(join(__dir, '.env'), 'utf-8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
);

const API_KEY = envVars['OPENROUTER_API_KEY'];
const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

const MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'google/gemma-3-27b-it:free',
  'openai/gpt-oss-20b:free',
];

const FEEDBACK_MODEL = 'google/gemma-4-31b-it:free';

const CONV_PROMPT = [
  {
    role: 'system',
    content: 'You are a friendly English conversation partner. Keep responses short and natural (2-3 sentences).',
  },
  { role: 'user', content: 'I went to the park yesterday and it was really beauty.' },
];

const FEEDBACK_PROMPT = [
  {
    role: 'system',
    content: 'You are an English grammar checker. Return ONLY a JSON object with keys: corrected (string), issues (array of strings).',
  },
  { role: 'user', content: 'I went to the park yesterday and it was really beauty.' },
];

async function call(model, messages) {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 300 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status} — ${err?.error?.message ?? JSON.stringify(err)}`);
  }
  return res.json();
}

console.log('=== 새 AI 모델 풀 테스트 ===\n');

for (const model of MODELS) {
  process.stdout.write(`[${model}]\n  대화 응답... `);
  try {
    const data = await call(model, CONV_PROMPT);
    const reply = data.choices?.[0]?.message?.content?.trim() ?? '(없음)';
    console.log('OK');
    console.log(' ', reply.replace(/\n/g, ' ').slice(0, 120));
  } catch (e) {
    console.log(`FAIL — ${e.message}`);
  }
  console.log();
}

console.log(`[${FEEDBACK_MODEL}] (피드백 모델)`);
process.stdout.write('  JSON 피드백... ');
try {
  const data = await call(FEEDBACK_MODEL, FEEDBACK_PROMPT);
  const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
  const json = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  const parsed = JSON.parse(json);
  console.log('OK');
  console.log('  corrected:', parsed.corrected);
  console.log('  issues   :', parsed.issues);
} catch (e) {
  console.log(`FAIL — ${e.message}`);
}

console.log('\n=== 테스트 완료 ===');
