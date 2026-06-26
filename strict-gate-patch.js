/**
 * strict-gate-patch.js — CrackAI Hard Paywall v2.0
 * 0 free chats (all models require premium)
 * 3 FREE mock tests/day, 3 FREE battles/day for all users (tracked on actual start)
 * NO free chat messaging in sidebar
 * Group creation restricted to Premium users
 */
(function () {
  'use strict';

  var FREE_TEXT  = 0;
  var FREE_IMAGE = 0;
  var FREE_PDF   = 0;
  var FREE_BATTLES = 3;
  var FREE_MOCK_TESTS = 3;

  /* ── Robust premium verification ─────────────────────────── */
  window._premiumStatusMap = {};
  
  window.getPremiumStatus = async function(uid) {
    if (!uid) return false;
    
    // Check cache first (valid for 5 minutes)
    const cached = window._premiumStatusMap[uid];
    if (cached && (Date.now() - cached.time) < 300000) {
      return cached.status;
    }
    
    // Check Firestore first (source of truth)
    try {
      const db = window._firebaseDb;
      const { doc, getDoc } = window._firebaseFns || {};
      if (db && getDoc) {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
          const data = snap.data();
          const isPrem = data.isPremium || data.premium || false;
          window._premiumStatusMap[uid] = { status: isPrem, time: Date.now() };
          localStorage.setItem('sscai_u:' + uid + ':premium', isPrem ? 'true' : 'false');
          return isPrem;
        }
      }
    } catch(e) {
      console.error('[Premium] Firestore check error:', e);
    }
    
    // Fallback to localStorage
    const localStatus = localStorage.getItem('sscai_u:' + uid + ':premium') === 'true';
    window._premiumStatusMap[uid] = { status: localStatus, time: Date.now() };
    return localStatus;
  };

  /* ── Sync premium status from Firestore on login ──────────── */
  window.syncPremiumStatus = async function(uid) {
    if (!uid) return;
    const db = window._firebaseDb;
    const { doc, getDoc } = window._firebaseFns || {};
    if (!db || !getDoc) return;
    
    try {
      // Clear cache to force fresh fetch
      window._premiumStatusMap[uid] = null;
      
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        const data = snap.data();
        const isPrem = data.isPremium || data.premium || false;
        localStorage.setItem('sscai_u:' + uid + ':premium', isPrem ? 'true' : 'false');
        
        // Also sync the premium plan
        if (data.premiumPlan) {
          localStorage.setItem('sscai_u:' + uid + ':premium_plan', data.premiumPlan);
        }
        
        window._premiumStatusMap[uid] = { status: isPrem, time: Date.now() };
        
        if (typeof state !== 'undefined') {
          state.isPremium = isPrem;
          if (isPrem) state.premiumPlan = data.premiumPlan || 'premium';
        }
        
        if (isPrem) {
          console.info('[StrictGate] Premium status confirmed from Firestore');
        }
      }
    } catch(e) {
      console.error('[Premium] Sync error:', e);
    }
  };

  /* ── Open premium modal safely ────────────────────────────── */
  function openPremium() {
    try {
      if (typeof openPremiumModal === 'function') { openPremiumModal(); return; }
      if (typeof window.showPremiumModal === 'function') { window.showPremiumModal(); return; }
      var m = document.getElementById('premiumModal');
      if (m) m.classList.add('active');
    } catch (e) {}
  }

  /* ── Disable reward / ad bypass ──────────────────────────── */
  window.isRewardActive      = function () { return false; };
  window.rewardRemainingMs   = function () { return 0; };
  window.rewardRemainingLabel= function () { return '0:00'; };
  window.showRewardPopup     = function () { openPremium(); };
  window.activateReward      = function () {};

  /* ── canSend* functions (0 free - ALL require premium) ──────── */
  function canText()  { return false; }
  function canImage() { return false; }
  function canPdf()   { return false; }

  window.canSendText  = canText;
  window.canSendImage = canImage;
  window.canSendPdf   = canPdf;

  /* ── handleLimitHit ──────────────────────────────────────── */
  window.handleLimitHit = function (type) {
    var labels = { text: '🔒 All AI chats require Premium', image: '🔒 All models require Premium', pdf: '🔒 All models require Premium' };
    try { if (typeof showToast === 'function') showToast((labels[type] || 'Upgrade Required') + ' — Start from ₹129/month'); } catch(e){}
    openPremium();
  };

  /* ── Mock Test limit (3 per day FREE) - Only track on actual start, use Firestore for persistence ────────────────────── */
  window.getMockTestUsageToday = async function() {
    const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
    if (!uid) return 0;
    
    // First check Firestore for source of truth
    try {
      const db = window._firebaseDb;
      const { doc, getDoc } = window._firebaseFns || {};
      if (db && getDoc) {
        const today = new Date().toISOString().split('T')[0];
        const snap = await getDoc(doc(db, 'users', uid, 'dailyUsage', today));
        if (snap.exists()) {
          return snap.data().mockTests || 0;
        }
      }
    } catch(e) {}
    
    // Fallback to localStorage
    const today = new Date().toISOString().split('T')[0];
    const key = 'sscai_mock_' + today + '_' + uid;
    return parseInt(localStorage.getItem(key) || '0');
  };

  window.checkMockTestAccess = async function() {
    const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
    
    if (!uid) {
      return { allowed: false, reason: '🔒 Please login first to access Mock Tests' };
    }
    
    const isPrem = await window.getPremiumStatus(uid);
    
    if (isPrem) {
      return { allowed: true, reason: 'Premium user - unlimited mock tests', unlimited: true };
    }
    
    // FREE USERS: 3 per day
    const today = new Date().toISOString().split('T')[0];
    const count = await window.getMockTestUsageToday();
    const remaining = Math.max(0, FREE_MOCK_TESTS - count);
    
    if (count >= FREE_MOCK_TESTS) {
      return { 
        allowed: false, 
        reason: '🔒 Daily mock test limit reached (3/day free). Upgrade to Premium for unlimited.', 
        limit: 3, 
        used: count,
        remaining: 0
      };
    }
    
    return { allowed: true, used: count, limit: 3, remaining: remaining };
  };

  /* ── Track mock test usage - Called ONLY when test actually starts, persists in Firestore ──────────────────────────– */
  window.trackMockTestUsage = async function() {
    const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
    if (!uid) return;
    
    const isPrem = await window.getPremiumStatus(uid);
    if (!isPrem) {
      const today = new Date().toISOString().split('T')[0];
      
      // Try to save to Firestore first (source of truth)
      try {
        const db = window._firebaseDb;
        const { doc, setDoc } = window._firebaseFns || {};
        if (db && setDoc) {
          const docRef = doc(db, 'users', uid, 'dailyUsage', today);
          const currentCount = await window.getMockTestUsageToday();
          const newCount = currentCount + 1;
          await setDoc(docRef, { mockTests: newCount, timestamp: new Date() }, { merge: true });
          const remaining = Math.max(0, FREE_MOCK_TESTS - newCount);
          try { if (typeof showToast === 'function') showToast(`📝 Mock Test Started · Used 1/3 · ${remaining} remaining today`); } catch(e){}
          return;
        }
      } catch(e) {}
      
      // Fallback to localStorage
      const key = 'sscai_mock_' + today + '_' + uid;
      const count = parseInt(localStorage.getItem(key) || '0');
      localStorage.setItem(key, (count + 1).toString());
      const newCount = count + 1;
      const remaining = Math.max(0, FREE_MOCK_TESTS - newCount);
      try { if (typeof showToast === 'function') showToast(`📝 Mock Test Started · Used 1/3 · ${remaining} remaining today`); } catch(e){}
    }
  };

  /* ── Patch sendMessage ────────────────────────────────────── */
  function patchSendMessage() {
    var _orig = window.sendMessage;
    if (typeof _orig !== 'function') { setTimeout(patchSendMessage, 150); return; }
    if (_orig._sgPatched) return;
    function patched() {
      try {
        var hasImages = typeof pendingImageFiles !== 'undefined' && pendingImageFiles.length > 0;
        var hasPdf    = typeof pendingPdfFile    !== 'undefined' && !!pendingPdfFile;
        if (hasImages && !canImage()) { window.handleLimitHit('image'); return; }
        if (hasPdf    && !canPdf())   { window.handleLimitHit('pdf');   return; }
        if (!canText())               { window.handleLimitHit('text');  return; }
      } catch(e) {}
      return _orig.apply(this, arguments);
    }
    patched._sgPatched = true;
    window.sendMessage = patched;
  }
  patchSendMessage();

  /* ── Get battle usage today ─────────────────────────────────── */
  window.getBattleUsageToday = async function() {
    const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
    if (!uid) return 0;
    
    // First check Firestore
    try {
      const db = window._firebaseDb;
      const { doc, getDoc } = window._firebaseFns || {};
      if (db && getDoc) {
        const today = new Date().toISOString().split('T')[0];
        const snap = await getDoc(doc(db, 'users', uid, 'dailyUsage', today));
        if (snap.exists()) {
          return snap.data().battles || 0;
        }
      }
    } catch(e) {}
    
    // Fallback to localStorage
    const today = new Date().toISOString().split('T')[0];
    const key = 'sscai_battles_' + today + '_' + uid;
    return parseInt(localStorage.getItem(key) || '0');
  };

  /* ── Battle access gate (3 per day FREE) - Both demo and real ─────────────────── */
  window.checkBattleAccess = async function(battleType) {
    const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
    if (!uid) return { allowed: false, reason: '🔒 Please login first to access Arena Battles' };
    
    const isPrem = await window.getPremiumStatus(uid);
    if (isPrem) return { allowed: true, unlimited: true };
    
    // FREE USERS: 3 per day (demo + real combined)
    const count = await window.getBattleUsageToday();
    const remaining = Math.max(0, FREE_BATTLES - count);
    
    if (count >= FREE_BATTLES) {
      return { 
        allowed: false, 
        reason: '🔒 Daily battle limit reached (3/day free). Upgrade to Premium for unlimited',
        limit: 3,
        used: count,
        remaining: 0
      };
    }
    
    return { allowed: true, used: count, limit: 3, remaining: remaining };
  };

  /* ── Track battle usage - Called ONLY when battle actually starts, persists in Firestore ─────────────────── */
  window.trackBattleUsage = async function(battleType) {
    const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
    if (!uid) return;
    
    const isPrem = await window.getPremiumStatus(uid);
    if (!isPrem) {
      const today = new Date().toISOString().split('T')[0];
      
      // Try to save to Firestore first (source of truth)
      try {
        const db = window._firebaseDb;
        const { doc, setDoc } = window._firebaseFns || {};
        if (db && setDoc) {
          const docRef = doc(db, 'users', uid, 'dailyUsage', today);
          const currentCount = await window.getBattleUsageToday();
          const newCount = Math.min(currentCount + 1, FREE_BATTLES);
          await setDoc(docRef, { battles: newCount, timestamp: new Date() }, { merge: true });
          const remaining = Math.max(0, FREE_BATTLES - newCount);
          try { if (typeof showToast === 'function') showToast(`⚔️ Battle Joined · Used 1/3 · ${remaining} remaining today`); } catch(e){}
          return;
        }
      } catch(e) {}
      
      // Fallback to localStorage
      const key = 'sscai_battles_' + today + '_' + uid;
      const count = parseInt(localStorage.getItem(key) || '0');
      if (count < FREE_BATTLES) {
        localStorage.setItem(key, (count + 1).toString());
      }
      const newCount = Math.min(count + 1, FREE_BATTLES);
      const remaining = Math.max(0, FREE_BATTLES - newCount);
      try { if (typeof showToast === 'function') showToast(`⚔️ Battle Joined · Used 1/3 · ${remaining} remaining today`); } catch(e){}
    }
  };

  /* ── Group creation gate - Premium only ─────────────────── */
  window.checkGroupCreationAccess = async function() {
    const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
    if (!uid) return { allowed: false, reason: 'Please login first' };
    
    const isPrem = await window.getPremiumStatus(uid);
    if (isPrem) return { allowed: true, unlimited: true };
    
    return { 
      allowed: false, 
      reason: '🔒 Group creation requires Premium membership. Upgrade to create unlimited groups.'
    };
  };

  /* ── Patch group creation button ─────────────────────────── */
  function patchGroupCreation() {
    var groupCreateBtns = document.querySelectorAll('[data-action="create-group"], .create-group-btn, #createGroupBtn, [onclick*="createGroup"]');
    groupCreateBtns.forEach(function(btn) {
      if (btn._groupGateBound) return;
      btn._groupGateBound = true;
      var _origClick = btn.onclick;
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        
        const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
        
        if (!uid) {
          try { if (typeof showToast === 'function') showToast('🔒 Please login first to create groups'); } catch(e){}
          openPremium();
          return false;
        }
        
        const isPrem = uid ? (localStorage.getItem('sscai_u:' + uid + ':premium') === 'true') : false;
        
        if (!isPrem) {
          try { if (typeof showToast === 'function') showToast('🔒 Group creation requires Premium. Upgrade to create groups.'); } catch(e){}
          openPremium();
          return false;
        }
        
        if (typeof _origClick === 'function') return _origClick.call(this, e);
        return true;
      }, true);
    });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchGroupCreation);
  } else {
    patchGroupCreation();
  }
  setTimeout(patchGroupCreation, 800);
  setTimeout(patchGroupCreation, 2500);

  /* ── Intercept group admin features - Block for free users and guests ─ */
  document.addEventListener('click', function(e) {
    try {
      var adminFeature = e.target.closest && (e.target.closest('[data-admin-feature]') || e.target.closest('.admin-only'));
      if (!adminFeature) return;
      
      const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
      if (!uid) {
        e.stopImmediatePropagation();
        try { if (typeof showToast === 'function') showToast('🔒 Please login first to create or manage groups'); } catch(ex){}
        openPremium();
        return false;
      }
      
      const isPrem = uid ? (localStorage.getItem('sscai_u:' + uid + ':premium') === 'true') : false;
      
      if (!isPrem) {
        e.stopImmediatePropagation();
        try { if (typeof showToast === 'function') showToast('🔒 Group admin features require Premium'); } catch(ex){}
        openPremium();
        return false;
      }
    } catch(e) {}
  }, true);

  

  document.addEventListener('click', function (e) {
    try {
      var opt = e.target.closest && e.target.closest('.model-option[data-model]');
      if (!opt) return;
      var model = opt.dataset.model;
      if (ALL_MODELS.indexOf(model) === -1) return;
      const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
      const isPrem = uid ? (localStorage.getItem('sscai_u:' + uid + ':premium') === 'true') : false;
      if (isPrem) return;
      e.stopImmediatePropagation();
      try { if (typeof showToast === 'function') showToast('🔒 All models require Premium — Start from ₹129/month'); } catch(ex){}
      openPremium();
      document.querySelectorAll('.model-selector-dropdown').forEach(function(d){ d.classList.remove('open'); });
    } catch(e) {}
  }, true);

  /* ── Teacher / Voice-AI gate ─────────────────────────────── */
  function restoreTeacherGate() {
    try {
      window.__teacherAlwaysFree = false;
      const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
      const isPrem = uid ? (localStorage.getItem('sscai_u:' + uid + ':premium') === 'true') : false;
      if (!isPrem) localStorage.removeItem('sscai_teacher_unlocked');
      window.openTeacherPaywall = function () {
        try { if (typeof showToast === 'function') showToast('🔒 Teacher Mode requires Premium'); } catch(ex){}
        openPremium();
      };
    } catch(e) {}
  }
  restoreTeacherGate();
  setTimeout(restoreTeacherGate, 500);
  setTimeout(restoreTeacherGate, 2500);
  window.addEventListener('load', restoreTeacherGate);

  /* ── Upload button gates ─────────────────────────────────── */
  function patchUploadBtns() {
    function gateBtn(id, limitFn, type) {
      var btn = document.getElementById(id);
      if (!btn || btn._sgBound) return;
      btn._sgBound = true;
      btn.addEventListener('click', function (e) {
        if (!limitFn()) {
          e.stopImmediatePropagation();
          try {
            var sub  = document.getElementById('uploadSubMenu');
            var wrap = document.getElementById('uploadBtnWrap');
            if (sub)  sub.style.display = 'none';
            if (wrap) wrap.classList.remove('open');
          } catch(ex){}
          window.handleLimitHit(type);
        }
      }, true);
    }
    gateBtn('imageUploadBtn', canImage, 'image');
    gateBtn('pdfUploadBtn',   canPdf,   'pdf');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchUploadBtns);
  } else {
    patchUploadBtns();
  }
  setTimeout(patchUploadBtns, 800);
  setTimeout(patchUploadBtns, 2500);

  /* ── HIDE message limit info entirely (no free chat messaging) – */
  var _origUpdateLimitUI = window.updateLimitUI;
  window.updateLimitUI = function () {
    try { if (typeof _origUpdateLimitUI === 'function') _origUpdateLimitUI(); } catch(e){}
    try {
      var el = document.getElementById('messageLimitInfo');
      if (el) el.remove();
      
      // Hide all message limit displays in sidebar - multiple selectors to catch all variations
      document.querySelectorAll('[data-limit="messages"], .message-limit-info, .free-chats-left, .chat-limit-badge, .limit-info, [data-chats-left], .chats-remaining, .sidebar-limit-counter, [class*="limit"], [class*="chat-count"], [class*="message-count"]').forEach(function(e) {
        if (e.textContent && (e.textContent.includes('left') || e.textContent.includes('chat') || e.textContent.includes('message'))) {
          e.style.display = 'none';
        }
      });
      
      // Aggressively hide anything mentioning "left" or chat limits
      document.querySelectorAll('*').forEach(function(el) {
        if (el.textContent && /(\d+\s+(chats?|messages?)\s+left|free.*(chat|message))/i.test(el.textContent) && el.classList && el.classList.length > 0) {
          el.style.display = 'none';
        }
      });
      
    } catch(e) {}
  };
  
  // Call immediately and periodically
  window.updateLimitUI();
  setInterval(function() {
    window.updateLimitUI();
  }, 3000);

  /* ── Voice/Microphone Premium Gate ──────────────────────────── */
  function patchVoiceGate() {
    const voiceBtn = document.getElementById('voiceInputBtn');
    if (!voiceBtn || voiceBtn._voiceGateBound) return;
    voiceBtn._voiceGateBound = true;
    voiceBtn.addEventListener('click', function(e) {
      const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
      const isPrem = uid ? (localStorage.getItem('sscai_u:' + uid + ':premium') === 'true') : false;
      
      if (!isPrem) {
        e.preventDefault();
        e.stopImmediatePropagation();
        try { if (typeof showToast === 'function') showToast('🔒 Voice input requires Premium'); } catch(e){}
        openPremium();
        return false;
      }
    }, true);
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchVoiceGate);
  } else {
    patchVoiceGate();
  }
  setTimeout(patchVoiceGate, 800);
  setTimeout(patchVoiceGate, 2500);

  /* ── Guest gate for Premium modal - prevent guests from seeing premium options ── */
  function patchPremiumModal() {
    var _origOpenPremium = window.openPremiumModal;
    window.openPremiumModal = function() {
      const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
      
      if (!uid) {
        try { if (typeof showToast === 'function') showToast('🔒 Please login first to view premium plans'); } catch(e){}
        return false;
      }
      
      if (typeof _origOpenPremium === 'function') return _origOpenPremium();
      var pm = document.getElementById('premiumModal');
      if (pm) pm.classList.add('active');
    };
    
    var upgradeBtn = document.getElementById('profileUpgradeBtn2');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', function(e) {
        const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
        
        if (!uid) {
          e.preventDefault();
          e.stopImmediatePropagation();
          try { if (typeof showToast === 'function') showToast('🔒 Please login first to upgrade'); } catch(ex){}
          return false;
        }
      }, true);
    }
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchPremiumModal);
  } else {
    patchPremiumModal();
  }
  setTimeout(patchPremiumModal, 800);
  setTimeout(patchPremiumModal, 2500);

  /* ── On login: sync premium status from Firestore ──────────– */
  if (typeof window._firebaseAuth !== 'undefined') {
    window._firebaseAuth.onAuthStateChanged(function(user) {
      if (user) {
        window.syncPremiumStatus(user.uid);
      }
    });
  }

  /* ── Periodic re-enforcement ──*/
  let _lastCheck = 0;
  setInterval(function () {
    if (document.visibilityState === 'hidden') return;
    const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
    if (uid && (Date.now() - _lastCheck) > 60000) {
      _lastCheck = Date.now();
      window.syncPremiumStatus(uid).catch(() => {});
    }
    
    if (window.canSendText  !== canText)  window.canSendText  = canText;
    if (window.canSendImage !== canImage) window.canSendImage = canImage;
    if (window.canSendPdf   !== canPdf)   window.canSendPdf   = canPdf;
    window.isRewardActive = function () { return false; };
  }, 10000);

  console.info('[StrictGate] v2.0 — 0 free chats, 3 FREE mock tests/day, 3 FREE battles/day, group creation Premium-only');

})();

