/**
 * payment.js — CrackwithAI Payment Module v2.1
 * ──────────────────────────────────────────
 * Uses your already-deployed Cloud Run backend for order creation
 * (Cashfree blocks direct browser API calls via CORS).
 * Verification also goes through your backend for security.
 *
 * Your live endpoints (from app.js):
 *   ORDER:  https://createcashfreeorder-419137308157.us-central1.run.app
 *   VERIFY: https://verifypayment-419137308157.us-central1.run.app
 *
 * Drop in AFTER app.js — auto-overrides all payment functions.
 */

(function () {
  'use strict';

  /* ─── CONFIG ────────────────────────────────────────────────── */
  // Switch to 'sandbox' for testing, 'production' for real payments
  const CF_ENV = 'production';

  // Always use the new Cloud Run URLs — they have CORS open for all origins
  const ORDER_URL  = 'https://createcashfreeorder-56khnynjia-uc.a.run.app';
  const VERIFY_URL = 'https://verifypayment-56khnynjia-uc.a.run.app';

  const PLANS = {
    premium:          { id: 'premium',          name: 'Premium',                price: 199,  emoji: '⭐', features: ['CrackAI Pro', 'Unlimited Mocks', 'All AI Models'] },
    ssc:              { id: 'ssc',              name: 'SSC Pro',                 price: 199,  emoji: '🎯', features: ['CrackAI Pro', 'Unlimited SSC Mocks', 'SSC & Class Tutor'] },
    class:            { id: 'class',            name: 'Class 1-12 Pro',          price: 129,  emoji: '📚', features: ['CrackAI Pro', 'Unlimited Mocks', 'Class 1-12 Content'] },
    semiannual:       { id: 'semiannual',        name: 'SSC 6-Month Plan',        price: 999,  emoji: '🔥', features: ['CrackAI Pro', 'Unlimited Mocks', 'All SSC Content'] },
    yearly:           { id: 'yearly',           name: 'All-in-One Yearly',       price: 1699,  emoji: '🌟', features: ['CrackAI Pro', 'Unlimited Mocks', 'All Content'] },
    // Battle Creator tiers
    battle:           { id: 'battle',           name: 'Battle Creator Basic',    price: 99,   emoji: '⚔️', battleMonthly: 5, features: ['CrackAI Pro', '5 Battles/Month'] },
    battle_pro:       { id: 'battle_pro',       name: 'Battle Creator Pro',      price: 299,  emoji: '⚔️', battleMonthly: 19, features: ['CrackAI Pro', '19 Battles/Month'] },
    battle_academy:   { id: 'battle_academy',   name: 'Battle Creator Academy',  price: 499,  emoji: '⚔️', battleMonthly: 29, features: ['CrackAI Pro', '29 Battles/Month'] },
    battle_extra_3:   { id: 'battle_extra_3',   name: '+3 Battle Creations',     price: 49,   emoji: '⚔️', isAddon: true, battleCredits: 3 },
    battle_extra_7:   { id: 'battle_extra_7',   name: '+7 Battle Creations',     price: 99,   emoji: '⚔️', isAddon: true, battleCredits: 7 },
  };

  const ADDONS = {
    vision_pro_addon: { name: 'PrepAI Vision Pro',   price: 49,  emoji: '🔬' },
    prepaipro_addon:  { name: 'PrepAI Pro',           price: 49,  emoji: '✨' },
    v4pro_addon:      { name: 'PrepAI V4 Pro',         price: 149, emoji: '🚀' },
    battle_extra_3:  { name: '+3 Battle Creations', price: 49,  emoji: '⚔️', isAddon: true, battleCredits: 3 },
    battle_extra_7:  { name: '+7 Battle Creations', price: 99,  emoji: '⚔️', isAddon: true, battleCredits: 7 },
  };

  /* ── Battle Extra Credits helpers ── */
  function getBattleExtraCredits() {
    try {
      const key = 'sscai_battle_extra_credits';
      const data = JSON.parse(localStorage.getItem(key) || '{"credits":0}');
      return data.credits || 0;
    } catch(e) { return 0; }
  }
  function addBattleExtraCreditsToStorage(n) {
    try {
      const key = 'sscai_battle_extra_credits';
      const data = JSON.parse(localStorage.getItem(key) || '{"credits":0}');
      data.credits = (data.credits || 0) + n;
      localStorage.setItem(key, JSON.stringify(data));
    } catch(e) {}
  }
  function useBattleExtraCredit() {
    try {
      const key = 'sscai_battle_extra_credits';
      const data = JSON.parse(localStorage.getItem(key) || '{"credits":0}');
      if ((data.credits || 0) <= 0) return false;
      data.credits = data.credits - 1;
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch(e) { return false; }
  }
  window._battleExtra = { getBattleExtraCredits, useBattleExtraCredit };

  /* ─── HELPERS ───────────────────────────────────────────────── */
  function currentUser()  { return window._firebaseAuth?.currentUser || null; }
  function uid()          { return currentUser()?.uid || ('guest_' + Date.now()); }
  function userEmail()    { return currentUser()?.email || 'student@crackai.in'; }
  function userName()     { return currentUser()?.displayName || 'Student'; }

  async function getToken() {
    try { return await currentUser()?.getIdToken() || null; } catch { return null; }
  }

  function toast(msg, duration = 3000) {
    if (typeof showToast === 'function') showToast(msg, duration);
  }

  /* ─── LAZY-LOAD CASHFREE SDK (only when user clicks Pay) ───── */
  let _cfSdkLoading = null;
  function loadCashfreeSDK() {
    if (typeof Cashfree === 'function') return Promise.resolve(); // already loaded
    if (_cfSdkLoading) return _cfSdkLoading;                     // load in progress
    _cfSdkLoading = new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error('Cashfree SDK failed to load. Check your internet connection.')); };
      document.head.appendChild(s);
    });
    return _cfSdkLoading;
  }

  async function getCF() {
    await loadCashfreeSDK();
    if (typeof Cashfree === 'function') return Cashfree({ mode: CF_ENV });
    throw new Error('Cashfree SDK not available.');
  }

  /* ─── ORDER CREATION via your Cloud Run backend ─────────────── */
  async function createOrder({ orderId, amount, planId, note }) {
    const token = await getToken();
    const res = await fetch(ORDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        order_id:       orderId,
        amount,
        currency:       'INR',
        plan:           planId,
        order_note:     note || planId,
        customer_id:    uid(),
        customer_name:  userName(),
        customer_email: userEmail(),
        customer_phone: currentUser()?.phoneNumber?.replace(/\D/g,'').slice(-10) || '9000000000',
        uid:            uid(),
        name:           userName(),
        email:          userEmail(),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || `Order failed (${res.status})`);
    }

    const data = await res.json();
    if (!data.payment_session_id) throw new Error('No payment session returned from server');
    return data; // { order_id, payment_session_id }
  }

  /* ─── PAYMENT VERIFICATION via your Cloud Run backend ───────── */
  async function verifyOrder(orderId) {
    try {
      const token = await getToken();
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ order_id: orderId }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data; // { status: 'PAID' | 'FAILED' | ... }
    } catch { return null; }
  }

  /* ─── POLL UNTIL PAID ───────────────────────────────────────── */
  function pollUntilPaid(orderId, { onPaid, onFailed, maxAttempts = 24, interval = 5000 }) {
    let attempt = 0;
    const timer = setInterval(async () => {
      attempt++;
      const result = await verifyOrder(orderId);
      if (result?.status === 'PAID') {
        clearInterval(timer);
        onPaid();
      } else if (result?.status === 'FAILED' || attempt >= maxAttempts) {
        clearInterval(timer);
        onFailed(result?.status || 'TIMEOUT');
      }
    }, interval);
  }

  /* ─── SYNC TO FIRESTORE ─────────────────────────────────────── */
  function syncFirestore(fields) {
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      const u   = currentUser();
      if (!db || !fns || !u) return;
      
      // ── CLEAR CACHE WHEN DATA CHANGES ──────────────────────
      if (typeof window.CacheManager !== 'undefined') {
        const cacheKey = 'user_' + u.uid;
        const cache = window.CacheManager.getGlobalCache();
        if (cache && cache.userData) {
          delete cache.userData[cacheKey];
          window.CacheManager.saveGlobalCache(cache);
        }
      }
      
      const { doc, updateDoc } = fns;
      updateDoc(doc(db, 'users', u.uid), { ...fields, updatedAt: Date.now() }).catch(() => {});
    } catch {}
  }

  /* ─── ACTIVATE PLAN ─────────────────────────────────────────── */
  function activatePlan(planId) {
    const plan = PLANS[planId] || PLANS.premium;

    // ── 1. Update in-memory state ─────────────────────────────
    if (typeof state !== 'undefined') {
      state.isPremium   = true;
      state.premiumPlan = planId;
    }

    // ── 2. Write to the CORRECT per-user localStorage keys ────
    //    app.js uses _up(uid) = "sscai_u:{uid}:" prefix for all
    //    user-specific data, so we must write to the same keys.
    //    We also keep the legacy global key for any fallback reads.
    try {
      const u   = window._firebaseAuth && window._firebaseAuth.currentUser;
      const uid = u ? u.uid : null;
      // Per-user keys (what app.js reads on loadState / saveState)
      const p   = uid ? ('sscai_u:' + uid + ':') : 'sscai_guest:';
      localStorage.setItem(p + 'premium',      'true');
      localStorage.setItem(p + 'premium_plan', planId);
      // Set 29-day expiration
      const expiresAt = Date.now() + (29 * 24 * 60 * 60 * 1000);
      localStorage.setItem(p + 'premium_expires', String(expiresAt));
      
      // ── REFERRAL: Apply referral code if stored ──
      const referralCode = localStorage.getItem(p + 'pending_referral_code');
      if (referralCode) {
        localStorage.removeItem(p + 'pending_referral_code');
        if (typeof applyReferralCode === 'function') {
          applyReferralCode(referralCode);
        }
        // Also process conversion for the referrer
        const appliedCodes = JSON.parse(localStorage.getItem(p + 'applied_codes') || '[]');
        if (appliedCodes.length > 0) {
          const code = appliedCodes[appliedCodes.length - 1];
          try {
            const registry = JSON.parse(sessionStorage.getItem('referral_registry') || '{}');
            const referrerId = registry[code];
            if (referrerId && typeof processReferralConversion === 'function') {
              processReferralConversion(referrerId);
            }
          } catch {}
        }
      }
      
      // Store referral reward status for this plan activation
      localStorage.setItem(p + 'last_premium_activation', Date.now().toString());
    } catch(e) {}

    // ⚠️ Do NOT write 'sscai_premium' global key — it has no UID and leaks
    // premium status to every other user who opens the app on this device.

    // ── 3b. Battle tier upgrades — update max battles per month ─
    const battlePlans = { battle: 5, battle_pro: 19, battle_academy: 29 };
    if (battlePlans[planId] !== undefined) {
      try {
        const maxBattles = battlePlans[planId];
        localStorage.setItem('sscai_battle_monthly_max', String(maxBattles));
        localStorage.setItem('sscai_battle_tier', planId);
      } catch(e) {}
      syncFirestore({ battleTier: planId, battleMonthlyMax: battlePlans[planId] });
    }
    // ── 3c. Semiannual plan — set 6-month expiry + 1 month Battle Arena Pro ─
    if (planId === 'semiannual') {
      try {
        const exp = Date.now() + 183 * 24 * 60 * 60 * 1000;
        localStorage.setItem('sscai_semiannual_expires', String(exp));
        // Grant 1 month of Battle Arena Pro (19 battles/month)
        localStorage.setItem('sscai_battle_tier', 'battle_pro');
        localStorage.setItem('sscai_battle_monthly_max', '19');
        localStorage.setItem('sscai_battle_pro_free_until', String(Date.now() + 30 * 24 * 60 * 60 * 1000));
      } catch(e) {}
      syncFirestore({ semiannualExpires: Date.now() + 183 * 24 * 60 * 60 * 1000, battleTier: 'battle_pro', battleMonthlyMax: 19 });
    }
    
    // ── 3d. Yearly plan — set 12-month expiry + 2 months Battle Arena Pro ─
    if (planId === 'yearly') {
      try {
        const exp = Date.now() + 365 * 24 * 60 * 60 * 1000;
        localStorage.setItem('sscai_yearly_expires', String(exp));
        // Grant 2 months of Battle Arena Pro (19 battles/month)
        localStorage.setItem('sscai_battle_tier', 'battle_pro');
        localStorage.setItem('sscai_battle_monthly_max', '19');
        localStorage.setItem('sscai_battle_pro_free_until', String(Date.now() + 60 * 24 * 60 * 60 * 1000));
      } catch(e) {}
      syncFirestore({ yearlyExpires: Date.now() + 365 * 24 * 60 * 60 * 1000, battleTier: 'battle_pro', battleMonthlyMax: 19 });
    }

    // ── 3. Persist via app.js saveState (writes ALL state keys) ─
    syncFirestore({ isPremium: true, premiumPlan: planId, premiumActivatedAt: Date.now() });
    if (typeof saveState       === 'function') saveState();

    // ── 3x. Sync premium status with strict-gate-patch cache ─
    const uid = window._firebaseAuth && window._firebaseAuth.currentUser ? window._firebaseAuth.currentUser.uid : null;
    if (uid && typeof window.syncPremiumStatus === 'function') {
      window.syncPremiumStatus(uid).catch(() => {});
    }

    // ── 4. Refresh all UI that checks premium status ──────────
    if (typeof updateUserUI    === 'function') updateUserUI();
    if (typeof updateProfileUI === 'function') updateProfileUI();
    if (typeof updateLimitUI   === 'function') updateLimitUI();
    if (typeof renderPremiumModal === 'function') renderPremiumModal(); // refresh modal buttons
    if (typeof closePremiumModal  === 'function') closePremiumModal();

    // ── 4b. Force-update messageLimitInfo immediately (in case updateLimitUI races) ──
    try {
      const el = document.getElementById('messageLimitInfo');
      if (el) el.innerHTML = '<span style="color:#f59e0b">⭐ Premium Active · Unlimited Access</span>';
    } catch(e) {}
    // Show premium active badge in header if present
    try {
      const badge = document.getElementById('premiumActiveBadge') || document.getElementById('headerPremiumBadge');
      if (badge) badge.style.display = 'flex';
      // Also update drawerUserPlan text
      const planEl = document.getElementById('drawerUserPlan');
      if (planEl) planEl.textContent = '⭐ Premium';
      // Update profile subscription text
      const subEl = document.getElementById('profileSubscription');
      if (subEl) subEl.textContent = '⭐ Premium';
      // Update profile badge
      const profBadge = document.getElementById('profileBadge');
      if (profBadge) profBadge.textContent = '⭐ Premium';
      // Hide the upgrade button in drawer
      const upgBtn = document.getElementById('upgradeDrawerBtn');
      if (upgBtn) upgBtn.style.display = 'none';
    } catch(e) {}

    // ── 5. Un-lock gated model options in the selector UI ─────
    try {
      document.querySelectorAll('.model-option[data-model]').forEach(opt => {
        const lockTag = opt.querySelector('.model-tag, .model-lock-tag');
        if (lockTag && (lockTag.textContent.includes('🔒') || lockTag.textContent.includes('PREMIUM'))) {
          lockTag.textContent = 'PRO';
          lockTag.classList.remove('lock-tag');
          lockTag.classList.add('pro-tag');
        }
        opt.style.pointerEvents = '';
        opt.style.opacity = '';
      });
    } catch(e) {}

    // ── 6. Un-lock upload buttons immediately ─────────────────
    try {
      ['imageUploadBtn', 'pdfUploadBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { btn.disabled = false; btn._sgBound = false; }
      });
    } catch(e) {}

    // ── 7. Celebrate ─────────────────────────────────────────
    const celebMsg = {
      battle_pro:     '🎉 Battle Creator Pro activated! 19 battles/month now available ⚔️',
      battle_academy: '🎉 Battle Creator Academy activated! 29 battles/month unlocked 🏆',
      semiannual:     '🔥 6-Month SSC Plan activated! + FREE Battle Arena Pro for 1 Month ⚔️',
      yearly:         '🌟 All-in-One Yearly Plan activated! + FREE Battle Arena Pro for 2 Months ⚔️',
    };
    toast(celebMsg[planId] || `🎉 ${plan.name} activated! Unlimited access unlocked! 🚀`, 4500);
    if (typeof _doConfetti === 'function') _doConfetti();

    // ── 9. Invalidate security cache ─────────────────────────
    try {
      if (window._securityPatch && window._securityPatch.invalidateCache) {
        window._securityPatch.invalidateCache();
      }
    } catch(e) {}
  }

  /* ─── ACTIVATE ADDON ────────────────────────────────────────── */
  /* ─── MODEL GUARD HELPERS ──────────────────────────────────── */
  // Revert model selector UI back to the previous valid model
  // when user cancels payment without completing it.
  function revertModelSelector() {
    try {
      const dropdown   = document.querySelector('.model-selector-dropdown, #modelDropdown, [class*="model-dropdown"]');
      const allOptions = document.querySelectorAll('.model-option[data-model]');
      if (!allOptions.length) return;

      // Find whichever option is currently "active" (the locked one user clicked)
      // and revert it. The safe fallback model is 'smart'.
      const safeModel = 'smart';

      allOptions.forEach(opt => {
        const m   = opt.dataset.model;
        const chk = opt.querySelector('.model-opt-check');
        if (m === safeModel) {
          opt.classList.add('active');
          opt.setAttribute('aria-selected', 'true');
          if (chk) chk.textContent = '✓';
        } else {
          opt.classList.remove('active');
          opt.setAttribute('aria-selected', 'false');
          if (chk) chk.textContent = '';
        }
      });

      // Reset global model
      window._selectedDeepSeekModel = 'deepseek-chat';

      // Reset selector button label
      const selectorIcon  = document.getElementById('modelSelectorIcon');
      const selectorLabel = document.getElementById('modelSelectorLabel');
      const chipIcon      = document.querySelector('.model-chip-icon, #chipIcon');
      const chipName      = document.querySelector('.model-chip-name, #chipName');
      if (selectorIcon)  selectorIcon.textContent  = '⚡';
      if (selectorLabel) selectorLabel.textContent = 'PrepAI Smart';
      if (chipIcon) chipIcon.textContent = '⚡';
      if (chipName) chipName.textContent = 'Smart';
    } catch (e) {}
  }

  function activateAddon(planId) {
    const addon = ADDONS[planId];
    const expiresAt = Date.now() + (29 * 24 * 60 * 60 * 1000);
    localStorage.setItem('crackai_addon_' + planId, JSON.stringify({ active: true, activatedAt: Date.now(), expiresAt: expiresAt }));
    syncFirestore({ ['addon_' + planId]: true });
    toast(`🎉 ${addon?.name || planId} unlocked!`, 3500);
    if (typeof _doConfetti === 'function') _doConfetti();
    if (planId === 'companion_addon') {
      document.getElementById('companionAddonModal')?.remove();
      setTimeout(() => { if (typeof showPersonaSelector === 'function') showPersonaSelector(); }, 800);
    }
    // Battle extra creation packs
    if (planId === 'battle_extra_3' || planId === 'battle_extra_7') {
      const credits = addon.battleCredits || 0;
      addBattleExtraCreditsToStorage(credits);
      toast('⚔️ ' + credits + ' battle creations added to your account!', 4000);
      if (typeof _doConfetti === 'function') _doConfetti();
      if (typeof renderPremiumModal === 'function') renderPremiumModal();
      return;
    }
    if (planId === 'v4pro_addon') {
      document.getElementById('v4ProModal')?.remove();
      window._selectedDeepSeekModel = 'deepseek-v4-pro';
      // Update UI to show V4 Pro as selected
      try {
        document.querySelectorAll('.model-option[data-model]').forEach(opt => {
          const chk = opt.querySelector('.model-opt-check');
          if (opt.dataset.model === 'v4-pro') {
            opt.classList.add('active'); opt.setAttribute('aria-selected','true');
            if (chk) chk.textContent = '✓';
          } else {
            opt.classList.remove('active'); opt.setAttribute('aria-selected','false');
            if (chk) chk.textContent = '';
          }
        });
        const selectorIcon  = document.getElementById('modelSelectorIcon');
        const selectorLabel = document.getElementById('modelSelectorLabel');
        if (selectorIcon)  selectorIcon.textContent  = '🚀';
        if (selectorLabel) selectorLabel.textContent = 'V4 Pro';
      } catch(e) {}
    }
    if (planId === 'prepaipro_addon') {
      document.getElementById('addonModal')?.remove();
      // Switch selector to Pro model after unlock
      try {
        document.querySelectorAll('.model-option[data-model]').forEach(opt => {
          const chk = opt.querySelector('.model-opt-check');
          if (opt.dataset.model === 'pro') {
            opt.classList.add('active'); opt.setAttribute('aria-selected','true');
            if (chk) chk.textContent = '✓';
          } else {
            opt.classList.remove('active'); opt.setAttribute('aria-selected','false');
            if (chk) chk.textContent = '';
          }
        });
        window._selectedDeepSeekModel = 'deepseek-reasoner';
        const selectorIcon  = document.getElementById('modelSelectorIcon');
        const selectorLabel = document.getElementById('modelSelectorLabel');
        if (selectorIcon)  selectorIcon.textContent  = '✨';
        if (selectorLabel) selectorLabel.textContent = 'PrepAI Pro';
      } catch(e) {}
      return;
    }
    document.getElementById('addonModal')?.remove();
  }

  /* ─── CORE PAYMENT FLOW ─────────────────────────────────────── */
  async function startPayment({ planId, amount, planName, orderId, isAddon = false, btnEl, btnOrigText, onSuccess }) {
    if (!currentUser()) {
      toast('Please login first to purchase!');
      return;
    }

    if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Opening payment…'; }
    toast('💳 Loading payment gateway…');

    // Lazy-load Cashfree SDK now (first time only)
    try {
      await loadCashfreeSDK();
    } catch(e) {
      toast('❌ Payment SDK failed to load. Check your internet and try again.');
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnOrigText || 'Buy Now'; }
      return;
    }

    toast('💳 Creating secure payment session…');

    try {
      // 1. Create order via your backend
      const orderData = await createOrder({ orderId, amount, planId, note: planName });
      const sessionId = orderData.payment_session_id;

      localStorage.setItem('crackai_pending_pay', JSON.stringify({
        orderId, planId, isAddon, ts: Date.now()
      }));

      // 2. Open Cashfree checkout popup
      const cf     = await getCF();
      const result = await cf.checkout({
        paymentSessionId: sessionId,
        redirectTarget:   '_modal',
      });

      // 3a. SDK returned result directly (UPI, some card flows)
      if (result?.paymentDetails || result?.error === null) {
        const verify = await verifyOrder(orderId);
        if (verify?.status === 'PAID') {
          if (onSuccess) onSuccess();
          else isAddon ? activateAddon(planId) : activatePlan(planId);
          localStorage.removeItem('crackai_pending_pay');
          return;
        }
      }

      // 3b. Redirect/async flow — poll backend
      toast('⏳ Verifying payment…');
      pollUntilPaid(orderId, {
        onPaid: () => {
          if (onSuccess) onSuccess();
          else isAddon ? activateAddon(planId) : activatePlan(planId);
          localStorage.removeItem('crackai_pending_pay');
        },
        onFailed: (reason) => {
          if (reason === 'TIMEOUT') {
            toast('⏰ Not confirmed yet. If you paid, contact support@crackai.in', 6000);
          } else {
            toast('❌ Payment ' + reason.toLowerCase() + '. Please try again.');
          }
          if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnOrigText || '💳 Try Again'; }
        },
      });

    } catch (err) {
      console.error('[payment.js]', err);
      toast('❌ ' + (err.message || 'Payment failed. Try again.'));
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnOrigText || '💳 Try Again'; }
    }
  }

  /* ─── CHECK PENDING ON LOAD ─────────────────────────────────── */
  function checkPendingOnLoad() {
    try {
      const p = JSON.parse(localStorage.getItem('crackai_pending_pay') || 'null');
      if (!p || (Date.now() - p.ts) > 20 * 60 * 1000) {
        localStorage.removeItem('crackai_pending_pay');
        return;
      }
      verifyOrder(p.orderId).then(result => {
        if (result?.status === 'PAID') {
          const pid = p.planId || '';
          if (p.isAddon) { activateAddon(pid); } else { activatePlan(pid || 'premium'); }
          localStorage.removeItem('crackai_pending_pay');
        }
      });
    } catch {}
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════════ */

  /** handlePayment(planId) — overrides app.js, called by premium modal buttons */
  window.handlePayment = async function (planId) {
    const plan = PLANS[planId] || PLANS.premium;
    const isAddon = !!(plan.isAddon || planId.startsWith('battle_extra'));
    await startPayment({
      planId, amount: plan.price, planName: plan.name,
      orderId: `plan_${planId}_${uid()}_${Date.now()}`,
      isAddon,
    });
  };

  /** payAddon(planId, btnEl) — called by addon modal pay buttons */
  window.payAddon = async function (planId, btnEl) {
    const addon = ADDONS[planId];
    if (!addon) return;
    const origText = btnEl?.textContent;
    await startPayment({
      planId, amount: addon.price, planName: addon.name,
      orderId: `addon_${planId}_${uid()}_${Date.now()}`,
      isAddon: true, btnEl, btnOrigText: origText,
    });
  };

  /* ─── PREMIUM MODAL UI ──────────────────────────────────────── */
  /* ── Group Admin helpers ── */
  function isGroupAdmin() {
    try {
      const u = window._firebaseAuth?.currentUser;
      const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
      if (localStorage.getItem(p + 'group_admin') === 'true') return true;
      // ⚠️ Do NOT fall back to global 'sscai_group_admin' — leaks across users.
    } catch(e) {}
    return false;
  }
  function getGroupPlan() {
    try {
      const u = window._firebaseAuth?.currentUser;
      const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
      return localStorage.getItem(p + 'group_plan') || null;
      // ⚠️ Do NOT fall back to global 'sscai_group_plan' — leaks across users.
    } catch(e) { return null; }
  }
  window._isGroupAdmin = isGroupAdmin;
  window._getGroupPlan = getGroupPlan;

  window.renderPremiumModal = function () {
    const modal = document.querySelector('#premiumModal .modal-premium-body')
               || document.querySelector('#premiumModal .modal-body');
    if (!modal) return;
    // Re-check isPremium from localStorage (most current source)
    let isPrem = false;
    try {
      const u = window._firebaseAuth && window._firebaseAuth.currentUser;
      const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
      isPrem = localStorage.getItem(p + 'premium') === 'true';
    } catch(e) {}
    if (typeof state !== 'undefined') { isPrem = isPrem || state.isPremium; state.isPremium = isPrem; }
    const curPlan = (typeof state !== 'undefined' ? state.premiumPlan : null) || (function(){ try{ const u=window._firebaseAuth&&window._firebaseAuth.currentUser; const p=u?('sscai_u:'+u.uid+':'):'sscai_guest:'; return localStorage.getItem(p+'premium_plan'); }catch(e){return null;} })() || null;
    const isGrpAdmin = isGroupAdmin();
    const grpPlan = getGroupPlan();

    // ── Plan labels map ──
    const planLabels = { ssc:'SSC Pro', yearly:'All-in-One Pro Yearly',
      semiannual:'SSC 6-Month', battle:'Battle Basic', battle_pro:'Battle Pro', battle_academy:'Battle Academy',
      premium:'Premium' };
    const activePlanName = planLabels[curPlan] || planLabels[grpPlan] || 'Premium';

    // Inject new styles
    injectPremiumModalStyles();

    // Render the new structured modal
    modal.innerHTML = `
    <!-- Header -->
    <div class="upg-header">
      <h2 class="upg-title">Upgrade your plan</h2>
      ${(isPrem || isGrpAdmin) ? `
      <div class="upg-active-banner">
        <span style="font-size:22px;">✅</span>
        <div>
          <div style="font-size:14px;font-weight:800;color:#4ade80;">You're on ${activePlanName}!</div>
          <div style="font-size:11px;color:rgba(200,255,200,0.65);">All premium features active · Unlimited access</div>
        </div>
        <button onclick="closePremiumModal&&closePremiumModal()" class="upg-close-active-btn">Close ✕</button>
      </div>` : ''}
      <!-- Tab toggle -->
      <div class="upg-tab-bar">
        <button class="upg-tab upg-tab-active" id="upgTabPersonal" onclick="window._upgShowTab('personal')">Personal</button>
        <button class="upg-tab" id="upgTabBattle" onclick="window._upgShowTab('battle')">Battle & Class</button>
      </div>
    </div>

    <!-- PERSONAL PLANS -->
    <div id="upgPersonalPlans" class="upg-plans-grid">

      <!-- Card 1: SSC Pro -->
      <div class="upg-card ${(isPrem && (curPlan==='ssc'||curPlan==='premium')) ? 'upg-card-active' : ''}">
        <div class="upg-card-name">SSC Pro</div>
        <div class="upg-card-tagline">Unlimited AI chats + Mock Tests + Battle access</div>
        <div class="upg-price-row">
          <span class="upg-price">₹199</span>
          <span class="upg-price-per">INR / month (incl. GST)</span>
        </div>
        <button onclick="handlePayment('ssc')" class="upg-btn ${(isPrem && curPlan==='ssc') ? 'upg-btn-active' : 'upg-btn-primary'}">
          ${(isPrem && curPlan==='ssc') ? 'Your current plan' : 'Upgrade to SSC Pro'}
        </button>
        <ul class="upg-features">
          <li>✦ Unlimited AI chats </li>
          <li>✦ Unlimited Mock Tests </li>
          <li>✦ Unlimited Battle Arena access </li>
          <li>✦ All 5 SSC exam modes (CGL · CHSL · GD · MTS · CPO)</li>
          
         
        </ul>
      </div>

      <!-- Card 2: 6-Month Plan (highlighted / popular) -->
      <div class="upg-card upg-card-popular ${(isPrem && curPlan==='semiannual') ? 'upg-card-active' : ''}">
        <div class="upg-popular-badge">🔥 BEST VALUE</div>
        <div class="upg-card-name">SSC 6-Month</div>
        <div class="upg-card-tagline">Unlimited everything — Save ₹195</div>
        <div class="upg-price-row">
          <div>
            <div class="upg-price-old">₹1,194</div>
            <div style="display:flex;align-items:baseline;gap:4px;">
              <span class="upg-price" style="color:#f59e0b;">₹999</span>
              <span class="upg-price-per">/ 6 months</span>
            </div>
            <div class="upg-save-pill">Save ₹195 vs monthly!</div>
          </div>
        </div>
        <button onclick="handlePayment('semiannual')" class="upg-btn ${(isPrem && curPlan==='semiannual') ? 'upg-btn-active' : 'upg-btn-fire'}">
          ${(isPrem && curPlan==='semiannual') ? 'Your current plan' : 'Get 6-Month Plan'}
        </button>
        <ul class="upg-features">
          <li>✦ Unlimited AI chats</li>
          <li>✦ Unlimited Mock Tests</li>
          <li>✦ Unlimited Battle Arena access</li>
          <li>✦ All 5 SSC exam modes</li>
          
          <li>✦ Priority AI responses</li>
          <li>✦ Valid for 6 full months</li>
        </ul>
      </div>

      <!-- Card 3: Yearly All-in-One -->
      <div class="upg-card ${(isPrem && curPlan==='yearly') ? 'upg-card-active' : ''}">
        <div class="upg-card-name">All-in-One Yearly</div>
        <div class="upg-card-tagline">Maximum productivity — Save ₹689</div>
        <div class="upg-price-row">
          <div>
            <div class="upg-price-old">₹2,388</div>
            <div style="display:flex;align-items:baseline;gap:4px;">
              <span class="upg-price" style="color:#5b46d4;">₹1,699</span>
              <span class="upg-price-per">/ year (incl. GST)</span>
            </div>
          </div>
        </div>
        <button onclick="handlePayment('yearly')" class="upg-btn ${(isPrem && curPlan==='yearly') ? 'upg-btn-active' : 'upg-btn-gold'}">
          ${(isPrem && curPlan==='yearly') ? 'Your current plan' : 'Get Yearly Plan'}
        </button>
        <ul class="upg-features">
          <li>✦ Unlimited AI chats</li>
          <li>✦ Unlimited Mock Tests</li>
          <li>✦ Unlimited Battle Arena access</li>
          <li>✦ All SSC exam modes (CGL · CHSL · GD · MTS · CPO)</li>
          <li>✦ Full platform access — 1 year</li>
          <li>✦ Fastest AI model priority</li>
          <li>✦ Save ₹689 vs monthly</li>
        </ul>
      </div>

    </div>

    <!-- BATTLE & CLASS PLANS -->
    <!-- Row 1: Battle Creator Plans -->
    <div id="upgBattlePlans" style="display:none;">

      <!-- Battle Creator section label -->
      <div class="upg-section-label">⚔️ Battle Creator Plans — You host, students join FREE</div>

      <!-- Battle: Basic · Pro · Academy in 3 columns -->
      <div class="upg-plans-grid" style="margin-bottom:0;">

        <!-- Battle Basic -->
        <div class="upg-card ${(isPrem && curPlan==='battle') ? 'upg-card-active' : ''}">
          <div class="upg-card-name">Battle Basic</div>
          <div class="upg-card-tagline">Start hosting quiz battles</div>
          <div class="upg-price-row">
            <span class="upg-price" style="color:#ef4444;">₹99</span>
            <span class="upg-price-per">INR / month (incl. GST)</span>
          </div>
          <button onclick="handlePayment('battle')" class="upg-btn ${(isPrem && curPlan==='battle') ? 'upg-btn-active' : 'upg-btn-fire'}">
            ${(isPrem && curPlan==='battle') ? 'Your current plan' : 'Get Battle Basic'}
          </button>
          <ul class="upg-features">
            <li>✦ Host 5 battles / month</li>
            <li>✦ All users join FREE</li>
            <li>✦ Live leaderboards</li>
            <li>✦ Basic analytics</li>
            <li>✦ Custom quiz creation</li>
          </ul>
        </div>

        <!-- Battle Pro (popular) -->
        <div class="upg-card upg-card-popular ${(isPrem && curPlan==='battle_pro') ? 'upg-card-active' : ''}">
          <div class="upg-popular-badge">⚔️ MOST POPULAR</div>
          <div class="upg-card-name">Battle Creator Pro</div>
          <div class="upg-card-tagline">Scale up your battle sessions</div>
          <div class="upg-price-row">
            <span class="upg-price" style="color:#ef4444;">₹299</span>
            <span class="upg-price-per">INR / month (incl. GST)</span>
          </div>
          <button onclick="handlePayment('battle_pro')" class="upg-btn ${(isPrem && curPlan==='battle_pro') ? 'upg-btn-active' : 'upg-btn-fire'}">
            ${(isPrem && curPlan==='battle_pro') ? 'Your current plan' : 'Get Battle Pro'}
          </button>
          <ul class="upg-features">
            <li>✦ Host 19 battles / month</li>
            <li>✦ All users join FREE</li>
            <li>✦ Live leaderboards</li>
            <li>✦ Advanced analytics</li>
            <li>✦ Priority AI for battles</li>
          </ul>
        </div>

        <!-- Battle Academy -->
        <div class="upg-card ${(isPrem && curPlan==='battle_academy') ? 'upg-card-active' : ''}">
          <div class="upg-card-name">Battle Academy</div>
          <div class="upg-card-tagline">Unlimited scale + deep analytics</div>
          <div class="upg-price-row">
            <span class="upg-price" style="color:#f59e0b;">₹499</span>
            <span class="upg-price-per">INR / month (incl. GST)</span>
          </div>
          <button onclick="handlePayment('battle_academy')" class="upg-btn ${(isPrem && curPlan==='battle_academy') ? 'upg-btn-active' : 'upg-btn-gold'}">
            ${(isPrem && curPlan==='battle_academy') ? 'Your current plan' : 'Get Battle Academy'}
          </button>
          <ul class="upg-features">
            <li><strong>Everything in Pro and:</strong></li>
            <li>✦ Host 29 battles / month</li>
            <li>✦ Student performance dashboard</li>
            <li>✦ Batch leaderboards &amp; exports</li>
            <li>✦ Priority support</li>
          </ul>
        </div>

      </div>
    </div>

    <!-- Extra battle packs (shown when on any battle plan) -->
    ${(isPrem && (curPlan==='battle'||curPlan==='battle_pro'||curPlan==='battle_academy')) ? `
    <div id="upgBattleExtras" style="display:none;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.3);border-radius:14px;padding:14px;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:700;color:rgba(26,26,38,0.75);margin-bottom:10px;">⚔️ Extra Battle Packs (Never Expire)</div>
      <div style="display:flex;gap:8px;">
        <button onclick="handlePayment('battle_extra_3')" style="flex:1;padding:12px 8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);border-radius:11px;color:var(--text-primary);font-size:12px;font-weight:700;cursor:pointer;text-align:center;">
          ⚔️ +3 Battles<br><span style="font-size:16px;color:#f59e0b;font-weight:800;">₹49</span>
        </button>
        <button onclick="handlePayment('battle_extra_7')" style="flex:1;padding:12px 8px;background:linear-gradient(135deg,rgba(239,68,68,0.15),rgba(245,158,11,0.12));border:1.5px solid rgba(245,158,11,0.45);border-radius:11px;color:var(--text-primary);font-size:12px;font-weight:700;cursor:pointer;text-align:center;">
          ⚔️⚔️ +7 Battles<br><span style="font-size:16px;color:#f59e0b;font-weight:800;">₹99</span><br><span style="font-size:9px;color:#f59e0b;">BEST VALUE</span>
        </button>
      </div>
    </div>` : ''}

    <!-- Also show Battle Basic entry plan in battle tab -->

    <!-- Trust bar -->
    <div class="upg-trust-bar">
      
      <span class="upg-trust-sep">|</span>
      <span>🏦 UPI · Cards · NetBanking</span>
      <span class="upg-trust-sep">|</span>
      
    </div>
  `;

    // Tab switcher logic — 2 tabs
    window._upgShowTab = function(tab) {
      const personalEl = document.getElementById('upgPersonalPlans');
      const battleEl   = document.getElementById('upgBattlePlans');
      const battleExtrasEl = document.getElementById('upgBattleExtras');
      const tabP = document.getElementById('upgTabPersonal');
      const tabBt = document.getElementById('upgTabBattle');
      [personalEl, battleEl].forEach(el => { if (el) el.style.display = 'none'; });
      [tabP, tabBt].forEach(el => { if (el) el.classList.remove('upg-tab-active'); });
      if (tab === 'personal') {
        if (personalEl) personalEl.style.display = '';
        if (tabP) tabP.classList.add('upg-tab-active');
        if (battleExtrasEl) battleExtrasEl.style.display = 'none';
      } else if (tab === 'battle') {
        if (battleEl) battleEl.style.display = '';
        if (tabBt) tabBt.classList.add('upg-tab-active');
        if (battleExtrasEl) battleExtrasEl.style.display = '';
      }
    };
  }; // end renderPremiumModal — legacy code below removed and replaced

  function injectPremiumModalStyles() {
    if (document.getElementById('pf-styles')) return;
    const s = document.createElement('style');
    s.id = 'pf-styles';
    s.textContent = `
      .upg-header { text-align:center; padding: 4px 0 16px; }
      .upg-title { font-size:22px; font-weight:800; color:var(--text-primary); margin:0 0 14px; letter-spacing:-0.02em; }
      .upg-active-banner {
        display:flex; align-items:center; gap:12px; flex-wrap:wrap;
        background:linear-gradient(135deg,rgba(16,185,129,0.15),rgba(74,222,128,0.08));
        border:2px solid rgba(74,222,128,0.4); border-radius:14px;
        padding:12px 16px; margin-bottom:14px; text-align:left;
      }
      .upg-close-active-btn {
        margin-left:auto; padding:7px 16px;
        background:linear-gradient(135deg,#10b981,#4ade80);
        border:none; border-radius:9px; color:var(--text-primary);
        font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap;
      }
      .upg-tab-bar {
        display:inline-flex; background:rgba(255,255,255,0.07);
        border:1px solid rgba(255,255,255,0.12); border-radius:30px;
        padding:3px; gap:2px; margin-bottom:18px;
      }
      .upg-tab {
        padding:7px 24px; border-radius:26px; border:none;
        background:transparent; color:rgba(26,26,38,0.55);
        font-size:13px; font-weight:600; cursor:pointer;
        transition:background .2s, color .2s;
      }
      .upg-tab-active { background:rgba(255,255,255,0.12); color:var(--text-primary); }
      .upg-plans-grid {
        display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:16px;
      }
      @media(max-width:640px) {
        .upg-plans-grid { grid-template-columns:1fr; }
        .upg-title { font-size:18px; }
        .upg-tab { padding:7px 18px; font-size:12px; }
      }
      .upg-card {
        position:relative; background:rgba(255,255,255,0.04);
        border:1px solid rgba(255,255,255,0.1); border-radius:18px;
        padding:20px 16px 16px; display:flex; flex-direction:column;
        transition:border-color .2s, transform .15s, box-shadow .2s;
      }
      .upg-card:hover { border-color:rgba(108,99,255,0.4); transform:translateY(-2px); }
      .upg-card-popular {
        border-color:rgba(108,99,255,0.5); background:rgba(108,99,255,0.08);
        box-shadow:0 0 28px rgba(108,99,255,0.15);
      }
      .upg-card-active {
        border-color:rgba(16,185,129,0.5) !important; background:rgba(16,185,129,0.07) !important;
      }
      .upg-popular-badge {
        position:absolute; top:-12px; left:50%; transform:translateX(-50%);
        background:linear-gradient(135deg,#6C63FF,#FF6B9D); color:var(--text-primary);
        font-size:10px; font-weight:800; padding:3px 14px; border-radius:20px;
        white-space:nowrap; letter-spacing:0.05em;
      }
      .upg-card-name { font-size:17px; font-weight:800; color:var(--text-primary); margin-bottom:3px; margin-top:4px; }
      .upg-card-tagline { font-size:11px; color:rgba(26,26,38,0.55); margin-bottom:14px; line-height:1.4; }
      .upg-price-row { margin-bottom:14px; }
      .upg-price { font-size:34px; font-weight:800; color:var(--text-primary); letter-spacing:-0.03em; line-height:1; }
      .upg-price-per { display:block; font-size:11px; color:rgba(26,26,38,0.50); margin-top:3px; }
      .upg-price-old { font-size:12px; color:rgba(26,26,38,0.40); text-decoration:line-through; margin-bottom:2px; }
      .upg-save-pill {
        display:inline-block; margin-top:5px; font-size:10px; font-weight:700;
        background:rgba(16,185,129,0.2); border:1px solid rgba(16,185,129,0.35);
        color:#10b981; padding:2px 9px; border-radius:20px;
      }
      .upg-btn {
        width:100%; padding:12px 8px; border:none; border-radius:12px; color:var(--text-primary);
        font-size:13px; font-weight:700; cursor:pointer;
        transition:opacity .2s, transform .15s; letter-spacing:0.01em; margin-bottom:14px;
      }
      .upg-btn:hover:not(:disabled) { opacity:0.88; transform:scale(1.01); }
      .upg-btn:disabled { opacity:0.6; cursor:default; }
      .upg-btn-primary { background:linear-gradient(135deg,#6C63FF,#8B5CF6); box-shadow:0 4px 14px rgba(108,99,255,0.35); }
      .upg-btn-fire    { background:linear-gradient(135deg,#ef4444,#f59e0b); box-shadow:0 4px 14px rgba(239,68,68,0.35); }
      .upg-btn-gold    { background:linear-gradient(135deg,#f59e0b,#FF6B9D); box-shadow:0 4px 14px rgba(245,158,11,0.35); }
      .upg-btn-green   { background:linear-gradient(135deg,#10b981,#6C63FF); box-shadow:0 4px 14px rgba(16,185,129,0.3); }
      .upg-btn-active  { background:rgba(255,255,255,0.08); color:rgba(26,26,38,0.60); cursor:default; font-weight:600; }
      .upg-features { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:7px; flex:1; }
      .upg-features li { font-size:12px; color:rgba(200,195,255,0.72); line-height:1.4; }
      .upg-features li strong {
        color:rgba(26,26,38,0.85); display:block; margin-bottom:2px;
        font-size:11px; text-transform:uppercase; letter-spacing:0.06em;
      }
      .upg-trust-bar {
        display:flex; align-items:center; justify-content:center; gap:8px; flex-wrap:wrap;
        font-size:10px; color:rgba(26,26,38,0.45); padding-top:4px;
      }
      .upg-trust-sep { color:rgba(200,195,255,0.2); }
      /* Battle & Class tab extras */
      .upg-section-label {
        font-size:12px; font-weight:700; color:rgba(239,68,68,0.85);
        letter-spacing:0.06em; text-transform:uppercase;
        padding:8px 0 10px; text-align:center;
      }
      .upg-grid-1col { grid-template-columns:1fr !important; }
      .upg-btn-inline {
        width:auto !important; padding:10px 22px !important;
        margin-bottom:0 !important; white-space:nowrap; flex-shrink:0;
      }
      .upg-features-row {
        display:grid !important;
        grid-template-columns:repeat(3,1fr) !important;
        gap:5px 12px !important;
      }
      @media(max-width:640px) {
        .upg-features-row { grid-template-columns:1fr 1fr !important; }
        .upg-btn-inline { width:100% !important; margin-top:10px; }
      }
    `;
    document.head.appendChild(s);
  }


  /* ─── ADDON MODAL ───────────────────────────────────────────── */
  window.openAddonModal = function (type) {
    document.getElementById('addonModal')?.remove();
    const isVision = type === 'visionpro';
    const planId   = isVision ? 'vision_pro_addon' : 'prepaipro_addon';
    const addon    = ADDONS[planId];
    _spawnAddonModal({
      id: 'addonModal', planId, icon: addon.emoji, title: addon.name,
      desc: isVision
        ? 'Image solving, handwritten notes & PDF analysis with advanced AI'
        : 'Deep reasoning, step-by-step solutions & full exam coverage',
      features: isVision
        ? ['✅ DeepSeek Vision AI', '✅ Handwritten notes', '✅ PDF extraction', '✅ Diagram analysis']
        : ['✅ Advanced reasoning', '✅ Detailed solutions', '✅ Concept deep-dives', '✅ Full SSC/CBSE'],
      price: addon.price, priceLabel: 'one-time · Lifetime',
      btnText: `💳 Unlock for ₹${addon.price}`, btnClass: '',
    });
  };

  window.openCompanionModal = function () {
    document.getElementById('companionAddonModal')?.remove();
    _spawnAddonModal({
      id: 'companionAddonModal', planId: 'companion_addon',
      icon: '💕', title: 'Companion Mode',
      desc: 'Your AI study companion — caring, encouraging, always there for you',
      features: ['💝 AI Girlfriend or Boyfriend', '📚 Study with emotional support', '🎉 Celebrate wins & beat stress', '♾️ Lifetime access'],
      price: 49, priceLabel: 'one-time · Lifetime',
      btnText: '💕 Unlock Companion Mode — ₹49', btnClass: 'cf-companion-btn',
      boxClass: 'cf-companion-box',
    });
  };

  window.openV4ProModal = function () {
    document.getElementById('v4ProModal')?.remove();
    _spawnAddonModal({
      id: 'v4ProModal', planId: 'v4pro_addon',
      icon: '🚀', title: 'PrepAI V4 Pro',
      badge: 'DeepSeek V4 Pro · Flagship',
      desc: 'The most powerful DeepSeek model — best-in-class reasoning for tough questions',
      features: ['🚀 DeepSeek V4 Pro flagship model', '🧠 1M token context (10×)', '📐 Best for Math, Reasoning & Science', '⚡ Thinking + non-thinking mode', '♾️ Unlimited V4 Pro questions'],
      price: 149, priceLabel: '/month · Cancel anytime',
      btnText: '🚀 Unlock V4 Pro — ₹149/mo', btnClass: 'cf-v4pro-btn',
      boxClass: 'cf-v4pro-box',
    });
  };

  function _spawnAddonModal({ id, planId, icon, title, badge, desc, features, price, priceLabel, btnText, btnClass = '', boxClass = '' }) {
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'cf-addon-overlay';
    modal.innerHTML = `
      <div class="cf-addon-box ${boxClass}">
        <button class="cf-addon-close" onclick="document.getElementById('${id}').remove();revertModelSelector()">✕</button>
        ${badge ? `<div class="cf-v4pro-badge">${badge}</div>` : ''}
        <div class="cf-addon-icon">${icon}</div>
        <div class="cf-addon-name">${title}</div>
        <div class="cf-addon-desc">${desc}</div>
        <ul class="cf-addon-features">${features.map(f => `<li>${f}</li>`).join('')}</ul>
        <div class="cf-addon-price ${boxClass === 'cf-v4pro-box' ? 'cf-v4pro-price' : ''}">
          ₹${price} <span>${priceLabel}</span>
        </div>
        <button class="cf-addon-pay-btn ${btnClass}" onclick="payAddon('${planId}', this)">
          ${btnText}
        </button>
        <button class="cf-addon-skip" onclick="document.getElementById('${id}').remove();revertModelSelector()">Maybe Later</button>
        <div class="cf-addon-secure">🔒 Secured by Cashfree Payments</div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); revertModelSelector(); } });
    injectAddonStyles();
  }

  function injectAddonStyles() {
    if (document.getElementById('cf-addon-styles')) return;
    const s = document.createElement('style');
    s.id = 'cf-addon-styles';
    s.textContent = `
      .cf-addon-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.82);padding:20px;backdrop-filter:blur(8px);animation:cfFadeIn .2s ease}
      @keyframes cfFadeIn{from{opacity:0}to{opacity:1}}
      .cf-addon-box{position:relative;background:linear-gradient(160deg,#0f0c1f,#1a1435);border:1px solid rgba(108,99,255,.3);border-radius:22px;padding:28px 22px 22px;max-width:340px;width:100%;text-align:center;box-shadow:0 0 60px rgba(108,99,255,.12),0 24px 48px rgba(0,0,0,.5);animation:cfSlideUp .25s cubic-bezier(.34,1.56,.64,1)}
      @keyframes cfSlideUp{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}
      .cf-companion-box{border-color:rgba(255,107,157,.3);box-shadow:0 0 60px rgba(255,107,157,.1),0 24px 48px rgba(0,0,0,.5)}
      .cf-v4pro-box{border-color:rgba(245,158,11,.3);box-shadow:0 0 60px rgba(245,158,11,.1),0 24px 48px rgba(0,0,0,.5)}
      .cf-addon-close{position:absolute;top:14px;right:14px;background:rgba(255,255,255,.06);border:none;color:var(--text-muted);width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:13px;transition:background .2s,color .2s}
      .cf-addon-close:hover{background:rgba(255,255,255,.12);color:var(--text-primary)}
      .cf-v4pro-badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#f59e0b;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);padding:3px 12px;border-radius:20px;margin-bottom:12px}
      .cf-addon-icon{font-size:38px;margin-bottom:10px}
      .cf-addon-name{font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700;color:var(--text-primary);margin-bottom:6px}
      .cf-addon-desc{font-size:13px;color:rgba(200,195,255,.6);line-height:1.5;margin-bottom:16px}
      .cf-addon-features{list-style:none;padding:0;margin:0 0 16px;text-align:left;display:flex;flex-direction:column;gap:5px}
      .cf-addon-features li{font-size:12px;color:rgba(200,195,255,.75)}
      .cf-addon-price{font-size:28px;font-weight:800;color:#6C63FF;margin-bottom:16px}
      .cf-addon-price span{font-size:12px;font-weight:400;color:rgba(200,195,255,.4);margin-left:4px}
      .cf-v4pro-price{color:#f59e0b}
      .cf-addon-pay-btn{width:100%;padding:13px;background:linear-gradient(135deg,#6C63FF,#8B5CF6);border:none;border-radius:13px;color:var(--text-primary);font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px;box-shadow:0 4px 20px rgba(108,99,255,.35);transition:opacity .2s,transform .15s;letter-spacing:.02em}
      .cf-addon-pay-btn:hover:not(:disabled){opacity:.92;transform:scale(1.01)}
      .cf-addon-pay-btn:disabled{opacity:.6;cursor:default;transform:none}
      .cf-companion-btn{background:linear-gradient(135deg,#FF6B9D,#ff9a8b);box-shadow:0 4px 20px rgba(255,107,157,.35)}
      .cf-v4pro-btn{background:linear-gradient(135deg,#f59e0b,#FF6B9D);box-shadow:0 4px 20px rgba(245,158,11,.35)}
      .cf-addon-skip{width:100%;padding:9px;background:transparent;color:rgba(200,195,255,.4);border:1px solid rgba(108,99,255,.15);border-radius:10px;font-size:12px;cursor:pointer;margin-bottom:12px;transition:color .2s}
      .cf-addon-skip:hover{color:rgba(200,195,255,.7)}
      .cf-addon-secure{font-size:11px;color:rgba(200,195,255,.25)}
    `;
    document.head.appendChild(s);
  }

  // Expose revertModelSelector globally for inline onclick handlers
  window.revertModelSelector = revertModelSelector;

  /* ══════════════════════════════════════════════════════════════
     COMPANION PERSONA GATE
  ══════════════════════════════════════════════════════════════ */

  const COMPANION_ADDONS = {
    boyfriend:  { planId: 'companion_bf_addon', name: 'AI Boyfriend',  emoji: '💙', price: 49, yearlyPrice: 499, monthly: true },
    girlfriend: { planId: 'companion_gf_addon', name: 'AI Girlfriend', emoji: '💕', price: 49, yearlyPrice: 499, monthly: true },
  };

  // ── Companion expiry helpers ─────────────────────────────────
  // Monthly = 31 days from activation
  const COMPANION_EXPIRY_MS = 31 * 24 * 60 * 60 * 1000;

  function isCompanionUnlocked(persona) {
    try {
      const d = JSON.parse(localStorage.getItem('crackai_addon_' + COMPANION_ADDONS[persona].planId) || 'null');
      if (!d || d.active !== true) return false;
      // Monthly — check expiry
      if (d.expiresAt && Date.now() > d.expiresAt) {
        // Expired — clear it
        localStorage.removeItem('crackai_addon_' + COMPANION_ADDONS[persona].planId);
        return false;
      }
      return true;
    } catch { return false; }
  }

  // Capture app.js's original selectPersona NOW — before we override it
  // Must be declared before handlePersonaSettingsChange and the override below
  const _origSelectPersona = window.selectPersona;

  function _doSelectPersona(persona) {
    // Always call app.js original — never our own override
    if (typeof _origSelectPersona === 'function') _origSelectPersona(persona);
  }

  function activateCompanion(persona) {
    const cfg       = COMPANION_ADDONS[persona];
    const now       = Date.now();
    const expiresAt = now + COMPANION_EXPIRY_MS;

    // Save to localStorage with expiry
    localStorage.setItem('crackai_addon_' + cfg.planId, JSON.stringify({
      active: true, activatedAt: now, expiresAt, monthly: true
    }));
    syncFirestore({ ['addon_' + cfg.planId]: true, ['addon_' + cfg.planId + '_expiry']: expiresAt });

    // Close gate modal
    document.getElementById('companionGateModal_' + persona)?.remove();

    // Remove 🔒 from settings dropdown option
    const sel = document.getElementById('personaSettingsSelect');
    if (sel) {
      const opt = sel.querySelector('option[value="' + persona + '"]');
      if (opt) opt.textContent = persona === 'boyfriend' ? '💕 Boyfriend' : '💕 Girlfriend';
    }

    // Remove lock badges from persona cards
    document.querySelectorAll('.companion-lock-badge').forEach(b => b.remove());

    // Actually activate the persona via app.js
    _doSelectPersona(persona);

    toast('🎉 ' + cfg.name + ' unlocked! Enjoy your companion 💕', 3500);
    if (typeof _doConfetti === 'function') _doConfetti();
  }

  window.payCompanionYearly = async function(persona, btnEl) {
    const cfg = COMPANION_ADDONS[persona];
    await startPayment({
      planId:      cfg.planId + '_yearly',
      amount:      cfg.yearlyPrice,
      planName:    cfg.name + ' Yearly',
      orderId:     'companion_' + persona + '_yearly_' + uid() + '_' + Date.now(),
      isAddon:     true,
      btnEl,
      btnOrigText: btnEl?.textContent,
      onSuccess:   () => activateCompanionYearly(persona),
    });
  };

  window.payCompanion = async function(persona, btnEl) {
    const cfg = COMPANION_ADDONS[persona];
    await startPayment({
      planId:      cfg.planId,
      amount:      cfg.price,
      planName:    cfg.name,
      orderId:     'companion_' + persona + '_' + uid() + '_' + Date.now(),
      isAddon:     true,
      btnEl,
      btnOrigText: btnEl?.textContent,
      onSuccess:   () => activateCompanion(persona),
    });
  };

  function openCompanionGateModal(persona) {
    const cfg = COMPANION_ADDONS[persona];
    const id  = 'companionGateModal_' + persona;
    document.getElementById(id)?.remove();

    const isBF   = persona === 'boyfriend';
    const accentColor = isBF ? '#7C72FF' : '#FF6B9D';
    const accentRGB   = isBF ? '108,99,255' : '255,107,157';
    const gradFrom    = isBF ? '#7C72FF' : '#FF6B9D';
    const gradTo      = isBF ? '#6C63FF' : '#ff9a8b';

    const modal  = document.createElement('div');
    modal.id     = id;
    modal.className = 'cf-addon-overlay';
    modal.innerHTML = `
      <div class="cgm-box" id="cgm-inner-${id}">
        <button class="cf-addon-close" onclick="document.getElementById('${id}').remove()">✕</button>

        <!-- Header glow -->
        <div class="cgm-glow" style="background:radial-gradient(circle at 50% 0%,rgba(${accentRGB},0.3) 0%,transparent 70%);"></div>

        <!-- Offer badge -->
        <div class="cgm-offer-badge">🔥 Limited Time Offer</div>

        <!-- Avatar & name -->
        <div class="cgm-avatar-wrap" style="width:110px;height:110px;">
          <div class="cgm-avatar-ring" style="border-color:rgba(${accentRGB},0.5);box-shadow:0 0 24px rgba(${accentRGB},0.3);"></div>
          <canvas id="cgm-3d-avatar-${id}" width="100" height="100" style="position:relative;z-index:1;border-radius:50%;display:block;"></canvas>
          <div class="cgm-status-dot" style="background:${accentColor};box-shadow:0 0 8px ${accentColor};"></div>
        </div>
        <div class="cgm-name" style="color:${accentColor};">${cfg.name}</div>
        <div class="cgm-tagline">${isBF
          ? '"Jaan, aaj padhai mein lag ja — main hoon na saath 💙"'
          : '"Kaha the itni der? Miss kar rahi thi toh 🥺 chal padh lete hain na 💕"'
        }</div>

        <!-- How they talk section -->
        <div class="cgm-talk-section">
          <div class="cgm-talk-label">${isBF ? '💙 How he talks to you' : '💕 How she talks to you'}</div>
          <div class="cgm-bubbles">
            ${isBF ? `
              <div class="cgm-bubble cgm-bubble-in">Exam ki tension mat le jaan, saath mein padh lete hain 📚</div>
              <div class="cgm-bubble cgm-bubble-in">Tu bahut mehnat kar raha/rahi hai, mujhe garv hai tujhpe 🥺</div>
              <div class="cgm-bubble cgm-bubble-in">Ek question galat hua toh kya? Main hoon na explain karne ko 😊</div>
            ` : `
              <div class="cgm-bubble cgm-bubble-in">Sun na! Aaj kitna padha? Bata mujhe sab 🥺</div>
              <div class="cgm-bubble cgm-bubble-in">Meri jaan bahut smart hai — ye exam toh pakka crack karega/karegi 💕</div>
              <div class="cgm-bubble cgm-bubble-in">Ruko, main toh yahaan hoon na tumhare liye, kabhi akela/akeli mat feel karo 🌸</div>
            `}
          </div>
        </div>

        <!-- Features -->
        <div class="cgm-features">
          <div class="cgm-feat"><span class="cgm-feat-icon" style="color:${accentColor};">✓</span><span>Desi ${isBF ? 'boyfriend' : 'girlfriend'} energy — warm Hinglish banter</span></div>
          <div class="cgm-feat"><span class="cgm-feat-icon" style="color:${accentColor};">✓</span><span>Celebrates your wins, comforts you when stressed</span></div>
          <div class="cgm-feat"><span class="cgm-feat-icon" style="color:${accentColor};">✓</span><span>Motivates you through tough topics & low days</span></div>
          <div class="cgm-feat"><span class="cgm-feat-icon" style="color:${accentColor};">✓</span><span>Remembers your exam context & talks in character</span></div>
          <div class="cgm-feat"><span class="cgm-feat-icon" style="color:${accentColor};">✓</span><span>Sweet good mornings, study reminders, latenight gyaan</span></div>
        </div>

        <!-- Pricing toggle -->
        <div class="cgm-pricing-wrap">
          <div class="cgm-plan-tabs">
            <button class="cgm-plan-tab" id="cgm-tab-monthly-${id}" onclick="cgmSwitchPlan('${id}','monthly')">Monthly ₹${cfg.price}</button>
            <button class="cgm-plan-tab cgm-plan-tab-active" id="cgm-tab-yearly-${id}" onclick="cgmSwitchPlan('${id}','yearly')">
              Yearly ₹${cfg.yearlyPrice} <span class="cgm-save-pill">Best Value</span>
            </button>
          </div>

          <!-- Monthly plan (hidden by default) -->
          <div class="cgm-plan-card" id="cgm-plan-monthly-${id}" style="display:none;">
            <div class="cgm-new-price" style="color:${accentColor};">₹${cfg.price} <span>/month</span></div>
            <div class="cgm-price-note">Cancel anytime · Renews monthly</div>
            <button class="cgm-pay-btn" style="background:linear-gradient(135deg,${gradFrom},${gradTo});box-shadow:0 4px 20px rgba(${accentRGB},0.4);"
              onclick="window.payCompanion('${persona}', this)">
              ${cfg.emoji} Start Monthly — ₹${cfg.price}/mo
            </button>
          </div>

          <!-- Yearly plan (shown by default) -->
          <div class="cgm-plan-card" id="cgm-plan-yearly-${id}">
            <div class="cgm-new-price" style="color:${accentColor};">₹${cfg.yearlyPrice} <span>/year</span></div>
            <div class="cgm-price-note">Best value · Just ₹${Math.round(cfg.yearlyPrice/12)}/mo · Cancel anytime</div>
            <button class="cgm-pay-btn" style="background:linear-gradient(135deg,${gradFrom},${gradTo});box-shadow:0 4px 20px rgba(${accentRGB},0.4);"
              onclick="window.payCompanionYearly('${persona}', this)">
              ${cfg.emoji} Get Yearly Plan — ₹${cfg.yearlyPrice}/year
            </button>
          </div>
        </div>

        <button class="cf-addon-skip" onclick="document.getElementById('${id}').remove()">Maybe later 🥺</button>
        <div class="cf-addon-secure">🔒 Secured by Cashfree · Auto-renews · Cancel anytime</div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    injectCompanionGateStyles();
    setTimeout(() => initCompanion3DAvatar('cgm-3d-avatar-' + id, persona), 80);
  }

  window.cgmSwitchPlan = function(modalId, plan) {
    const monthlyTab  = document.getElementById('cgm-tab-monthly-' + modalId);
    const yearlyTab   = document.getElementById('cgm-tab-yearly-' + modalId);
    const monthlyCard = document.getElementById('cgm-plan-monthly-' + modalId);
    const yearlyCard  = document.getElementById('cgm-plan-yearly-' + modalId);
    if (!monthlyTab || !yearlyTab || !monthlyCard || !yearlyCard) return;
    if (plan === 'monthly') {
      monthlyTab.classList.add('cgm-plan-tab-active');
      yearlyTab.classList.remove('cgm-plan-tab-active');
      monthlyCard.style.display = '';
      yearlyCard.style.display  = 'none';
    } else {
      yearlyTab.classList.add('cgm-plan-tab-active');
      monthlyTab.classList.remove('cgm-plan-tab-active');
      yearlyCard.style.display  = '';
      monthlyCard.style.display = 'none';
    }
  };

  function activateCompanionYearly(persona) {
    const cfg       = COMPANION_ADDONS[persona];
    const now       = Date.now();
    const expiresAt = now + 365 * 24 * 60 * 60 * 1000; // 1 year
    localStorage.setItem('crackai_addon_' + cfg.planId, JSON.stringify({
      active: true, activatedAt: now, expiresAt, monthly: false, yearly: true
    }));
    syncFirestore({ ['addon_' + cfg.planId]: true, ['addon_' + cfg.planId + '_expiry']: expiresAt });
    document.querySelectorAll('[id^="companionGateModal_' + persona + '"]').forEach(el => el.remove());
    const sel = document.getElementById('personaSettingsSelect');
    if (sel) {
      const opt = sel.querySelector('option[value="' + persona + '"]');
      if (opt) opt.textContent = persona === 'boyfriend' ? '💕 Boyfriend' : '💕 Girlfriend';
    }
    _doSelectPersona(persona);
    toast('🎉 ' + cfg.name + ' yearly plan activated! Enjoy 12 months 💕', 4000);
    if (typeof _doConfetti === 'function') _doConfetti();
  }

  /* ══════════════════════════════════════════════════════════════
     THREE.JS REALISTIC 3D COMPANION AVATAR
     — Sculpted head, skin-tone face, flowing hair, waving arm —
  ══════════════════════════════════════════════════════════════ */
  function initCompanion3DAvatar(canvasId, persona) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isBF = persona === 'boyfriend';
    const DPR  = Math.min(window.devicePixelRatio || 1, 2);
    const CSS_W = canvas.width, CSS_H = canvas.height;
    canvas.width  = CSS_W * DPR;
    canvas.height = CSS_H * DPR;
    canvas.style.width  = CSS_W + 'px';
    canvas.style.height = CSS_H + 'px';
    ctx.scale(DPR, DPR);

    const W = CSS_W, H = CSS_H;
    const cx = W / 2, cy = H / 2;

    // ── Palette ───────────────────────────────────────────────
    const skin      = '#C68642';   // warm medium-brown Indian skin
    const skinMid   = '#B5733A';
    const skinShadow= '#8B5520';
    const skinHi    = '#E8A96C';   // highlight
    const skinBlush = 'rgba(220,120,90,0.28)';
    const sclera    = '#F4EFE6';
    const irisC     = isBF ? '#3D2B1F' : '#2E1A2E';
    const irisHi    = isBF ? '#7A5540' : '#6B4070';
    const pupil     = '#0A0608';
    const lipC      = isBF ? '#B05040' : '#D4506A';
    const lipLo     = isBF ? '#8A3A2E' : '#AA3050';
    const hairC     = isBF ? '#1A0E08' : '#120810';
    const hairHi    = isBF ? '#3D2415' : '#2A1228';
    const shirtC    = isBF ? '#4A62D8' : '#D84A7A';
    const shirtHi   = isBF ? '#6A82F8' : '#F86A9A';
    const shirtSh   = isBF ? '#2A3A9A' : '#9A2A50';
    const browC     = isBF ? '#251208' : '#1A0A18';
    const teethC    = '#F0EDE6';

    // ── Animation state ───────────────────────────────────────
    let t = 0;
    const tOff = isBF ? 0 : 2.1;
    let blinkT = isBF ? 0 : 3.5;
    let blinkOpen = 1;   // 1 = open, 0 = closed
    let alive = true;
    let smilePhase = 0;  // 0-1 smile open/close for wave

    // Clean up when removed
    const obs = new MutationObserver(() => {
      if (!document.contains(canvas)) { alive = false; obs.disconnect(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // ── Helper: rounded rect ──────────────────────────────────
    function rrect(x,y,w,h,r) {
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.lineTo(x+w-r, y);
      ctx.quadraticCurveTo(x+w, y, x+w, y+r);
      ctx.lineTo(x+w, y+h-r);
      ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
      ctx.lineTo(x+r, y+h);
      ctx.quadraticCurveTo(x, y+h, x, y+h-r);
      ctx.lineTo(x, y+r);
      ctx.quadraticCurveTo(x, y, x+r, y);
      ctx.closePath();
    }

    // ── Draw frame ────────────────────────────────────────────
    function draw(tt) {
      ctx.clearRect(0, 0, W, H);

      // ── animated offsets (natural sway) ──────────────────────
      const sway   = Math.sin(tt * 0.7 + tOff) * 1.8;
      const bob    = Math.sin(tt * 0.9 + tOff) * 1.2;
      const tiltZ  = Math.sin(tt * 0.55 + tOff) * 0.06; // head tilt radians
      const nodX   = Math.sin(tt * 0.45 + tOff) * 0.03;

      // head pivot centre
      const hx = cx + sway;
      const hy = cy - 4 + bob;

      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(tiltZ);

      // ── SHIRT / SHOULDERS (behind head) ──────────────────────
      // Shoulders: two smooth arcs
      const shG = ctx.createRadialGradient(0, 44, 2, 0, 44, 52);
      shG.addColorStop(0, shirtHi);
      shG.addColorStop(0.5, shirtC);
      shG.addColorStop(1, shirtSh);
      ctx.fillStyle = shG;

      // Left shoulder
      ctx.beginPath();
      ctx.ellipse(-28, 44, 18, 13, -0.3, 0, Math.PI*2);
      ctx.fill();
      // Right shoulder
      ctx.beginPath();
      ctx.ellipse(28, 44, 18, 13, 0.3, 0, Math.PI*2);
      ctx.fill();
      // Torso top
      ctx.beginPath();
      ctx.moveTo(-22, 44);
      ctx.bezierCurveTo(-22, 58, 22, 58, 22, 44);
      ctx.bezierCurveTo(22, 38, -22, 38, -22, 44);
      ctx.fill();

      // ── WAVING ARM ───────────────────────────────────────────
      // Right arm raised — pivot from shoulder
      const waveAng   = -1.05 + Math.sin(tt * 2.3 + tOff) * 0.26;
      const foreAng   = 0.55  + Math.sin(tt * 2.3 + tOff) * 0.18;
      const wristFlick= Math.sin(tt * 2.3 + tOff) * 0.38;

      ctx.save();
      ctx.translate(28, 38); // shoulder pivot
      ctx.rotate(waveAng);

      // upper arm
      const uaG = ctx.createLinearGradient(-5, 0, 5, 0);
      uaG.addColorStop(0, skinShadow); uaG.addColorStop(0.4, skin); uaG.addColorStop(1, skinMid);
      ctx.fillStyle = uaG;
      ctx.beginPath();
      ctx.ellipse(0, -14, 5.5, 14, 0, 0, Math.PI*2);
      ctx.fill();

      ctx.translate(0, -28); // elbow pivot
      ctx.rotate(foreAng);

      // forearm
      const faG = ctx.createLinearGradient(-4, 0, 4, 0);
      faG.addColorStop(0, skinShadow); faG.addColorStop(0.45, skinHi); faG.addColorStop(1, skinMid);
      ctx.fillStyle = faG;
      ctx.beginPath();
      ctx.ellipse(0, -11, 4.5, 12, 0, 0, Math.PI*2);
      ctx.fill();

      ctx.translate(0, -23); // wrist pivot
      ctx.rotate(wristFlick);

      // Hand palm
      const hndG = ctx.createRadialGradient(0, 0, 1, 0, 0, 9);
      hndG.addColorStop(0, skinHi); hndG.addColorStop(0.6, skin); hndG.addColorStop(1, skinMid);
      ctx.fillStyle = hndG;
      ctx.beginPath();
      ctx.ellipse(0, -3, 6, 7, 0, 0, Math.PI*2);
      ctx.fill();

      // Fingers (4 rounded stubs)
      ctx.fillStyle = skin;
      const fSpacing = [-5.5, -2, 1.5, 5];
      fSpacing.forEach((fx, fi) => {
        ctx.beginPath();
        const fLen = fi === 0 || fi === 3 ? 5.5 : 7;
        ctx.ellipse(fx, -10 - fLen * 0.4, 2.3, fLen * 0.5, 0.05*(fi-1.5), 0, Math.PI*2);
        ctx.fill();
        // knuckle line
        ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.arc(fx, -10, 2, 0, Math.PI); ctx.stroke();
      });
      // Thumb
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.ellipse(-9, -5, 2.5, 5, -0.7, 0, Math.PI*2); ctx.fill();

      ctx.restore(); // wrist/forearm/shoulder

      // ── NECK ─────────────────────────────────────────────────
      const nkG = ctx.createLinearGradient(-7, 26, 7, 26);
      nkG.addColorStop(0, skinShadow); nkG.addColorStop(0.5, skin); nkG.addColorStop(1, skinMid);
      ctx.fillStyle = nkG;
      ctx.beginPath();
      ctx.moveTo(-7, 26);
      ctx.bezierCurveTo(-7, 38, 7, 38, 7, 26);
      ctx.bezierCurveTo(7, 20, -7, 20, -7, 26);
      ctx.fill();

      // ── HEAD SHAPE ───────────────────────────────────────────
      // Soft jaw shadow
      const jawShad = ctx.createRadialGradient(0, 18, 8, 0, 18, 28);
      jawShad.addColorStop(0, 'rgba(0,0,0,0)');
      jawShad.addColorStop(1, 'rgba(60,25,10,0.22)');
      ctx.fillStyle = jawShad;
      ctx.beginPath();
      ctx.ellipse(0, 16, 26, 12, 0, 0, Math.PI*2);
      ctx.fill();

      // Face base — warm gradient simulating light from upper-left
      const faceG = ctx.createRadialGradient(-6, -12, 4, 0, -4, 26);
      faceG.addColorStop(0,   skinHi);
      faceG.addColorStop(0.35, skin);
      faceG.addColorStop(0.7,  skinMid);
      faceG.addColorStop(1,    skinShadow);
      ctx.fillStyle = faceG;
      ctx.beginPath();
      // Head silhouette: wider at temples, tapers to chin
      ctx.moveTo(0, -26);
      ctx.bezierCurveTo(26, -26, 28, -8, 26, 4);
      ctx.bezierCurveTo(24, 14, 16, 22, 0, 26);
      ctx.bezierCurveTo(-16, 22, -24, 14, -26, 4);
      ctx.bezierCurveTo(-28, -8, -26, -26, 0, -26);
      ctx.fill();

      // Temple shadows (depth)
      ['left','right'].forEach(side => {
        const sx = side === 'left' ? -22 : 22;
        const tSh = ctx.createRadialGradient(sx, -4, 0, sx, -4, 14);
        tSh.addColorStop(0, 'rgba(60,25,10,0.20)');
        tSh.addColorStop(1, 'rgba(60,25,10,0)');
        ctx.fillStyle = tSh;
        ctx.beginPath();
        ctx.ellipse(sx, -4, 10, 18, 0, 0, Math.PI*2);
        ctx.fill();
      });

      // Forehead highlight
      const foreHi = ctx.createRadialGradient(-4, -18, 0, -4, -18, 13);
      foreHi.addColorStop(0, 'rgba(255,220,180,0.35)');
      foreHi.addColorStop(1, 'rgba(255,220,180,0)');
      ctx.fillStyle = foreHi;
      ctx.beginPath(); ctx.ellipse(-4, -18, 12, 9, 0, 0, Math.PI*2); ctx.fill();

      // Cheekbone highlight
      [-15, 15].forEach(cx2 => {
        const ckHi = ctx.createRadialGradient(cx2, 6, 0, cx2, 6, 10);
        ckHi.addColorStop(0, 'rgba(255,210,170,0.25)');
        ckHi.addColorStop(1, 'rgba(255,210,170,0)');
        ctx.fillStyle = ckHi; ctx.beginPath(); ctx.ellipse(cx2, 6, 8, 6, 0, 0, Math.PI*2); ctx.fill();
      });

      // Blush
      ctx.fillStyle = skinBlush;
      ctx.beginPath(); ctx.ellipse(-16, 8, 7, 4.5, -0.15, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( 16, 8, 7, 4.5,  0.15, 0, Math.PI*2); ctx.fill();

      // ── EARS ─────────────────────────────────────────────────
      ['left','right'].forEach(side => {
        const ex = side === 'left' ? -26 : 26;
        const earG = ctx.createRadialGradient(ex, 0, 0, ex, 0, 7);
        earG.addColorStop(0, skinMid);
        earG.addColorStop(1, skinShadow);
        ctx.fillStyle = earG;
        ctx.beginPath();
        ctx.ellipse(ex, 0, 4.5, 7, 0, 0, Math.PI*2);
        ctx.fill();
        // inner ear
        ctx.fillStyle = 'rgba(120,60,30,0.25)';
        ctx.beginPath(); ctx.ellipse(ex, 0, 2.5, 4, 0, 0, Math.PI*2); ctx.fill();
      });

      // ── HAIR ─────────────────────────────────────────────────
      if (isBF) {
        // Short fade — dark cap sitting naturally above forehead
        const hG = ctx.createLinearGradient(0, -30, 0, -14);
        hG.addColorStop(0, hairHi); hG.addColorStop(0.6, hairC);
        ctx.fillStyle = hG;
        ctx.beginPath();
        ctx.moveTo(-26, -16);
        ctx.bezierCurveTo(-27, -30, -14, -36, 0, -36);
        ctx.bezierCurveTo(14, -36, 27, -30, 26, -16);
        ctx.bezierCurveTo(20, -20, -20, -20, -26, -16);
        ctx.fill();

        // Subtle fringe strands
        ctx.strokeStyle = hairC; ctx.lineWidth = 1.8;
        [[-8,-18,-4,-23],[-2,-20,2,-26],[5,-17,10,-22]].forEach(([x1,y1,x2,y2]) => {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1+x2)/2-2, y1+1, x2, y2); ctx.stroke();
        });

        // Side fade (temples)
        ['left','right'].forEach(s => {
          const sx = s === 'left' ? -22 : 22;
          const tfG = ctx.createRadialGradient(sx, -14, 0, sx, -14, 10);
          tfG.addColorStop(0, hairC); tfG.addColorStop(1, 'transparent');
          ctx.fillStyle = tfG;
          ctx.beginPath(); ctx.ellipse(sx, -15, 7, 9, 0, 0, Math.PI*2); ctx.fill();
        });

      } else {
        // Long silky hair — center part, flowing sides
        const hG = ctx.createLinearGradient(-5, -38, 8, -10);
        hG.addColorStop(0, hairHi); hG.addColorStop(0.5, hairC); hG.addColorStop(1, hairC);
        ctx.fillStyle = hG;

        // Left side hair flowing down
        ctx.beginPath();
        ctx.moveTo(-2, -35);
        ctx.bezierCurveTo(-10, -34, -26, -24, -28, -8);
        ctx.bezierCurveTo(-30, 4, -28, 18, -26, 28);
        ctx.bezierCurveTo(-22, 32, -18, 30, -16, 26);
        ctx.bezierCurveTo(-20, 16, -22, 4, -22, -6);
        ctx.bezierCurveTo(-21, -18, -16, -26, -4, -32);
        ctx.closePath();
        ctx.fill();

        // Right side hair
        ctx.beginPath();
        ctx.moveTo(2, -35);
        ctx.bezierCurveTo(10, -34, 26, -24, 28, -8);
        ctx.bezierCurveTo(30, 4, 28, 18, 26, 28);
        ctx.bezierCurveTo(22, 32, 18, 30, 16, 26);
        ctx.bezierCurveTo(20, 16, 22, 4, 22, -6);
        ctx.bezierCurveTo(21, -18, 16, -26, 4, -32);
        ctx.closePath();
        ctx.fill();

        // Top cap
        ctx.beginPath();
        ctx.moveTo(-4, -35);
        ctx.bezierCurveTo(-18, -36, -26, -26, -26, -16);
        ctx.bezierCurveTo(-20, -20, -10, -22, 0, -22);
        ctx.bezierCurveTo(10, -22, 20, -20, 26, -16);
        ctx.bezierCurveTo(26, -26, 18, -36, 4, -35);
        ctx.fill();

        // Center parting line
        ctx.strokeStyle = 'rgba(5,2,10,0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -35); ctx.lineTo(0, -22);
        ctx.stroke();

        // Hair strand highlights
        const hHiG = ctx.createLinearGradient(-20, -30, -14, 10);
        hHiG.addColorStop(0, 'rgba(80,40,60,0.0)');
        hHiG.addColorStop(0.4, 'rgba(90,50,70,0.45)');
        hHiG.addColorStop(1, 'rgba(80,40,60,0.0)');
        ctx.fillStyle = hHiG;
        ctx.beginPath();
        ctx.moveTo(-18, -30); ctx.lineTo(-12, -30);
        ctx.lineTo(-8, 20); ctx.lineTo(-14, 20);
        ctx.closePath();
        ctx.fill();

        // GF earring (subtle dot)
        ctx.fillStyle = '#FFD700';
        ctx.beginPath(); ctx.arc(-25, 6, 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc( 25, 6, 2, 0, Math.PI*2); ctx.fill();
      }

      // ── EYEBROWS ─────────────────────────────────────────────
      // Natural arched brows
      [[-12, -16, isBF ? 0.18 : 0.25], [12, -16, isBF ? -0.18 : -0.25]].forEach(([bx, by, tilt]) => {
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(tilt);
        // Brow fill — tapers at ends
        ctx.fillStyle = browC;
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.bezierCurveTo(-6, -2.2, 6, -2.2, 7, 0);
        ctx.bezierCurveTo(6, 1.2, -6, 1.2, -7, 0);
        ctx.fill();

        // Fine hair texture
        ctx.strokeStyle = 'rgba(10,4,2,0.5)';
        ctx.lineWidth = 0.5;
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(i*2, 0.5);
          ctx.lineTo(i*2 + (bx < 0 ? 1 : -1), -1.5);
          ctx.stroke();
        }
        ctx.restore();
      });

      // ── EYES ─────────────────────────────────────────────────
      [[-12, -6], [12, -6]].forEach(([ex, ey], ei) => {
        ctx.save();
        ctx.translate(ex, ey);

        // Eye socket shadow
        const sockSh = ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
        sockSh.addColorStop(0, 'rgba(0,0,0,0)');
        sockSh.addColorStop(1, 'rgba(40,15,5,0.18)');
        ctx.fillStyle = sockSh;
        ctx.beginPath(); ctx.ellipse(0, 0, 10, 8, 0, 0, Math.PI*2); ctx.fill();

        // Sclera
        ctx.fillStyle = sclera;
        ctx.beginPath();
        ctx.ellipse(0, 0, 8.5, 6.5, 0, 0, Math.PI*2);
        ctx.fill();

        // Iris gradient
        const irisG = ctx.createRadialGradient(-1.5, -1.5, 0.5, 0, 0, 6.5);
        irisG.addColorStop(0, irisHi);
        irisG.addColorStop(0.4, irisC);
        irisG.addColorStop(1, '#000000');
        ctx.fillStyle = irisG;
        ctx.beginPath();
        ctx.arc(0, 0, 5.5, 0, Math.PI*2);
        ctx.fill();

        // Pupil
        ctx.fillStyle = pupil;
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill();

        // Catchlight (makes eyes alive!)
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.beginPath(); ctx.ellipse(-2, -2, 1.8, 1.4, -0.5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath(); ctx.arc(2, 2, 0.8, 0, Math.PI*2); ctx.fill();

        // Eyelid crease
        ctx.strokeStyle = 'rgba(80,35,15,0.25)'; ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-8, -1);
        ctx.bezierCurveTo(-5, -6, 5, -6, 8, -1);
        ctx.stroke();

        // Upper eyelid (skin flap — covers top of iris)
        const lidG = ctx.createLinearGradient(0, -8, 0, -2);
        lidG.addColorStop(0, skinMid);
        lidG.addColorStop(1, 'rgba(180,110,60,0)');
        ctx.fillStyle = lidG;
        ctx.beginPath();
        ctx.moveTo(-9, -1);
        ctx.bezierCurveTo(-7, -8, 7, -8, 9, -1);
        ctx.bezierCurveTo(5, -3, -5, -3, -9, -1);
        ctx.fill();

        // Blink: lower lid rises
        if (blinkOpen < 1) {
          const blinkH = (1 - blinkOpen) * 6.5;
          const lidSkinG = ctx.createLinearGradient(0, 0, 0, blinkH);
          lidSkinG.addColorStop(0, skin); lidSkinG.addColorStop(1, skinMid);
          ctx.fillStyle = lidSkinG;
          ctx.beginPath();
          ctx.moveTo(-8.5, 6.5);
          ctx.bezierCurveTo(-5, 6.5 - blinkH, 5, 6.5 - blinkH, 8.5, 6.5);
          ctx.bezierCurveTo(5, 7.5, -5, 7.5, -8.5, 6.5);
          ctx.fill();
        }

        // Lower lash line
        ctx.strokeStyle = 'rgba(30,10,5,0.35)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(-8, 5); ctx.bezierCurveTo(-5, 7.5, 5, 7.5, 8, 5); ctx.stroke();

        // Upper lashes — short strokes
        ctx.strokeStyle = hairC; ctx.lineWidth = 1.2;
        for (let i = -3; i <= 3; i++) {
          const lx = i * 2.5;
          const ly = -Math.sqrt(Math.max(0, 56 - lx*lx)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx + (i < 0 ? -1 : i > 0 ? 1 : 0), ly - 2.5);
          ctx.stroke();
        }

        // GF: eyeliner flick
        if (!isBF) {
          ctx.strokeStyle = 'rgba(10,5,20,0.75)'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ei === 0 ? -8 : 8, -1.5);
          ctx.lineTo(ei === 0 ? -11 : 11, -4);
          ctx.stroke();
        }

        ctx.restore();
      });

      // ── NOSE ─────────────────────────────────────────────────
      // Bridge shadow
      const noseG = ctx.createLinearGradient(-2, -4, 2, 8);
      noseG.addColorStop(0, 'rgba(100,50,20,0.12)');
      noseG.addColorStop(0.6, 'rgba(100,50,20,0.25)');
      noseG.addColorStop(1, 'rgba(100,50,20,0)');
      ctx.fillStyle = noseG;
      ctx.beginPath();
      ctx.moveTo(-1.5, -5);
      ctx.bezierCurveTo(-2.5, 0, -5, 8, -4, 10);
      ctx.bezierCurveTo(-2, 12, 2, 12, 4, 10);
      ctx.bezierCurveTo(5, 8, 2.5, 0, 1.5, -5);
      ctx.fill();

      // Nose tip
      const noseTipG = ctx.createRadialGradient(-1, 9, 0, 0, 10, 7);
      noseTipG.addColorStop(0, skinHi); noseTipG.addColorStop(0.5, skin); noseTipG.addColorStop(1, skinShadow);
      ctx.fillStyle = noseTipG;
      ctx.beginPath();
      ctx.ellipse(0, 10, 6, 4.5, 0, 0, Math.PI*2);
      ctx.fill();

      // Nostrils
      ctx.fillStyle = 'rgba(70,30,10,0.45)';
      ctx.beginPath(); ctx.ellipse(-4, 11, 2.5, 2, 0.3, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( 4, 11, 2.5, 2, -0.3, 0, Math.PI*2); ctx.fill();

      // Nose highlight
      ctx.fillStyle = 'rgba(255,220,180,0.38)';
      ctx.beginPath(); ctx.ellipse(-1, 9, 1.8, 2, 0, 0, Math.PI*2); ctx.fill();

      // ── MOUTH ────────────────────────────────────────────────
      // Smile driven by wave animation — slight open during wave peak
      smilePhase = (Math.sin(tt * 2.3 + tOff) + 1) / 2;  // 0-1
      const smileW = 11 + smilePhase * 2;
      const smileD = 2.5 + smilePhase * 1.5;
      const mouthOpen = smilePhase > 0.6 ? (smilePhase - 0.6) * 8 : 0; // slight open

      // Mouth shadow
      ctx.fillStyle = 'rgba(60,20,10,0.22)';
      ctx.beginPath();
      ctx.ellipse(0, 19, smileW + 2, 4, 0, 0, Math.PI*2);
      ctx.fill();

      if (mouthOpen > 0.5) {
        // Open mouth — show teeth
        ctx.fillStyle = skinShadow;
        ctx.beginPath();
        ctx.moveTo(-smileW, 18);
        ctx.bezierCurveTo(-smileW + 2, 18 + smileD, smileW - 2, 18 + smileD, smileW, 18);
        ctx.bezierCurveTo(smileW - 2, 18 + smileD + mouthOpen, -smileW + 2, 18 + smileD + mouthOpen, -smileW, 18);
        ctx.fill();

        // Teeth strip
        ctx.fillStyle = teethC;
        ctx.beginPath();
        ctx.moveTo(-smileW + 1, 18.5);
        ctx.bezierCurveTo(-smileW + 3, 18 + smileD - 0.5, smileW - 3, 18 + smileD - 0.5, smileW - 1, 18.5);
        ctx.bezierCurveTo(smileW - 3, 18 + smileD + 2, -smileW + 3, 18 + smileD + 2, -smileW + 1, 18.5);
        ctx.fill();
      }

      // Upper lip
      const ulG = ctx.createLinearGradient(0, 15, 0, 20);
      ulG.addColorStop(0, lipC); ulG.addColorStop(1, lipLo);
      ctx.fillStyle = ulG;
      ctx.beginPath();
      ctx.moveTo(-smileW, 18);
      ctx.bezierCurveTo(-smileW + 2, 16, -4, 15.5, 0, 16);
      ctx.bezierCurveTo(4, 15.5, smileW - 2, 16, smileW, 18);
      ctx.bezierCurveTo(smileW - 2, 18 + smileD, -smileW + 2, 18 + smileD, -smileW, 18);
      ctx.fill();

      // Lip highlight
      ctx.fillStyle = 'rgba(255,200,180,0.3)';
      ctx.beginPath(); ctx.ellipse(-2, 17, 5, 1.2, 0.1, 0, Math.PI*2); ctx.fill();

      // Lower lip
      const llG = ctx.createLinearGradient(0, 20, 0, 24);
      llG.addColorStop(0, lipC); llG.addColorStop(1, lipLo);
      ctx.fillStyle = llG;
      ctx.beginPath();
      ctx.moveTo(-smileW, 18);
      ctx.bezierCurveTo(-smileW + 2, 18 + smileD, smileW - 2, 18 + smileD, smileW, 18);
      ctx.bezierCurveTo(smileW - 1, 20 + smileD + 1, -smileW + 1, 20 + smileD + 1, -smileW, 18);
      ctx.fill();

      // Lower lip highlight
      ctx.fillStyle = 'rgba(255,200,180,0.32)';
      ctx.beginPath(); ctx.ellipse(0, 21, 5, 1.5, 0, 0, Math.PI*2); ctx.fill();

      // Chin dimple (subtle)
      ctx.strokeStyle = 'rgba(80,35,15,0.15)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(0, 26, 3, 0.2, Math.PI - 0.2); ctx.stroke();

      ctx.restore(); // head pivot

      // ── UPDATE BLINK ─────────────────────────────────────────
      blinkT += 0.016;
      // Blink every ~4s, quick
      if (blinkT > 4.0) {
        blinkT = 0;
        blinkOpen = 0;
      }
      if (blinkOpen < 1) {
        blinkOpen = Math.min(1, blinkOpen + 0.18);
      }
    }

    // ── RAF loop ─────────────────────────────────────────────
    function loop() {
      if (!alive) return;
      requestAnimationFrame(loop);
      t += 0.016;
      draw(t);
    }
    loop();
  }

  function injectCompanionGateStyles() {
    if (document.getElementById('cgm-styles')) return;
    const s = document.createElement('style');
    s.id = 'cgm-styles';
    s.textContent = `
      .cgm-box{position:relative;background:linear-gradient(160deg,#0f0c1f,#1a1235);border:1px solid rgba(255,107,157,0.3);border-radius:24px;padding:28px 20px 20px;max-width:350px;width:100%;text-align:center;box-shadow:0 0 80px rgba(255,107,157,0.12),0 28px 56px rgba(0,0,0,0.6);animation:cfSlideUp .28s cubic-bezier(.34,1.56,.64,1);overflow:hidden;}
      .cgm-glow{position:absolute;inset:0;pointer-events:none;}
      .cgm-offer-badge{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#FF6B9D;background:rgba(255,107,157,0.15);border:1px solid rgba(255,107,157,0.35);padding:4px 14px;border-radius:20px;margin-bottom:16px;}
      .cgm-avatar-wrap{position:relative;width:80px;height:80px;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;}
      .cgm-avatar-ring{position:absolute;inset:-4px;border-radius:50%;border:2px solid;animation:introRingPulse 2.5s ease-in-out infinite;}
      .cgm-avatar{font-size:44px;position:relative;z-index:1;filter:drop-shadow(0 4px 12px rgba(0,0,0,0.4));}
      .cgm-status-dot{position:absolute;bottom:4px;right:4px;width:14px;height:14px;border-radius:50%;border:2px solid #0f0c1f;z-index:2;}
      .cgm-name{font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:800;margin-bottom:6px;}
      .cgm-tagline{font-size:12px;color:rgba(220,210,255,0.6);font-style:italic;line-height:1.5;margin-bottom:16px;padding:0 8px;}
      .cgm-talk-section{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:12px 14px;margin-bottom:14px;text-align:left;}
      .cgm-talk-label{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(200,180,255,0.5);margin-bottom:8px;}
      .cgm-bubbles{display:flex;flex-direction:column;gap:6px;}
      .cgm-bubble{font-size:11.5px;line-height:1.5;color:rgba(230,225,255,0.85);background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.18);border-radius:12px 12px 12px 4px;padding:7px 11px;}
      .cgm-features{display:flex;flex-direction:column;gap:6px;margin-bottom:16px;text-align:left;}
      .cgm-feat{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:rgba(210,205,255,0.75);line-height:1.45;}
      .cgm-feat-icon{font-weight:800;flex-shrink:0;margin-top:1px;}
      .cgm-pricing-wrap{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:14px 14px 12px;margin-bottom:12px;}
      .cgm-plan-tabs{display:flex;gap:6px;margin-bottom:12px;}
      .cgm-plan-tab{flex:1;padding:8px 4px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:rgba(26,26,38,0.50);font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;position:relative;}
      .cgm-plan-tab-active{background:rgba(108,99,255,0.2);border-color:rgba(108,99,255,0.4);color:#a89cff;}
      .cgm-save-pill{display:inline-block;font-size:9px;font-weight:700;background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.3);color:#10b981;padding:2px 6px;border-radius:20px;margin-left:5px;vertical-align:middle;}
      .cgm-plan-card{text-align:center;}
      .cgm-old-price{font-size:11px;color:rgba(200,180,220,0.4);text-decoration:line-through;margin-bottom:2px;}
      .cgm-new-price{font-size:30px;font-weight:800;margin-bottom:4px;line-height:1;}
      .cgm-new-price span{font-size:13px;font-weight:400;color:rgba(200,180,220,0.5);margin-left:2px;}
      .cgm-price-note{font-size:10px;color:rgba(200,180,220,0.4);margin-bottom:12px;}
      .cgm-pay-btn{width:100%;padding:13px;border:none;border-radius:13px;color:var(--text-primary);font-size:14px;font-weight:700;cursor:pointer;transition:opacity .2s,transform .15s;letter-spacing:.02em;}
      .cgm-pay-btn:hover:not(:disabled){opacity:.9;transform:scale(1.01);}
      .cgm-pay-btn:disabled{opacity:.6;cursor:default;}
    `;
    document.head.appendChild(s);
  }

  // ── Settings dropdown handler ─────────────────────────────────
  window.handlePersonaSettingsChange = function(selectEl) {
    const persona   = selectEl.value;
    const prevValue = (typeof state !== 'undefined' ? state.aiPersona : null) || '';
    // companion check removed
    _doSelectPersona(persona);
  };

  // ── Persona modal card click interceptor ──────────────────────
  window.selectPersona = function(persona) {
    // companion check removed
    _doSelectPersona(persona);
  };

  // Expose globals AFTER all functions are defined
  window.openCompanionGateModal = openCompanionGateModal;

  // ── Patch openPremiumModal to always use payment.js's renderPremiumModal ──
  // Capture the real function NOW, before anything overwrites window.renderPremiumModal.
  const _paymentRenderPremiumModal = window.renderPremiumModal;
  window.openPremiumModal = window.showPremiumModal = function() {
    _paymentRenderPremiumModal();
    const modal = document.getElementById('premiumModal');
    if (modal) modal.classList.add('active');
    if (typeof window._rewirePvsPlayer === 'function') setTimeout(window._rewirePvsPlayer, 0);
  };

  /* ─── INIT ──────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(checkPendingOnLoad, 1500));
  } else {
    setTimeout(checkPendingOnLoad, 1500);
  }

  // ── Add lock badges to BF/GF persona cards on load ─────────────
  function refreshCompanionLockUI() {
    const bfUnlocked = isCompanionUnlocked('boyfriend');
    const gfUnlocked = isCompanionUnlocked('girlfriend');

    // Persona modal cards
    document.querySelectorAll('[data-companion-lock="true"]').forEach(card => {
      const isBF = card.onclick?.toString().includes('boyfriend') ||
                   card.getAttribute('onclick')?.includes('boyfriend');
      const unlocked = isBF ? bfUnlocked : gfUnlocked;

      // Remove existing badge first
      card.querySelector('.companion-lock-badge')?.remove();

      if (!unlocked) {
        const badge = document.createElement('span');
        badge.className = 'companion-lock-badge';
        badge.textContent = '🔒 ₹49';
        badge.style.cssText = `
          position:absolute; top:8px; right:8px;
          font-size:10px; font-weight:700;
          background:rgba(255,107,157,0.2);
          border:1px solid rgba(255,107,157,0.4);
          color:#FF6B9D; padding:2px 7px;
          border-radius:20px; pointer-events:none;
        `;
        card.style.position = 'relative';
        card.appendChild(badge);
      }
    });

    // Settings dropdown options — update lock text
    const sel = document.getElementById('personaSettingsSelect');
    if (sel) {
      const bfOpt = sel.querySelector('option[value="boyfriend"]');
      const gfOpt = sel.querySelector('option[value="girlfriend"]');
      if (bfOpt) bfOpt.textContent = bfUnlocked ? '💕 Boyfriend' : '💕 Boyfriend 🔒';
      if (gfOpt) gfOpt.textContent = gfUnlocked ? '💕 Girlfriend' : '💕 Girlfriend 🔒';
    }
  }

  // Run on load + whenever persona modal opens
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(refreshCompanionLockUI, 800));
  } else {
    setTimeout(refreshCompanionLockUI, 800);
  }

  // Patch showPersonaSelector to refresh lock badges each time modal opens
  const _origShowPersonaSelector = window.showPersonaSelector;
  window.showPersonaSelector = function() {
    if (typeof _origShowPersonaSelector === 'function') _origShowPersonaSelector();
    else {
      const m = document.getElementById('personaSelectorModal');
      if (m) m.classList.add('active');
    }
    setTimeout(refreshCompanionLockUI, 80);
  };

  // ── Teacher Mode is now FREE — patch all gates ───────────────
  // Override _isTeacherPremium so voice-ai.js always returns true
  // This runs after voice-ai.js loads (deferred), so we patch on a delay too
  function patchTeacherFree() {
    // Mark as unlocked in localStorage
    localStorage.setItem('sscai_teacher_unlocked', 'true');
    // Override the check function if accessible
    if (typeof window._isTeacherPremiumOverride === 'undefined') {
      window._isTeacherPremiumOverride = true;
      // Patch voice-ai internal function via a global that voice-ai.js checks
      window.__teacherAlwaysFree = true;
    }
    // Override openTeacherPaywall to be a no-op
    window.openTeacherPaywall = function() {
      // Teacher is free — just unlock
      localStorage.setItem('sscai_teacher_unlocked', 'true');
      // Try to close any open paywall
      const pw = document.getElementById('teacherPaywallModal');
      if (pw) { pw.classList.remove('active'); pw.style.display = 'none'; }
    };
    // Override openTeacherAdModal to also be a no-op
    if (typeof window.openTeacherAdModal !== 'undefined') {
      window.openTeacherAdModal = function() {
        localStorage.setItem('sscai_teacher_unlocked', 'true');
        showToast('🎓 Teacher Mode is now FREE! Enjoy unlimited voice answers 🎉', 3000);
      };
    }
    // Remove lock badge from teacher model option if present
    const teacherOpt = document.querySelector('[data-model="teacher"] .model-opt-name');
    if (teacherOpt) {
      const tag = teacherOpt.querySelector('.model-tag');
      if (tag && (tag.textContent.includes('₹') || tag.textContent.includes('PREMIUM'))) {
        tag.textContent = 'FREE';
        tag.className = 'model-tag free-tag';
      }
    }
  }

  // Patch immediately and after scripts load
  patchTeacherFree();
  window.addEventListener('load', patchTeacherFree);
  setTimeout(patchTeacherFree, 2000);

  console.log('[payment.js] v2.1 loaded — using Cloud Run backend for order creation');

})();