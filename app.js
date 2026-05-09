'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const API_URL        = 'https://openrouter.ai/api/v1/chat/completions';
const PRIMARY_MODEL  = 'meta-llama/llama-3.3-70b-instruct:free';
const FALLBACK_MODEL = 'openai/gpt-oss-20b:free';
const MAX_TURNS      = 10;

const OPENROUTER_API_KEY = (typeof CONFIG !== 'undefined' && CONFIG.OPENROUTER_API_KEY)
  || localStorage.getItem('or_api_key') || '';

const SUPABASE_URL      = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_URL)      || '';
const SUPABASE_ANON_KEY = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_ANON_KEY) || '';

function apiHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    'HTTP-Referer': window.location.origin,
    'X-Title': 'EnglishAI Chat',
  };
}

const SYSTEM_PROMPT =
  'You are a friendly English conversation partner. Respond naturally in English. ' +
  'Keep responses concise (2-4 sentences). Encourage the user to continue speaking.';

const FEEDBACK_SYSTEM_PROMPT =
  'You are an English language teacher. Analyze the user\'s sentence for:\n' +
  '1. Grammar errors\n2. Unnatural expressions\n3. Vocabulary improvements\n\n' +
  'Respond ONLY in this exact JSON (no markdown, no extra text):\n' +
  '{"hasIssues":true,"corrections":[{"original":"...","corrected":"...","explanation":"...","type":"grammar"}],"overallFeedback":"..."}\n' +
  'type must be: grammar, expression, or vocabulary.\n' +
  'If correct: {"hasIssues":false,"corrections":[],"overallFeedback":"Great job! Your English is natural."}';

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
let userId = null;

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

const ttsSupported = 'speechSynthesis' in window;
let ttsEnabled    = true;
let isTTSSpeaking = false;
let isTTSPaused   = false;
let lastAiBubble  = null;

let showTranslation = true;

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

// ── User ID ───────────────────────────────────────────────────────────────────
function getOrCreateUserId() {
  let id = localStorage.getItem('eai_user_id');
  if (!id) {
    id = crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem('eai_user_id', id);
  }
  return id;
}

// ── DB init ───────────────────────────────────────────────────────────────────
async function dbInit() {
  if (!supa) return;

  const [pRes, sRes, fRes, bRes, stRes, mRes] = await Promise.allSettled([
    supa.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    supa.from('sessions').select('*').eq('user_id', userId),
    supa.from('feedbacks').select('*').eq('user_id', userId),
    supa.from('badges').select('*').eq('user_id', userId),
    supa.from('streaks').select('*').eq('user_id', userId).maybeSingle(),
    supa.from('chat_messages').select('*').eq('user_id', userId).order('timestamp', { ascending: true }),
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
}

// ── Profile DB ────────────────────────────────────────────────────────────────
function getProfile() { return cachedProfile; }

function saveProfile(p) {
  cachedProfile = p;
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
  if (supa) {
    const { error } = await supa.from('profiles').delete().eq('user_id', userId);
    if (error) console.error('deleteProfileData', error);
  }
  renderSavedProfileCard();
  loadProfileForm();
  updateGoalBar();
}

// ── Profile helpers ───────────────────────────────────────────────────────────
function buildSystemPrompt() {
  const p = getProfile();
  if (!p) return SYSTEM_PROMPT;
  const goalMap = { daily: 'daily conversation', business: 'business English', travel: 'travel English', exam: 'exam preparation' };
  const goals   = (p.goals || []).map(g => goalMap[g] || g).join(', ') || 'general';
  return SYSTEM_PROMPT + ` User profile: Level=${p.level || 'intermediate'}, Goals=${goals}. Adjust vocabulary and complexity accordingly.`;
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
function updateStreak() {
  const today  = new Date().toISOString().split('T')[0];
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
  const today = new Date().toISOString().split('T')[0];
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
  el.innerHTML = `<div class="bubble">${toHtml(content)}</div><time class="ts">${fmtTime(timestamp)}</time>`;
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
  if (isTTSSpeaking || isTTSPaused) speechSynthesis.cancel();
  isTTSSpeaking = false; isTTSPaused = false;
  updateTTSBtnState();
  lastAiBubble?.querySelectorAll('.tts-word.active').forEach(s => s.classList.remove('active'));
}

function speak(text, bubbleEl) {
  if (!ttsSupported || !ttsEnabled) return;
  stopTTS();
  const utter  = new SpeechSynthesisUtterance(text);
  const voice  = getSelectedVoice();
  if (voice) utter.voice = voice;
  utter.rate   = parseFloat(rateSlider?.value ?? '1');
  utter.pitch  = parseFloat(pitchSlider?.value ?? '1');
  utter.lang   = 'en-US';
  bubbleEl.innerHTML = wrapWordsForHighlight(text);
  utter.onstart    = () => { isTTSSpeaking = true;  isTTSPaused = false; updateTTSBtnState(); };
  utter.onboundary = (e) => {
    if (e.name !== 'word') return;
    bubbleEl.querySelectorAll('.tts-word.active').forEach(s => s.classList.remove('active'));
    bubbleEl.querySelector(`.tts-word[data-start="${e.charIndex}"]`)?.classList.add('active');
  };
  utter.onend = utter.onerror = () => {
    isTTSSpeaking = false; isTTSPaused = false; updateTTSBtnState();
    bubbleEl.querySelectorAll('.tts-word.active').forEach(s => s.classList.remove('active'));
  };
  speechSynthesis.speak(utter);
}

function populateVoices() {
  if (!ttsSupported) return;
  const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
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
    const pref = voices.find(v => v.name.includes('Google') && v.lang === 'en-US') || voices.find(v => v.lang === 'en-US') || voices[0];
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
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ model, messages: apiMsgs, stream: false, max_tokens: 500 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: res.status });
    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty');
    return parseJSONFromText(content);
  } finally { clearTimeout(timer); }
}

