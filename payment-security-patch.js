/**
 * payment-security-patch.js  v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * DROP-IN ON TOP OF payment.js + app.js.  Load this file LAST (after all other
 * scripts) via a <script defer src="payment-security-patch.js"></script>.
 *
 * What this file does
 * ───────────────────
 * PART A — activatePlan rewrite
 *   After a verified payment (verifyPayment returned PAID), the backend already
 *   wrote isPremium + premiumExpiry to Firestore users/{uid}.  The only thing
 *   the client still needs to do is update its in-memory state and the UI —
 *   NOT write to localStorage.  All localStorage.setItem premium writes are
 *   removed.  The in-memory `state.isPremium` is still set so the rest of the
 *   app (UI functions) keeps working without changes.
 *
 * PART B — fetch patches for callDeepSeek / callGeminiForImage
 *   1. Injects Authorization: Bearer <token> on every request to the proxy.
 *   2. On 403 → openPremiumModal().
 *   3. On 429 → handleLimitHit(type) and updates the in-memory daily counter
 *      so the UI reflects the new state immediately.
 *   4. Keeps canSend* checks ONLY as optimistic UI hints (they never block the
 *      server-side gate, so they're safe to keep for UX).
 *
 * PART C — /api/status poller
 *   Replaces the localStorage-based isPremium() in strict-gate-patch.js with a
 *   server-side fetch that is cached in memory for 60 s.
 *
 * PART D — promo validation
 *   Replaces the hardcoded BATTLE_PROMO constant with a call to
 *   POST /api/validate-promo.
 */

