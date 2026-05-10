'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const PRIMARY_MODEL        = 'meta-llama/llama-3.3-70b-instruct:free';
const FALLBACK_MODEL       = 'openai/gpt-oss-20b:free';
const EXTRA_FALLBACK_MODEL = 'meta-llama/llama-4-scout:free';
const NEMOTRON_MODEL       = 'nvidia/nemotron-3-super-120b-a12b:free'; // suggestions & translation
const GEMMA_MODEL          = 'google/gemma-4-31b-it:free';             // feedback

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_TURNS      = 10;

const SUPABASE_URL      = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_URL)      || '';
const SUPABASE_ANON_KEY = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_ANON_KEY) || '';

// config.js가 있으면 직접 호출(로컬 개발), 없으면 Vercel Edge Function 프록시 사용
const LOCAL_API_KEY = (typeof CONFIG !== 'undefined' && CONFIG.OPENROUTER_API_KEY)
  || localStorage.getItem('or_api_key') || '';
const USE_PROXY = !LOCAL_API_KEY;
const API_URL   = USE_PROXY
  ? '/api/proxy'
  : 'https://openrouter.ai/api/v1/chat/completions';

function apiHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    'HTTP-Referer': window.location.origin,
    'X-Title': 'EnglishAI Chat',
  };
  if (!USE_PROXY) headers['Authorization'] = `Bearer ${LOCAL_API_KEY}`;
  return headers;
}

const LANG_CONFIG = {
  en: {
    flag: '🇺🇸', name: 'English',
    sttLang: 'en-US', ttsLang: 'en-US',
    inputPlaceholder: 'Type in English or tap 🎤 to speak…',
    feedbackPlaceholder: 'Send a message to get feedback on your English.',
    welcome: (name) => `Hi${name}! I'm your English conversation partner.<br>Let's start practicing — type a message or tap 🎤 to speak!`,
    systemPrompt: 'You are a friendly English conversation partner. Respond naturally in English. Keep responses concise (2-4 sentences). Encourage the user to continue speaking.',
    feedbackPrompt:
      'You are an English language teacher. Analyze the user\'s sentence for:\n' +
      '1. Grammar errors\n2. Unnatural expressions\n3. Vocabulary improvements\n\n' +
      'Respond ONLY in this exact JSON (no markdown, no extra text):\n' +
      '{"hasIssues":true,"corrections":[{"original":"...","corrected":"...","explanation":"...","type":"grammar"}],"overallFeedback":"..."}\n' +
      'type must be: grammar, expression, or vocabulary.\n' +
      'Write "explanation" and "overallFeedback" fields in Korean.\n' +
      'If correct: {"hasIssues":false,"corrections":[],"overallFeedback":"훌륭해요! 자연스러운 영어입니다."}',
  },
  ja: {
    flag: '🇯🇵', name: '日本語',
    sttLang: 'ja-JP', ttsLang: 'ja-JP',
    inputPlaceholder: '日本語で入力するか、🎤をタップして話してください…',
    feedbackPlaceholder: '메시지를 보내면 일본어 피드백을 받아볼 수 있습니다.',
    welcome: (name) => `こんにちは${name}！日本語の練習をしましょう。<br>メッセージを入力するか、🎤をタップして話してください！`,
    systemPrompt: 'You are a friendly Japanese conversation partner. Respond naturally in Japanese using appropriate hiragana, katakana, and kanji. Keep responses concise (2-4 sentences). Encourage the user to continue speaking.',
    feedbackPrompt:
      'You are a Japanese language teacher. Analyze the user\'s Japanese sentence for:\n' +
      '1. Grammar errors (particles, verb forms, etc.)\n2. Unnatural expressions\n3. Vocabulary improvements\n\n' +
      'Respond ONLY in this exact JSON (no markdown, no extra text):\n' +
      '{"hasIssues":true,"corrections":[{"original":"...","corrected":"...","explanation":"...","type":"grammar"}],"overallFeedback":"..."}\n' +
      'type must be: grammar, expression, or vocabulary.\n' +
      'IMPORTANT: You MUST write ALL "explanation" and "overallFeedback" values in Korean (한국어). Never use Japanese in these fields.\n' +
      'If correct: {"hasIssues":false,"corrections":[],"overallFeedback":"훌륭해요! 자연스러운 일본어입니다."}',
  },
};

const ROLEPLAY_SCENARIOS = [
  {
    id: 'restaurant',
    emoji: '🍽️',
    title: 'At a Restaurant',
    desc: '레스토랑에서 주문하기',
    prompt: 'You are a friendly restaurant waiter/waitress. The user is a customer dining at your restaurant. Greet them warmly, help them order food, answer menu questions, and provide a realistic restaurant experience. Stay in character throughout. Keep responses concise (2-3 sentences).',
  },
  {
    id: 'airport',
    emoji: '✈️',
    title: 'At the Airport',
    desc: '공항 체크인 & 탑승 안내',
    prompt: 'You are a professional airline check-in agent at an international airport. The user is a passenger. Help them check in, handle baggage questions, issue boarding passes, and direct them to their gate. Stay professional and helpful. Keep responses concise (2-3 sentences).',
  },
  {
    id: 'hotel',
    emoji: '🏨',
    title: 'Hotel Check-in',
    desc: '호텔 체크인 & 서비스',
    prompt: 'You are a friendly hotel front desk receptionist. The user is a guest checking in. Help them with the check-in process, explain room features and hotel amenities, and handle any requests. Be warm and professional. Keep responses concise (2-3 sentences).',
  },
  {
    id: 'interview',
    emoji: '💼',
    title: 'Job Interview',
    desc: '영어 면접 연습',
    prompt: 'You are a professional interviewer at a reputable company conducting a job interview in English. Ask common interview questions, respond to answers thoughtfully, and simulate a realistic interview. Be professional but encouraging. Keep responses concise (2-3 sentences).',
  },
  {
    id: 'shopping',
    emoji: '🛍️',
    title: 'Shopping',
    desc: '매장에서 쇼핑하기',
    prompt: 'You are a helpful store assistant in a clothing or general store. The user is a customer shopping. Help them find items, answer questions about sizes, prices, and availability, suggest alternatives, and assist with their purchase. Keep responses concise (2-3 sentences).',
  },
  {
    id: 'doctor',
    emoji: '🏥',
    title: "Doctor's Office",
    desc: '병원에서 진료받기',
    prompt: "You are a friendly and professional doctor at a clinic. The user is a patient visiting you. Ask about their symptoms, conduct a typical consultation, explain your assessment simply, and give general advice. Keep it realistic and educational. Keep responses concise (2-3 sentences).",
  },
  {
    id: 'smalltalk',
    emoji: '☕',
    title: 'Small Talk',
    desc: '일상 대화 & 친구 만들기',
    prompt: 'You are a friendly native English speaker meeting the user for the first time at a social event. Engage in natural small talk — hobbies, travel, work, local recommendations. Be warm, curious, and encouraging. Keep responses concise (2-3 sentences).',
  },
  {
    id: 'customer_service',
    emoji: '📞',
    title: 'Customer Service',
    desc: '전화 & 고객센터 영어',
    prompt: 'You are a professional customer service representative. The user is a customer calling with an inquiry or problem. Handle their request professionally, ask clarifying questions, offer solutions, and provide a realistic customer service experience. Keep responses concise (2-3 sentences).',
  },
];

const ROLEPLAY_SCENARIOS_JA = [
  {
    id: 'restaurant_ja', emoji: '🍣', title: 'レストランで', desc: '레스토랑에서 주문하기',
    prompt: 'あなたは親切な日本料理レストランのウェイターです。お客様（ユーザー）の注文を受け、メニューについての質問に答えてください。自然な日本語で話し、簡潔に（2〜3文）応答してください。',
  },
  {
    id: 'convenience_ja', emoji: '🏪', title: 'コンビニで', desc: '편의점에서 쇼핑하기',
    prompt: 'あなたはコンビニエンスストアの店員です。お客様（ユーザー）の対応をしてください。商品の場所案内、レジでの会計、ポイントカードの確認など、日常的なコンビニでのやり取りを自然な日本語で行ってください。簡潔に（2〜3文）応答してください。',
  },
  {
    id: 'hotel_ja', emoji: '🏨', title: 'ホテルで', desc: '호텔 체크인 & 서비스',
    prompt: 'あなたは丁寧なホテルのフロントスタッフです。お客様（ユーザー）のチェックインを手伝い、施設の案内やリクエストに対応してください。丁寧な日本語（敬語）で話し、簡潔に（2〜3文）応答してください。',
  },
  {
    id: 'interview_ja', emoji: '💼', title: '就職面接', desc: '일본어 면접 연습',
    prompt: 'あなたは日本企業の面接官です。応募者（ユーザー）に面接の質問をしてください。志望動機、自己紹介、強みと弱み等の一般的な質問を行い、ビジネス敬語を使った自然な日本語で対応してください。簡潔に（2〜3文）応答してください。',
  },
  {
    id: 'doctor_ja', emoji: '🏥', title: '病院で', desc: '병원에서 진료받기',
    prompt: 'あなたは親切なクリニックの医師です。患者（ユーザー）の症状を聞き、典型的な診察の流れで対応してください。わかりやすい日本語で話し、簡潔に（2〜3文）応答してください。',
  },
  {
    id: 'smalltalk_ja', emoji: '☕', title: '日常会話', desc: '일상 대화 & 친구 만들기',
    prompt: 'あなたは友好的な日本人です。初めて会った人（ユーザー）と自然な日常会話をしてください。趣味、仕事、旅行、食べ物など様々な話題で話し、温かく楽しい雰囲気で会話を進めてください。簡潔に（2〜3文）応答してください。',
  },
  {
    id: 'station_ja', emoji: '🚆', title: '駅・電車で', desc: '역에서 길 묻기',
    prompt: 'あなたは駅の案内係員です。旅行者（ユーザー）の電車の乗り方、路線の案内、切符の買い方などの質問に答えてください。丁寧でわかりやすい日本語で話し、簡潔に（2〜3文）応答してください。',
  },
  {
    id: 'shopping_ja', emoji: '🛍️', title: 'ショッピング', desc: '쇼핑몰에서 쇼핑하기',
    prompt: 'あなたはショッピングモールの店員です。お客様（ユーザー）の商品探しをお手伝いし、サイズ・色・在庫などの質問に答えてください。自然な接客日本語で話し、簡潔に（2〜3文）応答してください。',
  },
];

const BADGE_DEFS = [
  { id: 'first_session',  emoji: '🥉', label: '첫 대화 완료' },
  { id: 'ten_sessions',   emoji: '🥈', label: '10세션 달성'  },
  { id: 'fifty_sessions', emoji: '🥇', label: '50세션 달성'  },
  { id: 'zero_error',     emoji: '💎', label: '오류 제로 세션' },
];

// ── Supabase ──────────────────────────────────────────────────────────────────
let supa = null;

function initSupabase() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY && typeof window.supabase !== 'undefined') {
    supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}

// ── State ────────────────────────────────────────────────────────────────────
let userId     = null;
let activeSlot = 0;

