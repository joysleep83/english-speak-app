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

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'deepseek/deepseek-r1:free',
    messages: [{ role: 'user', content: 'Correct this sentence: "I goed to store yesterday."' }],
  }),
});

const data = await res.json();
console.log('Status :', res.status);
console.log('Model  :', data.model ?? 'N/A');
console.log('Reply  :', data.choices?.[0]?.message?.content ?? JSON.stringify(data.error));
console.log('Tokens :', JSON.stringify(data.usage ?? {}));
