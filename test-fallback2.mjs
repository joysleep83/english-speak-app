import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dir, '.env'), 'utf-8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
);

// Only user message (no system) for broader model compatibility
const MESSAGES = [
  { role: 'user', content: 'Correct this English sentence in one sentence: "I goed to store yesterday and buyed some apple."' },
];

const CANDIDATES = [
  'openai/gpt-oss-20b:free',
  'openai/gpt-oss-120b:free',
  'qwen/qwen3-coder:free',
  'z-ai/glm-4.5-air:free',
  'google/gemma-3-12b-it:free',
  'google/gemma-3-4b-it:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
];

for (const model of CANDIDATES) {
  process.stdout.write(`\n시도: ${model}\n`);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages: MESSAGES }),
  });
  const data = await res.json();
  if (res.ok) {
    console.log('✅ 성공!');
    console.log('응답:', data.choices[0].message.content);
    console.log('토큰:', JSON.stringify(data.usage));
    process.exit(0);
  }
  const code = data.error?.code ?? res.status;
  const msg = data.error?.metadata?.raw ?? data.error?.message ?? JSON.stringify(data.error);
  console.log(`❌ (${code}): ${msg}`);
}

console.log('\n현재 사용 가능한 무료 모델 없음 — upstream 공급자 rate limit 상태');
