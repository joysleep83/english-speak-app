import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env manually (no dotenv dependency needed)
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '.env');
const envVars = Object.fromEntries(
  readFileSync(envPath, 'utf-8')
    .split('\n')
    .filter(line => line.includes('=') && !line.startsWith('#'))
    .map(line => line.split('=').map(s => s.trim()))
);

const API_KEY = envVars['OPENROUTER_API_KEY'];
const MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callAPI(messages, retries = 3, delayMs = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, messages }),
    });

    if (res.ok) return res.json();

    const err = await res.json();
    if (res.status === 429 && attempt < retries) {
      console.log(`  ⏳ Rate limit 감지 (시도 ${attempt}/${retries}) — ${delayMs / 1000}초 후 재시도...`);
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }
    throw Object.assign(new Error(`HTTP ${res.status}`), { body: err });
  }
}

async function testAPI(label, messages) {
  console.log(`\n[${'='.repeat(50)}]`);
  console.log(`테스트: ${label}`);
  console.log(`${'='.repeat(52)}`);

  try {
    const data = await callAPI(messages);
    const reply = data.choices?.[0]?.message?.content ?? '(응답 없음)';
    console.log('모델 응답:', reply);
    console.log('토큰 사용:', JSON.stringify(data.usage ?? {}));
  } catch (e) {
    console.error(`실패: ${e.message}`);
    if (e.body) console.error('상세:', JSON.stringify(e.body, null, 2));
  }
}

// ── 테스트 1: 기본 텍스트 인식 ──────────────────────────────
await testAPI('기본 텍스트 이해', [
  { role: 'user', content: 'What is the capital of France? Answer in one sentence.' }
]);

// ── 테스트 2: 영어 문법 교정 (EnglishSpeak 앱 핵심 기능) ─────
await testAPI('영어 문법 교정', [
  {
    role: 'system',
    content: 'You are an English tutor. Correct any grammar mistakes and explain briefly.',
  },
  {
    role: 'user',
    content: 'I goed to the store yesterday and buyed some apple.',
  },
]);

// ── 테스트 3: 다중 턴 대화 ───────────────────────────────────
await testAPI('다중 턴 대화', [
  { role: 'user', content: 'My name is Jintae. I want to improve my English.' },
  { role: 'assistant', content: "Hi Jintae! I'd love to help you improve your English. What area would you like to focus on?" },
  { role: 'user', content: 'I have trouble with past tense verbs. Can you give me a quick tip?' },
]);

console.log('\n✅ 모든 테스트 완료\n');
