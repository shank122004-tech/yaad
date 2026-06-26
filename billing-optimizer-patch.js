/**
 * billing-optimizer-patch.js — CrackAI Cost Shield v2.0
 *
 * CACHE LAYERS (questions — mock test & battle pool)
 * ┌─────────────────────┬──────────┬─────────────────────────────┐
 * │ Layer               │ Speed    │ Cost                        │
 * ├─────────────────────┼──────────┼─────────────────────────────┤
 * │ 1. Memory           │ instant  │ 0 reads, 0 AI calls         │
 * │ 2. localStorage     │ ~0ms     │ 0 reads, 0 AI calls         │
 * │ 3. Firestore        │ ~50ms    │ 1 read (only on new device) │
 * │ 4. DeepSeek         │ ~3s      │ 1 call (once per day total) │
 * └─────────────────────┴──────────┴─────────────────────────────┘
 *
 * Repeat visit same device  → Memory or localStorage → 0 Firestore reads
 * New device same day       → Firestore cache hit    → 0 DeepSeek calls
 * First user of the day     → DeepSeek → saved everywhere
 *
 * BATTLE ARENA POLLING
 *   Exponential back-off: 8s → 12s → 20s → 30s (list)
 *                          3s →  5s →  8s → 15s → 30s (active game)
 *   Tab hidden → polling fully paused (visibilitychange)
 *   User answers → back-off resets to fast
 *
 * DEPLOY: add after battle-arena-patch.js in index.html
 *   <script src="billing-optimizer-patch.js" defer></script>
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
   * SECTION 1 — 4-LAYER QUESTION CACHE
   * ══════════════════════════════════════════════════════════ */

  const CACHE_COLLECTION = 'crackai_cache';
  const CACHE_TTL_MS     = 24 * 60 * 60 * 1000; // 1 day
  const LS_PREFIX        = 'sscai_qcache:';      // localStorage key prefix

  // Layer 1 — in-memory (lives for the current page session only)
  const _mem = {};

  // ── helpers ──────────────────────────────────────────────

  function todayStr() {
    return new Date().toISOString().slice(0, 10); // "2025-06-04"
  }

  function cacheKey(exam) {
    return exam + '_' + todayStr();
  }

  function isValidQArray(arr, minLen) {
    return Array.isArray(arr) && arr.length >= (minLen || 10);
  }

  // ── Layer 2: localStorage read/write ─────────────────────

  function lsGet(exam) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + cacheKey(exam));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Validate: must be array, must still be today's date
      if (
        parsed &&
        isValidQArray(parsed.questions) &&
        parsed.date === todayStr()
      ) {
        return parsed.questions;
      }
      // Stale — remove it
      localStorage.removeItem(LS_PREFIX + cacheKey(exam));
      return null;
    } catch (e) {
      return null;
    }
  }

  function lsSet(exam, questions) {
    try {
      localStorage.setItem(
        LS_PREFIX + cacheKey(exam),
        JSON.stringify({ questions, date: todayStr(), savedAt: Date.now() })
      );
      // Also prune yesterday's keys to keep localStorage clean
      _pruneOldLsKeys();
    } catch (e) {
      // localStorage full — not fatal
    }
  }

  function _pruneOldLsKeys() {
    try {
      const today = todayStr();
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX) && !k.includes(today)) {
          toRemove.push(k);
        }
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }

  // ── Layer 3: Firestore read/write ─────────────────────────

  async function fsGet(exam) {
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      if (!db || !fns) return null;
      const { doc, getDoc } = fns;
      const snap = await getDoc(doc(db, CACHE_COLLECTION, cacheKey(exam)));
      if (!snap.exists()) return null;
      const data = snap.data();
      if (
        isValidQArray(data.questions) &&
        data.createdAt &&
        (Date.now() - data.createdAt) < CACHE_TTL_MS
      ) {
        return data.questions;
      }
      return null;
    } catch (e) {
      return null; // Firestore error — fall through to DeepSeek
    }
  }

  async function fsSet(exam, questions) {
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      if (!db || !fns) return;
      const { doc, setDoc, getDoc } = fns;
      const ref = doc(db, CACHE_COLLECTION, cacheKey(exam));
      // Race guard: if another client already wrote today, use theirs
      const existing = await getDoc(ref);
      if (existing.exists() && isValidQArray(existing.data().questions)) {
        // Update our localStorage to match what's already in Firestore
        lsSet(exam, existing.data().questions);
        _mem[cacheKey(exam)] = existing.data().questions;
        return;
      }
      await setDoc(ref, {
        exam, questions,
        createdAt: Date.now(),
        count: questions.length,
        date: todayStr()
      });
      console.info('[CostShield] Firestore cache written:', questions.length, 'questions for', exam);
    } catch (e) {
      console.warn('[CostShield] Firestore write failed (non-fatal):', e.message);
    }
  }

  // ── Main cache read: Memory → localStorage → Firestore → null ──

  async function cacheGet(exam) {
    const key = cacheKey(exam);

    // Layer 1: memory
    if (isValidQArray(_mem[key])) {
      console.info('[CostShield] Cache HIT (memory) for', exam);
      return _mem[key];
    }

    // Layer 2: localStorage — 0 Firestore reads for repeat visits
    const ls = lsGet(exam);
    if (ls) {
      _mem[key] = ls; // promote to memory
      console.info('[CostShield] Cache HIT (localStorage) for', exam, '— 0 Firestore reads');
      return ls;
    }

    // Layer 3: Firestore — new device, same day
    const fs = await fsGet(exam);
    if (fs) {
      _mem[key] = fs;      // promote to memory
      lsSet(exam, fs);     // promote to localStorage (next visit = free)
      console.info('[CostShield] Cache HIT (Firestore) for', exam, '— 0 DeepSeek calls');
      return fs;
    }

    // Layer 4: caller must generate via DeepSeek
    console.info('[CostShield] Cache MISS for', exam, '— DeepSeek will be called');
    return null;
  }

  // ── Main cache write: Memory + localStorage + Firestore ──

  async function cacheSet(exam, questions) {
    if (!isValidQArray(questions, 5)) return;
    const key = cacheKey(exam);
    _mem[key] = questions;     // Layer 1
    lsSet(exam, questions);    // Layer 2
    fsSet(exam, questions);    // Layer 3 — async, don't await
  }

  /* ══════════════════════════════════════════════════════════
   * SECTION 2 — PATCH MockTest.loadQuestions
   * ══════════════════════════════════════════════════════════ */

  function patchMockTestLoader() {
    function tryPatch() {
      const MockTest = window.CF && window.CF._features && window.CF._features.MockTest;
      if (!MockTest || MockTest._costShieldPatched) return !!MockTest;

      const _orig = MockTest.loadQuestions.bind(MockTest);

      MockTest.loadQuestions = async function (exam, count) {
        // Try all 3 fast layers first
        const cached = await cacheGet(exam);
        if (cached && cached.length >= Math.min(count, 20)) {
          return cached.slice(0, count);
        }
        // Cache miss — call DeepSeek via original function
        const questions = await _orig(exam, count);
        // Write to all layers so everyone benefits
        if (questions && questions.length > 0) {
          cacheSet(exam, questions); // non-blocking
        }
        return questions;
      };

      MockTest._costShieldPatched = true;
      console.info('[CostShield] MockTest patched — 4-layer cache active');
      return true;
    }

    if (!tryPatch()) {
      let n = 0;
      const t = setInterval(() => { if (tryPatch() || ++n > 40) clearInterval(t); }, 500);
    }
  }

  /* ══════════════════════════════════════════════════════════
   * SECTION 3 — BATTLE QUESTION POOL
   * localStorage pool → Firestore pool → DeepSeek
   * ══════════════════════════════════════════════════════════ */

  const BATTLE_Q_POOL    = 'battle_q_pool';
  const BATTLE_POOL_SIZE = 150;
  const BATTLE_Q_PER_GAME = 10;
  const LS_BATTLE_PREFIX  = 'sscai_bpool:';

  // localStorage battle pool (device-level, no TTL — questions don't expire)
  function lsGetBattlePool(exam) {
    try {
      const raw = localStorage.getItem(LS_BATTLE_PREFIX + exam);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return isValidQArray(parsed, BATTLE_Q_PER_GAME) ? parsed : null;
    } catch (e) { return null; }
  }

  function lsSetBattlePool(exam, questions) {
    try {
      localStorage.setItem(LS_BATTLE_PREFIX + exam, JSON.stringify(questions));
    } catch (e) {}
  }

  function pickRandom(pool, n) {
    return pool.slice().sort(() => Math.random() - 0.5).slice(0, n);
  }

  async function getBattleQs(exam) {
    // 1. localStorage pool
    const lsPool = lsGetBattlePool(exam);
    if (lsPool && lsPool.length >= BATTLE_Q_PER_GAME) {
      console.info('[CostShield] Battle questions from localStorage pool');
      return pickRandom(lsPool, BATTLE_Q_PER_GAME);
    }
    // 2. Firestore pool
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      if (!db || !fns) return null;
      const { doc, getDoc } = fns;
      const snap = await getDoc(doc(db, BATTLE_Q_POOL, exam));
      if (snap.exists()) {
        const pool = snap.data().questions || [];
        if (pool.length >= BATTLE_Q_PER_GAME) {
          lsSetBattlePool(exam, pool); // cache to localStorage
          console.info('[CostShield] Battle questions from Firestore pool');
          return pickRandom(pool, BATTLE_Q_PER_GAME);
        }
      }
    } catch (e) {}
    return null; // pool miss — caller must call DeepSeek
  }

  async function saveToBattlePool(exam, newQs) {
    if (!isValidQArray(newQs, 1)) return;
    // Merge into localStorage pool
    const existing = lsGetBattlePool(exam) || [];
    const seen = new Set(existing.map(q => q.q.slice(0, 60)));
    const fresh = newQs.filter(q => !seen.has(q.q.slice(0, 60)));
    const merged = [...existing, ...fresh].slice(-BATTLE_POOL_SIZE);
    lsSetBattlePool(exam, merged);
    // Also write to Firestore pool
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      if (!db || !fns) return;
      const { doc, getDoc, setDoc } = fns;
      const ref  = doc(db, BATTLE_Q_POOL, exam);
      const snap = await getDoc(ref);
      let fsPool = snap.exists() ? (snap.data().questions || []) : [];
      const fsSeen = new Set(fsPool.map(q => q.q.slice(0, 60)));
      const fsFresh = newQs.filter(q => !fsSeen.has(q.q.slice(0, 60)));
      fsPool = [...fsPool, ...fsFresh].slice(-BATTLE_POOL_SIZE);
      await setDoc(ref, { questions: fsPool, updatedAt: Date.now(), exam });
      console.info('[CostShield] Battle pool updated:', fsPool.length, 'questions for', exam);
    } catch (e) {
      console.warn('[CostShield] Battle pool Firestore write failed:', e.message);
    }
  }

  function patchBattleQuestionGenerator() {
    function tryPatch() {
      const BA = window.BA;
      if (!BA || !BA._generateAndStart || BA._costShieldPatched) return !!BA;

      const _orig = BA._generateAndStart.bind(BA);

      BA._generateAndStart = async function (battleId, examHint) {
        const db  = window._firebaseDb;
        const fns = window._firebaseFns;
        if (!db || !fns) return _orig(battleId, examHint);
        const { doc, getDoc, updateDoc } = fns;
        try {
          const snap   = await getDoc(doc(db, 'publicBattles', battleId));
          if (!snap.exists()) return;
          const battle = snap.data();

          // Already has questions in the battle doc — just start
          if (isValidQArray(battle.questions, 5)) {
            console.info('[CostShield] Battle already has questions — skipping DeepSeek');
            if (!['countdown','active','finished'].includes(battle.status)) {
              await updateDoc(doc(db, 'publicBattles', battleId), {
                status: 'countdown', countdownAt: Date.now()
              });
            }
            BA._handleCountdown({ ...battle, countdownAt: Date.now() }, battleId);
            return;
          }

          // Try pool (localStorage → Firestore)
          const exam   = examHint || battle.exam || 'cgl';
          const poolQs = await getBattleQs(exam);
          if (poolQs) {
            console.info('[CostShield] Battle questions from pool — DeepSeek NOT called');
            await updateDoc(doc(db, 'publicBattles', battleId), {
              questions: poolQs, status: 'countdown', countdownAt: Date.now()
            });
            BA._handleCountdown({
              ...battle, questions: poolQs, countdownAt: Date.now()
            }, battleId);
            return;
          }

          // Pool miss — call DeepSeek, then save result to pool
          console.info('[CostShield] Battle pool miss for', exam, '— calling DeepSeek');
          await _orig(battleId, examHint);

          // After generation completes, harvest questions into pool
          setTimeout(async () => {
            try {
              const s2 = await getDoc(doc(db, 'publicBattles', battleId));
              if (s2.exists()) {
                const qs = s2.data().questions;
                if (qs && qs.length > 0) saveToBattlePool(exam, qs);
              }
            } catch (_) {}
          }, 3000);

        } catch (e) {
          return _orig(battleId, examHint);
        }
      };

      BA._costShieldPatched = true;
      console.info('[CostShield] Battle question generator patched — pool cache active');
      return true;
    }

    if (!tryPatch()) {
      let n = 0;
      const t = setInterval(() => { if (tryPatch() || ++n > 60) clearInterval(t); }, 500);
    }
  }

  /* ══════════════════════════════════════════════════════════
   * SECTION 4 — SMART BATTLE ARENA POLLING
   * Exponential back-off + visibility pause + AFK slow-down
   * ══════════════════════════════════════════════════════════ */

  const POLL_STEPS_LIST = [8000, 12000, 20000, 30000];
  const POLL_STEPS_GAME = [3000, 5000, 8000, 15000, 30000];

  function patchBattlePolling() {
    function tryPatch() {
      const BA = window.BA;
      if (!BA || BA._pollPatched) return !!BA;

      let _listStep = 0, _listTimer = null, _listPaused = false;
      let _gameStep = 0, _gameTimer = null, _gamePaused = false;
      let _lastAnswer = Date.now();

      function scheduleListPoll() {
        clearTimeout(_listTimer);
        if (_listPaused || !BA._arenaOpen) return;
        const delay = POLL_STEPS_LIST[Math.min(_listStep, POLL_STEPS_LIST.length - 1)];
        _listTimer = setTimeout(async () => {
          if (_listPaused || !BA._arenaOpen || BA._activeBattleId) return;
          try {
            await BA._refreshBattleList();
            _listStep = Math.min(_listStep + 1, POLL_STEPS_LIST.length - 1);
          } catch (_) {}
          scheduleListPoll();
        }, delay);
      }

      function scheduleGamePoll(battleId) {
        clearTimeout(_gameTimer);
        if (_gamePaused || !battleId) return;
        const idle      = Date.now() - _lastAnswer;
        const boost     = idle > 30000 ? 2 : 0;
        const step      = Math.min(_gameStep + boost, POLL_STEPS_GAME.length - 1);
        _gameTimer = setTimeout(async () => {
          if (_gamePaused || !BA._activeBattleId) return;
          try {
            await BA._pollGameBattle(battleId);
            _gameStep = Math.min(_gameStep + 1, POLL_STEPS_GAME.length - 1);
          } catch (_) {}
          scheduleGamePoll(battleId);
        }, POLL_STEPS_GAME[step]);
      }

      // Pause / resume on tab visibility
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          _listPaused = _gamePaused = true;
          clearTimeout(_listTimer);
          clearTimeout(_gameTimer);
        } else {
          _listPaused = _gamePaused = false;
          if (BA._arenaOpen && !BA._activeBattleId) { _listStep = 0; scheduleListPoll(); }
          if (BA._activeBattleId)                   { _gameStep = 0; scheduleGamePoll(BA._activeBattleId); }
        }
      });

      // Reset game poll speed when user answers (they're active)
      document.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('.ba-quiz-opt')) {
          _lastAnswer = Date.now();
          _gameStep   = 0;
        }
      });

      // Override _stopPolling
      const _origStop = BA._stopPolling.bind(BA);
      BA._stopPolling = function () {
        _origStop();
        clearTimeout(_listTimer); clearTimeout(_gameTimer);
        _listTimer = _gameTimer = null;
        _listStep  = _gameStep  = 0;
        BA._arenaOpen = false;
      };

      // Override _renderArena — kill old fixed interval, start back-off
      BA._renderArena = async function () {
        BA._arenaOpen = true;
        clearInterval(BA._pollListInterval);
        BA._pollListInterval = null;
        await BA._refreshBattleList();
        _listStep = 0;
        scheduleListPoll();
      };

      // Override joinBattle — start smart game poll instead of fixed interval
      if (BA.joinBattle) {
        const _origJoin = BA.joinBattle.bind(BA);
        BA.joinBattle = async function (battleId) {
          clearInterval(BA._pollGameInterval);
          BA._pollGameInterval = null;
          await _origJoin(battleId);
          if (BA._activeBattleId) { _gameStep = 0; scheduleGamePoll(BA._activeBattleId); }
        };
      }

      // Kill any already-running fixed intervals
      if (BA._pollListInterval) { clearInterval(BA._pollListInterval); BA._pollListInterval = null; }
      if (BA._pollGameInterval) { clearInterval(BA._pollGameInterval); BA._pollGameInterval = null; }

      BA._pollPatched = true;
      console.info('[CostShield] Battle polling patched — back-off + visibility pause active');
      return true;
    }

    if (!tryPatch()) {
      let n = 0;
      const t = setInterval(() => { if (tryPatch() || ++n > 60) clearInterval(t); }, 500);
    }
  }

  /* ══════════════════════════════════════════════════════════
   * SECTION 5 — INIT
   * ══════════════════════════════════════════════════════════ */

  function init() {
    patchMockTestLoader();
    patchBattleQuestionGenerator();
    patchBattlePolling();
    console.info('[CostShield] v2.0 — 4-layer cache + smart polling active');
  }

  if (window._firebaseDb && window._firebaseFns) {
    init();
  } else {
    let n = 0;
    const t = setInterval(() => {
      n++;
      if (window._firebaseDb && window._firebaseFns) { clearInterval(t); init(); }
      else if (n > 60) { clearInterval(t); init(); }
    }, 500);
  }

})();