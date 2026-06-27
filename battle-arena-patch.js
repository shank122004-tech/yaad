/**
 * battle-arena-patch.js — CrackwithAI Online Battle Arena v3.2.2 [FIXED]
 * ═══════════════════════════════════════════════════════════════════
 *  FEATURES:
 *  1. Public Online Battle Arena — battles visible to ALL users
 *  2. Battle Creator gate — only ₹99/month Battle plan (or promo code)
 *  3. Plan-based monthly battle limit per creator (5/19/29)
 *  4. Max 10 players per battle
 *  5. 3-2-1 countdown before quiz starts (visible to ALL users)
 *  6. Real-time polling (no onSnapshot = no Firebase billing spike)
 *  7. Winner announcement when battle ends
 *  8. Global Leaderboard — weekly XP, ranks, levels
 *  9. Weekly top XP user gets free 1-month premium (₹1299 value)
 * 10. Promo code CRACKBATTLE — unlocks battle creator for free
 * 11. User level system (Level 1–100 with titles)
 * 12. Dark/Light mode support in leaderboard
 * 13. ELO ranking system (Bronze → Legend)
 * 14. Instant Answer Race speed points
 * 15. Live emoji reactions during battle
 * 16. Battle highlights (Fastest / Accuracy King / Comeback)
 * 17. Coins economy — Arena wins only, top-3-of-10 prize model
 * 18. Cosmetics shop (avatars, name colours, profile frames)
 * 19. Quit battle → never shown again + slot freed in Firestore
 * 20. Group Study: auto-delete messages when ALL members have read them
 * 21. Player list shows when entering battle room
 * 22. Per-user question progression (no skipping between users)
 * 23. Admin analytics dashboard (who left, XP, correct/wrong answers, attempts)
 *
 *  FIREBASE COST NOTES:
 *  - Uses getDoc polling (1s active game, 4s list) NOT onSnapshot listeners
 *  - Battle documents are small (<5KB each)
 *  - Public battle list polls every 4s (only when arena is open)
 *  - XP writes batched: only on answer submit
 *  - Weekly leaderboard reads once per open, not continuous
 *
 *  IMPROVEMENTS v3.2.2 [FIXED - CRITICAL BUGS]:
 *  ✅ FIXED: Undefined 'battle' variable in _pregenerateQuestions — now fetches from Firestore
 *  ✅ FIXED: Missing 'await' on updateDoc in _handleCountdown — prevented race condition
 *  ✅ FIXED: Debounce timer too strict on initial render — now forces render on first check
 *  ✅ FIXED: Questions not displaying after countdown — all three issues resolved
 *  ✅ Countdown 3-2-1 lag — replaced nested setTimeout with requestAnimationFrame
 *  ✅ Battle starting after countdown — improved polling synchronization
 *  ✅ Race conditions between countdown and polling — prevented re-entry
 *  ✅ Optimized countdown animation for smooth 60fps rendering
 *  ✅ Ensured Firestore status update completes before polling resumes
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ─── CONSTANTS ───────────────────────────────────────────── */
  const DS_URL           = 'https://deepseek-56khnynjia-uc.a.run.app';
  const MAX_PLAYERS      = 10;
  const MAX_BATTLES_MONTH= 10;
  const BATTLE_PROMO     = 'MU1R43PNZ889VKSZ';   // promo code for free battle access
  const QUESTIONS_PER_BATTLE = 10; // default; overridden by battle.questionCount
  const POLL_BATTLE_LIST = 4000;            // ms — public battle list refresh
  const POLL_ACTIVE_GAME = 500;             // ms — OPTIMIZED: increased from 300ms to reduce Firebase cost + jank
  const POLL_WAITING_ROOM = 2000;           // ms — waiting room slower polling
  const QUESTION_TIME    = 15;             // seconds per question before auto-skip (minimum 15s)
  const LS_PROMO_KEY     = 'sscai_battle_promo_unlocked';
  const LS_XP_BATTLE_KEY = 'sscai_battle_weekly_xp';
  const WEEKLY_REWARD_PLAN = 'battle_weekly_reward';
  const REFERRAL_FREE_MONTH_THRESHOLD = 3; // 3 invites = 1 free month

  /* ─── REQUEST DEDUPLICATION ───────────────────────────────── */
  const pendingRequests = {};
  const requestCache = {};
  
  async function dedupGetDoc(docRef) {
    const key = docRef.path;
    if (pendingRequests[key]) return pendingRequests[key];
    
    pendingRequests[key] = window._firebaseFns.getDoc(docRef);
    try {
      const result = await pendingRequests[key];
      requestCache[key] = result;
      return result;
    } finally {
      delete pendingRequests[key];
    }
  }

  /* ─── BATTLE STATE MACHINE (NEW) ────────────────────────────── */
  const battleState = {
    currentBattleId: null,
    status: 'waiting',           // waiting, generating, countdown, active, finished
    hasStarted: false,           // CRITICAL: tracks if countdown has happened
    lastRenderTime: 0,
    renderDebounceMs: 100,
    lastQuestionIndex: -1,
    lastAnswerState: null,
    
    update(battleId, newStatus) {
      if (battleId === this.currentBattleId) {
        if (newStatus !== this.status) {
          this.status = newStatus;
          if (['countdown', 'active'].includes(newStatus)) {
            this.hasStarted = true;
          }
          if (newStatus === 'waiting') {
            this.hasStarted = false;
          }
        }
      }
    },
    
    shouldRender() {
      const now = Date.now();
      // FIXED: Also return true if lastRenderTime is 0 (first render after countdown)
      // This ensures questions display immediately on battle start
      if (this.lastRenderTime === 0 || now - this.lastRenderTime >= this.renderDebounceMs) {
        this.lastRenderTime = now;
        return true;
      }
      return false;
    }
  };

  /* ─── LEVEL SYSTEM ────────────────────────────────────────── */
  const LEVEL_TITLES = [
    { min: 0,   max: 9,   title: 'Beginner',    emoji: '🌱', color: '#4ade80' },
    { min: 10,  max: 24,  title: 'Aspirant',    emoji: '📘', color: '#38bdf8' },
    { min: 25,  max: 49,  title: 'Expert',      emoji: '⚡', color: '#a78bfa' },
    { min: 50,  max: 74,  title: 'SSC Master',  emoji: '🏆', color: '#f59e0b' },
    { min: 75,  max: 99,  title: 'Champion',    emoji: '👑', color: '#FF6B9D' },
    { min: 100, max: 999, title: 'Legend',      emoji: '🌟', color: '#fff' },
  ];

  function calculateLevel(xp) {
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
  }

  function getLevelTitle(level) {
    return LEVEL_TITLES.find(l => level >= l.min && level <= l.max) || LEVEL_TITLES[0];
  }

  /* ─── DEMO BATTLES — shown when no real battles exist ───────
   * Always visible to all users; real admin battles shown on top.
   * Demo battles use AI-generated questions cached in Firebase per exam.
   * Questions are generated ONCE per exam and reused for all users.
   * ─────────────────────────────────────────────────────────── */

  // Exam keys for demo battles — each maps to a Firebase cache doc
  const DEMO_BATTLE_DEFS = [
    { id:'demo_ssc_cgl_1',    name:'SSC CGL Mock Showdown',       exam:'cgl',     examLabel:'SSC CGL',        creatorName:'Arjun S.',   baseCount:3 },
    { id:'demo_chsl_1',       name:'CHSL Tier-1 Speed Round',     exam:'chsl',    examLabel:'SSC CHSL',       creatorName:'Neha K.',    baseCount:2 },
    { id:'demo_upsc_1',       name:'UPSC GS Paper-1 Challenge',   exam:'upsc',    examLabel:'UPSC',           creatorName:'Kavitha R.', baseCount:2 },
    { id:'demo_ibps_1',       name:'IBPS PO Banking Quiz',        exam:'ibps_po',    examLabel:'IBPS PO',        creatorName:'Naveen J.',  baseCount:3 },
    { id:'demo_rrb_ntpc_1',   name:'RRB NTPC General Awareness',  exam:'rrb_ntpc',     examLabel:'RRB NTPC',       creatorName:'Ravi M.',    baseCount:2 },
    { id:'demo_cpo_1',        name:'SSC CPO/SI Practice Arena',   exam:'cpo',     examLabel:'SSC CPO/SI',     creatorName:'Vijay K.',   baseCount:2 },
    { id:'demo_cgl_2',        name:'SSC CGL English & Reasoning', exam:'cgl',     examLabel:'SSC CGL',        creatorName:'Manish C.',  baseCount:2 },
    { id:'demo_cuet_1',       name:'CUET General Test Battle',    exam:'cuet',    examLabel:'CUET',           creatorName:'Shreya P.', baseCount:3 },
    { id:'demo_cds_1',        name:'CDS General Knowledge Rush',  exam:'cds',     examLabel:'CDS',            creatorName:'Arun T.',    baseCount:2 },
    { id:'demo_nda_1',        name:'NDA Mathematics Sprint',      exam:'nda',     examLabel:'NDA',            creatorName:'Suresh P.',  baseCount:2 },
  ];

  // Indian first names pool for fake players
  const FAKE_NAMES = [
    'Rahul','Priya','Amit','Neha','Vikram','Ravi','Sita','Mohan','Anjali','Arjun',
    'Deepa','Kiran','Suresh','Meena','Arun','Kavitha','Sanjay','Lakshmi','Gaurav',
    'Sneha','Tarun','Ritu','Dev','Nikhil','Shruti','Abhishek','Divya','Harsh',
    'Ritika','Sumit','Sonu','Mona','Preeti','Dinesh','Alok','Pooja','Rajesh','Geeta',
    'Ramesh','Priyanka','Vivek','Naveen','Manish','Sunita','Rohit','Anita','Pankaj',
    'Nisha','Vijay','Seema','Manoj','Reena','Sunil','Jyoti','Ajay','Kavita','Sachin'
  ];

  function _randomName(exclude) {
    const pool = FAKE_NAMES.filter(n => !exclude.includes(n));
    return pool[Math.floor(Math.random() * pool.length)] || 'Student';
  }

  // Build DEMO_BATTLES array dynamically (keeps structure compatible with rest of code)
  // Player count is randomized each page load — 2 to 6 players already joined
  const DEMO_BATTLES = DEMO_BATTLE_DEFS.map(def => {
    // Random count between 2 and 6 so cards always look different
    const randomCount = 2 + Math.floor(Math.random() * 5); // 2..6
    const names = [];
    for (let i = 0; i < randomCount; i++) names.push(_randomName(names));
    const players = names.map((_, i) => 'bot' + i);
    const playerNames = {};
    players.forEach((p, i) => { playerNames[p] = names[i]; });
    return {
      id: def.id, name: def.name, exam: def.examLabel, examKey: def.exam,
      creatorName: def.creatorName, players, playerNames,
      _isDemo: true, _examKey: def.exam, status: 'waiting', createdAt: Date.now()
    };
  });

  /* ── Demo question loader ─────────────────────────────────────
   * Loads the full question pool from Firebase Storage (via battle
   * pool cache), then uses _battleSeenTracker to pick 10 unseen
   * questions each time, cycling when the entire pool is exhausted.
   * Falls back to Firebase Firestore cache if Storage has nothing,
   * and finally falls back to DeepSeek AI generation.
   * ──────────────────────────────────────────────────────────── */
  async function _getDemoQuestionsForExam(examKey) {
    // 1. Try to load full pool from Firebase Storage (uses battle pool cache)
    try {
      const pool = await _loadBattlePool(examKey);
      if (pool && pool.length >= 10) {
        const picked = _battleSeenTracker.pick(examKey, pool, 10);
        if (picked && picked.length >= 10) return picked;
      }
    } catch(_) {}

    // 2. Check Firebase Firestore cache (stores pre-cached questions)
    const cacheKey = 'demoQuestions_' + examKey;
    if (window._firebaseDb && window._firebaseFns) {
      try {
        const { doc, getDoc } = window._firebaseFns;
        const snap = await getDoc(doc(window._firebaseDb, 'demoQuestions', examKey));
        if (snap.exists()) {
          const data = snap.data();
          if (data.questions && data.questions.length >= 10) {
            const pool2 = data.questions.map((q, i) => ({
              q:    q.q    || q.question || '',
              opts: (q.opts || q.options || q.choices || []).slice(0, 4),
              ans:  q.ans  !== undefined ? q.ans : (q.answer !== undefined ? q.answer : 0),
              id:   q.id   || q.q || ('demo_' + examKey + '_' + i)
            })).filter(q => q.q && q.opts.length === 4);
            const picked2 = _battleSeenTracker.pick('demo_' + examKey, pool2, 10);
            if (picked2 && picked2.length >= 10) return picked2;
            const arr = pool2.slice();
            for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
            return arr.slice(0, 10);
          }
        }
      } catch(_) {}
    }

    // 3. Check localStorage fallback
    try {
      const local = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (local && local.questions && local.questions.length >= 10) {
        const arr = local.questions.slice();
        for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
        return arr.slice(0, 10);
      }
    } catch(_) {}

    // 4. Try Firebase Storage (same pool as real battles) — no AI
    const storageQuestions = await _generateBattleQuestions(examKey, 10, '');
    if (storageQuestions && storageQuestions.length >= 10) {
      return storageQuestions;
    }
    return storageQuestions || [];
  }

  /* ─── ADMIN ──────────────────────────────────────────────── */
  // Add your admin email(s) here — admin always bypasses all paywalls
  var ADMIN_EMAILS = ['shank122004@gmail.com'];

  function isAdmin() {
    try {
      var cu = window._firebaseAuth?.currentUser;
      if (cu && cu.email && ADMIN_EMAILS.indexOf(cu.email) !== -1) return true;
    } catch(e) {}
    return false;
  }

  /* ─── UTILITIES ──────────────────────────────────────────── */
  function uid()     { return window._firebaseAuth?.currentUser?.uid || 'guest'; }
  function _p()      { return 'sscai_u:' + uid() + ':'; }
  function lsGet(k)  { try { return JSON.parse(localStorage.getItem(_p()+k) || 'null'); } catch { return null; } }
  function lsSet(k,v){ try { localStorage.setItem(_p()+k, JSON.stringify(v)); } catch {} }
  function toast(m,d){ if (typeof showToast === 'function') showToast(m, d||2800); }

  function getMyName() {
    try {
      const cu = window._firebaseAuth?.currentUser;
      if (cu) {
        if (cu.displayName && cu.displayName.trim()) return cu.displayName.trim();
        // Fallback: use email prefix (e.g. "john.doe" from "john.doe@gmail.com")
        if (cu.email) {
          const prefix = cu.email.split('@')[0];
          // Capitalize first letter
          return prefix.charAt(0).toUpperCase() + prefix.slice(1);
        }
      }
    } catch(e) {}
    try { if (typeof state !== 'undefined' && state.user) return state.user.displayName || state.user.name || state.user.email?.split('@')[0] || 'Student'; } catch(e) {}
    return 'Student';
  }

  function isPremium() {
    try {
      const u = window._firebaseAuth?.currentUser;
      if (u) {
        if (localStorage.getItem('sscai_u:'+u.uid+':premium') === 'true') return true;
      }
      if (localStorage.getItem('sscai_premium') === 'true') return true;
      return false;
    } catch(e) { return false; }
  }

  const BATTLE_PLANS = ['battle', 'battle_pro', 'battle_academy'];
  const BATTLE_PLAN_LIMITS = { battle: 5, battle_pro: 19, battle_academy: 29 };

  function hasBattlePlan() {
    // Get UID - try multiple methods
    let myUid = window._firebaseAuth?.currentUser?.uid || 
                window._firebaseAuth?.currentUser?.uid ||
                (typeof state !== 'undefined' && state.user?.uid) ||
                null;
    
    // Promo code check
    if (myUid) {
      const perUserPromoKey = 'sscai_u:' + myUid + ':' + LS_PROMO_KEY;
      if (localStorage.getItem(perUserPromoKey) === 'true') return true;
    }
    
    try {
      // Check per-user premium plan
      if (myUid) {
        const plan = localStorage.getItem('sscai_u:'+myUid+':premium_plan');
        if (BATTLE_PLANS.indexOf(plan) !== -1) return true;
      }
      
      // Check global premium plan
      const gPlan = localStorage.getItem('sscai_premium_plan');
      if (BATTLE_PLANS.indexOf(gPlan) !== -1) return true;
      
      // Check stored battle tier (fallback)
      const battleTier = localStorage.getItem('sscai_battle_tier');
      if (battleTier && BATTLE_PLANS.indexOf(battleTier) !== -1) return true;
      
      // Check if any battle plan exists
      for (let plan of BATTLE_PLANS) {
        if (localStorage.getItem('sscai:' + plan) === 'true') return true;
        if (localStorage.getItem(plan) === 'true') return true;
      }
    } catch(e) {}
    
    return false;
  }

  function getBattleTier() {
    try {
      const u = window._firebaseAuth?.currentUser;
      if (u) {
        const plan = localStorage.getItem('sscai_u:'+u.uid+':premium_plan');
        if (BATTLE_PLANS.indexOf(plan) !== -1) return plan;
      }
      const gPlan = localStorage.getItem('sscai_premium_plan');
      if (BATTLE_PLANS.indexOf(gPlan) !== -1) return gPlan;
    } catch(e) {}
    // Check stored tier separately (set by payment.js activatePlan)
    return localStorage.getItem('sscai_battle_tier') || 'battle';
  }

  function getMaxBattlesPerMonth() {
    if (isAdmin()) return 999999;
    const tier = getBattleTier();
    // Also check localStorage override set by payment.js
    const stored = parseInt(localStorage.getItem('sscai_battle_monthly_max') || '0', 10);
    return stored || BATTLE_PLAN_LIMITS[tier] || 5;
  }

  function isBattleCreator() {
    if (isAdmin()) return true;
    return hasBattlePlan();
  }

  /* ═════════════════════════════════════════════════════════════
     STRICT REQUIREMENT CONTROLLERS (v4.0)
     ═════════════════════════════════════════════════════════════
     
     These controllers implement all 12 strict requirements:
     #1  Polling-only (no onSnapshot)
     #2  Single polling loop
     #3  Version tracking for stale responses
     #4  Single timer guarantee
     #5  Question rollback prevention
     #6  Optimistic answer updates
     #7  Duplicate answer prevention
     #8  Render deduplication
     #9  Debounce UI updates
     #10 Race condition prevention
     #11 Firebase write optimization
     #12 Professional UX
  */
  
  const StateManager = {
    // Battle state
    currentBattleId: null,
    currentQuestionIndex: 0,
    lastQuestionIndex: -1,
    answerLocked: false,
    
    // Version tracking (REQ #3: ignore stale responses)
    pollVersion: 0,
    syncVersion: 0,
    cachedBattleVersion: -1,
    lastUpdatedAt: 0,
    
    // Render state (REQ #8: render only when necessary)
    lastRenderedQuestionIndex: -1,
    lastRenderedQuestionId: null,
    lastRenderHash: null,
    lastRenderTime: 0,
    
    updateLocalQuestion(qIndex, qId) {
      // REQ #5: Prevent question rollback
      if (qIndex < this.currentQuestionIndex) {
        return false;
      }
      this.lastQuestionIndex = this.currentQuestionIndex;
      this.currentQuestionIndex = qIndex;
      this.lastUpdatedAt = Date.now();
      this.syncVersion++;
      return true;
    },
    
    lockAnswer() {
      // REQ #7: Prevent duplicate answers
      if (this.answerLocked) return false;
      this.answerLocked = true;
      return true;
    },
    
    unlockAnswer() {
      this.answerLocked = false;
    },
    
    shouldAcceptServerResponse(serverData) {
      // REQ #3: Only accept if newer than current
      if (!serverData) return false;
      const serverVer = serverData._version || 0;
      if (serverVer < this.cachedBattleVersion) {
        return false;
      }
      this.cachedBattleVersion = serverVer;
      return true;
    },
    
    shouldRender(qIndex, qId) {
      // REQ #8: Only render on actual change
      const now = Date.now();
      const hash = qIndex + '|' + qId;
      
      if (qIndex === this.lastRenderedQuestionIndex && 
          now - this.lastRenderTime < 100) {
        return false;
      }
      
      if (hash === this.lastRenderHash) {
        return false;
      }
      
      this.lastRenderedQuestionIndex = qIndex;
      this.lastRenderedQuestionId = qId;
      this.lastRenderHash = hash;
      this.lastRenderTime = now;
      return true;
    }
  };
  
  const PollingController = {
    // REQ #2: Single polling loop guarantee
    activeInterval: null,
    isPolling: false,
    lastPollTime: 0,
    
    start(battleId, pollFn, pollMs) {
      // Always clear existing
      this.stop();
      
      if (this.isPolling) return;
      this.isPolling = true;
      
      const wrapper = async () => {
        const now = Date.now();
        if (now - this.lastPollTime < 50) return; // Debounce
        this.lastPollTime = now;
        try {
          await pollFn(battleId);
        } catch(e) {
          console.error('[Poll]', e);
        }
      };
      
      this.activeInterval = setInterval(wrapper, pollMs || 800);
      wrapper(); // Immediate first poll
    },
    
    stop() {
      if (this.activeInterval) {
        clearInterval(this.activeInterval);
        this.activeInterval = null;
      }
      this.isPolling = false;
    },
    
    isActive() {
      return this.activeInterval !== null;
    }
  };
  
  const TimerController = {
    // REQ #4: Single timer guarantee
    activeTimer: null,
    currentQuestionIndex: -1,
    timerStartMs: 0,
    
    start(qIndex, onTimeUp) {
      // REQ #4: Clear existing timer
      this.stop();
      
      if (this.currentQuestionIndex === qIndex && this.activeTimer) {
        return;
      }
      
      this.currentQuestionIndex = qIndex;
      this.timerStartMs = Date.now();
      
      const tick = () => {
        const elapsed = Math.floor((Date.now() - this.timerStartMs) / 1000);
        const remaining = Math.max(0, QUESTION_TIME - elapsed);
        
        // Update UI
        const fill = document.getElementById('ba-qtimer-fill');
        const label = document.getElementById('ba-qtimer-label');
        if (fill) fill.style.width = ((remaining / QUESTION_TIME) * 100) + '%';
        if (label) {
          label.textContent = remaining + 's';
          label.style.color = remaining <= 5 ? '#ef4444' : remaining <= 10 ? '#f59e0b' : 'rgba(200,195,255,0.5)';
        }
        
        if (remaining <= 0) {
          this.stop();
          if (onTimeUp) onTimeUp();
          return;
        }
        
        this.activeTimer = requestAnimationFrame(tick);
      };
      
      tick();
    },
    
    stop() {
      if (this.activeTimer) {
        cancelAnimationFrame(this.activeTimer);
        this.activeTimer = null;
      }
      this.currentQuestionIndex = -1;
    }
  };

  /* ─── REFERRAL CODE SYSTEM ───────────────────────────────── */
  // Each Battle Creator gets a personal referral code.
  // When 3 invited users upgrade, creator gets 1 free month.
  function getMyReferralCode() {
    const myUid = window._firebaseAuth?.currentUser?.uid;
    if (!myUid) return null;
    // Deterministic code from uid: last 8 chars uppercase
    return ('REF' + myUid.slice(-6).toUpperCase());
  }

  function getReferralStats() {
    const myUid = window._firebaseAuth?.currentUser?.uid;
    if (!myUid) return { invited: 0, converted: 0, freeMonthsEarned: 0 };
    try {
      const key = 'sscai_u:' + myUid + ':referral_stats';
      return JSON.parse(localStorage.getItem(key) || '{"invited":0,"converted":0,"freeMonthsEarned":0}');
    } catch(e) { return { invited: 0, converted: 0, freeMonthsEarned: 0 }; }
  }

  function saveReferralStats(stats) {
    const myUid = window._firebaseAuth?.currentUser?.uid;
    if (!myUid) return;
    try {
      localStorage.setItem('sscai_u:' + myUid + ':referral_stats', JSON.stringify(stats));
    } catch(e) {}
  }

  // Called when a user signs up via referral — saved in their profile
  async function applyReferralOnUpgrade(referralCode) {
    if (!referralCode || !window._firebaseDb || !window._firebaseFns) return;
    try {
      const db = window._firebaseDb;
      const { collection, getDocs, query, where, doc, updateDoc } = window._firebaseFns;
      // Find who owns this referral code
      const q = query(collection(db, 'users'), where('referralCode', '==', referralCode));
      const snap = await getDocs(q);
      if (snap.empty) return;
      const referrerDoc = snap.docs[0];
      const referrerData = referrerDoc.data();
      const newConverted = (referrerData.referralConverted || 0) + 1;
      await updateDoc(referrerDoc.ref, { referralConverted: newConverted });
      // If threshold reached, grant free month to referrer
      if (newConverted > 0 && newConverted % REFERRAL_FREE_MONTH_THRESHOLD === 0) {
        await updateDoc(referrerDoc.ref, { referralFreeMonths: (referrerData.referralFreeMonths || 0) + 1 });
        // Store locally if this is the current user's own device
        const myUid = window._firebaseAuth?.currentUser?.uid;
        if (myUid && referrerDoc.id === myUid) {
          const stats = getReferralStats();
          stats.freeMonthsEarned = (stats.freeMonthsEarned || 0) + 1;
          saveReferralStats(stats);
          // Grant premium
          const p = 'sscai_u:' + myUid + ':';
          localStorage.setItem(p + 'premium', 'true');
          localStorage.setItem(p + 'premium_plan', 'referral_free_month');
          if (typeof showToast === 'function') showToast('🎁 You earned a FREE month of Battle Creator! Your referral paid off!', 6000);
        }
      }
    } catch(e) {}
  }

  // Save referral code to Firestore user doc on init
  async function _saveMyReferralCode() {
    const myUid = window._firebaseAuth?.currentUser?.uid;
    const code = getMyReferralCode();
    if (!myUid || !code || !window._firebaseDb || !window._firebaseFns) return;
    try {
      const { doc, setDoc } = window._firebaseFns;
      await setDoc(window._firebaseFns.doc(window._firebaseDb, 'users', myUid),
        { referralCode: code }, { merge: true });
    } catch(e) {}
  }

  // Expose globally so payment.js can call after upgrade
  window._applyReferralOnUpgrade = applyReferralOnUpgrade;
  window._getMyReferralCode = getMyReferralCode;

  /* ─── GROUP ADMIN CHECK ──────────────────────────────────── */
  function isGroupAdmin() {
    try {
      const u = window._firebaseAuth?.currentUser;
      const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
      if (localStorage.getItem(p + 'group_admin') === 'true') return true;
      if (localStorage.getItem('sscai_group_admin') === 'true') return true;
    } catch(e) {}
    return isAdmin();
  }

  function getGroupAdminPlan() {
    try {
      const u = window._firebaseAuth?.currentUser;
      const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
      return localStorage.getItem(p + 'group_plan') || localStorage.getItem('sscai_group_plan') || null;
    } catch(e) { return null; }
  }

  function getMaxGroups() {
    const plan = getGroupAdminPlan();
    if (plan === 'coaching_pro') return 999;
    if (plan === 'coaching_basic') return 3;
    if (plan === 'group_leader') return 1;
    if (isAdmin()) return 999;
    return 0;
  }

  function getBattleExtraCredits() {
    if (window._battleExtra) return window._battleExtra.getBattleExtraCredits();
    try {
      const data = JSON.parse(localStorage.getItem('sscai_battle_extra_credits') || '{"credits":0}');
      return data.credits || 0;
    } catch(e) { return 0; }
  }

  function useBattleExtraCredit() {
    if (window._battleExtra) return window._battleExtra.useBattleExtraCredit();
    try {
      const key = 'sscai_battle_extra_credits';
      const data = JSON.parse(localStorage.getItem(key) || '{"credits":0}');
      if ((data.credits || 0) <= 0) return false;
      data.credits = data.credits - 1;
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch(e) { return false; }
  }

  // Total battles available = tier limit + extra credits
  function canCreateBattle() {
    if (isAdmin()) return true;
    if (!isBattleCreator()) return false;
    const usage = getBattleCreatorUsage();
    const maxAllowed = getMaxBattlesPerMonth();
    if (usage < maxAllowed) return true;             // tier quota available
    return getBattleExtraCredits() > 0;              // extra credits banked
  }

  /* Battle XP for this week */
  function getWeekKey() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const week = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
    return now.getFullYear() + '_W' + week;
  }

  function getBattleXP() {
    const data = lsGet('battle_xp') || { xp: 0, week: '' };
    if (data.week !== getWeekKey()) return 0;
    return data.xp || 0;
  }

  function addBattleXP(n) {
    const data = lsGet('battle_xp') || { xp: 0, week: '' };
    const thisWeek = getWeekKey();
    const xp = data.week === thisWeek ? (data.xp || 0) + n : n;
    lsSet('battle_xp', { xp, week: thisWeek });
    // Also update global XP
    if (typeof XP !== 'undefined' && XP.add) XP.add(n);
    // ✅ FIX: Sync XP to Firebase immediately after earning
    const myUid = uid();
    if (myUid && typeof _syncXPToFirebase === 'function') {
      _syncXPToFirebase(myUid, n, 'Battle Arena 🏆');
    }
    return xp;
  }

  const _syncCoinsToFirebase = async (userUid, coinsToAdd, reason) => {
    if (!userUid || coinsToAdd <= 0) return false;
    try {
      const db = window._firebaseDb;
      const { doc, updateDoc, increment, setDoc, getDoc } = window._firebaseFns;
      
      // Update localStorage first (instant display update)
      const coinsKey = 'sscai_u:' + userUid + ':coins';
      const current = JSON.parse(localStorage.getItem(coinsKey) || '{"coins":0}');
      current.coins = (current.coins || 0) + coinsToAdd;
      current.lastUpdated = Date.now();
      localStorage.setItem(coinsKey, JSON.stringify(current));
      
      // Update display badge immediately
      const badge = document.querySelector('.ba-coins-badge, [data-coins-display], #drawerCoinsVal');
      if (badge) {
        badge.textContent = badge.id === 'drawerCoinsVal' ? ('🪙 ' + current.coins + ' coins') : ('🪙 ' + current.coins);
        if (badge.style) {
          badge.style.animation = 'none';
          setTimeout(() => { badge.style.animation = 'ba-coin-bounce 0.6s ease'; }, 10);
        }
      }
      
      // Also update Firestore in background (don't block on this)
      let firebaseSuccess = false;
      try {
        const docRef = doc(db, 'userCoins', userUid);
        const snap = await getDoc(docRef);
        
        if (snap.exists()) {
          await updateDoc(docRef, {
            coins: increment(coinsToAdd),
            lastUpdated: Date.now(),
            lastReason: reason || 'Battle'
          });
          firebaseSuccess = true;
        } else {
          await setDoc(docRef, {
            coins: coinsToAdd,
            lastUpdated: Date.now(),
            lastReason: reason || 'Battle',
            createdAt: Date.now()
          });
          firebaseSuccess = true;
        }
        
        // FIX 3: ALSO save coins to users/{uid} for profile display
        try {
          const usersRef = doc(db, 'users', userUid);
          const usersSnap = await getDoc(usersRef);
          const existingCoins = usersSnap.exists() ? (usersSnap.data().coins || 0) : 0;
          await updateDoc(usersRef, {
            coins: existingCoins + coinsToAdd,
            coinsLastUpdated: Date.now(),
            coinsLastSource: reason || 'Battle'
          }).catch(() => {
            // If doc doesn't exist, create it
            return setDoc(usersRef, {
              coins: coinsToAdd,
              coinsLastUpdated: Date.now(),
              coinsLastSource: reason || 'Battle'
            }, { merge: true });
          });
        } catch(userDocErr) {
          // userDoc save is best-effort, don't fail if it fails
        }
        
      } catch (fbErr) {
        firebaseSuccess = false;
      }
      
      // Refresh profile display if it's open
      if (typeof refreshProfileCoinsDisplay === 'function') {
        setTimeout(() => { refreshProfileCoinsDisplay(); }, 200);
      }
      
      return firebaseSuccess;
    } catch (e) {
      return false;
    }
  };

  /* ─── PROFESSIONAL XP SYNC TO FIREBASE ──────────────────────────
   * Ensures XP earned in battles and mock tests persists across sessions
   * and syncs to all devices. Similar pattern to _syncCoinsToFirebase.
   * ──────────────────────────────────────────────────────────────── */
  const _syncXPToFirebase = async (userUid, xpToAdd, reason) => {
    if (!userUid || xpToAdd === 0) return false;
    try {
      const db = window._firebaseDb;
      const { doc, updateDoc, increment, setDoc, getDoc } = window._firebaseFns;
      
      // Step 1: Get current XP from XP object (source of truth for session)
      const XPObj = window._CrackAI && window._CrackAI.XP;
      const currentSessionXP = XPObj ? XPObj.get() : 0;
      
      // Step 2: Update localStorage for immediate display
      const xpKey = 'xp';
      const oldVal = parseInt(localStorage.getItem(xpKey) || '0');
      const newVal = oldVal + xpToAdd;
      localStorage.setItem(xpKey, String(newVal));
      
      // Step 3: Update UI immediately with new XP
      try {
        const drawerXPVal = document.getElementById('drawerXPVal');
        const profileXPVal = document.getElementById('profileXPVal');
        if (drawerXPVal) drawerXPVal.textContent = newVal + ' XP';
        if (profileXPVal) profileXPVal.textContent = newVal;
        
        // Also update level display
        const levelCalc = (xp) => {
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
        };
        const newLevel = levelCalc(newVal);
        const drawerLvl = document.getElementById('drawerXPLevel');
        const profileLvl = document.getElementById('profileXPLevel');
        if (drawerLvl) drawerLvl.textContent = 'Lvl ' + newLevel;
        if (profileLvl) profileLvl.textContent = newLevel;
      } catch(e) {}
      
      // Step 4: Sync to Firestore in background (don't block on this)
      let firebaseSuccess = false;
      try {
        const userRef = doc(db, 'users', userUid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          // User doc exists — increment XP field
          await updateDoc(userRef, {
            xp: increment(xpToAdd),
            xpLastUpdated: Date.now(),
            xpLastReason: reason || 'XP earned'
          });
          firebaseSuccess = true;
        } else {
          // User doc doesn't exist — create it with initial XP
          await setDoc(userRef, {
            xp: newVal,
            xpLastUpdated: Date.now(),
            xpLastReason: reason || 'XP earned',
            uid: userUid
          }, { merge: true });
          firebaseSuccess = true;
        }
      } catch (fbErr) {
        // Firestore write failed — user will still see XP in localStorage
        // and it will sync on next successful write
      }
      
      // Step 5: Trigger profile UI refresh if modal is open
      if (typeof updateProfileUI === 'function') {
        const profileModal = document.getElementById('profileModal');
        if (profileModal && profileModal.classList.contains('active')) {
          setTimeout(() => { updateProfileUI(); }, 100);
        }
      }
      
      return firebaseSuccess;
    } catch (e) {
      // Silent fail — XP already saved in localStorage
      return false;
    }
  };

  const BattleTimer = {
    _activeTimers: {},
    
    start(battleId, durationSeconds = 300) {
      if (!battleId) return 0;
      this.end(battleId);
      
      const startTime = Date.now();
      const endTime = startTime + (durationSeconds * 1000);
      
      this._activeTimers[battleId] = {
        startTime,
        endTime,
        durationSeconds,
        intervalId: null
      };
      
      const timerState = this._activeTimers[battleId];
      let lastSecond = durationSeconds;
      
      const updateDisplay = () => {
        const now = Date.now();
        const remaining = Math.max(0, endTime - now);
        const seconds = Math.ceil(remaining / 1000);
        
        // Only update DOM if second changed (prevent lag)
        if (seconds !== lastSecond) {
          lastSecond = seconds;
          
          const timerEl = document.querySelector('[data-battle-timer]');
          if (timerEl) {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            timerEl.textContent = `⏱️ ${mins}:${secs.toString().padStart(2, '0')}`;
            
            // Use CSS classes instead of inline styles
            if (seconds <= 60 && seconds > 0) {
              timerEl.classList.add('ba-timer-warning');
            } else if (seconds === 0) {
              timerEl.classList.add('ba-timer-critical');
              timerEl.textContent = '⏱️ 0:00';
            }
          }
        }
        
        if (remaining <= 0) {
          if (timerState.rafId) cancelAnimationFrame(timerState.rafId);
          this.end(battleId);
          if (typeof BA !== 'undefined' && BA._endBattleByTimer) {
            BA._endBattleByTimer(battleId);
          }
        } else {
          timerState.rafId = requestAnimationFrame(updateDisplay);
        }
      };
      
      timerState.rafId = requestAnimationFrame(updateDisplay);
      
      return endTime;
    },
    
    end(battleId) {
      if (this._activeTimers[battleId]) {
        if (this._activeTimers[battleId].intervalId) {
          clearInterval(this._activeTimers[battleId].intervalId);
        }
        delete this._activeTimers[battleId];
      }
    },
    
    getRemainingSeconds(battleId) {
      if (!this._activeTimers[battleId]) return 0;
      const remaining = Math.max(0, this._activeTimers[battleId].endTime - Date.now());
      return Math.ceil(remaining / 1000);
    },
    
    isExpired(battleId) {
      return this.getRemainingSeconds(battleId) === 0;
    }
  };

  window.BattleTimer = BattleTimer;

  function getBattleCreatorUsage() {
    const data = lsGet('battle_creator_usage') || { count: 0, month: '' };
    const thisMonth = new Date().getFullYear() + '_' + new Date().getMonth();
    if (data.month !== thisMonth) return 0;
    return data.count || 0;
  }

  function incrementBattleUsage() {
    const thisMonth = new Date().getFullYear() + '_' + new Date().getMonth();
    const data = lsGet('battle_creator_usage') || { count: 0, month: '' };
    const count = data.month === thisMonth ? (data.count || 0) + 1 : 1;
    lsSet('battle_creator_usage', { count, month: thisMonth });
    return count;
  }

  /* ─── STYLES ─────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('ba-styles')) return;
    const s = document.createElement('style');
    s.id = 'ba-styles';
    s.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700;800;900&display=swap');
      

      /* ── Battle Arena Modal ── */
      #ba-modal, #lb-modal {
        position: fixed; inset: 0; z-index: 99990;
        background: rgba(0,0,0,0.92); backdrop-filter: blur(16px);
        display: none; align-items: flex-start; justify-content: center;
        overflow-y: auto; padding: 0;
      }
      #ba-modal.open, #lb-modal.open { display: flex; }
      .ba-box, .lb-box {
        background: linear-gradient(160deg,#0d0d18 0%,#11111f 60%,#0e0e1c 100%);
        border: 1px solid rgba(108,99,255,0.22);
        border-radius: 0; width: 100%; max-width: 520px;
        margin: 0 auto; min-height: 100dvh;
        display: flex; flex-direction: column;
        font-family: 'Space Grotesk', -apple-system, sans-serif;
        position: relative; overflow: hidden;
      }
      .ba-box::before {
        content: ''; position: absolute; top: -120px; right: -80px;
        width: 280px; height: 280px; border-radius: 50%;
        background: radial-gradient(circle,rgba(108,99,255,0.08) 0%,transparent 70%);
        pointer-events: none;
      }

      /* ── Header ── */
      .ba-hdr, .lb-hdr {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 18px 14px; border-bottom: 1px solid rgba(108,99,255,0.12);
        position: sticky; top: 0; z-index: 2;
        background: linear-gradient(180deg,rgba(13,13,24,0.98) 0%,rgba(13,13,24,0.92) 100%);
        backdrop-filter: blur(10px);
      }
      .ba-title, .lb-title {
        font-size: 18px; font-weight: 900; color: var(--text-primary); letter-spacing: -0.02em;
        display: flex; align-items: center; gap: 8px;
      }
      .ba-close, .lb-close {
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);
        color: rgba(200,195,255,0.5); width: 34px; height: 34px; border-radius: 10px;
        cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center;
        transition: all 0.15s;
      }
      .ba-close:hover, .lb-close:hover { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.3); color: #f87171; }
      .ba-body, .lb-body { padding: 16px 16px 32px; flex: 1; position: relative; z-index: 1; }

      /* ── Battle cards ── */
      .ba-battle-card {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(108,99,255,0.18);
        border-radius: 16px; padding: 16px; margin-bottom: 10px;
        transition: all 0.2s cubic-bezier(0.34,1.56,0.64,1);
        position: relative; overflow: hidden;
      }
      .ba-battle-card::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
        background: linear-gradient(90deg,transparent,rgba(108,99,255,0.3),transparent);
      }
      .ba-battle-card:hover {
        border-color: rgba(108,99,255,0.45);
        background: rgba(108,99,255,0.05);
        transform: translateY(-1px);
        box-shadow: 0 8px 24px rgba(108,99,255,0.12);
      }
      .ba-battle-card.full { border-color: rgba(239,68,68,0.25); opacity: 0.65; }
      .ba-card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
      .ba-card-name { font-size: 15px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.01em; line-height: 1.3; }
      .ba-card-exam { font-size: 11px; color: rgba(200,195,255,0.45); margin-top: 3px; font-weight: 600; }
      .ba-card-slots { font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 20px; white-space: nowrap; letter-spacing: 0.02em; }
      .ba-slots-open { background: rgba(74,222,128,0.12); color: #4ade80; border: 1px solid rgba(74,222,128,0.2); }
      .ba-slots-full { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }
      .ba-card-bottom { display: flex; align-items: center; justify-content: space-between; margin-top: 2px; }
      .ba-card-players { font-size: 11px; color: rgba(200,195,255,0.4); font-weight: 500; }
      .ba-join-btn {
        padding: 8px 18px; background: linear-gradient(135deg,#6C63FF,#FF6B9D);
        border: none; border-radius: 10px; color: var(--text-primary); font-size: 12px;
        font-weight: 800; cursor: pointer; letter-spacing: 0.03em;
        transition: all 0.2s; box-shadow: 0 3px 12px rgba(108,99,255,0.35);
        font-family: inherit;
      }
      .ba-join-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(108,99,255,0.45); opacity: 0.92; }
      .ba-join-btn:active { transform: translateY(0); }
      .ba-join-btn:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; transform: none; }

      /* ── Create battle form ── */
      .ba-create-btn {
        width: 100%; padding: 14px; margin-bottom: 16px;
        background: linear-gradient(135deg,#f59e0b,#ef4444);
        border: none; border-radius: 14px; color: var(--text-primary);
        font-size: 14px; font-weight: 900; cursor: pointer;
        box-shadow: 0 6px 24px rgba(245,158,11,0.3); letter-spacing: 0.03em;
        transition: all 0.2s; font-family: inherit;
      }
      .ba-create-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 28px rgba(245,158,11,0.4); }
      .ba-create-btn:disabled { opacity: 0.5; transform: none; }
      .ba-input {
        width: 100%; padding: 12px 16px; background: rgba(255,255,255,0.05);
        border: 1.5px solid rgba(108,99,255,0.2); border-radius: 12px;
        color: var(--text-primary); font-size: 13px; margin-bottom: 10px;
        font-family: inherit; box-sizing: border-box; transition: border-color 0.15s;
      }
      .ba-input:focus { outline: none; border-color: rgba(108,99,255,0.55); background: rgba(108,99,255,0.06); }
      .ba-input::placeholder { color: rgba(200,195,255,0.3); }
      .ba-select {
        width: 100%; padding: 12px 16px; background: rgba(10,10,20,0.8);
        border: 1.5px solid rgba(108,99,255,0.2); border-radius: 12px;
        color: var(--text-primary); font-size: 13px; margin-bottom: 10px; font-family: inherit;
        transition: border-color 0.15s; cursor: pointer;
      }
      .ba-select:focus { outline: none; border-color: rgba(108,99,255,0.55); }
      .ba-section-title {
        font-size: 10px; font-weight: 800; letter-spacing: 0.1em;
        color: rgba(200,195,255,0.35); text-transform: uppercase; margin-bottom: 12px; margin-top: 6px;
        display: flex; align-items: center; gap: 8px;
      }
      .ba-section-title::after {
        content: ''; flex: 1; height: 1px; background: rgba(108,99,255,0.12);
      }

      /* ── Active battle wrapper ── */
      .ba-active-wrap { padding: 0; }

      /* ── Countdown ── */
      .ba-countdown-overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: radial-gradient(ellipse at center,rgba(10,8,30,0.98) 0%,rgba(0,0,0,0.99) 100%);
        display: flex; align-items: center; justify-content: center; flex-direction: column;
      }
      .ba-countdown-num {
        font-size: 140px; font-weight: 900; line-height: 1;
        background: linear-gradient(135deg,#f59e0b,#FF6B9D,#a78bfa);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text; animation: ba-countpop 0.65s cubic-bezier(0.34,1.56,0.64,1);
        filter: drop-shadow(0 0 40px rgba(108,99,255,0.4));
      }
      @keyframes ba-countpop {
        0%{transform:scale(2.2);opacity:0} 50%{transform:scale(0.95);opacity:1} 100%{transform:scale(1)}
      }
      .ba-countdown-label {
        font-size: 16px; font-weight: 700; color: rgba(200,195,255,0.6);
        margin-top: 16px; letter-spacing: 0.08em; text-transform: uppercase;
      }
      .ba-countdown-sub {
        font-size: 12px; color: rgba(200,195,255,0.3); margin-top: 8px; letter-spacing: 0.05em;
      }

      /* ═══════════════════════════════════════════════
         QUIZ QUESTION UI — PROFESSIONAL REDESIGN
         ═══════════════════════════════════════════════ */

      /* Question number pill + progress */
      .ba-quiz-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 14px;
      }
      .ba-quiz-num-pill {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(108,99,255,0.15); border: 1px solid rgba(108,99,255,0.3);
        border-radius: 20px; padding: 5px 12px;
        font-size: 12px; font-weight: 800; color: #a78bfa; letter-spacing: 0.03em;
      }
      .ba-quiz-xp-pill {
        display: inline-flex; align-items: center; gap: 5px;
        background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.25);
        border-radius: 20px; padding: 5px 12px;
        font-size: 12px; font-weight: 800; color: #f59e0b;
      }

      /* Progress bar — thicker, more polished */
      .ba-quiz-bar {
        height: 5px; background: rgba(108,99,255,0.1); border-radius: 5px;
        margin-bottom: 20px; overflow: hidden; position: relative;
      }
      .ba-quiz-bar-fill {
        height: 100%; border-radius: 5px; transition: width 0.5s cubic-bezier(0.34,1.56,0.64,1);
        background: linear-gradient(90deg,#6C63FF,#a78bfa,#FF6B9D);
        box-shadow: 0 0 8px rgba(108,99,255,0.5);
        position: relative;
      }
      .ba-quiz-bar-fill::after {
        content: ''; position: absolute; right: 0; top: 50%; transform: translateY(-50%);
        width: 8px; height: 8px; border-radius: 50%;
        background: #fff; box-shadow: 0 0 6px rgba(255,255,255,0.8);
      }

      /* Question card */
      .ba-quiz-q-card {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(108,99,255,0.16);
        border-radius: 18px; padding: 18px 18px 16px;
        margin-bottom: 16px; position: relative; overflow: hidden;
      }
      .ba-quiz-q-card::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
        background: linear-gradient(90deg,#6C63FF,#FF6B9D);
      }
      .ba-quiz-q-label {
        font-size: 10px; font-weight: 800; letter-spacing: 0.1em;
        color: rgba(108,99,255,0.7); text-transform: uppercase; margin-bottom: 10px;
        display: flex; align-items: center; gap: 6px;
      }
      .ba-quiz-q-label::before { content: '❓'; font-size: 12px; }
      .ba-quiz-q {
        font-size: 16px; font-weight: 700; color: #f0f0ff; line-height: 1.6;
        margin: 0; letter-spacing: -0.01em;
      }

      /* Answer options */
      .ba-quiz-opts { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
      .ba-quiz-opt {
        width: 100%; padding: 14px 16px; box-sizing: border-box;
        background: rgba(255,255,255,0.04);
        border: 1.5px solid rgba(108,99,255,0.18); border-radius: 14px;
        color: rgba(230,228,255,0.85); font-size: 14px; font-weight: 600;
        cursor: pointer; text-align: left;
        transition: all 0.18s cubic-bezier(0.34,1.56,0.64,1);
        display: flex; align-items: center; gap: 12px;
        font-family: inherit; position: relative; overflow: hidden;
      }
      .ba-quiz-opt::before {
        content: ''; position: absolute; inset: 0;
        background: linear-gradient(135deg,rgba(108,99,255,0.08),transparent);
        opacity: 0; transition: opacity 0.15s;
      }
      .ba-quiz-opt:hover:not(:disabled) {
        border-color: rgba(108,99,255,0.55);
        background: rgba(108,99,255,0.08);
        transform: translateX(3px);
        box-shadow: 0 4px 16px rgba(108,99,255,0.15);
      }
      .ba-quiz-opt:hover:not(:disabled)::before { opacity: 1; }
      .ba-quiz-opt.correct {
        border-color: #4ade80; background: rgba(74,222,128,0.1); color: #4ade80;
        transform: none; box-shadow: 0 0 20px rgba(74,222,128,0.15);
        animation: ba-correct-pop 0.4s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes ba-correct-pop {
        0%{transform:scale(1)} 50%{transform:scale(1.02)} 100%{transform:scale(1)}
      }
      .ba-quiz-opt.wrong {
        border-color: #f87171; background: rgba(248,113,113,0.08); color: #f87171;
        box-shadow: 0 0 16px rgba(248,113,113,0.12);
      }
      .ba-quiz-opt.dim { opacity: 0.28; filter: grayscale(0.5); pointer-events: none; }
      .ba-quiz-opt:disabled { cursor: not-allowed; }
      .ba-opt-letter {
        min-width: 28px; height: 28px; flex-shrink: 0;
        background: rgba(108,99,255,0.18); border: 1px solid rgba(108,99,255,0.3);
        border-radius: 8px; display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 900; color: #a78bfa; letter-spacing: 0;
        transition: all 0.15s;
      }
      .ba-quiz-opt.correct .ba-opt-letter {
        background: rgba(74,222,128,0.2); border-color: rgba(74,222,128,0.4); color: #4ade80;
      }
      .ba-quiz-opt.wrong .ba-opt-letter {
        background: rgba(248,113,113,0.2); border-color: rgba(248,113,113,0.4); color: #f87171;
      }
      .ba-q-indicators {
        display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 12px; padding: 0 4px;
      }
      .ba-q-indicator {
        width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.08);
        border: 1px solid rgba(108,99,255,0.15); font-size: 10px; display: flex;
        align-items: center; justify-content: center; flex-shrink: 0;
        transition: all 0.2s cubic-bezier(0.34,1.56,0.64,1);
      }
      .ba-q-indicator.done {
        background: rgba(74,222,128,0.2); border-color: #4ade80; color: #4ade80;
        box-shadow: 0 0 8px rgba(74,222,128,0.2);
      }
      .ba-q-indicator.active {
        background: linear-gradient(135deg,#6C63FF,#FF6B9D); border-color: #6C63FF;
        transform: scale(1.1); box-shadow: 0 0 12px rgba(108,99,255,0.4);
      }
      .ba-q-indicator.answered {
        background: rgba(34,197,94,0.3); border-color: rgba(74,222,128,0.5);
      }
      .ba-q-fadeIn {
        animation: ba-q-fade 0.25s ease-out;
      }
      @keyframes ba-q-fade {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      

      /* Answer feedback banner */
      .ba-quiz-answered-banner {
        padding: 12px 16px; border-radius: 14px; margin-bottom: 12px;
        font-size: 14px; font-weight: 800; text-align: center;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        animation: ba-banner-in 0.35s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes ba-banner-in {
        from{transform:scale(0.9);opacity:0} to{transform:scale(1);opacity:1}
      }
      @keyframes ba-pop-in {
        from{transform:scale(0.85);opacity:0} to{transform:scale(1);opacity:1}
      }
      .ba-quiz-answered-banner.correct {
        background: rgba(74,222,128,0.12); color: #4ade80;
        border: 1px solid rgba(74,222,128,0.3);
        box-shadow: 0 4px 20px rgba(74,222,128,0.12);
      }
      .ba-quiz-answered-banner.wrong {
        background: rgba(248,113,113,0.1); color: #f87171;
        border: 1px solid rgba(248,113,113,0.25);
      }

      /* Explanation card */
      .ba-quiz-exp {
        font-size: 13px; color: rgba(200,195,255,0.75);
        padding: 12px 16px; border-left: 3px solid rgba(108,99,255,0.5);
        background: rgba(108,99,255,0.07); border-radius: 0 12px 12px 0;
        margin-bottom: 14px; line-height: 1.6;
        animation: ba-exp-in 0.3s ease;
      }
      @keyframes ba-exp-in { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
      .ba-quiz-exp strong { color: #a78bfa; }

      /* Waiting state */
      .ba-quiz-waiting {
        text-align: center; padding: 16px;
        background: rgba(108,99,255,0.06); border: 1px dashed rgba(108,99,255,0.25);
        border-radius: 12px; margin-bottom: 12px;
      }
      .ba-quiz-waiting-text { font-size: 13px; font-weight: 700; color: rgba(200,195,255,0.6); margin-bottom: 4px; }
      .ba-quiz-waiting-sub { font-size: 11px; color: rgba(200,195,255,0.35); }

      /* Timer bar */
      .ba-quiz-timer-wrap { margin-bottom: 14px; }
      .ba-quiz-timer-bar {
        height: 3px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden;
      }
      .ba-quiz-timer-fill {
        height: 100%; background: linear-gradient(90deg,#4ade80,#f59e0b,#ef4444);
        border-radius: 3px; transition: width 1s linear;
      }

      /* ── XP board — redesigned ── */
      .ba-xp-board {
        background: rgba(255,255,255,0.025);
        border: 1px solid rgba(108,99,255,0.14);
        border-radius: 16px; padding: 14px; margin-top: 14px;
        overflow: hidden;
      }
      .ba-xp-board-title {
        font-size: 10px; font-weight: 800; letter-spacing: 0.1em;
        color: rgba(200,195,255,0.35); text-transform: uppercase; margin-bottom: 10px;
        display: flex; align-items: center; gap: 6px;
      }
      .ba-xp-row {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 10px; border-radius: 10px; margin-bottom: 4px;
        transition: background 0.15s;
      }
      .ba-xp-row:last-child { margin-bottom: 0; }
      .ba-xp-row.me {
        background: rgba(108,99,255,0.12);
        border: 1px solid rgba(108,99,255,0.2);
      }
      .ba-xp-rank { font-size: 16px; min-width: 22px; text-align: center; }
      .ba-xp-name { flex: 1; font-size: 12px; color: rgba(200,195,255,0.8); font-weight: 700; }
      .ba-xp-val { font-size: 13px; font-weight: 900; color: #f59e0b; }
      .ba-xp-bar-wrap { width: 50px; }
      .ba-xp-mini-bar { height: 3px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
      .ba-xp-mini-fill { height: 100%; background: linear-gradient(90deg,#6C63FF,#f59e0b); border-radius: 3px; }

      /* ── Winner screen ── */
      .ba-winner-wrap { text-align: center; padding: 28px 0 20px; }
      .ba-winner-trophy {
        font-size: 80px; margin-bottom: 4px; display: block;
        filter: drop-shadow(0 8px 24px rgba(245,158,11,0.5));
        animation: ba-trophy-in 0.6s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes ba-trophy-in {
        from{transform:scale(0.3) rotate(-15deg);opacity:0}
        to{transform:scale(1) rotate(0);opacity:1}
      }
      .ba-winner-title {
        font-size: 26px; font-weight: 900; letter-spacing: -0.02em;
        background: linear-gradient(135deg,#f59e0b,#FF6B9D,#a78bfa);
        -webkit-background-clip:text; -webkit-text-fill-color:transparent;
        background-clip:text; margin-bottom: 8px;
      }
      .ba-winner-name { font-size: 15px; color: rgba(200,195,255,0.65); margin-bottom: 24px; font-weight: 600; }
      .ba-results-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
      .ba-result-stat {
        background: rgba(255,255,255,0.03); border: 1px solid rgba(108,99,255,0.15);
        border-radius: 14px; padding: 14px 10px; text-align: center;
        transition: border-color 0.15s;
      }
      .ba-result-stat:first-child { border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.05); }
      .ba-result-stat-val { font-size: 20px; font-weight: 900; color: #f59e0b; }
      .ba-result-stat-lbl { font-size: 10px; color: rgba(200,195,255,0.45); margin-top: 4px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
      .ba-result-stat-score { font-size: 14px; color: #a78bfa; font-weight: 700; margin-top: 6px; }
      .ba-result-stat-me { border-color: #6C63FF !important; background: rgba(108,99,255,0.12) !important; }
      .ba-results-title { font-size: 12px; font-weight: 900; color: rgba(200,195,255,0.5); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; text-align: center; }
      @keyframes ba-coin-bounce { 0%{transform:scale(0.5);opacity:0} 50%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }

      /* ── Leaderboard ── */
      .lb-tab-row { display: flex; gap: 10px; margin-bottom: 18px; }
      .lb-tab {
        flex: 1; padding: 11px 12px; background: rgba(255,255,255,0.03);
        border: 1.5px solid rgba(108,99,255,0.12); border-radius: 14px;
        color: rgba(200,195,255,0.6); font-size: 13px; font-weight: 800;
        cursor: pointer; text-align: center; transition: all 0.2s; font-family: inherit;
        letter-spacing: 0.03em;
      }
      .lb-tab:hover {
        background: rgba(108,99,255,0.08); border-color: rgba(108,99,255,0.25);
        color: rgba(200,195,255,0.8);
      }
      .lb-tab.active {
        background: linear-gradient(135deg,rgba(108,99,255,0.22),rgba(108,99,255,0.14)); 
        border-color: rgba(108,99,255,0.45);
        color: #a78bfa; box-shadow: 0 4px 16px rgba(108,99,255,0.18);
      }
      .lb-row {
        display: flex; align-items: center; gap: 14px; padding: 14px 16px;
        background: linear-gradient(135deg,rgba(108,99,255,0.06),rgba(108,99,255,0.02)); border-radius: 16px; margin-bottom: 10px;
        border: 1.5px solid rgba(108,99,255,0.15); transition: all 0.2s; position: relative; overflow: hidden;
      }
      .lb-row::before {
        content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
        background: linear-gradient(180deg, rgba(108,99,255,0.3), transparent); opacity: 0;
        transition: opacity 0.2s;
      }
      .lb-row:hover { 
        border-color: rgba(108,99,255,0.35); 
        background: linear-gradient(135deg,rgba(108,99,255,0.12),rgba(108,99,255,0.06)); 
        box-shadow: 0 8px 24px rgba(108,99,255,0.12);
        transform: translateX(4px);
      }
      .lb-row:hover::before { opacity: 1; }
      .lb-row.me { 
        border-color: rgba(108,99,255,0.45); 
        background: linear-gradient(135deg,rgba(108,99,255,0.18),rgba(108,99,255,0.1)); 
        box-shadow: 0 8px 28px rgba(108,99,255,0.18);
      }
      .lb-row.me::before { opacity: 1; }
      .lb-row.top3 { 
        border-color: rgba(245,158,11,0.4); 
        background: linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.05)); 
      }
      .lb-row.top3 .lb-rank { animation: pulse-gold 2s infinite; }
      @keyframes pulse-gold { 0%, 100% { text-shadow: 0 0 0 transparent; } 50% { text-shadow: 0 0 12px rgba(245,158,11,0.6); } }
      .lb-rank { font-size: 24px; min-width: 32px; text-align: center; font-weight: 900; }
      .lb-avatar {
        width: 48px; height: 48px; border-radius: 14px;
        display: flex; align-items: center; justify-content: center;
        font-size: 22px; font-weight: 800; flex-shrink: 0;
        border: 1.5px solid rgba(108,99,255,0.25); background: rgba(108,99,255,0.08);
        box-shadow: 0 4px 12px rgba(108,99,255,0.1);
      }
      .lb-info { flex: 1; min-width: 0; }
      .lb-name { font-size: 14px; font-weight: 800; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.3px; }
      .lb-level { font-size: 12px; margin-top: 3px; font-weight: 600; color: rgba(200,195,255,0.6); }
      .lb-xp-col { text-align: right; flex-shrink: 0; }
      .lb-xp-val { font-size: 17px; font-weight: 900; color: #a78bfa; font-family: 'Space Grotesk', monospace; letter-spacing: -0.5px; }
      .lb-xp-lbl { font-size: 10px; color: rgba(200,195,255,0.4); margin-top: 3px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
      .lb-weekly-notice {
        background: linear-gradient(135deg,rgba(245,158,11,0.15),rgba(255,107,157,0.08));
        border: 1.5px solid rgba(245,158,11,0.35); border-radius: 16px; padding: 16px 18px; margin-bottom: 20px;
        font-size: 12px; line-height: 1.8; color: rgba(255,220,150,0.9);
        box-shadow: 0 8px 24px rgba(245,158,11,0.08);
      }
      .lb-theme-toggle {
        padding: 6px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(108,99,255,0.2);
        border-radius: 8px; color: rgba(200,195,255,0.6); font-size: 11px; font-weight: 700;
        cursor: pointer; font-family: inherit; letter-spacing: 0.02em;
      }

      /* ── Players list ── */
      .ba-players-list { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
      .ba-player-chip {
        padding: 5px 12px; background: rgba(108,99,255,0.12); border: 1px solid rgba(108,99,255,0.25);
        border-radius: 20px; font-size: 12px; color: rgba(200,195,255,0.85); font-weight: 700;
        transition: all 0.15s;
      }
      .ba-player-chip:last-child { background: rgba(108,99,255,0.22); color: #a78bfa; }

      /* ── Promo code ── */
      .ba-promo-row { display: flex; gap: 8px; margin-bottom: 14px; }
      .ba-promo-input {
        flex: 1; padding: 11px 14px; background: rgba(255,255,255,0.05);
        border: 1.5px solid rgba(108,99,255,0.2); border-radius: 12px;
        color: var(--text-primary); font-size: 13px; font-family: inherit; text-transform: uppercase;
        letter-spacing: 0.05em; font-weight: 700;
      }
      .ba-promo-input::placeholder { font-weight: 400; letter-spacing: 0; text-transform: none; }
      .ba-promo-btn {
        padding: 11px 16px; background: rgba(108,99,255,0.15); border: 1px solid rgba(108,99,255,0.35);
        border-radius: 12px; color: #a78bfa; font-size: 13px; font-weight: 800;
        cursor: pointer; font-family: inherit; transition: all 0.15s; white-space: nowrap;
      }
      .ba-promo-btn:hover { background: rgba(108,99,255,0.25); border-color: rgba(108,99,255,0.5); }
      .ba-gate-box {
        background: rgba(245,158,11,0.05); border: 1px solid rgba(245,158,11,0.25);
        border-radius: 18px; padding: 20px; text-align: center; margin-bottom: 16px;
      }

      /* ── Loading & empty ── */
      .ba-loading { text-align: center; padding: 48px 0; color: rgba(200,195,255,0.4); font-size: 13px; font-weight: 600; }
      .ba-spinner {
        width: 32px; height: 32px;
        border: 3px solid rgba(108,99,255,0.15); border-top-color: #6C63FF;
        border-radius: 50%; animation: ba-spin 0.75s linear infinite; margin: 0 auto 14px;
      }
      @keyframes ba-spin { to { transform: rotate(360deg); } }
      .ba-empty {
        text-align: center; padding: 48px 20px;
        color: rgba(200,195,255,0.35); font-size: 14px; font-weight: 600; line-height: 1.8;
      }

      /* ── Usage badge ── */
      .ba-usage-badge {
        display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px;
        background: rgba(108,99,255,0.1); border: 1px solid rgba(108,99,255,0.22);
        border-radius: 20px; font-size: 11px; color: rgba(200,195,255,0.65); font-weight: 700;
        margin-bottom: 14px; letter-spacing: 0.02em;
      }

      /* ── Leaderboard light mode ── */
      .lb-light .lb-box { background: #f4f4fc; border-color: rgba(108,99,255,0.18); }
      .lb-light .lb-hdr { background: rgba(244,244,252,0.97); border-color: rgba(108,99,255,0.1); }
      .lb-light .lb-title { color: #1a1a2e; }
      .lb-light .lb-close { background: rgba(0,0,0,0.05); color: #555; border-color: rgba(0,0,0,0.08); }
      .lb-light .lb-tab { background: rgba(0,0,0,0.04); color: #555; border-color: rgba(108,99,255,0.15); }
      .lb-light .lb-tab.active { background: rgba(108,99,255,0.12); color: #4a44b5; border-color: rgba(108,99,255,0.35); }
      .lb-light .lb-row { background: rgba(0,0,0,0.02); border-color: rgba(108,99,255,0.1); }
      .lb-light .lb-row.me { background: rgba(108,99,255,0.06); }
      .lb-light .lb-name { color: #1a1a2e; }
      .lb-light .lb-xp-val { color: #c27a00; }
      .lb-light .lb-xp-lbl { color: rgba(0,0,0,0.35); }
      .lb-light .lb-weekly-notice { background: rgba(245,158,11,0.07); }
      .lb-light .lb-body { color: #333; }
    `;
    document.head.appendChild(s);
  }

  /* ─── CREATE MODALS ──────────────────────────────────────── */
  function createModals() {
    // Battle Arena Modal
    if (!document.getElementById('ba-modal')) {
      const m = document.createElement('div');
      m.id = 'ba-modal';
      m.innerHTML = `
        <div class="ba-box">
          <div class="ba-hdr">
            <span class="ba-title">⚔️ Battle Arena</span>
            <div style="display:flex;gap:8px;align-items:center;">
              <span id="ba-online-dot" style="font-size:11px;color:#4ade80;">● Live</span>
              <button class="ba-close" onclick="BA.close()">✕</button>
            </div>
          </div>
          <div class="ba-body" id="ba-body"></div>
        </div>`;
      document.body.appendChild(m);
    }

    // Leaderboard Modal
    if (!document.getElementById('lb-modal')) {
      const m = document.createElement('div');
      m.id = 'lb-modal';
      m.innerHTML = `
        <div class="lb-box" id="lb-box">
          <div class="lb-hdr">
            <span class="lb-title">🏆 Leaderboard</span>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="lb-theme-toggle" id="lb-theme-btn" onclick="BA.toggleLbTheme()">🌙 Dark</button>
              <button class="lb-close" onclick="BA.closeLb()">✕</button>
            </div>
          </div>
          <div class="lb-body" id="lb-body"></div>
        </div>`;
      document.body.appendChild(m);
    }
  }

  /* ─── BATTLE ARENA CONTROLLER ────────────────────────────── */
  window.BA = {
    _pollListInterval: null,
    _pollGameInterval: null,
    _activeBattleId: null,
    _lbTheme: 'dark',
    _searchQuery: '',

    open() {
      injectStyles();
      createModals();
      document.getElementById('ba-modal').classList.add('open');
      this._renderArena();
    },

    close() {
      document.getElementById('ba-modal')?.classList.remove('open');
      this._stopPolling();
      this._activeBattleId = null;
    },

    closeLb() {
      document.getElementById('lb-modal')?.classList.remove('open');
    },

    toggleLbTheme() {
      this._lbTheme = this._lbTheme === 'dark' ? 'light' : 'dark';
      const modal = document.getElementById('lb-modal');
      const btn = document.getElementById('lb-theme-btn');
      if (this._lbTheme === 'light') {
        modal.classList.add('lb-light');
        if (btn) btn.textContent = '☀️ Light';
      } else {
        modal.classList.remove('lb-light');
        if (btn) btn.textContent = '🌙 Dark';
      }
    },

    _stopPolling() {
      PollingController.stop();
      TimerController.stop();
      if (this._pollListInterval) { clearInterval(this._pollListInterval); this._pollListInterval = null; }
      if (this._genTimerInterval) { clearInterval(this._genTimerInterval); this._genTimerInterval = null; }
      if (this._pollGameInterval) { clearInterval(this._pollGameInterval); this._pollGameInterval = null; }
      // Reset state and countdown flag when stopping polling
      this._countdownShown = false;
      this._lastRenderHash = null;
      StateManager.currentBattleId = null;
      StateManager.answerLocked = false;
      // CRITICAL FIX v3.2.6: Clear cached battle data to free memory
      this._cachedBattle = null;
      // Clean up any active demo battle timers
      if (this._activeBattleId && this._activeBattleId.startsWith('demo_')) {
        if (this._demoCleanup && this._demoCleanup[this._activeBattleId]) {
          this._demoCleanup[this._activeBattleId]();
        }
      }
    },

    /* ── ARENA HOME — list of open battles ── */
    async _renderArena() {
      const body = document.getElementById('ba-body');
      if (!body) return;
      body.innerHTML = `<div class="ba-loading"><div class="ba-spinner"></div>Loading battles...</div>`;
      this._stopPolling();
      this._activeBattleId = null;

      // Start polling the public battle list
      await this._refreshBattleList();
      this._pollListInterval = setInterval(() => this._refreshBattleList(), POLL_BATTLE_LIST);
    },

    async _refreshBattleList() {
      const body = document.getElementById('ba-body');
      if (!body || this._activeBattleId) return;

      if (!window._firebaseDb || !window._firebaseFns) {
        setTimeout(() => this._refreshBattleList(), 1000);
        return;
      }

      // Only show battles that are still in the waiting/lobby state.
      // Once admin starts (generating/countdown/active), the battle disappears
      // from the public list so no new users can join mid-battle.
      const ACTIVE_STATUSES = ['waiting'];
      let battles = null;

      // Attempt 1: composite index query (fastest, requires index)
      try {
        const db = window._firebaseDb;
        const { collection, query, where, getDocs, orderBy, limit } = window._firebaseFns;
        const q = query(
          collection(db, 'publicBattles'),
          where('status', 'in', ACTIVE_STATUSES),
          orderBy('createdAt', 'desc'),
          limit(20)
        );
        const snap = await getDocs(q);
        battles = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      } catch(e) { /* index not ready — try next */ }

      // Attempt 2: where-only query, no orderBy (works without composite index)
      if (battles === null) {
        try {
          const db = window._firebaseDb;
          const { collection, query, where, getDocs } = window._firebaseFns;
          const q = query(
            collection(db, 'publicBattles'),
            where('status', 'in', ACTIVE_STATUSES)
          );
          const snap = await getDocs(q);
          battles = snap.docs.map(d => ({ ...d.data(), id: d.id }))
            .sort((a,b) => (b.createdAt||0) - (a.createdAt||0))
            .slice(0, 20);
        } catch(e) { /* still failing — try full scan */ }
      }

      // Attempt 3: full collection scan, filter client-side
      // Always works as long as Firestore rules allow read for signed-in users
      if (battles === null) {
        try {
          const db = window._firebaseDb;
          const { collection, getDocs } = window._firebaseFns;
          const snap = await getDocs(collection(db, 'publicBattles'));
          battles = snap.docs
            .map(d => ({ ...d.data(), id: d.id }))
            .filter(b => ACTIVE_STATUSES.includes(b.status))
            .sort((a,b) => (b.createdAt||0) - (a.createdAt||0))
            .slice(0, 20);
        } catch(e) { /* all attempts failed */ }
      }

      // Filter out battles older than 3 hours — they expire automatically
      const THREE_HOURS = 3 * 60 * 60 * 1000;
      const now = Date.now();
      if (battles) {
        battles = battles.filter(b => (now - (b.createdAt || 0)) < THREE_HOURS);
        // Auto-delete expired battles from Firestore (best-effort, one per refresh)
        const expired = (battles || []).filter(b => (now - (b.createdAt || 0)) >= THREE_HOURS);
        expired.forEach(b => {
          try {
            const { doc, deleteDoc } = window._firebaseFns;
            deleteDoc(doc(window._firebaseDb, 'publicBattles', b.id)).catch(() => {});
          } catch(_) {}
        });
      }

      this._renderBattleList(battles || [], this._searchQuery || '');
    },

    _renderBattleList(battles, searchQuery) {
      if (this._activeBattleId) return;
      const body = document.getElementById('ba-body');
      if (!body) return;

      // Filter out battles the user has quit — never show them again
      battles = (battles || []).filter(b => !window._hasQuitBattle(b.id));

      // Apply search filter
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        battles = battles.filter(b =>
          (b.name || '').toLowerCase().includes(q) ||
          (b.exam || '').toLowerCase().includes(q) ||
          (b.creatorName || '').toLowerCase().includes(q)
        );
      }

      const isCreator = isBattleCreator();
      const usage = getBattleCreatorUsage();
      const myUid = uid();
      const maxAllowed = getMaxBattlesPerMonth();
      const battleTier = getBattleTier();
      const tierLabel = battleTier === 'battle_academy' ? 'Academy' : battleTier === 'battle_pro' ? 'Pro' : 'Basic';

      let html = '';

      // ── Search bar ──
      html += `
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <input
            class="ba-input"
            id="ba-search-input"
            placeholder="🔍 Search battles by name, exam or creator..."
            style="margin-bottom:0;"
            value="${(searchQuery||'').replace(/"/g,'&quot;')}"
            oninput="BA._onSearch(this.value)"
          />
          ${searchQuery ? `<button onclick="BA._clearSearch()" style="padding:0 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(108,99,255,0.25);border-radius:10px;color:var(--text-secondary);cursor:pointer;flex-shrink:0;">✕</button>` : ''}
        </div>`;
      
      // ── Show battle limit for free users ──
      (async () => {
        if (typeof window.checkBattleAccess === 'function') {
          const access = await window.checkBattleAccess('arena');
          if (!access.unlimited && access.limit && access.used !== undefined) {
            const remaining = Math.max(0, access.limit - access.used);
            const limitHtml = `
              <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px;color:var(--text-primary);">
                <div style="font-weight:700;color:var(--text-primary);margin-bottom:4px;">⚔️ Free Daily Battles: ${access.used}/3 Used</div>
                <div style="font-size:12px;color:var(--text-secondary);">${remaining} free battles remaining today · Upgrade to Premium for unlimited</div>
              </div>`;
            const existingLimit = body.querySelector('[data-battle-limit]');
            if (existingLimit) existingLimit.remove();
            const searchDiv = body.querySelector('div[style*="display:flex;gap:8px"]');
            if (searchDiv && searchDiv.nextSibling) {
              const div = document.createElement('div');
              div.setAttribute('data-battle-limit', '1');
              div.innerHTML = limitHtml;
              searchDiv.parentNode.insertBefore(div, searchDiv.nextSibling);
            }
          }
        }
      })();
      if (isCreator) {
        const baseRemaining = Math.max(0, maxAllowed - usage);
        const extraCredits = getBattleExtraCredits();
        const totalRemaining = baseRemaining + extraCredits;
        html += `
          <div class="ba-usage-badge">
            ⚔️ Battle Creator ${tierLabel} · <strong>${maxAllowed === 999999 ? '∞' : baseRemaining + '/' + maxAllowed}</strong> left this month
            ${extraCredits > 0 ? `<span style="margin-left:6px;background:rgba(245,158,11,0.2);color:#f59e0b;padding:2px 8px;border-radius:10px;font-size:11px;">+${extraCredits} extra ⚔️</span>` : ''}
          </div>
          <button class="ba-create-btn" onclick="BA._showCreateForm()" ${totalRemaining <= 0 ? 'style="opacity:0.5;"' : ''}>
            ⚔️ Create New Battle ${totalRemaining <= 0 ? '(Buy More →)' : `(${maxAllowed === 999999 ? '∞' : totalRemaining} left)`}
          </button>`;
      } else {
        html += `
          <div class="ba-gate-box">
            <div style="font-size:28px;margin-bottom:8px;">⚔️</div>
            <div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-bottom:6px;">Want to Create Battles?</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;line-height:1.5;">
              Choose a Battle Creator plan and host live quiz battles.<br>All users can join your battles for free!
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:10px 12px;">
                <div><div style="font-size:13px;font-weight:700;color:var(--text-primary);">⚔️ Basic</div><div style="font-size:11px;color:var(--text-secondary);">5 battles/month</div></div>
                <span style="font-size:15px;font-weight:800;color:#f59e0b;">₹99/mo</span>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(239,68,68,0.12);border:1.5px solid rgba(239,68,68,0.5);border-radius:10px;padding:10px 12px;position:relative;">
                <div style="position:absolute;top:-8px;right:10px;background:linear-gradient(135deg,#ef4444,#f59e0b);color:var(--text-primary);font-size:9px;font-weight:800;padding:2px 8px;border-radius:10px;">POPULAR</div>
                <div><div style="font-size:13px;font-weight:700;color:var(--text-primary);">⚔️⚔️ Pro</div><div style="font-size:11px;color:var(--text-secondary);">19 battles/month</div></div>
                <span style="font-size:15px;font-weight:800;color:#f59e0b;">₹299/mo</span>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.35);border-radius:10px;padding:10px 12px;">
                <div><div style="font-size:13px;font-weight:700;color:var(--text-primary);">⚔️🏆 Academy</div><div style="font-size:11px;color:var(--text-secondary);">29 battles/month</div></div>
                <span style="font-size:15px;font-weight:800;color:#f59e0b;">₹499/mo</span>
              </div>
            </div>
            <div class="ba-promo-row">
              <input class="ba-promo-input" id="ba-promo-in" placeholder="Have a promo code?" maxlength="20" />
              <button class="ba-promo-btn" onclick="BA._applyPromo()">Apply</button>
            </div>
            <button onclick="BA._openBattlePlanModal();" style="width:100%;padding:12px;background:linear-gradient(135deg,#f59e0b,#ef4444);border:none;border-radius:10px;color:var(--text-primary);font-size:13px;font-weight:800;cursor:pointer;">
              ⚔️ View Battle Creator Plans →
            </button>
          </div>`;
      }

      html += `<div class="ba-section-title">🔴 Live & Open Battles</div>`;

      // Merge real battles (top) + demo battles (bottom fill) 
      const realBattles = battles ? battles.filter(b => !b._isDemo) : [];
      const demoToShow  = realBattles.length < 20
        ? DEMO_BATTLES.slice(0, Math.max(0, 20 - realBattles.length)).filter(d => !window._hasQuitBattle(d.id))
        : [];
      const allBattles  = [...realBattles, ...demoToShow];

      if (!allBattles || allBattles.length === 0) {
        html += `<div class="ba-empty">${searchQuery ? `🔍 No battles matching "<strong>${searchQuery}</strong>".<br>Try a different search or check back soon.` : `😴 No battles right now.<br>${isCreator ? 'Create one above!' : 'Check back soon or ask a friend to create one!'}</div>`}`;
      } else {
        if (demoToShow.length > 0 && realBattles.length === 0) {
          html += `<div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.15);border-radius:10px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:8px;">
            ⚔️ <span>Open battles waiting for challengers. <a href="#" onclick="BA._openBattlePlanModal();return false;" style="color:#6C63FF;text-decoration:none;font-weight:700;background:rgba(108,99,255,0.1);padding:2px 6px;border-radius:4px;">Create your own battle ⚔️</a></span>
          </div>`;
        } else if (demoToShow.length > 0 && realBattles.length > 0) {
          // Separator will be injected after real battles below
        }
        let demoSepAdded = false;
        allBattles.forEach(b => {
          if (b._isDemo && !demoSepAdded && realBattles.length > 0) {
            demoSepAdded = true;
            html += `<div style="text-align:center;padding:8px 0 4px;font-size:11px;color:var(--text-secondary);letter-spacing:0.05em;">── More Open Battles ──</div>`;
          }
          const playerCount = (b.players || []).length;
          const isFull = playerCount >= MAX_PLAYERS;
          const alreadyIn = (b.players || []).includes(myUid);
          const examLabel = b.exam || 'General';
          const slotsLeft = MAX_PLAYERS - playerCount;

          // Show player names
          const playerNames = Object.values(b.playerNames || {}).slice(0, 5);
          const playersStr = playerNames.length > 0
            ? playerNames.join(', ') + (playerCount > 5 ? ` +${playerCount-5} more` : '')
            : 'Waiting for players...';

          const statusBadge = b.status === 'active'
            ? `<span style="font-size:11px;background:rgba(239,68,68,0.2);color:#f87171;padding:2px 8px;border-radius:10px;font-weight:700;">🔴 LIVE</span>`
            : b.status === 'countdown'
            ? `<span style="font-size:11px;background:rgba(245,158,11,0.2);color:#f59e0b;padding:2px 8px;border-radius:10px;font-weight:700;">⏳ Starting</span>`
            : b.status === 'generating'
            ? `<span style="font-size:11px;background:rgba(108,99,255,0.2);color:#5b46d4;padding:2px 8px;border-radius:10px;font-weight:700;">🤖 AI Generating</span>`
            : `<span style="font-size:11px;background:rgba(74,222,128,0.15);color:#4ade80;padding:2px 8px;border-radius:10px;font-weight:700;">🟢 Open</span>`;

          html += `
            <div class="ba-battle-card ${isFull && !alreadyIn ? 'full' : ''}" id="ba-card-${b.id}">
              <div class="ba-card-top">
                <div>
                  <div class="ba-card-name">${b.name || 'Quiz Battle'}</div>
                  <div class="ba-card-exam">📚 ${examLabel} &nbsp;·&nbsp; ${statusBadge}</div>
                </div>
                <span class="ba-card-slots ${isFull ? 'ba-slots-full' : 'ba-slots-open'}">
                  ${isFull ? '👥 Full' : `${playerCount}/${MAX_PLAYERS} joined`}
                </span>
              </div>
              <div style="font-size:11px;color:var(--text-secondary);margin-bottom:10px;">
                👥 ${playersStr}
              </div>
              <div class="ba-card-bottom">
                <div class="ba-card-players">
                  Created by <strong style="color:rgba(26,26,38,0.7)">${b.creatorName || 'Admin'}</strong>
                </div>
                ${b._isDemo
                  ? `<button class="ba-join-btn" onclick="BA._joinDemoBattle('${b.id}')">⚔️ Join</button>`
                  : alreadyIn
                  ? `<button class="ba-join-btn" onclick="BA._rejoinBattle('${b.id}')">▶ Rejoin</button>`
                  : isFull
                  ? `<button class="ba-join-btn" disabled id="full-btn-${b.id}">Full</button>`
                  : `<button class="ba-join-btn" onclick="BA._joinBattle('${b.id}')">⚔️ Join</button>`
                }
              </div>
            </div>`;
        });
      }

      body.innerHTML = html;

      // Auto-show full then disappear after 3s
      battles.forEach(b => {
        if ((b.players || []).length >= MAX_PLAYERS) {
          const card = document.getElementById(`ba-card-${b.id}`);
          if (card) {
            setTimeout(() => {
              if (card && card.parentNode) {
                card.style.transition = 'opacity 0.5s';
                card.style.opacity = '0';
                setTimeout(() => card.remove(), 500);
              }
            }, 3000);
          }
        }
      });
    },

    _onSearch(value) {
      this._searchQuery = value || '';
      this._refreshBattleList();
    },

    _clearSearch() {
      this._searchQuery = '';
      this._refreshBattleList();
    },

    /* ── Demo battle: real-feeling lobby → countdown → 10 AI questions → coins ── */
    async _joinDemoBattle(demoId) {
      // Check battle limit for free users
      if (typeof window.checkBattleAccess === 'function') {
        const access = await window.checkBattleAccess('demo');
        if (!access.allowed) {
          toast(access.reason);
          if (typeof openPremiumModal === 'function') openPremiumModal();
          return;
        }
      }

      const demoDef = DEMO_BATTLES.find(d => d.id === demoId);
      if (!demoDef) return;
      const body = document.getElementById('ba-body');
      if (!body) return;
      this._stopPolling();
      this._activeBattleId = demoId;

      const myName = getMyName();
      const myUid  = uid();

      // Track usage for free users (for both demo and real battles)
      if (typeof window.trackBattleUsage === 'function') {
        window.trackBattleUsage('demo');
      }

      // Build initial player list (bots already in + me)
      const botNames   = Object.values(demoDef.playerNames);
      const allPlayers = [...botNames, myName];
      const playerNamesMap = { ...demoDef.playerNames, [myUid]: myName };

      let demoState = {
        players: [...allPlayers],
        playerNamesMap: { ...playerNamesMap },
        questions: Array.from({length: 10}, (_, i) => ({ q: 'Q' + (i+1) + ': Loading questions...', opts: ['Loading...', 'Loading...', 'Loading...', 'Loading...'], ans: 0, topic: 'General', exp: 'Please wait...' })),
        qi: 0,
        xp: { [myUid]: 0 },
        userAnswered: {},
        botAutoTimer: null,
        fakeJoinTimer: null,
        nextQTimer: null,
        timerInterval: null,
        examKey: demoDef._examKey || 'cgl',
        resultsShown: false,
        userAttemptedCount: 0,
      };
      
      // Initialize per-user answered tracking
      Object.keys(demoState.playerNamesMap).forEach(player => {
        demoState.userAnswered[player] = false;
      });
      demoState.userAnswered[myUid] = false;
      let joinedCount = allPlayers.length;

      // Pre-fetch AI questions in background
      _getDemoQuestionsForExam(demoState.examKey).then(
        qs => { 
          demoState.questions = (qs && Array.isArray(qs) && qs.length > 0) ? qs.map(q => {
            // FIX: Ensure ans is always a number for proper comparison
            let ansIndex = 0;
            if (q.ans !== undefined && q.ans !== null) {
              ansIndex = typeof q.ans === 'string' ? parseInt(q.ans, 10) : Number(q.ans);
              if (isNaN(ansIndex)) ansIndex = 0;
            }
            return {
              q: q.q || q.question || '',
              opts: q.opts || q.options || [],
              ans: Math.max(0, Math.min(3, ansIndex)), // Ensure valid range 0-3
              exp: q.exp || q.explanation || ''
            };
          }) : Array.from({length: 10}, (_, i) => ({ q: 'Q' + (i+1) + ': Upload questions to Firebase Storage at mock/' + demoState.examKey + '/questions.json', opts: ['Option A', 'Option B', 'Option C', 'Option D'], ans: 0, topic: 'General', exp: 'Upload question bank to gs://rankgpt-f8a64.firebasestorage.app/mock/' + demoState.examKey + '/questions.json' })); 
        },
        err => {
          demoState.questions = Array.from({length: 10}, (_, i) => ({ q: 'Q' + (i+1) + ': Upload questions to Firebase Storage at mock/' + demoState.examKey + '/questions.json', opts: ['Option A', 'Option B', 'Option C', 'Option D'], ans: 0, topic: 'General', exp: 'Upload question bank to gs://rankgpt-f8a64.firebasestorage.app/mock/' + demoState.examKey + '/questions.json' }));
          if (err && err.isMaintenance && typeof window.showMaintenanceOverlay === 'function') {
            window.showMaintenanceOverlay();
          }
        }
      );

      // ── Lobby render ──
      const _renderLobby = () => {
        if (!document.getElementById('ba-body') || this._activeBattleId !== demoId) return;
        const pc = joinedCount;
        body.innerHTML = `
          <button class="ba-promo-btn" style="margin-bottom:14px;" onclick="BA._demoLeave('${demoId}')">← Leave</button>
          <div style="text-align:center;padding:16px 0 8px;">
            <div style="font-size:32px;margin-bottom:8px;">⚔️</div>
            <div style="font-size:18px;font-weight:800;color:var(--text-primary);margin-bottom:4px;">${demoDef.name}</div>
            <div style="font-size:12px;color:rgba(26,26,38,0.70);">📚 ${demoDef.exam}</div>
          </div>
          <div style="background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:12px;padding:14px;margin:12px 0;text-align:center;">
            <div style="font-size:13px;color:#4ade80;font-weight:700;" id="demo-lobby-status" class="ba-status-waiting">🟢 Waiting for players...</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;" id="demo-lobby-count">${pc}/${MAX_PLAYERS} joined · ${MAX_PLAYERS - pc} slots left</div>
          </div>
          <div class="ba-section-title">👥 Players Joined</div>
          <div class="ba-players-list" id="demo-players-list">
            ${demoState.players.map(n => `<div class="ba-player-chip" style="min-height:44px;display:flex;align-items:center;justify-content:center;">${n === myName ? '<span style="color:var(--accent);font-weight:700;">'+n+'</span><span style="font-size:11px;margin-left:4px;opacity:0.7;">(You)</span>' : n}</div>`).join('')}
          </div>
          <div id="demo-waiting-msg" style="text-align:center;padding:14px;color:var(--text-secondary);font-size:13px;">⏳ Battle starts when all ${MAX_PLAYERS} slots are filled…</div>
          <div id="demo-ai-loading" style="display:none;text-align:center;padding:12px;font-size:12px;color:var(--text-secondary);">
            <div class="ba-spinner" style="width:20px;height:20px;margin:0 auto 8px;"></div>AI is preparing 10 questions…
          </div>`;
      };
      _renderLobby();

      // ── Fake player joins every 2–3 seconds ──
      const _fakeJoin = () => {
        if (this._activeBattleId !== demoId || joinedCount >= MAX_PLAYERS) return;
        const newName = _randomName(demoState.players);
        demoState.players.push(newName);
        demoState.playerNamesMap['bot_extra_' + joinedCount] = newName;
        joinedCount++;

        const list = document.getElementById('demo-players-list');
        const countEl = document.getElementById('demo-lobby-count');
        const statusEl = document.getElementById('demo-lobby-status');
        if (list) {
          const chip = document.createElement('div');
          chip.className = 'ba-player-chip';
          chip.style.animation = 'ba-countpop 0.4s ease';
          chip.textContent = newName;
          list.appendChild(chip);
        }
        if (countEl) countEl.textContent = `${joinedCount}/${MAX_PLAYERS} joined · ${MAX_PLAYERS - joinedCount} slots left`;
        if (statusEl && joinedCount >= MAX_PLAYERS - 1) { statusEl.textContent = '🔥 Almost full!'; statusEl.style.color = '#f59e0b'; }

        if (joinedCount < MAX_PLAYERS) {
          demoState.fakeJoinTimer = setTimeout(_fakeJoin, 2000 + Math.random() * 1500);
        } else {
          if (statusEl) { statusEl.textContent = '🔥 Battle Full! Starting now...'; statusEl.style.color = '#f87171'; }
          const loadEl = document.getElementById('demo-ai-loading');
          if (loadEl) loadEl.style.display = 'block';
          const waitEl = document.getElementById('demo-waiting-msg');
          if (waitEl) waitEl.style.display = 'none';
          const _startWhenReady = async () => {
            if (demoState.questions.length < 10) {
              try {
                demoState.questions = await _getDemoQuestionsForExam(demoState.examKey);
              } catch (err) {
                if (err && err.isMaintenance && typeof window.showMaintenanceOverlay === 'function') {
                  window.showMaintenanceOverlay();
                }
                return;
              }
            }
            if (this._activeBattleId === demoId) _demoCountdown();
          };
          setTimeout(_startWhenReady, 800);
        }
      };
      demoState.fakeJoinTimer = setTimeout(_fakeJoin, 2000 + Math.random() * 1000);

      // ── 3-2-1 Countdown ──
      const _demoCountdown = () => {
        if (this._activeBattleId !== demoId) return;
        const overlay = document.createElement('div');
        overlay.className = 'ba-countdown-overlay';
        overlay.innerHTML = `<div class="ba-countdown-num" id="ba-dcdown-num">3</div><div class="ba-countdown-label">Get ready to battle!</div>`;
        document.body.appendChild(overlay);
        let count = 3;
        const numEl = overlay.querySelector('#ba-dcdown-num');
        const tick = () => {
          count--;
          if (count > 0) {
            if (numEl) { numEl.textContent = count; numEl.style.animation = 'none'; void numEl.offsetWidth; numEl.style.animation = 'ba-countpop 0.6s ease'; }
            setTimeout(tick, 1000);
          } else {
            if (numEl) { numEl.textContent = 'GO!'; numEl.style.animation = 'none'; void numEl.offsetWidth; numEl.style.animation = 'ba-countpop 0.6s ease'; }
            setTimeout(() => { 
              overlay.remove(); 
              if (this._activeBattleId === demoId) {
                // Timer removed - battles now end when all questions answered
                _demoShowQuestion();
              }
            }, 800);
          }
        };
        setTimeout(tick, 1000);
      };

      // ── Battle timer removed - battles now end when all questions are answered ──

      // ── Render question ──
      const _demoShowQuestion = () => {
        clearTimeout(demoState.botAutoTimer); clearTimeout(demoState.nextQTimer);
        const qi = demoState.qi;
        const q  = demoState.questions && demoState.questions[qi];
        
        // Check battle end conditions
        if (!q || !q.opts || qi >= 10) { 
          _demoResults(); 
          return; 
        }
        
        // Only proceed if still in active demo battle
        if (this._activeBattleId !== demoId) return;
        // Reset per-user answered flag for next question
        Object.keys(demoState.userAnswered).forEach(player => {
          demoState.userAnswered[player] = false;
        });

        const _xpBoardHtml = () => {
          const entries = Object.entries(demoState.xp).sort((a,b)=>b[1]-a[1]);
          if (!entries.length) return '';
          const _maxXp1 = entries[0]?.[1] || 1;
          return `<div class="ba-xp-board"><div class="ba-xp-board-title">⚡ Live XP Board</div>${entries.map(([u,x],i) => `<div class="ba-xp-row ${u===myUid?'me':''}""><span class="ba-xp-rank">${['🥇','🥈','🥉'][i]||'#'+(i+1)}</span><span class="ba-xp-name">${demoState.playerNamesMap[u]||'Player'}</span><div class="ba-xp-bar-wrap"><div class="ba-xp-mini-bar"><div class="ba-xp-mini-fill" style="width:${Math.round((x/_maxXp1)*100)}%"></div></div></div><span class="ba-xp-val">${x}</span></div>`).join('')}</div>`;
        };

        body.innerHTML = `
          <div class="ba-active-wrap">
            <div class="ba-quiz-header">
              <span class="ba-quiz-num-pill">Q ${qi+1} <span style="opacity:0.5;">/ 10</span></span>
              <span class="ba-quiz-xp-pill">⚡ ${demoState.xp[myUid]||0} XP</span>
              <span class="ba-quiz-xp-pill" style="background:linear-gradient(135deg,#a78bfa,#8b5cf6);margin-left:8px;">✅ Answer all 10</span>
            </div>
            <div class="ba-quiz-bar"><div class="ba-quiz-bar-fill" style="width:${(qi/10)*100}%"></div></div>
            <div class="ba-quiz-q-card">
              <div class="ba-quiz-q-label">Question</div>
              <div class="ba-quiz-q">${q.q || q.question || ''}</div>
            </div>
            <div class="ba-quiz-opts" id="demo-opts">
              ${(() => {
                const options = Array.isArray(q?.opts) ? q.opts : Array.isArray(q?.options) ? q.options : ['Option A', 'Option B', 'Option C', 'Option D'];
                return options.map((o,j) => `<button class="ba-quiz-opt" id="demo-opt-${j}" onclick="BA._demoAnswer('${demoId}',${j})"><span class="ba-opt-letter">${String.fromCharCode(65+j)}</span><span class="ba-opt-text">${o}</span></button>`).join('');
              })()}
            </div>
            <div id="demo-banner" style="display:none;"></div>
            <div id="demo-exp" style="display:none;" class="ba-quiz-exp"></div>
            <div id="demo-xp-board">${_xpBoardHtml()}</div>
          </div>`;

        // Bot auto-answer if user doesn't answer in 5-6s
        demoState.botAutoTimer = setTimeout(() => {
          // Check if ANY user has answered (for auto-trigger)
          const anyAnswered = Object.values(demoState.userAnswered).some(v => v);
          if (!anyAnswered && this._activeBattleId === demoId) BA._demoAnswer(demoId, -1);
        }, 5000 + Math.random() * 1000);
      };

      // ── Handle answer (exposed globally for this demo) ──
      BA._demoAnswer = (id, chosenIdx) => {
        const myUid = uid();  // Get current user
        // FIX: Check only THIS USER's answered status, not global
        if (id !== demoId || this._activeBattleId !== demoId || demoState.userAnswered[myUid]) return;
        demoState.userAnswered[myUid] = true;  // FIX: Mark only this user as answered
        demoState.userAttemptedCount++;
        clearTimeout(demoState.botAutoTimer);
        const qi   = demoState.qi;
        const q    = demoState.questions[qi];
        if (!q || !q.opts || q.ans === undefined) return;
        const isBot   = chosenIdx === -1;
        const correct = !isBot && chosenIdx === q.ans;

        (q.opts || []).forEach((_, j) => {
          const btn = document.getElementById('demo-opt-' + j);
          if (!btn) return;
          btn.disabled = true;
          if (j === q.ans) btn.classList.add('correct');
          else if (!isBot && j === chosenIdx) btn.classList.add('wrong');
          else btn.classList.add('dim');
        });

        if (!isBot && correct) demoState.xp[myUid] = (demoState.xp[myUid] || 0) + 10;

        // Simulate bots answering — each independent
        const botKeys = Object.keys(demoState.playerNamesMap).filter(k => k !== myUid);
        botKeys.slice(0, 2 + Math.floor(Math.random() * 2)).forEach(bk => {
          if (Math.random() > 0.4) demoState.xp[bk] = (demoState.xp[bk] || 0) + 10;
        });

        const banner = document.getElementById('demo-banner');
        if (banner) {
          banner.style.display = 'block';
          if (isBot) {
            banner.className = 'ba-quiz-answered-banner wrong';
            banner.innerHTML = `⏱ Time's up! Question skipped`;
          } else {
            banner.className = 'ba-quiz-answered-banner ' + (correct ? 'correct' : 'wrong');
            const answer = (q.opts && q.opts[q.ans]) || 'Loading...';
            banner.innerHTML = correct ? `✅ Correct! <b>+10 XP</b>` : `❌ Wrong! Answer: <b>${answer}</b>`;
          }
        }
        const expEl = document.getElementById('demo-exp');
        if (expEl && q.exp) { expEl.style.display = 'block'; expEl.textContent = '💡 ' + q.exp; }

        const xpBoard = document.getElementById('demo-xp-board');
        if (xpBoard) {
          const entries = Object.entries(demoState.xp).sort((a,b)=>b[1]-a[1]);
          const _maxXp2 = entries[0]?.[1] || 1;
          xpBoard.innerHTML = `<div class="ba-xp-board"><div class="ba-xp-board-title">⚡ Live XP Board</div>${entries.map(([u,x],i) => `<div class="ba-xp-row ${u===myUid?'me':''}""><span class="ba-xp-rank">${['🥇','🥈','🥉'][i]||'#'+(i+1)}</span><span class="ba-xp-name">${demoState.playerNamesMap[u]||'Player'}</span><div class="ba-xp-bar-wrap"><div class="ba-xp-mini-bar"><div class="ba-xp-mini-fill" style="width:${Math.round((x/_maxXp2)*100)}%"></div></div></div><span class="ba-xp-val">${x}</span></div>`).join('')}</div>`;
        }

        demoState.nextQTimer = setTimeout(() => { demoState.qi++; if (this._activeBattleId === demoId) _demoShowQuestion(); }, 2500);
      };

      // ── Results ──
      const _demoResults = () => {
        const body = document.getElementById('ba-body');
        if (!body) return;
        if (this._activeBattleId !== demoId) return;
        if (demoState.resultsShown) return;
        demoState.resultsShown = true;
        
        // Clear all timers
        clearTimeout(demoState.botAutoTimer); 
        clearTimeout(demoState.nextQTimer); 
        clearTimeout(demoState.fakeJoinTimer);
        if (demoState.timerInterval) clearInterval(demoState.timerInterval);
        
        const sorted = Object.entries(demoState.xp).sort((a,b)=>b[1]-a[1]);
        const myRank = sorted.findIndex(([u]) => u === myUid);
        const myXP   = demoState.xp[myUid] || 0;
        
        // Coin system: 1st=25, 2nd=15, 3rd=8, rest=2
        let coinsWon = myRank === 0 ? 25 : myRank === 1 ? 15 : myRank === 2 ? 8 : myRank >= 3 ? 2 : 0;
        
        // Award coins if not already awarded
        if (coinsWon > 0) {
          const awardKey = 'ba_coins_demo_' + demoId + '_' + myUid;
          if (!localStorage.getItem(awardKey)) {
            // Sync coins to Firestore immediately with retry logic
            const syncPromise = (typeof _syncCoinsToFirebase === 'function') 
              ? _syncCoinsToFirebase(myUid, coinsWon, 'Demo Battle 🏆')
              : Promise.reject('Sync function not available');
            
            syncPromise.then(success => {
              if (success) {
                localStorage.setItem(awardKey, '1');
                // Refresh profile coins display
                if (typeof window.refreshProfileCoinsDisplay === 'function') {
                  setTimeout(() => { window.refreshProfileCoinsDisplay(); }, 300);
                }
                // Toast notification
                if (typeof toast === 'function') {
                  toast(`🪙 +${coinsWon} coins added to account! 🎉`, 2500);
                }
              }
            }).catch(() => {
              // Fallback: Write directly to Firestore if sync function fails
              const db = window._firebaseDb;
              const { doc, getDoc, updateDoc } = window._firebaseFns;
              if (db && getDoc && updateDoc && myUid) {
                getDoc(doc(db, 'users', myUid))
                  .then(snap => {
                    const currentCoins = snap.exists() ? (snap.data().coins || 0) : 0;
                    return updateDoc(doc(db, 'users', myUid), {
                      coins: currentCoins + coinsWon
                    });
                  })
                  .then(() => {
                    localStorage.setItem(awardKey, '1');
                    if (typeof window.refreshProfileCoinsDisplay === 'function') {
                      setTimeout(() => { window.refreshProfileCoinsDisplay(); }, 300);
                    }
                    if (typeof toast === 'function') {
                      toast(`🪙 +${coinsWon} coins added to account! 🎉`, 2500);
                    }
                  })
                  .catch(() => {
                    // Final fallback: localStorage only
                    const u = window._firebaseAuth?.currentUser;
                    if (u) {
                      const k = 'sscai_u:' + u.uid + ':coins';
                      const cur = JSON.parse(localStorage.getItem(k) || '{"coins":0}');
                      cur.coins = (cur.coins || 0) + coinsWon;
                      localStorage.setItem(k, JSON.stringify(cur));
                      localStorage.setItem(awardKey, '1');
                    }
                  });
              }
            });
          }
        }
        
        // Add XP to battle leaderboard
        if (typeof addBattleXP === 'function') {
          addBattleXP(myXP);
        }
        
        // Save to Firestore leaderboard
        try {
          if (typeof BA !== 'undefined' && BA._saveToLeaderboard) {
            BA._saveToLeaderboard(myUid, myName, myXP, {}).catch(() => {});
          }
        } catch(ex) {}

        // ── Save demo bot results to LOCAL leaderboard ONLY (not Firestore) ──
        // Do NOT mix demo players with real users on Firestore leaderboard
        try {
          const wk = typeof getWeekKey === 'function' ? getWeekKey() : 'w0';
          const demoLbKey = 'sscai_demo_lb_entries';
          const existing = JSON.parse(localStorage.getItem(demoLbKey) || '[]');
          
          // Remove old entries from previous weeks (keep only this week)
          const thisWeekEntries = existing.filter(e => e.weekKey === wk);
          
          // Cap demo entries at 5 per week (not 30)
          if (thisWeekEntries.length >= 5) {
            // Don't add more demo entries this week
          } else {
            const existingNames = new Set(thisWeekEntries.map(e => e.name));
            const demoNames = ['Arjun', 'Priya', 'Rohan', 'Neha', 'Karan', 'Sakshi', 'Aditya', 'Divya', 'Ravi', 'Anjali'];
            const uniqueDemoNames = demoNames.filter(n => !existingNames.has(n));
            
            const newEntries = sorted
              .filter(([u]) => u !== myUid)
              .slice(0, Math.min(2, uniqueDemoNames.length))  // Only 2 demo bots per battle
              .map(([u, xp], idx) => ({
                uid: 'demo_' + u + '_' + Date.now(),
                name: uniqueDemoNames[idx] || ('Bot' + idx),
                // CAP demo XP at 100 max (not hundreds)
                xp: Math.min(xp || 0, 100),
                battles: Math.floor(Math.random() * 5) + 1,
                wins: Math.floor(Math.random() * 2),
                coins: 0,
                weekKey: wk,
                _demo: true
              }));
            
            // Merge: keep this week + new entries, drop old weeks
            const merged = [...thisWeekEntries, ...newEntries].slice(-5); // Max 5 per week
            localStorage.setItem(demoLbKey, JSON.stringify(merged));
          }
        } catch(ex) {}

        const winnerEntry = sorted[0];
        const winnerName  = winnerEntry ? (demoState.playerNamesMap[winnerEntry[0]] || 'Player') : '—';
        const iWon = winnerEntry && winnerEntry[0] === myUid;
        
        // Show all players in results (not just top 6)
        const allPlayersHtml = sorted.map(([u,x],i) => {
          const isMe = u === myUid;
          return `<div class="ba-result-stat ${isMe ? 'ba-result-stat-me' : ''}">
            <div class="ba-result-stat-val">${['🥇','🥈','🥉'][i]||'#'+(i+1)}</div>
            <div class="ba-result-stat-lbl">${demoState.playerNamesMap[u]||'Player'}</div>
            <div class="ba-result-stat-score">${x} XP</div>
          </div>`;
        }).join('');
        
        body.innerHTML = `
          ${coinsWon > 0 ? `<div style="text-align:center;font-size:20px;font-weight:900;color:#f59e0b;margin-bottom:12px;animation:ba-coin-bounce 0.6s cubic-bezier(0.34,1.56,0.64,1);">🪙 +${coinsWon} Coins!</div>` : ''}
          <div class="ba-winner-wrap">
            <div class="ba-winner-trophy" style="animation:ba-trophy-in 0.6s cubic-bezier(0.34,1.56,0.64,1);">${iWon ? '🏆' : '🎯'}</div>
            <div class="ba-winner-title">${iWon ? 'You Won!' : 'Battle Over!'}</div>
            <div class="ba-winner-name">🥇 <strong style="color:#f59e0b">${winnerName}</strong> won with ${winnerEntry ? winnerEntry[1] : 0} XP</div>
          </div>
          <div class="ba-results-title">Final Scores</div>
          <div class="ba-results-grid">
            ${allPlayersHtml}
          </div>
          <div style="text-align:center;margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
            <button class="ba-join-btn" onclick="BA._demoLeave('${demoId}')">← Back to Arena</button>
            <button class="ba-join-btn" style="background:linear-gradient(135deg,#6C63FF,#a78bfa);" onclick="BA.openLeaderboard()">🏆 Leaderboard</button>
          </div>`;
      };

      BA._demoCleanup = BA._demoCleanup || {};
      BA._demoCleanup[demoId] = () => {
        clearTimeout(demoState.fakeJoinTimer);
        clearTimeout(demoState.botAutoTimer);
        clearTimeout(demoState.nextQTimer);
        if (demoState.timerInterval) clearInterval(demoState.timerInterval);
      };
    },

    _demoLeave(demoId) {
      if (BA._demoCleanup && BA._demoCleanup[demoId]) {
        BA._demoCleanup[demoId]();
        delete BA._demoCleanup[demoId];
      }
      this._stopPolling();
      this._activeBattleId = null;
      this._renderArena();
    },

        _applyPromo() {
      const input = document.getElementById('ba-promo-in');
      if (!input) return;
      const code = (input.value || '').trim().toUpperCase();
      if (code === BATTLE_PROMO) {
        // Save under per-user key so only THIS account gets the unlock
        const myUid = window._firebaseAuth?.currentUser?.uid;
        if (!myUid) {
          toast('❌ Please sign in before redeeming a promo code.', 3000);
          return;
        }
        const perUserPromoKey = 'sscai_u:' + myUid + ':' + LS_PROMO_KEY;
        localStorage.setItem(perUserPromoKey, 'true');
        toast('🎉 Promo code accepted! Battle Creator unlocked FREE!', 4000);
        this._renderArena();
      } else {
        toast('❌ Invalid promo code. Try again.', 2500);
        input.style.borderColor = 'rgba(239,68,68,0.5)';
        setTimeout(() => { if (input) input.style.borderColor = ''; }, 2000);
      }
    },

    /* ── Open Premium Modal scrolled to Battle Creator section ── */
    _openBattlePlanModal() {
      // Close battle arena modal so premium modal appears on top
      const baModal = document.getElementById('ba-modal');
      if (baModal) {
        baModal.classList.remove('open');
        baModal.style.display = 'none';
      }
      
      // 1. Open the premium modal
      if (typeof openPremiumModal === 'function') openPremiumModal();
      else if (typeof window.showPremiumModal === 'function') window.showPremiumModal();
      else {
        const m = document.getElementById('premiumModal');
        if (m) {
          m.classList.add('active');
          m.style.zIndex = '999999';
        }
      }
      // 2. After modal renders, scroll to the Battle Creator card
      setTimeout(function () {
        try {
          // Find the Battle Creator card by its label badge text
          const allEls = document.querySelectorAll('#premiumModal *');
          for (let i = 0; i < allEls.length; i++) {
            const el = allEls[i];
            if (el.textContent.trim() === '⚔️ BATTLE CREATOR' && el.scrollIntoView) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Briefly highlight the card
              const card = el.closest('[style]') || el.parentElement;
              if (card) {
                const orig = card.style.boxShadow || '';
                card.style.boxShadow = '0 0 0 2px #f59e0b, 0 0 24px rgba(245,158,11,0.4)';
                card.style.transition = 'box-shadow 0.3s';
                setTimeout(function () { card.style.boxShadow = orig; }, 2000);
              }
              break;
            }
          }
        } catch (e) {}
      }, 320);
      
      // Re-open battle arena when premium modal closes
      const observer = new MutationObserver(() => {
        const m = document.getElementById('premiumModal');
        if (m && !m.classList.contains('active')) {
          const baModal = document.getElementById('ba-modal');
          if (baModal) {
            baModal.style.display = 'flex';
            baModal.classList.add('open');
          }
          observer.disconnect();
        }
      });
      const premiumModal = document.getElementById('premiumModal');
      if (premiumModal) {
        observer.observe(premiumModal, { attributes: true, attributeFilter: ['class'] });
      }
    },

    /* ── Create Battle Form ── */
    _showCreateForm() {
      if (!isBattleCreator()) { toast('🔒 Battle Creator plan required.'); return; }
      if (!isAdmin() && !canCreateBattle()) {
        // Monthly base used up — show buy-more UI
        const extraCredits = getBattleExtraCredits();
        const maxAllowed = getMaxBattlesPerMonth();
        const body = document.getElementById('ba-body');
        if (body) {
          this._stopPolling();
          body.innerHTML = `
            <button class="ba-promo-btn" style="margin-bottom:14px;" onclick="BA._renderArena()">← Back</button>
            <div style="text-align:center;padding:20px 0 14px;">
              <div style="font-size:36px;margin-bottom:8px;">⚔️</div>
              <div style="font-size:16px;font-weight:800;color:var(--text-primary);margin-bottom:6px;">Monthly Limit Reached</div>
              <div style="font-size:12px;color:rgba(26,26,38,0.55);margin-bottom:16px;line-height:1.6;">
                You've used all ${maxAllowed} battle creations this month.<br>
                Your quota resets on the 1st of next month.
              </div>
              <div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.3);border-radius:12px;padding:12px;margin-bottom:10px;text-align:left;">
                <div style="font-size:12px;font-weight:700;color:#5b46d4;margin-bottom:8px;">⬆️ Upgrade for more battles/month</div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                  <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.04);border-radius:8px;padding:8px 10px;">
                    <span style="font-size:12px;color:var(--text-primary);">⚔️⚔️ Pro — 19 battles/mo</span>
                    <button onclick="if(typeof handlePayment==='function')handlePayment('battle_pro')" style="padding:5px 10px;background:linear-gradient(135deg,#ef4444,#f59e0b);border:none;border-radius:7px;color:var(--text-primary);font-size:11px;font-weight:700;cursor:pointer;">₹299/mo</button>
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(245,158,11,0.06);border-radius:8px;padding:8px 10px;">
                    <span style="font-size:12px;color:var(--text-primary);">⚔️🏆 Academy — 29 battles/mo</span>
                    <button onclick="if(typeof handlePayment==='function')handlePayment('battle_academy')" style="padding:5px 10px;background:linear-gradient(135deg,#f59e0b,#ef4444);border:none;border-radius:7px;color:var(--text-primary);font-size:11px;font-weight:700;cursor:pointer;">₹499/mo</button>
                  </div>
                </div>
              </div>
              <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:14px;padding:16px;margin-bottom:14px;">
                <div style="font-size:13px;font-weight:700;color:#f59e0b;margin-bottom:12px;">⚡ Or Buy Extra Battle Packs</div>
                <div style="display:flex;gap:10px;justify-content:center;">
                  <button onclick="if(typeof handlePayment==='function')handlePayment('battle_extra_10');" style="flex:1;padding:14px 8px;background:rgba(239,68,68,0.12);border:1.5px solid rgba(239,68,68,0.4);border-radius:12px;color:var(--text-primary);font-size:13px;font-weight:700;cursor:pointer;">
                    <div style="font-size:22px;margin-bottom:4px;">⚔️</div>
                    <div>+10 Battles</div>
                    <div style="font-size:18px;font-weight:800;color:#f59e0b;margin-top:4px;">₹49</div>
                    <div style="font-size:10px;color:rgba(26,26,38,0.70);">₹4.9 per battle</div>
                  </button>
                  <button onclick="if(typeof handlePayment==='function')handlePayment('battle_extra_25');" style="flex:1;padding:14px 8px;background:linear-gradient(135deg,rgba(239,68,68,0.16),rgba(245,158,11,0.14));border:2px solid rgba(245,158,11,0.55);border-radius:12px;color:var(--text-primary);font-size:13px;font-weight:700;cursor:pointer;position:relative;">
                    <div style="position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#ef4444,#f59e0b);color:var(--text-primary);font-size:9px;font-weight:800;padding:2px 10px;border-radius:10px;white-space:nowrap;">BEST VALUE</div>
                    <div style="font-size:22px;margin-bottom:4px;">⚔️⚔️</div>
                    <div>+25 Battles</div>
                    <div style="font-size:18px;font-weight:800;color:#f59e0b;margin-top:4px;">₹99</div>
                    <div style="font-size:10px;color:rgba(26,26,38,0.70);">₹3.96 per battle</div>
                  </button>
                </div>
                <div style="margin-top:10px;font-size:11px;color:rgba(26,26,38,0.70);text-align:center;">Credits never expire · Add-ons stack on top of your monthly quota</div>
              </div>
            </div>`;
        }
        return;
      }
      const usage = getBattleCreatorUsage();

      const body = document.getElementById('ba-body');
      if (!body) return;
      this._stopPolling();

      body.innerHTML = `
        <button class="ba-promo-btn" style="margin-bottom:14px;" onclick="BA._renderArena()">← Back</button>
        <div class="ba-section-title">⚔️ Create New Battle</div>
        <input class="ba-input" id="ba-new-name" placeholder="Battle name (e.g. SSC CGL Showdown)" maxlength="40" />
        <select class="ba-select" id="ba-new-exam">
          <optgroup label="── SSC Exams ──">
            <option value="cgl">SSC CGL</option>
            <option value="chsl">SSC CHSL</option>
            <option value="gd">SSC GD Constable</option>
            <option value="mts">SSC MTS</option>
            <option value="cpo">SSC CPO/SI</option>
          </optgroup>
          <optgroup label="── Competitive ──">
            <option value="upsc">UPSC</option>
            <option value="jee">JEE</option>
            <option value="neet">NEET</option>
            <option value="gate">GATE</option>
            <option value="ibps">IBPS PO</option>
            <option value="cat">CAT/MBA</option>
          </optgroup>
          <optgroup label="── Classes ──">
            <option value="class10">Class 10</option>
            <option value="class12_sci">Class 12 Science</option>
            <option value="class12_com">Class 12 Commerce</option>
          </optgroup>
          <optgroup label="── Engineering ──">
            <option value="btech_cs">B.Tech CS</option>
            <option value="btech_ai">B.Tech AI/ML</option>
            <option value="btech_ec">B.Tech ECE</option>
          </optgroup>
          <optgroup label="── General ──">
            <option value="general">General Knowledge</option>
            <option value="reasoning">Logical Reasoning</option>
            <option value="maths">Mathematics</option>
          </optgroup>
        </select>
        <div style="font-size:11px;color:rgba(26,26,38,0.70);margin-bottom:10px;">
          Questions are loaded from the Firebase Storage question bank. Max 10 players per battle.
        </div>
        <div style="margin-bottom:12px;">
              <label style="font-size:11px;color:rgba(26,26,38,0.55);font-weight:600;display:block;margin-bottom:6px;">📝 Number of Questions</label>
              <select id="ba-question-count" style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid rgba(108,99,255,0.3);background:rgba(255,255,255,0.05);color:var(--text-primary);font-size:13px;font-family:'Plus Jakarta Sans',sans-serif;cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;">
                <option value="10">10 Questions (Standard)</option>
                <option value="15">15 Questions</option>
                <option value="20">20 Questions</option>
                <option value="25">25 Questions (Marathon)</option>
              </select>
            </div>
              <button class="ba-create-btn" id="ba-create-go-btn" onclick="BA._createBattle()">
          ⚔️ Create Battle & Go Live
        </button>
        <div id="ba-create-status" style="text-align:center;font-size:12px;color:rgba(26,26,38,0.70);"></div>`;
    },

    async _createBattle() {
      // Check battle creator status with debug info
      if (!isAdmin() && !hasBattlePlan()) { 
        const toast_msg = '🔒 Battle Creator plan required. Get Battle plan to create battles.';
        if (typeof toast === 'function') toast(toast_msg);
        else if (typeof showToast === 'function') showToast(toast_msg);
        return; 
      }
      
      if (!isAdmin() && !canCreateBattle()) {
        const limit_msg = '⛔ No battle creations left this month. Buy more from Premium.';
        if (typeof toast === 'function') toast(limit_msg);
        else if (typeof showToast === 'function') showToast(limit_msg);
        return;
      }

      const nameEl = document.getElementById('ba-new-name');
      const examEl = document.getElementById('ba-new-exam');
      const questionCountEl = document.getElementById('ba-question-count');
      const statusEl = document.getElementById('ba-create-status');
      const btn    = document.getElementById('ba-create-go-btn');

      const name = nameEl?.value?.trim();
      const exam = examEl?.value;
      const questionCount = parseInt(questionCountEl?.value || '10', 10);
      if (!name) { 
        if (typeof toast === 'function') toast('Please enter a battle name.');
        else if (typeof showToast === 'function') showToast('Please enter a battle name.');
        return; 
      }

      if (btn) { btn.disabled = true; btn.textContent = '⚔️ Creating...'; }
      if (statusEl) statusEl.textContent = '⚡ Setting up battle room...';

      const db     = window._firebaseDb;
      const { collection, doc, setDoc } = window._firebaseFns;
      const myUid  = (typeof uid === 'function') ? uid() : (window._firebaseAuth?.currentUser?.uid || 'unknown');
      const myName = (typeof getMyName === 'function') ? getMyName() : ('User_' + Math.random().toString(36).slice(2,7));

      const battleId = 'battle_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
      const battle = {
        id: battleId,
        name,
        exam,
        questionCount: questionCount,
        creatorUid: myUid,
        creatorName: myName,
        players: [myUid],
        playerNames: { [myUid]: myName },
        questions: null,
        status: 'waiting',
        quiz: { current: 0, answers: {}, xp: {}, userProgress: {}, status: 'waiting' },
        createdAt: Date.now(),
        startedAt: null,
        countdownAt: null,
        preGenerating: false,
      };

      try {
        // Write to Firestore with a 6s timeout
        const writePromise = setDoc(doc(collection(db, 'publicBattles'), battleId), battle);
        const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000));
        await Promise.race([writePromise, timeoutPromise]);

        // Deduct quota
        const currentUsage = getBattleCreatorUsage();
        if (!isAdmin() && currentUsage >= MAX_BATTLES_MONTH) {
          useBattleExtraCredit();
        } else {
          incrementBattleUsage();
        }

        const success_msg = '⚔️ Battle room live! AI is preparing questions...';
        if (typeof toast === 'function') toast(success_msg, 3000);
        else if (typeof showToast === 'function') showToast(success_msg, 3000);

        // Schedule auto-delete after 3 hours if battle never completes
        setTimeout(async () => {
          try {
            const { doc: _d3, getDoc: _g3, deleteDoc: _del3 } = window._firebaseFns;
            const _snap3 = await _g3(_d3(window._firebaseDb, 'publicBattles', battleId));
            if (_snap3.exists() && _snap3.data().status !== 'finished') {
              await _del3(_d3(window._firebaseDb, 'publicBattles', battleId));
            }
          } catch(_) {}
        }, 3 * 60 * 60 * 1000);

        // Open room for admin (Firestore doc confirmed written)
        this._openBattle(battleId, battle);

        // Pre-generate questions silently in background
        this._pregenerateQuestions(battleId, exam);

      } catch(e) {
        const err_msg = '❌ Error creating battle: ' + (e?.message || 'Check connection');
        if (typeof toast === 'function') toast(err_msg, 4000);
        else if (typeof showToast === 'function') showToast(err_msg, 4000);
        console.error('[Battle Create Error]', e);
        if (btn) { btn.disabled = false; btn.textContent = '⚔️ Create Battle & Go Live'; }
        if (statusEl) statusEl.textContent = '';
      }
    },

    /* ── Join a battle ── */
    async _joinBattle(battleId) {
      const db = window._firebaseDb;
      const { doc, getDoc, updateDoc, arrayUnion } = window._firebaseFns;
      const myUid = uid();
      const myName = getMyName();

      try {
        // Check battle limit for free users
        if (typeof window.checkBattleAccess === 'function') {
          const access = await window.checkBattleAccess('arena');
          if (!access.allowed) {
            toast(access.reason);
            if (typeof openPremiumModal === 'function') openPremiumModal();
            return;
          }
        }

        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (!snap.exists()) { toast('❌ Battle not found.'); return; }
        const battle = snap.data();

        if ((battle.players || []).length >= MAX_PLAYERS) {
          toast('❌ This battle is full!');
          // Auto-hide the card
          const card = document.getElementById(`ba-card-${battleId}`);
          if (card) {
            card.classList.add('full');
            setTimeout(() => { card.style.transition='opacity 0.5s'; card.style.opacity='0'; setTimeout(()=>card.remove(),500); }, 3000);
          }
          return;
        }

        await updateDoc(doc(db, 'publicBattles', battleId), {
          players: arrayUnion(myUid),
          ['playerNames.' + myUid]: myName
        });

        const updatedPlayers = [...(battle.players||[]), myUid];
        const updatedBattle = { ...battle, players: updatedPlayers, playerNames: { ...(battle.playerNames||{}), [myUid]: myName } };

        this._openBattle(battleId, updatedBattle);

        // Track usage for free users
        if (typeof window.trackBattleUsage === 'function') {
          window.trackBattleUsage('arena');
        }

        // ── Auto-start: slot is now full — the user who filled the last slot
        //    triggers AI generation. Race condition is safe: _generateAndStart
        //    checks for 'generating' status in Firestore first, so only one
        //    client will actually call the AI.
        if (updatedPlayers.length >= MAX_PLAYERS) {
          toast('🔥 Battle slot full! AI is generating questions for all players...', 4000);
          await this._generateAndStart(battleId, battle.exam);
        }

      } catch(e) {
        toast('❌ Could not join battle: ' + (e.message||'Error'));
      }
    },

    _rejoinBattle(battleId) {
      this._activeBattleId = battleId;
      this._pollGameBattle(battleId);
    },

    async _markPlayerReady(battleId) {
      const db = window._firebaseDb;
      const { doc, updateDoc } = window._firebaseFns;
      const myUid = uid();
      
      try {
        await updateDoc(doc(db, 'publicBattles', battleId), {
          ['readyPlayers.' + myUid]: true
        });
      } catch(e) {
        console.error('Error marking player ready:', e);
      }
    },

    async _removePlayerFromBattle(battleId) {
      const db = window._firebaseDb;
      const { doc, updateDoc } = window._firebaseFns;
      const myUid = uid();
      
      try {
        // Set ready status to false when player leaves
        await updateDoc(doc(db, 'publicBattles', battleId), {
          ['readyPlayers.' + myUid]: false
        });
      } catch(e) {
        console.error('Error removing player from battle:', e);
      }
    },

    /* ── Open battle room ── */
    _openBattle(battleId, battleData) {
      this._stopPolling();
      this._activeBattleId = battleId;
      this._lastBattleData = battleData;  // stored so _backToList can check creator
      this._countdownShown = false;  // Reset countdown flag when opening new battle
      this._countdownInProgress = false;  // Reset in-progress flag
      this._lastPollTime = 0;  // Track last poll time for deduplication
      
      // CRITICAL: Initialize battle state
      battleState.currentBattleId = battleId;
      battleState.status = battleData.status || 'waiting';
      battleState.hasStarted = ['countdown', 'active'].includes(battleData.status);
      battleState.lastQuestionIndex = -1;
      
      this._renderBattleRoom(battleData);
      // Mark this player as ready when entering the battle room
      this._markPlayerReady(battleId);
      
      // REQ #2: Use unified PollingController (single polling loop guarantee)
      StateManager.currentBattleId = battleId;
      StateManager.currentQuestionIndex = 0;
      StateManager.answerLocked = false;
      StateManager.syncVersion = 0;
      StateManager.cachedBattleVersion = -1;
      
      const pollMs = battleData.status === 'waiting' ? POLL_WAITING_ROOM : POLL_ACTIVE_GAME;
      PollingController.start(battleId, (bid) => this._pollGameBattle(bid), pollMs);
    },

    async _pollGameBattle(battleId) {
      // OPTIMIZATION: Skip poll if one just completed
      const now = Date.now();
      if (now - this._lastPollTime < 80) return;
      this._lastPollTime = now;

      const db = window._firebaseDb;
      const { doc } = window._firebaseFns;
      
      // CRITICAL FIX v3.2.6: Cache questions to prevent re-fetching from Firestore
      // Only fetch quiz data (answers, xp, progress) - NOT questions
      if (!this._cachedBattle) this._cachedBattle = {};
      
      try {
        const snap = await dedupGetDoc(doc(db, 'publicBattles', battleId));
        if (!snap.exists()) return;
        const data = snap.data();

        // CACHE questions once (never re-fetch from Firestore)
        if (data.questions && data.questions.length > 0 && !this._cachedBattle.questions) {
          this._cachedBattle.questions = data.questions;
          console.info('[Battle] Questions cached in memory - no more Firebase reads for questions');
        }
        
        // Use cached questions, don't fetch fresh ones
        if (this._cachedBattle.questions && this._cachedBattle.questions.length > 0) {
          data.questions = this._cachedBattle.questions;
        }

        // Update battle state
        battleState.update(battleId, data.status);

        // ADAPTIVE POLLING: Switch intervals based on status
        if (data.status === 'waiting' && this._pollGameInterval) {
          clearInterval(this._pollGameInterval);
          this._pollGameInterval = setInterval(() => this._pollGameBattle(battleId), POLL_WAITING_ROOM);
        } else if ((data.status === 'active' || data.status === 'countdown') && this._pollGameInterval) {
          clearInterval(this._pollGameInterval);
          // FIX v3.2.5: Faster polling (300ms) during active battle for instant question load
          this._pollGameInterval = setInterval(() => this._pollGameBattle(battleId), 300);
        }

        if (data.status === 'generating') {
          this._renderGeneratingScreen();
        } else if (data.status === 'countdown') {
          if (!this._countdownShown && !this._countdownInProgress) {
            this._handleCountdown(data, battleId);
          }
        } else if (data.status === 'active') {
          // Remove countdown overlay if still visible
          const overlay = document.getElementById('ba-countdown-overlay');
          if (overlay) overlay.remove();
          
          this._countdownShown = false;
          this._countdownInProgress = false;
          
          if (!data.questions || data.questions.length === 0) {
            // FIX v3.2.5: Faster retry (300ms) when questions not ready
            setTimeout(() => this._pollGameBattle(battleId), 300);
            return;
          }
          
          // CHECK USER'S INDIVIDUAL PROGRESS instead of global current
          const myUid = uid();
          const userProgress = (data.quiz && data.quiz.userProgress && data.quiz.userProgress[myUid]) || 0;
          
          // CRITICAL FIX: Skip render if progress hasn't changed
          if (this._lastRenderedQi === userProgress && this._answerSubmitting) {
            return;  // Don't re-render while answer is being submitted
          }
          
          if (this._lastRenderedQi !== userProgress) {
            this._lastRenderedQi = userProgress;
            this._lastRenderHash = null;
            this._renderDebounceTime = 0;
            this._stopQuestionTimer();
          }
          
          // Check if this user finished all questions
          if (userProgress >= data.questions.length) {
            this._stopPolling();
            this._stopQuestionTimer();
            this._countdownShown = false;
            this._countdownInProgress = false;
            this._lastRenderHash = null;
            this._activeTimers = this._activeTimers || {};
            if (this._activeTimers[battleId]) {
              clearInterval(this._activeTimers[battleId].intervalId);
              delete this._activeTimers[battleId];
            }
            this._renderBattleWinner(data);
            return;
          }
          
          // Render active quiz
          if (battleState.shouldRender()) {
            this._renderActiveQuiz(data);
          }
        } else if (data.status === 'finished' || data.status === 'ended') {
          this._stopPolling();
          this._stopQuestionTimer();
          this._countdownShown = false;
          this._countdownInProgress = false;
          this._lastRenderHash = null;
          this._renderBattleWinner(data);
        } else {
          // Reset countdown flag if we go back to waiting/other status
          this._countdownShown = false;
          this._countdownInProgress = false;
          // CRITICAL: Only render waiting room if battle hasn't started
          if (!battleState.hasStarted) {
            this._renderBattleRoom(data);
          }
        }
      } catch(e) {}
    },

    /* ── Per-question 30s countdown timer ── */
    _questionTimer: null,
    _questionTimerQi: -1,

    /* ── Generating screen shown to all players while AI works ── */
    _genScreenStart: null,
    _genTimerInterval: null,
    _renderGeneratingScreen() {
      if (!this._activeBattleId) return;
      const body = document.getElementById('ba-body');
      if (!body) return;

      // Only inject HTML once so the timer element can update in-place
      if (!document.getElementById('ba-gen-elapsed')) {
        this._genScreenStart = Date.now();
        body.innerHTML = `
          <div style="text-align:center;padding:48px 16px;">
            <div class="ba-spinner" style="width:48px;height:48px;border-width:4px;margin:0 auto 20px;"></div>
            <div style="font-size:20px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">⏳ Loading questions from question bank...</div>
            <div style="font-size:13px;color:rgba(26,26,38,0.55);line-height:1.6;">
              Preparing ${QUESTIONS_PER_BATTLE} questions for this battle.<br>
              All players will receive the <strong style="color:#5b46d4;">same questions</strong> at the same time.
            </div>
            <div id="ba-gen-elapsed" style="margin-top:14px;font-size:13px;color:rgba(26,26,38,0.70);">⏱ Working... 0s</div>
            <div id="ba-gen-hint" style="margin-top:8px;font-size:12px;color:rgba(26,26,38,0.65);min-height:18px;"></div>
          </div>`;

        // Live elapsed counter
        if (this._genTimerInterval) clearInterval(this._genTimerInterval);
        this._genTimerInterval = setInterval(() => {
          const el = document.getElementById('ba-gen-elapsed');
          const hint = document.getElementById('ba-gen-hint');
          if (!el) { clearInterval(this._genTimerInterval); return; }
          const secs = Math.floor((Date.now() - this._genScreenStart) / 1000);
          el.textContent = `⏱ Working... ${secs}s`;
          if (hint) {
            if (secs >= 30) hint.textContent = '☕ AI server is warming up — almost there!';
            else if (secs >= 15) hint.textContent = '🔄 Taking a bit longer than usual, please wait...';
            else hint.textContent = 'This usually takes 5–20 seconds.';
          }
        }, 1000);
      }
    },

    _renderBattleRoom(battle) {
      if (!this._activeBattleId) return;
      const body = document.getElementById('ba-body');
      if (!body) return;

      const myUid = uid();
      const isCreator = battle.creatorUid === myUid;
      
      // Show ALL players in the battle (players array), not just ready ones
      const allPlayers = (battle.players || []);
      const playerCount = allPlayers.length;
      
      // Get names for ALL players
      let playerNames = battle.playerNames ? { ...battle.playerNames } : {};
      const myName = getMyName() || 'Player';
      if (!playerNames[myUid]) {
        playerNames[myUid] = myName;
      }
      
      // Get display names for all players in the battle
      const displayNames = allPlayers.map(uid => playerNames[uid] || 'Player');

      if (battle.status === 'generating') {
        this._renderGeneratingScreen();
        return;
      }

      if (battle.status === 'waiting') {
        // Waiting room - shows all players who joined
        const slotsLeft = MAX_PLAYERS - playerCount;
        body.innerHTML = `
          <button class="ba-promo-btn" style="margin-bottom:14px;" onclick="BA._backToList()">← Leave</button>
          <div style="text-align:center;padding:16px 0 8px;">
            <div style="font-size:32px;margin-bottom:8px;">⚔️</div>
            <div style="font-size:18px;font-weight:800;color:var(--text-primary);margin-bottom:4px;">${battle.name || 'Quiz Battle'}</div>
            <div style="font-size:12px;color:rgba(26,26,38,0.70);">📚 ${battle.exam || 'General'}</div>
          </div>
          <div style="background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:12px;padding:14px;margin:12px 0;text-align:center;">
            <div style="font-size:13px;color:#4ade80;font-weight:700;">🟢 Waiting for players...</div>
            <div style="font-size:12px;color:rgba(26,26,38,0.70);margin-top:4px;">${playerCount}/${MAX_PLAYERS} joined · ${slotsLeft} slots left</div>
          </div>
          <div class="ba-section-title">👥 Players Joined (${playerCount}/${MAX_PLAYERS})</div>
          <div class="ba-players-list" style="display:flex;flex-wrap:wrap;gap:8px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.02);">
            ${displayNames.map((n, idx) => {
              const playerUid = allPlayers[idx];
              const isMine = playerUid === myUid;
              return `<div style="display:inline-block;padding:10px 14px;margin:2px;background:${isMine ? 'rgba(108,99,255,0.2)' : 'rgba(108,99,255,0.12)'};border:1.5px solid ${isMine ? 'rgba(108,99,255,0.4)' : 'rgba(108,99,255,0.2)'};border-radius:12px;color:var(--text-primary);font-size:12px;font-weight:600;">
                ${n}${isMine ? '<span style="font-size:10px;margin-left:6px;opacity:0.7;">(You)</span>' : ''}
              </div>`;
            }).join('')}
          </div>
          ${(() => {
            if (isCreator) {
              const questionsReady = battle.questions && battle.questions.length >= QUESTIONS_PER_BATTLE;
              const preGenerating = battle.preGenerating;
              const btnLabel = questionsReady
                ? '🚀 Start Battle Now! (' + playerCount + ' ready)'
                : '⚔️ Start Battle (' + playerCount + ' ready)';
              const statusLine = questionsReady
                ? '<div style="font-size:11px;color:#4ade80;text-align:center;margin-top:6px;">✅ Questions ready — battle starts instantly!</div>'
                : preGenerating
                ? '<div style="font-size:11px;color:#5b46d4;text-align:center;margin-top:6px;"><span class="ba-spinner" style="width:10px;height:10px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:4px;"></span>AI preparing questions in background...</div>'
                : '<div style="font-size:11px;color:rgba(26,26,38,0.70);text-align:center;margin-top:6px;">Battle auto-starts when all ' + MAX_PLAYERS + ' slots are filled.</div>';
              const bid = BA._activeBattleId || battle.id || '';
              return '<button class="ba-create-btn" onclick="BA._startCountdown(\'' + bid + '\')">' + btnLabel + '</button>' + statusLine;
            } else {
              return '<div style="text-align:center;padding:16px;color:rgba(26,26,38,0.70);font-size:13px;">⏳ Waiting for the battle creator to start...<br><span style="font-size:11px;opacity:0.6;">Battle also auto-starts when all ' + MAX_PLAYERS + ' slots are filled.</span></div>';
            }
          })()}`;

      } else if (battle.status === 'active') {
        this._renderActiveQuiz(battle);
      }
    },

    /* ── Start countdown (creator / admin only) ── */
    async _startCountdown(battleId) {
      if (!battleId) { toast('❌ Battle ID missing — please recreate the battle.'); return; }
      
      // Prevent double-trigger by checking if countdown/active already happening
      if (this._countdownShown || this._countdownInProgress) {
        toast('⏳ Countdown already in progress...', 2000);
        return;
      }
      
      const db = window._firebaseDb;
      const { doc, getDoc, updateDoc } = window._firebaseFns;

      // Disable the start button immediately to prevent double-clicks
      const startBtn = document.querySelector('.ba-create-btn');
      if (startBtn) { startBtn.disabled = true; startBtn.textContent = '⏳ Starting...'; }

      try {
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (!snap.exists()) {
          toast('❌ Battle room not found in database. Please recreate.', 4000);
          if (startBtn) { startBtn.disabled = false; startBtn.textContent = '⚔️ Start Battle'; }
          return;
        }
        const battle = snap.data();

        // If already generating/countdown/active/finished — do not double-trigger
        if (['generating','countdown','active','finished'].includes(battle.status)) {
          toast('Battle already started!', 2000);
          if (startBtn) { startBtn.disabled = false; startBtn.textContent = '⚔️ Start Battle'; }
          return;
        }

        // ── FAST PATH: questions already pre-generated in background ──
        if (battle.questions && battle.questions.length >= QUESTIONS_PER_BATTLE) {
          toast('🚀 Starting battle!', 2000);
          await updateDoc(doc(db, 'publicBattles', battleId), {
            status: 'countdown',
            countdownAt: Date.now()
          });
          // Pass creatorUid in battle data
          this._handleCountdown({ ...battle, creatorUid: battle.creatorUid, countdownAt: Date.now() }, battleId);
          return;
        }

        // ── SLOW PATH: questions not ready yet — generate now ──
        toast('⏳ Generating questions... almost ready!', 3000);
        await this._generateAndStart(battleId, battle.exam);
      } catch(e) {
        console.error('_startCountdown error:', e);
        toast('❌ Could not start: ' + (e.message || 'Check connection'));
        if (startBtn) { startBtn.disabled = false; startBtn.textContent = '⚔️ Start Battle'; }
        // Reset countdown flags on error
        this._countdownShown = false;
        this._countdownInProgress = false;
      }
    },

    /* ── Silent background pre-generation — called at room creation ── */
    async _pregenerateQuestions(battleId, exam) {
      // Runs silently — no UI changes. Just fills questions[] in Firestore
      // so _startCountdown can use the fast path.
      try {
        const db = window._firebaseDb;
        const { doc, getDoc, updateDoc } = window._firebaseFns;

        // Mark as pre-generating (custom internal flag, not changing visible status)
        await updateDoc(doc(db, 'publicBattles', battleId), { preGenerating: true });

        // FIXED: Fetch battle document to get questionCount (was undefined before)
        const battleSnap = await getDoc(doc(db, 'publicBattles', battleId));
        const battleData = battleSnap.exists() ? battleSnap.data() : {};
        const _qCount = (battleData && battleData.questionCount) ? battleData.questionCount : QUESTIONS_PER_BATTLE;
        const _seed = 'real_' + (battleId||'b') + '_' + Date.now();
        const questions = await _generateBattleQuestions(exam, _qCount, _seed);

        if (questions && questions.length > 0) {
          // Write questions but keep status as 'waiting' — room stays open for joins
          await updateDoc(doc(db, 'publicBattles', battleId), {
            questions,
            preGenerating: false
          });
          // Flash a subtle indicator for the creator
          try { if (typeof showToast === 'function') showToast('✅ Questions ready! Hit Start anytime.', 3000); } catch(e) {}
        } else {
          // Pre-gen failed silently — _startCountdown slow path will handle it
          await updateDoc(doc(db, 'publicBattles', battleId), { preGenerating: false });
        }
      } catch(e) {
        // Swallow — slow path in _startCountdown is the fallback
      }
    },

    /* ── Core: generate questions via DeepSeek, write to Firestore, then begin countdown ── */
    async _generateAndStart(battleId, examHint) {
      const db = window._firebaseDb;
      const { doc, getDoc, updateDoc } = window._firebaseFns;

      try {
        // Race guard: mark status 'generating' — if another client already did this, abort.
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (!snap.exists()) return;
        const battle = snap.data();

        // If already generating/countdown/active/finished — do not call AI again
        if (['generating','countdown','active','finished'].includes(battle.status)) return;

        // Claim the generation slot
        await updateDoc(doc(db, 'publicBattles', battleId), { status: 'generating' });

        const exam = examHint || battle.exam;
        const _qCount = (typeof battle !== 'undefined' && battle.questionCount) ? battle.questionCount : QUESTIONS_PER_BATTLE;
        const _seed = 'real_' + (battleId||'b') + '_' + Date.now();
        const questions = await _generateBattleQuestions(exam, _qCount, _seed);

        if (!questions || questions.length === 0) {
          // Revert so creator can retry
          await updateDoc(doc(db, 'publicBattles', battleId), { status: 'waiting' });
          toast('❌ AI question generation failed. Creator can retry starting the battle.', 4000);
          return;
        }

        // Write questions + kick off countdown — all players see identical questions
        await updateDoc(doc(db, 'publicBattles', battleId), {
          questions,
          status: 'countdown',
          countdownAt: Date.now()
        });

        // Show countdown on this client immediately
        this._handleCountdown({ ...battle, questions, countdownAt: Date.now(), creatorUid: battle.creatorUid }, battleId);

      } catch(e) {
        toast('❌ Could not start battle: ' + (e.message || 'Error'));
        try {
          const { doc, updateDoc } = window._firebaseFns;
          await updateDoc(doc(window._firebaseDb, 'publicBattles', battleId), { status: 'waiting' });
        } catch(_) {}
      }
    },

    /* ── Countdown 3-2-1 overlay ── */
    _countdownShown: false,
    _countdownLastShownAt: 0,
    _countdownInProgress: false,
    _countdownAnimationFrameId: null,
    _handleCountdown(data, battleId) {
      // CRITICAL FIX v3.2.5: Check DOM FIRST (atomic operation)
      if (document.getElementById('ba-countdown-overlay')) {
        console.warn('[Countdown] Overlay already exists in DOM, preventing duplicate');
        return;
      }
      if (this._countdownShown) return;
      if (this._countdownInProgress) return;
      
      this._countdownShown = true;
      this._countdownInProgress = true;
      this._activeBattleId = battleId;

      // PAUSE the poll interval while countdown is running
      if (this._pollGameInterval) {
        clearInterval(this._pollGameInterval);
        this._pollGameInterval = null;
      }

      // Create overlay with unique ID for DOM verification
      const overlay = document.createElement('div');
      overlay.className = 'ba-countdown-overlay';
      overlay.id = 'ba-countdown-overlay';
      overlay.style.zIndex = '999999';
      overlay.innerHTML = `
        <div class="ba-countdown-num" id="ba-cdown-num">3</div>
        <div class="ba-countdown-label">Get ready to battle!</div>`;
      document.body.appendChild(overlay);

      let count = 3;
      const numEl = overlay.querySelector('#ba-cdown-num');
      const countdownStartTime = data.countdownAt || Date.now();
      const countdownEndTime = countdownStartTime + 4000;
      let tickRunning = true;

      const tick = async () => {
        if (!tickRunning) return;
        const remaining = Math.max(0, countdownEndTime - Date.now());
        const countValue = remaining > 3000 ? 3 : (remaining > 2000 ? 2 : (remaining > 1000 ? 1 : 0));
        
        if (remaining > 0) {
          if (countValue > 0 && countValue !== count && numEl) {
            count = countValue;
            numEl.textContent = count;
            numEl.style.animation = 'none';
            void numEl.offsetWidth;
            numEl.style.animation = 'ba-countpop 0.6s ease';
          }
          this._countdownAnimationFrameId = requestAnimationFrame(tick);
        } else {
          tickRunning = false;
          if (numEl) {
            numEl.textContent = 'GO!';
            numEl.style.animation = 'none';
            void numEl.offsetWidth;
            numEl.style.animation = 'ba-countpop 0.6s ease';
          }
          
          // CRITICAL FIX v3.2.5: Clear flags IMMEDIATELY
          this._countdownShown = false;
          this._countdownInProgress = false;
          
          const myUid = uid();
          const creatorUid = data.creatorUid || null;
          
          if (creatorUid && creatorUid === myUid) {
            const db = window._firebaseDb;
            const { doc, updateDoc } = window._firebaseFns;
            
            let updateSuccess = false;
            let updateAttempts = 0;
            const maxAttempts = 3;
            
            while (updateAttempts < maxAttempts && !updateSuccess) {
              try {
                updateAttempts++;
                
                const questionsArray = Array.isArray(data.questions) ? data.questions : [];
                
                await updateDoc(doc(db, 'publicBattles', battleId), {
                  status: 'active',
                  startedAt: Date.now()
                });
                
                await new Promise(r => setTimeout(r, 50));
                
                await updateDoc(doc(db, 'publicBattles', battleId), {
                  questions: questionsArray,
                  quiz: {
                    status: 'active',
                    current: 0,
                    answers: {},
                    xp: {},
                    userProgress: {},
                    questionStartedAt: Date.now()
                  }
                });
                
                updateSuccess = true;
                console.info('[Countdown] ✅ Battle activated (attempt ' + updateAttempts + ')');
                
              } catch(err) {
                console.error('[Countdown] ⚠️ Attempt ' + updateAttempts + ':', err.message);
                if (['permission-denied', 'resource-exhausted', 'invalid-argument'].includes(err.code)) {
                  updateAttempts = maxAttempts;
                } else if (updateAttempts < maxAttempts) {
                  await new Promise(r => setTimeout(r, 150));
                }
              }
            }
          }
          
          // FIX v3.2.5: Instant render + immediate next question
          setTimeout(async () => {
            if (overlay && overlay.parentNode) {
              overlay.remove();
            }
            
            // CRITICAL FIX v3.2.6: Ensure data has proper quiz and startedAt before rendering
            try {
              const db = window._firebaseDb;
              const { doc, getDoc } = window._firebaseFns;
              
              // Fetch fresh battle data to ensure we have latest quiz state
              const freshSnap = await getDoc(doc(db, 'publicBattles', battleId));
              if (freshSnap.exists()) {
                const freshData = freshSnap.data();
                
                // Ensure all required properties exist with proper defaults
                const completeData = {
                  ...data,
                  ...freshData,
                  id: battleId,
                  startedAt: freshData.startedAt || data.startedAt || Date.now(),
                  quiz: freshData.quiz || data.quiz || {
                    status: 'active',
                    current: 0,
                    answers: {},
                    xp: {},
                    userProgress: {},
                    questionStartedAt: freshData.startedAt || data.startedAt || Date.now()
                  },
                  questions: freshData.questions || data.questions || []
                };
                
                // Ensure quiz has all required fields
                if (completeData.quiz) {
                  completeData.quiz.answers = completeData.quiz.answers || {};
                  completeData.quiz.xp = completeData.quiz.xp || {};
                  completeData.quiz.userProgress = completeData.quiz.userProgress || {};
                  completeData.quiz.questionStartedAt = completeData.quiz.questionStartedAt || completeData.startedAt || Date.now();
                  completeData.quiz.status = completeData.quiz.status || 'active';
                }
                
                // CRITICAL: Render immediately without polling wait
                this._lastRenderedQi = -1;
                this._lastRenderHash = null;
                this._renderActiveQuiz(completeData);
              } else {
                // Fallback if fresh fetch fails
                this._lastRenderedQi = -1;
                this._lastRenderHash = null;
                this._renderActiveQuiz(data);
              }
            } catch (err) {
              console.error('[Countdown] Error fetching fresh data:', err);
              // Fallback to original data if fetch fails
              this._lastRenderedQi = -1;
              this._lastRenderHash = null;
              this._renderActiveQuiz(data);
            }
            
            // Resume polling with faster interval
            setTimeout(() => {
              if (!this._pollGameInterval && this._activeBattleId) {
                this._pollGameInterval = setInterval(() => this._pollGameBattle(battleId), 300);
              }
            }, 50);
          }, 650);
        }
      };

      this._countdownAnimationFrameId = requestAnimationFrame(tick);
    },

    /* ── Active Quiz UI ── */
    _renderActiveQuiz(battle) {
      const body = document.getElementById('ba-body');
      if (!body) return;

      // CRITICAL FIX v3.2.6: Ensure all required battle/quiz properties exist with safe defaults
      if (!battle) {
        console.warn('[_renderActiveQuiz] Battle object is null/undefined');
        return;
      }
      
      // Ensure battle has required properties
      battle.id = battle.id || this._activeBattleId;
      battle.startedAt = battle.startedAt || Date.now();
      battle.questions = battle.questions || [];
      
      // Ensure quiz object exists and has all required fields
      let quiz = battle.quiz || {};
      if (!quiz || typeof quiz !== 'object') {
        quiz = {};
      }
      
      // Initialize missing quiz properties with safe defaults
      quiz.status = quiz.status || 'active';
      quiz.current = quiz.current !== undefined ? quiz.current : 0;
      quiz.answers = quiz.answers || {};
      quiz.xp = quiz.xp || {};
      quiz.userProgress = quiz.userProgress || {};
      quiz.questionStartedAt = quiz.questionStartedAt || battle.startedAt || Date.now();
      
      // Update battle.quiz reference
      battle.quiz = quiz;
      
      const myUid = uid();
      
      // FIX: Use ONLY this user's individual progress, NOT global question index
      const userProgress = (quiz.userProgress && quiz.userProgress[myUid]) || 0;
      const qi = userProgress;
      const questions = battle.questions || [];
      
      // Check if THIS USER finished
      if (qi >= questions.length) {
        this._stopPolling();
        this._stopQuestionTimer();
        this._renderBattleWinner(battle);
        return;
      }
      
      // Ensure questions exist before proceeding
      if (!questions || !Array.isArray(questions) || questions.length === 0) {
        body.innerHTML = `
          <div style="text-align:center;padding:48px 16px;">
            <div class="ba-spinner" style="width:48px;height:48px;border-width:4px;margin:0 auto 20px;"></div>
            <div style="font-size:18px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">⏳ Loading questions...</div>
            <div style="font-size:13px;color:rgba(26,26,38,0.55);">Your battle is starting now</div>
          </div>`;
        setTimeout(() => this._pollGameBattle(battle.id || this._activeBattleId), 300);
        return;
      }
      
      const q = questions[qi];
      if (!q) { this._renderBattleWinner(battle); return; }

      // Check THIS USER's specific answer
      const myAnswerKey = 'user_' + myUid + '_q' + String(qi);
      const answered = (quiz.answers && quiz.answers[myAnswerKey]) || null;

      const battleId = battle.id || this._activeBattleId;
      // CRITICAL FIX v3.2.6: Ensure questionStartedAt is always defined with proper fallback chain
      const questionStartedAt = quiz.questionStartedAt !== undefined ? quiz.questionStartedAt : 
                               (battle.startedAt !== undefined ? battle.startedAt : Date.now());

      // AGGRESSIVE DEBOUNCE v3.2.5: Skip render if nothing important changed
      const now = Date.now();
      if (!this._renderDebounceTime) this._renderDebounceTime = 0;
      
      const renderHash = myUid + '|' + qi + '|' + (answered ? 'answered' : 'open');
      const hashChanged = this._lastRenderHash !== renderHash;
      const questionChanged = this._lastQuestionIndex !== qi;
      const timeSinceRender = now - this._renderDebounceTime;
      
      // CRITICAL FIX: Skip full re-render if nothing changed and timer exists
      if (!hashChanged && !questionChanged && timeSinceRender < 200 && document.getElementById('ba-qtimer-fill')) {
        // Only update XP pill (lightweight)
        const xpPill = document.querySelector('.ba-quiz-xp-pill');
        if (xpPill) xpPill.textContent = '⚡ ' + (quiz.xp && quiz.xp[myUid] ? quiz.xp[myUid] : 0) + ' XP';
        return;
      }
      
      // Mark as rendered
      this._lastRenderHash = renderHash;
      this._lastQuestionIndex = qi;
      this._renderDebounceTime = now;

      // Calculate progress percentage
      const progressPct = ((qi + 1) / questions.length) * 100;
      const questionIndicators = questions.map((_, idx) => {
        let status = idx < qi ? 'done' : idx === qi ? 'active' : 'pending';
        // FIX: Check THIS USER's answer for this question
        const userKey = 'user_' + myUid + '_q' + String(idx);
        if (quiz.answers && quiz.answers[userKey]) status = 'answered';
        return `<div class="ba-q-indicator ${status}" title="Q ${idx+1}"></div>`;
      }).join('');

      const isCreator = battle.creatorUid === myUid;

      body.innerHTML = `
        <div class="ba-active-wrap" style="will-change:auto;backface-visibility:hidden;">
          <div class="ba-quiz-header">
            <span class="ba-quiz-num-pill">Q ${qi+1} <span style="opacity:0.5;">/ ${questions.length}</span></span>
            <span class="ba-quiz-xp-pill">⚡ ${quiz.xp && quiz.xp[myUid] ? quiz.xp[myUid] : 0} XP</span>
            <span class="ba-quiz-xp-pill" data-battle-timer style="background:linear-gradient(135deg,#ef4444,#dc2626);margin-left:8px;">⏱️ 5:00</span>
            ${isCreator ? `<button class="ba-end-battle-btn" onclick="BA._endBattleNow('${battleId}')" style="background:linear-gradient(135deg,#ef4444,#dc2626);border:none;border-radius:8px;padding:5px 12px;color:white;font-size:11px;font-weight:700;cursor:pointer;margin-left:auto;">🛑 End Battle</button>` : ''}
          </div>
          <div style="display:flex;gap:4px;margin-bottom:12px;align-items:center;">
            <div class="ba-quiz-bar"><div class="ba-quiz-bar-fill" style="width:${progressPct}%;transition:width 0.3s ease;will-change:width;"></div></div>
            <span style="font-size:10px;color:rgba(26,26,38,0.70);font-weight:700;min-width:26px;text-align:right;">${Math.round(progressPct)}%</span>
          </div>
          <div class="ba-q-indicators">${questionIndicators}</div>
          <div class="ba-quiz-timer-wrap">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-size:10px;font-weight:700;letter-spacing:0.06em;color:rgba(26,26,38,0.65);text-transform:uppercase;">⏱ Time</span>
              <span id="ba-qtimer-label" style="font-size:11px;font-weight:800;color:rgba(26,26,38,0.70);">${QUESTION_TIME}s</span>
            </div>
            <div class="ba-quiz-timer-bar"><div id="ba-qtimer-fill" class="ba-quiz-timer-fill" style="width:100%;transition:width 0.1s linear;will-change:width;"></div></div>
          </div>
          <div class="ba-quiz-q-card ba-q-fadeIn"><div class="ba-quiz-q-label">Question</div><div class="ba-quiz-q">${q.q}</div></div>
          <div class="ba-quiz-opts" style="pointer-events:${answered ? 'none' : 'auto'};">
            ${q.opts.map((o,j) => {
              let cls = 'ba-quiz-opt';
              if (answered) {
                if (j === q.ans) cls += ' correct';
                else if (j === (answered.chosen) && j !== q.ans) cls += ' wrong';
                else cls += ' dim';
              }
              return `<button class="${cls}" ${answered ? 'disabled' : ''} style="transition:all 0.2s ease;"
                onclick="${answered ? '' : `BA._submitAnswer('${battleId}',${qi},${j})`}">
                <span class="ba-opt-letter">${String.fromCharCode(65+j)}</span>
                <span class="ba-opt-text">${o}</span>
              </button>`;
            }).join('')}
          </div>
          ${answered
            ? `<div class="ba-quiz-answered-banner ${answered.correct ? 'correct' : 'wrong'}" style="animation:ba-pop-in 0.3s ease;">
                ${answered.correct ? '✅ Correct! <b>+10 XP</b>' : '❌ Wrong! <b>-3 XP</b>'} 
                ${answered.correct ? '' : `<br><small>Answer: <b>${q.opts[q.ans] || ''}</b></small>`}
              </div>
              <div class="ba-quiz-exp">💡 ${q.exp || 'Great work!'}</div>`
            : `<div class="ba-quiz-waiting"><div class="ba-quiz-waiting-text">⏱️ Take your time!</div><div class="ba-quiz-waiting-sub">Answer correctly to earn +10 XP</div></div>`
          }
          ${this._renderXPBoard(quiz, battle.playerNames)}
        </div>`;

      // Start or continue the 30-second question timer (skip if already answered)
      if (!answered) {
        this._startQuestionTimer(battleId, qi, questionStartedAt);
      } else {
        this._stopQuestionTimer();
      }
    },

    _renderXPBoard(quiz, playerNames) {
      // Build entries from ALL joined players (playerNames), not just those with XP
      const xp = quiz.xp || {};
      const names = playerNames || {};
      // Merge: all named players, defaulting XP to 0
      const allEntries = Object.entries(names).map(([u, name]) => [u, xp[u] || 0]);
      // Also include anyone who has XP but might not be in playerNames
      Object.entries(xp).forEach(([u, x]) => { if (!names[u]) allEntries.push([u, x]); });
      // Sort by XP descending
      allEntries.sort((a,b) => b[1]-a[1]);
      if (!allEntries.length) return '';
      
      const myUid = uid();
      const hash = JSON.stringify(allEntries);
      
      // OPTIMIZATION: Only render if XP board actually changed
      if (this._lastXPBoardHash === hash && document.querySelector('.ba-xp-board')) {
        return '';  // Skip re-render
      }
      this._lastXPBoardHash = hash;
      
      return `<div class="ba-xp-board" style="will-change:auto;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:rgba(26,26,38,0.70);text-transform:uppercase;margin-bottom:8px;">⚡ Live XP Board</div>
        ${allEntries.map(([u,x],i) => `
          <div class="ba-xp-row ${u===myUid?'me':''}">
            <span class="ba-xp-rank">${['🥇','🥈','🥉'][i]||'#'+(i+1)}</span>
            <span class="ba-xp-name">${(names[u])||'Player'}</span>
            <span class="ba-xp-val">${x} XP</span>
          </div>`).join('')}
      </div>`;
    },

    /* ── 15-second per-question countdown (professional timing) ── */
    _stopQuestionTimer() {
      if (this._questionTimer) {
        cancelAnimationFrame(this._questionTimer);
        clearInterval(this._questionTimer);
        this._questionTimer = null;
      }
      this._questionTimerQi = -1;
    },

    _startQuestionTimer(battleId, qi, questionStartedAt) {
      // Don't restart if already running for same question
      if (this._questionTimerQi === qi && this._questionTimer) return;
      this._stopQuestionTimer();
      this._questionTimerQi = qi;

      const startMs = questionStartedAt || Date.now();
      let lastRenderedValue = QUESTION_TIME;

      const tick = () => {
        const now = Date.now();
        const elapsedMs = now - startMs;
        const elapsed = Math.floor(elapsedMs / 1000);
        // FIX: Ensure remaining time never goes below 0 prematurely
        const remaining = Math.max(0, QUESTION_TIME - elapsed);
        const pct = remaining > 0 ? (remaining / QUESTION_TIME) * 100 : 0;

        // OPTIMIZATION: Only update DOM if value actually changed
        if (remaining !== lastRenderedValue) {
          lastRenderedValue = remaining;
          
          const fill = document.getElementById('ba-qtimer-fill');
          const label = document.getElementById('ba-qtimer-label');
          if (fill) fill.style.width = pct + '%';
          if (label) {
            label.textContent = remaining + 's';
            label.style.color = remaining <= 5 ? '#ef4444' : remaining <= 10 ? '#f59e0b' : 'rgba(200,195,255,0.5)';
          }
        }

        // FIX: Only skip when remaining is exactly 0, not before
        if (remaining <= 0 && elapsedMs >= QUESTION_TIME * 1000) {
          this._stopQuestionTimer();
          // Auto-skip: only the creator/first player advances the question in Firestore
          // We use a lock key so only one client fires the skip
          const skipKey = 'ba_skip_' + battleId + '_q' + qi;
          if (!sessionStorage.getItem(skipKey)) {
            sessionStorage.setItem(skipKey, '1');
            this._autoSkipQuestion(battleId, qi);
          }
        } else {
          // OPTIMIZATION: Use requestAnimationFrame for smooth 60fps updates
          this._questionTimer = requestAnimationFrame(tick);
        }
      };

      tick(); // immediate first render
    },

    async _autoSkipQuestion(battleId, qi) {
      try {
        const db = window._firebaseDb;
        const { doc, getDoc, updateDoc } = window._firebaseFns;
        const myUid = uid();
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (!snap.exists()) return;
        const battle = snap.data();
        const quiz = battle.quiz || {};
        
        // Get user's current progress
        const userProgress = (quiz.userProgress && quiz.userProgress[myUid]) || 0;
        // Only skip if this user is still on this question
        if (userProgress !== qi) return;
        
        const nextIdx = qi + 1;
        const isLast = nextIdx >= (battle.questions || []).length;
        const myName = getMyName();
        
        // Auto-answer with wrong answer for this user
        const updates = {
          ['quiz.answers.' + 'user_' + myUid + '_q' + String(qi)]: 
            { uid: myUid, name: myName, chosen: -1, correct: false, ts: Date.now() },
          ['quiz.xp.' + myUid]: (quiz.xp && quiz.xp[myUid]) ? quiz.xp[myUid] - 3 : -3,
          ['quiz.userProgress.' + myUid]: isLast ? qi : nextIdx,
          ['quiz.status']: 'active',
        };
        
        await updateDoc(doc(db, 'publicBattles', battleId), updates);
      } catch(e) {}
    },

    async _submitAnswer(battleId, qi, chosenIdx) {
      const db = window._firebaseDb;
      const { doc, getDoc, updateDoc } = window._firebaseFns;
      const myUid = uid();
      const myName = getMyName();

      // ── GUARD: prevent double-submit via UI flag ──
      if (this._answerSubmitting) return;
      this._answerSubmitting = true;
      this._lastRenderHash = null;  // Clear hash to force re-render after submit

      try {
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (!snap.exists()) { this._answerSubmitting = false; return; }
        const battle = snap.data();
        const quiz = battle.quiz || {};

        // ✅ INDIVIDUAL USER TRACKING: Each user answers independently
        // Check if THIS USER already answered this question
        const myAnswerKey = 'user_' + myUid + '_q' + String(qi);
        if (quiz.answers && quiz.answers[myAnswerKey]) {
          this._answerSubmitting = false;
          return; // User already answered this question
        }

        const q = battle.questions[qi];
        if (!q) { this._answerSubmitting = false; return; }
        
        // FIX: Ensure numeric comparison - convert both to numbers
        const chosenIndex = typeof chosenIdx === 'string' ? parseInt(chosenIdx, 10) : Number(chosenIdx);
        const correctIndex = typeof q.ans === 'string' ? parseInt(q.ans, 10) : Number(q.ans);
        const correct = chosenIndex === correctIndex;
        
        const CORRECT_XP = 10;
        const WRONG_XP   = -3;
        const xpDelta    = correct ? CORRECT_XP : WRONG_XP;
        const currentXP  = (quiz.xp && quiz.xp[myUid]) || 0;
        const newXP      = Math.max(0, currentXP + xpDelta);
        const nextIdx    = qi + 1;
        const isLast     = nextIdx >= battle.questions.length;
        const questionStartTs = Date.now();

        // ── INSTANT UI FEEDBACK: apply result immediately without delay ──
        this._stopQuestionTimer();
        // Mark chosen option correct/wrong INSTANTLY in DOM
        const opts = document.querySelectorAll('.ba-quiz-opt');
        opts.forEach((btn, j) => {
          btn.disabled = true;
          btn.onclick = null;
          btn.classList.remove('correct', 'wrong', 'dim');
          if (j === correctIndex) btn.classList.add('correct');
          else if (j === chosenIndex && j !== correctIndex) btn.classList.add('wrong');
          else btn.classList.add('dim');
        });
        // Show result banner INSTANTLY with animation
        const waiting = document.querySelector('.ba-quiz-waiting');
        if (waiting) {
          const answer = q.opts[correctIndex] || '';
          waiting.outerHTML = `
            <div class="ba-quiz-answered-banner ${correct ? 'correct' : 'wrong'}" style="animation: ba-pop-in 0.15s ease;">
              ${correct ? '✅ Correct! <b>+' + CORRECT_XP + ' XP</b>' : `❌ Wrong! <b>` + WRONG_XP + ` XP</b> Answer: <b>${answer}</b>`}
            </div>
            ${q.exp ? `<div class="ba-quiz-exp">💡 ${q.exp}</div>` : ''}`;
        }
        // ADD XP FOR BOTH CORRECT AND WRONG ANSWERS
        addBattleXP(xpDelta);

        // ── WRITE to Firestore (background — UI already updated) ──
        const updates = {
          ['quiz.answers.' + 'user_' + myUid + '_q' + String(qi)]: 
            { uid: myUid, name: myName, chosen: chosenIndex, correct, ts: Date.now() },
          ['quiz.xp.' + myUid]: newXP,
          ['quiz.userProgress.' + myUid]: nextIdx,
          ['quiz.status']: 'active',
          ['quiz.questionStartedAt']: questionStartTs,
        };

        await updateDoc(doc(db, 'publicBattles', battleId), updates);

        if (isLast) {
          await this._saveToLeaderboard(myUid, myName, newXP, battle.quiz?.xp || {});
          // TRACK BATTLE WIN: Only top-3 placements count as wins
          await this._trackBattleWin(battleId, myUid, myName, newXP, battle.quiz?.xp || {});
          
          // ── AWARD COINS TO USER ACCOUNT ──
          const coinsEarned = await this._awardCoinsForBattle(battleId, myUid, myName, newXP, battle.quiz?.xp || {});
          if (coinsEarned > 0) {
            // Award coins via _syncCoinsToFirebase with full fallback chain
            const syncSuccess = await _syncCoinsToFirebase(myUid, coinsEarned, 'Real Battle 🏆');
            if (syncSuccess && typeof toast === 'function') {
              toast(`🪙 +${coinsEarned} coins earned!`, 2000);
            }
          }
        }

      } catch(e) {
        toast('❌ Submit error. Check connection.', 2000);
      }

      this._answerSubmitting = false;

      // INSTANT next question display: wait for Firestore write to complete, then poll
      if (this._activeBattleId) {
        const bid = this._activeBattleId;
        setTimeout(() => {
          battleState.lastQuestionIndex = -1;  // Force re-render of next question
          this._pollGameBattle(bid);
        }, 150);
      }
    },

    // ── Track battle win in Firestore ──
    async _trackBattleWin(battleId, myUid, myName, finalXP, allXP) {
      const db = window._firebaseDb;
      const { doc, updateDoc, increment } = window._firebaseFns;
      if (!db || !updateDoc || !myUid) return;

      try {
        const entries = Object.entries(allXP || {}).sort((a, b) => b[1] - a[1]);
        const myRank = entries.findIndex(([u]) => u === myUid);
        const totalPlayers = entries.length;

        // Only count wins if top-3 OR sole participant
        if (myRank < 3 || totalPlayers === 1) {
          await updateDoc(doc(db, 'users', myUid), {
            battleWins: increment(1),
            lastBattleWon: Date.now(),
            lastBattleRank: myRank,
            totalBattlesPlayed: increment(1),
          });
        } else {
          // Track participation only
          await updateDoc(doc(db, 'users', myUid), {
            totalBattlesPlayed: increment(1),
          });
        }
      } catch (e) {}
    },

    // ── Award coins based on battle ranking ──
    async _awardCoinsForBattle(battleId, myUid, myName, finalXP, allXP) {
      const entries = Object.entries(allXP || {}).sort((a, b) => b[1] - a[1]);
      const myRank = entries.findIndex(([u]) => u === myUid);
      const totalPlayers = entries.length;
      let coinsEarned = 0;

      // Tiered coin rewards
      if (totalPlayers >= 10) {
        if (myRank === 0) coinsEarned = 25;
        else if (myRank === 1) coinsEarned = 18;
        else if (myRank === 2) coinsEarned = 8;
        else if (myRank >= 3) coinsEarned = 2;
      } else if (totalPlayers >= 5) {
        if (myRank === 0) coinsEarned = 25;
        else if (myRank === 1) coinsEarned = 15;
        else if (myRank >= 2) coinsEarned = 2;
      } else if (totalPlayers >= 2) {
        if (myRank === 0) coinsEarned = 20;
        else coinsEarned = 2;
      } else {
        // Solo
        coinsEarned = 5;
      }

      return coinsEarned;
    },

    /* ── Winner screen ── */
    _renderBattleWinner(battle) {
      const body = document.getElementById('ba-body');
      if (!body) return;

      const xp = battle.quiz?.xp || {};
      const sorted = Object.entries(xp).sort((a,b) => b[1]-a[1]);
      const winner = sorted[0];
      const myUid = uid();
      const playerNames = battle.playerNames || {};
      const players = (battle.players || []).length;
      const db = window._firebaseDb;
      const { doc, getDoc, updateDoc } = window._firebaseFns || {};

      // Coins: PROFESSIONAL TIERED MODEL
      const myRank = sorted.findIndex(([u]) => u === myUid);
      let coinsWon = 0;
      
      if (players >= 10) {
        if (myRank === 0) coinsWon = 25;      // 1st place
        else if (myRank === 1) coinsWon = 18; // 2nd place
        else if (myRank === 2) coinsWon = 8;  // 3rd place
        else if (myRank >= 3) coinsWon = 2;   // Participation
      } else if (players >= 5) {
        if (myRank === 0) coinsWon = 25;
        else if (myRank === 1) coinsWon = 15;
        else if (myRank >= 2) coinsWon = 2;
      } else if (players >= 2) {
        if (myRank === 0) coinsWon = 20;
        else coinsWon = 2;
      }
      
      const awardKey = 'ba_coins_' + (battle.id || this._activeBattleId) + '_' + myUid;
      if (coinsWon > 0 && !localStorage.getItem(awardKey)) {
        // Use standard _syncCoinsToFirebase which handles all fallbacks
        if (typeof _syncCoinsToFirebase === 'function') {
          _syncCoinsToFirebase(myUid, coinsWon, 'Real Battle 🏆').then(syncSuccess => {
            if (syncSuccess) {
              localStorage.setItem(awardKey, '1');
              if (typeof window.refreshProfileCoinsDisplay === 'function') {
                setTimeout(() => { window.refreshProfileCoinsDisplay(); }, 300);
              }
            }
          }).catch(() => {
            // Fallback handled by _syncCoinsToFirebase
          });
        }
        
        if (typeof toast === 'function') {
          toast(`🪙 +${coinsWon} coins earned! 🏆`, 2500);
        }
      }
      
      // Update the coins display after awarding (slight delay so coins finish syncing)
      setTimeout(() => {
        const el = document.getElementById('ba-winner-coins-display');
        if (!el) return;
        try {
          const u = window._firebaseAuth?.currentUser;
          const k = 'sscai_u:' + (u ? u.uid : 'guest') + ':coins';
          const cur = JSON.parse(localStorage.getItem(k) || '{"coins":0}');
          el.textContent = `🪙 Your total: ${cur.coins || 0} coins`;
        } catch(_) {}
      }, 500);

      // Sync coins display from Firestore and refresh profile
      try {
        const db = window._firebaseDb; const fns = window._firebaseFns;
        const u = window._firebaseAuth?.currentUser;
        if (db && fns && u) {
          fns.getDoc(fns.doc(db, 'users', u.uid)).then(snap => {
            if (snap && snap.exists()) {
              const sc = snap.data().coins || 0;
              const badge = document.querySelector('.ba-coins-badge, #ba-coins-display');
              if (badge) badge.textContent = '🪙 ' + sc;
              // Also refresh profile display
              if (typeof window.refreshProfileCoinsDisplay === 'function') {
                window.refreshProfileCoinsDisplay();
              }
            }
          }).catch(()=>{});
        }
      } catch(_) {}

      body.innerHTML = `
        ${coinsWon > 0 ? `<div style="text-align:center;font-size:18px;font-weight:800;color:#f59e0b;margin-bottom:8px;">🪙 +${coinsWon} Coins Earned!</div>` : ''}
        <div id="ba-winner-coins-display" style="text-align:center;font-size:13px;color:rgba(26,26,38,0.70);margin-bottom:4px;"></div>
        <div class="ba-winner-wrap">
          <div class="ba-winner-trophy">${winner && winner[0] === myUid ? '🏆' : '🎯'}</div>
          <div class="ba-winner-title">Battle Over!</div>
          <div class="ba-winner-name">
            ${winner
              ? `🥇 Winner: <strong style="color:#f59e0b">${playerNames[winner[0]]||'Player'}</strong> with ${winner[1]} XP`
              : 'No scores yet'}
          </div>
        </div>
        <div class="ba-results-grid">
          ${sorted.slice(0,6).map(([u,x],i) => `
            <div class="ba-result-stat">
              <div class="ba-result-stat-val">${['🥇','🥈','🥉'][i]||'#'+(i+1)} ${x}</div>
              <div class="ba-result-stat-lbl">${(playerNames[u]||'Player')} XP</div>
            </div>`).join('')}
        </div>
        <div style="text-align:center;margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <button class="ba-join-btn" onclick="BA._backToList()">← Back to Arena</button>
          <button class="ba-join-btn" style="background:linear-gradient(135deg,#6C63FF,#a78bfa);" onclick="BA.openLeaderboard()">🏆 Leaderboard</button>
          <button class="ba-join-btn" style="background:linear-gradient(135deg,#25D366,#128C7E);" onclick="BA._shareResult(${JSON.stringify(winner ? (winner[0]===myUid) : false)}, ${winner ? winner[1] : 0}, ${myRank+1}, '${(battle.name||'Quiz Battle').replace(/'/g,"\\'")}')">📤 Share Result</button>
        </div>`;
    },

    _backToList() {
      const battleId = this._activeBattleId;
      if (battleId) {
        // If it's a demo battle, use demo cleanup
        if (battleId.startsWith('demo_')) {
          this._demoLeave(battleId);
          return;
        }
        const myUid = uid();
        const isCreator = this._lastBattleData && this._lastBattleData.creatorUid === myUid;
        if (!isCreator) {
          window._markBattleQuit(battleId);
          // Remove player from ready list when leaving
          this._removePlayerFromBattle(battleId);
        }
      }
      this._stopPolling();
      this._stopQuestionTimer();
      this._activeBattleId = null;
      this._countdownShown = false;
      this._renderArena();
    },

    /* ── End battle when 5-minute timer expires ── */
    _endBattleByTimer(battleId) {
      if (!battleId) return;
      const body = document.getElementById('ba-body');
      if (!body) return;
      
      // For demo battles, show results
      if (battleId.startsWith('demo_')) {
        // Demo battle timer expired - results already shown by timer logic
        return;
      }
      
      // For real battles, show results page
      if (this._activeBattleId === battleId && this._lastBattleData) {
        // Mark battle as ended in Firestore
        try {
          const db = window._firebaseDb;
          const { doc, updateDoc } = window._firebaseFns;
          if (db) {
            updateDoc(doc(db, 'publicBattles', battleId), { status: 'finished', finishedAt: Date.now() }).catch(() => {});
          }
        } catch(e) {}
        
        // Render results
        this._renderBattleWinner(this._lastBattleData);
      }
    },

    /* ── Admin ends battle manually ── */
    async _endBattleNow(battleId) {
      if (!battleId) return;
      const myUid = uid();
      const db = window._firebaseDb;
      const { doc, getDoc, updateDoc } = window._firebaseFns;
      
      try {
        // Verify the user is the creator
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (!snap.exists()) {
          toast('❌ Battle not found!');
          return;
        }
        
        const battle = snap.data();
        if (battle.creatorUid !== myUid) {
          toast('⛔ Only the battle creator can end the battle!');
          return;
        }
        
        // Show confirmation
        const confirmed = confirm('🛑 End this battle NOW for all players?\n\nAll players will see the results screen immediately.');
        if (!confirmed) return;
        
        // Update battle status to finished
        await updateDoc(doc(db, 'publicBattles', battleId), { 
          status: 'finished', 
          finishedAt: Date.now(),
          endedBy: myUid,
          forcefullyEnded: true
        });
        
        toast('🛑 Battle ended for all players!', 2000);
        
        // Force render results on this client
        if (this._lastBattleData) {
          this._renderBattleWinner({ ...this._lastBattleData, status: 'finished', finishedAt: Date.now() });
        }
      } catch(e) {
        toast('❌ Could not end battle: ' + (e.message || 'Error'));
      }
    },

    /* ── Share result — WhatsApp + copy link ── */
    _shareResult(iWon, myXP, myRank, battleName) {
      const medals = ['🥇','🥈','🥉'];
      const medal  = medals[myRank-1] || `#${myRank}`;
      const baseUrl = window.location.origin || 'https://crackai.app';
      const text = iWon
        ? `🏆 I just WON a Battle on CrackwithAI! ${medal} — ${myXP} XP in "${battleName}"\n⚔️ Challenge me: ${baseUrl}\n#CrackwithAI #SSC #BattleArena`
        : `⚔️ I competed in "${battleName}" on CrackwithAI! Ranked ${medal} with ${myXP} XP.\nTry beating me: ${baseUrl}\n#CrackwithAI #BattleArena`;

      const body = document.getElementById('ba-body');
      if (!body) return;

      // Inject share sheet at bottom
      const existing = document.getElementById('ba-share-sheet');
      if (existing) existing.remove();

      const sheet = document.createElement('div');
      sheet.id = 'ba-share-sheet';
      sheet.style.cssText = `
        position:fixed;bottom:0;left:0;right:0;z-index:999999;
        background:var(--bg-secondary,#13131a);border-top:1px solid rgba(108,99,255,0.3);
        border-radius:20px 20px 0 0;padding:20px 16px 32px;
        animation:ba-slide-up 0.3s ease;
      `;
      sheet.innerHTML = `
        <style>@keyframes ba-slide-up{from{transform:translateY(100%)}to{transform:translateY(0)}}</style>
        <div style="text-align:center;margin-bottom:16px;">
          <div style="width:36px;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin:0 auto 14px;"></div>
          <div style="font-size:16px;font-weight:800;color:var(--text-primary);">📤 Share Your Result</div>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(108,99,255,0.2);border-radius:12px;padding:12px;margin-bottom:14px;font-size:12px;color:rgba(26,26,38,0.7);line-height:1.6;word-break:break-word;">${text.replace(/\n/g,'<br>')}</div>
        <div style="display:flex;gap:10px;margin-bottom:12px;">
          <button onclick="BA._shareWhatsApp(${JSON.stringify(text)})" style="flex:1;padding:13px;background:linear-gradient(135deg,#25D366,#128C7E);border:none;border-radius:12px;color:var(--text-primary);font-size:13px;font-weight:800;cursor:pointer;">
            💬 WhatsApp
          </button>
          <button onclick="BA._shareCopy(${JSON.stringify(text)})" style="flex:1;padding:13px;background:linear-gradient(135deg,rgba(108,99,255,0.3),rgba(167,139,250,0.3));border:1px solid rgba(108,99,255,0.4);border-radius:12px;color:#5b46d4;font-size:13px;font-weight:800;cursor:pointer;">
            📋 Copy Link
          </button>
        </div>
        <button onclick="document.getElementById('ba-share-sheet').remove()" style="width:100%;padding:11px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:rgba(26,26,38,0.70);font-size:13px;cursor:pointer;">
          Cancel
        </button>`;
      document.body.appendChild(sheet);

      // Close on outside tap
      setTimeout(() => {
        const closeOnTap = (e) => {
          if (!sheet.contains(e.target)) {
            sheet.remove();
            document.removeEventListener('click', closeOnTap);
          }
        };
        document.addEventListener('click', closeOnTap);
      }, 300);
    },

    _shareWhatsApp(text) {
      const url = 'https://wa.me/?text=' + encodeURIComponent(text);
      window.open(url, '_blank');
    },

    _shareCopy(text) {
      try {
        navigator.clipboard.writeText(text).then(() => {
          toast('✅ Result copied to clipboard!', 2500);
          const sheet = document.getElementById('ba-share-sheet');
          if (sheet) sheet.remove();
        }).catch(() => {
          // Fallback
          const ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          toast('✅ Result copied!', 2500);
          const sheet = document.getElementById('ba-share-sheet');
          if (sheet) sheet.remove();
        });
      } catch(e) {
        toast('❌ Could not copy. Try manually.', 2500);
      }
    },

    async _saveToLeaderboard(userUid, userName, battleXP, allXP) {
      try {
        const db = window._firebaseDb;
        const { doc, getDoc, setDoc, updateDoc, increment } = window._firebaseFns;
        const weekKey = getWeekKey();
        const docId = weekKey + '_' + userUid;

        const snap = await getDoc(doc(db, 'battleLeaderboard', docId));
        const existing = snap.exists() ? snap.data() : null;

        const totalXP = (existing?.xp || 0) + battleXP;
        const battles = (existing?.battles || 0) + 1;
        
        // Calculate if this is a win (top 3 placement)
        const entries = Object.entries(allXP || {}).sort((a, b) => b[1] - a[1]);
        const myRank = entries.findIndex(([u]) => u === userUid);
        const totalPlayers = entries.length;
        const isWin = myRank < 3 || totalPlayers === 1;
        const wins = (existing?.wins || 0) + (isWin ? 1 : 0);
        
        // CRITICAL: Ensure name is ALWAYS set from most reliable source
        let finalName = 'Student';
        
        // 1st priority: Use provided userName (from getMyName())
        if (userName && userName.trim()) {
          finalName = userName.trim();
        }
        // 2nd priority: Keep existing name if it's good
        else if (existing?.name && existing.name.trim() && existing.name !== 'Student') {
          finalName = existing.name.trim();
        }
        // 3rd priority: Get from current Firebase auth
        else {
          try {
            const cu = window._firebaseAuth?.currentUser;
            if (cu && cu.uid === userUid) {
              if (cu.displayName && cu.displayName.trim()) {
                finalName = cu.displayName.trim();
              } else if (cu.email) {
                const prefix = cu.email.split('@')[0];
                finalName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
              }
            }
          } catch(e) {}
        }
        
        // ✅ GET COINS FROM FIRESTORE FIRST (source of truth)
        let totalCoins = 0;
        try {
          const coinsSnap = await getDoc(doc(db, 'userCoins', userUid));
          if (coinsSnap.exists()) {
            totalCoins = coinsSnap.data().coins || 0;
          } else {
            // Create if doesn't exist
            await setDoc(doc(db, 'userCoins', userUid), {
              coins: 0,
              lastUpdated: Date.now(),
              createdAt: Date.now()
            });
          }
        } catch(fbErr) {
          // Fallback to localStorage if Firestore fails
          try {
            const coinsKey = 'sscai_u:' + userUid + ':coins';
            const coinsData = JSON.parse(localStorage.getItem(coinsKey) || '{"coins":0}');
            totalCoins = coinsData.coins || 0;
          } catch(_) {}
        }
        
        // FIX 4: Also try to read from users collection as backup
        try {
          const userSnap = await getDoc(doc(db, 'users', userUid));
          if (userSnap.exists() && userSnap.data().coins) {
            totalCoins = Math.max(totalCoins, userSnap.data().coins);
          }
        } catch(_) {}

        // Grab photoURL + equipped avatar to show in leaderboard
        const _lbPhotoURL = (() => { try { const u = window._firebaseAuth && window._firebaseAuth.currentUser; return (u && u.photoURL) ? u.photoURL : ''; } catch(e) { return ''; } })();
        
        // Complete emoji map for all avatars
        const AVATAR_EMOJI_MAP = {
          'av_default': '🧑‍🎓', 'av_fire': '🔥', 'av_lightning': '⚡', 'av_rocket': '🚀',
          'av_crown': '👑', 'av_diamond': '💎', 'av_ninja': '🥷', 'av_wizard': '🧙‍♂️',
          'av_robot': '🤖', 'av_astronaut': '👨‍🚀', 'av_galaxy': '🌌', 'av_phantom': '👻',
          'av_tiger': '🐯', 'av_dragon': '🐉', 'av_legend': '⭐', 'av_panda': '🐼',
          'av_owl': '🦉', 'av_alien': '👽', 'av_knight': '🛡️', 'av_phoenix': '🦅',
          'av_unicorn': '🦄', 'av_octopus': '🐙', 'av_shark': '🦈', 'av_genius': '🧠',
          'av_samurai': '🗾', 'av_king': '🤴', 'av_queen': '👸', 'av_demon': '👿',
          'av_angel': '😇', 'av_vampire': '🧛', 'av_werewolf': '🐺', 'av_mummy': '🪦',
          'av_zombie': '🧟', 'av_frankenstein': '👹', 'av_lion': '🦁', 'av_eagle': '🦅',
          'av_wolf': '🐺', 'av_bear': '🐻', 'av_snake': '🐍', 'av_scorpion': '🦂',
          'av_fox': '🦊', 'av_swan': '🦢', 'av_peacock': '🦚', 'av_parrot': '🦜'
        };
        
        const _lbAvatar = (() => {
          try {
            // READ FROM CORRECT shop_owned KEY where purchased avatars are stored
            const shopKey = 'sscai_u:' + userUid + ':shop_owned';
            const shopData = JSON.parse(localStorage.getItem(shopKey) || '{"owned":[],"equipped":{}}');
            const equippedAvatarId = shopData.equipped && shopData.equipped.avatars;
            
            if (equippedAvatarId && AVATAR_EMOJI_MAP[equippedAvatarId]) {
              return AVATAR_EMOJI_MAP[equippedAvatarId];
            }
          } catch(e) {}
          return '';
        })();

        // Build the entry with all required fields - name is ALWAYS included
        const leaderboardEntry = {
          uid: userUid,
          name: finalName,
          xp: totalXP,
          battles,
          wins,
          coins: totalCoins,
          weekKey,
          updatedAt: Date.now(),
          photoURL: _lbPhotoURL,
          avatar: _lbAvatar
        };

        await setDoc(doc(db, 'battleLeaderboard', docId), leaderboardEntry, { merge: true });

        // Also write to all-time leaderboard collection with same name
        try {
          const allTimeRef = doc(db, 'battleLeaderboardAllTime', userUid);
          const allTimeSnap = await getDoc(allTimeRef);
          const at = allTimeSnap.exists() ? allTimeSnap.data() : null;
          
          const allTimeEntry = {
            uid: userUid,
            name: finalName,
            xp: (at ? at.xp || 0 : 0) + battleXP,
            battles: (at ? at.battles || 0 : 0) + 1,
            wins: at ? at.wins || 0 : 0,
            coins: totalCoins,
            updatedAt: Date.now(),
            photoURL: _lbPhotoURL,
            avatar: _lbAvatar
          };

          await setDoc(allTimeRef, allTimeEntry, { merge: true });
        } catch(atErr) {}

        // Check if this user should get weekly free premium
        this._checkWeeklyReward(weekKey);

      } catch(e) {}
    },

    async _saveWin(battleId) {
      try {
        const db = window._firebaseDb;
        const { doc, getDoc, updateDoc } = window._firebaseFns;
        const weekKey = getWeekKey();
        const myUid = uid();
        const docId = weekKey + '_' + myUid;
        const snap = await getDoc(doc(db, 'battleLeaderboard', docId));
        if (snap.exists()) {
          await updateDoc(doc(db, 'battleLeaderboard', docId), { wins: (snap.data().wins||0)+1 });
        }
      } catch(e) {}
    },

    /* ── Weekly Reward Check ── */
    async _checkWeeklyReward(weekKey) {
      // This runs client-side only as a best-effort — real enforcement should be server-side
      // For now, identify the top user and mark them for premium in the DB
      try {
        const db = window._firebaseDb;
        const { collection, query, where, orderBy, limit, getDocs, doc, updateDoc } = window._firebaseFns;
        const q = query(
          collection(db, 'battleLeaderboard'),
          where('weekKey', '==', weekKey),
          orderBy('xp', 'desc'),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const topUser = snap.docs[0].data();
          // Update the top user's record with weekly winner flag
          await updateDoc(snap.docs[0].ref, { weeklyWinner: true });

          // If this device is the top user — grant them free premium
          if (topUser.uid === uid()) {
            const alreadyRewarded = localStorage.getItem('sscai_weekly_reward_week') === weekKey;
            if (!alreadyRewarded) {
              localStorage.setItem('sscai_weekly_reward_week', weekKey);
              // Grant premium
              const u = window._firebaseAuth?.currentUser;
              const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
              localStorage.setItem(p + 'premium', 'true');
              localStorage.setItem(p + 'premium_plan', 'battle_weekly_reward');
              localStorage.setItem('sscai_premium', 'true');
              if (typeof state !== 'undefined') state.isPremium = true;
              if (typeof updateUserUI === 'function') updateUserUI();
              if (typeof updateLimitUI === 'function') updateLimitUI();
              toast('🏆 YOU ARE THIS WEEK\'S TOP FIGHTER! 🎉 FREE Premium (1 month) unlocked — ₹1299 value!', 7000);
            }
          }
        }
      } catch(e) {}
    },

    /* ─────────────────────────────────────────────────────────
     * LEADERBOARD
     * ───────────────────────────────────────────────────────── */
    _lbTab: 'weekly',

    async openLeaderboard() {
      injectStyles();
      createModals();
      document.getElementById('lb-modal').classList.add('open');
      this._lbTab = 'weekly';
      await this._renderLeaderboard();
    },

    async _renderLeaderboard() {
      const body = document.getElementById('lb-body');
      if (!body) return;

      body.innerHTML = `<div class="ba-loading"><div class="ba-spinner"></div>Loading leaderboard...</div>`;

      // Guard: firebase not ready
      if (!window._firebaseDb || !window._firebaseFns) {
        body.innerHTML = `<div class="ba-empty">⏳ Connecting... please reopen in a moment.</div>`;
        return;
      }

      try {
        const db = window._firebaseDb;
        const { collection, query, where, orderBy, limit, getDocs, getDoc, doc } = window._firebaseFns;
        const weekKey = getWeekKey();
        const myUid = uid();

        // Fetch weekly top 50
        let weeklyEntries = [];
        try {
          const q = query(collection(db, 'battleLeaderboard'), where('weekKey','==',weekKey), orderBy('xp','desc'), limit(50));
          const snap = await getDocs(q);
          // Filter out demo entries from Firestore — only real users
          weeklyEntries = snap.docs.map(d => d.data()).filter(e => !e._demo);
        } catch(e) {
          // Fallback without orderBy (composite index not ready yet)
          try {
            const q2 = query(collection(db, 'battleLeaderboard'), where('weekKey','==',weekKey));
            const snap2 = await getDocs(q2);
            weeklyEntries = snap2.docs.map(d => d.data()).filter(e => !e._demo).sort((a,b)=>b.xp-a.xp).slice(0,50);
          } catch(e2) {
            // Collection may not exist yet — treat as empty, show empty state
            weeklyEntries = [];
          }
        }

        // ── CRITICAL: Enrich entries with real user names from Firestore ──
        // If an entry has uid but no/empty name, fetch from users/{uid} document
        const enrichedEntries = [];
        for (const e of weeklyEntries) {
          let entry = { ...e };
          // If missing or empty name, try to fetch from users collection
          if ((!entry.name || entry.name.trim() === '' || entry.name === 'Student') && entry.uid) {
            try {
              const userRef = doc(db, 'users', entry.uid);
              const userSnap = await getDoc(userRef);
              if (userSnap.exists()) {
                const userData = userSnap.data();
                // Use name, email prefix, or fallback
                if (userData.name && userData.name.trim()) {
                  entry.name = userData.name.trim();
                } else if (userData.email) {
                  const prefix = userData.email.split('@')[0];
                  entry.name = prefix.charAt(0).toUpperCase() + prefix.slice(1);
                }
              }
            } catch(err) {}
          }
          // Fallback: if still no/empty name, generate from available fields
          if (!entry.name || entry.name.trim() === '' || entry.name === 'Student') {
            if (entry.displayName && entry.displayName.trim()) {
              entry.name = entry.displayName.trim();
            } else if (entry.email) {
              const prefix = entry.email.split('@')[0];
              entry.name = prefix.charAt(0).toUpperCase() + prefix.slice(1);
            } else {
              entry.name = 'Student';
            }
          }
          enrichedEntries.push(entry);
        }
        weeklyEntries = enrichedEntries;

        // My local XP (in case I haven't finished a battle yet)
        const myBattleXP = getBattleXP();

        // Merge my local XP if not in list
        const myInList = weeklyEntries.find(e => e.uid === myUid);
        if (!myInList && myBattleXP > 0) {
          weeklyEntries.push({ uid: myUid, name: getMyName(), xp: myBattleXP, battles: 1, wins: 0, coins: 0, weekKey, _local: true });
        }

        // Load demo bot entries from localStorage and merge
        try {
          const demoLbKey = 'sscai_demo_lb_entries';
          const demoEntries = JSON.parse(localStorage.getItem(demoLbKey) || '[]');
          const demoForThisWeek = demoEntries.filter(e => e.weekKey === weekKey);
          weeklyEntries = [...weeklyEntries, ...demoForThisWeek];
        } catch(ex) {}

        // ── DEDUP: Remove duplicate entries (same uid) keeping highest XP ──
        const seenUids = new Set();
        weeklyEntries = weeklyEntries.filter(e => {
          if (seenUids.has(e.uid)) return false;
          seenUids.add(e.uid);
          return true;
        });

        weeklyEntries.sort((a,b) => {
          // Sort by XP first (descending) - highest XP at top
          if ((b.xp || 0) !== (a.xp || 0)) return (b.xp || 0) - (a.xp || 0);
          // Then by wins (descending)
          if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
          // Then by coins (descending)
          return (b.coins || 0) - (a.coins || 0);
        });

        this._renderLbContent(body, weeklyEntries, weekKey, myUid);

      } catch(e) {
        // Render empty leaderboard instead of error (collection may not exist yet)
        try {
          this._renderLbContent(body, [], getWeekKey(), uid());
        } catch(e2) {
          body.innerHTML = `<div class="ba-empty">📭 No battles played yet this week.<br>Be the first to compete! ⚔️</div>`;
        }
      }
    },

    _renderLbContent(body, entries, weekKey, myUid) {
      const myRank = entries.findIndex(e => e.uid === myUid) + 1;
      const myData = entries.find(e => e.uid === myUid);

      let html = `
        <div class="lb-weekly-notice">
          🏆 <strong>Weekly Battle XP Race</strong><br>
          The user with the most XP this week wins <strong>FREE Premium (1 month — ₹199 value)</strong>!
          Includes unlimited queries, all study modes, Mock Test &amp; PYQ Bank.<br>
          <span style="font-size:10px;opacity:0.7;">Week resets every Monday. Winner auto-gets premium. Rankings update every 5 minutes.</span>
        </div>

        <div class="lb-tab-row">
          <button class="lb-tab active" onclick="BA._switchLbTab('weekly', this)">📅 This Week</button>
          <button class="lb-tab" onclick="BA._switchLbTab('all', this)">🌐 All Time</button>
        </div>`;

      if (myRank > 0 && myData) {
        const levelData = getLevelTitle(calculateLevel(myData.xp || 0));
        const wins = myData.wins || 0;
        html += `
          <div style="background:linear-gradient(135deg,rgba(108,99,255,0.14),rgba(108,99,255,0.06));border:1.5px solid rgba(108,99,255,0.35);border-radius:16px;padding:16px 18px;margin-bottom:18px;box-shadow:0 8px 28px rgba(108,99,255,0.12);">
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px;">
              <div style="font-size:28px;">${levelData.emoji}</div>
              <div style="flex:1;">
                <div style="font-size:14px;font-weight:800;color:var(--text-primary);letter-spacing:-0.3px;">Your Rank: #${myRank}</div>
                <div style="font-size:12px;color:rgba(26,26,38,0.6);margin-top:2px;">Level ${calculateLevel(myData.xp || 0)} ${levelData.title}</div>
              </div>
            </div>
            <div style="display:flex;gap:12px;justify-content:center;padding-top:12px;border-top:1.5px solid rgba(108,99,255,0.2);">
              <div style="text-align:center;flex:0 0 auto;">
                <div style="font-size:16px;font-weight:900;color:#5b46d4;font-family:'Space Grotesk',monospace;">${wins}</div>
                <div style="font-size:10px;color:rgba(26,26,38,0.70);margin-top:4px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">⚔️ Wins</div>
              </div>
              <div style="width:1px;background:rgba(108,99,255,0.25);margin:0 12px;"></div>
              <div style="text-align:center;flex:0 0 auto;">
                <div style="font-size:16px;font-weight:900;color:#5b46d4;font-family:'Space Grotesk',monospace;">${myData.xp}</div>
                <div style="font-size:10px;color:rgba(26,26,38,0.70);margin-top:4px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">⚡ XP</div>
              </div>
            </div>
          </div>`;
      }

      if (entries.length === 0) {
        html += `<div class="ba-empty">📭 No battles this week yet.<br>Be the first to compete! ⚔️</div>`;
      } else {
        // Helper: get avatar HTML for a leaderboard entry
        const AVATAR_EMOJI_MAP = {
          'av_default': '🧑‍🎓', 'av_fire': '🔥', 'av_lightning': '⚡', 'av_rocket': '🚀',
          'av_crown': '👑', 'av_diamond': '💎', 'av_ninja': '🥷', 'av_wizard': '🧙‍♂️',
          'av_robot': '🤖', 'av_astronaut': '👨‍🚀', 'av_galaxy': '🌌', 'av_phantom': '👻',
          'av_tiger': '🐯', 'av_dragon': '🐉', 'av_legend': '⭐', 'av_panda': '🐼',
          'av_owl': '🦉', 'av_alien': '👽', 'av_knight': '🛡️', 'av_phoenix': '🦅',
          'av_unicorn': '🦄', 'av_octopus': '🐙', 'av_shark': '🦈', 'av_genius': '🧠',
          'av_samurai': '🗾', 'av_king': '🤴', 'av_queen': '👸', 'av_demon': '👿',
          'av_angel': '😇', 'av_vampire': '🧛', 'av_werewolf': '🐺', 'av_mummy': '🪦',
          'av_zombie': '🧟', 'av_frankenstein': '👹', 'av_lion': '🦁', 'av_eagle': '🦅',
          'av_wolf': '🐺', 'av_bear': '🐻', 'av_snake': '🐍', 'av_scorpion': '🦂',
          'av_fox': '🦊', 'av_swan': '🦢', 'av_peacock': '🦚', 'av_parrot': '🦜'
        };
        
        const _lbAvatarHtml = (e, levelData) => {
          const initial = (e.name||'?').charAt(0).toUpperCase();
          // 1) Shop avatar emoji (stored in entry or read from local for "me")
          let shopEmoji = e.avatar || null;
          if (!shopEmoji && e.uid === myUid) {
            // Read from shop_owned key (where purchased avatars are stored)
            try {
              const uid2 = myUid;
              const shopKey = 'sscai_u:' + uid2 + ':shop_owned';
              const shopData = JSON.parse(localStorage.getItem(shopKey) || '{"owned":[],"equipped":{}}');
              const equippedAvatarId = shopData.equipped && shopData.equipped.avatars;
              
              if (equippedAvatarId && AVATAR_EMOJI_MAP[equippedAvatarId]) {
                shopEmoji = AVATAR_EMOJI_MAP[equippedAvatarId];
              }
            } catch(ex) {}
          }
          if (shopEmoji) {
            return `<div class="lb-avatar" style="background:linear-gradient(135deg,${levelData.color}44,${levelData.color}22);font-size:20px;">${shopEmoji}</div>`;
          }
          // 2) Google profile photo (stored in entry or from state for "me")
          let photoURL = e.photoURL || null;
          if (!photoURL && e.uid === myUid) {
            try {
              const u = window._firebaseAuth && window._firebaseAuth.currentUser;
              if (u && u.photoURL) photoURL = u.photoURL;
            } catch(ex) {}
          }
          if (photoURL) {
            return `<div class="lb-avatar" style="padding:0;overflow:hidden;background:none;"><img src="${photoURL}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;display:block;" onerror="this.parentElement.innerHTML='${initial}';this.parentElement.style.background='linear-gradient(135deg,${levelData.color}44,${levelData.color}22)';this.parentElement.style.color='${levelData.color}';this.parentElement.style.fontSize='15px';" /></div>`;
          }
          // 3) Colored initial fallback
          return `<div class="lb-avatar" style="background:linear-gradient(135deg,${levelData.color}44,${levelData.color}22);color:${levelData.color};">${initial}</div>`;
        };

        entries.forEach((e, i) => {
          const isMe = e.uid === myUid;
          const rank = i + 1;
          const rankEmoji = ['🥇','🥈','🥉'][i] || `#${rank}`;
          const level = calculateLevel(e.xp || 0);
          const levelData = getLevelTitle(level);
          const avatarHtml = _lbAvatarHtml(e, levelData);
          const isDemo = e._demo === true;
          const wins = e.wins || 0;
          const coins = e.coins || 0;
          const demoLabel = '';

          html += `
            <div class="lb-row ${isMe?'me':''} ${rank<=3?'top3':''} ${isDemo?'demo-entry':''}">
              <div class="lb-rank">${rankEmoji}</div>
              ${avatarHtml}
              <div class="lb-info">
                <div class="lb-name">${e.name||'Student'} ${isMe?'<span style="font-size:10px;background:rgba(108,99,255,0.2);color:#5b46d4;padding:1px 6px;border-radius:10px;">You</span>':''}${demoLabel}</div>
                <div class="lb-level" style="color:${levelData.color};">${levelData.emoji} Lv.${level} ${levelData.title}</div>
              </div>
              <div class="lb-stats-col" style="display:flex;gap:24px;text-align:center;align-items:center;">
                <div style="flex:0 0 auto;text-align:center;">
                  <div class="lb-xp-val">${wins}</div>
                  <div class="lb-xp-lbl">⚔️ Wins</div>
                </div>
                <div style="flex:0 0 auto;text-align:center;">
                  <div class="lb-xp-val">${e.xp||0}</div>
                  <div class="lb-xp-lbl">⚡ XP</div>
                </div>
              </div>
            </div>`;
        });
      }

      body.innerHTML = html;
    },

    _switchLbTab(tab, btn) {
      this._lbTab = tab;
      document.querySelectorAll('.lb-tab').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      if (tab === 'all') {
        this._renderAllTimeLeaderboard();
      } else {
        this._renderLeaderboard();
      }
    },

    async _renderAllTimeLeaderboard() {
      const body = document.getElementById('lb-body');
      if (!body) return;
      body.innerHTML = `<div class="ba-loading"><div class="ba-spinner"></div>Loading all-time rankings...</div>`;
      if (!window._firebaseDb || !window._firebaseFns) {
        body.innerHTML = `<div class="ba-empty">⏳ Connecting... please reopen in a moment.</div>`;
        return;
      }
      try {
        const db = window._firebaseDb;
        const { collection, query, orderBy, limit, getDocs, doc, getDoc } = window._firebaseFns;
        const myUid = uid();
        let entries = [];
        try {
          const q = query(collection(db, 'battleLeaderboardAllTime'), orderBy('xp', 'desc'), limit(50));
          const snap = await getDocs(q);
          // Filter out demo entries from Firestore — only real users
          entries = snap.docs.map(d => d.data()).filter(e => !e._demo);
        } catch(e) {
          // Fallback without index
          const snap2 = await getDocs(collection(db, 'battleLeaderboardAllTime'));
          entries = snap2.docs.map(d => d.data()).filter(e => !e._demo);
        }
        
        // ── CRITICAL: Enrich entries with real user names from Firestore ──
        // If an entry has uid but no/empty name, fetch from users/{uid} document
        const enrichedEntries = [];
        for (const e of entries) {
          let entry = { ...e };
          // If missing or empty name, try to fetch from users collection
          if ((!entry.name || entry.name.trim() === '' || entry.name === 'Student') && entry.uid) {
            try {
              const userRef = doc(db, 'users', entry.uid);
              const userSnap = await getDoc(userRef);
              if (userSnap.exists()) {
                const userData = userSnap.data();
                // Use name, email prefix, or fallback
                if (userData.name && userData.name.trim()) {
                  entry.name = userData.name.trim();
                } else if (userData.email) {
                  const prefix = userData.email.split('@')[0];
                  entry.name = prefix.charAt(0).toUpperCase() + prefix.slice(1);
                }
              }
            } catch(err) {}
          }
          // Fallback: if still no/empty name, generate from available fields
          if (!entry.name || entry.name.trim() === '' || entry.name === 'Student') {
            if (entry.displayName && entry.displayName.trim()) {
              entry.name = entry.displayName.trim();
            } else if (entry.email) {
              const prefix = entry.email.split('@')[0];
              entry.name = prefix.charAt(0).toUpperCase() + prefix.slice(1);
            } else {
              entry.name = 'Student';
            }
          }
          enrichedEntries.push(entry);
        }
        entries = enrichedEntries;
        
        // Load demo bot entries from localStorage and merge
        try {
          const demoLbKey = 'sscai_demo_lb_entries';
          const demoEntries = JSON.parse(localStorage.getItem(demoLbKey) || '[]');
          entries = [...entries, ...demoEntries];
        } catch(ex) {}
        
        // ── DEDUP: Remove duplicate entries (same uid) keeping highest XP ──
        const seenUids = new Set();
        entries = entries.filter(e => {
          if (seenUids.has(e.uid)) return false;
          seenUids.add(e.uid);
          return true;
        });
        
        // Sort by XP first (descending) - highest XP at top, then wins, then coins
        entries.sort((a, b) => {
          if ((b.xp || 0) !== (a.xp || 0)) return (b.xp || 0) - (a.xp || 0);
          if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
          return (b.coins || 0) - (a.coins || 0);
        });
        entries = entries.slice(0, 50);
        this._renderLbContent(body, entries, null, myUid);
      } catch(e) {
        body.innerHTML = `<div class="ba-empty">📭 No all-time data yet. Play battles to appear here!</div>`;
      }
    }
  };

  /* ─── AI QUESTION GENERATOR for battles ─────────────────── */
  const BATTLE_EXAM_LABELS = {
    cgl: 'SSC CGL (Quantitative Aptitude, Reasoning, English, GK)',
    chsl: 'SSC CHSL (10+2 level exam)',
    gd: 'SSC GD Constable (Basic Maths, GK, Reasoning)',
    mts: 'SSC MTS (10th level)',
    cpo: 'SSC CPO/SI',
    upsc: 'UPSC General Studies',
    rrb: 'RRB NTPC (General Awareness, Maths, Reasoning)',
    cuet: 'CUET General Test (English, Reasoning, GK)',
    cds: 'CDS Combined Defence Services (Maths, English, GK)',
    nda: 'NDA National Defence Academy (Maths, General Ability)',
    jee: 'JEE Mains (Physics, Chemistry, Maths)',
    neet: 'NEET (Biology, Physics, Chemistry)',
    gate: 'GATE CS (DSA, OS, DBMS, Networks)',
    ibps: 'IBPS PO (Quant, Reasoning, English)',
    cat: 'CAT MBA Entrance (Quant, DILR, VARC)',
    class10: 'Class 10 CBSE (Maths, Science, Social)',
    class12_sci: 'Class 12 Science (Physics, Chemistry, Maths)',
    class12_com: 'Class 12 Commerce (Accounts, Economics, Business)',
    btech_cs: 'B.Tech CS (DSA, OS, DBMS, Networks, OOP)',
    btech_ai: 'B.Tech AI/ML (Machine Learning, Deep Learning, Python)',
    btech_ec: 'B.Tech ECE (Electronics, Signals, Communication)',
    general: 'General Knowledge (India, Science, Current Affairs)',
    reasoning: 'Logical Reasoning (Series, Analogies, Coding)',
    maths: 'Mathematics (Arithmetic, Algebra, Geometry)',
  };

  /* ── Battle question pool cache (raw full list, no expiry) ── */
  const _battlePoolCache = {};

  // In-flight promise cache — prevents parallel requests for same exam
  const _battlePoolLoading = {};

  async function _loadBattlePool(exam) {
    // Return cached pool immediately (in-memory, no expiry needed — pools don't change during a session)
    if (_battlePoolCache[exam]) return _battlePoolCache[exam];

    // Deduplicate concurrent calls — return the same promise if already loading
    if (_battlePoolLoading[exam]) return _battlePoolLoading[exam];

    const doLoad = async () => {
      // Retry up to 5 times (500ms gap) waiting for Firebase Storage to initialise
      for (let attempt = 0; attempt < 5; attempt++) {
        const storage  = window._firebaseStorage;
        const sRef     = window._storageRef;
        const getDLUrl = window._getDownloadURL;
        if (!storage || !sRef || !getDLUrl) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        const paths = [
          'mock/' + exam + '/questions.json',
          'tests/mock/' + exam + '/questions.json',
          'mocktest/' + exam + '/questions.json',
          'exams/' + exam + '/mock/questions.json',
        ];
        for (const path of paths) {
          try {
            const fileRef = sRef(storage, path);
            const url = await getDLUrl(fileRef);
            // Use default browser cache (no cache: 'no-cache') — pools are static files
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data) && data.length) {
                const pool = data.map((q, i) => {
                  // FIX: Ensure ans is always a number with proper conversion
                  let ansIndex = 0;
                  if (q.ans !== undefined && q.ans !== null) {
                    ansIndex = typeof q.ans === 'string' ? parseInt(q.ans, 10) : Number(q.ans);
                    if (isNaN(ansIndex)) {
                      // If ans is a string like "Option A", find its index in options
                      ansIndex = (q.opts || q.options || q.choices || []).indexOf(String(q.ans));
                      if (ansIndex === -1) ansIndex = 0;
                    }
                  } else if (q.answer !== undefined && q.answer !== null) {
                    ansIndex = (q.opts || q.options || q.choices || []).indexOf(String(q.answer));
                    if (ansIndex === -1) ansIndex = 0;
                  }
                  // Ensure ansIndex is in valid range [0, 3]
                  ansIndex = Math.max(0, Math.min(3, ansIndex));
                  return {
                    ...q,
                    // Normalise field names so q/opts/ans always present
                    q:    q.q    || q.question || '',
                    opts: (q.opts || q.options || q.choices || []).slice(0, 4),
                    ans:  ansIndex,
                    id:   q.id   || q.q || ('b_' + exam + '_' + i),
                  };
                }).filter(q => q.q && q.opts.length === 4);
                if (pool.length) {
                  _battlePoolCache[exam] = pool;
                  return pool;
                }
              }
            }
          } catch(_) {}
        }
        break; // Storage refs present but no file found — no point retrying
      }
      return null;
    };

    _battlePoolLoading[exam] = doLoad().finally(() => { delete _battlePoolLoading[exam]; });
    return _battlePoolLoading[exam];
  }

  /* ── Battle question seen-tracker ───────────────────────────
   * Uses sessionStorage so each browser session starts fresh,
   * but within a session battles never repeat until all are shown. */
  const _battleSeenTracker = {
    _key(exam) { return 'crackai_bseen_' + exam; },
    getSeen(exam) {
      try { return new Set(JSON.parse(sessionStorage.getItem(this._key(exam)) || '[]')); }
      catch(e) { return new Set(); }
    },
    markSeen(exam, ids) {
      try {
        const seen = this.getSeen(exam);
        ids.forEach(id => seen.add(id));
        sessionStorage.setItem(this._key(exam), JSON.stringify([...seen]));
      } catch(e) {}
    },
    reset(exam) {
      try { sessionStorage.removeItem(this._key(exam)); } catch(e) {}
    },
    pick(exam, pool, count) {
      if (!pool || !pool.length) return null;
      let seen = this.getSeen(exam);
      let unseen = pool.filter(q => !seen.has(q.id));
      if (unseen.length < count) {
        // All questions shown — reset and start fresh cycle
        this.reset(exam);
        unseen = pool.slice();
      }
      // Fisher-Yates shuffle
      const arr = unseen.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      const picked = arr.slice(0, count);
      this.markSeen(exam, picked.map(q => q.id));
      return picked;
    }
  };

  async function _generateBattleQuestions(exam, count, uniqueSeedParam) {
    count = count || 10;
    // Load from Firebase Storage ONLY — no AI fallback
    try {
      const pool = await _loadBattlePool(exam);
      if (pool && pool.length) {
        const picked = _battleSeenTracker.pick(exam, pool, count);
        if (picked && picked.length >= count) return picked;
        // Pool smaller than requested count — return all shuffled
        if (pool.length) {
          const arr = pool.slice();
          for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
          return arr.slice(0, Math.min(count, arr.length));
        }
      }
    } catch(e) {}
    // Placeholder — signals to creator that the Storage file is missing
    return Array.from({length: count}, (_, i) => ({
      q:    'Q' + (i+1) + ': Upload questions to Firebase Storage at mock/' + exam + '/questions.json',
      opts: ['Option A', 'Option B', 'Option C', 'Option D'],
      ans:  0,
      topic: 'General',
      exp:  'Upload question bank to gs://rankgpt-f8a64.firebasestorage.app/mock/' + exam + '/questions.json'
    }));
  }

  /* Alias used by demo battle code — same logic */
  async function _generateBattleQuestionsUnique(exam, count, seed) {
    return _generateBattleQuestions(exam, count, seed);
  }

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
      try { const r = JSON.parse(s.slice(start, end+1)); if (Array.isArray(r) && r.length) return r; } catch {}
    }
    return null;
  }

  /* ─── WIRE UP SIDEBAR BUTTONS ────────────────────────────── */
  function wireSidebarButtons() {
    const battleBtn = document.getElementById('openBattleArenaBtn');
    if (battleBtn && !battleBtn._baBound) {
      battleBtn._baBound = true;
      battleBtn.addEventListener('click', () => {
        // Close drawer first
        if (typeof closeDrawer === 'function') closeDrawer();
        setTimeout(() => BA.open(), 200);
      });
    }

    const lbBtn = document.getElementById('openLeaderboardBtn');
    if (lbBtn && !lbBtn._lbBound) {
      lbBtn._lbBound = true;
      lbBtn.addEventListener('click', () => {
        if (typeof closeDrawer === 'function') closeDrawer();
        setTimeout(() => BA.openLeaderboard(), 200);
      });
    }

    // Wire coin shop button in profile section (id: openCoinShopBtn)
    const shopBtn = document.getElementById('openCoinShopBtn');
    if (shopBtn && !shopBtn._shopBound) {
      shopBtn._shopBound = true;
      shopBtn.addEventListener('click', () => {
        if (typeof closeDrawer === 'function') closeDrawer();
        setTimeout(() => {
          if (typeof CosmeticsShop !== 'undefined') CosmeticsShop.open();
          else if (typeof window.CosmeticsShop !== 'undefined') window.CosmeticsShop.open();
          else toast('🏪 Shop loading... try again in a second.', 2000);
        }, 200);
      });
    }

    // Wire referral panel button (id: openReferralBtn)
    const refBtn = document.getElementById('openReferralBtn');
    if (refBtn && !refBtn._refBound) {
      refBtn._refBound = true;
      refBtn.addEventListener('click', () => {
        if (typeof closeDrawer === 'function') closeDrawer();
        setTimeout(() => BA._showReferralPanel(), 200);
      });
    }
  }

  /* Expose globally so profile/index.js can open the coin shop anywhere */
  window.openCoinShopFromProfile = function() {
    if (typeof CosmeticsShop !== 'undefined') { CosmeticsShop.open(); return; }
    // Wait for second IIFE to load shop
    let attempts = 0;
    const wait = setInterval(() => {
      attempts++;
      if (typeof CosmeticsShop !== 'undefined') { clearInterval(wait); CosmeticsShop.open(); }
      else if (attempts > 20) { clearInterval(wait); toast('🏪 Shop not ready. Try opening Battle Arena first.', 2500); }
    }, 300);
  };

  /* ─── REFERRAL PANEL ──────────────────────────────────────── */
  BA._showReferralPanel = function() {
    if (!isBattleCreator()) {
      toast('⚔️ Referral codes are for Battle Creator plan holders.', 3000);
      this._openBattlePlanModal();
      return;
    }

    injectStyles();
    createModals();
    const modal = document.getElementById('ba-modal');
    if (!modal) return;
    modal.classList.add('open');
    this._stopPolling();
    this._activeBattleId = null;

    const code    = getMyReferralCode() || '—';
    const stats   = getReferralStats();
    const needed  = REFERRAL_FREE_MONTH_THRESHOLD - ((stats.converted || 0) % REFERRAL_FREE_MONTH_THRESHOLD);
    const shareText = `🏆 Join me on CrackwithAI — the best AI exam prep app!\nUse my referral code: ${code} when upgrading to Battle Creator.\nSign up: ${window.location.origin || 'https://crackai.app'} #CrackwithAI`;

    const body = document.getElementById('ba-body');
    if (!body) return;
    body.innerHTML = `
      <button class="ba-promo-btn" style="margin-bottom:14px;" onclick="BA.close()">← Close</button>
      <div class="ba-section-title">🔗 Your Referral Code</div>

      <div style="background:linear-gradient(135deg,rgba(108,99,255,0.15),rgba(255,107,157,0.1));border:1px solid rgba(108,99,255,0.3);border-radius:16px;padding:18px;text-align:center;margin-bottom:16px;">
        <div style="font-size:12px;color:rgba(26,26,38,0.70);margin-bottom:6px;">Your unique referral code</div>
        <div style="font-size:28px;font-weight:900;color:var(--text-primary);letter-spacing:0.1em;margin-bottom:10px;">${code}</div>
        <div style="display:flex;gap:8px;justify-content:center;">
          <button onclick="BA._copyReferralCode('${code}')" style="padding:9px 18px;background:rgba(108,99,255,0.25);border:1px solid rgba(108,99,255,0.4);border-radius:10px;color:#5b46d4;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">📋 Copy Code</button>
          <button onclick="BA._shareReferralWhatsApp(${JSON.stringify(shareText)})" style="padding:9px 18px;background:rgba(37,211,102,0.2);border:1px solid rgba(37,211,102,0.4);border-radius:10px;color:#25D366;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">💬 Share on WhatsApp</button>
        </div>
      </div>

      <div class="ba-section-title">📊 Your Referral Stats</div>
      <div style="display:flex;gap:10px;margin-bottom:16px;">
        <div style="flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(108,99,255,0.15);border-radius:12px;padding:14px;text-align:center;">
          <div style="font-size:24px;font-weight:800;color:#5b46d4;">${stats.invited || 0}</div>
          <div style="font-size:11px;color:rgba(26,26,38,0.70);margin-top:3px;">Invites Sent</div>
        </div>
        <div style="flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(74,222,128,0.2);border-radius:12px;padding:14px;text-align:center;">
          <div style="font-size:24px;font-weight:800;color:#4ade80;">${stats.converted || 0}</div>
          <div style="font-size:11px;color:rgba(26,26,38,0.70);margin-top:3px;">Converted</div>
        </div>
        <div style="flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(245,158,11,0.2);border-radius:12px;padding:14px;text-align:center;">
          <div style="font-size:24px;font-weight:800;color:#f59e0b;">${stats.freeMonthsEarned || 0}</div>
          <div style="font-size:11px;color:rgba(26,26,38,0.70);margin-top:3px;">Free Months</div>
        </div>
      </div>

      <div style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:14px;margin-bottom:16px;">
        <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">🎁 How It Works</div>
        <div style="font-size:12px;color:rgba(26,26,38,0.65);line-height:1.7;">
          • Share your referral code with friends & students<br>
          • When <strong style="color:#f59e0b;">3 of them upgrade</strong> to Battle Creator — you get <strong style="color:#4ade80;">1 FREE month</strong> (₹149 value!)<br>
          • No limit — refer more, earn more free months<br>
          • <strong style="color:#5b46d4;">${needed} more upgrade${needed===1?'':'s'}</strong> until your next free month!
        </div>
      </div>

      <div style="background:rgba(108,99,255,0.06);border:1px solid rgba(108,99,255,0.2);border-radius:12px;padding:12px 14px;">
        <div style="font-size:11px;font-weight:700;color:#5b46d4;margin-bottom:6px;">💡 Tip</div>
        <div style="font-size:12px;color:rgba(26,26,38,0.55);line-height:1.5;">
          Share your battles! Every battle you create is seen by up to 10 new users — each is a potential referral. The more battles you run, the more organic referrals you get.
        </div>
      </div>`;
  };

  BA._copyReferralCode = function(code) {
    try {
      navigator.clipboard.writeText(code).then(() => toast('✅ Referral code copied!', 2500)).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = code; ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta); toast('✅ Code copied!', 2500);
      });
    } catch(e) { toast('Code: ' + code, 4000); }
  };

  BA._shareReferralWhatsApp = function(text) {
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  };

  /* ─── PROFILE SECTION INJECTOR ────────────────────────────
   * Adds "🏪 Coin Shop" and "🔗 Referral" buttons into the
   * profile modal/section whenever it opens.
   * Uses MutationObserver (no polling, cost-free).
   * ─────────────────────────────────────────────────────────── */
  function _injectProfileButtons() {
    // IDs of common profile modal containers to watch
    const profileContainerIds = ['profileModal','profilePanel','profile-modal','profile-section','profileContent'];

    function _addButtons(container) {
      if (!container || container._baProfileInjected) return;
      container._baProfileInjected = true;

      const wrap = document.createElement('div');
      wrap.id = 'ba-profile-extras';
      wrap.style.cssText = 'padding:12px 16px 0;display:flex;flex-direction:column;gap:8px;';
      wrap.innerHTML = `
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:rgba(26,26,38,0.70);text-transform:uppercase;margin-bottom:2px;">⚔️ Battle Features</div>
        <div style="display:flex;gap:8px;">
          <button id="ba-profile-shop-btn" onclick="window.openCoinShopFromProfile && window.openCoinShopFromProfile()"
            style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:11px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:12px;color:#f59e0b;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">
            🏪 Coin Shop
            <span id="ba-profile-coins-badge" style="font-size:11px;background:rgba(245,158,11,0.2);padding:2px 7px;border-radius:10px;"></span>
          </button>
          <button id="ba-profile-ref-btn" onclick="window.BA && window.BA._showReferralPanel && window.BA._showReferralPanel()"
            style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:11px;background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.3);border-radius:12px;color:#5b46d4;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">
            🔗 Referral
          </button>
        </div>`;

      // Insert after first child (usually profile avatar/header)
      const firstChild = container.firstElementChild;
      if (firstChild && firstChild.nextSibling) {
        container.insertBefore(wrap, firstChild.nextSibling);
      } else {
        container.appendChild(wrap);
      }

      // Update coin count badge
      _updateProfileCoinsBadge();
    }

    function _updateProfileCoinsBadge() {
      const badge = document.getElementById('ba-profile-coins-badge');
      if (!badge) return;
      try {
        const u = window._firebaseAuth?.currentUser;
        const k = u ? ('sscai_u:' + u.uid + ':coins') : null;
        const c = k ? JSON.parse(localStorage.getItem(k) || '{"coins":0}').coins || 0 : 0;
        badge.textContent = '🪙 ' + c;
      } catch(e) {}
    }

    // Watch for profile containers appearing — use targeted click delegation
    // instead of a full-body MutationObserver (which fires on every DOM change)
    document.addEventListener('click', function(e) {
      const t = e.target;
      // Only check when a button that could open the profile modal is clicked
      if (!t) return;
      const isProfileTrigger = t.id === 'headerAvatar' || t.id === 'drawerUserCard'
        || t.closest('#drawerUserCard') || t.id === 'openProfileBtn'
        || t.closest('[onclick*="openProfileModal"]') || t.closest('[onclick*="profile"]');
      if (!isProfileTrigger) return;

      // Small delay so modal gets its .active class first
      setTimeout(() => {
        profileContainerIds.forEach(id => {
          const el = document.getElementById(id);
          if (el && (el.classList.contains('active') || el.style.display === 'flex' || el.style.display === 'block')) {
            _addButtons(el);
          }
        });
        _updateProfileCoinsBadge();
      }, 80);
    }, { passive: true });
  }

  /* ─── INIT ───────────────────────────────────────────────── */
  function init() {
    injectStyles();
    createModals();
    wireSidebarButtons();
    _injectProfileButtons();

    // Save referral code to Firestore for Battle Creators
    if (isBattleCreator()) {
      setTimeout(_saveMyReferralCode, 3000);
    }

    // Re-wire only once after the drawer is first opened (not on every click)
    let _wiredOnce = false;
    document.addEventListener('click', function(e) {
      if (_wiredOnce) return;
      // Only re-wire if a drawer or modal trigger was clicked
      const t = e.target;
      if (t && (t.id === 'menuBtn' || t.closest('#historyDrawer') || t.closest('#ba-modal'))) {
        _wiredOnce = true;
        wireSidebarButtons();
      }
    }, { passive: true });

    console.info('[BattleArena] v3.3 — Demo battles, share, referral, coin shop, ₹149 pricing loaded');
  }

  // Wait for Firebase to be ready
  if (window._firebaseDb && window._firebaseFns) {
    init();
  } else {
    let tries = 0;
    const check = setInterval(() => {
      tries++;
      if (window._firebaseDb && window._firebaseFns) {
        clearInterval(check);
        init();
      } else if (tries > 60) {
        clearInterval(check);
        // Init anyway for UI (Firebase calls will fail gracefully)
        init();
      }
    }, 500);
  }

})();

/* ═══════════════════════════════════════════════════════════════════════════
 * battle-arena-patch.js — ELO RANKING + COINS + COSMETICS + HIGHLIGHTS v2.0
 * Adds:
 *  1. ELO Ranking system (Bronze → Silver → Gold → Platinum → Diamond → Master → Legend)
 *  2. Instant Answer Race (1st=+10, 2nd=+8, 3rd=+6 speed points)
 *  3. Live Chat During Battle (emoji quick-reactions)
 *  4. Battle Highlights (Fastest / Accuracy King / Comeback Player)
 *  5. Coins Economy (win coins, buy avatars / name colors / profile frames)
 *  6. Cosmetic Shop (avatars, name colors, profile frames — status only, no real money)
 *  Both Online Battle Arena (BA) and Group Study battles (CF) are patched.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
   * SHARED HELPERS
   * ───────────────────────────────────────────────────────────── */
  function _uid()    { return window._firebaseAuth?.currentUser?.uid || 'guest'; }
  function _lsKey(k) { return 'sscai_u:' + _uid() + ':' + k; }
  function _lsGet(k) { try { return JSON.parse(localStorage.getItem(_lsKey(k)) || 'null'); } catch { return null; } }
  function _lsSet(k,v){ try { localStorage.setItem(_lsKey(k), JSON.stringify(v)); } catch {} }
  function _toast(m,d){ if (typeof showToast === 'function') showToast(m, d||2800); }

  /* ─────────────────────────────────────────────────────────────
   * 1. ELO SYSTEM
   * ───────────────────────────────────────────────────────────── */
  const ELO_TIERS = [
    { name: 'Bronze',   min: 0,    max: 799,   emoji: '🥉', color: '#cd7f32', bg: 'rgba(205,127,50,0.15)',  kFactor: 32 },
    { name: 'Silver',   min: 800,  max: 1099,  emoji: '🥈', color: '#b0b7c3', bg: 'rgba(176,183,195,0.15)', kFactor: 28 },
    { name: 'Gold',     min: 1100, max: 1399,  emoji: '🥇', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  kFactor: 24 },
    { name: 'Platinum', min: 1400, max: 1699,  emoji: '💎', color: '#38bdf8', bg: 'rgba(56,189,248,0.15)',  kFactor: 20 },
    { name: 'Diamond',  min: 1700, max: 1999,  emoji: '💠', color: '#a78bfa', bg: 'rgba(167,139,250,0.15)', kFactor: 16 },
    { name: 'Master',   min: 2000, max: 2299,  emoji: '👑', color: '#FF6B9D', bg: 'rgba(255,107,157,0.15)', kFactor: 12 },
    { name: 'Legend',   min: 2300, max: 99999, emoji: '🌟', color: '#fff',    bg: 'rgba(255,255,255,0.1)',  kFactor: 10 },
  ];
  const DEFAULT_ELO = 800;

  function getEloTier(elo) {
    return ELO_TIERS.find(t => elo >= t.min && elo <= t.max) || ELO_TIERS[0];
  }

  function getMyElo() {
    const d = _lsGet('elo') || { elo: DEFAULT_ELO };
    return d.elo || DEFAULT_ELO;
  }

  function setMyElo(newElo) {
    _lsSet('elo', { elo: Math.max(0, newElo) });
  }

  /* Standard ELO formula — K-factor varies by tier */
  function calcEloChange(myElo, opponentElo, won) {
    const tier = getEloTier(myElo);
    const K = tier.kFactor;
    const expected = 1 / (1 + Math.pow(10, (opponentElo - myElo) / 400));
    const score = won ? 1 : 0;
    return Math.round(K * (score - expected));
  }

  /* Compute ELO delta after a battle: compare vs average opponent ELO */
  function updateEloAfterBattle(myUid, myXP, allXP) {
    const entries = Object.entries(allXP || {});
    if (entries.length < 2) return 0;

    const myElo = getMyElo();
    const opponentElos = entries
      .filter(([u]) => u !== myUid)
      .map(([u]) => {
        // Try to read opponent ELO from localStorage (best-effort)
        return DEFAULT_ELO; // conservative assumption for opponents
      });
    const avgOpponentElo = opponentElos.length
      ? opponentElos.reduce((a,b) => a+b, 0) / opponentElos.length
      : DEFAULT_ELO;

    const sorted = entries.sort((a,b) => b[1]-a[1]);
    const won = sorted[0]?.[0] === myUid;

    const delta = calcEloChange(myElo, avgOpponentElo, won);
    const newElo = myElo + delta;
    setMyElo(newElo);

    return delta;
  }

  /* ─────────────────────────────────────────────────────────────
   * 2. COINS ECONOMY — Arena wins only, top-3-of-10 prize model
   *   10 players → 1st=50, 2nd=30, 3rd=15, rest=0
   *   5–9 players → 1st=50, 2nd=30, rest=0
   *   2–4 players → 1st=50 only
   *   1 player    → 0 (no opponents)
   *   Group Study → 0 (no coins)
   * ───────────────────────────────────────────────────────────── */
  function getCoins() {
    return (_lsGet('coins') || { coins: 0 }).coins || 0;
  }

  function coinPrize(rank0, totalPlayers) {
    if (totalPlayers <= 1) return 0;
    if (rank0 === 0) return 25;
    if (rank0 === 1) return 15;
    if (rank0 === 2) return 8;
    if (rank0 >= 3) return 2;
    return 0;
  }

  function _syncCoinsToFirestore(total) {
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      const u   = window._firebaseAuth?.currentUser;
      if (!db || !fns || !u) return;
      const { doc, setDoc } = fns;
      setDoc(doc(db, 'userCoins', u.uid), { coins: total, updatedAt: Date.now() }, { merge: true })
        .catch(() => {});
    } catch (_) {}
  }

  function _loadCoinsFromFirestore() {
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      const u   = window._firebaseAuth?.currentUser;
      if (!db || !fns || !u) return;
      const { doc, getDoc } = fns;
      getDoc(doc(db, 'userCoins', u.uid)).then(snap => {
        if (snap && snap.exists()) {
          const serverCoins = snap.data().coins || 0;
          const localCoins  = getCoins();
          if (serverCoins > localCoins) _lsSet('coins', { coins: serverCoins });
        }
      }).catch(() => {});
    } catch (_) {}
  }

  function addCoins(n, reason) {
    if (n <= 0) return getCoins();
    const current  = getCoins();
    const newTotal = current + n;
    _lsSet('coins', { coins: newTotal });
    _toast(`🪙 +${n} coins! (${reason || 'Battle win'})`, 2500);
    _syncCoinsToFirestore(newTotal);
    return newTotal;
  }
  // Expose globally so the first IIFE (BA._renderBattleWinner) can call it
  window.addCoins = addCoins;

  // Expose CosmeticsShop globally so profile page "Coin Shop" button works
  // (already set above as window.CosmeticsShop — also expose on window explicitly)
  window.CosmeticsShop = window.CosmeticsShop;

  // Sync cosmetics on page load: if BA key exists, apply it to app.js avatars
  (function _syncCosmeticsOnLoad() {
    try {
      const u = window._firebaseAuth && window._firebaseAuth.currentUser;
      const uid2 = u ? u.uid : null;
      if (!uid2) {
        // Retry when auth ready
        setTimeout(_syncCosmeticsOnLoad, 1500);
        return;
      }
      const baKey = 'sscai_u:' + uid2 + ':cosmetics';
      const baCos = JSON.parse(localStorage.getItem(baKey) || 'null');
      if (baCos && baCos.activeAvatar) {
        // Sync to app.js global key
        const appCos = JSON.parse(localStorage.getItem('sscai_cosmetics') || '{}');
        const em = { av_fire:'🔥', av_crown:'👑', av_brain:'🧠', av_star:'🌟', av_lightning:'⚡', av_shield:'🛡️', av_gem:'💎', av_rocket:'🚀', av_ninja:'🥷', av_robot:'🤖', av_dragon:'🐉', av_diamond:'💎' };
        if (baCos.activeAvatar) appCos['equipped_avatar'] = baCos.activeAvatar; // any avatar is valid
        if (baCos.activeNameColor && baCos.activeNameColor !== 'nc_white') appCos['equipped_color'] = baCos.activeNameColor;
        if (baCos.activeFrame && baCos.activeFrame !== 'pf_none') appCos['equipped_frame'] = baCos.activeFrame;
        const owned = baCos.owned || [];
        appCos['owned_avatar'] = [...new Set([...(appCos['owned_avatar']||[]), ...owned.filter(id=>id.startsWith('av_'))])];
        appCos['owned_color']  = [...new Set([...(appCos['owned_color'] ||[]), ...owned.filter(id=>id.startsWith('nc_'))])];
        appCos['owned_frame']  = [...new Set([...(appCos['owned_frame'] ||[]), ...owned.filter(id=>id.startsWith('pf_'))])];
        localStorage.setItem('sscai_cosmetics', JSON.stringify(appCos));
        // Now re-apply so profile pics show correct avatar
        if (typeof window.applyEquippedCosmetics === 'function') window.applyEquippedCosmetics();
        if (typeof window.updateUserUI === 'function') window.updateUserUI();
      }
    } catch(ex) {}
  })();

  function spendCoins(n) {
    const current = getCoins();
    if (current < n) return false;
    const newTotal = current - n;
    _lsSet('coins', { coins: newTotal });
    _syncCoinsToFirestore(newTotal);
    return true;
  }

  /* ── Coin help HTML used in shop + winner screen ── */
  function coinHelpHtml() {
    return `<div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:12px;padding:12px 14px;font-size:12px;line-height:1.7;color:rgba(255,220,150,0.85);">
      <strong>How to earn coins:</strong><br>
      🏆 <strong>Battle Arena</strong> — all participants earn:<br>
      &nbsp;&nbsp;• 🥇 1st place: <strong>+25 coins</strong><br>
      &nbsp;&nbsp;• 🥈 2nd place: <strong>+15 coins</strong><br>
      &nbsp;&nbsp;• 🥉 3rd place: <strong>+8 coins</strong><br>
      &nbsp;&nbsp;• 4th+ place: <strong>+2 coins</strong><br>
      <span style="font-size:10px;color:rgba(26,26,38,0.70);">Coins are for cosmetics only — not real money. Group Study does NOT earn coins.</span>
    </div>`;
  }

  /* ─────────────────────────────────────────────────────────────
   * QUIT BATTLE LIST — hide quit battles from arena list forever
   * ───────────────────────────────────────────────────────────── */
  const QUIT_BATTLES_KEY = 'battle_quit_list';

  function getQuitList() {
    return _lsGet(QUIT_BATTLES_KEY) || [];
  }

  function markBattleQuit(battleId) {
    if (!battleId) return;
    const list = getQuitList();
    if (!list.includes(battleId)) {
      list.push(battleId);
      if (list.length > 200) list.splice(0, list.length - 200);
      _lsSet(QUIT_BATTLES_KEY, list);
    }
  }

  function hasQuitBattle(battleId) {
    return getQuitList().includes(battleId);
  }

  // Expose on window so the first IIFE can call these across scope
  window._hasQuitBattle = hasQuitBattle;
  window._markBattleQuit = markBattleQuit;

  /* Remove player from Firestore completely when they leave the battle */
  async function removePlayerFromBattle(battleId) {
    if (!battleId) return;
    const myUid = window._firebaseAuth?.currentUser?.uid || window._firebaseAuth?.currentUser?.uid || 'guest';
    if (!myUid || myUid === 'guest') return;  // Don't remove if no valid UID
    
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      if (!db || !fns) return;
      
      const { doc, getDoc, updateDoc, arrayRemove, deleteField } = fns;
      const snap = await getDoc(doc(db, 'publicBattles', battleId));
      if (!snap.exists()) return;
      
      const battle = snap.data();
      
      // GUARD: Only remove from waiting battles, not active ones
      if (['active', 'countdown', 'generating', 'finished'].includes(battle.status)) {
        return;  // Can't remove from active battle
      }
      
      // Don't remove creator
      if (battle.creatorUid === myUid) return;
      
      // Remove from players array AND playerNames map
      const updates = { 
        players: arrayRemove(myUid)
      };
      
      if (typeof deleteField === 'function') {
        updates[`playerNames.${myUid}`] = deleteField();
      }
      
      await updateDoc(doc(db, 'publicBattles', battleId), updates);
    } catch (_) {}
  }

  window._removePlayerFromBattle = removePlayerFromBattle;

  /* ─────────────────────────────────────────────────────────────
   * 3. COSMETICS STORE DATA
   * ───────────────────────────────────────────────────────────── */
  const AVATARS = [
    // ── Free defaults ──
    { id: 'av_default',    label: '🧑‍🎓 Student',   emoji: '🧑‍🎓', price: 0,   owned: true  },
    { id: 'av_rocket',     label: '🚀 Rocket',      emoji: '🚀',   price: 0,   owned: true  },
    // ── Study / Academic ──
    { id: 'av_brain',      label: '🧠 Big Brain',   emoji: '🧠',   price: 50,  owned: false },
    { id: 'av_books',      label: '📚 Bookworm',    emoji: '📚',   price: 50,  owned: false },
    { id: 'av_pencil',     label: '✏️ Scholar',     emoji: '✏️',   price: 60,  owned: false },
    { id: 'av_microscope', label: '🔬 Scientist',   emoji: '🔬',   price: 70,  owned: false },
    { id: 'av_telescope',  label: '🔭 Astronomer',  emoji: '🔭',   price: 80,  owned: false },
    { id: 'av_abacus',     label: '🧮 Mathematician',emoji: '🧮',  price: 80,  owned: false },
    { id: 'av_owl',        label: '🦉 Wise Owl',    emoji: '🦉',   price: 90,  owned: false },
    { id: 'av_lightbulb',  label: '💡 Idea Master', emoji: '💡',   price: 90,  owned: false },
    { id: 'av_graduation', label: '🎓 Topper',      emoji: '🎓',   price: 100, owned: false },
    { id: 'av_robot',      label: '🤖 AI Genius',   emoji: '🤖',   price: 100, owned: false },
    { id: 'av_map',        label: '🗺️ Geographer',  emoji: '🗺️',  price: 110, owned: false },
    { id: 'av_atom',       label: '⚛️ Physicist',   emoji: '⚛️',  price: 120, owned: false },
    { id: 'av_formula',    label: '🧪 Chemist',     emoji: '🧪',   price: 120, owned: false },
    { id: 'av_scroll',     label: '📜 Historian',   emoji: '📜',   price: 130, owned: false },
    { id: 'av_calculator', label: '🖩 Calculator',  emoji: '🖩',   price: 140, owned: false },
    // ── Battle / Rank ──
    { id: 'av_fire',       label: '🔥 On Fire',     emoji: '🔥',   price: 80,  owned: false },
    { id: 'av_lightning',  label: '⚡ Lightning',   emoji: '⚡',   price: 90,  owned: false },
    { id: 'av_ninja',      label: '🥷 Quiz Ninja',  emoji: '🥷',   price: 100, owned: false },
    { id: 'av_wizard',     label: '🧙 Wizard',      emoji: '🧙',   price: 120, owned: false },
    { id: 'av_tiger',      label: '🐯 Tiger',       emoji: '🐯',   price: 120, owned: false },
    { id: 'av_crown',      label: '👑 Champion',    emoji: '👑',   price: 150, owned: false },
    { id: 'av_phantom',    label: '👻 Phantom',     emoji: '👻',   price: 180, owned: false },
    { id: 'av_astronaut',  label: '👨‍🚀 Astronaut', emoji: '👨‍🚀', price: 200, owned: false },
    { id: 'av_shield',     label: '🛡️ Defender',   emoji: '🛡️',  price: 200, owned: false },
    { id: 'av_galaxy',     label: '🌌 Galaxy',      emoji: '🌌',   price: 250, owned: false },
    { id: 'av_dragon',     label: '🐉 Dragon',      emoji: '🐉',   price: 300, owned: false },
    { id: 'av_diamond',    label: '💎 Diamond',     emoji: '💎',   price: 350, owned: false },
    { id: 'av_legend',     label: '🌟 Legend',      emoji: '🌟',   price: 500, owned: false },
  ];

  const NAME_COLORS = [
    // ── Free ──
    { id: 'nc_white',    label: 'White',          color: '#ffffff',  price: 0,   owned: true  },
    // ── Study theme colors ──
    { id: 'nc_green',    label: '📗 Scholar Green', color: '#4ade80', price: 50,  owned: false },
    { id: 'nc_orange',   label: '📙 Study Orange',  color: '#fb923c', price: 50,  owned: false },
    { id: 'nc_blue',     label: '📘 Class Blue',    color: '#60a5fa', price: 55,  owned: false },
    { id: 'nc_pink',     label: '📝 Note Pink',     color: '#FF6B9D', price: 60,  owned: false },
    { id: 'nc_purple',   label: '🔮 Mentor Purple', color: '#a78bfa', price: 60,  owned: false },
    { id: 'nc_cyan',     label: '💧 Science Cyan',  color: '#38bdf8', price: 70,  owned: false },
    { id: 'nc_yellow',   label: '✏️ Pencil Yellow', color: '#fde047', price: 70,  owned: false },
    { id: 'nc_red',      label: '❌ Wrong Red',     color: '#f87171', price: 75,  owned: false },
    { id: 'nc_teal',     label: '🧪 Lab Teal',      color: '#2dd4bf', price: 80,  owned: false },
    { id: 'nc_indigo',   label: '📐 Math Indigo',   color: '#818cf8', price: 80,  owned: false },
    { id: 'nc_gold',     label: '🏆 Topper Gold',   color: '#f59e0b', price: 100, owned: false },
    // ── Gradient / Premium ──
    { id: 'nc_fire',     label: '🔥 Exam Fire',     color: 'linear-gradient(90deg,#ef4444,#f59e0b)', price: 150, owned: false },
    { id: 'nc_ocean',    label: '🌊 Knowledge Sea',  color: 'linear-gradient(90deg,#38bdf8,#4ade80)', price: 150, owned: false },
    { id: 'nc_aurora',   label: '🌌 Study Aurora',   color: 'linear-gradient(90deg,#6C63FF,#38bdf8,#4ade80)', price: 200, owned: false },
    { id: 'nc_legend',   label: '🌈 Champion',       color: 'linear-gradient(90deg,#f59e0b,#FF6B9D,#a78bfa)', price: 250, owned: false },
  ];

  const PROFILE_FRAMES = [
    // ── Free ──
    { id: 'pf_none',      label: 'None',           border: 'none',                 price: 0,   owned: true  },
    // ── Study themed frames ──
    { id: 'pf_pencil',    label: '✏️ Pencil',      border: '2px solid #fde047',    price: 60,  owned: false },
    { id: 'pf_book',      label: '📗 Textbook',    border: '2px solid #4ade80',    price: 70,  owned: false },
    { id: 'pf_neon',      label: '💙 Neon Blue',   border: '2px solid #38bdf8',    price: 80,  owned: false },
    { id: 'pf_fire',      label: '🔥 Flame',       border: '2px solid #ef4444',    price: 80,  owned: false },
    { id: 'pf_science',   label: '🔬 Lab',         border: '2px solid #2dd4bf',    price: 90,  owned: false },
    { id: 'pf_math',      label: '📐 Equation',    border: '2px dashed #818cf8',   price: 90,  owned: false },
    { id: 'pf_purple',    label: '💜 Royal',       border: '2px solid #a78bfa',    price: 100, owned: false },
    { id: 'pf_gold',      label: '🥇 Gold',        border: '2px solid #f59e0b',    price: 120, owned: false },
    { id: 'pf_topper',    label: '🎓 Topper',      border: '3px solid #f59e0b',    price: 150, owned: false },
    { id: 'pf_champion',  label: '🏆 Champion',    border: '3px solid #FF6B9D',    price: 180, owned: false },
    { id: 'pf_rainbow',   label: '🌈 Champion',    border: '2px solid transparent', price: 300, owned: false,
      gradient: 'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#f59e0b,#FF6B9D,#a78bfa,#38bdf8) border-box' },
    { id: 'pf_galaxy',    label: '🌌 Cosmic',      border: '2px solid transparent', price: 400, owned: false,
      gradient: 'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#6C63FF,#38bdf8,#4ade80,#6C63FF) border-box' },
  ];

  /* ─── EFFECTS (animated overlay on avatar) ────────────────────── */
  const COSMETIC_EFFECTS = [
    { id: 'ef_none',      label: 'None',             icon: '✖️',  css: '',                                                                          price: 0,   owned: true  },
    // Study-themed effects
    { id: 'ef_sparkle',   label: '✨ Sparkle',        icon: '✨',  css: 'filter:drop-shadow(0 0 4px #fde047)',                                       price: 80,  owned: false },
    { id: 'ef_brainwave', label: '🧠 Brain Glow',    icon: '🧠',  css: 'filter:drop-shadow(0 0 6px #a78bfa)',                                       price: 100, owned: false },
    { id: 'ef_fire',      label: '🔥 On Fire',        icon: '🔥',  css: 'filter:drop-shadow(0 0 8px #ef4444) brightness(1.1)',                       price: 120, owned: false },
    { id: 'ef_lightning', label: '⚡ Electric',       icon: '⚡',  css: 'filter:drop-shadow(0 0 8px #fde047) contrast(1.1)',                         price: 120, owned: false },
    { id: 'ef_neon',      label: '💙 Neon',           icon: '💙',  css: 'filter:drop-shadow(0 0 8px #38bdf8)',                                       price: 130, owned: false },
    { id: 'ef_gold',      label: '🏆 Golden Aura',   icon: '🏆',  css: 'filter:drop-shadow(0 0 10px #f59e0b) sepia(0.2)',                           price: 150, owned: false },
    { id: 'ef_science',   label: '⚛️ Atom Glow',     icon: '⚛️', css: 'filter:drop-shadow(0 0 8px #2dd4bf) hue-rotate(10deg)',                    price: 150, owned: false },
    { id: 'ef_starfield', label: '🌟 Star Field',     icon: '🌟',  css: 'filter:drop-shadow(0 0 12px #fde047) brightness(1.15)',                     price: 180, owned: false },
    { id: 'ef_champion',  label: '👑 Champion Halo',  icon: '👑',  css: 'filter:drop-shadow(0 0 12px #FF6B9D) drop-shadow(0 0 6px #f59e0b)',         price: 200, owned: false },
    { id: 'ef_cosmic',    label: '🌌 Cosmic',         icon: '🌌',  css: 'filter:drop-shadow(0 0 14px #6C63FF) drop-shadow(0 0 6px #FF6B9D) brightness(1.1)', price: 300, owned: false },
  ];

  /* ─── TITLES (text badge shown next to name in leaderboard) ─────── */
  const COSMETIC_TITLES = [
    { id: 'tt_none',       label: 'None',                display: '',                                    price: 0,   owned: true  },
    // Study / Academic titles
    { id: 'tt_studybuddy', label: '📖 Study Buddy',       display: '📖 Study Buddy',                      price: 50,  owned: false },
    { id: 'tt_noteguru',   label: '✏️ Note Guru',         display: '✏️ Note Guru',                        price: 60,  owned: false },
    { id: 'tt_readaholic', label: '📚 Readaholic',        display: '📚 Readaholic',                       price: 70,  owned: false },
    { id: 'tt_quizcracker',label: '⚡ Quiz Cracker',      display: '⚡ Quiz Cracker',                     price: 80,  owned: false },
    { id: 'tt_mathwiz',    label: '📐 Math Wizard',       display: '📐 Math Wizard',                      price: 90,  owned: false },
    { id: 'tt_sciencegeek',label: '🔬 Science Geek',      display: '🔬 Science Geek',                     price: 90,  owned: false },
    { id: 'tt_historyking', label: '📜 History King',     display: '📜 History King',                     price: 100, owned: false },
    { id: 'tt_rankbooster',label: '🚀 Rank Booster',      display: '🚀 Rank Booster',                     price: 100, owned: false },
    { id: 'tt_aspirant',   label: '📘 SSC Aspirant',      display: '📘 SSC Aspirant',                     price: 110, owned: false },
    { id: 'tt_topper',     label: '🎓 Class Topper',      display: '🎓 Class Topper',                     price: 120, owned: false },
    { id: 'tt_examwarrior',label: '⚔️ Exam Warrior',     display: '⚔️ Exam Warrior',                    price: 130, owned: false },
    { id: 'tt_brainiac',   label: '🧠 Brainiac',          display: '🧠 Brainiac',                         price: 140, owned: false },
    { id: 'tt_speedster',  label: '⚡ Speed Solver',      display: '⚡ Speed Solver',                     price: 150, owned: false },
    { id: 'tt_centurion',  label: '💯 Centurion',         display: '💯 Centurion',                        price: 160, owned: false },
    { id: 'tt_mentalist',  label: '🔮 Mentalist',         display: '🔮 Mentalist',                        price: 180, owned: false },
    // Battle rank titles
    { id: 'tt_arenaking',  label: '👑 Arena King',        display: '👑 Arena King',                       price: 200, owned: false },
    { id: 'tt_battlemaster',label: '🏆 Battle Master',   display: '🏆 Battle Master',                    price: 250, owned: false },
    { id: 'tt_legend',     label: '🌟 Legend',            display: '🌟 LEGEND',                           price: 400, owned: false },
    { id: 'tt_cracklord',  label: '🐉 CrackwithAI Lord',      display: '🐉 CrackwithAI Lord',                     price: 500, owned: false },
  ];

  /* ── cosmetics persistence ── */
  // Emoji map shared between both cosmetic systems
  // Master emoji map — av_default intentionally excluded (shows Google photo/initials)
  const _AV_EMOJI_MAP = {
    // Original
    av_fire:'🔥', av_lightning:'⚡', av_rocket:'🚀', av_crown:'👑',
    av_diamond:'💎', av_ninja:'🥷', av_wizard:'🧙', av_robot:'🤖',
    av_astronaut:'👨‍🚀', av_galaxy:'🌌', av_phantom:'👻', av_tiger:'🐯',
    av_dragon:'🐉', av_legend:'🌟', av_brain:'🧠', av_shield:'🛡️',
    // Study / Academic additions
    av_books:'📚', av_pencil:'✏️', av_microscope:'🔬', av_telescope:'🔭',
    av_abacus:'🧮', av_owl:'🦉', av_lightbulb:'💡', av_graduation:'🎓',
    av_map:'🗺️', av_atom:'⚛️', av_formula:'🧪', av_scroll:'📜',
    av_calculator:'🖩',
  };

  function getCosmeticData() {
    // Per-UID key (battle-arena system)
    const perUid = _lsGet('cosmetics');
    if (perUid) {
      // Ensure new fields exist for old saves
      if (!perUid.activeEffect) perUid.activeEffect = 'ef_none';
      if (!perUid.activeTitle)  perUid.activeTitle  = 'tt_none';
      if (!perUid.owned.includes('ef_none')) perUid.owned.push('ef_none');
      if (!perUid.owned.includes('tt_none')) perUid.owned.push('tt_none');
      return perUid;
    }
    // Fallback: read app.js global key and migrate to per-UID
    try {
      const appCos = JSON.parse(localStorage.getItem('sscai_cosmetics') || '{}');
      if (appCos && (appCos.equipped_avatar || appCos.owned_avatar)) {
        const migrated = {
          activeAvatar:    appCos.equipped_avatar || 'av_rocket',
          activeNameColor: appCos.equipped_color  || 'nc_white',
          activeFrame:     appCos.equipped_frame  || 'pf_none',
          activeEffect:    'ef_none',
          activeTitle:     'tt_none',
          owned: [
            ...(appCos.owned_avatar || []),
            ...(appCos.owned_color  || []),
            ...(appCos.owned_frame  || []),
            'av_rocket', 'nc_white', 'pf_none', 'ef_none', 'tt_none'
          ]
        };
        migrated.owned = [...new Set(migrated.owned)];
        _lsSet('cosmetics', migrated);
        return migrated;
      }
    } catch(ex) {}
    return {
      activeAvatar:    'av_default',
      activeNameColor: 'nc_white',
      activeFrame:     'pf_none',
      activeEffect:    'ef_none',
      activeTitle:     'tt_none',
      owned: ['av_default', 'nc_white', 'pf_none', 'ef_none', 'tt_none'],
    };
  }

  function saveCosmeticData(d) {
    _lsSet('cosmetics', d); // per-UID key (battle-arena reads this)
    // Also sync to app.js global key so applyEquippedCosmetics works
    try {
      const appCos = JSON.parse(localStorage.getItem('sscai_cosmetics') || '{}');
      if (d.activeAvatar)    appCos['equipped_avatar'] = d.activeAvatar;
      if (d.activeNameColor) appCos['equipped_color']  = d.activeNameColor;
      if (d.activeFrame)     appCos['equipped_frame']  = d.activeFrame;
      // merge owned lists
      const allOwned = d.owned || [];
      const avOwned  = allOwned.filter(id => id.startsWith('av_'));
      const ncOwned  = allOwned.filter(id => id.startsWith('nc_'));
      const pfOwned  = allOwned.filter(id => id.startsWith('pf_'));
      if (avOwned.length) appCos['owned_avatar'] = avOwned;
      if (ncOwned.length) appCos['owned_color']  = ncOwned;
      if (pfOwned.length) appCos['owned_frame']  = pfOwned;
      localStorage.setItem('sscai_cosmetics', JSON.stringify(appCos));
    } catch(ex) {}
    // Trigger applyEquippedCosmetics in app.js so all profile pics update immediately
    if (typeof window.applyEquippedCosmetics === 'function') {
      try { window.applyEquippedCosmetics(); } catch(ex) {}
    }
    if (typeof window.updateUserUI === 'function') {
      try { window.updateUserUI(); } catch(ex) {}
    }
  }

  function isOwned(itemId) {
    const d = getCosmeticData();
    const item = [...AVATARS, ...NAME_COLORS, ...PROFILE_FRAMES].find(i => i.id === itemId);
    return item?.owned === true || d.owned.includes(itemId);
  }

  function buyItem(itemId) {
    const item = [...AVATARS, ...NAME_COLORS, ...PROFILE_FRAMES].find(i => i.id === itemId);
    if (!item) return false;
    if (isOwned(itemId)) return true;
    if (!spendCoins(item.price)) {
      _toast(`🪙 Not enough coins! You need ${item.price} coins.`, 2800);
      return false;
    }
    const d = getCosmeticData();
    d.owned = [...new Set([...d.owned, itemId])];
    saveCosmeticData(d);
    _toast(`✅ Unlocked ${item.label}!`, 2500);
    return true;
  }

  function equipItem(itemId) {
    const d = getCosmeticData();
    if (AVATARS.find(i => i.id === itemId))       d.activeAvatar    = itemId;
    if (NAME_COLORS.find(i => i.id === itemId))   d.activeNameColor = itemId;
    if (PROFILE_FRAMES.find(i => i.id === itemId))d.activeFrame     = itemId;
    saveCosmeticData(d);
  }

  function getActiveCosmetics() {
    const d = getCosmeticData();
    const avatar = AVATARS.find(i => i.id === d.activeAvatar) || AVATARS[0];
    const nameColor = NAME_COLORS.find(i => i.id === d.activeNameColor) || NAME_COLORS[0];
    const frame = PROFILE_FRAMES.find(i => i.id === d.activeFrame) || PROFILE_FRAMES[0];
    return { avatar, nameColor, frame };
  }

  /* ─────────────────────────────────────────────────────────────
   * 4. SPEED TRACKING for Instant Answer Race
   * ───────────────────────────────────────────────────────────── */
  // Stored per-battle in window._battleSpeedData
  // { battleId: { qIdx: { answers: [ {uid,name,ts,correct}, ... ] } } }
  function _speedData() {
    if (!window._battleSpeedData) window._battleSpeedData = {};
    return window._battleSpeedData;
  }

  function _recordAnswer(battleId, qIdx, uid, name, ts, correct) {
    const d = _speedData();
    if (!d[battleId]) d[battleId] = {};
    if (!d[battleId][qIdx]) d[battleId][qIdx] = { answers: [] };
    // Only record first answer per user per question
    if (!d[battleId][qIdx].answers.find(a => a.uid === uid)) {
      d[battleId][qIdx].answers.push({ uid, name, ts, correct });
    }
  }

  function _getSpeedPoints(battleId, qIdx, uid) {
    const d = _speedData();
    const answers = d[battleId]?.[qIdx]?.answers || [];
    const correctAnswers = answers.filter(a => a.correct).sort((a,b) => a.ts - b.ts);
    const pos = correctAnswers.findIndex(a => a.uid === uid);
    if (pos === 0) return 10;
    if (pos === 1) return 8;
    if (pos === 2) return 6;
    return 0;
  }

  /* ─────────────────────────────────────────────────────────────
   * 5. BATTLE HIGHLIGHTS computation
   * ───────────────────────────────────────────────────────────── */
  function computeHighlights(battle) {
    const quiz = battle?.quiz || {};
    const answers = quiz.answers || {};
    const xp = quiz.xp || {};
    const playerNames = battle?.playerNames || {};
    const questions = battle?.questions || [];

    // Accuracy King: player with most correct answers
    const correctCount = {};
    Object.values(answers).forEach(a => {
      if (a.correct) correctCount[a.uid] = (correctCount[a.uid] || 0) + 1;
    });
    const accuracyEntries = Object.entries(correctCount).sort((a,b) => b[1]-a[1]);
    const accuracyKingUid = accuracyEntries[0]?.[0] || null;
    const accuracyKingCount = accuracyEntries[0]?.[1] || 0;

    // Comeback Player: was losing at halfway point but finished higher
    const half = Math.floor(questions.length / 2);
    const halfXP = {};
    for (let i = 0; i < half; i++) {
      const a = answers[i];
      if (a && a.correct) halfXP[a.uid] = (halfXP[a.uid] || 0) + 10;
    }
    const sortedFinal = Object.entries(xp).sort((a,b) => b[1]-a[1]);
    const sortedHalf  = Object.entries(halfXP).sort((a,b) => b[1]-a[1]);
    let comebackUid = null;
    sortedFinal.forEach(([u, fx], finalRank) => {
      const halfRank = sortedHalf.findIndex(([hu]) => hu === u);
      if (halfRank > finalRank + 1 && halfRank !== -1) {
        if (!comebackUid) comebackUid = u;
      }
    });

    return {
      accuracyKing: accuracyKingUid ? playerNames[accuracyKingUid] || 'Unknown' : null,
      accuracyKingCount,
      totalQ: questions.length,
      comeback: comebackUid ? playerNames[comebackUid] || 'Unknown' : null,
    };
  }

  /* ─────────────────────────────────────────────────────────────
   * 6. INJECT ALL CSS
   * ───────────────────────────────────────────────────────────── */
  function injectEloStyles() {
    if (document.getElementById('elo-styles')) return;
    const s = document.createElement('style');
    s.id = 'elo-styles';
    s.textContent = `
      /* ── ELO Badge ── */
      .elo-badge {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 3px 10px; border-radius: 20px;
        font-size: 11px; font-weight: 800; letter-spacing: 0.02em;
        border: 1px solid;
      }
      .elo-delta-pos { color: #4ade80; font-size: 12px; font-weight: 800; }
      .elo-delta-neg { color: #f87171; font-size: 12px; font-weight: 800; }

      /* ── Elo Tier Progress ── */
      .elo-progress-wrap { background: rgba(255,255,255,0.04); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
      .elo-tier-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
      .elo-tier-emoji { font-size: 24px; }
      .elo-tier-info { flex: 1; }
      .elo-tier-name { font-size: 14px; font-weight: 800; }
      .elo-tier-sub { font-size: 11px; color: rgba(200,195,255,0.5); margin-top: 2px; }
      .elo-bar-track { height: 6px; background: rgba(255,255,255,0.08); border-radius: 6px; overflow: hidden; }
      .elo-bar-fill { height: 100%; border-radius: 6px; transition: width 0.6s cubic-bezier(0.34,1.56,0.64,1); }

      /* ── Highlights ── */
      .ba-highlights-wrap { margin: 12px 0; }
      .ba-highlights-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: rgba(200,195,255,0.4); text-transform: uppercase; margin-bottom: 8px; }
      .ba-highlights-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
      .ba-highlight-card {
        background: rgba(255,255,255,0.04); border: 1px solid rgba(108,99,255,0.15);
        border-radius: 12px; padding: 10px 8px; text-align: center;
      }
      .ba-highlight-icon { font-size: 22px; margin-bottom: 4px; }
      .ba-highlight-label { font-size: 9px; color: rgba(200,195,255,0.4); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; }
      .ba-highlight-name { font-size: 12px; font-weight: 700; color: var(--text-primary); word-break: break-word; }

      /* ── Live Chat Reactions ── */
      .ba-chat-bar {
        display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 0; margin-bottom: 6px;
        border-bottom: 1px solid rgba(108,99,255,0.1);
      }
      .ba-chat-btn {
        padding: 4px 10px; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(108,99,255,0.2); border-radius: 20px;
        font-size: 14px; cursor: pointer; transition: all 0.15s;
        display: flex; align-items: center; gap: 4px; color: rgba(200,195,255,0.7);
        font-size: 13px; font-family: inherit;
      }
      .ba-chat-btn:hover { background: rgba(108,99,255,0.15); border-color: rgba(108,99,255,0.4); transform: scale(1.05); }
      .ba-chat-log { max-height: 80px; overflow-y: auto; margin-bottom: 6px; }
      .ba-chat-msg {
        font-size: 12px; color: rgba(200,195,255,0.7); padding: 3px 6px;
        animation: ba-chat-in 0.3s ease;
      }
      .ba-chat-name { color: rgba(108,99,255,0.9); font-weight: 700; }
      @keyframes ba-chat-in { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }

      /* ── Coins Display ── */
      .ba-coins-badge {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 10px; background: rgba(245,158,11,0.1);
        border: 1px solid rgba(245,158,11,0.3); border-radius: 20px;
        font-size: 12px; font-weight: 800; color: #f59e0b;
      }

      /* ── Cosmetics Shop ── */
      #ba-shop-modal {
        position: fixed; inset: 0; z-index: 99992;
        background: rgba(0,0,0,0.85); backdrop-filter: blur(8px);
        display: none; align-items: flex-start; justify-content: center;
        overflow-y: auto; padding: 0;
      }
      #ba-shop-modal.open { display: flex; }
      .ba-shop-box {
        background: var(--bg-secondary, #13131a);
        border: 1px solid rgba(108,99,255,0.25);
        border-radius: 20px; width: 100%; max-width: 520px;
        margin: 0 auto; min-height: 100dvh;
        display: flex; flex-direction: column;
        font-family: 'Space Grotesk', -apple-system, sans-serif;
      }
      .ba-shop-hdr {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px; border-bottom: 1px solid rgba(108,99,255,0.15);
        position: sticky; top: 0; background: var(--bg-secondary, #13131a);
        z-index: 2; border-radius: 20px 20px 0 0;
      }
      .ba-shop-tab-row { display: flex; gap: 8px; margin-bottom: 14px; }
      .ba-shop-tab {
        flex: 1; padding: 8px 4px; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(108,99,255,0.2); border-radius: 10px;
        color: rgba(200,195,255,0.6); font-size: 12px; font-weight: 700;
        cursor: pointer; text-align: center; transition: all 0.15s; font-family: inherit;
      }
      .ba-shop-tab.active { background: rgba(108,99,255,0.2); border-color: rgba(108,99,255,0.5); color: var(--text-primary); }
      .ba-shop-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
      .ba-shop-item {
        background: rgba(255,255,255,0.04); border: 1.5px solid rgba(108,99,255,0.15);
        border-radius: 14px; padding: 14px 10px; text-align: center;
        transition: all 0.2s; cursor: pointer; position: relative;
      }
      .ba-shop-item.owned { border-color: rgba(74,222,128,0.4); }
      .ba-shop-item.equipped { border-color: #6C63FF; background: rgba(108,99,255,0.1); }
      .ba-shop-item:hover:not(.equipped) { border-color: rgba(108,99,255,0.4); transform: translateY(-1px); }
      .ba-shop-item-icon { font-size: 32px; margin-bottom: 6px; display: block; }
      .ba-shop-item-name { font-size: 12px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
      .ba-shop-item-price { font-size: 11px; font-weight: 700; }
      .ba-shop-item-badge {
        position: absolute; top: 6px; right: 6px;
        font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 10px;
        letter-spacing: 0.05em; text-transform: uppercase;
      }
      .ba-shop-item-badge.owned-badge { background: rgba(74,222,128,0.2); color: #4ade80; }
      .ba-shop-item-badge.equipped-badge { background: rgba(108,99,255,0.3); color: #a78bfa; }

      /* ── Speed points toast animation ── */
      .speed-toast {
        position: fixed; left: 50%; transform: translateX(-50%);
        top: 20%; z-index: 100000; pointer-events: none;
        font-size: 22px; font-weight: 900; color: #f59e0b;
        text-shadow: 0 2px 12px rgba(245,158,11,0.5);
        animation: speed-pop 1.5s ease forwards;
      }
      @keyframes speed-pop {
        0%  { opacity:0; transform:translateX(-50%) scale(0.6) translateY(0); }
        30% { opacity:1; transform:translateX(-50%) scale(1.2) translateY(-4px); }
        70% { opacity:1; transform:translateX(-50%) scale(1)   translateY(-10px); }
        100%{ opacity:0; transform:translateX(-50%) scale(0.9) translateY(-20px); }
      }

      /* ── Profile preview in battle ── */
      .ba-player-cosmetic {
        display: inline-flex; align-items: center; gap: 6px;
      }
      .ba-player-avatar {
        width: 28px; height: 28px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; flex-shrink: 0;
      }
    `;
    document.head.appendChild(s);
  }

  /* ─────────────────────────────────────────────────────────────
   * 7. COSMETICS SHOP MODAL
   * ───────────────────────────────────────────────────────────── */
  function createShopModal() {
    if (document.getElementById('ba-shop-modal')) return;
    const m = document.createElement('div');
    m.id = 'ba-shop-modal';
    m.innerHTML = `
      <div class="ba-shop-box">
        <div class="ba-shop-hdr">
          <div>
            <span style="font-size:17px;font-weight:800;color:var(--text-primary);">🏪 Cosmetics Shop</span>
            <div id="ba-shop-coins-display" style="margin-top:3px;"></div>
          </div>
          <button class="ba-close" onclick="CosmeticsShop.close()">✕</button>
        </div>
        <div style="padding:14px 14px 24px;" id="ba-shop-body"></div>
      </div>`;
    document.body.appendChild(m);
  }

  window.CosmeticsShop = {
    _tab: 'avatars',

    open() {
      injectEloStyles();
      createShopModal();
      document.getElementById('ba-shop-modal').classList.add('open');
      this._render();
    },

    close() {
      document.getElementById('ba-shop-modal')?.classList.remove('open');
    },

    _render() {
      const body = document.getElementById('ba-shop-body');
      const coinsEl = document.getElementById('ba-shop-coins-display');
      if (!body) return;

      const coins = getCoins();
      if (coinsEl) coinsEl.innerHTML = `<span class="ba-coins-badge">🪙 ${coins} coins</span>`;

      const d = getCosmeticData();
      const tab = this._tab;

      let tabsHtml = `<div class="ba-shop-tab-row">
        <button class="ba-shop-tab ${tab==='avatars'?'active':''}" onclick="CosmeticsShop._switchTab('avatars')">😊 Avatars</button>
        <button class="ba-shop-tab ${tab==='nameColors'?'active':''}" onclick="CosmeticsShop._switchTab('nameColors')">🎨 Name Color</button>
        <button class="ba-shop-tab ${tab==='frames'?'active':''}" onclick="CosmeticsShop._switchTab('frames')">🖼️ Frame</button>
      </div>`;

      let items, activeKey;
      if (tab === 'avatars')     { items = AVATARS;      activeKey = d.activeAvatar; }
      if (tab === 'nameColors')  { items = NAME_COLORS;  activeKey = d.activeNameColor; }
      if (tab === 'frames')      { items = PROFILE_FRAMES; activeKey = d.activeFrame; }

      const gridHtml = `<div class="ba-shop-grid">
        ${items.map(item => {
          const owned    = isOwned(item.id);
          const equipped = activeKey === item.id;
          let iconHtml;
          if (tab === 'nameColors') {
            iconHtml = `<span class="ba-shop-item-icon" style="font-size:20px;display:flex;align-items:center;justify-content:center;height:32px;">
              <span style="font-size:18px;font-weight:800;background:${item.color};-webkit-background-clip:text;-webkit-text-fill-color:${item.color.startsWith('linear') ? 'transparent' : item.color};background-clip:text;">Abc</span>
            </span>`;
          } else if (tab === 'frames') {
            iconHtml = `<span class="ba-shop-item-icon">
              <span style="display:inline-flex;width:32px;height:32px;border-radius:50%;${item.gradient ? `background:${item.gradient};` : `border:${item.border};background:rgba(108,99,255,0.1);`}align-items:center;justify-content:center;font-size:14px;">A</span>
            </span>`;
          } else {
            iconHtml = `<span class="ba-shop-item-icon">${item.emoji}</span>`;
          }

          const badgeHtml = equipped
            ? `<span class="ba-shop-item-badge equipped-badge">Equipped</span>`
            : owned
            ? `<span class="ba-shop-item-badge owned-badge">Owned</span>`
            : '';

          const actionHtml = equipped
            ? `<div style="font-size:11px;color:#5b46d4;font-weight:700;">✓ Active</div>`
            : owned
            ? `<button onclick="CosmeticsShop._equip('${item.id}')" style="padding:5px 12px;background:rgba(108,99,255,0.2);border:1px solid rgba(108,99,255,0.4);border-radius:8px;color:#5b46d4;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Equip</button>`
            : `<button onclick="CosmeticsShop._buy('${item.id}')" style="padding:5px 12px;background:linear-gradient(135deg,#f59e0b,#ef4444);border:none;border-radius:8px;color:var(--text-primary);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">🪙 ${item.price}</button>`;

          return `<div class="ba-shop-item ${owned?'owned':''} ${equipped?'equipped':''}">
            ${badgeHtml}
            ${iconHtml}
            <div class="ba-shop-item-name">${item.label}</div>
            ${actionHtml}
          </div>`;
        }).join('')}
      </div>`;

      const helpHtml = coinHelpHtml();

      body.innerHTML = tabsHtml + gridHtml + helpHtml;
    },

    _switchTab(tab) {
      this._tab = tab;
      this._render();
    },

    _buy(itemId) {
      if (buyItem(itemId)) {
        equipItem(itemId);
        this._render();
        // Update all profile pictures immediately
        setTimeout(() => {
          if (typeof window.applyEquippedCosmetics === 'function') window.applyEquippedCosmetics();
          if (typeof window.updateUserUI === 'function') window.updateUserUI();
        }, 80);
      }
    },

    _equip(itemId) {
      equipItem(itemId);
      _toast('✅ Cosmetic equipped! Check your profile 🎨', 1800);
      this._render();
      // saveCosmeticData (called inside equipItem→saveCosmeticData) already
      // triggers applyEquippedCosmetics + updateUserUI via the unified save.
      // Belt-and-suspenders: also call directly in case timing differs.
      setTimeout(() => {
        if (typeof window.applyEquippedCosmetics === 'function') window.applyEquippedCosmetics();
        if (typeof window.updateUserUI === 'function') window.updateUserUI();
      }, 80);
    }
  };

  /* ─────────────────────────────────────────────────────────────
   * 8. ELO DISPLAY WIDGET
   * ───────────────────────────────────────────────────────────── */
  window.EloWidget = {
    open() {
      injectEloStyles();
      // Show inside leaderboard if available
      if (typeof BA !== 'undefined') {
        BA.openLeaderboard();
      }
    },

    renderBadge(elo) {
      const tier = getEloTier(elo || getMyElo());
      return `<span class="elo-badge" style="background:${tier.bg};color:${tier.color};border-color:${tier.color}40;">
        ${tier.emoji} ${tier.name} <span style="opacity:0.7;font-size:10px;">${elo || getMyElo()}</span>
      </span>`;
    },

    renderProgress() {
      const elo = getMyElo();
      const tier = getEloTier(elo);
      const nextTier = ELO_TIERS[ELO_TIERS.indexOf(tier) + 1];
      const progress = nextTier
        ? Math.round(((elo - tier.min) / (nextTier.min - tier.min)) * 100)
        : 100;

      return `<div class="elo-progress-wrap">
        <div class="elo-tier-row">
          <div class="elo-tier-emoji">${tier.emoji}</div>
          <div class="elo-tier-info">
            <div class="elo-tier-name" style="color:${tier.color};">${tier.name}</div>
            <div class="elo-tier-sub">${elo} ELO ${nextTier ? `· ${nextTier.min - elo} to ${nextTier.emoji} ${nextTier.name}` : '· MAX RANK'}</div>
          </div>
          <span class="ba-coins-badge">🪙 ${getCoins()}</span>
        </div>
        <div class="elo-bar-track">
          <div class="elo-bar-fill" style="width:${progress}%;background:${tier.color};"></div>
        </div>
      </div>`;
    }
  };

  /* ─────────────────────────────────────────────────────────────
   * 9. PATCH BA._renderBattleWinner — add ELO delta + highlights + coins
   * ───────────────────────────────────────────────────────────── */
  function waitForBA(cb) {
    if (window.BA && window.BA._renderBattleWinner) { cb(); return; }
    setTimeout(() => waitForBA(cb), 200);
  }

  waitForBA(() => {
    injectEloStyles();
    createShopModal();

    const _origWinner = window.BA._renderBattleWinner.bind(window.BA);
    window.BA._renderBattleWinner = function(battle) {
      _origWinner(battle);

      // Append enhanced winner content
      const body = document.getElementById('ba-body');
      if (!body) return;

      const myUid = _uid();
      const xp = battle?.quiz?.xp || {};
      const sorted = Object.entries(xp).sort((a,b) => b[1]-a[1]);
      const playerNames = battle?.playerNames || {};

      // Compute ELO change
      const eloDelta = updateEloAfterBattle(myUid, xp[myUid] || 0, xp);
      const newElo = getMyElo();
      const tier = getEloTier(newElo);

      // Award coins — Arena wins only, correct prize model
      const myRank = sorted.findIndex(([u]) => u === myUid);
      const totalPlayers = sorted.length;
      const coinsEarned = coinPrize(myRank, totalPlayers);
      const coinReason = myRank === 0 ? '🏆 1st place!'
        : myRank === 1 ? '🥈 2nd place!'
        : myRank === 2 ? '🥉 3rd place!'
        : null;
      if (coinsEarned > 0 && coinReason) addCoins(coinsEarned, coinReason);

      // Highlights
      const h = computeHighlights(battle);

      // Build ELO + highlights section
      const eloSection = document.createElement('div');
      eloSection.innerHTML = `
        <!-- ELO Change -->
        <div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.25);border-radius:14px;padding:14px;margin:10px 0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:700;color:var(--text-primary);">📊 ELO Change</div>
            <span class="${eloDelta >= 0 ? 'elo-delta-pos' : 'elo-delta-neg'}">${eloDelta >= 0 ? '+' : ''}${eloDelta} ELO</span>
          </div>
          ${EloWidget.renderProgress()}
          <div style="text-align:center;margin-top:6px;">
            <span class="elo-badge" style="background:${tier.bg};color:${tier.color};border-color:${tier.color}40;">
              ${tier.emoji} ${tier.name} · ${newElo} ELO
            </span>
          </div>
        </div>

        <!-- Coins earned -->
        <div style="text-align:center;margin-bottom:10px;">
          <span class="ba-coins-badge">${coinsEarned > 0 ? `🪙 +${coinsEarned} coins earned · Total: ${getCoins()}` : `🪙 Total: ${getCoins()} coins`}</span>
        </div>

        <!-- Highlights -->
        ${(h.accuracyKing || h.comeback) ? `
        <div class="ba-highlights-wrap">
          <div class="ba-highlights-title">⭐ Battle Highlights</div>
          <div class="ba-highlights-grid">
            ${h.accuracyKing ? `
            <div class="ba-highlight-card">
              <div class="ba-highlight-icon">🎯</div>
              <div class="ba-highlight-label">Accuracy</div>
              <div class="ba-highlight-name">${h.accuracyKing}</div>
            </div>` : ''}
            ${h.comeback ? `
            <div class="ba-highlight-card">
              <div class="ba-highlight-icon">🔥</div>
              <div class="ba-highlight-label">Comeback</div>
              <div class="ba-highlight-name">${h.comeback}</div>
            </div>` : `
            <div class="ba-highlight-card">
              <div class="ba-highlight-icon">🏅</div>
              <div class="ba-highlight-label">MVP</div>
              <div class="ba-highlight-name">${sorted[0] ? playerNames[sorted[0][0]] || 'Player' : '—'}</div>
            </div>`}
          </div>
        </div>` : ''}

        <!-- Shop button -->
        <div style="text-align:center;margin-top:10px;">
          <button onclick="CosmeticsShop.open()" style="padding:10px 20px;background:linear-gradient(135deg,rgba(245,158,11,0.2),rgba(255,107,157,0.2));border:1px solid rgba(245,158,11,0.4);border-radius:12px;color:#f59e0b;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">
            🏪 Spend Coins in Shop
          </button>
        </div>`;

      body.appendChild(eloSection);
    };

    /* ── Patch BA._submitAnswer for speed points ── */
    const _origSubmit = window.BA._submitAnswer.bind(window.BA);
    window.BA._submitAnswer = async function(battleId, qi, chosenIdx) {
      const now = Date.now();
      const myUid = _uid();
      const myName = typeof getMyName === 'function' ? getMyName() : 'You';

      // Call original (which writes to Firestore with +10 if correct)
      await _origSubmit(battleId, qi, chosenIdx);

      // Record for speed tracking and determine position
      try {
        const db = window._firebaseDb;
        const { doc, getDoc } = window._firebaseFns;
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (snap.exists()) {
          const data = snap.data();
          const q = data.questions?.[qi];
          if (q) {
            const correct = chosenIdx === q.ans;
            _recordAnswer(battleId, qi, myUid, myName, now, correct);
            const pos = _getSpeedPoints(battleId, qi, myUid);
            if (correct && pos > 0) {
              _showSpeedToast(pos);
            }
          }
        }
      } catch(e) {}
    };

    /* ── Patch BA._renderActiveQuiz to add live chat + ELO badge + speed labels ── */
    const _origRenderActiveQuiz = window.BA._renderActiveQuiz.bind(window.BA);
    window.BA._renderActiveQuiz = function(battle) {
      _origRenderActiveQuiz(battle);

      // Append live chat bar to quiz body — but ONLY ONCE per question render
      // (the inner _origRenderActiveQuiz has a hash-guard and may return early,
      //  so we check whether the body was actually re-rendered by looking for
      //  a fresh wrapper that has NO chat bar yet)
      const body = document.getElementById('ba-body');
      if (!body) return;

      // Skip if ELO bar already present in this render (prevents duplicate stacking)
      if (body.querySelector('.ba-elo-chat-bar')) return;

      const cosm = getActiveCosmetics();
      const eloDiv = document.createElement('div');
      eloDiv.className = 'ba-elo-chat-bar';
      eloDiv.innerHTML = `
        <!-- ELO + Coins bar -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          ${EloWidget.renderBadge()}
          <span class="ba-coins-badge">🪙 ${getCoins()}</span>
          <span style="font-size:12px;color:rgba(26,26,38,0.70);">
            ${cosm.avatar.emoji} <span style="color:${cosm.nameColor.color.startsWith('linear') ? '#fff' : cosm.nameColor.color}">${typeof getMyName === 'function' ? getMyName() : 'You'}</span>
          </span>
        </div>

        <!-- Live Chat Reactions -->
        <div class="ba-chat-bar" id="ba-chat-bar-${battle.id || 'x'}">
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','😂 Easy question')">😂</button>
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','🔥 Catch me if you can')">🔥</button>
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','🏆 I\\'m winning')">🏆</button>
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','😤 Focus!')">😤</button>
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','👏 Good one')">👏</button>
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','🤯 Tricky!')">🤯</button>
        </div>
        <div class="ba-chat-log" id="ba-chat-log-${battle.id || 'x'}"></div>`;

      // Insert before the quiz question (append at bottom so it's below the quiz)
      body.appendChild(eloDiv);

      // Load existing chat messages
      _renderChatLog(battle.id);
    };

    /* Chat send + display */
    window.BA._sendChat = async function(battleId, msg) {
      if (!battleId) return;
      const myName = typeof getMyName === 'function' ? getMyName() : 'You';
      const myUid = _uid();
      const cosm = getActiveCosmetics();

      try {
        const db = window._firebaseDb;
        const { doc, updateDoc, arrayUnion } = window._firebaseFns;
        await updateDoc(doc(db, 'publicBattles', battleId), {
          chatMessages: arrayUnion({
            uid: myUid,
            name: myName,
            avatar: cosm.avatar.emoji,
            nameColor: cosm.nameColor.color,
            msg,
            ts: Date.now()
          })
        });
      } catch(e) {}

      // Optimistic local display
      _appendChatMsg(battleId, myName, msg, cosm.nameColor.color, cosm.avatar.emoji);
    };

    /* Poll chat messages during active battle */
    const _origPollGame = window.BA._pollGameBattle.bind(window.BA);
    window.BA._pollGameBattle = async function(battleId) {
      await _origPollGame(battleId);
      // Re-render chat log
      try {
        const db = window._firebaseDb;
        const { doc, getDoc } = window._firebaseFns;
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (snap.exists()) {
          const msgs = snap.data().chatMessages || [];
          _syncChatLog(battleId, msgs);
        }
      } catch(e) {}
    };

    /* ── Patch _renderLbContent to show ELO + cosmetics ── */
    const _origRenderLbContent = window.BA._renderLbContent.bind(window.BA);
    window.BA._renderLbContent = function(body, entries, weekKey, myUid) {
      _origRenderLbContent(body, entries, weekKey, myUid);

      // Inject ELO progress at top
      const eloHtml = EloWidget.renderProgress();
      const shopBtn = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <button onclick="CosmeticsShop.open()" style="flex:1;padding:10px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:10px;color:#f59e0b;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">🏪 Cosmetics Shop</button>
        <button onclick="BA._renderEloLeaderboard()" style="flex:1;padding:10px;background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.3);border-radius:10px;color:#5b46d4;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">📊 ELO Rankings</button>
      </div>`;

      const topDiv = document.createElement('div');
      topDiv.innerHTML = eloHtml + shopBtn;
      body.insertBefore(topDiv, body.firstChild);
    };

    /* ELO leaderboard view */
    window.BA._renderEloLeaderboard = function() {
      const body = document.getElementById('lb-body');
      if (!body) return;

      // Build ELO tier overview
      const myElo = getMyElo();
      const myTier = getEloTier(myElo);

      let html = `
        <button class="ba-promo-btn" style="margin-bottom:14px;" onclick="BA._renderLeaderboard()">← Back to XP Leaderboard</button>
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:rgba(26,26,38,0.70);text-transform:uppercase;margin-bottom:12px;">ELO Rank Tiers</div>`;

      ELO_TIERS.slice().reverse().forEach(tier => {
        const isCurrentTier = tier.name === myTier.name;
        html += `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:${isCurrentTier ? tier.bg : 'rgba(255,255,255,0.02)'};border:1px solid ${isCurrentTier ? tier.color+'60' : 'rgba(108,99,255,0.1)'};border-radius:12px;margin-bottom:8px;">
          <span style="font-size:24px;">${tier.emoji}</span>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:700;color:${tier.color};">${tier.name} ${isCurrentTier ? '<span style="font-size:10px;background:rgba(108,99,255,0.2);color:#5b46d4;padding:1px 6px;border-radius:10px;">YOU</span>' : ''}</div>
            <div style="font-size:11px;color:rgba(26,26,38,0.70);">${tier.min === 2300 ? '2300+' : `${tier.min} – ${tier.max}`} ELO · K-Factor: ${tier.kFactor}</div>
          </div>
          ${isCurrentTier ? `<div style="font-size:14px;font-weight:800;color:${tier.color};">${myElo}</div>` : ''}
        </div>`;
      });

      html += `<div style="background:rgba(108,99,255,0.06);border:1px solid rgba(108,99,255,0.2);border-radius:12px;padding:12px 14px;margin-top:8px;font-size:12px;line-height:1.6;color:rgba(26,26,38,0.7);">
        <strong>How ELO works:</strong><br>
        • Win against stronger players → <strong style="color:#4ade80;">more ELO gained</strong><br>
        • Lose to weaker players → <strong style="color:#f87171;">more ELO lost</strong><br>
        • K-Factor decreases at higher ranks (harder to gain points)<br>
        • Starting ELO: ${DEFAULT_ELO} (Silver)
      </div>`;

      body.innerHTML = html;
    };
  });

  /* ─────────────────────────────────────────────────────────────
   * 10. PATCH CF (Group Study) battles with same features
   * ───────────────────────────────────────────────────────────── */
  function waitForCF(cb) {
    if (window.CF && typeof window.CF._renderQuizResults === 'function') { cb(); return; }
    setTimeout(() => waitForCF(cb), 200);
  }

  waitForCF(() => {
    /* Patch _renderQuizResults for group study — add ELO + highlights (NO coins for group study) */
    const _origGroupResults = window.CF._renderQuizResults.bind(window.CF);
    window.CF._renderQuizResults = function(quiz, memberNames) {
      _origGroupResults(quiz, memberNames);

      const body = document.getElementById('cf-quiz-area');
      if (!body) return;

      const myUid = _uid();
      const xp = quiz?.xp || {};

      const eloDelta = updateEloAfterBattle(myUid, xp[myUid] || 0, xp);
      const newElo = getMyElo();
      const tier = getEloTier(newElo);

      const sorted = Object.entries(xp).sort((a,b) => b[1]-a[1]);

      const h = computeHighlights({ quiz, playerNames: memberNames, questions: quiz?.questions || [] });

      const eloSection = document.createElement('div');
      eloSection.style.cssText = 'margin-top:12px;';
      eloSection.innerHTML = `
        <div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.25);border-radius:14px;padding:14px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:700;color:var(--text-primary);">📊 ELO Change</span>
            <span class="${eloDelta >= 0 ? 'elo-delta-pos' : 'elo-delta-neg'}">${eloDelta >= 0 ? '+' : ''}${eloDelta} ELO</span>
          </div>
          ${EloWidget.renderProgress()}
        </div>
        ${(h.accuracyKing || h.comeback) ? `
        <div class="ba-highlights-wrap">
          <div class="ba-highlights-title">⭐ Battle Highlights</div>
          <div class="ba-highlights-grid">
            ${h.accuracyKing ? `<div class="ba-highlight-card"><div class="ba-highlight-icon">🎯</div><div class="ba-highlight-label">Accuracy King</div><div class="ba-highlight-name">${h.accuracyKing}</div></div>` : ''}
            ${h.comeback ? `<div class="ba-highlight-card"><div class="ba-highlight-icon">🔥</div><div class="ba-highlight-label">Comeback Player</div><div class="ba-highlight-name">${h.comeback}</div></div>` : `<div class="ba-highlight-card"><div class="ba-highlight-icon">🏅</div><div class="ba-highlight-label">MVP</div><div class="ba-highlight-name">${sorted[0] ? (memberNames?.[sorted[0][0]] || 'Player') : '—'}</div></div>`}
          </div>
        </div>` : ''}
        <div style="text-align:center;margin-top:10px;">
          <button onclick="CosmeticsShop.open()" style="padding:9px 18px;background:linear-gradient(135deg,rgba(245,158,11,0.2),rgba(255,107,157,0.2));border:1px solid rgba(245,158,11,0.4);border-radius:10px;color:#f59e0b;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">🏪 Cosmetics Shop</button>
        </div>`;

      body.appendChild(eloSection);
    };

    /* Patch _renderQuizQuestion for group study — add ELO badge + emoji chat + speed labels */
    const _origGroupQuestion = window.CF._renderQuizQuestion.bind(window.CF);
    window.CF._renderQuizQuestion = function(quiz, groupId, memberNames) {
      _origGroupQuestion(quiz, memberNames, groupId);

      const body = document.getElementById('cf-quiz-area');
      if (!body) return;

      const cosm = getActiveCosmetics();
      const eloBar = document.createElement('div');
      eloBar.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;padding:0 0 6px;border-bottom:1px solid rgba(108,99,255,0.1);">
          ${EloWidget.renderBadge()}
          <span class="ba-coins-badge">🪙 ${getCoins()}</span>
          <span style="font-size:12px;color:${cosm.nameColor.color.startsWith('linear') ? '#fff' : cosm.nameColor.color};">${cosm.avatar.emoji} ${typeof getMyName === 'function' ? getMyName() : 'You'}</span>
        </div>
        <!-- Group chat reactions -->
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;">
          <button class="ba-chat-btn" onclick="CF._sendGroupChat('${groupId}','😂 Easy question')">😂</button>
          <button class="ba-chat-btn" onclick="CF._sendGroupChat('${groupId}','🔥 Catch me if you can')">🔥</button>
          <button class="ba-chat-btn" onclick="CF._sendGroupChat('${groupId}','🏆 I\\'m winning')">🏆</button>
          <button class="ba-chat-btn" onclick="CF._sendGroupChat('${groupId}','😤 Focus!')">😤</button>
          <button class="ba-chat-btn" onclick="CF._sendGroupChat('${groupId}','🤯 Tricky!')">🤯</button>
        </div>
        <div class="ba-chat-log" id="cf-chat-log-${groupId}" style="max-height:60px;"></div>`;

      const wrap = body.querySelector('.cf-quiz-battle-wrap');
      if (wrap) {
        wrap.insertBefore(eloBar, wrap.firstChild);
      }
    };

    /* Group study emoji send */
    window.CF._sendGroupChat = async function(groupId, msg) {
      if (!groupId) return;
      const myName = typeof getMyName === 'function' ? getMyName() : 'You';
      const cosm = getActiveCosmetics();
      try {
        const db = window._firebaseDb;
        const { doc, updateDoc, arrayUnion } = window._firebaseFns;
        await updateDoc(doc(db, 'studyGroups', groupId), {
          battleChat: arrayUnion({ uid: _uid(), name: myName, avatar: cosm.avatar.emoji, nameColor: cosm.nameColor.color, msg, ts: Date.now() })
        });
      } catch(e) {}
      _appendChatMsg(groupId, myName, msg, cosm.nameColor.color, cosm.avatar.emoji, 'cf');
    };

    /* Speed-patch group answer submission */
    const _origGroupSubmit = window.CF._submitQuizAnswer.bind(window.CF);
    if (typeof _origGroupSubmit === 'function') {
      window.CF._submitQuizAnswer = async function(groupId, qIdx, chosenIdx) {
        const now = Date.now();
        const myUid = _uid();
        const myName = typeof getMyName === 'function' ? getMyName() : 'You';
        const q = window.CF._currentGroupData?.quiz?.questions?.[qIdx];
        const correct = q ? chosenIdx === q.ans : false;

        await _origGroupSubmit(groupId, qIdx, chosenIdx);

        _recordAnswer(groupId, qIdx, myUid, myName, now, correct);
        const pos = _getSpeedPoints(groupId, qIdx, myUid);
        if (correct && pos > 0) _showSpeedToast(pos);
      };
    }
  });

  /* ─────────────────────────────────────────────────────────────
   * 11. CHAT LOG HELPERS
   * ───────────────────────────────────────────────────────────── */
  function _appendChatMsg(battleId, name, msg, nameColor, avatar, prefix) {
    const logId = (prefix || 'ba') + '-chat-log-' + battleId;
    const log = document.getElementById(logId);
    if (!log) return;
    const el = document.createElement('div');
    el.className = 'ba-chat-msg';
    const nc = nameColor && !nameColor.startsWith('linear') ? nameColor : '#a78bfa';
    el.innerHTML = `<span style="font-size:12px;">${avatar || ''}</span> <span class="ba-chat-name" style="color:${nc};">${name}</span>: ${msg}`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    // Auto-prune to last 10 messages
    while (log.children.length > 10) log.removeChild(log.firstChild);
  }

  function _renderChatLog(battleId) {
    // Will be populated by poll cycle
  }

  let _lastChatMsgCount = {};
  function _syncChatLog(battleId, msgs) {
    const logId = 'ba-chat-log-' + battleId;
    const log = document.getElementById(logId);
    if (!log) return;
    const lastCount = _lastChatMsgCount[battleId] || 0;
    const newMsgs = msgs.slice(lastCount);
    _lastChatMsgCount[battleId] = msgs.length;
    newMsgs.forEach(m => {
      _appendChatMsg(battleId, m.name, m.msg, m.nameColor, m.avatar, 'ba');
    });
  }

  /* ─────────────────────────────────────────────────────────────
   * 12. SPEED TOAST
   * ───────────────────────────────────────────────────────────── */
  function _showSpeedToast(points) {
    const labels = { 10: '⚡ 1st! +10 pts', 8: '🥈 2nd! +8 pts', 6: '🥉 3rd! +6 pts' };
    const el = document.createElement('div');
    el.className = 'speed-toast';
    el.textContent = labels[points] || `+${points} pts`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  /* ─────────────────────────────────────────────────────────────
   * 13. ADD SHOP + ELO BUTTONS to existing BA leaderboard trigger
   * ───────────────────────────────────────────────────────────── */
  function addShopButton() {
    // Add a cosmetics shop button near existing battle buttons in sidebar
    const lbBtn = document.getElementById('openLeaderboardBtn');
    if (lbBtn && !lbBtn.parentNode.querySelector('#openShopBtn')) {
      const shopBtn = document.createElement('button');
      shopBtn.id = 'openShopBtn';
      shopBtn.className = lbBtn.className;
      shopBtn.innerHTML = lbBtn.innerHTML.replace(/Leaderboard|🏆/g, '').trim()
        ? ''
        : '';
      shopBtn.style.cssText = lbBtn.style.cssText || '';
      shopBtn.onclick = () => {
        if (typeof closeDrawer === 'function') closeDrawer();
        setTimeout(() => CosmeticsShop.open(), 200);
      };
      lbBtn.insertAdjacentElement('afterend', shopBtn);
    }
  }

  // Wire on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { injectEloStyles(); createShopModal(); addShopButton(); });
  } else {
    injectEloStyles();
    createShopModal();
    addShopButton();
  }

  // Wire once, guarded — not on every click
  let _shopBtnWiredOnce = false;
  function _tryAddShopButton() {
    if (_shopBtnWiredOnce) return;
    if (addShopButton()) _shopBtnWiredOnce = true;
  }
  // addShopButton returns truthy only if the button was actually inserted
  (function() {
    const _orig = addShopButton;
    addShopButton = function() { const lbBtn = document.getElementById('openLeaderboardBtn'); if (!lbBtn) return false; _orig(); return true; };
  })();
  // Try once at start, then re-try only when the drawer opens (not every click)
  _tryAddShopButton();
  document.addEventListener('click', function(e) {
    if (_shopBtnWiredOnce) return;
    if (e.target && (e.target.id === 'menuBtn' || e.target.closest && e.target.closest('#historyDrawer'))) {
      setTimeout(_tryAddShopButton, 150);
    }
  }, { passive: true });

  /* ─────────────────────────────────────────────────────────────
   * GROUP STUDY — AUTO-DELETE MESSAGES WHEN ALL MEMBERS HAVE READ
   *
   *   Strategy (Firebase-cost efficient):
   *   • Each message carries a `readBy: [uid, ...]` array
   *   • On each chat render, ONE updateDoc batches all new reads
   *   • Poller checks: readBy.length >= memberCount → delete after 5s
   *   • Deletions are batched into one single updateDoc (rewrite array)
   * ───────────────────────────────────────────────────────────── */

  const _pendingMsgDeletes = {}; // { msgKey: timeoutId }

  function _msgKey(msg) {
    return (msg.uid || 'x') + '_' + (msg.ts || 0);
  }

  async function _markMessagesRead(groupId, messages) {
    if (!groupId || !messages || !messages.length) return;
    const myUid = uid();
    if (!myUid || myUid === 'guest') return;
    const unread = messages.filter(m => !(m.readBy || []).includes(myUid));
    if (!unread.length) return;
    const updated = messages.map(m => {
      const rb = m.readBy || [];
      return rb.includes(myUid) ? m : { ...m, readBy: [...rb, myUid] };
    });
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      if (!db || !fns) return;
      await fns.updateDoc(fns.doc(db, 'studyGroups', groupId), { messages: updated });
    } catch (_) {}
  }

  function _scheduleReadMessageCleanup(groupId, messages, memberCount) {
    if (!groupId || !messages || memberCount < 1) return;
    const fullyRead = messages.filter(m => (m.readBy || []).length >= memberCount);
    if (!fullyRead.length) return;

    fullyRead.forEach(m => {
      const key = _msgKey(m);
      if (_pendingMsgDeletes[key]) return; // already scheduled

      _pendingMsgDeletes[key] = setTimeout(async () => {
        try {
          const db  = window._firebaseDb;
          const fns = window._firebaseFns;
          if (!db || !fns) return;
          const { doc, getDoc, updateDoc } = fns;
          const snap = await getDoc(doc(db, 'studyGroups', groupId));
          if (!snap.exists()) return;
          const current    = snap.data().messages || [];
          const latestCount = snap.data().memberCount
            || Object.keys(snap.data().memberNames || {}).length
            || memberCount;
          // Retain messages that have NOT been fully read yet
          const retained = current.filter(msg => (msg.readBy || []).length < latestCount);
          if (retained.length < current.length) {
            await updateDoc(doc(db, 'studyGroups', groupId), { messages: retained });
          }
        } catch (_) {}
        delete _pendingMsgDeletes[key];
      }, 5000);
    });
  }

  /* Patch StudyGroups.sendMessage to include readBy from creation */
  function _patchStudyGroupsSend() {
    if (!window.StudyGroups?.sendMessage) return;
    if (window.StudyGroups._sendPatched) return;
    const orig = window.StudyGroups.sendMessage.bind(window.StudyGroups);
    window.StudyGroups.sendMessage = async function (groupId, msgObj, ...rest) {
      const myUid = uid();
      const patched = {
        ...msgObj,
        readBy: msgObj.readBy ? [...new Set([...msgObj.readBy, myUid])] : [myUid]
      };
      return orig(groupId, patched, ...rest);
    };
    window.StudyGroups._sendPatched = true;
  }

  /* Patch CF._renderChatMessages to mark messages as read */
  function _patchCFChat() {
    if (!window.CF) return;
    if (window.CF._readTrackingPatched) return;

    const _origRender = window.CF._renderChatMessages && typeof window.CF._renderChatMessages === 'function' ? window.CF._renderChatMessages.bind(window.CF) : null;
    if (_origRender) {
      window.CF._renderChatMessages = function (messages) {
        _origRender(messages);
        const gid = window.CF._currentGroupId;
        if (gid && messages && messages.length) {
          _markMessagesRead(gid, messages);
        }
      };
    }

    /* Patch the chat poller to also run cleanup checks */
    if (window.CF._openGroupChat && typeof window.CF._openGroupChat === 'function') {
      const _origOpenGC = window.CF._openGroupChat.bind(window.CF);
      window.CF._openGroupChat = async function (groupId) {
        await _origOpenGC(groupId);

        if (window.CF._chatPollInterval) clearInterval(window.CF._chatPollInterval);

        const db  = window._firebaseDb;
        const fns = window._firebaseFns;

        window.CF._chatPollInterval = setInterval(async () => {
          if (!window.CF._currentGroupId) return;
          if (window.CF._answerAnimating) return;

          try {
            const snap = await fns.getDoc(fns.doc(db, 'studyGroups', window.CF._currentGroupId));
            if (!snap.exists()) { window.CF._stopChatPolling?.(); return; }

            const data = snap.data();
            const messages    = data.messages || [];
            const memberCount = data.memberCount
              || Object.keys(data.memberNames || {}).length
              || (data.members || []).length
              || 1;

            const newHash = JSON.stringify({
              msgs:     messages.length,
              quiz:     data.quiz ? data.quiz.current : null,
              qstatus:  data.quiz ? data.quiz.status  : null,
              qanswers: data.quiz ? Object.keys(data.quiz.answers || {}).length : 0
            });

            if (newHash !== window.CF._chatPollHash) {
              window.CF._chatPollHash     = newHash;
              window.CF._currentGroupData = data;
              window.CF._renderChatMessages(messages);

              if (!window.CF._answerAnimating) {
                const status = data.quiz?.status;
                if (status === 'active') {
                  window.CF._renderQuizQuestion(data.quiz, window.CF._currentGroupId, data.memberNames);
                } else if (status === 'finished') {
                  window.CF._renderQuizResults(data.quiz, data.memberNames);
                } else if (status === 'abandoned') {
                  const qa = document.getElementById('cf-quiz-area');
                  if (qa) {
                    qa.innerHTML = '<div style="text-align:center;padding:16px;color:rgba(26,26,38,0.70);font-size:13px">🚫 Battle ended by admin.</div>';
                    setTimeout(() => { if (qa) qa.innerHTML = ''; }, 3000);
                  }
                } else {
                  const qa = document.getElementById('cf-quiz-area');
                  if (qa) qa.innerHTML = '';
                }
              }
            }

            // Schedule deletion for fully-read messages
            _scheduleReadMessageCleanup(window.CF._currentGroupId, messages, memberCount);

          } catch (_) {}
        }, 3000);
      };
    }

    window.CF._readTrackingPatched = true;
  }

  /* Try to apply CF and StudyGroups patches as soon as they are ready */
  function _initV3Patches() {
    _patchStudyGroupsSend();
    _patchCFChat();
    // Load coins from Firestore for cross-device persistence
    _loadCoinsFromFirestore();
  }

  if (window._firebaseDb && window._firebaseFns) {
    _initV3Patches();
  } else {
    let _v3Tries = 0;
    const _v3Check = setInterval(() => {
      _v3Tries++;
      _patchStudyGroupsSend();
      _patchCFChat();
      if (window._firebaseDb && window._firebaseFns) {
        clearInterval(_v3Check);
        _loadCoinsFromFirestore();
      } else if (_v3Tries > 60) {
        clearInterval(_v3Check);
      }
    }, 500);
  }


  /* ── Study Groups: delegate to CF.openStudyGroups() in crackai-features.js ──
   * The full gated system (admin pays, students join free) lives in
   * crackai-features.js (CF object). We just wire up the sidebar button here.
   * ─────────────────────────────────────────────────────────────────────────── */
  function _openStudyGroups() {
    try {
      // Use the gated CF system from crackai-features.js
      if (typeof CF !== 'undefined' && typeof CF.openStudyGroups === 'function') {
        CF.openStudyGroups();
        return;
      }
      // Fallback: look for it on window._CrackAI
      if (window._CrackAI && typeof window._CrackAI.openStudyGroups === 'function') {
        window._CrackAI.openStudyGroups();
        return;
      }
      // Last resort: dispatch a custom event so index.js can handle it
      document.dispatchEvent(new CustomEvent('crackai:openStudyGroups'));
    } catch(e) { console.error('[BA] openStudyGroups error', e); }
  }



  console.info('[BattleArena] v3.2.1 — Countdown lag FIXED + polling race conditions resolved');

})();