/* ── Premium check for Mock Test - ALLOW 3 FREE ── */
(function patchCFMockTest() {
  function patch() {
    if (!window.CF || typeof window.CF.openModal !== 'function') {
      setTimeout(patch, 200);
      return;
    }
    const _orig = window.CF.openMockTest;
    window.CF.openMockTest = async function () {
      const access = await window.checkMockTestAccess();
      if (!access.allowed) {
        try { if (typeof showToast === 'function') showToast(access.reason); } catch(e){}
        try { if (typeof openPremiumModal === 'function') openPremiumModal(); } catch(e){}
        return;
      }
      // ALLOWED: Track usage and open
      await window.trackMockTestUsage();
      if (typeof _orig === 'function') return _orig.call(this);
      window.CF.openModal('cf-mock-modal');
      if (typeof window.CF._renderMockTest === 'function') window.CF._renderMockTest();
    };
    console.info('[StrictGate] Mock Test: 3 FREE/day enabled');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patch);
  } else {
    patch();
  }

  /* ── Periodic premium status verification (every 5 minutes) ────────────── */
  setInterval(async function verifyPremiumStatus() {
    try {
      const uid = (typeof window._firebaseAuth !== 'undefined' && window._firebaseAuth.currentUser) ? window._firebaseAuth.currentUser.uid : null;
      if (!uid) return;
      
      // Force refresh from Firestore (clear cache)
      window._premiumStatusMap[uid] = null;
      const actualPremium = await window.getPremiumStatus(uid);
      
      // Compare with localStorage
      const localPremium = localStorage.getItem('sscai_u:' + uid + ':premium') === 'true';
      
      // If localStorage says premium but Firestore says free, reset localStorage
      if (localPremium && !actualPremium) {
        localStorage.setItem('sscai_u:' + uid + ':premium', 'false');
        if (typeof state !== 'undefined') {
          state.isPremium = false;
        }
        console.warn('[Premium Verification] Revoked fake premium status');
      }
    } catch(e) {}
  }, 5 * 60 * 1000); // Every 5 minutes
})();