async function callFeedback(text) {
  const msgs = [{ role: 'system', content: FEEDBACK_SYSTEM_PROMPT }, { role: 'user', content: text }];
  try { return await doFeedbackFetch(PRIMARY_MODEL, msgs); }
  catch (e) {
    if (e.status === 429 || e.status === 503 || e.status === 404) return doFeedbackFetch(FALLBACK_MODEL, msgs);
    throw e;
  }
}

// ── Translation API ───────────────────────────────────────────────────────────
async function doTextFetch(model, apiMsgs) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ model, messages: apiMsgs, stream: false, max_tokens: 400 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: res.status });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } finally { clearTimeout(timer); }
}

async function callTranslation(text) {
  const msgs = [
    { role: 'system', content: 'Translate the following English text to Korean. Respond ONLY with the Korean translation. Do not add any explanations or extra text.' },
    { role: 'user', content: text },
  ];
  try { return await doTextFetch(PRIMARY_MODEL, msgs); }
  catch (e) {
    if (e.status === 429 || e.status === 503 || e.status === 404) return doTextFetch(FALLBACK_MODEL, msgs);
    return null;
  }
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
        <button class="btn-feedback-card-toggle" aria-expanded="false">▾</button>
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
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ model, messages: apiMessages, stream: true, max_tokens: 300 }),
  });
  if (!res.ok) throw Object.assign(new Error(`API ${res.status}`), { status: res.status });

  hideLoading();
  clearWelcome();

  const ts      = new Date().toISOString();
  const msgEl   = document.createElement('div'); msgEl.className = 'msg ai';
  const bubbleEl= document.createElement('div'); bubbleEl.className = 'bubble streaming';
  const tsEl    = document.createElement('time');tsEl.className = 'ts'; tsEl.textContent = fmtTime(ts);
  msgEl.appendChild(bubbleEl); msgEl.appendChild(tsEl);
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
  return fullText;
}

async function callAI(apiMessages) {
  try { return await fetchStream(apiMessages, PRIMARY_MODEL); }
  catch (err) {
    if (err.status === 429 || err.status === 503 || err.status === 404) { showLoading(); return fetchStream(apiMessages, FALLBACK_MODEL); }
    throw err;
  }
}

