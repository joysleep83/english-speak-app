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

const CANDIDATES = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'google/gemma-3-12b-it:free',
  'meta-llama/llama-3.2-3b-instruct:free',
];

async function call(model, messages) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages }),
  });
  return { status: res.status, data: await res.json() };
}

const MESSAGES = [
  { role: 'system', content: 'You are an English tutor. Correct grammar mistakes briefly.' },
  { role: 'user', content: 'I goed to store yesterday and buyed some apple.' },
];

for (const model of CANDIDATES) {
  process.stdout.write(`\n시도: ${model}\n`);
  const { status, data } = await call(model, MESSAGES);
  if (status === 200) {
    console.log('✅ 성공!');
    console.log('응답:', data.choices[0].message.content);
    console.log('토큰:', JSON.stringify(data.usage));
    process.exit(0);
  }
  const code = data.error?.code ?? status;
  const msg = data.error?.metadata?.raw ?? data.error?.message ?? JSON.stringify(data);
  console.log(`❌ 실패 (${code}): ${msg}`);
}

console.log('\n모든 후보 모델 실패');
