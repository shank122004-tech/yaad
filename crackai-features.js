/**
 * crackai-features.js — CrackAI Feature Engine v2.0
 * ═══════════════════════════════════════════════════════════════════
 *  CHANGES v2.0:
 *  - Invite button in referral modal (WhatsApp + copy link)
 *  - Features section moved INTO sidebar (scrollable), removed from homepage
 *  - messageLimitInfo hidden on homepage
 *  - Mock test questions fetched from DeepSeek API
 *  - Exam expansion includes all classes (6–12) as selectable topics
 *  - PYQ questions fetched from DeepSeek API + cached locally
 *  - Group study opens in full screen
 *  - No message count shown on home page
 * ═══════════════════════════════════════════════════════════════════
 */

// QuestionService - Inline
const QuestionService = (function () {
  'use strict';
  const CONFIG = { CACHE_DURATION_MS: 24 * 60 * 60 * 1000, SESSION_CACHE_DURATION_MS: 60 * 60 * 1000, MAX_BATCH_SIZE: 100 };
  const cache = { memory: {}, session: {}, get(key) { if (this.memory[key] && !this._isExpired(this.memory[key])) return this.memory[key].data; try { const stored = sessionStorage.getItem('qs_' + key); if (stored) { const parsed = JSON.parse(stored); if (!this._isExpired(parsed)) { this.memory[key] = parsed; return parsed.data; } sessionStorage.removeItem('qs_' + key); } } catch (e) {} return null; }, set(key, data, useSessionStorage = true) { const item = { data, timestamp: Date.now(), expires: Date.now() + CONFIG.CACHE_DURATION_MS }; this.memory[key] = item; if (useSessionStorage) { try { sessionStorage.setItem('qs_' + key, JSON.stringify(item)); } catch (e) {} } }, _isExpired(item) { return item.expires && item.expires < Date.now(); }, clear(key) { delete this.memory[key]; try { sessionStorage.removeItem('qs_' + key); } catch (e) {} } };
  function normalizeQuestion(raw) { if (!raw || typeof raw !== 'object') return null; const question = raw.question || raw.q || raw.title || ''; const options = raw.options || raw.opts || raw.choices || []; let answerIndex = 0; let explanation = raw.explanation || raw.exp || raw.solution || ''; if (typeof raw.answer === 'number') answerIndex = raw.answer; else if (typeof raw.ans === 'number') answerIndex = raw.ans; else if (typeof raw.correct === 'number') answerIndex = raw.correct; if (!question || !options.length) return null; return { id: raw.id || `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, question, options: Array.isArray(options) ? options.map(o => String(o).trim()) : [], answerIndex: Math.max(0, Math.min(answerIndex, options.length - 1)), explanation, subject: raw.subject || raw.topic || raw.chapter || '', chapter: raw.chapter || raw.unit || raw.section || '', difficulty: raw.difficulty || 'medium', year: raw.year || null, exam: raw.exam || null, tags: Array.isArray(raw.tags) ? raw.tags : [] }; }
  async function listAllJsonFiles(folderPath) { if (!window.storage) throw new Error('Firebase Storage not initialized'); try { const dirRef = window._getRef(window.storage, folderPath); const result = await window.listAll(dirRef); const jsonFiles = result.items.filter(item => item.name.endsWith('.json')).map(item => `${folderPath}/${item.name}`); return jsonFiles; } catch (e) { console.warn(`[QS] Failed to list: ${folderPath}`); return []; } }
  async function loadJsonFile(filePath) { if (!window.storage) throw new Error('Firebase Storage not initialized'); try { const fileRef = window._getRef(window.storage, filePath); const url = await window.getDownloadURL(fileRef); const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.json(); } catch (e) { console.warn(`[QS] Failed to load ${filePath}`); return null; } }
  async function loadAllQuestionsFromFolder(folderPath) { const cacheKey = `folder_${folderPath.replace(/\//g, '_')}`; const cached = cache.get(cacheKey); if (cached) return cached; try { const jsonFiles = await listAllJsonFiles(folderPath); if (!jsonFiles.length) return []; const filesData = await Promise.all(jsonFiles.map(loadJsonFile)); const allQuestions = []; const seenIds = new Set(); for (const fileData of filesData) { if (!fileData) continue; const questions = Array.isArray(fileData) ? fileData : [fileData]; for (const q of questions) { const normalized = normalizeQuestion(q); if (normalized && !seenIds.has(normalized.id)) { allQuestions.push(normalized); seenIds.add(normalized.id); } } } cache.set(cacheKey, allQuestions); return allQuestions; } catch (e) { return []; } }
  function shuffle(array) { const arr = [...array]; for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  function filterQuestions(questions, criteria) { if (!criteria) return questions; return questions.filter(q => { if (criteria.subject && q.subject && q.subject !== criteria.subject) return false; if (criteria.year && q.year && q.year !== criteria.year) return false; return true; }); }
  return { async loadExamQuestions(exam, type = 'pyq', options = {}) { const { count = null, shuffle: shouldShuffle = true, criteria = null } = options; const folder = `${type}/${exam}`; let questions = await loadAllQuestionsFromFolder(folder); if (!questions.length) return { items: [], total: 0 }; if (criteria) questions = filterQuestions(questions, criteria); if (shouldShuffle) questions = shuffle(questions); if (count && count > 0) questions = questions.slice(0, count); return { items: questions, total: questions.length }; }, async loadMockTest(exam, count = 20, options = {}) { const result = await this.loadExamQuestions(exam, 'mock', { count, shuffle: true, criteria: options.criteria }); return result.items || []; }, async loadBattleQuestions(exam, count = 10, options = {}) { const result = await this.loadExamQuestions(exam, 'mock', { count, shuffle: true }); return (result.items || []).map(q => ({ ...q, explanation: '' })); }, async loadPYQQuestions(exam, year = null, count = 20, options = {}) { const result = await this.loadExamQuestions(exam, 'pyq', { count, shuffle: true, criteria: { ...options.criteria, year } }); return result.items || []; }, async getAvailableYears(exam) { const cacheKey = `years_${exam}`; const cached = cache.get(cacheKey); if (cached) return cached; try { const questions = await loadAllQuestionsFromFolder(`pyq/${exam}`); const years = new Set(); questions.forEach(q => { if (q.year) years.add(q.year); }); const result = Array.from(years).sort((a, b) => b - a); cache.set(cacheKey, result); return result; } catch (e) { return []; } }, async storeBattleQuestions(battleId, questions) { if (!window.db || !window._setDoc) return; try { const ref = window._doc(window.db, 'battles', battleId); await window._setDoc(ref, { questions: questions.map(q => ({ id: q.id, question: q.question, options: q.options, answerIndex: q.answerIndex })), questionsStoredAt: new Date() }, { merge: true }); } catch (e) {} }, clearCache(key = null) { if (key) cache.clear(key); else { cache.memory = {}; Object.keys(sessionStorage).forEach(k => { if (k.startsWith('qs_')) sessionStorage.removeItem(k); }); } }, getCacheStats() { return { memory: Object.keys(cache.memory).length, session: Object.keys(sessionStorage).filter(k => k.startsWith('qs_')).length }; }, normalizeQuestion, shuffle };
})();

(function () {
  console.info('[CrackAI] Script loaded, Firebase check...', {auth: !!window._firebaseAuth, db: !!window._firebaseDb, fns: !!window._firebaseFns});
  'use strict';

  /* ─────────────────────────────────────────────────────────────
   * SECTION 0 — UTILITIES
   * ───────────────────────────────────────────────────────────── */
  const DS_URL = 'https://deepseek-56khnynjia-uc.a.run.app';

  function uid()   { return window._firebaseAuth?.currentUser?.uid || 'guest'; }
  function _p()    { return 'sscai_u:' + uid() + ':'; }
  function lsGet(k, def) { try { return JSON.parse(localStorage.getItem(_p()+k) || def || 'null'); } catch { return null; } }
  function lsSet(k, v)   { try { localStorage.setItem(_p()+k, JSON.stringify(v)); } catch {} }
  function toast(msg, ms) { if (typeof showToast === 'function') showToast(msg, ms||2800); }

  /* Reliably get the current user's display name from all possible sources */
  function getMyName() {
    // 1. Firebase currentUser (most authoritative — from Google login)
    try {
      const cu = window._firebaseAuth?.currentUser;
      if (cu && cu.displayName) return cu.displayName;
    } catch(e) {}
    // 2. app.js in-memory state (state.user.name set on login)
    try {
      if (typeof state !== 'undefined' && state.user) {
        return state.user.displayName || state.user.name || null;
      }
    } catch(e) {}
    // 3. localStorage fallback (state saved on previous session)
    try {
      const myUid = uid();
      if (myUid !== 'guest') {
        const saved = JSON.parse(localStorage.getItem('sscai_u:' + myUid + ':user') || 'null');
        if (saved && (saved.displayName || saved.name)) return saved.displayName || saved.name;
      }
    } catch(e) {}
    return 'Student';
  }
  function isPrem()  { try { return localStorage.getItem(_p()+'premium')==='true'; } catch { return false; } }
  function needsPremium(feature) {
    if (isPrem()) return false;
    toast('🔒 '+feature+' requires Premium ₹129/mo');
    if (typeof openPremiumModal === 'function') openPremiumModal();
    return true;
  }
  
  // Async version that checks Firestore
  async function needsPremiumAsync(feature) {
    const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
    if (!uid) {
      toast('🔒 Please login first');
      return true;
    }
    const isPrem = await window.getPremiumStatus(uid);
    if (isPrem) return false;
    toast('🔒 '+feature+' requires Premium ₹129/mo');
    if (typeof openPremiumModal === 'function') openPremiumModal();
    return true;
  }

  function isRefToolsUnlocked() {
    try { return lsGet('ref_tools_unlocked', 'false') === true || lsGet('ref_tools_unlocked', 'false') === 'true'; } catch { return false; }
  }
  function canUsePYQMock() { return isPrem() || isRefToolsUnlocked(); }



  /* Generic full-screen modal factory */
  function createModal(id, title, contentHTML, opts = {}) {
    if (document.getElementById(id)) return;
    const m = document.createElement('div');
    m.id = id;
    m.className = 'cf-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', title);
    m.innerHTML = `
      <div class="cf-modal-box ${opts.wide ? 'cf-modal-wide' : ''}">
        <div class="cf-modal-hdr">
          <span class="cf-modal-title">${title}</span>
          <button class="cf-modal-close" onclick="CF.closeModal('${id}')" aria-label="Close">✕</button>
        </div>
        <div class="cf-modal-body" id="${id}_body">${contentHTML}</div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) CF.closeModal(id); });
  }

  /* Fullscreen modal factory — covers 100vw/100vh */
  function createFullscreenModal(id, title, contentHTML) {
    if (document.getElementById(id)) return;
    const m = document.createElement('div');
    m.id = id;
    m.className = 'cf-modal cf-modal-fullscreen';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', title);
    m.innerHTML = `
      <div class="cf-modal-box cf-modal-fs-box">
        <div class="cf-modal-hdr">
          <span class="cf-modal-title">${title}</span>
          <button class="cf-modal-close" onclick="CF.closeModal('${id}')" aria-label="Close">✕</button>
        </div>
        <div class="cf-modal-body" id="${id}_body">${contentHTML}</div>
      </div>`;
    document.body.appendChild(m);
  }

  /* ─────────────────────────────────────────────────────────────
   * STORAGE HELPERS — load questions from Firebase Storage
   * ───────────────────────────────────────────────────────────── */

  /* Load and parse a questions JSON file from Firebase Storage.
   * Path examples:
   *   pyq/cgl/2023.json         → SSC CGL 2023 PYQ questions
   *   pyq/cgl/questions.json    → SSC CGL all PYQ questions
   *   mock/cgl/questions.json   → SSC CGL mock test questions
   *   battles/cgl/questions.json → SSC CGL battle questions
   *   pyq/class10/Maths.json    → Class 10 Maths questions
   *
   * Expected JSON format (array):
   * [{"q":"Question?","opts":["A) opt","B) opt","C) opt","D) opt"],"ans":0,"topic":"Topic","exp":"Explanation"}]
   */
  async function _loadQuestionsFromStorage(path, maxCount) {
    try {
      const storage   = window._firebaseStorage;
      const sRef      = window._storageRef;
      const getDLUrl  = window._getDownloadURL;
      if (!storage || !sRef || !getDLUrl) {
        console.warn('[Storage] Firebase Storage not initialised yet');
        return null;
      }
      const fileRef = sRef(storage, path);
      const url     = await getDLUrl(fileRef);
      const res     = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) return null;
      // Shuffle so different users see different question order
      const shuffled = _shuffleArray(data);
      return maxCount ? shuffled.slice(0, maxCount) : shuffled;
    } catch(e) {
      // File doesn't exist or network error — return null so callers can fallback
      return null;
    }
  }

  /* List all available years for an exam from Firebase Storage */
  async function _listStorageYears(exam, folder) {
    try {
      const storage  = window._firebaseStorage;
      const sRef     = window._storageRef;
      const listAllFn = window._listAll;
      if (!storage || !sRef || !listAllFn) return [];
      const dirRef = sRef(storage, (folder || 'pyq') + '/' + exam);
      const result = await listAllFn(dirRef);
      return result.items
        .map(item => item.name.replace('.json', ''))
        .filter(name => /^[0-9]{4}$/.test(name))
        .sort((a, b) => b - a); // newest first
    } catch(e) { return []; }
  }

  /* Fisher-Yates shuffle */
  function _shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ─────────────────────────────────────────────────────────────
   * SECTION 1 — EXAM & CLASS CONFIGS
   * ───────────────────────────────────────────────────────────── */
  const EXAM_CONFIGS = {
    // SSC Exams
    cgl:    { label:'SSC CGL',      color:'#f59e0b', years:[2024,2023,2022,2021,2020], type:'exam' },
    chsl:   { label:'SSC CHSL',     color:'#6C63FF', years:[2024,2023,2022,2021],      type:'exam' },
    gd:     { label:'SSC GD',       color:'#10b981', years:[2024,2023,2022],            type:'exam' },
    mts:    { label:'SSC MTS',      color:'#34d399', years:[2024,2023,2022],            type:'exam' },
    cpo:    { label:'SSC CPO/SI',   color:'#6ee7b7', years:[2024,2023],                type:'exam' },
    // Competitive Exams
    upsc:   { label:'UPSC CSE',     color:'#10b981', years:[2024,2023,2022],            type:'exam' },
    rrb:    { label:'RRB NTPC',     color:'#38bdf8', years:[2024,2023,2022],            type:'exam' },
    ibps:   { label:'IBPS PO',      color:'#a78bfa', years:[2024,2023],                type:'exam' },
    cuet:   { label:'CUET',         color:'#FF6B9D', years:[2024,2023],                type:'exam' },
    cds:    { label:'CDS',          color:'#fb923c', years:[2024,2023],                type:'exam' },
    nda:    { label:'NDA',          color:'#34d399', years:[2024,2023],                type:'exam' },
    cat:    { label:'CAT/MBA',      color:'#f97316', years:[2024,2023],                type:'exam' },
    gate:   { label:'GATE',         color:'#8b5cf6', years:[2024,2023],                type:'exam' },
    jee:    { label:'JEE Main/Adv', color:'#06b6d4', years:[2024,2023,2022],           type:'exam' },
    neet:   { label:'NEET UG',      color:'#ec4899', years:[2024,2023,2022],           type:'exam' },
    // School Classes 1-5
    class1:  { label:'Class 1',     color:'#fbbf24', subjects:['English','Maths','EVS','Hindi'], type:'class' },
    class2:  { label:'Class 2',     color:'#f97316', subjects:['English','Maths','EVS','Hindi'], type:'class' },
    class3:  { label:'Class 3',     color:'#10b981', subjects:['English','Maths','EVS','Hindi'], type:'class' },
    class4:  { label:'Class 4',     color:'#06b6d4', subjects:['English','Maths','Science','Social Studies','Hindi'], type:'class' },
    class5:  { label:'Class 5',     color:'#8b5cf6', subjects:['English','Maths','Science','Social Studies','Hindi'], type:'class' },
    // School Classes 6-8
    class6:  { label:'Class 6',     color:'#60a5fa', subjects:['Maths','Science','English','Social Science','Hindi'], type:'class' },
    class7:  { label:'Class 7',     color:'#818cf8', subjects:['Maths','Science','English','Social Science','Hindi'], type:'class' },
    class8:  { label:'Class 8',     color:'#c084fc', subjects:['Maths','Science','English','Social Science','Hindi'], type:'class' },
    // School Classes 9-12
    class9:  { label:'Class 9',     color:'#f472b6', subjects:['Maths','Science','English','Social Science','Hindi'], type:'class' },
    class10: { label:'Class 10',    color:'#fb7185', subjects:['Maths','Science','English','Social Science','Hindi'], type:'class' },
    class11_sci: { label:'Class 11 Science', color:'#fbbf24', subjects:['Physics','Chemistry','Maths','Biology','English'], type:'class' },
    class11_com: { label:'Class 11 Commerce', color:'#f59e0b', subjects:['Accountancy','Business Studies','Economics','English','Maths'], type:'class' },
    class11_arts: { label:'Class 11 Arts', color:'#fb923c', subjects:['History','Geography','Political Science','Economics','English'], type:'class' },
    class11: { label:'Class 11',    color:'#fbbf24', subjects:['Physics','Chemistry','Maths','Biology','English','Economics','Accountancy'], type:'class' },
    class12_sci: { label:'Class 12 Science', color:'#4ade80', subjects:['Physics','Chemistry','Maths','Biology','English'], type:'class' },
    class12_com: { label:'Class 12 Commerce', color:'#22c55e', subjects:['Accountancy','Business Studies','Economics','English','Maths'], type:'class' },
    class12_arts: { label:'Class 12 Arts', color:'#86efac', subjects:['History','Geography','Political Science','Economics','English'], type:'class' },
    class12: { label:'Class 12',    color:'#4ade80', subjects:['Physics','Chemistry','Maths','Biology','English','Economics','Accountancy'], type:'class' },

  };

  /* ─────────────────────────────────────────────────────────────
   * SECTION 2 — DEEPSEEK AI HELPERS
   * ───────────────────────────────────────────────────────────── */
  async function callDeepSeek(prompt, maxTokens = 800) {
    const res = await fetch(DS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7,
        model: 'deepseek-chat',
        mode: 'cgl',
        lang: 'hinglish'
      })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData?.code === 'MAINTENANCE') {
        if (typeof window.showMaintenanceOverlay === 'function') window.showMaintenanceOverlay();
        const e = new Error('AI service temporarily unavailable');
        e.isMaintenance = true;
        throw e;
      }
      return null;
    }
    const d = await res.json();
    return d.choices?.[0]?.message?.content || null;
  }

  /* ── Robust JSON array extractor (handles truncated AI output) ── */
  function extractJsonArray(text) {
    if (!text) return null;
    let s = text.replace(/```json|```/gi, '').trim();
    try { const r = JSON.parse(s); if (Array.isArray(r) && r.length) return r; } catch {}
    const start = s.indexOf('[');
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') { depth--; if (!depth) { end = i; break; } }
    }
    if (end !== -1) {
      try { const r = JSON.parse(s.slice(start, end + 1)); if (Array.isArray(r) && r.length) return r; } catch {}
    }
    return null;
  }

  /* Single DeepSeek call with small token budget */
  async function fetchSmallBatch(prompt, maxTokens) {
    try { return extractJsonArray(await callDeepSeek(prompt, maxTokens || 700)) || []; }
    catch (e) { if (e.isMaintenance) throw e; return []; }
  }

  /* Fetch PYQ questions — 5 Qs, single fast call, cached */
  async function fetchQuestionsFromAI(exam, year, count) {
    count = count || 5;
    const cacheKey = 'pyq_cache_' + exam + '_' + year;
    const cached = lsGet(cacheKey, 'null');
    if (cached && Array.isArray(cached) && cached.length >= count) return cached;
    const conf = EXAM_CONFIGS[exam];
    let context;
    if (conf && conf.type === 'class') {
      context = conf.label + ' NCERT board exam';
    } else {
      context = (conf ? conf.label : exam) + ' ' + year;
    }
    const prompt = 'Generate exactly ' + count + ' MCQs for ' + context + '. Return ONLY a JSON array, no markdown.\n[{"q":"...","opts":["A","B","C","D"],"ans":0,"topic":"...","exp":"..."}]';
    return null;
  }

  /* ── Question cycling tracker ──────────────────────────────────
   * Tracks which question IDs have been shown per exam+type.
   * When all questions are exhausted, resets and starts over.
   * Stored in sessionStorage so it resets on page reload but
   * persists across mock test restarts within the same session.
   * ──────────────────────────────────────────────────────────── */
  const _seenTracker = {
    _key(exam, type) { return 'crackai_seen_' + type + '_' + exam; },
    getSeenIds(exam, type) {
      try { return new Set(JSON.parse(sessionStorage.getItem(this._key(exam, type)) || '[]')); }
      catch(e) { return new Set(); }
    },
    markSeen(exam, type, ids) {
      try {
        const seen = this.getSeenIds(exam, type);
        ids.forEach(id => seen.add(id));
        sessionStorage.setItem(this._key(exam, type), JSON.stringify([...seen]));
      } catch(e) {}
    },
    reset(exam, type) {
      try { sessionStorage.removeItem(this._key(exam, type)); } catch(e) {}
    },
    /** Pick `count` unseen questions from `allQs`, cycling when exhausted */
    pick(exam, type, allQs, count) {
      if (!allQs || !allQs.length) return [];
      let seen = this.getSeenIds(exam, type);
      let unseen = allQs.filter(q => !seen.has(q.id || q.q));
      // If not enough unseen, reset and use full pool
      if (unseen.length < count) {
        this.reset(exam, type);
        seen = new Set();
        unseen = allQs.slice();
      }
      // Fisher-Yates shuffle on unseen pool
      const shuffled = _shuffleArray(unseen);
      const picked = shuffled.slice(0, count);
      this.markSeen(exam, type, picked.map(q => q.id || q.q));
      return picked;
    }
  };

  /* ── ALL-questions pool cache (no expiry — just raw list) ────
   * We cache the full question list separately from the daily slice
   * so we can always shuffle fresh subsets from the full pool.      */
  const _poolCache = {};

  async function _loadFullPool(exam, type) {
    const key = type + '_' + exam;
    if (_poolCache[key]) return _poolCache[key];
    const paths = [
      type + '/' + exam + '/questions.json',
      'mock/' + exam + '/questions.json',
    ];
    for (const path of paths) {
      try {
        const storage  = window._firebaseStorage;
        const sRef     = window._storageRef;
        const getDLUrl = window._getDownloadURL;
        if (!storage || !sRef || !getDLUrl) continue;
        const fileRef = sRef(storage, path);
        const url     = await getDLUrl(fileRef);
        const res     = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          // Normalize IDs so tracker works reliably
          const pool = data.map((q, i) => ({ ...q, id: q.id || q.q || (type + '_' + exam + '_' + i) }));
          _poolCache[key] = pool;
          return pool;
        }
      } catch(_) {}
    }
    return null;
  }

  /* Fetch mock test questions from Firebase Storage */
  async function fetchMockQuestionsFromAI(exam, count) {
    count = count || 40;
    try {
      const pool = await _loadFullPool(exam, 'mock');
      if (pool && pool.length) {
        // Pick unseen questions, cycling when all are exhausted
        const picked = _seenTracker.pick(exam, 'mock', pool, count);
        if (picked.length) return picked;
      }
      return null;
    } catch(e) { return null; }
  }

  /* ─────────────────────────────────────────────────────────────
   * SECTION 3 — XP & GAMIFICATION ENGINE
   * ───────────────────────────────────────────────────────────── */
  const XP = {
    get() { return lsGet('xp', '0') || 0; },
    add(n) {
      const cur = this.get();
      const newXP = cur + n;
      lsSet('xp', newXP);
      this._showGain(n);
      try {
        if (typeof updateUserUI === 'function') updateUserUI();
        if (typeof updateProfileUI === 'function' && document.getElementById('profileModal')?.classList.contains('active')) updateProfileUI();
      } catch(e) {}
      
      // ✅ FIX: Sync XP to Firebase immediately after adding
      try {
        const uid = window._firebaseAuth && window._firebaseAuth.currentUser ? window._firebaseAuth.currentUser.uid : null;
        if (uid && typeof window._syncXPToFirebase === 'function') {
          // Call sync function from battle-arena-patch.js
          window._syncXPToFirebase(uid, n, 'Mock Test 📝');
        }
      } catch(e) {}
      
      return newXP;
    },
    level() {
      const xp = this.get();
      if (xp < 1000) return 1;
      if (xp < 2000) return 5;
      if (xp < 3000) return 10;
      if (xp < 4000) return 15;
      if (xp < 5000) return 20;
      if (xp < 7000) return 25;
      if (xp < 10000) return 30;
      if (xp < 15000) return 35;
      if (xp < 20000) return 40;
      return Math.min(100, 40 + Math.floor((xp - 20000) / 5000));
    },
    _showGain(n) {
      const el = document.createElement('div');
      el.textContent = '+' + n + ' XP';
      el.style.cssText='position:fixed;bottom:130px;right:20px;background:linear-gradient(135deg,#f59e0b,#FF6B9D);color:var(--text-primary);font-family:"Space Grotesk",sans-serif;font-size:13px;font-weight:700;padding:6px 14px;border-radius:20px;z-index:99990;animation:xpPop 1.5s ease forwards;pointer-events:none;';
      if (!document.getElementById('xpPopStyle')) {
        const s = document.createElement('style');
        s.id = 'xpPopStyle';
        s.textContent = '@keyframes xpPop{0%{opacity:0;transform:translateY(0) scale(0.8)}20%{opacity:1;transform:translateY(-10px) scale(1.1)}80%{opacity:1;transform:translateY(-20px) scale(1)}100%{opacity:0;transform:translateY(-35px) scale(0.9)}}';
        document.head.appendChild(s);
      }
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1600);
    }
  };

  /* ─────────────────────────────────────────────────────────────
   * SECTION 4 — WEAK TOPIC TRACKER
   * ───────────────────────────────────────────────────────────── */
  const WeakTopics = {
    _key: 'weak_topics',
    get()  { return lsGet(this._key, '{}') || {}; },
    record(topic, correct) {
      const data = this.get();
      if (!data[topic]) data[topic] = { attempts:0, correct:0 };
      data[topic].attempts++;
      if (correct) data[topic].correct++;
      lsSet(this._key, data);
    },
    getSorted() {
      const data = this.get();
      return Object.entries(data)
        .map(([t, d]) => ({ topic:t, accuracy: d.attempts ? Math.round(d.correct/d.attempts*100) : 0, attempts: d.attempts }))
        .sort((a,b) => a.accuracy - b.accuracy);
    },
    getWeakest(n=3) { return this.getSorted().filter(t=>t.attempts>=2).slice(0,n); }
  };

  /* ─────────────────────────────────────────────────────────────
   * SECTION 5 — DAILY GOAL SYSTEM
   * ───────────────────────────────────────────────────────────── */
  const DailyGoal = {
    GOAL: 10,
    todayKey() { return 'daily_' + new Date().toDateString().replace(/ /g,'_'); },
    getTodayCount() { return lsGet(this.todayKey(), '0') || 0; },
    increment() {
      const k = this.todayKey();
      const n = (lsGet(k,'0')||0) + 1;
      lsSet(k, n);
      if (n === this.GOAL) { toast('🎯 Daily goal reached! +50 XP 🔥', 3500); confetti(); XP.add(50); }
      else if (n < this.GOAL) { XP.add(5); }
      this.updateBadge();
      return n;
    },
    updateBadge() {
      const n = this.getTodayCount();
      const el = document.getElementById('cf-daily-badge');
      if (el) el.textContent = n + '/' + this.GOAL;
      const bar = document.getElementById('cf-goal-bar');
      if (bar) bar.style.width = Math.min(100, n/this.GOAL*100) + '%';
    }
  };

  /* ─────────────────────────────────────────────────────────────
   * SECTION 6 — SCORE PREDICTOR
   * ───────────────────────────────────────────────────────────── */
  const ScorePredictor = {
    CUTOFFS: {
      cgl:  { tier1:{ gen:160, obc:152, sc:142, st:130 }, tier2:{ gen:720, obc:680, sc:620, st:590 } },
      chsl: { ldc:{ gen:175, obc:164, sc:151, st:141 }, jsa:{ gen:177, obc:166, sc:156, st:145 } },
      rrb:  { gen:80, obc:75, sc:68, st:62 },
      ibps: { gen:60, obc:55, sc:50, st:48 },
    },
    predict(exam, score, maxScore, category='gen') {
      const co = this.CUTOFFS[exam];
      if (!co) return null;
      const examCo = co.tier1 || co.ldc || co;
      const cutoff = examCo[category] || examCo.gen || 150;
      const pct = (score / maxScore) * 100;
      const rank = Math.max(1, Math.round((1 - pct/100) * 850000));
      return { score, pct: pct.toFixed(1), rank, cutoff, safe: score >= cutoff, gap: Math.abs(score - cutoff) };
    }
  };

  /* ─────────────────────────────────────────────────────────────
   * SECTION 7 — REFERRAL SYSTEM
   * ───────────────────────────────────────────────────────────── */
  const Referral = {
    REWARD_DAYS: 7,
    REFS_NEEDED: 3,

    getCode() {
      let code = lsGet('ref_code', 'null');
      if (!code) {
        const base = uid().replace(/[^a-z0-9]/gi,'').substring(0,6).toUpperCase() || Math.random().toString(36).substring(2,8).toUpperCase();
        code = 'CRACK' + base;
        lsSet('ref_code', code);
      }
      return code;
    },

    getReferralCount() { return lsGet('ref_count', '0') || 0; },

    /* Apply a referral code — writes to Firestore for real server-side credit */
    async applyReferral(code) {
      code = (code||'').trim().toUpperCase();
      if (!code || code.length < 5) { toast('⚠️ Enter a valid referral code.'); return; }
      if (lsGet('ref_used', 'null')) { toast('⚠️ You already used a referral code.'); return; }
      const myCode = this.getCode();
      if (code === myCode) { toast('⚠️ You cannot use your own code!'); return; }
      const myUid = uid();
      if (myUid === 'guest') { toast('⚠️ Please login first!'); return; }

      const btn = document.getElementById('cf-ref-apply-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Applying…'; }

      try {
        const db = window._firebaseDb;
        const fns = window._firebaseFns;
        if (!db || !fns) throw new Error('Firebase not ready');
        const { doc, getDoc, updateDoc, setDoc, arrayUnion, collection, query, where, getDocs } = fns;

        // Find referrer by code
        const q = query(collection(db, 'users'), where('referralCode', '==', code));
        const snap = await getDocs(q);
        if (snap.empty) {
          toast('❌ Referral code not found. Double-check and try again.');
          if (btn) { btn.disabled = false; btn.textContent = 'Apply Code'; }
          return;
        }

        const referrerDoc = snap.docs[0];
        const referrerUid = referrerDoc.id;
        const referrerData = referrerDoc.data();

        // Prevent using same person's code twice
        const alreadyReferred = (referrerData.referredUsers||[]).includes(myUid);
        if (alreadyReferred) { toast('⚠️ You already used this person\'s code.'); if (btn) { btn.disabled = false; btn.textContent = 'Apply Code'; } return; }

        // Save usage on current user's doc
        const myName = getMyName();
        await setDoc(doc(db, 'users', myUid), {
          referredBy: referrerUid, referredByCode: code,
          name: myName, uid: myUid, updatedAt: Date.now()
        }, { merge: true });

        // Increment referrer count
        const newCount = (referrerData.referralCount || 0) + 1;
        const unlockTools = newCount >= this.REFS_NEEDED;
        await updateDoc(doc(db, 'users', referrerUid), {
          referralCount: newCount,
          referredUsers: arrayUnion(myUid),
          ...(unlockTools ? { refToolsUnlocked: true } : {})
        });

        lsSet('ref_used', code);
        toast('✅ Referral code applied! Your friend gets credit. Welcome! 🎉', 4000);
        CF._renderReferral();
      } catch(e) {
        console.error('[Referral]', e);
        toast('❌ Could not apply code. Try again shortly.');
        if (btn) { btn.disabled = false; btn.textContent = 'Apply Code'; }
      }
    },

    /* Register this user's referral code in Firestore on login */
    async registerMyCode() {
      const myUid = uid();
      if (myUid === 'guest') return;
      const code = this.getCode();
      try {
        const db = window._firebaseDb;
        const fns = window._firebaseFns;
        if (!db || !fns) return;
        const { doc, setDoc } = fns;
        const myName = getMyName();
        await setDoc(doc(db, 'users', myUid), {
          referralCode: code, name: myName, uid: myUid, updatedAt: Date.now()
        }, { merge: true });
      } catch(e) {}
    },

    /* Sync referral count from Firestore */
    async syncCount() {
      const myUid = uid();
      if (myUid === 'guest') return 0;
      try {
        const db = window._firebaseDb;
        const fns = window._firebaseFns;
        if (!db || !fns) return 0;
        const { doc, getDoc } = fns;
        const snap = await getDoc(doc(db, 'users', myUid));
        if (!snap.exists()) return 0;
        const data = snap.data();
        const count = data.referralCount || 0;
        lsSet('ref_count', count);
        if (data.refToolsUnlocked) lsSet('ref_tools_unlocked', true);
        return count;
      } catch(e) { return 0; }
    },

    registerReferral() {
      const n = (lsGet('ref_count','0')||0) + 1;
      lsSet('ref_count', n);
      if (n >= this.REFS_NEEDED) {
        lsSet('ref_tools_unlocked', true);
        toast('🎉 3 referrals complete! PYQ Bank & Mock Test unlocked! 🏆', 4000);
        if (typeof _doConfetti === 'function') _doConfetti();
      } else {
        toast('👥 Referral registered! ' + n + '/' + this.REFS_NEEDED + ' done.', 3000);
      }
    },

    getShareText() {
      return 'Join CrackAI — India\'s smartest exam prep app! Use my code ' + this.getCode() + ' to get bonus access 🚀\nhttps://easyfreepdf.online/?ref=' + this.getCode();
    },
    getShareUrl() { return 'https://easyfreepdf.online/?ref=' + this.getCode(); },
    inviteViaWhatsApp() {
      window.open('https://wa.me/?text=' + encodeURIComponent(this.getShareText()), '_blank');
    },
    copyInviteLink() {
      const url = this.getShareUrl();
      try {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(url).then(() => toast('📋 Invite link copied!')).catch(() => _fallbackCopy(url));
        } else { _fallbackCopy(url); }
      } catch(e) { toast('⚠️ Copy manually: ' + url, 4000); }
    }
  };

  function _fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy'); ta.remove();
    toast('📋 Invite link copied!');
  }

  // Auto-register referral code & sync count after login
  window.addEventListener('firebaseReady', () => {
    setTimeout(() => {
      if (uid() !== 'guest') {
        Referral.registerMyCode();
        Referral.syncCount();
        // Auto-apply pending ref code from URL
        const pending = lsGet('ref_pending_code', 'null');
        if (pending && !lsGet('ref_used', 'null')) {
          setTimeout(() => Referral.applyReferral(pending), 1500);
          lsSet('ref_pending_code', null);
        }
      }
    }, 2500);
  });

  // Capture ?ref= from URL on page load
  (function() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const refCode = urlParams.get('ref');
      if (refCode && refCode.length >= 5) lsSet('ref_pending_code', refCode.toUpperCase());
    } catch(e) {}
  })();

  /* ─────────────────────────────────────────────────────────────
   * SECTION 8 — ANALYTICS ENGINE
   * ───────────────────────────────────────────────────────────── */
  const Analytics = {
    _key: 'analytics_log',
    get() { return lsGet(this._key, '[]') || []; },
    record(event) {
      const log = this.get();
      log.push({ ...event, ts: Date.now(), date: new Date().toDateString() });
      if (log.length > 500) log.splice(0, log.length - 500);
      lsSet(this._key, log);
    },
    getTopicAccuracy() {
      return WeakTopics.getSorted().map(t => ({ ...t, label: t.topic }));
    },
    getWeeklyTrend() {
      const log = this.get();
      const days = {};
      for (let i=6; i>=0; i--) {
        const d = new Date(Date.now() - i*86400000).toDateString();
        days[d] = { correct:0, total:0 };
      }
      log.forEach(e => {
        if (e.type==='answer' && days[e.date] !== undefined) {
          days[e.date].total++;
          if (e.correct) days[e.date].correct++;
        }
      });
      return Object.entries(days).map(([d,v]) => ({
        label: d.split(' ')[0],
        accuracy: v.total ? Math.round(v.correct/v.total*100) : 0,
        total: v.total
      }));
    },
    getAvgTimePerQ() {
      const log = this.get().filter(e=>e.type==='answer'&&e.timeTaken);
      if (!log.length) return 0;
      return Math.round(log.reduce((s,e)=>s+e.timeTaken,0)/log.length);
    }
  };

  /* ─────────────────────────────────────────────────────────────
   * SECTION 9 — STUDY GROUPS (Full Screen) + BATTLE QUIZ ENGINE
   * ───────────────────────────────────────────────────────────── */
const StudyGroups = {
  async create(name, exam) {
    const db = window._firebaseDb;
    const { doc, setDoc, collection } = window._firebaseFns;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const id = 'grp_' + Date.now();
    const myUid = uid();
    const myName = getMyName();
    const group = {
      id, name, exam, code,
      adminUid: myUid,
      members: [myUid],
      memberNames: { [myUid]: myName },
      messages: [],
      quiz: null, // active quiz state
      createdAt: Date.now()
    };
    await setDoc(doc(collection(db, 'studyGroups'), id), group);
    toast('✅ Group "' + name + '" created! Code: ' + code, 4000);
    return group;
  },
  async join(code) {
    const db = window._firebaseDb;
    const { collection, query, where, getDocs, updateDoc, arrayUnion, doc } = window._firebaseFns;
    const q = query(collection(db, 'studyGroups'), where('code', '==', code.toUpperCase()));
    const snap = await getDocs(q);
    if (snap.empty) { toast('❌ Group not found. Check the code.'); return null; }
    const docRef = snap.docs[0].ref;
    const group = snap.docs[0].data();
    const myUid = uid();
    const myName = getMyName();
    if ((group.members || []).includes(myUid)) {
      toast('✅ You are already in "' + group.name + '"!', 3000);
      return { ...group, id: snap.docs[0].id };
    }
    await updateDoc(docRef, {
      members: arrayUnion(myUid),
      ['memberNames.' + myUid]: myName,
      ['memberStats.' + myUid + '.joined']: Date.now(),
      ['memberStats.' + myUid + '.messages']: 0,
      ['memberStats.' + myUid + '.questionsAnswered']: 0,
      ['memberStats.' + myUid + '.lastActive']: Date.now(),
    });
    toast('✅ Joined "' + group.name + '"!', 3000);
    return { ...group, id: snap.docs[0].id };
  },
  async getAll() {
    const db = window._firebaseDb;
    const { collection, query, where, getDocs } = window._firebaseFns;
    const q = query(collection(db, 'studyGroups'), where('members', 'array-contains', uid()));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
  },
  async addMessage(groupId, text) {
    const db = window._firebaseDb;
    const { doc, updateDoc, arrayUnion, increment } = window._firebaseFns;
    const myUid = uid();
    const myName = getMyName();
    const msg = { uid: myUid, name: myName, text, ts: Date.now() };
    // Update message array + memberNames + activity stats for admin dashboard
    const update = {
      messages: arrayUnion(msg),
      ['memberNames.' + myUid]: myName,
      ['memberStats.' + myUid + '.lastActive']: Date.now(),
    };
    // Use increment if available (Firestore), else skip counter
    try { update['memberStats.' + myUid + '.messages'] = increment(1); } catch(e) {}
    await updateDoc(doc(db, 'studyGroups', groupId), update);
  },
  /* ── Start a mock battle (admin only) — questions from Firebase Storage mock/ ── */
  async startQuiz(groupId, type, exam) {
    // Always use 'mock' type — fetch from Firebase Storage mock/{exam}/ folder
    toast('🤖 Loading mock questions from question bank…', 3000);
    let questions = [];
    try {
      if (typeof QuestionService !== 'undefined') {
        questions = await QuestionService.loadMockTest(exam, 10);
      }
    } catch(e) {}
    if (!questions || questions.length < 5) {
      try { questions = await _generateQuizQuestions(exam, 10, 'mock'); } catch(e) {}
    }
    if (!questions || !questions.length) { toast('❌ No mock questions found. Upload questions to mock/' + exam + '/ in Firebase Storage.', 5000); return; }
    // Normalize
    const normalized = questions.map(q => ({
      q: q.q || q.question || '',
      opts: q.opts || q.options || [],
      ans: typeof q.ans === 'number' ? q.ans : (typeof q.answerIndex === 'number' ? q.answerIndex : 0),
      exp: q.exp || q.explanation || '',
      topic: q.topic || q.subject || 'General',
    })).filter(q => q.q && q.opts.length >= 2);
    if (!normalized.length) { toast('❌ Question format error.', 4000); return; }
    const db = window._firebaseDb;
    const { doc, updateDoc } = window._firebaseFns;
    const quiz = {
      type: 'mock',
      exam,
      questions: normalized,
      current: 0,
      status: 'countdown',
      answers: {},
      xp: {},
      startedAt: Date.now(),
      questionStartedAt: Date.now(),
      startedBy: uid(),
      countdownAt: Date.now(),
    };
    await updateDoc(doc(db, 'studyGroups', groupId), { quiz });
    toast('🚀 Battle starting! 3-2-1…', 3000);
  },
  /* ── Submit an answer in mock battle ────────────────────── */
  async submitAnswer(groupId, quiz, qIdx, chosenIdx) {
    if (!quiz || quiz.status !== 'active') return;
    if (quiz.answers && quiz.answers[qIdx]) return;
    const db = window._firebaseDb;
    const { doc, updateDoc } = window._firebaseFns;
    const myUid = uid();
    const myName = getMyName();
    const q = quiz.questions[qIdx];
    const correct = (chosenIdx === q.ans);
    const xpDelta = correct ? 10 : -3;
    const currentXP = (quiz.xp && quiz.xp[myUid]) || 0;
    const newXP = Math.max(0, currentXP + xpDelta);
    const nextIdx = qIdx + 1;
    const isLast = nextIdx >= quiz.questions.length;
    const updates = {
      ['quiz.answers.' + qIdx]: { uid: myUid, name: myName, chosen: chosenIdx, correct, ts: Date.now() },
      ['quiz.xp.' + myUid]: newXP,
      ['quiz.current']: isLast ? qIdx : nextIdx,
      ['quiz.status']: isLast ? 'finished' : 'active',
      ['quiz.questionStartedAt']: isLast ? (quiz.questionStartedAt || Date.now()) : Date.now(),
    };
    await updateDoc(doc(db, 'studyGroups', groupId), updates);
  }
};

/* Fetch quiz questions — shared helper */
async function _generateQuizQuestions(exam, count, type) {
  count = count || 10;
  try {
    const trackType = 'group_' + (type || 'mock');
    const pool = await _loadFullPool(exam, type === 'pyq' ? 'pyq' : 'mock');
    if (pool && pool.length) {
      const picked = _seenTracker.pick(exam, trackType, pool, count);
      if (picked.length) return picked;
    }
    return [];
  } catch(e) { return []; }
}

  /* ─────────────────────────────────────────────────────────────
   * SECTION 10 — MOCK TEST ENGINE (DeepSeek-powered)
   * ───────────────────────────────────────────────────────────── */
  const MockTest = {
    _state: null,
    async loadQuestions(exam, count) {
      // Load from Firebase Storage
      const storageQs = await fetchMockQuestionsFromAI(exam, count);
      console.log("STORAGE QUESTIONS:", storageQs);
      if (storageQs && storageQs.length > 0) {
  return storageQs.map(q => {
    // FIX: Ensure ans is always a number, handle both string and numeric answers
    let ansIndex = 0;
    if (q.ans !== undefined && q.ans !== null) {
      ansIndex = typeof q.ans === 'string' ? parseInt(q.ans, 10) : Number(q.ans);
      if (isNaN(ansIndex)) ansIndex = (q.options || []).indexOf(q.answer);
    } else if (q.answer !== undefined && q.answer !== null) {
      ansIndex = (q.options || []).indexOf(q.answer);
    }
    // Ensure ansIndex is in valid range [0, 3]
    ansIndex = Math.max(0, Math.min(3, ansIndex));
    return {
      q: q.question,
      opts: q.options,
      ans: ansIndex,
      exp: q.explanation || "",
      topic: q.subject || ""
    };
  });
}
      // Fallback if storage empty
      return Array.from({length: Math.min(count, 5)}, (_, i) => ({
        q: `Question ${i+1} — Questions loading from storage... (check connection)`,
        opts: ['Option A', 'Option B', 'Option C', 'Option D'],
        ans: 0, topic: 'General', exp: 'Please ensure questions are uploaded to Firebase Storage.'
      }));
    },
    async start(exam, count=10) {
      this._state = {
        exam, questions: [],
        current: 0, answers: {}, startTime: Date.now(),
        timeLimit: count * 90 * 1000,
        qStartTime: Date.now(),
        loading: true
      };
      CF.openMockTest();
      CF._renderMockLoading();
      const qs = await this.loadQuestions(exam, count);
      this._state.questions = qs;
      this._state.loading = false;
      // Track usage ONLY when test actually starts (questions loaded)
      if (typeof window.trackMockTestUsage === 'function') {
        window.trackMockTestUsage();
      }
      CF._renderMockQuestion();
    },
    answer(qi, ai) {
      if (!this._state) return;
      const timeTaken = Math.round((Date.now() - this._state.qStartTime) / 1000);
      this._state.answers[qi] = { chosen: ai, timeTaken };
      const q = this._state.questions[qi];
      // FIX: Ensure numeric comparison for correct answer checking
      const answerIndex = typeof ai === 'string' ? parseInt(ai, 10) : Number(ai);
      const correctIndex = typeof q.ans === 'string' ? parseInt(q.ans, 10) : Number(q.ans);
      const correct = answerIndex === correctIndex;
      WeakTopics.record(q.topic, correct);
      Analytics.record({ type:'answer', topic:q.topic, correct, timeTaken });
      // Only increment daily goal for correct answers
      if (correct) {
        DailyGoal.increment();
      }
    },
    getResults() {
      if (!this._state) return null;
      const qs = this._state.questions;
      let correct=0, wrong=0, skipped=0;
      qs.forEach((q,i) => {
        const a = this._state.answers[i];
        if (!a) skipped++;
        else {
          // FIX: Ensure numeric comparison for result calculation
          const answerIndex = typeof a.chosen === 'string' ? parseInt(a.chosen, 10) : Number(a.chosen);
          const correctIndex = typeof q.ans === 'string' ? parseInt(q.ans, 10) : Number(q.ans);
          if (answerIndex === correctIndex) correct++;
          else wrong++;
        }
      });
      const rawScore = correct * 2 - wrong * 0.5;
      const timeTaken = Math.round((Date.now()-this._state.startTime)/1000);
      return { correct, wrong, skipped, total:qs.length, rawScore, timeTaken,
        prediction: ScorePredictor.predict(this._state.exam, rawScore, qs.length*2) };
    },
    async getAIReview(results) {
      try {
        const weak = WeakTopics.getWeakest(3).map(t=>t.topic).join(', ');
        const prompt = `Student completed a mock test. Results: ${results.correct}/${results.total} correct, ${results.wrong} wrong, score=${results.rawScore.toFixed(1)}. Weakest topics: ${weak||'N/A'}. Time taken: ${Math.floor(results.timeTaken/60)} min. Provide a 5-line Hinglish improvement plan with specific tips. Be encouraging.`;
        const text = await callDeepSeek(prompt, 400);
        return text || 'Great effort! Keep practicing daily.';
      } catch { return 'Bahut acha kiya! Weak topics pe focus karo aur daily 10 questions practice karo. 💪'; }
    }
  };

  /* ─────────────────────────────────────────────────────────────
   * SECTION 11 — GLOBAL CF OBJECT (Public API)
   * ───────────────────────────────────────────────────────────── */
  const CF = window.CF = {
    openModal(id) {
      document.getElementById(id)?.classList.add('cf-active');
      document.body.style.overflow = 'hidden';
    },
    closeModal(id) {
      document.getElementById(id)?.classList.remove('cf-active');
      if (id === 'cf-groups-modal') CF._stopChatPolling();
      const others = document.querySelectorAll('.cf-modal.cf-active');
      if (!others.length) document.body.style.overflow = '';
    },
    openPYQ() {
      return; // PYQ Bank feature removed
    },
    openMockTest() {
      // Prevent multiple calls
      if (this._mockTestOpening) return;
      this._mockTestOpening = true;
      setTimeout(() => { this._mockTestOpening = false; }, 100);
      
      // Check 3 FREE daily access from strict-gate-patch
      if (typeof window.checkMockTestAccess === 'function') {
        window.checkMockTestAccess().then(access => {
          if (!access.allowed) {
            toast(access.reason);
            if (typeof openPremiumModal === 'function') openPremiumModal();
            return;
          }
          // Show remaining free tests before opening
          if (access.remaining !== undefined) {
            toast(`📝 You have ${access.remaining} free mock tests remaining today (3/day)`);
          }
          // Track and open (only track on actual start, not on modal open)
          CF.openModal('cf-mock-modal');
          CF._renderMockTest();
        });
      } else {
        // Fallback if strict-gate-patch not loaded
        CF.openModal('cf-mock-modal');
        CF._renderMockTest();
      }
    },
    openAnalytics() {
      if (needsPremium('Analytics')) return;
      CF.openModal('cf-analytics-modal'); CF._renderAnalytics();
    },

    openReferral() { CF.openModal('cf-referral-modal'); CF._renderReferral(); },
    openDailyGoal() { CF.openModal('cf-daily-modal'); CF._renderDailyGoal(); },
    openScorePredictor() { /* FREE for all users — no premium gate */ CF.openModal('cf-score-modal'); CF._renderScorePredictor(); },
    openExamExpansion() {
      if (needsPremium('Exam & Classes')) return;
      CF.openModal('cf-exam-modal'); CF._renderExamExpansion();
    },

    toast(msg) { toast(msg); },

    /* ── PYQ RENDERING ── */
    _pyqState: { exam:null, year:null },
    _renderPYQHome() {
      const body = document.getElementById('cf-pyq-modal_body');
      if (!body) return;
      // Include all study modes: exams, classes
      const exams = Object.entries(EXAM_CONFIGS).filter(([k,v])=>v.type==='exam'||v.type==='class');
      const sscExams = exams.filter(([k,v])=>['cgl','chsl','gd','mts','cpo'].includes(k));
      const compExams = exams.filter(([k,v])=>v.type==='exam'&&!['cgl','chsl','gd','mts','cpo'].includes(k));
      const classExams = exams.filter(([k,v])=>v.type==='class');
      function chipGroup(label, arr) {
        if (!arr.length) return '';
        return `<div class="cf-section-label" style="margin-top:14px">${label}</div><div class="cf-exam-grid">${arr.map(([k,v])=>`<button class="cf-exam-chip" style="--ec:${v.color}" onclick="CF._renderPYQYears('${k}')">${v.label}</button>`).join('')}</div>`;
      }
      body.innerHTML = `
        <div class="cf-section-label">📚 Select Study Mode</div>
        ${chipGroup('⚔️ SSC Exams', sscExams)}
        ${chipGroup('📋 Competitive Exams', compExams)}
        ${chipGroup('📖 Class 1–12', classExams)}
        <div id="cf-pyq-years" style="margin-top:18px"></div>
        <div id="cf-pyq-questions" style="margin-top:12px"></div>`;
    },
    _renderPYQYears(exam) {
      this._pyqState.exam = exam;
      const conf = EXAM_CONFIGS[exam];
      const el = document.getElementById('cf-pyq-years');
      if (!el) return;
      // Show config years first, then try to load available years from Storage
      const staticYears = (conf.years || [new Date().getFullYear(), new Date().getFullYear()-1]);
      el.innerHTML = `
        <div class="cf-section-label">${conf.label} — Select Year</div>
        <div class="cf-year-row" id="cf-year-btns">
          ${staticYears.map(y=>`<button class="cf-year-btn" onclick="CF._loadPYQQuestions('${exam}',${y})">${y}</button>`).join('')}
        </div>`;
      document.getElementById('cf-pyq-questions').innerHTML = '';
      // Also load available files from Storage to show extra years
      _listStorageYears(exam, 'pyq').then(storageYears => {
        const el2 = document.getElementById('cf-year-btns');
        if (!el2 || !storageYears.length) return;
        const allYears = [...new Set([...storageYears, ...staticYears])].sort((a,b)=>b-a);
        el2.innerHTML = allYears.map(y=>`<button class="cf-year-btn" onclick="CF._loadPYQQuestions('${exam}',${y})">${y}</button>`).join('');
      }).catch(()=>{});
    },
    async _loadPYQQuestions(exam, year) {
      const el = document.getElementById('cf-pyq-questions');
      if (!el) return;
      el.innerHTML = `<div class="cf-loading-wrap"><div class="cf-spinner"></div><p class="cf-muted">Loading ${EXAM_CONFIGS[exam].label} ${year} questions...</p></div>`;
      const qs = await fetchQuestionsFromAI(exam, year, 10);
      if (!qs) {
        el.innerHTML = `<div class="cf-muted" style="padding:16px">❌ Could not load questions. Check your connection and try again.</div>`;
        return;
      }
      this._pyqState = { exam, year, qs };
      el.innerHTML = `
        <div class="cf-section-label">${EXAM_CONFIGS[exam].label} ${year} — ${qs.length} Questions</div>
        ${qs.map((q,i)=>this._renderPYQCard(q,i,exam,year)).join('')}
        <button class="cf-btn cf-btn-primary" style="margin-top:16px;width:100%" onclick="CF._startPYQPractice('${exam}',${year})">⚡ Mock Test with these Questions</button>`;
    },
    _renderPYQCard(q, i, exam, year) {
      const id = `pyq_${exam}_${year}_${i}`;
      return `
        <div class="cf-q-card" id="${id}">
          <div class="cf-q-num">Q${i+1} <span class="cf-topic-tag">${q.topic||'General'}</span></div>
          <div class="cf-q-text">${q.question || q.q}</div>
          <div class="cf-opts">
            ${(q.options || q.opts || []).map((o,j)=>`<button class="cf-opt" onclick="CF._answerPYQ('${id}',${j},${q.ans},'${(q.exp||'').replace(/'/g,"\\'")}',this)">${String.fromCharCode(65+j)}. ${o}</button>`).join('')}
          </div>
          <div class="cf-exp" id="${id}_exp" style="display:none">💡 ${q.exp||'See explanation above.'}</div>
        </div>`;
    },
    _answerPYQ(cardId, chosen, correct, exp, btn) {
      const card = document.getElementById(cardId);
      if (!card || card.dataset.answered) return;
      card.dataset.answered = '1';
      card.querySelectorAll('.cf-opt').forEach((b,j) => {
        b.disabled = true;
        if (j === correct) b.classList.add('cf-opt-correct');
        else if (b === btn && j !== correct) b.classList.add('cf-opt-wrong');
      });
      const expEl = document.getElementById(cardId+'_exp');
      if (expEl) expEl.style.display = 'block';
      const isCorrect = chosen === correct;
      // Record from pyq state if available
      const ps = this._pyqState;
      if (ps && ps.qs) {
        const parts = cardId.split('_');
        const qi = parseInt(parts[parts.length-1]);
        const q = ps.qs[qi];
        if (q) { WeakTopics.record(q.topic||'General', isCorrect); Analytics.record({type:'answer',topic:q.topic||'General',correct:isCorrect}); DailyGoal.increment(); }
      }
      toast(isCorrect ? '✅ Sahi! +5 XP' : '❌ Galat. Explanation padho!', 2000);
    },
    _startPYQPractice(exam, year) {
      CF.closeModal('cf-pyq-modal');
      MockTest.start(exam, 10);
    },

    /* ── MOCK TEST RENDERING ── */
    _mt: { qi:0, timer:null, elapsed:0 },
    _renderMockLoading() {
      const body = document.getElementById('cf-mock-modal_body');
      if (!body) return;
      body.innerHTML = `
        <div class="cf-loading-wrap" style="min-height:220px">
          <div class="cf-spinner"></div>
          <p class="cf-muted" style="margin-top:16px">Loading questions from question bank...<br><small>This takes a few seconds</small></p>
        </div>`;
    },
    _renderMockTest() {
      const body = document.getElementById('cf-mock-modal_body');
      if (!body) return;
      if (!MockTest._state) {
        // Include all study modes: exams, classes
      const exams = Object.entries(EXAM_CONFIGS).filter(([k,v])=>v.type==='exam'||v.type==='class');
        body.innerHTML = `
          <div class="cf-center-text">
            <div style="font-size:48px;margin-bottom:12px">🎯</div>
            <h3>Timed Mock Test</h3>
            <p class="cf-muted" style="margin:8px 0 20px">Questions from question bank. Marks: +2 correct, −0.5 wrong</p>
            <div style="margin-bottom:20px;text-align:left">
              <div class="cf-section-label">⚔️ SSC Exams</div>
              <div class="cf-exam-grid">${Object.entries(EXAM_CONFIGS).filter(([k,v])=>['cgl','chsl','gd','mts','cpo'].includes(k)).map(([k,v])=>`<button class="cf-exam-chip" style="--ec:${v.color}" onclick="MockTest.start('${k}',10)">${v.label}</button>`).join('')}</div>
              <div class="cf-section-label" style="margin-top:12px">📋 Competitive Exams</div>
              <div class="cf-exam-grid">${Object.entries(EXAM_CONFIGS).filter(([k,v])=>v.type==='exam'&&!['cgl','chsl','gd','mts','cpo'].includes(k)).map(([k,v])=>`<button class="cf-exam-chip" style="--ec:${v.color}" onclick="MockTest.start('${k}',10)">${v.label}</button>`).join('')}</div>
              <div class="cf-section-label" style="margin-top:12px">📖 Class 1–12</div>
              <div class="cf-exam-grid">${Object.entries(EXAM_CONFIGS).filter(([k,v])=>v.type==='class').map(([k,v])=>`<button class="cf-exam-chip" style="--ec:${v.color}" onclick="MockTest.start('${k}',10)">${v.label}</button>`).join('')}</div>
              <div class="cf-section-label" style="margin-top:12px">🎓 College / B.Tech / Diploma</div>

            </div>
            <p class="cf-muted" style="font-size:12px">Duration: 15 min • 10 Questions • +2/−0.5 marking</p>
          </div>`;
        return;
      }
      if (MockTest._state.loading) {
        this._renderMockLoading();
        return;
      }
      this._renderMockQuestion();
    },
    _renderMockQuestion() {
      const body = document.getElementById('cf-mock-modal_body');
      const s = MockTest._state;
      if (!body || !s) return;
      if (s.loading) { this._renderMockLoading(); return; }
      const q = s.questions[s.current];
      if (!q) { CF._renderMockResults(); return; }
      const remaining = s.timeLimit - (Date.now()-s.startTime);
      const mins = Math.floor(remaining/60000);
      const secs = Math.floor((remaining%60000)/1000);
      clearInterval(this._mt.timer);
      s.qStartTime = Date.now();
      body.innerHTML = `
        <div class="cf-mock-header">
          <span class="cf-mock-progress">${s.current+1}/${s.questions.length}</span>
          <div class="cf-mock-timer" id="cf-mock-timer">⏱ ${mins}:${secs<10?'0':''}${secs}</div>
          <span class="cf-topic-tag" style="font-size:11px">${q.topic||'General'}</span>
        </div>
        <div class="cf-mock-bar-wrap"><div class="cf-mock-bar" style="width:${(s.current/s.questions.length)*100}%"></div></div>
        <div class="cf-q-text" style="margin:16px 0;font-size:16px;font-weight:600">${q.question || q.q}</div>
        <div class="cf-opts" id="cf-mock-opts">
          ${(q.options || q.opts || []).map((o,j)=>`<button class="cf-opt" onclick="CF._mockAnswer(${j})">${String.fromCharCode(65+j)}. ${o}</button>`).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="cf-btn cf-btn-ghost" onclick="CF._mockSkip()">Skip →</button>
          <button class="cf-btn cf-btn-danger" onclick="if(confirm('End test?')){CF._renderMockResults()}">End Test</button>
        </div>`;
      this._mt.timer = setInterval(() => {
        const rem = MockTest._state.timeLimit - (Date.now()-MockTest._state.startTime);
        const timerEl = document.getElementById('cf-mock-timer');
        if (!timerEl) { clearInterval(this._mt.timer); return; }
        if (rem <= 0) { clearInterval(this._mt.timer); CF._renderMockResults(); return; }
        const m=Math.floor(rem/60000), ss=Math.floor((rem%60000)/1000);
        timerEl.textContent = '⏱ '+m+':'+(ss<10?'0':'')+ss;
        if (rem < 300000) timerEl.style.color='#ef4444';
      }, 1000);
    },
    _mockAnswer(ai) {
      const s = MockTest._state;
      if (!s) return;
      const qi = s.current;
      const q = s.questions[qi];
      // FIX: Ensure numeric comparison - convert ai to number if needed
      const answerIndex = typeof ai === 'string' ? parseInt(ai, 10) : Number(ai);
      const correctIndex = typeof q.ans === 'string' ? parseInt(q.ans, 10) : Number(q.ans);
      MockTest.answer(qi, answerIndex);
      // Show green/red feedback on all options before advancing
      const optsEl = document.getElementById('cf-mock-opts');
      if (optsEl) {
        optsEl.querySelectorAll('.cf-opt').forEach((b, j) => {
          b.disabled = true;
          // FIX: Use numeric comparison with corrected indices
          if (j === correctIndex) b.classList.add('cf-opt-correct');
          else if (j === answerIndex && j !== correctIndex) b.classList.add('cf-opt-wrong');
        });
        // Show brief explanation if available
        if (q.exp) {
          const expDiv = document.createElement('div');
          expDiv.className = 'cf-exp';
          expDiv.style.cssText = 'margin-top:10px;padding:10px 14px;border-radius:8px;background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.2);font-size:13px;color:var(--text-secondary,rgba(240,240,245,0.7))';
          expDiv.textContent = '💡 ' + q.exp;
          optsEl.parentNode.insertBefore(expDiv, optsEl.nextSibling);
        }
      }
      setTimeout(function() {
        s.current++;
        if (s.current >= s.questions.length) { clearInterval(CF._mt.timer); CF._renderMockResults(); }
        else CF._renderMockQuestion();
      }, 900);
    },
    _mockSkip() {
      const s = MockTest._state;
      if (!s) return;
      s.current++;
      if (s.current >= s.questions.length) { clearInterval(this._mt.timer); CF._renderMockResults(); }
      else CF._renderMockQuestion();
    },
    _renderMockResults() {
      clearInterval(this._mt.timer);
      const body = document.getElementById('cf-mock-modal_body');
      const r = MockTest.getResults();
      if (!body || !r) return;
      const p = r.prediction;
      XP.add(r.correct * 10);
      // Update profile UI to show new XP
      if (typeof updateProfileUI === 'function') {
        setTimeout(updateProfileUI, 100);
      }
      body.innerHTML = `
        <div class="cf-results-header">
          <div style="font-size:48px">${r.correct>=r.total*0.7?'🏆':r.correct>=r.total*0.5?'🎯':'📚'}</div>
          <h2 style="margin:8px 0">${r.correct}/${r.total} Correct</h2>
          <div class="cf-score-pill">Score: ${r.rawScore.toFixed(1)}</div>
        </div>
        <div class="cf-results-grid">
          <div class="cf-result-stat" style="--rc:#22c55e"><div>${r.correct}</div><span>Correct</span></div>
          <div class="cf-result-stat" style="--rc:#ef4444"><div>${r.wrong}</div><span>Wrong</span></div>
          <div class="cf-result-stat" style="--rc:#f59e0b"><div>${r.skipped}</div><span>Skipped</span></div>
          <div class="cf-result-stat" style="--rc:#38bdf8"><div>${Math.floor(r.timeTaken/60)}m</div><span>Time</span></div>
        </div>
        ${p ? `<div class="cf-predictor-card ${p.safe?'cf-safe':'cf-danger'}">
          <div>📊 Predicted Rank: <strong>#${p.rank.toLocaleString()}</strong></div>
          <div>Cutoff ${p.safe?'✅ Cleared':'❌ Missed by '+p.gap.toFixed(1)}</div>
        </div>` : ''}
        <div class="cf-ai-review-wrap">
          <div class="cf-section-label">🤖 AI Performance Review</div>
          <div id="cf-ai-review-text" class="cf-ai-review">Loading AI review...</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          <button class="cf-btn cf-btn-primary" onclick="MockTest._state=null;CF._renderMockTest()">New Test</button>
          <button class="cf-btn cf-btn-ghost" onclick="CF.closeModal('cf-mock-modal');CF.openAnalytics()">View Analytics</button>
        </div>`;
      MockTest._state = null;
      confetti();
      MockTest.getAIReview(r).then(review => {
        const el = document.getElementById('cf-ai-review-text');
        if (el) el.textContent = review;
      });
    },

    /* ── ANALYTICS RENDERING ── */
    _renderAnalytics() {
      const body = document.getElementById('cf-analytics-modal_body');
      if (!body) return;
      const trend = Analytics.getWeeklyTrend();
      const topics = WeakTopics.getSorted();
      const xp = XP.get(), lvl = XP.level();
      const avg = Analytics.getAvgTimePerQ();
      const streak = (typeof state!=='undefined'?state.streakDays:lsGet('streak','0'))||0;

      const topicRows = topics.slice(0,8).map(t=>`
        <div class="cf-topic-row">
          <span class="cf-topic-name">${t.topic}</span>
          <div class="cf-topic-bar-wrap">
            <div class="cf-topic-bar" style="width:${t.accuracy}%;background:${t.accuracy>=70?'#22c55e':t.accuracy>=40?'#f59e0b':'#ef4444'}"></div>
          </div>
          <span class="cf-topic-pct ${t.accuracy<40?'cf-red':''}">${t.accuracy}%</span>
        </div>`).join('') || '<p class="cf-muted">Solve questions to see your topic accuracy here.</p>';

      const chartBars = trend.map(t=>`
        <div class="cf-chart-col">
          <div class="cf-chart-bar-wrap">
            <div class="cf-chart-bar" style="height:${t.total?t.accuracy:0}%;background:linear-gradient(180deg,#6C63FF,#FF6B9D)"></div>
          </div>
          <div class="cf-chart-lbl">${t.label}</div>
          <div class="cf-chart-pct">${t.total?t.accuracy+'%':'-'}</div>
        </div>`).join('');

      body.innerHTML = `
        <div class="cf-stat-row">
          <div class="cf-stat-card"><div class="cf-stat-val" style="color:#f59e0b">⭐ Lv.${lvl}</div><div class="cf-stat-lbl">${xp} XP</div></div>
          <div class="cf-stat-card"><div class="cf-stat-val" style="color:#FF6B9D">🔥 ${streak}</div><div class="cf-stat-lbl">Day Streak</div></div>
          <div class="cf-stat-card"><div class="cf-stat-val" style="color:#38bdf8">⏱ ${avg}s</div><div class="cf-stat-lbl">Avg/Q</div></div>
          <div class="cf-stat-card"><div class="cf-stat-val" style="color:#22c55e">${DailyGoal.getTodayCount()}/${DailyGoal.GOAL}</div><div class="cf-stat-lbl">Today</div></div>
        </div>
        <div class="cf-section-label" style="margin-top:20px">📈 7-Day Accuracy Trend</div>
        <div class="cf-chart-wrap">${chartBars}</div>
        <div class="cf-section-label" style="margin-top:20px">📊 Topic Accuracy</div>
        <div class="cf-topic-list">${topicRows}</div>
        ${WeakTopics.getWeakest(3).length ? `
          <div class="cf-weak-alert">
            ⚠️ Focus Areas: ${WeakTopics.getWeakest(3).map(t=>'<strong>'+t.topic+'</strong>').join(', ')}
            <br><small>Practice these topics to improve your score</small>
          </div>` : ''}`;
    },

    /* ── EXAM EXPANSION RENDERING ── */
    _renderExamExpansion() {
      const body = document.getElementById('cf-exam-modal_body');
      if (!body) return;
      // Include all study modes: exams, classes
      const exams = Object.entries(EXAM_CONFIGS).filter(([k,v])=>v.type==='exam'||v.type==='class');
      const classes = Object.entries(EXAM_CONFIGS).filter(([k,v])=>v.type==='class');
      body.innerHTML = `
        <div class="cf-section-label">🏛️ Competitive Exams</div>
        <div class="cf-exam-grid">
          ${exams.map(([k,v])=>`
            <button class="cf-exam-chip" style="--ec:${v.color}" onclick="CF.closeModal('cf-exam-modal');CF._pyqState.exam='${k}';CF.openPYQ();CF._renderPYQYears('${k}')">
              ${v.label}
            </button>`).join('')}
        </div>
        <div class="cf-section-label" style="margin-top:20px">🎒 School Classes (NCERT)</div>
        <div class="cf-class-grid">
          ${classes.map(([k,v])=>`
            <button class="cf-class-card" style="--ec:${v.color}" onclick="CF._openClassStudy('${k}')">
              <div class="cf-class-label">${v.label}</div>
              <div class="cf-class-subjects">${v.subjects.slice(0,3).join(' · ')}${v.subjects.length>3?'...':''}</div>
            </button>`).join('')}
        </div>`;
    },
    _openClassStudy(classKey) {
      const conf = EXAM_CONFIGS[classKey];
      if (!conf) return;
      CF.closeModal('cf-exam-modal');
      // Build a PYQ-like view for the class subject
      const body = document.getElementById('cf-pyq-modal_body');
      CF.openModal('cf-pyq-modal');
      body.innerHTML = `
        <div class="cf-section-label">📖 ${conf.label} — Select Subject</div>
        <div class="cf-exam-grid">
          ${conf.subjects.map(s=>`<button class="cf-exam-chip" style="--ec:${conf.color}" onclick="CF._loadClassQuestions('${classKey}','${s}')">${s}</button>`).join('')}
        </div>
        <div id="cf-pyq-questions" style="margin-top:12px"></div>`;
    },
    async _loadClassQuestions(classKey, subject) {
      const el = document.getElementById('cf-pyq-questions');
      if (!el) return;
      const conf = EXAM_CONFIGS[classKey];
      el.innerHTML = `<div class="cf-loading-wrap"><div class="cf-spinner"></div><p class="cf-muted">Loading ${conf.label} ${subject} questions...</p></div>`;
      const cacheKey = `pyq_cache_${classKey}_${subject}`;
      let qs = lsGet(cacheKey, 'null');
      if (!qs || !Array.isArray(qs)) {
        try {
          const qs3 = await _loadQuestionsFromStorage('pyq/' + classKey + '/' + subject.replace(/ /g,'_') + '.json', 10);
          if (qs3 && qs3.length) { qs = qs3; lsSet(cacheKey, qs); }
          else {
            const qs4 = await _loadQuestionsFromStorage('pyq/' + classKey + '/questions.json', 10);
            if (qs4 && qs4.length) { qs = qs4; lsSet(cacheKey, qs); }
            else qs = null;
          }
        } catch(e) { qs = null; }
      }
      if (!qs) {
        el.innerHTML = `<div class="cf-muted" style="padding:16px">❌ Could not load questions. Check your connection.</div>`;
        return;
      }
      this._pyqState = { exam: classKey, year: subject, qs };
      el.innerHTML = `
        <div class="cf-section-label">${conf.label} ${subject} — ${qs.length} Questions</div>
        ${qs.map((q,i)=>this._renderPYQCard(q,i,classKey,subject)).join('')}`;
    },

    /* ── STUDY GROUPS RENDERING (Full Screen) ── */
    _renderGroups() {
      const body = document.getElementById('cf-groups-modal_body');
      if (!body) return;

      /* ── Check group admin status from payment.js ── */
      const isGrpAdmin = (function() {
        try {
          const u = window._firebaseAuth?.currentUser;
          const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
          if (localStorage.getItem(p + 'group_admin') === 'true') return true;
          if (localStorage.getItem('sscai_group_admin') === 'true') return true;
        } catch(e) {}
        // Admin emails always bypass
        try {
          const email = window._firebaseAuth?.currentUser?.email;
          const ADMIN_EMAILS = ['shank122004@gmail.com'];
          if (email && ADMIN_EMAILS.indexOf(email) !== -1) return true;
        } catch(e) {}
        return false;
      })();

      const grpPlan = (function() {
        try {
          const u = window._firebaseAuth?.currentUser;
          const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
          return localStorage.getItem(p + 'group_plan') || localStorage.getItem('sscai_group_plan') || null;
        } catch(e) { return null; }
      })();

      const maxGroups = isGrpAdmin
        ? (grpPlan === 'coaching_pro' ? 999 : grpPlan === 'coaching_basic' ? 3 : 1)
        : 0;

      body.innerHTML = `
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          ${isGrpAdmin
            ? `<button class="cf-btn cf-btn-primary" onclick="CF._showCreateGroup()">➕ Create Group</button>`
            : `<button class="cf-btn cf-btn-primary" style="background:linear-gradient(135deg,rgba(108,99,255,0.4),rgba(255,107,157,0.3));cursor:pointer;" onclick="CF._showGroupAdminGate()">🔒 Create Group (Admin Plan)</button>`
          }
          <button class="cf-btn cf-btn-ghost" onclick="CF._showJoinGroup()">🔗 Join Group (Free)</button>
        </div>
        ${isGrpAdmin ? `<div style="font-size:11px;color:rgba(74,222,128,0.8);margin-bottom:10px;padding:6px 10px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:8px;">✅ Group Admin · ${grpPlan || 'group_leader'} · Max ${maxGroups === 999 ? '∞' : maxGroups} group(s)</div>` : ''}
        ${isGrpAdmin && (grpPlan === 'coaching_pro' || grpPlan === 'coaching_basic') ? CF._renderCoachingWelcome(grpPlan) : ''}
        <div id="cf-group-form"></div>
        <div id="cf-groups-list"><div class="cf-loading-wrap"><div class="cf-spinner"></div><p class="cf-muted">Loading groups…</p></div></div>`;
      StudyGroups.getAll().then(groups => {
        const el = document.getElementById('cf-groups-list');
        if (!el) return;
        el.innerHTML = groups.length
          ? `<div class="cf-section-label">Your Groups</div>${groups.map(g=>CF._renderGroupCard(g)).join('')}`
          : '<div class="cf-empty-state">💬 No groups yet. Create or join one!</div>';
      }).catch(() => {
        const el = document.getElementById('cf-groups-list');
        if (el) el.innerHTML = '<div class="cf-muted" style="padding:16px">❌ Could not load groups. Check your connection.</div>';
      });
    },
    _renderCoachingWelcome(plan) {
      const isPro = plan === 'coaching_pro';
      const features = isPro ? [
        { icon: '∞', label: 'Unlimited groups', desc: 'Create as many groups as you need' },
        { icon: '📊', label: 'Full Analytics Dashboard', desc: 'Messages, activity, join date per student' },
        { icon: '🧪', label: 'Group Quiz Mode', desc: 'Live quizzes for your students' },
        { icon: '💬', label: 'Group Chat', desc: 'Real-time group study chat' },
        { icon: '📤', label: 'Invite Codes', desc: 'Students join FREE with code — no payment' },
        { icon: '🏆', label: 'Student Leaderboard', desc: 'Track top performers in your group' },
        { icon: '🎯', label: 'Exam-Specific Groups', desc: 'SSC, Class 9-12, General & more' },
        { icon: '🔄', label: 'Auto-refresh Analytics', desc: 'Live stats update every 10 seconds' },
        { icon: '🌐', label: 'Up to 10,000 students', desc: 'Scale your coaching institute online' },
      ] : [
        { icon: '3️⃣', label: 'Up to 3 groups', desc: 'Create 3 study groups for your students' },
        { icon: '📊', label: 'Group Analytics', desc: 'Messages & activity tracking per student' },
        { icon: '🧪', label: 'Group Quiz Mode', desc: 'Live quizzes for your students' },
        { icon: '💬', label: 'Group Chat', desc: 'Real-time group study chat' },
        { icon: '📤', label: 'Invite Codes', desc: 'Students join FREE — no payment needed' },
        { icon: '🎯', label: 'Exam-Specific Groups', desc: 'SSC, Class 9-12, General & more' },
      ];
      return `<div style="background:linear-gradient(135deg,${isPro ? 'rgba(108,99,255,0.12),rgba(255,107,157,0.08)' : 'rgba(16,185,129,0.1),rgba(108,99,255,0.08)'});border:1px solid ${isPro ? 'rgba(108,99,255,0.3)' : 'rgba(16,185,129,0.25)'};border-radius:14px;padding:14px 16px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <div style="font-size:24px;">${isPro ? '🏫' : '🎓'}</div>
          <div>
            <div style="font-size:14px;font-weight:800;color:var(--text-primary);">${isPro ? 'Coaching Pro' : 'Coaching Starter'} — Teacher Dashboard</div>
            <div style="font-size:11px;color:rgba(26,26,38,0.55);">Everything included in your plan</div>
          </div>
          <div style="margin-left:auto;background:${isPro ? 'linear-gradient(135deg,#6C63FF,#FF6B9D)' : 'linear-gradient(135deg,#10b981,#6C63FF)'};color:var(--text-primary);font-size:10px;font-weight:800;padding:3px 10px;border-radius:10px;white-space:nowrap;">${isPro ? 'PRO ✨' : 'STARTER'}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;">
          ${features.map(f => `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:9px;padding:8px 10px;display:flex;align-items:flex-start;gap:8px;">
            <div style="font-size:18px;line-height:1;flex-shrink:0;">${f.icon}</div>
            <div>
              <div style="font-size:11px;font-weight:700;color:var(--text-primary);">${f.label}</div>
              <div style="font-size:10px;color:rgba(26,26,38,0.70);line-height:1.4;">${f.desc}</div>
            </div>
          </div>`).join('')}
        </div>
        ${isPro ? '' : `<div style="margin-top:10px;padding:8px 10px;background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.2);border-radius:8px;font-size:11px;color:rgba(26,26,38,0.7);text-align:center;">
          ⬆️ <strong style="color:#5b46d4;">Upgrade to Coaching Pro</strong> for unlimited groups, advanced analytics & 10,000 students — ₹999/mo
        </div>`}
      </div>`;
    },

    _renderGroupCard(g) {
      const isAdmin = g.adminUid === uid();
      const coachingPlans = ['coaching_basic', 'coaching_pro'];
      const grpPlan = (function() {
        try {
          const u = window._firebaseAuth?.currentUser;
          const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
          return localStorage.getItem(p + 'group_plan') || localStorage.getItem('sscai_group_plan') || null;
        } catch(e) { return null; }
      })();
      const hasCoachingPlan = coachingPlans.indexOf(grpPlan) !== -1;
      const inviteCode = g.code || g.inviteCode || '——';
      return `
        <div class="cf-group-card">
          <div class="cf-group-info">
            <strong>${g.name}</strong> <span class="cf-topic-tag">${EXAM_CONFIGS[g.exam]?.label||g.exam}</span>
            ${isAdmin ? '<span style="font-size:9px;background:linear-gradient(135deg,#f59e0b,#FF6B9D);color:var(--text-primary);padding:1px 6px;border-radius:8px;font-weight:700;margin-left:4px">ADMIN</span>' : ''}
            <div class="cf-group-meta">👥 ${g.members.length} members · Code: <code style="color:#f59e0b;font-weight:700;letter-spacing:1px;">${inviteCode}</code></div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            ${isAdmin ? `<button class="cf-btn cf-btn-sm" style="background:rgba(16,185,129,0.2);color:#4ade80;border-color:rgba(74,222,128,0.3);" onclick="CF._openGroupDashboard('${g.id}')">📊</button>` : ''}
            ${isAdmin ? `<button class="cf-btn cf-btn-sm" onclick="CF._shareGroupCode('${inviteCode}','${(g.name||'').replace(/'/g,'')}')" title="Share invite code">📤</button>` : ''}
            <button class="cf-btn cf-btn-sm cf-btn-primary" onclick="window._safeOpenGroupChat('${g.id}')">⚔️ Battle Room →</button>
          </div>
        </div>`;
    },

    _showCreateGroup() {
      // Check premium status - group creation requires premium
      const u = window._firebaseAuth?.currentUser;
      if (!u) {
        CF._showGroupAdminGate(); return;
      }
      
      const isPrem = localStorage.getItem('sscai_u:' + u.uid + ':premium') === 'true';
      if (!isPrem) {
        CF._showGroupAdminGate(); return;
      }
      const el = document.getElementById('cf-group-form');
      if (!el) return;
      const exams = Object.entries(EXAM_CONFIGS);
      el.innerHTML = `
        <div class="cf-form-card">
          <input class="cf-input" id="cf-grp-name" placeholder="Group name (e.g. SSC Warriors 2025)" maxlength="40" />
          <select class="cf-input cf-select" id="cf-grp-exam">
            ${exams.map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
          </select>
          <button class="cf-btn cf-btn-primary" style="width:100%" onclick="CF._createGroup()">✅ Create Group</button>
        </div>`;
    },
    async _createGroup() {
      const name = document.getElementById('cf-grp-name')?.value?.trim();
      const exam = document.getElementById('cf-grp-exam')?.value;
      if (!name) { toast('Please enter a group name'); return; }

      // CHECK PREMIUM STATUS FIRST - Group creation requires premium
      try {
        const u = window._firebaseAuth?.currentUser;
        if (!u) { toast('Please login first'); return; }
        
        const isPrem = localStorage.getItem('sscai_u:' + u.uid + ':premium') === 'true';
        if (!isPrem) {
          toast('🔒 Group creation requires Premium membership');
          if (typeof openPremiumModal === 'function') openPremiumModal();
          return;
        }
      } catch(e) {
        toast('Error checking premium status');
        return;
      }

      // Enforce group count limit per plan
      try {
        const u = window._firebaseAuth?.currentUser;
        const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
        const grpPlan = localStorage.getItem(p + 'group_plan') || localStorage.getItem('sscai_group_plan') || 'group_leader';
        const maxGroups = grpPlan === 'coaching_pro' ? 999 : grpPlan === 'coaching_basic' ? 3 : 1;
        const email = u?.email;
        const isAdminEmail = email && ['shank122004@gmail.com'].indexOf(email) !== -1;
        if (!isAdminEmail && maxGroups < 999) {
          const db = window._firebaseDb;
          const fns = window._firebaseFns;
          if (db && fns) {
            const { collection, query, where, getDocs } = fns;
            const existing = await getDocs(query(collection(db, 'studyGroups'), where('adminUid', '==', uid())));
            if (existing.size >= maxGroups) {
              toast('🔒 You\'ve reached your group limit (' + maxGroups + '). Upgrade to Coaching Pro for unlimited groups.');
              if (typeof openPremiumModal === 'function') openPremiumModal();
              return;
            }
          }
        }
      } catch(e) {}

      const btn = document.querySelector('#cf-group-form button');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Creating…'; }

      try {
        const group = await StudyGroups.create(name, exam);
        // Show the invite code prominently after creation
        const el = document.getElementById('cf-group-form');
        if (el && group) {
          el.innerHTML = `
            <div class="cf-form-card" style="text-align:center;">
              <div style="font-size:28px;margin-bottom:8px;">🎉</div>
              <div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-bottom:4px;">Group Created!</div>
              <div style="font-size:12px;color:rgba(26,26,38,0.6);margin-bottom:12px;">"${group.name}"</div>
              <div style="background:rgba(245,158,11,0.1);border:2px solid rgba(245,158,11,0.4);border-radius:12px;padding:14px;margin-bottom:12px;">
                <div style="font-size:11px;color:rgba(26,26,38,0.70);margin-bottom:6px;">📲 Share this code with your students</div>
                <div style="font-size:28px;font-weight:800;color:#f59e0b;letter-spacing:5px;font-family:monospace;">${group.code}</div>
                <div style="font-size:10px;color:rgba(26,26,38,0.65);margin-top:4px;">Students join FREE · No payment needed</div>
              </div>
              <button class="cf-btn cf-btn-primary" style="width:100%;margin-bottom:6px;" onclick="(function(){const t='Join my CrackAI Study Group \\'${group.name}\\'!\\nCode: ${group.code}\\nOpen CrackAI → Group Study AI → Join Group';if(navigator.share)navigator.share({title:'CrackAI Study Group',text:t});else if(navigator.clipboard)navigator.clipboard.writeText(t).then(()=>showToast('📋 Invite message copied!'));})()">📤 Share Invite Code</button>
              <button class="cf-btn cf-btn-ghost" style="width:100%;" onclick="CF._renderGroups()">← Back to Groups</button>
            </div>`;
          return;
        }
      } catch(e) {
        console.error('[CF._createGroup]', e);
        toast('❌ Failed to create group. Try again.');
        if (btn) { btn.disabled = false; btn.textContent = '✅ Create Group'; }
      }
      CF._renderGroups();
    },

    async _joinGroup() {
      const code = document.getElementById('cf-join-code')?.value?.trim().toUpperCase();
      if (!code || code.length < 4) { toast('Please enter a valid group code'); return; }
      const btn = document.querySelector('#cf-group-form .cf-btn-primary');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Joining…'; }
      const g = await StudyGroups.join(code);
      if (g) {
        // Show success message with group name
        const el = document.getElementById('cf-group-form');
        if (el) {
          el.innerHTML = `
            <div class="cf-form-card" style="text-align:center;">
              <div style="font-size:28px;margin-bottom:8px;">🎉</div>
              <div style="font-size:14px;font-weight:800;color:var(--text-primary);margin-bottom:4px;">Joined "${g.name}"!</div>
              <div style="font-size:12px;color:rgba(26,26,38,0.6);margin-bottom:12px;">${(g.members||[]).length} members · Welcome aboard!</div>
              <button class="cf-btn cf-btn-primary" style="width:100%;" onclick="window._safeOpenGroupChat('${g.id}')">💬 Open Group Chat →</button>
            </div>`;
        }
        setTimeout(() => CF._renderGroups(), 2500);
      } else {
        if (btn) { btn.disabled = false; btn.textContent = '🔗 Join Group (Free)'; }
        toast('❌ Invalid code. Ask your admin for the correct invite code.');
      }
    },

    /* ═══ CHAT + BATTLE QUIZ SYSTEM ═══ */


    /* ── Admin Group Dashboard (polling, no onSnapshot) ── */
    _dashboardPollInterval: null,

    async _renderGroupDashboard(groupId) {
      const body = document.getElementById('cf-groups-modal_body');
      const db = window._firebaseDb;
      const fns = window._firebaseFns;
      if (!body || !db || !fns) return;
      try {
        const { doc, getDoc } = fns;
        const snap = await getDoc(doc(db, 'studyGroups', groupId));
        if (!snap.exists()) { body.innerHTML = '<div class="cf-muted" style="padding:20px;text-align:center;">Group not found.</div>'; return; }
        const data = snap.data();
        const myUid = uid();
        // Only admin can view dashboard
      if (data.adminUid !== myUid) {
        // Non-admin users: show group chat interface with join code option
        await CF._openGroupChat(groupId);
        return;
      }

        const members = data.members || [];
        const memberNames = data.memberNames || {};
        const memberStats = data.memberStats || {};
        const inviteCode = data.code || data.inviteCode || '——';
        const examLabel = EXAM_CONFIGS[data.exam]?.label || data.exam || 'Unknown';

        // Build per-student battle XP rows from current quiz and memberStats
        const quizXP = (data.quiz && data.quiz.xp) ? data.quiz.xp : {};

        const rows = members
          .filter(m => m !== data.adminUid)
          .map(m => {
            const stats = memberStats[m] || {};
            const battleXP = quizXP[m] || stats.battleXP || 0;
            const qAns = stats.questionsAnswered || 0;
            const lastActive = stats.lastActive ? new Date(stats.lastActive).toLocaleDateString('en-IN') : '—';
            const joined = stats.joined ? new Date(stats.joined).toLocaleDateString('en-IN') : 'Unknown';
            const isActiveToday = stats.lastActive && (Date.now() - stats.lastActive < 86400000);
            const statusDot = qAns > 0 ? (isActiveToday ? '#4ade80' : '#f59e0b') : '#f87171';
            const xpColor = battleXP >= 70 ? '#f59e0b' : battleXP >= 40 ? '#4ade80' : battleXP > 0 ? '#a78bfa' : 'rgba(200,195,255,0.3)';
            // Avatar initial
            const initial = (memberNames[m] || 'S').charAt(0).toUpperCase();
            return { uid: m, name: memberNames[m]||'Student', battleXP, qAns, joined, lastActive, statusDot, xpColor, initial, isActiveToday };
          })
          .sort((a, b) => b.battleXP - a.battleXP || b.qAns - a.qAns);

        const totalStudents = members.filter(m => m !== data.adminUid).length;
        // Active = participated in at least 1 question in any battle
        const activeMembers = rows.filter(r => r.qAns > 0).length;
        // Engagement = students who participated in current or recent battle / total
        const participatedInBattle = rows.filter(r => r.battleXP > 0 || r.qAns > 0).length;
        const engagementPct = totalStudents > 0 ? Math.round((participatedInBattle / totalStudents) * 100) : 0;
        const engColor = engagementPct >= 60 ? '#4ade80' : engagementPct >= 30 ? '#f59e0b' : '#f87171';
        const topXP = rows.length > 0 ? rows[0].battleXP : 0;
        const totalQAnswered = rows.reduce((s, r) => s + r.qAns, 0);

        body.innerHTML = `
          <button class="cf-btn cf-btn-ghost" style="margin-bottom:12px;" onclick="clearInterval(CF._dashboardPollInterval);CF._renderGroups()">← Back to Groups</button>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px;">
            <div>
              <div style="font-size:15px;font-weight:800;color:var(--text-primary,#fff);">${data.name||'Group'} — Analytics</div>
              <div style="font-size:11px;color:rgba(26,26,38,0.70);">📚 ${examLabel} · Code: <span style="font-family:monospace;color:#f59e0b;font-weight:700;letter-spacing:2px;">${inviteCode}</span></div>
            </div>
            <button class="cf-btn cf-btn-sm" onclick="CF._shareGroupCode('${inviteCode}','${(data.name||'').replace(/'/g,'')}')">📤 Share</button>
          </div>

          <!-- KPI Cards -->
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:14px;">
            <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:10px;text-align:center;">
              <div style="font-size:22px;font-weight:800;color:#4ade80;">${totalStudents}</div>
              <div style="font-size:10px;color:rgba(26,26,38,0.70);">Members</div>
            </div>
            <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:10px;text-align:center;">
              <div style="font-size:22px;font-weight:800;color:#f59e0b;">${activeMembers}</div>
              <div style="font-size:10px;color:rgba(26,26,38,0.70);">Played</div>
            </div>
            <div style="background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.2);border-radius:10px;padding:10px;text-align:center;">
              <div style="font-size:22px;font-weight:800;color:#5b46d4;">${totalQAnswered}</div>
              <div style="font-size:10px;color:rgba(26,26,38,0.70);">Q Answered</div>
            </div>
            <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:10px;text-align:center;">
              <div style="font-size:22px;font-weight:800;color:#f59e0b;">⚡${topXP}</div>
              <div style="font-size:10px;color:rgba(26,26,38,0.70);">Top XP</div>
            </div>
          </div>

          <!-- Engagement Rate — always visible, based on battle participation -->
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:12px 14px;margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <div style="font-size:12px;font-weight:800;color:var(--text-primary,#fff);">📈 Engagement Rate</div>
              <div style="font-size:14px;font-weight:900;color:${engColor};">${engagementPct}%</div>
            </div>
            <div style="height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;margin-bottom:5px;">
              <div style="height:100%;width:${engagementPct}%;background:linear-gradient(90deg,#6C63FF,${engColor});border-radius:4px;transition:width 0.6s ease;"></div>
            </div>
            <div style="font-size:10px;color:rgba(26,26,38,0.70);">${participatedInBattle} of ${totalStudents} students have participated in battles</div>
          </div>

          <!-- Battle XP Leaderboard — student profiles -->
          <div style="font-size:12px;font-weight:800;color:var(--text-primary,#fff);margin-bottom:4px;">⚡ Battle XP Leaderboard</div>
          <div style="font-size:10px;color:rgba(26,26,38,0.65);margin-bottom:10px;">🔄 Auto-refreshes every 10s · Sorted by XP earned in battles</div>
          ${rows.length === 0
            ? `<div style="text-align:center;padding:24px;font-size:12px;color:rgba(26,26,38,0.70);background:rgba(255,255,255,0.02);border-radius:10px;border:1px dashed rgba(255,255,255,0.08);">
                <div style="font-size:28px;margin-bottom:8px;">👋</div>
                <div style="font-weight:700;color:rgba(26,26,38,0.6);margin-bottom:4px;">No students yet</div>
                <div>Share code <strong style="color:#f59e0b;">${inviteCode}</strong> with students!</div>
              </div>`
            : `<div style="display:flex;flex-direction:column;gap:6px;">
                ${rows.map((r, i) => {
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
                  const xpBarPct = topXP > 0 ? Math.min(100, Math.round((r.battleXP / topXP) * 100)) : 0;
                  return `<div style="background:rgba(255,255,255,0.03);border:1px solid ${i < 3 ? 'rgba(108,99,255,0.25)' : 'rgba(255,255,255,0.07)'};border-radius:12px;padding:11px 12px;${i === 0 ? 'background:rgba(245,158,11,0.05);border-color:rgba(245,158,11,0.3);' : ''}">
                    <div style="display:flex;align-items:center;gap:10px;">
                      <!-- Avatar -->
                      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#6C63FF,#FF6B9D);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:var(--text-primary);flex-shrink:0;">${r.initial}</div>
                      <!-- Name & last active -->
                      <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:5px;">
                          <span style="font-size:13px;font-weight:800;color:var(--text-primary,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${medal} ${r.name}</span>
                          <div style="width:7px;height:7px;border-radius:50%;background:${r.statusDot};flex-shrink:0;" title="${r.isActiveToday ? 'Active today' : 'Last seen: ' + r.lastActive}"></div>
                        </div>
                        <div style="font-size:10px;color:rgba(26,26,38,0.70);">Joined ${r.joined} · ${r.qAns} Q's answered</div>
                      </div>
                      <!-- XP badge -->
                      <div style="text-align:right;flex-shrink:0;">
                        <div style="font-size:15px;font-weight:900;color:${r.xpColor};">⚡ ${r.battleXP}</div>
                        <div style="font-size:10px;color:rgba(26,26,38,0.70);">XP</div>
                      </div>
                    </div>
                    <!-- XP bar -->
                    <div style="height:3px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:8px;overflow:hidden;">
                      <div style="height:100%;width:${xpBarPct}%;background:${r.xpColor};border-radius:2px;transition:width 0.5s;"></div>
                    </div>
                  </div>`;
                }).join('')}
              </div>`
          }
          <div style="margin-top:12px;padding:10px 12px;background:rgba(108,99,255,0.06);border:1px solid rgba(108,99,255,0.15);border-radius:9px;font-size:10px;color:rgba(26,26,38,0.70);text-align:center;">
            🔒 This dashboard is visible to group admin only · XP is earned in mock battles
          </div>`;
      } catch(e) {
        console.error('[CF._renderGroupDashboard]', e);
        if (body) body.innerHTML = '<div class="cf-muted" style="padding:20px;text-align:center;">❌ Error loading dashboard. Tap back and retry.</div>';
      }
    },

    _shareGroupCode(code, groupName) {
      const text = `Join my CrackAI Study Group "${groupName}"!\nInvite Code: ${code}\nOpen CrackAI → Group Study AI → Join Group (FREE!)`;
      if (navigator.share) {
        navigator.share({ title: 'CrackAI Study Group Invite', text }).catch(()=>{});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => toast('📋 Invite message copied!', 3000)).catch(()=>{});
      } else {
        toast('📋 Code: ' + code + ' — Share with students!', 5000);
      }
    },

    _stopChatPolling() {
      if (CF._chatPollInterval) { clearInterval(CF._chatPollInterval); CF._chatPollInterval = null; }
      CF._chatPollHash = '';
      CF._currentGroupId = null;
      CF._currentGroupData = null;
      CF._stopGroupQuizTimer();
      CF._groupCountdownShown = false;
    },

    /* Renders all chat messages (styled beautifully) */
    _renderChatMessages(messages) {
      const msgs = document.getElementById('cf-chat-msgs');
      if (!msgs) return;
      const wasAtBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
      if (!messages.length) {
        msgs.innerHTML = `<div style="text-align:center;padding:32px 16px;color:rgba(26,26,38,0.70)">
          <div style="font-size:40px;margin-bottom:8px">👋</div>
          <div style="font-size:14px;font-weight:600">No messages yet</div>
          <div style="font-size:12px;margin-top:4px">Say hello to your study group!</div>
        </div>`;
        return;
      }
      const myUid = uid();
      // memberNames map from group data (has real Google names)
      const memberNames = (CF._currentGroupData && CF._currentGroupData.memberNames) || {};

      let html = '';
      let lastUid = null;
      messages.forEach((m, i) => {
        const isMine = m.uid === myUid;
        const showName = !isMine && m.uid !== lastUid;
        const isLast = i === messages.length - 1 || messages[i+1].uid !== m.uid;
        lastUid = m.uid;
        const timeStr = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        // Resolve real name: memberNames map > saved in message > fallback
        const resolvedName = memberNames[m.uid] || m.name || (isMine ? getMyName() : 'Student');
        const initial = resolvedName.charAt(0).toUpperCase();
        html += `<div class="cf-chat-row ${isMine ? 'cf-chat-row-mine' : 'cf-chat-row-other'}">
          ${!isMine && showName ? `<div class="cf-chat-avatar">${initial}</div>` : (!isMine ? '<div class="cf-chat-avatar-gap"></div>' : '')}
          <div class="cf-chat-col">
            ${showName ? `<div class="cf-chat-sender">${resolvedName}</div>` : ''}
            <div class="cf-chat-bubble-wrap ${isMine?'cf-mine':''}">
              <div class="cf-chat-bubble2">${m.text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
              ${isLast ? `<div class="cf-chat-time2">${timeStr}</div>` : ''}
            </div>
          </div>
        </div>`;
      });
      msgs.innerHTML = html;
      if (wasAtBottom) msgs.scrollTop = msgs.scrollHeight;
    },

    /* Renders the XP leaderboard for quiz battles */
    _renderXPBoard(quiz, memberNames) {
      const xp = quiz.xp || {};
      const entries = Object.entries(xp).sort((a,b) => b[1]-a[1]);
      if (!entries.length) return '';
      return `<div class="cf-xp-board" style="transition: none;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:rgba(26,26,38,0.70);text-transform:uppercase;margin-bottom:8px">⚡ Live XP Board</div>
        ${entries.map(([u,x],i)=>`
          <div class="cf-xp-row ${u===uid()?'cf-xp-me':''}" style="will-change: transform; transition: all 0.3s ease;">
            <span class="cf-xp-rank" style="min-width:24px">${['🥇','🥈','🥉'][i]||'#'+(i+1)}</span>
            <span class="cf-xp-name" style="flex:1">${memberNames&&memberNames[u] ? memberNames[u] : (u===uid()?'You':'Player')}</span>
            <span class="cf-xp-val" style="font-weight:900;color:#f59e0b;min-width:50px;text-align:right">${x} XP</span>
          </div>`).join('')}
      </div>`;
    },

    _updateXPDisplay(myUid, newXP) {
      const xpEl = document.querySelector('.cf-quiz-xp-pill');
      if (xpEl) {
        const currentText = xpEl.textContent.trim();
        const newText = '⚡ ' + newXP + ' XP';
        if (currentText !== newText) {
          xpEl.style.opacity = '0.7';
          xpEl.textContent = newText;
          setTimeout(() => {
            xpEl.style.opacity = '1';
          }, 100);
        }
      }
    },

    /* Renders the quiz question for the group battle (mock only, with 30s timer) */
    _renderQuizQuestion(quiz, groupId, memberNames) {
      const body = document.getElementById('cf-quiz-area');
      if (!body) return;
      if (!quiz || quiz.status === 'finished') {
        CF._renderQuizResults(quiz, memberNames);
        return;
      }

      // Hide questions during countdown
      if (quiz.status === 'countdown') {
        body.innerHTML = `<div style="text-align:center;padding:40px 20px;">
          <div style="font-size:48px;margin-bottom:20px;">⏳</div>
          <div style="font-size:18px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">Get Ready!</div>
          <div style="font-size:13px;color:var(--text-secondary);">Battle starting in a moment…</div>
        </div>`;
        return;
      }

      const qi = quiz.current;
      const q = quiz.questions[qi];
      if (!q) return;
      const answered = quiz.answers && quiz.answers[qi];
      const myUid = uid();
      const someoneAnswered = !!answered;
      const questionStartedAt = quiz.questionStartedAt || quiz.startedAt || Date.now();

      // Hide waiting area while quiz is active
      const wa = document.getElementById('cf-group-waiting-area');
      if (wa) wa.innerHTML = '';

      // Shuffle options per user using deterministic hash
      const seed = (myUid + qi).split('').reduce((a,b)=>{a=((a<<5)-a)+b.charCodeAt(0);return a&a},0);
      const shuffled = [...(q.opts || q.options || [])].map((o,i)=>({o,i})).sort(()=>seed%2?1:-1);
      const optMap = shuffled.map(x=>x.i);
      const correctIdx = optMap.indexOf(q.ans);

      body.innerHTML = `
        <div class="cf-quiz-battle-wrap" style="animation:slideIn 0.3s ease;">
          <div class="cf-quiz-progress-row">
            <span class="cf-quiz-qnum">Q ${qi+1} <span style="opacity:0.5;">/ ${quiz.questions.length}</span></span>
            <span class="cf-quiz-xp-pill" style="background:rgba(108,99,255,0.15);border:1px solid rgba(108,99,255,0.3);border-radius:20px;padding:4px 10px;font-size:11px;font-weight:800;color:#5b46d4;transition:color 0.2s ease,background 0.2s ease;will-change:contents;">⚡ ${quiz.xp && quiz.xp[myUid] ? quiz.xp[myUid] : 0} XP</span>
          </div>
          <div class="cf-quiz-bar-track"><div class="cf-quiz-bar-fill" style="width:${(qi/quiz.questions.length)*100}%"></div></div>
          <!-- 30s question timer -->
          <div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
              <span style="font-size:10px;font-weight:700;letter-spacing:0.06em;color:var(--text-secondary);text-transform:uppercase;">⏱ Time</span>
              <span id="cf-gqtimer-label" style="font-size:11px;font-weight:800;color:var(--text-primary);">30s</span>
            </div>
            <div style="height:3px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
              <div id="cf-gqtimer-fill" style="height:100%;width:100%;background:linear-gradient(90deg,#4ade80,#f59e0b,#ef4444);border-radius:3px;transition:width 1s linear;"></div>
            </div>
          </div>
          <div class="cf-quiz-q">${q.question || q.q}</div>
          <div class="cf-quiz-opts" id="cf-quiz-opts">
            ${shuffled.map((item,j)=>{
              const o = item.o;
              let cls = 'cf-quiz-opt';
              if (someoneAnswered) {
                if (j === correctIdx) cls += ' cf-quiz-opt-correct';
                else if (answered && optMap[j] === answered.chosen && j !== correctIdx) cls += ' cf-quiz-opt-wrong';
                else cls += ' cf-quiz-opt-dim';
              }
              return `<button class="${cls} ${someoneAnswered?'cf-quiz-opt-disabled':''}" 
                data-idx="${item.i}" 
                onclick="${someoneAnswered ? '' : `CF._submitQuizAnswer('${groupId}',${qi},${item.i})`}"
                ${someoneAnswered ? 'disabled' : ''}>
                <span class="cf-quiz-opt-letter">${String.fromCharCode(65+j)}</span>
                <span>${o}</span>
              </button>`;
            }).join('')}
          </div>
          ${someoneAnswered ? `
            <div class="cf-quiz-answered-banner ${answered.correct?'cf-correct':'cf-wrong'}">
              ${answered.correct ? '✅ Correct!' : '❌ Wrong!'} 
              <strong>${answered.name}</strong> answered first
              ${answered.correct ? ' — <b>+10 XP</b>' : ''}
            </div>
            <div class="cf-quiz-exp">💡 ${q.exp||q.explanation||'Keep going!'}</div>
          ` : `<div class="cf-quiz-waiting">⚡ Be first to answer and earn <b>+10 XP</b>!</div>`}
          ${CF._renderXPBoard(quiz, memberNames)}
        </div>
        <style>
          @keyframes slideIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        </style>`;

      // Start or maintain the 30s per-question timer
      if (!someoneAnswered) {
        CF._startGroupQuizTimer(groupId, qi, questionStartedAt);
      } else {
        CF._stopGroupQuizTimer();
      }
    },

    /* Renders quiz final results popup */
    _renderQuizResults(quiz, memberNames) {
      const body = document.getElementById('cf-quiz-area');
      if (!body) return;
      const xp = quiz.xp || {};
      const scores = quiz.scores || {};
      const answers = quiz.answers || {};
      const totalQ = (quiz.questions || []).length;
      const myUid = uid();

      // Build per-player stats: merge xp + scores + answers
      const playerMap = {};
      // From xp keys
      Object.keys(xp).forEach(u => {
        if (!playerMap[u]) playerMap[u] = { xp: 0, correct: 0, wrong: 0, total: 0 };
        playerMap[u].xp = xp[u];
      });
      // From scores (most accurate)
      Object.keys(scores).forEach(u => {
        if (!playerMap[u]) playerMap[u] = { xp: xp[u] || 0, correct: 0, wrong: 0, total: 0 };
        playerMap[u].correct = scores[u].correct || 0;
        playerMap[u].wrong = scores[u].wrong || 0;
        playerMap[u].total = scores[u].total || 0;
      });
      // Fallback: derive from answers if scores not populated
      if (!Object.keys(scores).length) {
        Object.keys(answers).forEach(qIdx => {
          const a = answers[qIdx];
          if (!a || !a.uid) return;
          if (!playerMap[a.uid]) playerMap[a.uid] = { xp: xp[a.uid] || 0, correct: 0, wrong: 0, total: 0 };
          playerMap[a.uid].total++;
          if (a.correct) playerMap[a.uid].correct++;
          else playerMap[a.uid].wrong++;
        });
      }

      const sorted = Object.entries(playerMap).sort((a,b) => b[1].xp - a[1].xp);
      const winner = sorted[0];
      const medals = ['🥇','🥈','🥉'];

      body.innerHTML = `
        <div style="text-align:center;padding:16px 0 10px">
          <div style="font-size:48px">${winner && winner[0]===myUid ? '🏆' : '🎯'}</div>
          <h2 style="margin:6px 0;font-size:19px;background:linear-gradient(135deg,#f59e0b,#FF6B9D);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">Battle Over!</h2>
          ${winner ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">🥇 Winner: <strong style="color:#f59e0b">${memberNames&&memberNames[winner[0]]?memberNames[winner[0]]:(winner[0]===myUid?'You':'Player')}</strong> · ${winner[1].xp} XP · ${winner[1].correct}/${totalQ} correct</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:7px;margin:0 0 14px">
          ${sorted.map(([u,s],i) => {
            const name = memberNames&&memberNames[u] ? memberNames[u] : (u===myUid?'You':'Player');
            const acc = s.total > 0 ? Math.round((s.correct/s.total)*100) : 0;
            const isMe = u === myUid;
            return `<div style="display:flex;align-items:center;gap:10px;background:${isMe?'rgba(108,99,255,0.12)':'rgba(255,255,255,0.03)'};border:1px solid ${isMe?'rgba(108,99,255,0.35)':'rgba(255,255,255,0.07)'};border-radius:10px;padding:9px 12px;">
              <span style="font-size:18px;min-width:22px">${medals[i]||('#'+(i+1))}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}${isMe?' <span style="font-size:10px;color:#5b46d4">(You)</span>':''}</div>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">✅ ${s.correct} correct · ❌ ${s.wrong} wrong · ${acc}% acc</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:15px;font-weight:800;color:#f59e0b">⚡${s.xp}</div>
                <div style="font-size:10px;color:var(--text-secondary)">${s.total}/${totalQ} ans</div>
              </div>
            </div>`;
          }).join('')}
        </div>
        <div style="text-align:center">
          <button class="cf-btn cf-btn-ghost" onclick="document.getElementById('cf-quiz-area').innerHTML=''">✕ Close</button>
        </div>`;
    },

    /* ── Group Battle Room (no chat — pure quiz battle) ── */
    async _openGroupChat(groupId) {
      if (!groupId) {
        toast('❌ Group ID missing');
        return;
      }
      CF._stopChatPolling();
      CF._stopGroupQuizTimer();
      const db = window._firebaseDb;
      const fns = window._firebaseFns;
      if (!db || !fns) {
        toast('❌ Firebase not initialized');
        return;
      }
      const { doc, getDoc } = fns;
      if (!doc || !getDoc) {
        toast('❌ Firebase functions unavailable');
        return;
      }
      const body = document.getElementById('cf-groups-modal_body');
      if (!body) {
        toast('❌ Group chat not ready. Try again.');
        return;
      }
      body.innerHTML = `<div class="cf-loading-wrap"><div class="cf-spinner"></div></div>`;

      let snap;
      try { snap = await getDoc(doc(db, 'studyGroups', groupId)); } catch(e) { toast('❌ Could not load group'); return; }
      if (!snap.exists()) { toast('❌ Group not found'); return; }
      const g = snap.data();
      CF._currentGroupId = groupId;
      CF._currentGroupData = g;
      const isAdmin = g.adminUid === uid();
      const examLabel = EXAM_CONFIGS[g.exam]?.label || g.exam;
      const memberCount = (g.members || []).length;

      body.innerHTML = `
        <div class="cf-chat-topbar">
          <button class="cf-btn cf-btn-ghost cf-chat-back" onclick="CF._stopChatPolling();CF._stopGroupQuizTimer();CF._renderGroups()">← Back</button>
          <div class="cf-chat-topbar-info">
            <span class="cf-chat-gname">${g.name}</span>
            <span class="cf-topic-tag" style="font-size:10px">${examLabel}</span>
          </div>
          <button class="cf-btn cf-btn-ghost cf-chat-code-btn" onclick="navigator.clipboard?.writeText('${g.code}');CF.toast('📋 Code ${g.code} copied!')">📋 ${g.code}</button>
        </div>
        <div id="cf-group-battle-area" style="flex:1;overflow-y:auto;padding:12px 14px 80px;">
          <div id="cf-quiz-area"></div>
          <div id="cf-group-waiting-area"></div>
        </div>
        ${isAdmin ? `
        <div class="cf-admin-bar" id="cf-admin-bar" style="position:sticky;bottom:0;z-index:10;background:var(--bg-primary,#0d0d18);border-top:1px solid rgba(108,99,255,0.18);padding:10px 14px;">
          <span style="font-size:11px;font-weight:700;color:#f59e0b;margin-right:8px;">👑 Admin Controls</span>
          <button class="cf-btn cf-btn-sm cf-btn-primary" id="cf-start-battle-btn" onclick="CF._startGroupBattle('${groupId}','${g.exam}')">⚔️ Start Mock Battle</button>
        </div>` : `
        <div style="position:sticky;bottom:0;background:var(--bg-primary,#0d0d18);border-top:1px solid rgba(108,99,255,0.1);padding:10px 14px;text-align:center;font-size:12px;color:rgba(26,26,38,0.70);font-weight:600;">
          ⏳ Waiting for admin to start the battle...
        </div>`}`;

      // Show waiting room or active quiz
      CF._renderGroupWaitingRoom(g, groupId, isAdmin);
      if (g.quiz) {
        if (g.quiz.status === 'countdown') CF._handleGroupCountdown(g, groupId);
        else if (g.quiz.status === 'active') CF._renderQuizQuestion(g.quiz, groupId, g.memberNames);
        else if (g.quiz.status === 'finished') CF._renderQuizResults(g.quiz, g.memberNames);
      }

      // Poll every 2s — skip entirely during answer animation
      CF._chatPollHash = JSON.stringify({ quizStatus: g.quiz?.status, quizQ: g.quiz?.current, quizAnswers: Object.keys(g.quiz?.answers||{}).length, members: memberCount });
      CF._chatPollInterval = setInterval(async () => {
        if (!CF._currentGroupId) return;
        if (CF._answerAnimating) return; // never fight the answer animation
        try {
          const s = await getDoc(doc(db, 'studyGroups', CF._currentGroupId));
          if (!s.exists()) { CF._stopChatPolling(); return; }
          const data = s.data();
          const newHash = JSON.stringify({ quizStatus: data.quiz?.status, quizQ: data.quiz?.current, quizAnswers: Object.keys(data.quiz?.answers||{}).length, members: (data.members||[]).length });
          if (newHash !== CF._chatPollHash) {
            CF._chatPollHash = newHash;
            CF._currentGroupData = data;
            if (data.quiz?.status === 'countdown' && !CF._groupCountdownShown) {
              CF._handleGroupCountdown(data, CF._currentGroupId);
            } else if (data.quiz?.status === 'active') {
              CF._stopGroupQuizTimer();
              CF._renderQuizQuestion(data.quiz, CF._currentGroupId, data.memberNames);
              CF._startGroupQuizTimer(CF._currentGroupId, data.quiz.current, data.quiz.questionStartedAt);
            } else if (data.quiz?.status === 'finished') {
              CF._stopGroupQuizTimer();
              CF._renderQuizResults(data.quiz, data.memberNames);
            } else {
              CF._stopGroupQuizTimer();
              CF._renderGroupWaitingRoom(data, CF._currentGroupId, data.adminUid === uid());
              const qa = document.getElementById('cf-quiz-area');
              if (qa) qa.innerHTML = '';
            }
          }
        } catch(e) {}
      }, 2000);
    },

    /* ── Waiting Room — shows members joined, waiting for admin to start ── */
    _renderGroupWaitingRoom(g, groupId, isAdmin) {
      const el = document.getElementById('cf-group-waiting-area');
      if (!el) return;
      if (g.quiz && (g.quiz.status === 'active' || g.quiz.status === 'finished' || g.quiz.status === 'countdown')) {
        el.innerHTML = '';
        return;
      }
      const members = g.members || [];
      const memberNames = g.memberNames || {};
      const examLabel = EXAM_CONFIGS[g.exam]?.label || g.exam;
      el.innerHTML = `
        <div style="text-align:center;padding:24px 0 16px;">
          <div style="font-size:40px;margin-bottom:10px;">⚔️</div>
          <div style="font-size:17px;font-weight:800;color:var(--text-primary);margin-bottom:4px;">${g.name}</div>
          <div style="font-size:12px;color:rgba(26,26,38,0.70);margin-bottom:16px;">📚 ${examLabel} · Mock Battle</div>
          <div style="background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:12px;padding:12px;margin-bottom:16px;">
            <div style="font-size:13px;color:#4ade80;font-weight:700;">🟢 ${members.length} player${members.length!==1?'s':''} in room</div>
            <div style="font-size:11px;color:rgba(26,26,38,0.70);margin-top:3px;">${isAdmin ? 'Press ⚔️ Start Mock Battle when ready' : 'Waiting for admin to start the battle…'}</div>
          </div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:rgba(26,26,38,0.65);text-transform:uppercase;margin-bottom:8px;">👥 Players Ready</div>
          <div style="display:flex;flex-wrap:wrap;gap:7px;justify-content:center;">
            ${members.map(m => `<div style="background:rgba(108,99,255,0.15);border:1px solid rgba(108,99,255,0.25);border-radius:20px;padding:5px 12px;font-size:12px;font-weight:700;color:#5b46d4;">${memberNames[m]||'Student'}</div>`).join('')}
          </div>
        </div>`;
    },

    /* ── 3-2-1 Countdown overlay for group battle ── */
    _groupCountdownShown: false,
    _handleGroupCountdown(data, groupId) {
      if (CF._groupCountdownShown) return;
      CF._groupCountdownShown = true;

      const overlay = document.createElement('div');
      overlay.id = 'cf-group-countdown-overlay';
      overlay.style.cssText = `position:fixed;inset:0;z-index:999990;background:radial-gradient(ellipse at center,rgba(10,8,30,0.98),rgba(0,0,0,0.99));display:flex;flex-direction:column;align-items:center;justify-content:center;`;
      overlay.innerHTML = `
        <div id="cf-gcdown-num" style="font-size:96px;font-weight:900;color:var(--text-primary);font-family:'Space Grotesk',sans-serif;line-height:1;animation:ba-countpop 0.6s ease;">3</div>
        <div style="font-size:16px;font-weight:700;color:rgba(26,26,38,0.6);margin-top:12px;">Get Ready for Battle!</div>
        <div style="font-size:13px;color:rgba(26,26,38,0.65);margin-top:6px;">${EXAM_CONFIGS[data.exam]?.label||data.exam} · Mock Test</div>`;
      document.body.appendChild(overlay);

      let count = 3;
      const numEl = overlay.querySelector('#cf-gcdown-num');
      const tick = () => {
        count--;
        if (count > 0) {
          if (numEl) { numEl.textContent = count; numEl.style.animation='none'; void numEl.offsetWidth; numEl.style.animation='ba-countpop 0.6s ease'; }
          setTimeout(tick, 1000);
        } else {
          if (numEl) { numEl.textContent = 'GO!'; numEl.style.animation='none'; void numEl.offsetWidth; numEl.style.animation='ba-countpop 0.6s ease'; }
          
          // FIXED v3.2.4: Reset flag IMMEDIATELY before Firestore update
          CF._groupCountdownShown = false;
          
          // Activate battle (admin only) with proper error handling
          if (data.adminUid === uid()) {
            const db = window._firebaseDb;
            const { doc, updateDoc } = window._firebaseFns;
            
            // PROFESSIONAL FIX: Proper error handling with retry logic
            let updateSuccess = false;
            let updateAttempts = 0;
            const maxAttempts = 3;
            
            const attemptUpdate = async () => {
              try {
                updateAttempts++;
                
                // Split into 2 operations to avoid size issues
                await updateDoc(doc(db, 'studyGroups', groupId), {
                  'quiz.status': 'active',
                  'quiz.startedAt': Date.now(),
                  'quiz.questionStartedAt': Date.now(),
                });
                
                updateSuccess = true;
                console.info('[GroupCountdown] ✅ Group quiz activated (attempt ' + updateAttempts + ')');
                
              } catch(err) {
                console.error('[GroupCountdown] ⚠️ Attempt ' + updateAttempts + ' failed:', err.message);
                
                if (err.code === 'permission-denied') {
                  toast('❌ Permission denied for this group', 4000);
                  updateAttempts = maxAttempts;
                } else if (err.code === 'resource-exhausted') {
                  toast('❌ Quota exceeded - try again later', 4000);
                  updateAttempts = maxAttempts;
                } else if (updateAttempts < maxAttempts) {
                  // Retry transient errors
                  console.info('[GroupCountdown] Retrying...');
                  await new Promise(r => setTimeout(r, 200));
                  await attemptUpdate();
                }
              }
            };
            
            await attemptUpdate();
            
            if (!updateSuccess) {
              console.error('[GroupCountdown] ❌ Failed to activate quiz after ' + maxAttempts + ' attempts');
              toast('❌ Quiz failed to start. Please try again.', 4000);
            }
          }
          
          setTimeout(() => {
            if (overlay && overlay.parentNode) {
              overlay.remove();
            }
          }, 800);
        }
      };
      setTimeout(tick, 1000);
    },

    /* ── Per-question 30s timer for group battle ── */
    _groupQuizTimer: null,
    _groupQuizTimerQi: -1,

    _stopGroupQuizTimer() {
      if (CF._groupQuizTimer) { clearInterval(CF._groupQuizTimer); CF._groupQuizTimer = null; }
      CF._groupQuizTimerQi = -1;
    },

    _startGroupQuizTimer(groupId, qi, questionStartedAt) {
      if (CF._groupQuizTimerQi === qi && CF._groupQuizTimer) return;
      CF._stopGroupQuizTimer();
      CF._groupQuizTimerQi = qi;
      const startMs = questionStartedAt || Date.now();
      const QUESTION_TIME = 30;
      const tick = () => {
        const elapsed = Math.floor((Date.now() - startMs) / 1000);
        const remaining = Math.max(0, QUESTION_TIME - elapsed);
        const pct = (remaining / QUESTION_TIME) * 100;
        const fill = document.getElementById('cf-gqtimer-fill');
        const label = document.getElementById('cf-gqtimer-label');
        if (fill) fill.style.width = pct + '%';
        if (label) {
          label.textContent = remaining + 's';
          // Use CSS variables that respect light/dark mode, with fallbacks for critical states
          if (remaining <= 5) {
            label.style.color = '#ef4444';
          } else if (remaining <= 10) {
            label.style.color = '#f59e0b';
          } else {
            label.style.color = 'var(--text-primary)';
          }
        }
        if (remaining <= 0) {
          CF._stopGroupQuizTimer();
          const skipKey = 'cf_skip_' + groupId + '_q' + qi;
          if (!sessionStorage.getItem(skipKey)) {
            sessionStorage.setItem(skipKey, '1');
            CF._autoSkipGroupQuestion(groupId, qi);
          }
        }
      };
      tick();
      CF._groupQuizTimer = setInterval(tick, 1000);
    },

    async _autoSkipGroupQuestion(groupId, qi) {
      try {
        const db = window._firebaseDb;
        const { doc, getDoc, updateDoc } = window._firebaseFns;
        const snap = await getDoc(doc(db, 'studyGroups', groupId));
        if (!snap.exists()) return;
        const data = snap.data();
        const quiz = data.quiz || {};
        if (quiz.current !== qi || quiz.status !== 'active') return;
        const nextIdx = qi + 1;
        const isLast = nextIdx >= (quiz.questions || []).length;
        await updateDoc(doc(db, 'studyGroups', groupId), {
          'quiz.current': isLast ? qi : nextIdx,
          'quiz.status': isLast ? 'finished' : 'active',
          'quiz.questionStartedAt': isLast ? (quiz.questionStartedAt || Date.now()) : Date.now(),
        });
      } catch(e) {}
    },

    /* ── Admin: load questions from Firebase Storage mock/ folder and start countdown ── */
    async _startGroupBattle(groupId, exam) {
      const btn = document.getElementById('cf-start-battle-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Loading questions…'; }
      try {
        toast('🤖 Fetching mock questions from question bank…', 3000);
        let questions = [];
        // Load from Firebase Storage mock/{exam}/ folder
        try {
          if (typeof QuestionService !== 'undefined') {
            questions = await QuestionService.loadMockTest(exam, 10);
          }
        } catch(e) {}

        // Fallback: use _generateQuizQuestions helper
        if (!questions || questions.length < 5) {
          try { questions = await _generateQuizQuestions(exam, 10, 'mock'); } catch(e) {}
        }

        if (!questions || questions.length === 0) {
          toast('❌ No mock questions found for this exam. Upload questions to mock/' + exam + '/ in Firebase Storage.', 5000);
          if (btn) { btn.disabled = false; btn.textContent = '⚔️ Start Mock Battle'; }
          return;
        }

        // Normalize questions to {q, opts, ans, exp, topic} format
        const normalized = questions.map(q => ({
          q: q.q || q.question || '',
          opts: q.opts || q.options || [],
          ans: typeof q.ans === 'number' ? q.ans : (typeof q.answerIndex === 'number' ? q.answerIndex : 0),
          exp: q.exp || q.explanation || '',
          topic: q.topic || q.subject || 'General',
        })).filter(q => q.q && q.opts.length >= 2);

        if (!normalized.length) {
          toast('❌ Question format error. Check question files.', 4000);
          if (btn) { btn.disabled = false; btn.textContent = '⚔️ Start Mock Battle'; }
          return;
        }

        const db = window._firebaseDb;
        const { doc, updateDoc } = window._firebaseFns;
        const quiz = {
          type: 'mock',
          exam,
          questions: normalized,
          current: 0,
          status: 'countdown',
          answers: {},
          xp: {},
          startedAt: Date.now(),
          questionStartedAt: Date.now(),
          startedBy: uid(),
          countdownAt: Date.now(),
        };
        await updateDoc(doc(db, 'studyGroups', groupId), { quiz });
        toast('🚀 Battle starting! 3-2-1…', 3000);

        // Trigger countdown on this client immediately
        const data = CF._currentGroupData || {};
        CF._handleGroupCountdown({ ...data, exam, adminUid: data.adminUid || uid() }, groupId);
      } catch(e) {
        toast('❌ Could not start battle: ' + (e.message || 'Check connection'));
        if (btn) { btn.disabled = false; btn.textContent = '⚔️ Start Mock Battle'; }
      }
    },

    async _submitQuizAnswer(groupId, qIdx, chosenIdx) {
      const g = CF._currentGroupData;
      if (!g || !g.quiz) return;
      if (g.quiz.answers && g.quiz.answers[qIdx]) return; // already answered
      if (CF._answerAnimating) return; // prevent double-tap during animation

      CF._stopGroupQuizTimer();
      CF._answerAnimating = true;

      const myUid = uid();
      const myName = getMyName();
      const q = g.quiz.questions[qIdx];
      const correct = (chosenIdx === q.ans);
      const nextIdx = qIdx + 1;
      const isLast = nextIdx >= g.quiz.questions.length;
      const xpEarned = correct ? 10 : -3;
      const currentXP = (g.quiz.xp && g.quiz.xp[myUid]) || 0;
      const newXP = Math.max(0, currentXP + xpEarned);

      // ── OPTIMISTIC UPDATE — render immediately, NO Firestore read ──
      const optimisticQuiz = JSON.parse(JSON.stringify(g.quiz));
      optimisticQuiz.answers = optimisticQuiz.answers || {};
      optimisticQuiz.answers[qIdx] = { uid: myUid, name: myName, chosen: chosenIdx, correct, ts: Date.now() };
      optimisticQuiz.xp = optimisticQuiz.xp || {};
      optimisticQuiz.xp[myUid] = newXP;
      // Per-player score tracking for accurate admin leaderboard
      optimisticQuiz.scores = optimisticQuiz.scores || {};
      if (!optimisticQuiz.scores[myUid]) optimisticQuiz.scores[myUid] = { correct: 0, wrong: 0, total: 0 };
      optimisticQuiz.scores[myUid].total = (optimisticQuiz.scores[myUid].total || 0) + 1;
      if (correct) optimisticQuiz.scores[myUid].correct = (optimisticQuiz.scores[myUid].correct || 0) + 1;
      else optimisticQuiz.scores[myUid].wrong = (optimisticQuiz.scores[myUid].wrong || 0) + 1;
      optimisticQuiz.current = isLast ? qIdx : nextIdx;
      optimisticQuiz.status = isLast ? 'finished' : 'active';
      optimisticQuiz.questionStartedAt = isLast ? (g.quiz.questionStartedAt || Date.now()) : Date.now();

      CF._currentGroupData = { ...g, quiz: optimisticQuiz };

      // Render answer feedback immediately
      CF._renderQuizQuestion(optimisticQuiz, groupId, g.memberNames);
      if (correct) { toast('✅ Correct! +10 XP 🔥', 1200); if (typeof XP !== 'undefined') XP.add(10); }
      else { toast('❌ Wrong! -3 XP', 1200); }

      // Pre-set poll hash so poller won't re-render and fight the animation
      CF._chatPollHash = JSON.stringify({
        quizStatus: optimisticQuiz.status,
        quizQ: optimisticQuiz.current,
        quizAnswers: Object.keys(optimisticQuiz.answers).length,
        members: (g.members || []).length
      });

      // After 1.2s show next question or results
      if (isLast) {
        setTimeout(function() {
          CF._answerAnimating = false;
          CF._renderQuizResults(optimisticQuiz, g.memberNames);
        }, 1200);
      } else {
        setTimeout(function() {
          CF._answerAnimating = false;
          const latest = CF._currentGroupData && CF._currentGroupData.quiz;
          CF._renderQuizQuestion(latest || optimisticQuiz, groupId, (CF._currentGroupData || g).memberNames);
          CF._startGroupQuizTimer(groupId, (latest || optimisticQuiz).current, (latest || optimisticQuiz).questionStartedAt);
        }, 1200);
      }

      // ── BACKGROUND SYNC — fire-and-forget, NO follow-up getDoc ──
      try {
        const db = window._firebaseDb;
        const { doc, updateDoc } = window._firebaseFns;
        await updateDoc(doc(db, 'studyGroups', groupId), {
          ['quiz.answers.' + qIdx]: { uid: myUid, name: myName, chosen: chosenIdx, correct, ts: Date.now() },
          ['quiz.xp.' + myUid]: newXP,
          ['quiz.scores.' + myUid + '.correct']: optimisticQuiz.scores[myUid].correct,
          ['quiz.scores.' + myUid + '.wrong']: optimisticQuiz.scores[myUid].wrong,
          ['quiz.scores.' + myUid + '.total']: optimisticQuiz.scores[myUid].total,
          ['quiz.current']: isLast ? qIdx : nextIdx,
          ['quiz.status']: isLast ? 'finished' : 'active',
          ['quiz.questionStartedAt']: isLast ? (g.quiz.questionStartedAt || Date.now()) : Date.now(),
        });
      } catch(e) {}
    },

    /* ── DAILY GOAL RENDERING ── */
    _renderDailyGoal() {
      const body = document.getElementById('cf-daily-modal_body');
      if (!body) return;
      const today = DailyGoal.getTodayCount();
      const goal = DailyGoal.GOAL;
      const pct = Math.min(100, today/goal*100);
      const xp = XP.get(), lvl = XP.level();
      const streak = (typeof state!=='undefined'?state.streakDays:0)||0;
      const weak = WeakTopics.getWeakest(3);

      // Robustly get selected mode from state OR localStorage (multiple fallbacks)
      let sscMode = (typeof state !== 'undefined' && state.sscMode) || '';
      if (!sscMode) {
        // Try common localStorage keys
        try {
          sscMode = localStorage.getItem('sscai_mode') || localStorage.getItem('crackai_mode') || localStorage.getItem('sscai_sscMode') || '';
        } catch(e) {}
      }
      if (!sscMode) sscMode = 'cgl'; // last resort

      const modeConf = EXAM_CONFIGS[sscMode];
      const modeLabel = modeConf ? modeConf.label : (sscMode.startsWith('class') ? ('Class ' + sscMode.replace('class','')) : sscMode.toUpperCase());
      const isClass = modeConf && modeConf.type === 'class';
      const goalLabel = isClass ? (modeLabel + ' — Daily Practice') : (modeLabel + ' — Daily Prep');

      // Rich subject-level topics for each class
      const CLASS_TOPICS = {
        class9: [
          'Triangles & Congruence (Maths)', 'Laws of Motion (Physics)', 'Democratic Politics — Elections',
          'The French Revolution (History)', 'Matter in Our Surroundings (Chemistry)',
          'Coordinate Geometry Basics', 'Sound & Waves (Physics)', 'Tissues (Biology)'
        ],
        class10: [
          'Trigonometry — Heights & Distances', 'Carbon & its Compounds (Chemistry)',
          'Nationalism in India (History)', 'Electricity & Circuits (Physics)',
          'Real Numbers & Euclid\'s Algorithm', 'Quadratic Equations', 'Life Processes (Biology)',
          'Federalism & Democracy (Civics)'
        ],
        class11_sci: [
          'Complex Numbers & Quadratics', 'Laws of Thermodynamics (Physics)', 'Organic Chemistry — Nomenclature',
          'Indian Constitution (Pol. Sci)', 'Kinematics in 2D', 'Sets, Relations & Functions',
          'Equilibrium (Chemistry)', 'Plant Kingdom (Biology)'
        ],
        class11_com: [
          'Business Environment', 'Accounting — Journal Entries', 'Statistics — Measures of Dispersion',
          'Theory of Demand & Supply', 'Financial Statements', 'Business Finance', 'Marketing Mix'
        ],
        class11_arts: [
          'Indian Constitution — Fundamental Rights', 'Mughal Empire (History)', 'Human Geography Basics',
          'Introduction to Sociology', 'Sets & Functions (Maths)', 'Political Theory', 'India — Physical Geography'
        ],
        class12: [
          'Integration by Parts (Maths)', 'Electrochemistry', 'Human Reproduction (Biology)',
          'Electromagnetic Induction', 'Probability — Bayes\' Theorem', 'Coordination Compounds',
          'Genetics & Evolution', 'Current Electricity'
        ],
      };

      // SSC exam specific topics with day rotation
      const SSC_TOPICS = {
        cgl:   ['QA — Percentage & Profit/Loss', 'English — Reading Comprehension', 'GA — Current Affairs (Last 3 months)', 'Reasoning — Syllogism', 'QA — Time, Speed & Distance', 'English — Cloze Test'],
        chsl:  ['English — Fill in the Blanks', 'Maths — Speed, Time & Distance', 'GK — History of India', 'Reasoning — Number Series', 'English — Sentence Improvement', 'Maths — Mensuration'],
        gd:    ['Maths — Number System', 'GK — Indian Polity & Constitution', 'English — Vocabulary', 'Reasoning — Analogy', 'Maths — Average & Percentage', 'GK — Indian Geography'],
        mts:   ['Maths — Simple & Compound Interest', 'GK — Indian Geography', 'English — Grammar Rules', 'Reasoning — Coding-Decoding', 'Maths — Ratio & Proportion', 'GK — Science (Basic)'],
        cpo:   ['Maths — Profit & Loss', 'GK — Science & Technology', 'English — Error Detection', 'Reasoning — Direction Sense', 'Maths — Data Interpretation', 'GK — Indian Polity'],
        cds:   ['Maths — Algebra', 'English — Antonyms & Synonyms', 'GK — Defence Affairs', 'Reasoning — Logical Venn Diagrams'],
        nda:   ['Maths — Trigonometry', 'English — Para Jumbles', 'GK — Science & Technology', 'Reasoning — Mathematical Operations'],
        upsc:  ['Current Affairs — National', 'Indian Polity — Legislature', 'Ancient History — Mauryan Empire', 'Geography — Monsoon System', 'Economy — GDP & National Income'],
        ibps:  ['Quantitative Aptitude — DI', 'English — RC & Para Summary', 'Reasoning — Puzzles', 'GA — Banking Awareness', 'Computer — Basic Terms'],
        sbi:   ['QA — Simplification', 'English — Word Usage', 'Reasoning — Seating Arrangement', 'GA — Financial Awareness', 'Computer Awareness'],
      };

      const todayDayIdx = new Date().getDay(); // 0–6
      // Map class variants (class11_sci etc.) to topics
      let topicKey = sscMode;
      if (isClass && !CLASS_TOPICS[topicKey]) {
        // try base class
        const base = sscMode.replace(/_sci|_com|_arts/, '');
        topicKey = CLASS_TOPICS[base] ? base : 'class10';
      }
      const allRec = isClass ? (CLASS_TOPICS[topicKey] || CLASS_TOPICS['class10']) : (SSC_TOPICS[sscMode] || SSC_TOPICS['cgl']);
      // Pick 3 topics rotating daily
      const recommendedTopics = [
        allRec[todayDayIdx % allRec.length],
        allRec[(todayDayIdx+1) % allRec.length],
        allRec[(todayDayIdx+2) % allRec.length]
      ];

      // Show subjects for class mode
      const subjectBadges = isClass && modeConf && modeConf.subjects
        ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${modeConf.subjects.slice(0,5).map(s=>`<span class="cf-topic-tag">${s}</span>`).join('')}${modeConf.subjects.length>5?`<span class="cf-topic-tag">+${modeConf.subjects.length-5} more</span>`:''}</div>`
        : '';

      body.innerHTML = `
        <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--primary,#6C63FF);margin-bottom:6px;text-align:center">📚 ${goalLabel}</div>
        ${subjectBadges}
        <div class="cf-goal-hero">
          <div class="cf-goal-circle" style="--pct:${pct}">
            <div class="cf-goal-inner">
              <div class="cf-goal-num">${today}/${goal}</div>
              <div class="cf-goal-sub">Today</div>
            </div>
          </div>
          <div class="cf-goal-stats">
            <div class="cf-goal-stat"><span style="color:#FF6B9D;font-size:22px">🔥 ${streak}</span><small>Day Streak</small></div>
            <div class="cf-goal-stat"><span style="color:#f59e0b;font-size:22px">⭐ Lv.${lvl}</span><small>${xp} XP total</small></div>
          </div>
        </div>
        ${today>=goal ? `<div class="cf-goal-done">🎯 Daily goal complete! Come back tomorrow to keep your streak!</div>` : `
          <div style="margin:16px 0">
            <div class="cf-goal-bar-track"><div class="cf-goal-bar-fill" style="width:${pct}%"></div></div>
            <div class="cf-muted" style="font-size:12px;margin-top:6px">${goal-today} more questions to hit your daily goal</div>
          </div>`}
        ${weak.length ? `
          <div class="cf-weak-alert" style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">⚠️ Needs Improvement</div>
            ${weak.map(t=>`<div style="margin:4px 0">• <strong>${t.topic}</strong> — ${t.accuracy}% accuracy (${t.attempts} attempts)</div>`).join('')}
          </div>` : ''}
        <div class="cf-weak-alert" style="margin-top:16px;background:rgba(108,99,255,0.10);border-color:rgba(108,99,255,0.35);">
          <div style="font-weight:700;margin-bottom:8px;color:var(--primary,#6C63FF)">📅 Today's Focus — ${modeLabel}</div>
          ${recommendedTopics.map((t,i)=>`
            <div style="margin:6px 0;display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(108,99,255,0.06);border-radius:8px;">
              <span style="font-size:16px">${['🎯','📖','⚡'][i]}</span>
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text-primary,#f0f0f5)">${t}</div>
                <div style="font-size:10px;color:rgba(26,26,38,0.70);margin-top:2px">${['Start with this first','Build on the first topic','Consolidate your learning'][i]}</div>
              </div>
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap">
          <button class="cf-btn cf-btn-ghost" onclick="CF.closeModal('cf-daily-modal');CF.openMockTest()">🎯 Take Mock Test</button>
        </div>`;
    },

    /* ── SCORE PREDICTOR RENDERING ── */
    _renderScorePredictor() {
      const body = document.getElementById('cf-score-modal_body');
      if (!body) return;
      // Include all study modes: exams, classes
      const exams = Object.entries(EXAM_CONFIGS).filter(([k,v])=>v.type==='exam'||v.type==='class');
      body.innerHTML = `
        <p class="cf-muted" style="margin-bottom:16px">Enter your expected scores to predict rank and cutoff status</p>
        <div class="cf-form-card">
          <select class="cf-input cf-select" id="sp-exam">
            <optgroup label="── SSC Exams ──">
              ${Object.entries(EXAM_CONFIGS).filter(([k,v])=>v.type==='exam'&&['cgl','chsl','gd','mts','cpo'].includes(k)).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
            </optgroup>
            <optgroup label="── Competitive Exams ──">
              ${Object.entries(EXAM_CONFIGS).filter(([k,v])=>v.type==='exam'&&!['cgl','chsl','gd','mts','cpo'].includes(k)).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
            </optgroup>
            <optgroup label="── Class 1–12 ──">
              ${Object.entries(EXAM_CONFIGS).filter(([k,v])=>v.type==='class').map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
            </optgroup>

          </select>
          <div style="display:flex;gap:8px">
            <input class="cf-input" id="sp-score" type="number" placeholder="Your score (e.g. 155)" min="0" max="400" style="flex:1"/>
            <input class="cf-input" id="sp-max" type="number" placeholder="Max score (e.g. 200)" min="1" max="400" style="flex:1"/>
          </div>
          <select class="cf-input cf-select" id="sp-cat">
            <option value="gen">General</option>
            <option value="obc">OBC</option>
            <option value="sc">SC</option>
            <option value="st">ST</option>
          </select>
          <button class="cf-btn cf-btn-primary" style="width:100%" onclick="CF._calcScore()">📊 Predict My Rank</button>
        </div>
        <div id="sp-result" style="margin-top:16px"></div>`;
    },
    _calcScore() {
      const exam = document.getElementById('sp-exam')?.value;
      const score = parseFloat(document.getElementById('sp-score')?.value);
      const max = parseFloat(document.getElementById('sp-max')?.value);
      const cat = document.getElementById('sp-cat')?.value || 'gen';
      const el = document.getElementById('sp-result');
      if (!el) return;
      if (!score || !max || max <= 0) { el.innerHTML = '<p class="cf-red">Please enter valid scores.</p>'; return; }
      const p = ScorePredictor.predict(exam, score, max, cat);
      if (!p) { el.innerHTML = '<p class="cf-muted">Cutoff data for this exam coming soon.</p>'; return; }
      el.innerHTML = `
        <div class="cf-predictor-card ${p.safe?'cf-safe':'cf-danger'}">
          <div style="font-size:32px;margin-bottom:8px">${p.safe?'🏆':'📚'}</div>
          <div style="font-size:22px;font-weight:700">${p.pct}% Score</div>
          <div style="margin:8px 0">Estimated Rank: <strong>#${p.rank.toLocaleString()}</strong></div>
          <div style="margin:8px 0">Cutoff (${cat.toUpperCase()}): <strong>${p.cutoff}</strong></div>
          <div class="cf-cutoff-status">${p.safe ? '✅ You\'re above the cutoff! Great job!' : '⚠️ '+p.gap.toFixed(1)+' marks below cutoff. Keep practicing!'}</div>
        </div>
        <button class="cf-btn cf-btn-ghost" style="margin-top:12px;width:100%" onclick="CF.closeModal('cf-score-modal');CF.openAnalytics()">View Your Analytics →</button>`;
    },

    /* ── REFERRAL RENDERING ── */
    _renderReferral() {
      const body = document.getElementById('cf-referral-modal_body');
      if (!body) return;
      const refCode = Referral.getCode();
      const refCount = Referral.getReferralCount();
      body.innerHTML = `
        <p class="cf-muted" style="margin-bottom:12px">Refer 3 friends → Unlock <strong>PYQ Bank & Mock Test</strong> free for you both!</p>
        <div class="cf-ref-code">
          <div class="cf-section-label">YOUR CODE</div>
          <div class="cf-ref-code-val">${refCode}</div>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;justify-content:center">
            <button class="cf-btn cf-btn-primary" onclick="Referral.inviteViaWhatsApp()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:6px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Invite via WhatsApp
            </button>
            <button class="cf-btn cf-btn-ghost" onclick="Referral.copyInviteLink()">📋 Copy Invite Link</button>
          </div>
        </div>
        <div class="cf-section-label" style="margin-top:16px">REFERRAL PROGRESS</div>
        <div class="cf-ref-progress">
          ${[0,1,2].map(i=>`
            <div class="cf-ref-dot ${i<refCount?'cf-ref-dot-done':'cf-ref-dot-open'}">${i<refCount?'✓':(i+1)}</div>
            ${i<2?'<div class="cf-ref-line"></div>':''}`).join('')}
          <span style="font-size:12px;color:var(--text-secondary,rgba(240,240,245,0.55));margin-left:8px">${refCount}/3 referred</span>
        </div>
        <div class="cf-form-card" style="margin-top:16px">
          <div class="cf-section-label">GOT A FRIEND'S CODE?</div>
          <input class="cf-input" id="cf-ref-input" placeholder="Enter referral code (e.g. CRACKABCD12)" maxlength="14" style="text-transform:uppercase" onkeydown="if(event.key==='Enter')document.getElementById('cf-ref-apply-btn').click()"/>
          <button id="cf-ref-apply-btn" class="cf-btn cf-btn-ghost" style="width:100%" onclick="Referral.applyReferral(document.getElementById('cf-ref-input').value.trim())">✅ Apply Code</button>
        </div>`;
    },
  };

  /* ─────────────────────────────────────────────────────────────
   * SECTION 12 — STYLES
   * ───────────────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('cf-styles')) return;
    const s = document.createElement('style');
    s.id = 'cf-styles';
    s.textContent = `
      /* ── Modal Shell ── */
      .cf-modal {
        display:none;position:fixed;inset:0;z-index:10000;
        background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);
        align-items:flex-end;justify-content:center;
        padding:0;
      }
      .cf-modal.cf-active { display:flex; }
      @media(min-width:600px){
        .cf-modal { align-items:center; padding:20px; }
        .cf-modal-box { max-height:90vh; border-radius:24px !important; }
      }
      .cf-modal-box {
        background:var(--bg-secondary,#111118);
        border:1px solid var(--border,rgba(255,255,255,0.08));
        border-radius:24px 24px 0 0;
        width:100%;max-width:560px;
        max-height:92vh;display:flex;flex-direction:column;
        overflow:hidden;box-shadow:0 -8px 40px rgba(0,0,0,0.5);
        animation:cfSlideUp 0.28s cubic-bezier(0.34,1.2,0.64,1);
      }
      .cf-modal-wide { max-width:720px; }
      /* Fullscreen modal */
      .cf-modal-fullscreen {
        align-items:stretch !important;
        padding:0 !important;
      }
      .cf-modal-fs-box {
        max-width:100% !important;
        max-height:100vh !important;
        height:100vh !important;
        border-radius:0 !important;
        width:100% !important;
      }
      .cf-modal-fullscreen .cf-modal-body {
        flex:1;
        display:flex;
        flex-direction:column;
      }
      .cf-chat-fullscreen {
        flex:1 !important;
        height:auto !important;
        min-height:0 !important;
        max-height:none !important;
      }
      @keyframes cfSlideUp{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
      .cf-modal-hdr {
        display:flex;align-items:center;justify-content:space-between;
        padding:16px 20px;border-bottom:1px solid var(--border,rgba(255,255,255,0.08));
        flex-shrink:0;
      }
      .cf-modal-title { font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:700;color:var(--text-primary,#f0f0f5); }
      .cf-modal-close { width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary,rgba(240,240,245,0.62));background:var(--surface,#1a1a26);font-size:14px;transition:background 0.2s; }
      .cf-modal-close:hover { background:var(--surface-light,#22223a); }
      .cf-modal-body { padding:16px 20px;overflow-y:auto;flex:1; }
      /* ── Common ── */
      .cf-section-label { font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted,rgba(240,240,245,0.35));margin:4px 0 10px; }
      .cf-muted { color:var(--text-secondary,rgba(240,240,245,0.5));font-size:13px; }
      .cf-red { color:#ef4444; }
      .cf-center-text { text-align:center;padding:12px 0; }
      .cf-center-text h3 { font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700;color:var(--text-primary,#f0f0f5);margin-bottom:6px; }
      .cf-input {
        width:100%;padding:12px 14px;border-radius:12px;
        background:var(--surface,#1a1a26);border:1px solid var(--border,rgba(255,255,255,0.08));
        color:var(--text-primary,#f0f0f5);font-size:14px;font-family:'Plus Jakarta Sans',sans-serif;
        margin-bottom:10px;box-sizing:border-box;
      }
      .cf-select { cursor:pointer; }
      .cf-form-card { background:var(--surface,#1a1a26);border:1px solid var(--border,rgba(255,255,255,0.08));border-radius:16px;padding:16px; }
      /* ── Buttons ── */
      .cf-btn { padding:11px 18px;border-radius:12px;font-size:13px;font-weight:600;font-family:'Plus Jakarta Sans',sans-serif;transition:all 0.18s;cursor:pointer; }
      .cf-btn-primary { background:linear-gradient(135deg,#6C63FF,#FF6B9D);color:var(--text-primary);border:none; }
      .cf-btn-primary:hover { transform:translateY(-1px);box-shadow:0 4px 16px rgba(108,99,255,0.4); }
      .cf-btn-ghost { background:var(--surface,#1a1a26);color:var(--text-primary,#f0f0f5);border:1px solid var(--border,rgba(255,255,255,0.08)); }
      .cf-btn-danger { background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3); }
      .cf-btn-sm { padding:7px 14px;font-size:12px; }
      /* ── PYQ ── */
      .cf-exam-grid { display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px; }
      .cf-exam-chip {
        padding:8px 16px;border-radius:20px;font-size:13px;font-weight:600;
        background:rgba(108,99,255,0.12);
        border:1.5px solid rgba(108,99,255,0.3);
        color:var(--text-primary,#f0f0f5);transition:all 0.18s;cursor:pointer;
      }
      .cf-exam-chip:hover { background:rgba(108,99,255,0.22);border-color:var(--ec,#6C63FF); }
      .cf-year-row { display:flex;flex-wrap:wrap;gap:8px; }
      .cf-year-btn { padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;background:var(--surface,#1a1a26);border:1px solid var(--border,rgba(255,255,255,0.08));color:var(--text-primary,#f0f0f5);transition:all 0.18s;cursor:pointer; }
      .cf-year-btn:hover { background:var(--surface-light,#22223a);border-color:var(--accent,#6C63FF); }
      /* ── Class Grid ── */
      .cf-class-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px; }
      .cf-class-card {
        padding:14px 12px;border-radius:14px;text-align:center;cursor:pointer;
        background:rgba(108,99,255,0.08);border:1.5px solid rgba(108,99,255,0.2);
        transition:all 0.18s;
      }
      .cf-class-card:hover { background:rgba(108,99,255,0.18);border-color:var(--ec,#6C63FF);transform:translateY(-2px); }
      .cf-class-label { font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:700;color:var(--text-primary,#f0f0f5);margin-bottom:4px; }
      .cf-class-subjects { font-size:10px;color:var(--text-muted,rgba(240,240,245,0.4));line-height:1.4; }
      /* ── Question Card ── */
      .cf-q-card { background:var(--surface,#1a1a26);border:1px solid var(--border,rgba(255,255,255,0.08));border-radius:16px;padding:16px;margin-bottom:12px; }
      .cf-q-num { font-size:11px;font-weight:700;color:var(--text-muted,rgba(240,240,245,0.35));margin-bottom:8px;display:flex;align-items:center;gap:6px; }
      .cf-q-text { font-size:14px;font-weight:500;color:var(--text-primary,#f0f0f5);line-height:1.5;margin-bottom:12px; }
      .cf-opts { display:flex;flex-direction:column;gap:8px; }
      .cf-opt { text-align:left;padding:10px 14px;border-radius:10px;background:var(--bg-secondary,#111118);border:1px solid var(--border,rgba(255,255,255,0.08));color:var(--text-primary,#f0f0f5);font-size:13px;transition:all 0.15s;cursor:pointer; }
      .cf-opt:not(:disabled):hover { background:rgba(108,99,255,0.1);border-color:#6C63FF; }
      .cf-opt-correct { background:rgba(34,197,94,0.15) !important;border-color:#22c55e !important;color:#22c55e !important; }
      .cf-opt-wrong   { background:rgba(239,68,68,0.12) !important;border-color:#ef4444 !important;color:#ef4444 !important; }
      .cf-exp { margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.2);font-size:12px;color:var(--text-secondary,rgba(240,240,245,0.62));line-height:1.5; }
      .cf-topic-tag { font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(108,99,255,0.15);color:#5b46d4;font-weight:600; }
      /* ── Loading ── */
      .cf-loading-wrap { display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;gap:12px; }
      .cf-spinner { width:36px;height:36px;border:3px solid rgba(108,99,255,0.2);border-top-color:#6C63FF;border-radius:50%;animation:cfSpin 0.8s linear infinite; }
      @keyframes cfSpin { to { transform:rotate(360deg); } }
      /* ── Mock Test ── */
      .cf-mock-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:8px; }
      .cf-mock-progress { font-size:13px;font-weight:700;color:var(--text-secondary,rgba(240,240,245,0.62)); }
      .cf-mock-timer { font-size:14px;font-weight:700;color:#22c55e;font-family:'Space Grotesk',sans-serif; }
      .cf-mock-bar-wrap { height:3px;background:var(--border,rgba(255,255,255,0.08));border-radius:2px;overflow:hidden;margin-bottom:4px; }
      .cf-mock-bar { height:100%;background:linear-gradient(90deg,#6C63FF,#FF6B9D);transition:width 0.3s; }
      /* ── Results ── */
      .cf-results-header { text-align:center;padding:12px 0 16px;border-bottom:1px solid var(--border,rgba(255,255,255,0.08));margin-bottom:16px; }
      .cf-results-header h2 { font-family:'Space Grotesk',sans-serif;font-size:24px;font-weight:800;color:var(--text-primary,#f0f0f5); }
      .cf-score-pill { display:inline-block;background:linear-gradient(135deg,#6C63FF,#FF6B9D);color:var(--text-primary);padding:6px 18px;border-radius:20px;font-weight:700;font-size:15px;margin-top:6px; }
      .cf-results-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px; }
      .cf-result-stat { text-align:center;padding:12px;border-radius:12px;background:var(--surface,#1a1a26);border:1px solid var(--border,rgba(255,255,255,0.08)); }
      .cf-result-stat div { font-size:22px;font-weight:800;color:var(--rc,#fff);font-family:'Space Grotesk',sans-serif; }
      .cf-result-stat span { font-size:10px;color:var(--text-muted,rgba(240,240,245,0.35));font-weight:600; }
      .cf-predictor-card { padding:16px;border-radius:14px;text-align:center;font-size:14px;margin:12px 0; }
      .cf-safe { background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:var(--text-primary,#f0f0f5); }
      .cf-danger { background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:var(--text-primary,#f0f0f5); }
      .cf-cutoff-status { margin-top:10px;font-weight:600;font-size:13px; }
      .cf-ai-review-wrap { margin-top:12px; }
      .cf-ai-review { padding:14px;border-radius:12px;background:var(--surface,#1a1a26);border:1px solid var(--border,rgba(255,255,255,0.08));font-size:13px;line-height:1.6;color:var(--text-secondary,rgba(240,240,245,0.75));min-height:60px; }
      /* ── Analytics ── */
      .cf-stat-row { display:grid;grid-template-columns:repeat(4,1fr);gap:8px; }
      .cf-stat-card { text-align:center;padding:12px 6px;border-radius:14px;background:var(--surface,#1a1a26);border:1px solid var(--border,rgba(255,255,255,0.08)); }
      .cf-stat-val { font-size:18px;font-weight:800;font-family:'Space Grotesk',sans-serif;line-height:1.2; }
      .cf-stat-lbl { font-size:10px;color:var(--text-muted,rgba(240,240,245,0.35));font-weight:600;margin-top:2px; }
      .cf-chart-wrap { display:flex;align-items:flex-end;justify-content:space-between;height:100px;gap:4px;padding:8px 0; }
      .cf-chart-col { flex:1;display:flex;flex-direction:column;align-items:center;gap:3px; }
      .cf-chart-bar-wrap { flex:1;width:100%;display:flex;align-items:flex-end;min-height:60px; }
      .cf-chart-bar { width:100%;min-height:3px;border-radius:4px 4px 0 0;transition:height 0.5s; }
      .cf-chart-lbl { font-size:9px;color:var(--text-muted,rgba(240,240,245,0.35));font-weight:600; }
      .cf-chart-pct { font-size:9px;color:var(--accent,#6C63FF);font-weight:700; }
      .cf-topic-list { display:flex;flex-direction:column;gap:8px; }
      .cf-topic-row { display:flex;align-items:center;gap:8px; }
      .cf-topic-name { font-size:12px;font-weight:600;color:var(--text-secondary,rgba(240,240,245,0.62));width:120px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .cf-topic-bar-wrap { flex:1;height:6px;background:var(--border,rgba(255,255,255,0.08));border-radius:3px;overflow:hidden; }
      .cf-topic-bar { height:100%;border-radius:3px;transition:width 0.6s cubic-bezier(0.34,1.3,0.64,1); }
      .cf-topic-pct { font-size:11px;font-weight:700;width:34px;text-align:right; }
      .cf-weak-alert { padding:14px;border-radius:14px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);font-size:13px;color:var(--text-primary,#f0f0f5);line-height:1.6; }
      /* ── Groups ── */
      .cf-group-card { display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-radius:16px;background:var(--surface,#1a1a26);border:1px solid var(--border,rgba(255,255,255,0.08));margin-bottom:10px;transition:border-color 0.2s; }
      .cf-group-card:hover { border-color:rgba(108,99,255,0.35); }
      .cf-group-info strong { font-size:14px;font-weight:700;color:var(--text-primary,#f0f0f5); }
      .cf-group-meta { font-size:11px;color:var(--text-muted,rgba(240,240,245,0.35));margin-top:4px; }
      .cf-group-meta code { background:rgba(108,99,255,0.15);color:#5b46d4;padding:1px 7px;border-radius:6px;font-family:'Space Grotesk',sans-serif;font-weight:700;letter-spacing:0.12em; }

      /* ── Chat Topbar ── */
      .cf-chat-topbar { display:flex;align-items:center;gap:8px;padding:8px 0 12px;border-bottom:1px solid var(--border,rgba(255,255,255,0.08));flex-shrink:0; }
      .cf-chat-back { padding:7px 12px;font-size:13px;flex-shrink:0; }
      .cf-chat-topbar-info { flex:1;display:flex;flex-direction:column;min-width:0; }
      .cf-chat-gname { font-size:14px;font-weight:700;color:var(--text-primary,#f0f0f5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
      .cf-chat-code-btn { font-size:11px;padding:6px 10px;border-radius:10px;flex-shrink:0;font-weight:700;font-family:'Space Grotesk',sans-serif;letter-spacing:0.06em; }

      /* ── Admin Bar ── */
      .cf-admin-bar { background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.2);border-radius:12px;padding:8px 12px;display:flex;align-items:center;gap:8px;flex-shrink:0;margin:8px 0;flex-wrap:wrap; }

      /* ── Chat Messages (new beautiful design) ── */
      .cf-chat-messages { overflow-y:auto;display:flex;flex-direction:column;gap:3px;padding:10px 0 4px;margin-bottom:8px; }
      .cf-chat-fullscreen { flex:1 !important;height:auto !important;min-height:120px !important;max-height:none !important; }
      .cf-chat-row { display:flex;align-items:flex-end;gap:8px;padding:0 2px; }
      .cf-chat-row-mine { flex-direction:row-reverse; }
      .cf-chat-row-other { flex-direction:row; }
      .cf-chat-avatar { width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#6C63FF,#FF6B9D);color:var(--text-primary);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-bottom:16px; }
      .cf-chat-avatar-gap { width:28px;flex-shrink:0; }
      .cf-chat-col { display:flex;flex-direction:column;max-width:72%;gap:2px; }
      .cf-chat-sender { font-size:10px;font-weight:600;color:rgba(167,139,250,0.8);padding-left:4px;margin-bottom:1px; }
      .cf-chat-bubble-wrap { display:flex;flex-direction:column; }
      .cf-chat-bubble-wrap.cf-mine { align-items:flex-end; }
      .cf-chat-bubble2 { padding:9px 13px;border-radius:18px;font-size:13.5px;line-height:1.45;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:var(--text-primary,#f0f0f5);word-break:break-word; }
      .cf-mine .cf-chat-bubble2 { background:linear-gradient(135deg,#6C63FF,#5752d1);border-color:transparent;color:var(--text-primary);border-bottom-right-radius:4px; }
      .cf-chat-row-other .cf-chat-col .cf-chat-bubble2 { border-bottom-left-radius:4px; }
      .cf-chat-time2 { font-size:9px;color:rgba(26,26,38,0.65);margin-top:3px;padding:0 4px; }
      .cf-mine .cf-chat-time2 { text-align:right; }

      /* ── Chat Input ── */
      .cf-chat-input-row { display:flex;gap:8px;padding-top:8px;flex-shrink:0;align-items:center; }
      .cf-chat-input-row .cf-input { margin-bottom:0;flex:1;border-radius:22px;padding:10px 16px; }
      .cf-chat-send-btn { width:40px;height:40px;border-radius:50%;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:linear-gradient(135deg,#6C63FF,#FF6B9D);border:none; }

      /* ── Quiz Battle ── */
      .cf-quiz-battle-wrap { background:rgba(108,99,255,0.06);border:1px solid rgba(108,99,255,0.2);border-radius:16px;padding:16px;margin:8px 0;flex-shrink:0; }
      .cf-quiz-progress-row { display:flex;align-items:center;justify-content:space-between;margin-bottom:6px; }
      .cf-quiz-qnum { font-size:11px;font-weight:700;color:rgba(26,26,38,0.70);text-transform:uppercase;letter-spacing:0.05em; }
      .cf-quiz-bar-track { height:3px;background:rgba(255,255,255,0.08);border-radius:2px;margin-bottom:12px;overflow:hidden; }
      .cf-quiz-bar-fill { height:100%;background:linear-gradient(90deg,#6C63FF,#FF6B9D);border-radius:2px;transition:width 0.4s; }
      .cf-quiz-q { font-size:15px;font-weight:600;color:var(--text-primary,#f0f0f5);line-height:1.5;margin-bottom:12px; }
      .cf-quiz-opts { display:flex;flex-direction:column;gap:7px; }
      .cf-quiz-opt { display:flex;align-items:center;gap:10px;text-align:left;padding:10px 14px;border-radius:11px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:var(--text-primary,#f0f0f5);font-size:13px;transition:all 0.15s;cursor:pointer; }
      .cf-quiz-opt:not(.cf-quiz-opt-disabled):hover { background:rgba(108,99,255,0.15);border-color:#6C63FF;transform:translateX(3px); }
      .cf-quiz-opt-disabled { cursor:default;pointer-events:none; }
      .cf-quiz-opt-correct { background:rgba(34,197,94,0.15) !important;border-color:#22c55e !important;color:#22c55e !important; }
      .cf-quiz-opt-wrong   { background:rgba(239,68,68,0.12) !important;border-color:#ef4444 !important;color:#ef4444 !important; }
      .cf-quiz-opt-dim     { opacity:0.45; }
      .cf-quiz-opt-letter { width:22px;height:22px;border-radius:50%;background:rgba(108,99,255,0.2);color:#5b46d4;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
      .cf-quiz-answered-banner { margin-top:10px;padding:8px 12px;border-radius:10px;font-size:12px;font-weight:600; }
      .cf-quiz-answered-banner.cf-correct { background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#22c55e; }
      .cf-quiz-answered-banner.cf-wrong   { background:rgba(239,68,68,0.10);border:1px solid rgba(239,68,68,0.25);color:#f87171; }
      .cf-quiz-exp { margin-top:8px;padding:8px 12px;border-radius:10px;background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.15);font-size:12px;color:rgba(26,26,38,0.7);line-height:1.5; }
      .cf-quiz-waiting { margin-top:10px;padding:8px 12px;border-radius:10px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);font-size:12px;color:#fbbf24;text-align:center; }

      /* ── XP Leaderboard ── */
      .cf-xp-board { margin-top:12px;background:rgba(0,0,0,0.2);border-radius:12px;padding:10px 12px; }
      .cf-xp-row { display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05); }
      .cf-xp-row:last-child { border-bottom:none; }
      .cf-xp-me { background:rgba(108,99,255,0.12);border-radius:8px;padding:5px 8px;margin:-2px -4px; }
      .cf-xp-rank { font-size:16px;width:24px;text-align:center;flex-shrink:0; }
      .cf-xp-name { flex:1;font-size:13px;font-weight:600;color:var(--text-primary,#f0f0f5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
      .cf-xp-val { font-size:13px;font-weight:800;color:#f59e0b;font-family:'Space Grotesk',sans-serif; }

      .cf-empty-state { text-align:center;padding:32px;color:var(--text-muted,rgba(240,240,245,0.35));font-size:14px; }
      /* ── Daily Goal ── */
      .cf-goal-hero { display:flex;align-items:center;gap:20px;padding:8px 0 16px; }
      .cf-goal-circle {
        position:relative;width:90px;height:90px;border-radius:50%;flex-shrink:0;
        background:conic-gradient(#6C63FF calc(var(--pct)*1%),rgba(255,255,255,0.06) 0);
        display:flex;align-items:center;justify-content:center;
      }
      .cf-goal-inner { width:72px;height:72px;border-radius:50%;background:var(--bg-secondary,#111118);display:flex;flex-direction:column;align-items:center;justify-content:center; }
      .cf-goal-num { font-size:16px;font-weight:800;font-family:'Space Grotesk',sans-serif;color:var(--text-primary,#f0f0f5); }
      .cf-goal-sub { font-size:9px;font-weight:600;color:var(--text-muted,rgba(240,240,245,0.35));text-transform:uppercase; }
      .cf-goal-stats { display:flex;flex-direction:column;gap:12px; }
      .cf-goal-stat { display:flex;flex-direction:column; }
      .cf-goal-stat small { font-size:10px;color:var(--text-muted,rgba(240,240,245,0.35));font-weight:600; }
      .cf-goal-bar-track { height:6px;background:var(--border,rgba(255,255,255,0.08));border-radius:3px;overflow:hidden; }
      .cf-goal-bar-fill { height:100%;background:linear-gradient(90deg,#6C63FF,#FF6B9D);border-radius:3px;transition:width 0.5s; }
      .cf-goal-done { text-align:center;padding:16px;border-radius:14px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#22c55e;font-weight:600;font-size:14px; }
      /* ── Referral ── */
      .cf-ref-code { background:var(--surface,#1a1a26);border:1px solid rgba(108,99,255,0.4);border-radius:14px;padding:18px;text-align:center;margin:12px 0; }
      .cf-ref-code-val { font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:800;letter-spacing:0.12em;color:#5b46d4;margin:8px 0; }
      .cf-ref-progress { display:flex;align-items:center;gap:8px;margin:12px 0; }
      .cf-ref-dot { width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700; }
      .cf-ref-dot-done { background:rgba(34,197,94,0.2);border:2px solid #22c55e;color:#22c55e; }
      .cf-ref-dot-open { background:var(--surface,#1a1a26);border:2px solid var(--border,rgba(255,255,255,0.08));color:var(--text-muted,rgba(240,240,245,0.35)); }
      .cf-ref-line { flex:1;height:2px;background:var(--border,rgba(255,255,255,0.08)); }
      /* ── Sidebar Feature Section ── */
      #cf-sidebar-features {
        padding:8px 12px 4px;
        border-bottom:1px solid var(--border,rgba(255,255,255,0.08));
        margin-bottom:4px;
      }
      #cf-sidebar-features .cf-sidebar-title {
        font-size:10px;font-weight:700;text-transform:uppercase;
        letter-spacing:0.1em;color:var(--text-muted,rgba(240,240,245,0.35));
        padding:4px 2px 6px;
      }
      .cf-sidebar-btn {
        display:flex;align-items:center;gap:10px;
        padding:9px 10px;border-radius:10px;
        background:none;border:none;
        color:var(--text-secondary,rgba(240,240,245,0.7));
        font-size:13px;font-weight:600;
        font-family:'Plus Jakarta Sans',sans-serif;
        cursor:pointer;transition:background 0.15s;
        text-align:left;width:100%;
      }
      .cf-sidebar-btn:hover { background:var(--surface,#1a1a26); }
      .cf-sidebar-btn .cf-sb-icon { font-size:16px;flex-shrink:0;width:20px;text-align:center; }
      /* ── Daily progress bar in sidebar ── */
      #cf-daily-bar {
        display:flex;align-items:center;gap:8px;
        padding:6px 10px;margin:2px 0;border-radius:10px;
        background:var(--surface,#1a1a26);border:1px solid var(--border,rgba(255,255,255,0.06));
        font-size:11px;font-weight:600;color:var(--text-secondary,rgba(240,240,245,0.55));
        cursor:pointer;transition:background 0.18s;
      }
      #cf-daily-bar:hover { background:var(--surface-light,#22223a); }
      #cf-goal-bar-track { flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden; }
      #cf-goal-bar { height:100%;background:linear-gradient(90deg,#6C63FF,#FF6B9D);border-radius:2px;transition:width 0.4s; }
      /* Hide message limit counter on home page */
      #messageLimitInfo { display:none !important; }
      /* Light theme */
      [data-theme="light"] .cf-modal-box { box-shadow:0 -8px 40px rgba(0,0,0,0.15); }
      [data-theme="light"] .cf-exam-chip { color:#1a1a2e; }
      [data-theme="light"] .cf-year-btn { color:#1a1a2e; }
      [data-theme="light"] .cf-sidebar-btn { color:rgba(20,20,40,0.75); }
      /* ── Mobile responsive overrides ── */
      @media(max-width:480px) {
        .cf-results-grid { grid-template-columns:repeat(2,1fr) !important; }
        .cf-stat-row { grid-template-columns:repeat(2,1fr) !important; }
        .cf-goal-hero { flex-direction:column;align-items:center;gap:12px; }
        .cf-goal-stats { display:flex;gap:16px;justify-content:center; }
        .cf-modal-box { border-radius:20px 20px 0 0 !important; }
        .cf-modal-body { padding:12px 14px !important; }
        .cf-class-grid { grid-template-columns:repeat(2,1fr) !important; }
        .cf-group-card { flex-direction:column;align-items:flex-start;gap:8px; }
        .cf-group-card .cf-btn-sm { align-self:stretch;text-align:center; }
        .cf-chat-messages { height:200px; }
        .cf-sidebar-btn { font-size:13px;padding:9px 10px; }
        .cf-q-text { font-size:13px; }
        .cf-opt { font-size:12px;padding:9px 12px; }
        .cf-section-label { font-size:11px; }
        #cf-drawer-scroll { -webkit-overflow-scrolling:touch; }
      }
      @media(max-width:360px) {
        .cf-results-grid { grid-template-columns:repeat(2,1fr) !important; gap:6px !important; }
        .cf-result-stat div { font-size:18px !important; }
        .cf-modal-body { padding:10px 12px !important; }
        .cf-btn { padding:10px 14px;font-size:12px; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ─────────────────────────────────────────────────────────────
   * SECTION 13 — DOM INJECTION
   * ───────────────────────────────────────────────────────────── */
  function injectDOM() {
    /* ── 2. Mock Test Modal ── */
    createModal('cf-mock-modal', '🎯 Timed Mock Test', '', { wide: true });

    /* ── 3. Analytics Modal ── */
    createModal('cf-analytics-modal', '📊 Analytics Dashboard', '');

    /* ── 4. Study Groups Modal (FULLSCREEN) ── */
    createFullscreenModal('cf-groups-modal', '👥 Group Study');

    /* ── 5. Daily Goal Modal ── */
    createModal('cf-daily-modal', '🔥 Daily Study Goal', '');

    /* ── 6. Score Predictor Modal ── */
    createModal('cf-score-modal', '🏆 Score Predictor', '');

    /* ── 7. Referral Modal ── */
    createModal('cf-referral-modal', '🎁 Refer & Earn', '');

    /* ── 8. Exam Expansion Modal ── */
    createModal('cf-exam-modal', '📖 Exam & Class Expansion', '', { wide: true });

    /* ── 9. Inject Features section into SIDEBAR with scroll wrapper ── */
    const drawerList = document.getElementById('historyList');
    if (drawerList && !document.getElementById('cf-sidebar-features')) {
      const items = [
        { icon:'🎯', label:'Mock Test AI',       cb:'CF._showMockTestRemaining();CF.openMockTest()', premium:false },
        { icon:'📊', label:'Analytics AI',       cb:'CF.openAnalytics()', premium:true  },
        { icon:'🏆', label:'Rank Predictor AI',  cb:'CF.openScorePredictor()', premium:false },
        { icon:'👥', label:'Group Study AI',     cb:'CF.openStudyGroups()', premium:false },
      ];

      // Build study tools block
      const featureWrap = document.createElement('div');
      featureWrap.id = 'cf-sidebar-features';
      featureWrap.innerHTML = `
        <div class="cf-sidebar-title">Study Tools</div>
        ${items.map(i=>`
          <button class="cf-sidebar-btn" onclick="${i.cb};document.getElementById('historyDrawer')?.classList.remove('open')" style="${i.premium&&!isPrem()?'opacity:0.85;':''}" title="${i.premium&&!isPrem()?i.label+' — Premium':'i.label'}">
            <span class="cf-sb-icon">${i.icon}</span>
            <span style="flex:1;text-align:left">${i.label}</span>
            ${i.premium && !isPrem() ? '<span style="font-size:9px;font-weight:700;background:linear-gradient(135deg,#6C63FF,#FF6B9D);color:var(--text-primary);padding:1px 6px;border-radius:8px;margin-left:auto;flex-shrink:0">PRO</span>' : ''}
          </button>`).join('')}
      `;

      // Create ONE scrollable container for tools + recent chats + history
      // so the bottom nav (Settings) is always pinned and visible
      const scrollWrap = document.createElement('div');
      scrollWrap.id = 'cf-drawer-scroll';

      // Find the "Recent Chats" section label (element before historyList)
      const recentLabel = drawerList.previousElementSibling;
      const parent = drawerList.parentNode;

      // Insert scrollWrap where historyList currently is
      parent.insertBefore(scrollWrap, drawerList);

      // Move "Recent Chats" section label into scrollWrap (if it's the .drawer-section)
      if (recentLabel && recentLabel.classList && recentLabel.classList.contains('drawer-section')) {
        scrollWrap.appendChild(recentLabel);
      }

      // Move historyList into scrollWrap
      scrollWrap.appendChild(drawerList);

      // Prepend Study Tools BEFORE the recent chats label inside scrollWrap
      scrollWrap.insertBefore(featureWrap, scrollWrap.firstChild);
    }
  }

  /* ─────────────────────────────────────────────────────────────
   * SECTION 14 — CHAT INTENT INTERCEPTOR
   * ───────────────────────────────────────────────────────────── */
  function interceptChatForFeatures(userInput) {
    const lower = userInput.toLowerCase();
    const isPYQQuery = /(pyq|previous year|prev year|last year|2024|2023|2022|2021|2020|question bank|cgl question|chsl question)/.test(lower);
    const isMockQuery = /(mock test|full test|practice test|100 question|timed test|exam test)/.test(lower);
    const isGoalQuery = /(daily goal|study goal|streak|today target|how many today)/.test(lower);
    const isAnalyticQuery = /(analytics|my progress|weak topic|performance|accuracy|rank predict|score predict)/.test(lower);
    const isGroupQuery = /(study group|group chat|shared session|group study)/.test(lower);
    const isReferralQuery = /(refer|referral|free premium|invite friend)/.test(lower);
    if (isMockQuery) setTimeout(()=>CF.openMockTest(), 400);
    else if (isGoalQuery) setTimeout(()=>CF.openDailyGoal(), 400);
    else if (isAnalyticQuery) setTimeout(()=>CF.openAnalytics(), 400);
    else if (isGroupQuery) setTimeout(()=>CF.openStudyGroups(), 400);
    else if (isReferralQuery) setTimeout(()=>CF.openReferral(), 400);
  }

  function patchSendMessageForFeatures() {
    const _orig = window.sendMessage;
    if (typeof _orig !== 'function') { setTimeout(patchSendMessageForFeatures, 200); return; }
    if (_orig._cfPatched) return;
    function patched() {
      try {
        const input = document.getElementById('messageInput');
        if (input && input.value) interceptChatForFeatures(input.value);
      } catch {}
      return _orig.apply(this, arguments);
    }
    patched._cfPatched = true;
    window.sendMessage = patched;
  }

  /* ─────────────────────────────────────────────────────────────
   * GROUP BATTLE OPTIMIZATIONS
   * ───────────────────────────────────────────────────────────── */

  // FIX: Prevent questions showing before admin starts battle + optimize polling
  const _origRQQ = CF._renderQuizQuestion;
  CF._renderQuizQuestion = function(quiz, groupId, memberNames) {
    const body = document.getElementById('cf-quiz-area');
    if (!body) return;
    
    // Hide during any non-active status
    if (!quiz || !quiz.status || quiz.status === 'countdown' || quiz.status === 'waiting') { 
      body.innerHTML = '';
      return; 
    }
    
    // Only show questions when status is exactly 'active'
    if (quiz.status !== 'active') { 
      body.innerHTML = '';
      return; 
    }
    
    if (!quiz.questions || quiz.questions.length === 0) { 
      body.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(26,26,38,0.70);">⏳ Loading questions…</div>'; 
      return; 
    }
    
    const qi = quiz.current || 0;
    if (qi < 0 || qi >= quiz.questions.length) { body.innerHTML = ''; return; }
    return _origRQQ.call(this, quiz, groupId, memberNames);
  };

  // Optimize polling with longer intervals and better hash tracking
  if (typeof CF._openGroupChat === 'function') {
    const _origOGC = CF._openGroupChat;
    CF._openGroupChat = async function(groupId) {
      const result = await _origOGC.call(this, groupId);
      setTimeout(() => {
        if (CF._chatPollInterval) clearInterval(CF._chatPollInterval);
        const db = window._firebaseDb, { doc, getDoc } = window._firebaseFns || {};
        if (db && getDoc) {
          CF._chatPollInterval = setInterval(async () => {
            if (!CF._currentGroupId) return;
            if (CF._answerAnimating) return; // never fight the answer animation
            try {
              const snap = await getDoc(doc(db, 'studyGroups', CF._currentGroupId));
              if (!snap.exists()) { if (typeof CF._stopChatPolling === 'function') CF._stopChatPolling(); return; }
              const data = snap.data();
              // More detailed hash to detect actual changes
              const newHash = JSON.stringify({ 
                quizStatus: data.quiz?.status, 
                quizQ: data.quiz?.current, 
                quizAnswers: Object.keys(data.quiz?.answers||{}).length, 
                members: (data.members||[]).length,
                xpOnly: data.quiz?.xp ? Object.values(data.quiz.xp).reduce((a,b)=>a+b,0) : 0
              });
              
              // Only update if data actually changed
              if (newHash !== CF._chatPollHash) {
                CF._chatPollHash = newHash;
                CF._currentGroupData = data;
                
                // Countdown check
                if (data.quiz?.status === 'countdown' && !CF._groupCountdownShown) {
                  if (typeof CF._handleGroupCountdown === 'function') CF._handleGroupCountdown(data, CF._currentGroupId);
                } 
                // Only update questions when status changes to active
                else if (data.quiz?.status === 'active') {
                  if (typeof CF._stopGroupQuizTimer === 'function') CF._stopGroupQuizTimer();
                  if (typeof CF._renderQuizQuestion === 'function') CF._renderQuizQuestion(data.quiz, CF._currentGroupId, data.memberNames);
                  if (typeof CF._startGroupQuizTimer === 'function') CF._startGroupQuizTimer(CF._currentGroupId, data.quiz.current, data.quiz.questionStartedAt);
                } 
                else if (data.quiz?.status === 'finished') {
                  if (typeof CF._stopGroupQuizTimer === 'function') CF._stopGroupQuizTimer();
                  if (typeof CF._renderQuizResults === 'function') CF._renderQuizResults(data.quiz, data.memberNames);
                } 
                else {
                  // Waiting room or countdown - don't show questions
                  if (typeof CF._renderGroupWaitingRoom === 'function') CF._renderGroupWaitingRoom(data, CF._currentGroupId, data.adminUid === (typeof uid === 'function' ? uid() : 'guest'));
                  const qa = document.getElementById('cf-quiz-area');
                  if (qa) qa.innerHTML = '';
                }
              } else {
                // Hash unchanged but check for XP updates and smooth update without full re-render
                const myUid = (typeof uid === 'function' ? uid() : 'guest');
                if (data.quiz?.xp && data.quiz?.xp[myUid] !== undefined) {
                  CF._updateXPDisplay(myUid, data.quiz.xp[myUid]);
                }
              }
            } catch(e) {}
          }, 2000); // Increased to 2000ms to reduce re-renders
        }
      }, 100);
      return result;
    };
  }

  // Live analytics dashboard for admin
  CF.openLiveAnalytics = function(groupId) {
    const modal = document.getElementById('cf-groups-modal'), body = document.getElementById('cf-groups-modal_body');
    if (!modal || !body) return;
    body.innerHTML = `<div class="cf-loading-wrap"><div class="cf-spinner"></div><p class="cf-muted">Loading live dashboard…</p></div>`;
    if (CF._liveState && CF._liveState.poll) clearInterval(CF._liveState.poll);
    if (!CF._liveState) CF._liveState = {};
    CF._renderLiveAnalytics(groupId);
    CF._liveState.poll = setInterval(() => CF._renderLiveAnalytics(groupId), 1000);
  };

  CF._renderLiveAnalytics = async function(groupId) {
    const body = document.getElementById('cf-groups-modal_body'), db = window._firebaseDb, { doc, getDoc } = window._firebaseFns || {};
    if (!body || !db || !getDoc) return;
    try {
      const snap = await getDoc(doc(db, 'studyGroups', groupId));
      if (!snap.exists()) return;
      const data = snap.data(), myUid = (typeof uid === 'function') ? uid() : 'guest';
      if (data.adminUid !== myUid) return;
      const quiz = data.quiz || {}, members = data.members || [], memberNames = data.memberNames || {};
      const examLabel = (typeof EXAM_CONFIGS !== 'undefined' && EXAM_CONFIGS[data.exam]) ? EXAM_CONFIGS[data.exam].label : (data.exam || '');
      const quizXP = quiz.xp || {}, answers = quiz.answers || {}, scores = quiz.scores || {}, totalQ = (quiz.questions || []).length;
      const currentQ = (quiz.current || 0) + 1;
      const isFinished = quiz.status === 'finished';

      // Build per-student stats — prefer quiz.scores (most accurate), fallback to answers
      const students = {};
      members.forEach(m => {
        if (m === data.adminUid) return;
        const xp = quizXP[m] || 0;
        let correct = 0, wrong = 0, total = 0;
        if (scores[m]) {
          correct = scores[m].correct || 0;
          wrong = scores[m].wrong || 0;
          total = scores[m].total || 0;
        } else {
          // Fallback: derive from answers
          Object.keys(answers).forEach(qIdx => {
            const a = answers[qIdx];
            if (!a || a.uid !== m) return;
            total++;
            if (a.correct) correct++; else wrong++;
          });
        }
        const acc = total > 0 ? Math.round((correct / total) * 100) : 0;
        students[m] = { name: memberNames[m] || 'Student', xp, correct, wrong, total, acc };
      });

      const sorted = Object.entries(students).sort((a, b) => b[1].xp - a[1].xp);
      const topXP = sorted[0]?.[1].xp || 0;
      const totalAns = sorted.reduce((s, r) => s + r[1].total, 0);
      const medals = ['🥇','🥈','🥉'];

      body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
          <div>
            <button class="cf-btn cf-btn-ghost" onclick="clearInterval(CF._liveState&&CF._liveState.poll);CF._openGroupDashboard('${groupId}')">← Back</button>
            <div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-top:4px;">${data.name}</div>
            <div style="font-size:11px;color:rgba(26,26,38,0.70);">📚 ${examLabel} · Q ${currentQ}/${totalQ} · ${isFinished?'<span style="color:#4ade80">✅ Finished</span>':'<span style="color:#f59e0b">⚔️ Battle Live</span>'}</div>
          </div>
          <span style="color:#ef4444;font-weight:700;font-size:12px;">${isFinished?'':'🔴 LIVE'}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:12px;">
          <div style="background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:9px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:800;color:#4ade80;">${sorted.length}</div><div style="font-size:9px;color:rgba(26,26,38,0.70);">Students</div></div>
          <div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.2);border-radius:9px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:800;color:#5b46d4;">${totalAns}</div><div style="font-size:9px;color:rgba(26,26,38,0.70);">Answered</div></div>
          <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:9px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:800;color:#f59e0b;">⚡${topXP}</div><div style="font-size:9px;color:rgba(26,26,38,0.70);">Top XP</div></div>
          <div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.2);border-radius:9px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:800;color:#2dd4bf;">${currentQ}/${totalQ}</div><div style="font-size:9px;color:rgba(26,26,38,0.70);">Progress</div></div>
        </div>
        <div style="font-size:12px;font-weight:800;color:var(--text-primary);margin-bottom:6px;">📊 Live Scoreboard</div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:380px;overflow-y:auto;">
          ${sorted.length === 0 ? '<div style="text-align:center;padding:20px;color:rgba(26,26,38,0.70);font-size:13px;">No students have answered yet…</div>' :
            sorted.map(([u, s], i) => {
              const pct = topXP > 0 ? Math.round((s.xp / topXP) * 100) : 0;
              return `<div style="background:${i===0?'rgba(245,158,11,0.07)':'rgba(255,255,255,0.02)'};border:1px solid ${i===0?'rgba(245,158,11,0.25)':'rgba(108,99,255,0.12)'};border-radius:9px;padding:9px 11px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
                  <span style="font-size:16px;min-width:20px">${medals[i]||('#'+(i+1))}</span>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:12px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.name}</div>
                    <div style="font-size:10px;color:rgba(26,26,38,0.70);">✅ ${s.correct} · ❌ ${s.wrong} · ${s.acc}% acc · ${s.total}/${totalQ} done</div>
                  </div>
                  <div style="text-align:right;flex-shrink:0">
                    <div style="font-size:15px;font-weight:900;color:#f59e0b">⚡${s.xp}</div>
                  </div>
                </div>
                <div style="height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;">
                  <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#6C63FF,#f59e0b);border-radius:2px;transition:width 0.4s ease;"></div>
                </div>
              </div>`;
            }).join('')}
        </div>
        ${!isFinished ? `<div style="margin-top:10px;text-align:center;">
          <button class="cf-btn cf-btn-danger" style="font-size:12px;padding:7px 16px;" onclick="CF._endBattle('${groupId}')">🛑 End Battle for All</button>
        </div>` : ''}`;
    } catch(e) {}
  };

  CF._endBattle = async function(groupId) {
    try {
      const db = window._firebaseDb;
      const { doc, updateDoc } = window._firebaseFns;
      if (!db || !updateDoc) return;
      const myUid = (typeof uid === 'function') ? uid() : 'guest';
      await updateDoc(doc(db, 'studyGroups', groupId), {
        'quiz.status': 'finished',
        'quiz.endedBy': myUid,
        'quiz.endedAt': Date.now()
      });
      toast('✅ Battle ended for all players', 2000);
      setTimeout(() => {
        if (CF._liveState && CF._liveState.poll) clearInterval(CF._liveState.poll);
      }, 500);
    } catch(e) {
      toast('❌ Could not end battle: ' + e.message, 2000);
    }
  };

  // Presence tracking - exits & idle
  if (typeof CF._openGroupChat === 'function') {
    CF._openGroupChat = (function(fn) {
      return async function(groupId) {
        const result = await fn.call(this, groupId);
        const myUid = (typeof uid === 'function') ? uid() : 'guest', db = window._firebaseDb, { doc, updateDoc } = window._firebaseFns || {};
        window.addEventListener('beforeunload', () => {
          if (db && updateDoc) updateDoc(doc(db, 'studyGroups', groupId), { ['quiz.participants.' + myUid + '.exitedAt']: Date.now() }).catch(() => {});
        });
        document.addEventListener('visibilitychange', () => {
          if (db && updateDoc) {
            const status = !document.hidden;
            updateDoc(doc(db, 'studyGroups', groupId), { ['quiz.participants.' + myUid + '.isActive']: status }).catch(() => {});
          }
        });
        if (db && updateDoc) {
          setInterval(() => {
            if (CF._currentGroupId) updateDoc(doc(db, 'studyGroups', CF._currentGroupId), { ['quiz.participants.' + myUid + '.lastHeartbeat']: Date.now() }).catch(() => {});
          }, 3000);
        }
        return result;
      };
    })(CF._openGroupChat);
  }

  // Auto-show live dashboard after countdown
  CF._handleGroupCountdown = (function(fn) {
    return function(data, groupId) {
      const result = fn.call(this, data, groupId);
      const myUid = (typeof uid === 'function') ? uid() : 'guest';
      if (data.adminUid === myUid) {
        setTimeout(() => {
          if (document.getElementById('cf-groups-modal')) CF.openLiveAnalytics(groupId);
        }, 4000);
      }
      return result;
    };
  })(CF._handleGroupCountdown);

  /* ─────────────────────────────────────────────────────────────
   * FIREBASE BILLING OPTIMIZATION & BATTLE ACCESS CONTROL
   * ───────────────────────────────────────────────────────────── */

  // Polling optimization for Firebase cost reduction
  CF._pollState = {
    battleList: null,
    activeBattle: null,
    leaderboard: null,
    lastLeaderboardUpdate: 0
  };

  // Reduced battle list polling: 10-15 seconds instead of 800ms
  function startBattleListPolling() {
    if (CF._pollState.battleList) clearInterval(CF._pollState.battleList);
    CF._pollState.battleList = setInterval(() => {
      if (typeof CF._loadPublicBattles === 'function') CF._loadPublicBattles();
    }, 12000);
  }

  // Active battle polling: 2-3 seconds (keep responsive for real-time)
  function startActiveBattlePolling(groupId) {
    if (CF._pollState.activeBattle) clearInterval(CF._pollState.activeBattle);
    const db = window._firebaseDb, { doc, getDoc } = window._firebaseFns || {};
    if (db && getDoc) {
      CF._pollState.activeBattle = setInterval(async () => {
        if (!CF._currentGroupId) return;
        try {
          const snap = await getDoc(doc(db, 'studyGroups', CF._currentGroupId));
          if (snap.exists()) {
            const data = snap.data();
            if (data.quiz?.status === 'active') {
              if (typeof CF._renderQuizQuestion === 'function') CF._renderQuizQuestion(data.quiz, CF._currentGroupId, data.memberNames);
            }
          }
        } catch(e) {}
      }, 2500);
    }
  }

  // Leaderboard polling: 5 minutes instead of every request
  function updateLeaderboardWithCache() {
    const now = Date.now();
    if (now - CF._pollState.lastLeaderboardUpdate < 300000) return;
    CF._pollState.lastLeaderboardUpdate = now;
    if (typeof CF._renderLeaderboard === 'function') CF._renderLeaderboard();
  }

  // Battle access limit check: 3 free per day, unlimited for premium
  CF._checkBattleAccess = async function(groupId) {
    const myUid = (typeof uid === 'function') ? uid() : 'guest';
    const isPremium = localStorage.getItem('sscai_u:' + myUid + ':premium') === 'true';
    
    if (isPremium) return { allowed: true, reason: 'Premium user' };
    
    const db = window._firebaseDb, { doc, getDoc } = window._firebaseFns || {};
    if (!db || !getDoc) return { allowed: false, reason: 'Database error' };
    
    try {
      const today = new Date().toISOString().split('T')[0];
      const snap = await getDoc(doc(db, 'users', myUid));
      const data = snap.exists() ? snap.data() : {};
      const battlesData = data.battlesDaily?.[today] || {};
      const battlesJoined = Object.keys(battlesData).length || 0;
      
      if (battlesJoined >= 3) {
        return { allowed: false, reason: 'Daily limit reached. 3 free battles/day. Upgrade to Premium for unlimited.', limit: 3, used: battlesJoined };
      }
      
      return { allowed: true, used: battlesJoined, limit: 3 };
    } catch(e) {
      return { allowed: false, reason: 'Could not verify access' };
    }
  };

  // FIXED: Simplified _openGroupChat - removed problematic access check
  // Access control happens elsewhere; here we just ensure function is called
  // (Original patch was crashing when checkBattleAccess was unavailable)

  // Leaderboard 5-minute cache
  CF._leaderboardCache = {
    data: null,
    lastUpdate: 0,
    cacheTime: 300000  // 5 minutes
  };

  const _origRenderLeaderboard = CF._renderLeaderboard;
  CF._renderLeaderboard = function() {
    const now = Date.now();
    if (CF._leaderboardCache.data && (now - CF._leaderboardCache.lastUpdate) < CF._leaderboardCache.cacheTime) {
      return CF._leaderboardCache.data;
    }
    CF._leaderboardCache.lastUpdate = now;
    return _origRenderLeaderboard.call(this);
  };

  // Track battle access (3 per day for free users)
  CF._trackBattleJoin = function(groupId) {
    const myUid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : 'guest';
    const isPremium = localStorage.getItem('sscai_u:' + myUid + ':premium') === 'true';
    
    if (!isPremium) {
      const today = new Date().toISOString().split('T')[0];
      const key = 'sscai_battles_' + today + '_' + myUid;
      const count = parseInt(localStorage.getItem(key) || '0');
      localStorage.setItem(key, (count + 1).toString());
    }
  };

  // Show remaining free mock tests
  CF._showMockTestRemaining = function() {
    const uid = (typeof window.uid === 'function') ? window.uid() : 'guest';
    const today = new Date().toISOString().split('T')[0];
    const mockKey = 'sscai_mock_' + today + '_' + uid;
    const mockCount = parseInt(localStorage.getItem(mockKey) || '0');
    const remaining = Math.max(0, 3 - mockCount);
    
    if (remaining > 0) {
      if (typeof toast === 'function') toast(`🎯 ${remaining}/3 free mock tests remaining today`, 2000);
    }
  };

  /* ─────────────────────────────────────────────────────────────
   * SECTION 15 — INIT
   * ───────────────────────────────────────────────────────────── */
  function init() {
    injectStyles();
    injectDOM();
    patchSendMessageForFeatures();
    DailyGoal.updateBadge();
    window.Referral = Referral;
    window.MockTest = MockTest;
    setInterval(() => DailyGoal.updateBadge(), 10000);
    console.info('[CrackAI Features] v2.0 loaded — AI questions, fullscreen groups, sidebar features, invite button');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 600));
  } else {
    setTimeout(init, 600);
  }

  window._CrackAI = { MockTest, WeakTopics, Analytics, DailyGoal, ScorePredictor, Referral, XP, EXAM_CONFIGS };

  /* Safe wrapper for CF._openGroupChat that handles delayed initialization */
  window._safeOpenGroupChat = async function(groupId) {
    try {
      console.log('[SafeOpenGroupChat] Starting with groupId:', groupId);
      
      // Ensure CF is ready
      let retries = 0;
      while ((typeof CF === 'undefined' || typeof CF._openGroupChat !== 'function') && retries < 10) {
        console.log('[SafeOpenGroupChat] Waiting for CF... retry', retries);
        await new Promise(r => setTimeout(r, 100));
        retries++;
      }
      
      console.log('[SafeOpenGroupChat] CF ready after', retries, 'retries. CF type:', typeof CF);
      
      if (typeof CF === 'undefined') {
        console.error('[SafeOpenGroupChat] CF not defined');
        toast('❌ Application not ready');
        return;
      }
      
      // Make sure modal is open
      console.log('[SafeOpenGroupChat] Opening modal...');
      if (typeof CF.openModal === 'function') {
        CF.openModal('cf-groups-modal');
        console.log('[SafeOpenGroupChat] Modal opened');
      } else {
        console.warn('[SafeOpenGroupChat] CF.openModal not available');
      }
      
      // Call the actual function
      console.log('[SafeOpenGroupChat] Calling CF._openGroupChat...');
      if (typeof CF._openGroupChat === 'function') {
        await CF._openGroupChat(groupId);
        console.log('[SafeOpenGroupChat] Success!');
      } else {
        console.error('[SafeOpenGroupChat] CF._openGroupChat is not a function. Type:', typeof CF._openGroupChat);
        toast('❌ Group chat not available');
      }
    } catch(err) {
      console.error('[SafeOpenGroupChat] Exception:', err);
      toast('❌ Error: ' + (err.message || 'Could not open group'));
    }
  };

})(window);