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

const MODEL = 'openai/gpt-oss-20b:free';

async function testAPI(label, messages) {
  console.log(`\n${'='.repeat(55)}`);
  console.log(`테스트: ${label}`);
  console.log('='.repeat(55));

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, messages }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.log('❌ 실패:', data.error?.message);
    return;
  }

  console.log('✅ 모델 응답:');
  console.log(data.choices[0].message.content);
  const u = data.usage;
  console.log(`\n[토큰] 입력: ${u.prompt_tokens}, 출력: ${u.completion_tokens}, 합계: ${u.total_tokens}, 비용: $${u.cost}`);
}

// 테스트 1: 기본 텍스트 이해
await testAPI('기본 텍스트 이해', [
  { role: 'user', content: 'What is the capital of France? Answer in one sentence.' },
]);

// 테스트 2: 영어 문법 교정 (EnglishSpeak 핵심 기능)
await testAPI('영어 문법 교정', [
  { role: 'user', content: 'Correct grammar mistakes in this sentence and explain what was wrong: "I goed to store yesterday and buyed some apple."' },
]);

// 테스트 3: 다중 턴 대화
await testAPI('다중 턴 대화', [
  { role: 'user', content: 'My name is Jintae. I want to improve my English.' },
  { role: 'assistant', content: "Hi Jintae! I'd love to help you improve your English. What area would you like to focus on?" },
  { role: 'user', content: 'I have trouble with past tense verbs. Can you give me a quick tip?' },
]);

console.log('\n\n✅ 모든 테스트 완료\n');