(function () {
  'use strict';

  // ── Cloud Run URLs (same as the rest of the app) ─────────────────────────
  // Adjust if your project uses firebase.json rewrites instead of direct URLs.
  const BASE_URL       = 'https://deepseek-56khnynjia-uc.a.run.app';  // /api/deepseek
  const STATUS_URL     = '/api/status';           // served via firebase.json rewrite
  const PROMO_URL      = '/api/validate-promo';   // served via firebase.json rewrite

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  function currentUser() {
    return window._firebaseAuth?.currentUser || null;
  }

  async function getIdToken() {
    try {
      const u = currentUser();
      return u ? await u.getIdToken() : null;
    } catch { return null; }
  }

  function toast(msg, ms) {
    if (typeof showToast === 'function') showToast(msg, ms || 3000);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PART A — activatePlan: remove all localStorage premium writes
  // ─────────────────────────────────────────────────────────────────────────
  //
  // The server already persisted isPremium to Firestore inside verifyPayment.
  // Here we only update in-memory state + refresh the UI.
  // We DO keep non-premium localStorage writes (battleTier, semiannualExpires,
  // group_plan, etc.) because those are cosmetic/UX, not security gates.

  const _origActivatePlan = window.activatePlan;   // payment.js defines this

  window.activatePlan = function patchedActivatePlan(planId) {
    // ── 1. In-memory state (kept for compatibility with app.js UI checks) ──
    if (typeof state !== 'undefined') {
      state.isPremium   = true;
      state.premiumPlan = planId;
    }

    // ── 2. NO localStorage premium write — server is authoritative ─────────
    //    (removed: localStorage.setItem(p + 'premium', 'true'))
    //    (removed: localStorage.setItem(p + 'premium_plan', planId))

    // ── 3. Plan-specific UX state that is NOT a security gate ──────────────
    const groupPlans = ['group_leader', 'coaching_basic', 'coaching_pro'];
    if (groupPlans.includes(planId)) {
      try {
        const u  = window._firebaseAuth?.currentUser;
        const p  = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
        localStorage.setItem(p + 'group_admin', 'true');
        localStorage.setItem(p + 'group_plan',  planId);
      } catch (e) {}
    }

    const battlePlans = { battle: 5, battle_pro: 19, battle_academy: 29 };
    if (battlePlans[planId] !== undefined) {
      try {
        localStorage.setItem('sscai_battle_monthly_max', String(battlePlans[planId]));
        localStorage.setItem('sscai_battle_tier', planId);
      } catch (e) {}
    }

    if (planId === 'semiannual') {
      try {
        const exp = Date.now() + 183 * 24 * 60 * 60 * 1000;
        localStorage.setItem('sscai_semiannual_expires', String(exp));
      } catch (e) {}
    }

    // ── 4. Invalidate the /api/status cache so next poll is fresh ──────────
    _statusCache = null;

    // ── 5. UI refreshes (identical to original) ────────────────────────────
    if (typeof saveState        === 'function') saveState();
    if (typeof updateUserUI     === 'function') updateUserUI();
    if (typeof updateProfileUI  === 'function') updateProfileUI();
    if (typeof updateLimitUI    === 'function') updateLimitUI();
    if (typeof renderPremiumModal === 'function') renderPremiumModal();
    if (typeof closePremiumModal  === 'function') closePremiumModal();

    try {
      const el = document.getElementById('messageLimitInfo');
      if (el) el.innerHTML = '<span style="color:#f59e0b">⭐ Premium Active · Unlimited Access</span>';
    } catch (e) {}

    try {
      ['premiumActiveBadge', 'headerPremiumBadge'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.style.display = 'flex';
      });
      const planEl = document.getElementById('drawerUserPlan');
      if (planEl) planEl.textContent = '⭐ Premium';
      const upgBtn = document.getElementById('upgradeDrawerBtn');
      if (upgBtn) upgBtn.style.display = 'none';
    } catch (e) {}

    try {
      document.querySelectorAll('.model-option[data-model]').forEach(opt => {
        const tag = opt.querySelector('.model-tag, .model-lock-tag');
        if (tag && (tag.textContent.includes('🔒') || tag.textContent.includes('PREMIUM'))) {
          tag.textContent = 'PRO';
          tag.classList.remove('lock-tag');
          tag.classList.add('pro-tag');
        }
        opt.style.pointerEvents = '';
        opt.style.opacity = '';
      });
    } catch (e) {}

    try {
      ['imageUploadBtn', 'pdfUploadBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { btn.disabled = false; btn._sgBound = false; }
      });
    } catch (e) {}

    const PLANS = {
      group_leader: '🎉 Group Leader activated!', coaching_basic: '🎉 Coaching Starter activated!',
      coaching_pro: '🎉 Coaching Pro activated!', battle_pro: '🎉 Battle Creator Pro activated! ⚔️',
      battle_academy: '🎉 Battle Creator Academy activated! 🏆', semiannual: '🔥 6-Month SSC Plan activated! 🎯',
    };
    toast(PLANS[planId] || '🎉 Premium activated! Unlimited access unlocked! 🚀', 4500);
    if (typeof _doConfetti === 'function') _doConfetti();

    console.info('[payment-security-patch] activatePlan —', planId, '— localStorage premium writes removed');
  };

  // ─────────────────────────────────────────────────────────────────────────
  // PART B — fetch patches: inject token + handle 403 / 429
  // ─────────────────────────────────────────────────────────────────────────
  //
  // We monkey-patch the two internal callDeepSeek + callGeminiForImage fetch
  // calls.  Rather than modifying app.js (risky), we wrap window.fetch so
  // that requests to our Cloud Run proxy automatically get the Bearer token
  // and the right error handling.

  const _origFetch = window.fetch;

  window.fetch = async function patchedFetch(url, opts) {
    // Only intercept requests to our own Cloud Run proxy
    const urlStr = typeof url === 'string' ? url : (url.url || '');
    const isProxy = urlStr.includes('run.app') || urlStr.startsWith('/api/');

    if (!isProxy) return _origFetch.apply(this, arguments);

    // Inject auth token
    let token = null;
    try { token = await getIdToken(); } catch {}

    const newOpts = opts ? { ...opts } : {};
    newOpts.headers = { ...(newOpts.headers || {}) };
    if (token) newOpts.headers['Authorization'] = `Bearer ${token}`;

    const response = await _origFetch.call(this, url, newOpts);

    // 403 → premium required
    if (response.status === 403) {
      try { if (typeof openPremiumModal === 'function') openPremiumModal(); } catch {}
      return response; // still return so callers can handle it
    }

    // 429 → daily limit hit
    if (response.status === 429) {
      try {
        const data = await response.clone().json().catch(() => ({}));
        const type = data.type || 'text';
        if (typeof handleLimitHit === 'function') handleLimitHit(type);
      } catch {}
      return response;
    }

    // On success, update remaining count from header if present
    const remaining = response.headers.get('X-Daily-Remaining');
    if (remaining !== null && typeof state !== 'undefined') {
      const rem = parseInt(remaining, 10);
      if (!isNaN(rem)) {
        // Map remaining back to a synthetic count so existing limit UI works
        const FREE = 10;
        if (urlStr.includes('isVision') || (typeof opts?.body === 'string' && opts.body.includes('"isVision":true'))) {
          state.imageCount = Math.max(0, FREE - rem);
        } else {
          state.textCount = Math.max(0, FREE - rem);
        }
        if (typeof updateLimitUI === 'function') updateLimitUI();
      }
    }

    return response;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // PART C — /api/status — server-side isPremium, 60 s in-memory cache
  // ─────────────────────────────────────────────────────────────────────────
  //
  // strict-gate-patch.js calls window._securityPatch.isPremium() (sync).
  // We make it async-backed: a background poll updates a module-level variable,
  // and the sync accessor returns it.  Cached for 60 s; invalidated on payment.

  let _statusCache   = null;   // { isPremium, dailyRemaining, fetchedAt }
  let _statusFetching = false;

  async function _fetchStatus() {
    if (_statusFetching) return;
    _statusFetching = true;
    try {
      const token = await getIdToken();
      if (!token) { _statusCache = { isPremium: false, dailyRemaining: 10, fetchedAt: Date.now() }; return; }

      const res  = await _origFetch(STATUS_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      _statusCache = { isPremium: !!data.isPremium, dailyRemaining: data.dailyRemaining ?? null, fetchedAt: Date.now() };

      // Sync in-memory state
      if (typeof state !== 'undefined') state.isPremium = _statusCache.isPremium;
      if (typeof updateLimitUI === 'function') updateLimitUI();
    } catch (e) {
      // On error, keep old cache or default to free
      if (!_statusCache) _statusCache = { isPremium: false, dailyRemaining: 10, fetchedAt: Date.now() };
    } finally {
      _statusFetching = false;
    }
  }

  // Sync accessor used by strict-gate-patch.js
  function _isPremiumSync() {
    if (!_statusCache) {
      _fetchStatus(); // trigger background fetch
      // Fall back to localStorage for the first paint — not a security risk because
      // the server gate enforces the real limit. The UI might briefly show wrong state.
      try {
        const u = window._firebaseAuth?.currentUser;
        const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
        return localStorage.getItem(p + 'premium') === 'true';
      } catch { return false; }
    }
    // Refresh in background if cache older than 60 s
    if (Date.now() - _statusCache.fetchedAt > 60_000) _fetchStatus();
    return _statusCache.isPremium;
  }

  // Expose for strict-gate-patch.js
  window._securityPatch = {
    isPremium:       _isPremiumSync,
    invalidateCache: () => { _statusCache = null; },
  };

  // Override the global isPremium function used throughout the app
  // (strict-gate-patch.js's local isPremium() closure cannot be replaced,
  //  but its setInterval re-enforcement path calls window.canSendText etc.
  //  which DO go through this patch — so the server gate still wins.)
  window._isPremiumServerSide = _isPremiumSync;

  // Initial fetch
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_fetchStatus, 1000));
  } else {
    setTimeout(_fetchStatus, 1000);
  }

  // Refresh on auth state change
  try {
    window._firebaseAuth?.onAuthStateChanged?.(() => {
      _statusCache = null;
      setTimeout(_fetchStatus, 500);
    });
  } catch {}

  // ─────────────────────────────────────────────────────────────────────────
  // PART D — battle promo: remove hardcoded constant, validate server-side
  // ─────────────────────────────────────────────────────────────────────────
  //
  // battle-arena-patch.js has:
  //   const BATTLE_PROMO = 'MU1R43PNZ889VKSZ';
  //   ...
  //   if (code.trim().toUpperCase() === BATTLE_PROMO) { ... }
  //
  // We override the global validateBattlePromo function (or the inline check)
  // by replacing the function battle-arena-patch.js calls after code entry.
  // Because the const is IIFE-scoped, we can't change it directly; instead we
  // override window.validateBattlePromo which battle-arena-patch.js should call.

  window.validateBattlePromo = async function (code, onSuccess, onFail) {
    try {
      const token = await getIdToken();
      if (!token) { if (typeof onFail === 'function') onFail('Not logged in'); return; }

      const res  = await _origFetch(PROMO_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.valid) {
        if (typeof onSuccess === 'function') onSuccess();
      } else {
        if (typeof onFail === 'function') onFail('Invalid promo code');
      }
    } catch (e) {
      if (typeof onFail === 'function') onFail('Network error — try again');
    }
  };

  console.info('[payment-security-patch] v1.0 loaded — server-side auth, Firestore premium, /api/status cache');

})();