// ── Send message ──────────────────────────────────────────────────────────────
async function sendMessage(rawText) {
  const text = rawText.trim();
  if (!text || isProcessing) return;

  isProcessing = true;
  sendBtn.disabled = true;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  if (!currentSession) startSession();

  const ts = new Date().toISOString();
  messages.push({ role: 'user', content: text, timestamp: ts });
  renderMessage('user', text, ts);
  saveMessage({ role: 'user', content: text, timestamp: ts });
  scrollBottom();

  const context = messages.slice(-(MAX_TURNS * 2)).map(m => ({ role: m.role, content: m.content }));
  const apiMessages = [{ role: 'system', content: buildSystemPrompt() }, ...context];

  showLoading();
  showFeedbackLoading();

  const feedbackPromise = callFeedback(text).catch(() => null);
  const sessionId       = currentSession.sessionId;
  const prevTurns       = getDailyTurnCount();

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

    // Fire translation (non-blocking)
    callTranslation(aiText).then(translated => {
      if (!translationEl?.isConnected) return;
      if (translated) {
        translationEl.innerHTML = `<span class="translation-label">🇰🇷</span><span class="translation-text">${toHtml(translated)}</span>`;
      } else {
        translationEl.remove();
        translationEl = null;
      }
    }).catch(() => { translationEl?.remove(); translationEl = null; });
  } catch (err) {
    hideLoading();
    let msg = '⚠️ 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
    if (err.status === 429) msg = '⚠️ AI 응답 한도 초과입니다. 잠시 후 다시 시도해 주세요.';
    if (err.status === 401) msg = '⚠️ API 키가 올바르지 않습니다.';
    showError(msg);
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    scrollBottom();
  }

  const feedbackData = await feedbackPromise;
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
function showView(name) {
  const valid = ['chat','stats','history','profile'];
  const vname = valid.includes(name) ? name : 'chat';

  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${vname}`));
  document.querySelectorAll('.tab-link').forEach(a => a.classList.toggle('active', a.dataset.view === vname));
  document.querySelector('.footer').style.display = vname === 'chat' ? '' : 'none';

  if (vname === 'stats')   renderStatsView();
  if (vname === 'history') renderHistoryView();
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
}

function buildWeekData(sessions) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds    = d.toISOString().split('T')[0];
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

// ── History view ──────────────────────────────────────────────────────────────
function renderHistoryView() {
  const sessions = getSessions().slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const el = document.getElementById('historyContent');

  if (!sessions.length) {
    el.innerHTML = '<div class="page-wrap"><h2 class="page-title">📝 History</h2><p class="empty-msg">No sessions yet. Start a conversation in Chat!</p></div>';
    return;
  }

  el.innerHTML = `<div class="page-wrap">
    <h2 class="page-title">📝 History <span class="count-badge">${sessions.length}</span></h2>
    <ul class="session-list" id="sessionList"></ul></div>`;

  const listEl = el.querySelector('#sessionList');
  sessions.forEach(s => {
    const li = document.createElement('li');
    li.className = 'session-item';
    li.innerHTML = `
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
      <div class="session-detail hidden" id="detail-${s.sessionId}"></div>`;
    listEl.appendChild(li);
  });

  listEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    const session = sessions.find(s => s.sessionId === id);
    if (action === 'view')   toggleDetail(id, session);
    if (action === 'export') exportSession(session);
    if (action === 'delete') confirmDelete(id);
  });
}

function toggleDetail(id, session) {
  const det = document.getElementById(`detail-${id}`);
  if (!det) return;
  const open = !det.classList.contains('hidden');
  det.classList.toggle('hidden', open);
  if (!open) return;
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
  renderHistoryView();
}

// ── Profile form ──────────────────────────────────────────────────────────────
function loadProfileForm() {
  renderSavedProfileCard();
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
  saveProfile({ name, level, goals, dailyTarget: target });
  updateGoalBar();
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
  recognition.lang = 'en-US'; recognition.continuous = false; recognition.interimResults = true;

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add('listening'); micBtn.setAttribute('aria-label', 'Stop voice input');
    micIcon.style.display = 'none'; stopIcon.style.display = 'block';
    showInterim('🎤 Listening…');
  };
  recognition.onresult = (e) => {
    let final = '', interim = '';
    for (const r of e.results) { (r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript)); }
    if (final) { inputEl.value = final; inputEl.dispatchEvent(new Event('input')); hideInterim(); }
    else if (interim) showInterim(`🎤 ${interim}`);
  };
  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove('listening'); micBtn.setAttribute('aria-label', 'Start voice input');
    micIcon.style.display = 'block'; stopIcon.style.display = 'none'; hideInterim();
  };
  recognition.onerror = (e) => {
    isListening = false;
    micBtn.classList.remove('listening'); micIcon.style.display = 'block'; stopIcon.style.display = 'none'; hideInterim();
    if (e.error === 'not-allowed') showError('⚠️ 마이크 권한이 거부되었습니다.');
  };
}

// ── Events ────────────────────────────────────────────────────────────────────
function setupEvents() {
  sendBtn.addEventListener('click', () => sendMessage(inputEl.value));
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(inputEl.value); } });
  inputEl.addEventListener('input', () => { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px'; });

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
    showWelcome(); stopTTS(); lastAiBubble = null;
    feedbackContent.innerHTML = '<div class="feedback-placeholder">Send a message to get feedback on your English.</div>';
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
      ]);
    }
    cachedProfile = null; cachedSessions = []; cachedFeedbacks = [];
    cachedBadges = []; cachedStreak = { lastStudyDate: null, currentStreak: 0 };
    messages = []; currentSession = null;
    history.replaceState(null, '', '#/profile');
    router();
    alert('모든 데이터가 삭제되었습니다.');
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
      <div class="ai-welcome">
        Hi${name}! I'm your English conversation partner.<br>
        Let's start practicing — type a message or tap 🎤 to speak!
      </div>
    </div>`;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  initSupabase();
  userId = getOrCreateUserId();

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

  if (!getProfile()) history.replaceState(null, '', '#/profile');

  router();
  inputEl.focus();
}

init();