const SLOT_AVATARS = ['🧑', '👩', '🧒', '👨'];
let activeLang = 'en';

// In-memory caches (loaded from Supabase at init)
let cachedProfile   = null;
let cachedSessions  = [];
let cachedFeedbacks = [];
let cachedBadges    = [];
let cachedStreak    = { lastStudyDate: null, currentStreak: 0 };

let messages       = [];
let isProcessing   = false;
let recognition    = null;
let isListening    = false;
let currentSession = null;
let activeRoleplay = null;

const ttsSupported = 'speechSynthesis' in window;
let ttsEnabled    = true;
let isTTSSpeaking = false;
let isTTSPaused   = false;
let lastAiBubble  = null;
let ttsKeepAlive  = null;

let showTranslation   = true;
let hideAiText        = false;
let feedbackGenCount  = 0;
let suggestionsEnabled = true;

let weeklyChartInst = null;
let errorChartInst  = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const chatEl    = document.getElementById('chatContainer');
const inputEl   = document.getElementById('userInput');
const micBtn    = document.getElementById('micBtn');
const micIcon   = document.getElementById('micIcon');
const stopIcon  = document.getElementById('stopIcon');
const sendBtn   = document.getElementById('sendBtn');
const clearBtn  = document.getElementById('clearBtn');

const voiceSelect = document.getElementById('voiceSelect');
const rateSlider  = document.getElementById('rateSlider');
const pitchSlider = document.getElementById('pitchSlider');
const rateVal     = document.getElementById('rateVal');
const pitchVal    = document.getElementById('pitchVal');
const pauseBtn    = document.getElementById('pauseBtn');
const stopTTSBtn  = document.getElementById('stopTTSBtn');
const autoPlayBtn = document.getElementById('autoPlayBtn');

const feedbackPanel     = document.getElementById('feedbackPanel');
const feedbackContent   = document.getElementById('feedbackContent');
const feedbackToggleBtn = document.getElementById('feedbackToggleBtn');

const goalFill  = document.getElementById('goalFill');
const goalLabel = document.getElementById('goalLabel');

// ── User ID (per slot) ────────────────────────────────────────────────────────
function getOrCreateUserIdForSlot(slot) {
  const key = `eai_uid_${slot}`;
  let id = localStorage.getItem(key);
  if (!id) {
    if (slot === 0) id = localStorage.getItem('eai_user_id'); // migrate legacy key
    if (!id) id = crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem(key, id);
  }
  return id;
}

// ── Slot display metadata ─────────────────────────────────────────────────────
function getSlotDisplay(slot) {
  try { return JSON.parse(localStorage.getItem(`eai_slot_display_${slot}`) || 'null'); }
  catch { return null; }
}

function updateSlotDisplay(slot, profile) {
  if (profile) localStorage.setItem(`eai_slot_display_${slot}`, JSON.stringify({ name: profile.name, level: profile.level }));
  else         localStorage.removeItem(`eai_slot_display_${slot}`);
}

// ── DB init ───────────────────────────────────────────────────────────────────
async function dbInit() {
  if (!supa) {
    // Offline fallback: load reviews from localStorage
    try { cachedReviews = JSON.parse(localStorage.getItem(`eai_reviews_${activeSlot}`) || '[]'); } catch { cachedReviews = []; }
    return;
  }

  const [pRes, sRes, fRes, bRes, stRes, mRes, rRes] = await Promise.allSettled([
    supa.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    supa.from('sessions').select('*').eq('user_id', userId),
    supa.from('feedbacks').select('*').eq('user_id', userId),
    supa.from('badges').select('*').eq('user_id', userId),
    supa.from('streaks').select('*').eq('user_id', userId).maybeSingle(),
    supa.from('chat_messages').select('*').eq('user_id', userId).order('timestamp', { ascending: true }),
    supa.from('reviews').select('*').eq('user_id', userId).order('added_at', { ascending: false }),
  ]);

  if (pRes.status === 'fulfilled' && pRes.value.data) {
    const d = pRes.value.data;
    cachedProfile = { name: d.name, level: d.level, goals: d.goals || [], dailyTarget: d.daily_target };
  }

  if (sRes.status === 'fulfilled' && sRes.value.data) {
    cachedSessions = sRes.value.data.map(r => ({
      sessionId: r.session_id, date: r.date, duration: r.duration,
      turnCount: r.turn_count, messages: r.messages || [], feedbacks: r.feedbacks || [],
    }));
  }

  if (fRes.status === 'fulfilled' && fRes.value.data) {
    cachedFeedbacks = fRes.value.data;
  }

  if (bRes.status === 'fulfilled' && bRes.value.data) {
    cachedBadges = bRes.value.data.map(r => ({ id: r.badge_id, earnedAt: r.earned_at }));
  }

  if (stRes.status === 'fulfilled' && stRes.value.data) {
    const d = stRes.value.data;
    cachedStreak = { lastStudyDate: d.last_study_date, currentStreak: d.current_streak };
  }

  if (mRes.status === 'fulfilled' && mRes.value.data) {
    messages = mRes.value.data.map(r => ({ role: r.role, content: r.content, timestamp: r.timestamp }));
  }

  if (rRes.status === 'fulfilled' && rRes.value.data) {
    cachedReviews = rRes.value.data.map(r => ({
      id: r.review_id, type: r.type, original: r.original,
      corrected: r.corrected, explanation: r.explanation,
      learned: r.learned, addedAt: r.added_at,
    }));
    // Migrate any localStorage reviews to Supabase (one-time migration)
    const legacyKey = `eai_reviews_${activeSlot}`;
    const legacyRaw = localStorage.getItem(legacyKey);
    if (legacyRaw && cachedReviews.length === 0) {
      try {
        const legacy = JSON.parse(legacyRaw);
        if (legacy.length > 0) {
          const rows = legacy.map(r => ({
            user_id: userId, review_id: r.id || genId(), type: r.type,
            original: r.original, corrected: r.corrected,
            explanation: r.explanation, learned: r.learned || false,
            added_at: r.addedAt || new Date().toISOString(),
          }));
          await supa.from('reviews').upsert(rows, { onConflict: 'user_id,review_id' });
          cachedReviews = legacy;
          localStorage.removeItem(legacyKey);
        }
      } catch (e) { console.error('review migration', e); }
    } else if (legacyRaw) {
      localStorage.removeItem(legacyKey); // already in Supabase, clean up
    }
  }
}

// ── Profile DB ────────────────────────────────────────────────────────────────
function getProfile() { return cachedProfile; }

function saveProfile(p) {
  cachedProfile = p;
  updateSlotDisplay(activeSlot, p);
  if (!supa) return;
  supa.from('profiles').upsert({
    user_id: userId, name: p.name, level: p.level, goals: p.goals,
    daily_target: p.dailyTarget, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' }).then(({ error }) => { if (error) console.error('saveProfile', error); });
}

// ── Sessions DB ───────────────────────────────────────────────────────────────
function getSessions() { return cachedSessions; }

function upsertSession(s) {
  const save = { ...s };
  delete save._startTime;
  const idx = cachedSessions.findIndex(x => x.sessionId === s.sessionId);
  if (idx >= 0) cachedSessions[idx] = save; else cachedSessions.push(save);
  if (!supa) return;
  supa.from('sessions').upsert({
    user_id: userId, session_id: save.sessionId, date: save.date,
    duration: save.duration, turn_count: save.turnCount,
    messages: save.messages, feedbacks: save.feedbacks,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'session_id' }).then(({ error }) => { if (error) console.error('upsertSession', error); });
}

async function deleteSession(id) {
  cachedSessions = cachedSessions.filter(s => s.sessionId !== id);
  if (!supa) return;
  await supa.from('sessions').delete().eq('session_id', id).eq('user_id', userId);
}

// ── Feedbacks DB ──────────────────────────────────────────────────────────────
function getFeedbackLog() { return cachedFeedbacks; }

function appendFeedbackLog(items) {
  cachedFeedbacks = [...cachedFeedbacks, ...items];
  if (!supa) return;
  supa.from('feedbacks').insert(items.map(item => ({
    user_id: userId, session_id: item.sessionId, date: item.date,
    original: item.original, corrected: item.corrected,
    type: item.type, explanation: item.explanation,
  }))).then(({ error }) => { if (error) console.error('appendFeedbackLog', error); });
}

// ── Review notes (Supabase, per user_id) ─────────────────────────────────────
let cachedReviews = [];

function getReviews() { return cachedReviews; }


function addReview(item) {
  if (cachedReviews.some(r => r.original === item.original && r.corrected === item.corrected)) return false;
  const newItem = { id: genId(), ...item, addedAt: new Date().toISOString(), learned: false };
  cachedReviews = [newItem, ...cachedReviews];
  if (supa) {
    supa.from('reviews').insert({
      user_id: userId, review_id: newItem.id, type: newItem.type,
      original: newItem.original, corrected: newItem.corrected,
      explanation: newItem.explanation, learned: false,
      added_at: newItem.addedAt,
    }).then(({ error }) => { if (error) console.error('addReview', error); });
  } else {
    try { localStorage.setItem(`eai_reviews_${activeSlot}`, JSON.stringify(cachedReviews)); } catch {}
  }
  return true;
}

function removeReview(id) {
  cachedReviews = cachedReviews.filter(r => r.id !== id);
  if (supa) {
    supa.from('reviews').delete().eq('review_id', id).eq('user_id', userId)
      .then(({ error }) => { if (error) console.error('removeReview', error); });
  } else {
    try { localStorage.setItem(`eai_reviews_${activeSlot}`, JSON.stringify(cachedReviews)); } catch {}
  }
}

function toggleReviewLearned(id) {
  cachedReviews = cachedReviews.map(r => r.id === id ? { ...r, learned: !r.learned } : r);
  const item = cachedReviews.find(r => r.id === id);
  if (supa && item) {
    supa.from('reviews').update({ learned: item.learned }).eq('review_id', id).eq('user_id', userId)
      .then(({ error }) => { if (error) console.error('toggleReviewLearned', error); });
  } else {
    try { localStorage.setItem(`eai_reviews_${activeSlot}`, JSON.stringify(cachedReviews)); } catch {}
  }
}

// ── Badges DB ─────────────────────────────────────────────────────────────────
function getBadges() { return cachedBadges; }

function insertNewBadges(newBadges) {
  if (!newBadges.length) return;
  cachedBadges = [...cachedBadges, ...newBadges];
  if (!supa) return;
  supa.from('badges').upsert(newBadges.map(b => ({
    user_id: userId, badge_id: b.id, earned_at: b.earnedAt,
  })), { onConflict: 'user_id,badge_id' }).then(({ error }) => { if (error) console.error('insertNewBadges', error); });
}

// ── Streak DB ─────────────────────────────────────────────────────────────────
function getStreak() { return cachedStreak; }

function saveStreak(s) {
  cachedStreak = s;
  if (!supa) return;
  supa.from('streaks').upsert({
    user_id: userId, last_study_date: s.lastStudyDate,
    current_streak: s.currentStreak, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' }).then(({ error }) => { if (error) console.error('saveStreak', error); });
}

// ── Chat messages DB ──────────────────────────────────────────────────────────
function saveMessage(msg) {
  if (!supa) return;
  supa.from('chat_messages').insert({
    user_id: userId, role: msg.role, content: msg.content, timestamp: msg.timestamp,
  }).then(({ error }) => { if (error) console.error('saveMessage', error); });
}

async function clearChatMessages() {
  if (!supa) return;
  const { error } = await supa.from('chat_messages').delete().eq('user_id', userId);
  if (error) console.error('clearChatMessages', error);
}

// ── Profile slot selector ─────────────────────────────────────────────────────
const LEVEL_LABELS = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

function renderProfileSlots() {
  const container = document.getElementById('profileSlotSelector');
  if (!container) return;
  container.innerHTML = `
    <div class="slot-selector">
      ${[0,1,2,3].map(slot => {
        const d = getSlotDisplay(slot);
        const isActive = slot === activeSlot;
        return `<button class="slot-card${isActive ? ' active' : ''}${!d ? ' empty' : ''}" data-slot="${slot}">
          <div class="slot-avatar">${d ? SLOT_AVATARS[slot] : '＋'}</div>
          <div class="slot-name">${d ? toHtml(d.name || 'Learner') : 'New Profile'}</div>
          ${d ? `<div class="slot-level">${LEVEL_LABELS[d.level] || d.level}</div>` : ''}
          ${isActive ? '<span class="slot-active-badge">Active</span>' : ''}
        </button>`;
      }).join('')}
    </div>
    <p class="slot-hint">Click another slot to switch profiles. Each profile has its own chat, stats, and review data.</p>`;

  container.querySelectorAll('.slot-card').forEach(card => {
    card.addEventListener('click', () => switchProfileSlot(parseInt(card.dataset.slot)));
  });
}

function updateHeaderProfile() {
  const el = document.getElementById('headerProfile');
  if (!el) return;
  const d = getSlotDisplay(activeSlot);
  el.textContent = d ? `${SLOT_AVATARS[activeSlot]} ${d.name || 'Learner'}` : '';
}

function setActiveLang(lang) {
  activeLang = lang;
  localStorage.setItem(`eai_lang_${activeSlot}`, lang);
  const cfg = LANG_CONFIG[lang];
  if (recognition) recognition.lang = cfg.sttLang;
  const inputEl = document.getElementById('userInput');
  if (inputEl) inputEl.placeholder = cfg.inputPlaceholder;
  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.textContent = `${cfg.flag} ${cfg.name}`;
  populateVoices();
  if (messages.length === 0) showWelcome();
  // sync profile form radio
  document.querySelectorAll('input[name="lang"]').forEach(el => { el.checked = el.value === lang; });
}

async function switchProfileSlot(slot) {
  if (slot === activeSlot) return;

  endSession();
  stopTTS();
  endRoleplay();

  activeSlot = slot;
  localStorage.setItem('eai_active_slot', String(slot));
  userId = getOrCreateUserIdForSlot(slot);

  cachedProfile   = null;
  cachedSessions  = [];
  cachedFeedbacks = [];
  cachedBadges    = [];
  cachedStreak    = { lastStudyDate: null, currentStreak: 0 };
  messages        = [];
  currentSession  = null;
  cachedReviews   = [];
  activeLang      = localStorage.getItem(`eai_lang_${slot}`) || 'en';

  await dbInit();

  chatEl.innerHTML = '';
  lastAiBubble = null;
  feedbackContent.innerHTML = `<div class="feedback-placeholder">${LANG_CONFIG[activeLang].feedbackPlaceholder}</div>`;
  setHideTextMode(false);
  updateGoalBar();
  updateHeaderProfile();
  setActiveLang(activeLang);

  if (messages.length === 0) showWelcome();
  else { messages.forEach(m => renderMessage(m.role, m.content, m.timestamp, false)); scrollBottom(); }

  if (!getProfile()) history.replaceState(null, '', '#/profile');
  router();
}

// ── Profile card ──────────────────────────────────────────────────────────────
function renderSavedProfileCard() {
  const section = document.getElementById('savedProfileSection');
  if (!section) return;
  const p = getProfile();
  if (!p) { section.innerHTML = ''; return; }

  const goalMap  = { daily: '일상 회화', business: '비즈니스 영어', travel: '여행', exam: '시험 준비' };
  const levelMap = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
  const goalsHtml = (p.goals || [])
    .map(g => `<span class="profile-tag">${goalMap[g] || g}</span>`).join('');

  section.innerHTML = `
    <div class="section-title" style="margin-top:0">저장된 프로필</div>
    <div class="profile-saved-card">
      <div class="profile-card-top">
        <div class="profile-card-avatar">👤</div>
        <div class="profile-card-info">
          <div class="profile-card-name">${toHtml(p.name || 'Learner')}</div>
          <span class="level-badge level-${p.level || 'intermediate'}">${levelMap[p.level || 'intermediate']}</span>
        </div>
        <div class="profile-card-btns">
          <button class="btn-sm btn-outline" id="editProfileCardBtn">편집</button>
          <button class="btn-sm btn-danger-sm" id="deleteProfileCardBtn">삭제</button>
        </div>
      </div>
      <div class="profile-card-body">
        <div class="profile-card-row">
          <span class="profile-card-key">학습 목표</span>
          <div class="profile-tags">${goalsHtml || '<span style="color:var(--muted);font-size:0.78rem">없음</span>'}</div>
        </div>
        <div class="profile-card-row">
          <span class="profile-card-key">일일 목표</span>
          <span class="profile-card-val">${p.dailyTarget || 10} turns/day</span>
        </div>
      </div>
    </div>
    <hr class="form-divider" style="margin: 24px 0 20px;">
    <div class="section-title">프로필 편집</div>`;

  document.getElementById('editProfileCardBtn').addEventListener('click', () => {
    const nameEl = document.getElementById('profileName');
    nameEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nameEl?.focus();
  });

  document.getElementById('deleteProfileCardBtn').addEventListener('click', deleteProfileData);
}

async function deleteProfileData() {
  if (!confirm('저장된 프로필을 삭제할까요?')) return;
  cachedProfile = null;
  updateSlotDisplay(activeSlot, null);
  if (supa) {
    const { error } = await supa.from('profiles').delete().eq('user_id', userId);
    if (error) console.error('deleteProfileData', error);
  }
  renderProfileSlots();
  renderSavedProfileCard();
  loadProfileForm();
  updateGoalBar();
  updateHeaderProfile();
}

// ── Profile helpers ───────────────────────────────────────────────────────────
const LEVEL_INSTRUCTIONS = {
  en: {
    beginner: `
LEARNER LEVEL: BEGINNER (A1-A2). You MUST follow these rules for every single response — no exceptions:
- Vocabulary: use only the most common 500-1000 words. Never use idioms, phrasal verbs, or advanced vocabulary.
- Sentence length: max 8 words per sentence. Short and simple always.
- Grammar: stick to present simple and past simple only. No conditionals, no passive voice.
- Response length: 1-2 sentences maximum.
- Questions: ask only one simple question. Use "Do you like...?", "What is your...?", "Did you...?" patterns.
- If the learner makes a clear grammar mistake, add one gentle correction in parentheses: (Tip: say "I went" not "I go").
- Tone: extremely warm, patient, encouraging. Celebrate every message.`,
    intermediate: `
LEARNER LEVEL: INTERMEDIATE (B1-B2). Follow these rules for every response:
- Vocabulary: use natural everyday English. Introduce 1 useful new word or phrase per response and use it naturally in context.
- Sentence length: 1-2 sentences of moderate complexity (up to 15 words each).
- Grammar: use a natural mix of tenses including present perfect and conditionals where appropriate.
- Response length: 2-3 sentences.
- Questions: ask one meaningful open-ended question that encourages the learner to speak more.
- Occasionally introduce a natural expression: "By the way, we often say '...' in this situation."
- Tone: friendly, natural, gently challenging.`,
    advanced: `
LEARNER LEVEL: ADVANCED (C1-C2). Follow these rules for every response:
- Vocabulary: use rich, sophisticated vocabulary. Include idioms, phrasal verbs, collocations, and nuanced expressions freely.
- Sentence length and structure: use complex, varied sentence structures. Mix clause types naturally.
- Grammar: use any tense or mood appropriate to the context, including subjunctive, mixed conditionals, inversion.
- Response length: 3-4 substantive sentences.
- Questions: challenge the learner with thought-provoking questions requiring detailed, nuanced answers.
- Treat the learner as near-native: no simplification, no hand-holding.
- Occasionally reference culture, humor, sarcasm, or subtle nuance to push toward true fluency.`,
  },
  ja: {
    beginner: `
学習者のレベル: 初級 (N5-N4相当)。全ての返答で以下のルールを厳守してください:
- 語彙: ひらがな・カタカナと最基本漢字のみ使用。難しい漢字には必ずふりがなを付ける。
- 文の長さ: 1文は最大8語以内。短く簡単に。
- 文法: です・ます体のみ。〜て形、〜ない形の基本のみ。
- 返答の長さ: 1-2文のみ。
- 質問: 「〜が好きですか？」「〜は何ですか？」など単純な質問1つだけ。
- 誤りがあれば丁寧に括弧内で訂正: (「〜ました」と言いましょう)
- トーン: 非常に温かく、辛抱強く、励ます。`,
    intermediate: `
学習者のレベル: 中級 (N3-N2相当)。全ての返答で以下のルールに従ってください:
- 語彙: 日常的な語彙を使い、1返答につき1つの新しい表現を自然に導入する。
- 文の長さ: 適度な複雑さの文を1-2文。
- 文法: て形、たら・ば条件形、〜んです、〜てしまうなど中級文法を自然に使う。
- 返答の長さ: 2-3文。
- 質問: 学習者が多く話せるよう、意味のある質問を1つ。
- トーン: 自然で親しみやすく、適度にチャレンジング。`,
    advanced: `
学習者のレベル: 上級 (N1相当)。全ての返答で以下のルールに従ってください:
- 語彙: 豊かで洗練された語彙。慣用句、敬語、ビジネス表現を自由に使う。
- 文の長さと構造: 複雑で多様な文構造。
- 文法: あらゆる文法形式、敬語体系を文脈に応じて使用。
- 返答の長さ: 3-4文の充実した内容。
- 質問: 詳細で微妙な回答を必要とする深い質問。
- 簡略化や手取り足取りの説明は不要。ネイティブに近い扱い。`,
  },
};

function buildSystemPrompt() {
  const p     = getProfile();
  const level = p?.level || 'intermediate';
  const base  = activeRoleplay
    ? activeRoleplay.prompt + ' Continue the roleplay naturally after each user message.'
    : LANG_CONFIG[activeLang].systemPrompt;

  const levelInstruction = (LEVEL_INSTRUCTIONS[activeLang] || LEVEL_INSTRUCTIONS.en)[level] || '';

  if (!p) return base + levelInstruction;

  const goalMap = { daily: 'daily conversation', business: 'business English', travel: 'travel English', exam: 'exam preparation' };
  const goals   = (p.goals || []).map(g => goalMap[g] || g).join(', ') || 'general';
  return base + levelInstruction + `\nLearner's goals: ${goals}.`;
}

// ── Session lifecycle ─────────────────────────────────────────────────────────
function genId() {
  return crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function startSession() {
  currentSession = {
    sessionId: genId(),
    date: new Date().toISOString(),
    _startTime: Date.now(),
    duration: 0,
    turnCount: 0,
    messages: [],
    feedbacks: [],
  };
}

function endSession() {
  if (!currentSession) return;
  currentSession.duration = Math.floor((Date.now() - currentSession._startTime) / 1000);
  upsertSession(currentSession);
  checkAndAwardBadges();
  currentSession = null;
}

function addSessionTurn(userContent, aiContent, userTs, aiTs) {
  if (!currentSession) return;
  currentSession.messages.push(
    { role: 'user',      content: userContent, timestamp: userTs },
    { role: 'assistant', content: aiContent,   timestamp: aiTs  }
  );
  currentSession.turnCount++;
  currentSession.duration = Math.floor((Date.now() - currentSession._startTime) / 1000);
  upsertSession(currentSession);
}

function addSessionFeedbacks(items) {
  if (!currentSession) return;
  currentSession.feedbacks.push(...items);
  upsertSession(currentSession);
}

// ── Streak & badges ───────────────────────────────────────────────────────────
function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function updateStreak() {
  const today  = localDateStr();
  const streak = getStreak();
  if (!streak.lastStudyDate) { saveStreak({ lastStudyDate: today, currentStreak: 1 }); return; }
  const diff = Math.round((new Date(today) - new Date(streak.lastStudyDate)) / 86400000);
  if (diff === 0) return;
  if (diff === 1) saveStreak({ lastStudyDate: today, currentStreak: streak.currentStreak + 1 });
  else            saveStreak({ lastStudyDate: today, currentStreak: 1 });
}

function checkAndAwardBadges() {
  const sessions = getSessions();
  const earned   = new Set(getBadges().map(b => b.id));
  const newBadges = [];

  const chk = (id, cond) => {
    if (!earned.has(id) && cond) { newBadges.push({ id, earnedAt: new Date().toISOString() }); earned.add(id); }
  };

  chk('first_session',  sessions.length >= 1);
  chk('ten_sessions',   sessions.length >= 10);
  chk('fifty_sessions', sessions.length >= 50);
  chk('zero_error',     sessions.some(s => s.turnCount > 0 && (!s.feedbacks || s.feedbacks.length === 0)));

  if (newBadges.length) {
    insertNewBadges(newBadges);
    newBadges.forEach(showBadgeToast);
  }
}

function showBadgeToast(badge) {
  const def = BADGE_DEFS.find(d => d.id === badge.id);
  if (!def) return;
  const el = document.createElement('div');
  el.className = 'badge-toast';
  el.innerHTML = `${def.emoji} <strong>Badge earned!</strong> ${def.label}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3500);
}

// ── Goal bar ──────────────────────────────────────────────────────────────────
function getDailyTurnCount() {
  const today = localDateStr();
  return getSessions()
    .filter(s => (s.date || '').startsWith(today))
    .reduce((sum, s) => sum + (s.turnCount || 0), 0);
}

function updateGoalBar() {
  if (!goalFill || !goalLabel) return;
  const target  = getProfile()?.dailyTarget || 10;
  const current = getDailyTurnCount();
  const pct     = Math.min(100, Math.round((current / target) * 100));
  goalFill.style.width = pct + '%';
  goalFill.className   = 'goal-fill' + (pct >= 100 ? ' done' : '');
  goalLabel.textContent = `Today: ${current} / ${target} turns`;
}

function showGoalAchievedToast() {
  const el = document.createElement('div');
  el.className = 'goal-toast';
  el.textContent = "🎉 Today's goal achieved!";
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3500);
}

// ── Render helpers ────────────────────────────────────────────────────────────
function toHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' });
}

function fmtDuration(sec) {
  if (!sec || sec < 1) return '0s';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function scrollBottom() { chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' }); }
function clearWelcome() { chatEl.querySelector('.welcome')?.remove(); }

function renderMessage(role, content, timestamp, animate = true) {
  clearWelcome();
  const cssRole = role === 'assistant' ? 'ai' : 'user';
  const el = document.createElement('div');
  el.className = `msg ${cssRole}`;
  if (!animate) el.style.animation = 'none';

  const bubbleEl = document.createElement('div');
  bubbleEl.className = 'bubble';
  bubbleEl.innerHTML = toHtml(content);

  const footerEl = document.createElement('div');
  footerEl.className = 'msg-footer';

  if (role === 'assistant') {
    const replayBtn = document.createElement('button');
    replayBtn.className = 'btn-replay';
    replayBtn.title = '다시 듣기';
    replayBtn.textContent = '🔊';
    replayBtn.addEventListener('click', () => speak(content, bubbleEl));
    footerEl.appendChild(replayBtn);

    if (hideAiText) {
      bubbleEl.classList.add('text-hidden');
      attachRevealOnClick(bubbleEl);
    }
  }

  const tsEl = document.createElement('time');
  tsEl.className = 'ts';
  tsEl.textContent = fmtTime(timestamp);
  footerEl.appendChild(tsEl);

  el.appendChild(bubbleEl);
  el.appendChild(footerEl);
  chatEl.appendChild(el);
  return el;
}

let loadingEl = null;
function showLoading() {
  hideLoading();
  loadingEl = document.createElement('div');
  loadingEl.className = 'msg ai';
  loadingEl.innerHTML = '<div class="bubble dots"><span></span><span></span><span></span></div>';
  chatEl.appendChild(loadingEl);
  scrollBottom();
}
function hideLoading() { loadingEl?.remove(); loadingEl = null; }

function showError(msg) {
  const el = document.createElement('div');
  el.className = 'error-toast';
  el.textContent = msg;
  chatEl.appendChild(el);
  scrollBottom();
  setTimeout(() => el.remove(), 6000);
}

let interimEl = null;
function showInterim(text) {
  if (!interimEl) { interimEl = document.createElement('div'); interimEl.className = 'interim'; chatEl.appendChild(interimEl); }
  interimEl.textContent = text;
  scrollBottom();
}
function hideInterim() { interimEl?.remove(); interimEl = null; }

// ── SSE ───────────────────────────────────────────────────────────────────────
function parseSSE(chunk) {
  const tokens = [];
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice(6).trim();
    if (raw === '[DONE]') continue;
    try { const tok = JSON.parse(raw).choices?.[0]?.delta?.content; if (tok) tokens.push(tok); } catch {}
  }
  return tokens;
}

// ── TTS ───────────────────────────────────────────────────────────────────────
function wrapWordsForHighlight(text) {
  let html = '', i = 0;
  const rx = /\S+/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    if (m.index > i)
      html += text.slice(i, m.index).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    html += `<span class="tts-word" data-start="${m.index}">${m[0].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`;
    i = rx.lastIndex;
  }
  if (i < text.length)
    html += text.slice(i).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  return html;
}

function getSelectedVoice() {
  const name = voiceSelect?.value;
  return name ? speechSynthesis.getVoices().find(v => v.name === name) || null : null;
}

function updateTTSBtnState() {
  if (!ttsSupported) return;
  pauseBtn.disabled   = !isTTSSpeaking;
  stopTTSBtn.disabled = !isTTSSpeaking;
  pauseBtn.textContent = isTTSPaused ? '▶' : '⏸';
}

function stopTTS() {
  if (!ttsSupported) return;
  clearInterval(ttsKeepAlive); ttsKeepAlive = null;
  if (isTTSSpeaking || isTTSPaused) speechSynthesis.cancel();
  isTTSSpeaking = false; isTTSPaused = false;
  updateTTSBtnState();
  lastAiBubble?.querySelectorAll('.tts-word.active').forEach(s => s.classList.remove('active'));
}

function stripEmoji(text) {
  return text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').replace(/\s+/g, ' ').trim();
}

function speak(text, bubbleEl) {
  if (!ttsSupported || !ttsEnabled) return;
  stopTTS();
  const stripped = stripEmoji(text);
  const utter    = new SpeechSynthesisUtterance(stripped);
  const voice    = getSelectedVoice();
  if (voice) utter.voice = voice;
  utter.rate  = parseFloat(rateSlider?.value ?? '1');
  utter.pitch = parseFloat(pitchSlider?.value ?? '1');
  utter.lang  = LANG_CONFIG[activeLang].ttsLang;
  // Use stripped text for span positions so charIndex aligns with utterance
  bubbleEl.innerHTML = wrapWordsForHighlight(stripped);
  utter.onstart = () => {
    isTTSSpeaking = true; isTTSPaused = false; updateTTSBtnState();
    // Chrome pauses TTS after ~15s — keep it alive
    ttsKeepAlive = setInterval(() => {
      if (speechSynthesis.speaking && !isTTSPaused) {
        speechSynthesis.pause(); speechSynthesis.resume();
      }
    }, 14000);
  };
  utter.onboundary = (e) => {
    if (e.name !== 'word') return;
    bubbleEl.querySelectorAll('.tts-word.active').forEach(s => s.classList.remove('active'));
    bubbleEl.querySelector(`.tts-word[data-start="${e.charIndex}"]`)?.classList.add('active');
  };
  utter.onend = utter.onerror = () => {
    clearInterval(ttsKeepAlive); ttsKeepAlive = null;
    isTTSSpeaking = false; isTTSPaused = false; updateTTSBtnState();
    bubbleEl.querySelectorAll('.tts-word.active').forEach(s => s.classList.remove('active'));
  };
  speechSynthesis.speak(utter);
}

function populateVoices() {
  if (!ttsSupported) return;
  const langCode = LANG_CONFIG[activeLang].ttsLang;
  const prefix   = langCode.split('-')[0];
  const all      = speechSynthesis.getVoices();
  const voices   = all.filter(v => v.lang.startsWith(prefix));
  if (!voices.length) return;
  const prev = voiceSelect.value;
  voiceSelect.innerHTML = '';
  voices.forEach(v => {
    const o = document.createElement('option');
    o.value = v.name; o.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(o);
  });
  const prevOpt = Array.from(voiceSelect.options).find(o => o.value === prev);
  if (prevOpt) { voiceSelect.value = prev; }
  else {
    const pref = voices.find(v => v.lang === langCode) || voices[0];
    if (pref) voiceSelect.value = pref.name;
  }
}

function setupTTS() {
  if (!ttsSupported) { document.querySelector('.tts-bar')?.remove(); return; }
  populateVoices();
  speechSynthesis.onvoiceschanged = populateVoices;
  rateSlider.addEventListener('input', () => { rateVal.textContent = parseFloat(rateSlider.value).toFixed(1) + '×'; });
  pitchSlider.addEventListener('input', () => { pitchVal.textContent = parseFloat(pitchSlider.value).toFixed(1); });
  pauseBtn.addEventListener('click', () => {
    if (!isTTSSpeaking) return;
    if (isTTSPaused) { speechSynthesis.resume(); isTTSPaused = false; }
    else             { speechSynthesis.pause();  isTTSPaused = true;  }
    updateTTSBtnState();
  });
  stopTTSBtn.addEventListener('click', stopTTS);
  autoPlayBtn.addEventListener('click', () => {
    ttsEnabled = !ttsEnabled;
    autoPlayBtn.classList.toggle('active', ttsEnabled);
    autoPlayBtn.setAttribute('aria-pressed', String(ttsEnabled));
    autoPlayBtn.textContent = ttsEnabled ? '🔊 Auto ON' : '🔇 Auto OFF';
    if (!ttsEnabled) stopTTS();
  });
}

// ── Feedback API ──────────────────────────────────────────────────────────────
function parseJSONFromText(text) {
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr   = codeMatch ? codeMatch[1].trim() : text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonStr) throw new Error('No JSON');
  return JSON.parse(jsonStr);
}

async function doFeedbackFetch(model, apiMsgs) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ model, messages: apiMsgs, stream: false, max_tokens: 350 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: res.status });
    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty');
    return parseJSONFromText(content);
  } finally { clearTimeout(timer); }
}

function buildFeedbackPrompt() {
  const base  = LANG_CONFIG[activeLang].feedbackPrompt;
  const level = getProfile()?.level || 'intermediate';
  const levelNote = {
    beginner:     'IMPORTANT: The learner is a BEGINNER. Only flag 1-2 major errors maximum. Ignore minor stylistic issues. Keep all explanations extremely simple and encouraging. The overallFeedback must be very warm and motivating.',
    intermediate: 'The learner is INTERMEDIATE. Flag clear grammar errors and unnatural expressions. Explanations can be moderately detailed.',
    advanced:     'The learner is ADVANCED. Be thorough — point out subtle unnatural phrasing, word choice issues, register mismatches, and stylistic improvements even if the sentence is technically correct. Treat them as a near-native learner.',
  };
  const koreanReminder = activeLang === 'ja'
    ? '\nReminder: ALL explanation and overallFeedback text MUST be written in Korean (한국어). Do not use Japanese in those fields.'
    : '';
  return base + '\n\n' + (levelNote[level] || levelNote.intermediate) + koreanReminder;
}

async function callFeedback(text) {
  const msgs = [{ role: 'system', content: buildFeedbackPrompt() }, { role: 'user', content: text }];
  const rateLimited = e => e.status === 429 || e.status === 503 || e.status === 404;
  try { return await doFeedbackFetch(GEMMA_MODEL, msgs); }
  catch (e) {
    if (!rateLimited(e)) throw e;
    await sleep(1500);
    try { return await doFeedbackFetch(GEMMA_MODEL, msgs); }
    catch (e2) {
      if (!rateLimited(e2)) throw e2;
      await sleep(1000);
      return doFeedbackFetch(FALLBACK_MODEL, msgs);
    }
  }
}

// ── Translation API ───────────────────────────────────────────────────────────
async function doTextFetch(model, apiMsgs, maxTokens = 300) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ model, messages: apiMsgs, stream: false, max_tokens: maxTokens }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: res.status });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } finally { clearTimeout(timer); }
}

function cleanTranslation(raw) {
  if (!raw) return null;
  let t = raw.trim();
  // strip markdown code blocks
  t = t.replace(/```[\s\S]*?```/g, '').trim();
  // strip common prefixes models add despite instructions
  t = t.replace(/^(Korean\s*(translation|번역)\s*[:：]?\s*)/i, '');
  t = t.replace(/^(번역\s*[:：]?\s*)/i, '');
  t = t.replace(/^["「『]|["」』]$/g, '').trim();
  // if result is empty or still looks like English, discard
  if (!t || /^[a-zA-Z\s.,!?'"()-]{10,}$/.test(t)) return null;
  return t;
}

async function callTranslation(text) {
  const srcLang = activeLang === 'ja' ? 'Japanese' : 'English';
  const systemMsg =
    `You are a professional translator. Translate the user's ${srcLang} message into natural Korean.\n` +
    `Rules:\n` +
    `- Output ONLY the Korean translation. Nothing else.\n` +
    `- Do NOT include the original text.\n` +
    `- Do NOT add labels like "Translation:" or "번역:".\n` +
    `- Do NOT add explanations or notes.`;
  const msgs = [
    { role: 'system', content: systemMsg },
    { role: 'user', content: text },
  ];
  const rateLimited = e => e.status === 429 || e.status === 503 || e.status === 404;
  const tryFetch = async (model) => cleanTranslation(await doTextFetch(model, msgs, 250));

  try { return await tryFetch(PRIMARY_MODEL); }
  catch (e) {
    if (!rateLimited(e)) return null;
    await sleep(1500);
    try { return await tryFetch(PRIMARY_MODEL); }
    catch (e2) {
      if (!rateLimited(e2)) return null;
      return tryFetch(FALLBACK_MODEL).catch(() => null);
    }
  }
}

// ── Suggestions ───────────────────────────────────────────────────────────────
function parseSuggestions(raw) {
  if (!raw) return [];
  // 1) try strict JSON array
  const arrMatch = raw.match(/\[[\s\S]*?\]/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0]);
      if (Array.isArray(arr) && arr.length) return arr.slice(0, 3).map(s => String(s).trim()).filter(Boolean);
    } catch {}
  }
  // 2) fallback: extract quoted strings
  const quoted = [...raw.matchAll(/"([^"]{3,80})"/g)].map(m => m[1].trim()).filter(Boolean);
  if (quoted.length >= 2) return quoted.slice(0, 3);
  // 3) fallback: numbered / bulleted lines
  const lines = raw.split('\n')
    .map(l => l.replace(/^[\s\d.)\-*•]+/, '').replace(/^["']|["']$/g, '').trim())
    .filter(l => l.length > 3 && l.length < 100);
  return lines.slice(0, 3);
}

async function callSuggestions(conversationContext) {
  const lang = activeLang === 'ja' ? 'Japanese' : 'English';
  const level = getProfile()?.level || 'intermediate';
  const prompt =
    `You are a language learning assistant. Look at the conversation and output exactly 3 short ${lang} sentences the ${level}-level learner could say next.\n` +
    `STRICT RULES:\n` +
    `- Each sentence must be under 12 words\n` +
    `- Output ONLY a valid JSON array. No other text, no markdown, no numbering.\n` +
    `- Format: ["sentence one","sentence two","sentence three"]`;
  const msgs = [
    { role: 'system', content: prompt },
    ...conversationContext.slice(-4),
    { role: 'user', content: 'Give me 3 response suggestions as a JSON array.' },
  ];
  const rateLimited = e => e.status === 429 || e.status === 503 || e.status === 404;
  const tryFetch = model => doTextFetch(model, msgs, 200);

  try { return await tryFetch(PRIMARY_MODEL); }
  catch (e) {
    if (!rateLimited(e)) return null;
    await sleep(1500);
    try { return await tryFetch(PRIMARY_MODEL); }
    catch (e2) {
      if (!rateLimited(e2)) return null;
      return tryFetch(FALLBACK_MODEL).catch(() => null);
    }
  }
}

function showSuggestionsLoading() {
  const bar = document.getElementById('suggestionBar');
  if (!bar || !suggestionsEnabled) return;
  bar.innerHTML = '<span class="suggestion-label">💡</span><div class="suggestion-loading"><span></span><span></span><span></span></div>';
  bar.classList.remove('hidden');
}

function renderSuggestions(suggestions) {
  const bar = document.getElementById('suggestionBar');
  if (!bar) return;
  if (!suggestionsEnabled || !suggestions?.length) { bar.classList.add('hidden'); return; }
  bar.innerHTML = '<span class="suggestion-label">💡 추천:</span>';
  suggestions.forEach(text => {
    const chip = document.createElement('button');
    chip.className = 'suggestion-chip';
    chip.title = text;
    chip.textContent = text;
    chip.addEventListener('click', () => {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input'));
      inputEl.focus();
      bar.classList.add('hidden');
    });
    bar.appendChild(chip);
  });
  bar.classList.remove('hidden');
}

function hideSuggestions() {
  const bar = document.getElementById('suggestionBar');
  if (bar) bar.classList.add('hidden');
}

function setSuggestionsEnabled(on) {
  suggestionsEnabled = on;
  const btn = document.getElementById('suggestBtn');
  if (btn) {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '💡 추천 ON' : '💡 추천 OFF';
  }
  if (!on) hideSuggestions();
}

// ── Feedback UI ───────────────────────────────────────────────────────────────
function showFeedbackLoading() {
  feedbackContent.innerHTML = '<div class="feedback-loading"><span></span><span></span><span></span></div>';
}

function renderFeedback(data) {
  feedbackContent.innerHTML = '';
  if (window.innerWidth <= 600) {
    feedbackPanel.classList.remove('collapsed');
    feedbackToggleBtn.setAttribute('aria-expanded', 'true');
    feedbackToggleBtn.textContent = '▾';
  }
  if (!data.hasIssues || !Array.isArray(data.corrections) || !data.corrections.length) {
    feedbackContent.innerHTML = `<div class="feedback-success">✅ ${toHtml(data.overallFeedback || 'Great job! Your English is natural.')}</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  data.corrections.forEach(c => {
    const type = ['grammar','expression','vocabulary'].includes(c.type) ? c.type : 'grammar';
    const card = document.createElement('div');
    card.className = 'feedback-card';
    card.innerHTML = `
      <div class="feedback-card-header">
        <span class="badge badge-${type}">${type}</span>
        <div class="feedback-card-actions">
          <button class="btn-review-add" title="Add to Review">📌 Review</button>
          <button class="btn-feedback-card-toggle" aria-expanded="false">▾</button>
        </div>
      </div>
      <div class="feedback-change">
        <span class="original">${toHtml(c.original||'')}</span>
        <span class="arrow">→</span>
        <span class="corrected">${toHtml(c.corrected||'')}</span>
      </div>
      <div class="feedback-detail" hidden>${toHtml(c.explanation||'')}</div>`;
    card.querySelector('.btn-feedback-card-toggle').addEventListener('click', () => {
      const det = card.querySelector('.feedback-detail');
      const btn = card.querySelector('.btn-feedback-card-toggle');
      const open = !det.hidden;
      det.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
      btn.textContent = open ? '▾' : '▴';
    });
    card.querySelector('.btn-review-add').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const added = addReview({ type, original: c.original||'', corrected: c.corrected||'', explanation: c.explanation||'' });
      btn.textContent = added ? '✅ Added' : '✅ Already added';
      btn.disabled = true;
    });
    frag.appendChild(card);
  });
  if (data.overallFeedback) {
    const ov = document.createElement('div');
    ov.className = 'feedback-overall';
    ov.textContent = data.overallFeedback;
    frag.appendChild(ov);
  }
  feedbackContent.appendChild(frag);
}

// ── Streaming fetch ───────────────────────────────────────────────────────────
async function fetchStream(apiMessages, model) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ model, messages: apiMessages, stream: true, max_tokens: 300 }),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw Object.assign(new Error(`API ${res.status}`), { status: res.status });

  hideLoading();
  clearWelcome();

  const ts       = new Date().toISOString();
  const msgEl    = document.createElement('div'); msgEl.className = 'msg ai';
  const bubbleEl = document.createElement('div'); bubbleEl.className = 'bubble streaming';
  const footerEl = document.createElement('div'); footerEl.className = 'msg-footer';
  const tsEl     = document.createElement('time'); tsEl.className = 'ts'; tsEl.textContent = fmtTime(ts);
  footerEl.appendChild(tsEl);
  msgEl.appendChild(bubbleEl); msgEl.appendChild(footerEl);
  chatEl.appendChild(msgEl);
  lastAiBubble = bubbleEl;

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText  = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const tok of parseSSE(decoder.decode(value, { stream: true }))) {
      fullText += tok;
      bubbleEl.innerHTML = toHtml(fullText);
      scrollBottom();
    }
  }
  bubbleEl.classList.remove('streaming');
  if (!fullText.trim()) { msgEl.remove(); lastAiBubble = null; throw new Error('Empty response'); }

  const replayBtn = document.createElement('button');
  replayBtn.className = 'btn-replay';
  replayBtn.title = '다시 듣기';
  replayBtn.textContent = '🔊';
  replayBtn.addEventListener('click', () => speak(fullText, bubbleEl));
  footerEl.prepend(replayBtn);

  if (hideAiText) {
    bubbleEl.classList.add('text-hidden');
    attachRevealOnClick(bubbleEl);
  }

  return fullText;
}

async function callAI(apiMessages) {
  const rateLimited = e => e.status === 429 || e.status === 503 || e.status === 404;
  try {
    return await fetchStream(apiMessages, PRIMARY_MODEL);
  } catch (e1) {
    if (!rateLimited(e1)) throw e1;
    // 1.5s backoff then retry primary
    await sleep(1500); showLoading();
    try {
      return await fetchStream(apiMessages, PRIMARY_MODEL);
    } catch (e2) {
      if (!rateLimited(e2)) throw e2;
      // try first fallback
      await sleep(1000); showLoading();
      try {
        return await fetchStream(apiMessages, FALLBACK_MODEL);
      } catch (e3) {
        if (!rateLimited(e3)) throw e3;
        // last resort
        await sleep(1000); showLoading();
        return fetchStream(apiMessages, EXTRA_FALLBACK_MODEL);
      }
    }
  }
}

// ── PII detection ────────────────────────────────────────────────────────────
const PII_PATTERNS = [
  { label: '이메일 주소',      pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/ },
  { label: '전화번호',         pattern: /\b(?:010|011|016|017|018|019)[-.\s]?\d{3,4}[-.\s]?\d{4}\b/ },
  { label: '국제 전화번호',    pattern: /(?<!\d)\+\d{1,3}[-\s]?\(?\d{1,4}\)?[-\s]?\d{3,4}[-\s]?\d{3,4}\b/ },
  { label: '주민등록번호',     pattern: /\b\d{6}-[1-4]\d{6}\b/ },
  { label: '신용·체크카드 번호', pattern: /\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/ },
];

function detectPII(text) {
  return PII_PATTERNS
    .filter(({ pattern }) => { pattern.lastIndex = 0; return pattern.test(text); })
    .map(({ label }) => label);
}

function showPrivacyWarning(piiLabels) {
  const existing = chatEl.querySelector('.privacy-warning');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'privacy-warning';
  el.innerHTML =
    `<span class="privacy-warning-icon">🔒</span>` +
    `<div class="privacy-warning-body">` +
      `<strong>개인정보 감지 — 전송 차단됨</strong>` +
      `<p>${piiLabels.join(', ')}이(가) 포함되어 있습니다.<br>` +
      `무료 AI 모델은 입력 데이터를 학습에 활용할 수 있으므로 개인정보 입력을 삼가 주세요.</p>` +
    `</div>`;
  chatEl.appendChild(el);
  scrollBottom();
  setTimeout(() => el.remove(), 8000);
}

// ── Send message ──────────────────────────────────────────────────────────────
async function sendMessage(rawText) {
  const text = rawText.trim();
  if (!text || isProcessing) return;

  const piiFound = detectPII(text);
  if (piiFound.length > 0) {
    showPrivacyWarning(piiFound);
    return; // 입력값은 그대로 유지
  }

  isProcessing = true;
  sendBtn.disabled = true;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  hideSuggestions();

  if (!currentSession) startSession();

  const ts = new Date().toISOString();
  messages.push({ role: 'user', content: text, timestamp: ts });
  renderMessage('user', text, ts);
  saveMessage({ role: 'user', content: text, timestamp: ts });
  scrollBottom();

  // Send only the last 12 messages (6 turns) to reduce token load
  const context = messages.slice(-12).map(m => ({ role: m.role, content: m.content }));
  const apiMessages = [{ role: 'system', content: buildSystemPrompt() }, ...context];

  showLoading();
  showFeedbackLoading();

  feedbackGenCount++;
  const myGen     = feedbackGenCount;
  const sessionId = currentSession.sessionId;
  const prevTurns = getDailyTurnCount();

  let translationEl = null;

  try {
    const aiText = await callAI(apiMessages);
    const aiTs   = new Date().toISOString();

    // Attach translation placeholder to the AI message element
    const capturedBubble = lastAiBubble;
    if (capturedBubble?.parentElement) {
      translationEl = document.createElement('div');
      translationEl.className = 'msg-translation';
      if (!showTranslation) translationEl.classList.add('hidden');
      translationEl.innerHTML = '<span class="translation-dots"><span></span><span></span><span></span></span>';
      capturedBubble.parentElement.appendChild(translationEl);
    }

    messages.push({ role: 'assistant', content: aiText, timestamp: aiTs });
    saveMessage({ role: 'assistant', content: aiText, timestamp: aiTs });

    addSessionTurn(text, aiText, ts, aiTs);
    updateStreak();
    checkAndAwardBadges();

    const newTurns = getDailyTurnCount();
    const target   = getProfile()?.dailyTarget || 10;
    if (prevTurns < target && newTurns >= target) showGoalAchievedToast();
    updateGoalBar();

    if (ttsEnabled && ttsSupported && lastAiBubble) speak(aiText, lastAiBubble);

    // Fire translation first (non-blocking)
    callTranslation(aiText).then(translated => {
      if (!translationEl?.isConnected) return;
      if (translated) {
        translationEl.innerHTML = `<span class="translation-label">🇰🇷</span><span class="translation-text">${toHtml(translated)}</span>`;
      } else {
        translationEl.remove();
        translationEl = null;
      }
    }).catch(() => { translationEl?.remove(); translationEl = null; });

    // Stagger suggestions 800ms after translation to avoid simultaneous hits
    if (suggestionsEnabled) {
      showSuggestionsLoading();
      const suggContext = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));
      sleep(800)
        .then(() => callSuggestions(suggContext))
        .then(raw => {
          if (!suggestionsEnabled) return;
          const suggestions = parseSuggestions(raw);
          if (suggestions.length) renderSuggestions(suggestions);
          else hideSuggestions();
        })
        .catch(() => hideSuggestions());
    }

  } catch (err) {
    hideLoading();
    let msg = '⚠️ 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
    if (err.status === 429) msg = '⚠️ AI 응답 한도 초과입니다. 잠시 후 다시 시도해 주세요.';
    if (err.status === 401) msg = USE_PROXY ? '⚠️ 서버 설정 오류입니다. Vercel 환경변수를 확인해 주세요.' : '⚠️ API 키가 올바르지 않습니다.';
    showError(msg);
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    scrollBottom();
  }

  // Feedback runs AFTER AI responds (sequential, not parallel) to reduce rate limit pressure
  if (myGen !== feedbackGenCount) return; // superseded by a newer send
  const feedbackData = await callFeedback(text).catch(() => null);
  if (myGen !== feedbackGenCount) return;
  if (feedbackData) {
    renderFeedback(feedbackData);
    if (feedbackData.corrections?.length) {
      const items = feedbackData.corrections.map(c => ({
        date: new Date().toISOString(), sessionId,
        original: c.original, corrected: c.corrected,
        type: c.type, explanation: c.explanation,
      }));
      appendFeedbackLog(items);
      addSessionFeedbacks(items);
    }
  } else {
    feedbackContent.innerHTML = '<div class="feedback-placeholder">Feedback unavailable.</div>';
  }
}

// ── Router ────────────────────────────────────────────────────────────────────
// ── Hide text mode ────────────────────────────────────────────────────────────
function attachRevealOnClick(bubbleEl) {
  if (bubbleEl.dataset.revealBound) return;
  bubbleEl.dataset.revealBound = '1';
  bubbleEl.addEventListener('click', () => {
    if (bubbleEl.classList.contains('text-hidden')) {
      bubbleEl.classList.remove('text-hidden');
    }
  });
}

function setHideTextMode(on) {
  hideAiText = on;
  document.querySelectorAll('.msg.ai .bubble').forEach(b => {
    b.classList.toggle('text-hidden', on);
    if (on) attachRevealOnClick(b);
  });
  const btn = document.getElementById('hideTextBtn');
  if (btn) {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '🙈 가리기 ON' : '👁 가리기 OFF';
  }
}

// ── Roleplay ──────────────────────────────────────────────────────────────────
function openRoleplayModal() {
  const scenarios = activeLang === 'ja' ? ROLEPLAY_SCENARIOS_JA : ROLEPLAY_SCENARIOS;
  const grid = document.getElementById('scenarioGrid');
  grid.innerHTML = scenarios.map(s => `
    <button class="scenario-card" data-id="${s.id}">
      <span class="scenario-emoji">${s.emoji}</span>
      <span class="scenario-title">${s.title}</span>
      <span class="scenario-desc">${s.desc}</span>
    </button>`).join('');
  // Replace node to drop any previously accumulated listeners
  const fresh = grid.cloneNode(true);
  grid.parentNode.replaceChild(fresh, grid);
  fresh.addEventListener('click', e => {
    const card = e.target.closest('.scenario-card');
    if (!card) return;
    const scenario = scenarios.find(s => s.id === card.dataset.id);
    if (scenario) startRoleplay(scenario);
  });
  document.getElementById('roleplayModal').classList.remove('hidden');
}

function closeRoleplayModal() {
  document.getElementById('roleplayModal').classList.add('hidden');
}

function updateRoleplayBanner() {
  const banner = document.getElementById('roleplayBanner');
  const title  = document.getElementById('roleplayBannerTitle');
  if (activeRoleplay) {
    title.textContent = `${activeRoleplay.emoji} ${activeRoleplay.title}`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
  document.getElementById('roleplayBtn')?.classList.toggle('active', !!activeRoleplay);
}

async function startRoleplay(scenario) {
  closeRoleplayModal();

  if (!document.getElementById('view-chat').classList.contains('active')) {
    history.pushState(null, '', '#/chat');
    showView('chat');
  }

  endSession();
  messages = [];
  chatEl.innerHTML = '';
  await clearChatMessages();
  stopTTS();
  lastAiBubble = null;
  feedbackContent.innerHTML = `<div class="feedback-placeholder">${LANG_CONFIG[activeLang].feedbackPlaceholder}</div>`;
  updateGoalBar();

  activeRoleplay = scenario;
  updateRoleplayBanner();

  isProcessing = true;
  sendBtn.disabled = true;
  if (!currentSession) startSession();

  const openingMessages = [
    { role: 'system', content: scenario.prompt + ' Start the conversation by briefly setting the scene and greeting the user. 2-3 sentences max.' },
    { role: 'user', content: '[start]' },
  ];

  showLoading();
  try {
    const aiText = await callAI(openingMessages);
    const ts = new Date().toISOString();
    messages.push({ role: 'assistant', content: aiText, timestamp: ts });
    scrollBottom();
    if (ttsEnabled) speak(aiText, lastAiBubble);
  } catch {
    showError('롤플레이를 시작할 수 없습니다. 다시 시도해 주세요.');
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
  }
}

function endRoleplay() {
  activeRoleplay = null;
  updateRoleplayBanner();
}

function showView(name) {
  const valid = ['chat','stats','review','profile'];
  const resolved = name === 'history' ? 'stats' : name;
  const vname = valid.includes(resolved) ? resolved : 'chat';

  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${vname}`));
  document.querySelectorAll('.tab-link').forEach(a => a.classList.toggle('active', a.dataset.view === vname));
  document.querySelector('.footer').style.display = vname === 'chat' ? '' : 'none';

  if (vname === 'stats')   renderStatsView();
  if (vname === 'review')  renderReviewView();
  if (vname === 'profile') loadProfileForm();
}

function router() {
  const hash = window.location.hash || '#/chat';
  showView(hash.replace(/^#\//, '') || 'chat');
}

// ── Stats view ────────────────────────────────────────────────────────────────
function renderStatsView() {
  weeklyChartInst?.destroy(); weeklyChartInst = null;
  errorChartInst?.destroy();  errorChartInst  = null;

  const sessions  = getSessions();
  const feedbacks = getFeedbackLog();
  const streak    = getStreak();
  const badges    = getBadges();

  const totalSessions = sessions.length;
  const totalTurns    = sessions.reduce((s, x) => s + (x.turnCount || 0), 0);
  const totalCorr     = feedbacks.length;
  const weekStart     = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0);
  const weekMin       = Math.floor(sessions.filter(s => new Date(s.date) >= weekStart).reduce((s, x) => s + (x.duration||0), 0) / 60);

  const el = document.getElementById('statsContent');
  el.innerHTML = `
    <div class="page-wrap">
      <h2 class="page-title">📊 Statistics</h2>
      <div class="stat-cards">
        <div class="stat-card"><div class="stat-val">${totalSessions}</div><div class="stat-lbl">Sessions</div></div>
        <div class="stat-card"><div class="stat-val">${totalTurns}</div><div class="stat-lbl">Total Turns</div></div>
        <div class="stat-card"><div class="stat-val">${weekMin}</div><div class="stat-lbl">Min This Week</div></div>
        <div class="stat-card"><div class="stat-val">${totalCorr}</div><div class="stat-lbl">Corrections</div></div>
      </div>

      <div class="streak-row">🔥 Current streak: <strong>${streak.currentStreak}</strong> day${streak.currentStreak !== 1 ? 's' : ''}</div>

      <div class="chart-row">
        <div class="chart-section">
          <div class="section-title">Weekly Activity</div>
          <div class="chart-wrap"><canvas id="weeklyChart"></canvas></div>
        </div>
        <div class="chart-section">
          <div class="section-title">Error Types</div>
          <div class="chart-wrap">
            ${feedbacks.length ? '<canvas id="errorChart"></canvas>' : '<p class="empty-msg" style="padding-top:60px;text-align:center">No feedback data yet.</p>'}
          </div>
        </div>
      </div>

      <div class="section-block">
        <div class="section-title">Top Mistakes</div>
        ${buildTopMistakesHTML(feedbacks)}
      </div>

      <div class="section-block">
        <div class="section-title">Badges</div>
        ${buildBadgesHTML(badges)}
      </div>

      <div class="section-block">
        <div class="section-title">📝 Session History <span class="count-badge">${sessions.length}</span></div>
        ${buildHistoryHTML(sessions)}
      </div>
    </div>`;

  if (typeof Chart !== 'undefined') {
    const weekData = buildWeekData(sessions);
    const wCtx = document.getElementById('weeklyChart')?.getContext('2d');
    if (wCtx) {
      weeklyChartInst = new Chart(wCtx, {
        type: 'bar',
        data: {
          labels: weekData.map(d => d.label),
          datasets: [{ label: 'Turns', data: weekData.map(d => d.turns), backgroundColor: 'rgba(88,101,242,0.7)', borderRadius: 4 }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
      });
    }

    const types = buildTypeCounts(feedbacks);
    const eCtx  = document.getElementById('errorChart')?.getContext('2d');
    if (eCtx && (types.grammar + types.expression + types.vocabulary) > 0) {
      errorChartInst = new Chart(eCtx, {
        type: 'doughnut',
        data: {
          labels: ['Grammar', 'Expression', 'Vocabulary'],
          datasets: [{ data: [types.grammar, types.expression, types.vocabulary], backgroundColor: ['#fca5a5','#fdba74','#93c5fd'], borderWidth: 1 }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }
  }

  const sortedSessions = sessions.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  document.getElementById('sessionList')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    const session = sortedSessions.find(s => s.sessionId === id);
    if (action === 'view')   toggleDetail(id, session);
    if (action === 'export') exportSession(session);
    if (action === 'delete') confirmDelete(id);
  });
}

function buildWeekData(sessions) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const year  = d.getFullYear();
    const month = String(d.getMonth()+1).padStart(2,'0');
    const day   = String(d.getDate()).padStart(2,'0');
    const ds    = `${year}-${month}-${day}`;
    const label = d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
    const turns = sessions.filter(s => (s.date||'').startsWith(ds)).reduce((sum, s) => sum + (s.turnCount||0), 0);
    days.push({ label, turns });
  }
  return days;
}

function buildTypeCounts(feedbacks) {
  const c = { grammar: 0, expression: 0, vocabulary: 0 };
  feedbacks.forEach(f => { if (c[f.type] !== undefined) c[f.type]++; });
  return c;
}

function buildTopMistakesHTML(feedbacks) {
  const map = {};
  feedbacks.forEach(f => {
    const key = (f.original || '').toLowerCase().trim();
    if (!key) return;
    if (!map[key]) map[key] = { ...f, count: 0 };
    map[key].count++;
  });
  const top = Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
  if (!top.length) return '<p class="empty-msg">No mistakes logged yet. Keep practicing!</p>';
  return `<ul class="mistake-list">${top.map(m => `
    <li class="mistake-item">
      <span class="badge badge-${m.type||'grammar'}">${m.type||'grammar'}</span>
      <span class="mistake-text"><s>${toHtml(m.original)}</s> → <strong>${toHtml(m.corrected)}</strong></span>
      <span class="mistake-count">${m.count}×</span>
      ${m.count >= 3 ? '<span class="repeat-warn">⚠ repeated</span>' : ''}
    </li>`).join('')}</ul>`;
}

function buildBadgesHTML(earned) {
  const earnedIds = new Set(earned.map(b => b.id));
  return `<div class="badges-grid">${BADGE_DEFS.map(d => `
    <div class="badge-item ${earnedIds.has(d.id) ? 'earned' : 'locked'}">
      <span class="badge-emoji">${d.emoji}</span>
      <span class="badge-label">${d.label}</span>
      ${!earnedIds.has(d.id) ? '<span class="badge-lock">🔒</span>' : ''}
    </div>`).join('')}</div>`;
}

// ── Review view ───────────────────────────────────────────────────────────────
let reviewFilter = 'all';

function renderReviewView() {
  const el = document.getElementById('reviewContent');
  const all = getReviews();

  const FILTERS = [
    { key: 'all',        label: 'All' },
    { key: 'grammar',    label: 'Grammar' },
    { key: 'expression', label: 'Expression' },
    { key: 'vocabulary', label: 'Vocabulary' },
    { key: 'learned',    label: '✅ Learned' },
  ];

  const filtered = all.filter(r => {
    if (reviewFilter === 'all')     return true;
    if (reviewFilter === 'learned') return r.learned;
    return r.type === reviewFilter && !r.learned;
  });

  const learnedCount = all.filter(r => r.learned).length;

  el.innerHTML = `
    <div class="page-wrap">
      <h2 class="page-title">📚 Review Notes <span class="count-badge">${all.length}</span></h2>
      <div class="review-filter-bar">
        ${FILTERS.map(f => `<button class="review-filter-btn${reviewFilter === f.key ? ' active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('')}
      </div>
      ${!all.length
        ? '<p class="empty-msg">Click 📌 Review in the feedback panel to add items here.</p>'
        : !filtered.length
          ? '<p class="empty-msg">No items in this category.</p>'
          : `<ul class="review-list">${filtered.map(r => `
            <li class="review-card${r.learned ? ' learned' : ''}" data-id="${r.id}">
              <div class="review-card-header">
                <span class="badge badge-${r.type}">${r.type}</span>
                <span class="review-date">${fmtDate(r.addedAt)}</span>
              </div>
              <div class="review-change">
                <span class="original">${toHtml(r.original)}</span>
                <span class="arrow">→</span>
                <span class="corrected">${toHtml(r.corrected)}</span>
              </div>
              ${r.explanation ? `<div class="review-explanation">${toHtml(r.explanation)}</div>` : ''}
              <div class="review-card-footer">
                <button class="btn-review-learned" data-action="learned" data-id="${r.id}">
                  ${r.learned ? '↩ Mark as Learning' : '✅ Mark as Learned'}
                </button>
                <button class="btn-review-delete" data-action="delete" data-id="${r.id}">🗑 Delete</button>
              </div>
            </li>`).join('')}
          </ul>`
      }
      ${learnedCount > 0 && all.length > 0 ? `<p class="review-summary">Learned ${learnedCount} / Total ${all.length}</p>` : ''}
    </div>`;

  el.querySelector('.review-filter-bar')?.addEventListener('click', e => {
    const btn = e.target.closest('.review-filter-btn');
    if (!btn) return;
    reviewFilter = btn.dataset.filter;
    renderReviewView();
  });

  el.querySelector('.review-list')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'delete') {
      if (!confirm('이 항목을 삭제할까요?')) return;
      removeReview(id);
    } else if (action === 'learned') {
      toggleReviewLearned(id);
    }
    renderReviewView();
  });
}

function buildHistoryHTML(allSessions) {
  const sessions = allSessions.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!sessions.length) return '<p class="empty-msg">No sessions yet. Start a conversation in Chat!</p>';
  return `<ul class="session-list" id="sessionList">${sessions.map(s => `
    <li class="session-item">
      <div class="session-meta">
        <span class="session-date">${fmtDate(s.date)}</span>
        <span class="session-chips">
          <span class="chip">💬 ${s.turnCount} turns</span>
          <span class="chip">⏱ ${fmtDuration(s.duration||0)}</span>
          <span class="chip">📝 ${s.feedbacks?.length||0} feedback</span>
        </span>
      </div>
      <div class="session-actions">
        <button class="btn-sm btn-outline"  data-action="view"   data-id="${s.sessionId}">View</button>
        <button class="btn-sm btn-outline"  data-action="export" data-id="${s.sessionId}">Export</button>
        <button class="btn-sm btn-danger-sm" data-action="delete" data-id="${s.sessionId}">Delete</button>
      </div>
      <div class="session-detail hidden" id="detail-${s.sessionId}"></div>
    </li>`).join('')}</ul>`;
}

function toggleDetail(id, session) {
  const det = document.getElementById(`detail-${id}`);
  if (!det) return;
  const wasHidden = det.classList.contains('hidden');
  det.classList.toggle('hidden', !wasHidden);
  if (!wasHidden) return; // was open, now closed — nothing more to do
  const msgs = session?.messages || [];
  if (!msgs.length) { det.innerHTML = '<p class="empty-msg">No messages recorded in this session.</p>'; return; }
  det.innerHTML = `<div class="mini-chat">${msgs.map(m => `
    <div class="mini-msg ${m.role === 'user' ? 'user' : 'ai'}">
      <span class="mini-role">${m.role === 'user' ? '👤' : '🤖'}</span>
      <span class="mini-text">${toHtml(m.content)}</span>
    </div>`).join('')}</div>`;
}

function exportSession(session) {
  if (!session) return;
  const lines = (session.messages||[]).map(m => `[${m.role === 'user' ? 'You' : 'AI'}] ${m.content}`).join('\n\n');
  const header = `Session: ${fmtDate(session.date)} | ${session.turnCount} turns | ${fmtDuration(session.duration||0)}\n${'─'.repeat(40)}\n\n`;
  const blob = new Blob([header + lines], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `session-${session.date.split('T')[0]}.txt` });
  a.click();
  URL.revokeObjectURL(url);
}

async function confirmDelete(id) {
  if (!confirm('이 세션을 삭제할까요?')) return;
  await deleteSession(id);
  renderStatsView();
}

// ── Profile form ──────────────────────────────────────────────────────────────
function loadProfileForm() {
  renderProfileSlots();
  renderSavedProfileCard();
  document.querySelectorAll('input[name="lang"]').forEach(el => { el.checked = el.value === activeLang; });
  const p = getProfile();
  document.getElementById('profileWelcome').classList.toggle('hidden', !!p);
  if (!p) return;
  document.getElementById('profileName').value = p.name || '';
  document.querySelectorAll('input[name="level"]').forEach(el => { el.checked = el.value === (p.level || 'intermediate'); });
  document.querySelectorAll('input[name="goals"]').forEach(el => { el.checked = (p.goals||[]).includes(el.value); });
  document.querySelectorAll('input[name="target"]').forEach(el => { el.checked = el.value === String(p.dailyTarget || 10); });
}

function saveProfileForm() {
  const isFirst = !getProfile();
  const name    = document.getElementById('profileName').value.trim() || 'Learner';
  const level   = document.querySelector('input[name="level"]:checked')?.value || 'intermediate';
  const goals   = [...document.querySelectorAll('input[name="goals"]:checked')].map(e => e.value);
  const target  = parseInt(document.querySelector('input[name="target"]:checked')?.value || '10', 10);
  const lang    = document.querySelector('input[name="lang"]:checked')?.value || 'en';
  setActiveLang(lang);
  saveProfile({ name, level, goals, dailyTarget: target });
  updateGoalBar();
  renderProfileSlots();
  updateHeaderProfile();
  renderSavedProfileCard();
  if (isFirst) { location.hash = '#/chat'; }
  else {
    const el = document.createElement('div');
    el.className = 'badge-toast';
    el.textContent = '✅ Profile saved!';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 2500);
  }
}

// ── Speech Recognition ────────────────────────────────────────────────────────
function setupSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { micBtn.disabled = true; micBtn.title = '이 브라우저는 음성 입력을 지원하지 않습니다 (Chrome/Edge 필요)'; return; }

  recognition = new SR();
  recognition.lang = LANG_CONFIG[activeLang].sttLang; recognition.continuous = true; recognition.interimResults = true;

  let accumulatedFinal = '';

  recognition.onstart = () => {
    accumulatedFinal = '';
    isListening = true;
    micBtn.classList.add('listening'); micBtn.setAttribute('aria-label', 'Stop voice input');
    micIcon.style.display = 'none'; stopIcon.style.display = 'block';
    showInterim('🎤 Listening…');
  };
  recognition.onresult = (e) => {
    let interim = '';
    for (const r of Array.from(e.results).slice(e.resultIndex)) {
      if (r.isFinal) accumulatedFinal += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    const preview = (accumulatedFinal + interim).trim();
    if (preview) showInterim(`🎤 ${preview}`);
  };
  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove('listening'); micBtn.setAttribute('aria-label', 'Start voice input');
    micIcon.style.display = 'block'; stopIcon.style.display = 'none';
    hideInterim();
    const text = accumulatedFinal.trim();
    if (text) { inputEl.value = text; inputEl.dispatchEvent(new Event('input')); }
    accumulatedFinal = '';
  };
  recognition.onerror = (e) => {
    isListening = false;
    accumulatedFinal = '';
    micBtn.classList.remove('listening'); micIcon.style.display = 'block'; stopIcon.style.display = 'none'; hideInterim();
    if (e.error === 'not-allowed') showError('⚠️ 마이크 권한이 거부되었습니다.');
  };
}

// ── Events ────────────────────────────────────────────────────────────────────
function setupEvents() {
  sendBtn.addEventListener('click', () => sendMessage(inputEl.value));
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(inputEl.value); } });
  inputEl.addEventListener('input', () => { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px'; });

  document.getElementById('langBtn')?.addEventListener('click', () => {
    setActiveLang(activeLang === 'en' ? 'ja' : 'en');
  });

  document.getElementById('roleplayBtn')?.addEventListener('click', () => {
    if (activeRoleplay) endRoleplay(); else openRoleplayModal();
  });
  document.getElementById('roleplayModalClose')?.addEventListener('click', closeRoleplayModal);
  document.getElementById('roleplayModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('roleplayModal')) closeRoleplayModal();
  });
  document.getElementById('roleplayEndBtn')?.addEventListener('click', endRoleplay);
  document.getElementById('customScenarioBtn')?.addEventListener('click', () => {
    const inputEl = document.getElementById('customScenarioInput');
    const text = inputEl.value.trim();
    if (!text) { inputEl.focus(); return; }
    inputEl.value = '';
    startRoleplay({
      id: 'custom',
      emoji: '✏️',
      title: '커스텀 롤플레이',
      desc: text.slice(0, 40),
      prompt: `You are participating in a custom roleplay. The scenario (described in Korean or English): "${text}". Understand the scenario, play the appropriate role, and make the conversation realistic and helpful for an English learner. Keep responses concise (2-3 sentences).`,
    });
  });

  micBtn.addEventListener('click', () => {
    if (!recognition) return;
    stopTTS();
    if (isListening) recognition.stop(); else { try { recognition.start(); } catch {} }
  });

  clearBtn.addEventListener('click', async () => {
    if (!confirm('대화 내역을 모두 삭제할까요?')) return;
    endSession();
    messages = [];
    chatEl.innerHTML = '';
    await clearChatMessages();
    endRoleplay();
    showWelcome(); stopTTS(); lastAiBubble = null;
    feedbackContent.innerHTML = `<div class="feedback-placeholder">${LANG_CONFIG[activeLang].feedbackPlaceholder}</div>`;
    updateGoalBar();
  });

  feedbackToggleBtn.addEventListener('click', () => {
    feedbackPanel.classList.toggle('collapsed');
    const exp = !feedbackPanel.classList.contains('collapsed');
    feedbackToggleBtn.setAttribute('aria-expanded', String(exp));
    feedbackToggleBtn.textContent = exp ? '▾' : '▸';
  });

  document.getElementById('saveProfileBtn')?.addEventListener('click', saveProfileForm);

  document.getElementById('clearAllDataBtn')?.addEventListener('click', async () => {
    if (!confirm('모든 학습 데이터를 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    if (supa) {
      await Promise.all([
        supa.from('profiles').delete().eq('user_id', userId),
        supa.from('sessions').delete().eq('user_id', userId),
        supa.from('feedbacks').delete().eq('user_id', userId),
        supa.from('badges').delete().eq('user_id', userId),
        supa.from('streaks').delete().eq('user_id', userId),
        supa.from('chat_messages').delete().eq('user_id', userId),
        supa.from('reviews').delete().eq('user_id', userId),
      ]);
    }
    // Clear all slot-specific localStorage keys for current slot
    ['eai_uid_', 'eai_lang_', 'eai_reviews_', 'eai_slot_display_'].forEach(prefix => {
      try { localStorage.removeItem(`${prefix}${activeSlot}`); } catch {}
    });
    cachedProfile = null; cachedSessions = []; cachedFeedbacks = [];
    cachedBadges = []; cachedStreak = { lastStudyDate: null, currentStreak: 0 };
    cachedReviews = []; messages = []; currentSession = null;
    chatEl.innerHTML = '';
    updateHeaderProfile();
    renderProfileSlots();
    history.replaceState(null, '', '#/profile');
    router();
    alert('모든 데이터가 삭제되었습니다.');
  });

  document.getElementById('hideTextBtn')?.addEventListener('click', () => {
    setHideTextMode(!hideAiText);
  });

  document.getElementById('suggestBtn')?.addEventListener('click', () => {
    setSuggestionsEnabled(!suggestionsEnabled);
  });

  document.getElementById('translationBtn')?.addEventListener('click', () => {
    showTranslation = !showTranslation;
    const btn = document.getElementById('translationBtn');
    btn.classList.toggle('active', showTranslation);
    btn.setAttribute('aria-pressed', String(showTranslation));
    btn.textContent = showTranslation ? '🇰🇷 번역 ON' : '🇰🇷 번역 OFF';
    document.querySelectorAll('.msg-translation').forEach(el => {
      el.classList.toggle('hidden', !showTranslation);
    });
  });

  window.addEventListener('hashchange', router);
}

// ── Welcome ───────────────────────────────────────────────────────────────────
function showWelcome() {
  const profile = getProfile();
  const name    = profile?.name ? `, ${profile.name}` : '';
  chatEl.innerHTML = `
    <div class="welcome">
      <div class="welcome-avatar">🤖</div>
      <div class="ai-welcome">${LANG_CONFIG[activeLang].welcome(name)}</div>
    </div>`;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  activeSlot = parseInt(localStorage.getItem('eai_active_slot') || '0');
  activeLang = localStorage.getItem(`eai_lang_${activeSlot}`) || 'en';

  initSupabase();
  userId = getOrCreateUserIdForSlot(activeSlot);

  await dbInit();

  if (messages.length === 0) showWelcome();
  else { messages.forEach(m => renderMessage(m.role, m.content, m.timestamp, false)); scrollBottom(); }

  setupSpeech();
  setupTTS();
  setupEvents();
  updateGoalBar();

  if (window.innerWidth <= 600) {
    feedbackPanel.classList.add('collapsed');
    feedbackToggleBtn.setAttribute('aria-expanded', 'false');
    feedbackToggleBtn.textContent = '▸';
  }

  updateHeaderProfile();
  setActiveLang(activeLang);

  if (!getProfile()) history.replaceState(null, '', '#/profile');

  router();
  inputEl.focus();
}

init();
