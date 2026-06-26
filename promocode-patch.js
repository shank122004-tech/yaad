/**
 * promocode-patch.js — CrackAI Promo Code System v1.0
 * ──────────────────────────────────────────────────────
 * Allows admins to unlock 🏫 Coaching Pro or 🎓 Coaching Starter
 * for FREE for 30 days using a one-time promo code.
 *
 * HOW IT WORKS:
 *   1. User clicks "Have a promo code?" on the premium modal.
 *   2. Enters their code → validated client-side against PROMO_CODES table.
 *   3. On match: activatePlan() is called + 30-day expiry written to localStorage.
 *   4. strict-gate-patch.js isPremium() already reads localStorage, so all gates
 *      automatically respect the promo unlock — no extra changes needed.
 *   5. Every page load re-checks expiry. Expired → plan revoked, user must get
 *      a fresh code from you.
 *
 * ADDING NEW CODES (admin only — only you see this file):
 *   Add entries to PROMO_CODES below. Format:
 *     'CODE': { plan: 'coaching_pro' | 'coaching_basic', note: 'for whom' }
 *
 * LOAD ORDER: Drop this AFTER payment.js and strict-gate-patch.js in index.html.
 *
 * ── PLAN IDs (matching payment.js PLANS) ──────────────────────────
 *   coaching_pro   → 🏫 Coaching Pro   (₹999/mo normally)
 *   coaching_basic → 🎓 Coaching Starter (₹499/mo normally)
 */

(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════════
     ADMIN PROMO CODE TABLE
     ════════════════════════════════════════════════════════════════
     Add / remove codes here. These are ONLY in this server-side JS
     file — not exposed in the UI. Each code is one-time per device.

     Coaching Pro   codes  → full Coaching Pro  (unlimited groups, analytics)
     Coaching Starter codes → Coaching Starter  (up to 3 groups)
  ═══════════════════════════════════════════════════════════════════ */
  var PROMO_CODES = {

    /* ── 🏫 Coaching Pro codes ─────────────────────────────────── */
    'CRACK-PRO-2501': { plan: 'coaching_pro',   note: 'Jan 2025 – Batch A' },
    'CRACK-PRO-2502': { plan: 'coaching_pro',   note: 'Feb 2025 – Batch A' },
    'CRACK-PRO-2503': { plan: 'coaching_pro',   note: 'Mar 2025 – Batch A' },
    'CRACK-PRO-2504': { plan: 'coaching_pro',   note: 'Apr 2025 – Batch A' },
    'CRACK-PRO-2505': { plan: 'coaching_pro',   note: 'May 2025 – Batch A' },
    'CRACK-PRO-2506': { plan: 'coaching_pro',   note: 'Jun 2025 – Batch A' },
    'CRACK-PRO-2507': { plan: 'coaching_pro',   note: 'Jul 2025 – Batch A' },
    'CRACK-PRO-2508': { plan: 'coaching_pro',   note: 'Aug 2025 – Batch A' },
    'CRACK-PRO-2509': { plan: 'coaching_pro',   note: 'Sep 2025 – Batch A' },
    'CRACK-PRO-2510': { plan: 'coaching_pro',   note: 'Oct 2025 – Batch A' },
    'CRACK-PRO-2511': { plan: 'coaching_pro',   note: 'Nov 2025 – Batch A' },
    'CRACK-PRO-2512': { plan: 'coaching_pro',   note: 'Dec 2025 – Batch A' },

    /* ── 🎓 Coaching Starter codes ─────────────────────────────── */
    'CRACK-STR-2501': { plan: 'coaching_basic', note: 'Jan 2025 – Batch B' },
    'CRACK-STR-2502': { plan: 'coaching_basic', note: 'Feb 2025 – Batch B' },
    'CRACK-STR-2503': { plan: 'coaching_basic', note: 'Mar 2025 – Batch B' },
    'CRACK-STR-2504': { plan: 'coaching_basic', note: 'Apr 2025 – Batch B' },
    'CRACK-STR-2505': { plan: 'coaching_basic', note: 'May 2025 – Batch B' },
    'CRACK-STR-2506': { plan: 'coaching_basic', note: 'Jun 2025 – Batch B' },
    'CRACK-STR-2507': { plan: 'coaching_basic', note: 'Jul 2025 – Batch B' },
    'CRACK-STR-2508': { plan: 'coaching_basic', note: 'Aug 2025 – Batch B' },
    'CRACK-STR-2509': { plan: 'coaching_basic', note: 'Sep 2025 – Batch B' },
    'CRACK-STR-2510': { plan: 'coaching_basic', note: 'Oct 2025 – Batch B' },
    'CRACK-STR-2511': { plan: 'coaching_basic', note: 'Nov 2025 – Batch B' },
    'CRACK-STR-2512': { plan: 'coaching_basic', note: 'Dec 2025 – Batch B' },

    /* ── Special / VIP codes (give these to trusted people) ─────── */
    'CRACKAI-VIP-PRO':  { plan: 'coaching_pro',   note: 'VIP Pro access' },
    'CRACKAI-VIP-STR':  { plan: 'coaching_basic', note: 'VIP Starter access' },

  };

  /* ════════════════════════════════════════════════════════════════
     CONSTANTS
  ═══════════════════════════════════════════════════════════════════ */
  var PROMO_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  var PLAN_LABELS = {
    coaching_pro:   '🏫 Coaching Pro',
    coaching_basic: '🎓 Coaching Starter',
  };

  /* ════════════════════════════════════════════════════════════════
     STORAGE HELPERS  (per-user, mirrors payment.js key structure)
  ═══════════════════════════════════════════════════════════════════ */
  function userPrefix() {
    try {
      var u = window._firebaseAuth && window._firebaseAuth.currentUser;
      return u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
    } catch (e) { return 'sscai_guest:'; }
  }

  function getPromoMeta() {
    try {
      var raw = localStorage.getItem(userPrefix() + 'promo_meta');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function savePromoMeta(code, plan) {
    var meta = {
      code:       code,
      plan:       plan,
      activatedAt: Date.now(),
      expiresAt:  Date.now() + PROMO_DURATION_MS,
    };
    try {
      localStorage.setItem(userPrefix() + 'promo_meta', JSON.stringify(meta));
    } catch (e) {}
    return meta;
  }

  function clearPromoMeta() {
    try {
      localStorage.removeItem(userPrefix() + 'promo_meta');
    } catch (e) {}
  }

  function isCodeUsed(code) {
    try {
      var usedRaw = localStorage.getItem('sscai_used_promos') || '[]';
      var used = JSON.parse(usedRaw);
      // Key: uid + code so same code can't be reused by the same user
      var uid = (window._firebaseAuth && window._firebaseAuth.currentUser)
                  ? window._firebaseAuth.currentUser.uid : 'guest';
      return used.indexOf(uid + ':' + code) !== -1;
    } catch (e) { return false; }
  }

  function markCodeUsed(code) {
    try {
      var uid = (window._firebaseAuth && window._firebaseAuth.currentUser)
                  ? window._firebaseAuth.currentUser.uid : 'guest';
      var usedRaw = localStorage.getItem('sscai_used_promos') || '[]';
      var used = JSON.parse(usedRaw);
      var key = uid + ':' + code;
      if (used.indexOf(key) === -1) { used.push(key); }
      localStorage.setItem('sscai_used_promos', JSON.stringify(used));
    } catch (e) {}
  }

  /* ════════════════════════════════════════════════════════════════
     EXPIRY CHECK  — runs on every page load + every 5 min
  ═══════════════════════════════════════════════════════════════════ */
  function checkPromoExpiry() {
    try {
      var meta = getPromoMeta();
      if (!meta) return; // no active promo, nothing to do

      if (Date.now() > meta.expiresAt) {
        // Promo expired — revoke premium
        clearPromoMeta();
        var p = userPrefix();
        localStorage.removeItem(p + 'premium');
        localStorage.removeItem(p + 'premium_plan');
        localStorage.removeItem(p + 'group_admin');
        localStorage.removeItem(p + 'group_plan');
        localStorage.removeItem('sscai_premium');
        localStorage.removeItem('sscai_premium_plan');
        localStorage.removeItem('sscai_group_admin');
        localStorage.removeItem('sscai_group_plan');

        if (typeof state !== 'undefined') {
          state.isPremium   = false;
          state.premiumPlan = null;
        }

        if (typeof updateLimitUI   === 'function') updateLimitUI();
        if (typeof updateUserUI    === 'function') updateUserUI();

        _toast('⏰ Your promo access has expired. Get a new code from CrackAI to continue! 🔑', 5000);
        console.info('[PromoCode] Promo expired and revoked.');
      }
    } catch (e) {}
  }

  // Run immediately and every 5 minutes
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(checkPromoExpiry, 1000); });
  } else {
    setTimeout(checkPromoExpiry, 1000);
  }
  setInterval(checkPromoExpiry, 5 * 60 * 1000);

  /* ════════════════════════════════════════════════════════════════
     VALIDATE + ACTIVATE
  ═══════════════════════════════════════════════════════════════════ */
  function redeemCode(rawCode) {
    var code = rawCode.trim().toUpperCase();

    if (!code) {
      _showPromoError('Please enter a promo code.');
      return;
    }

    var entry = PROMO_CODES[code];

    if (!entry) {
      _showPromoError('❌ Invalid code. Check the code and try again.');
      return;
    }

    if (isCodeUsed(code)) {
      _showPromoError('⚠️ This code has already been used on your account.');
      return;
    }

    // Valid & unused — activate!
    var planId    = entry.plan;
    var planLabel = PLAN_LABELS[planId] || planId;

    markCodeUsed(code);
    savePromoMeta(code, planId);

    // activatePlan() from payment.js handles all localStorage keys,
    // Firestore sync, UI refresh, and confetti 🎉
    if (typeof activatePlan === 'function') {
      activatePlan(planId);
    } else {
      // Fallback if payment.js not loaded yet
      var p = userPrefix();
      localStorage.setItem(p + 'premium',      'true');
      localStorage.setItem(p + 'premium_plan', planId);
      localStorage.setItem(p + 'group_admin',  'true');
      localStorage.setItem(p + 'group_plan',   planId);
      // ⚠️ Do NOT write global 'sscai_premium' — no UID, leaks premium to all users on device
    }

    _closePromoModal();

    // Extra toast with expiry info
    var expiryDate = new Date(Date.now() + PROMO_DURATION_MS);
    var expiryStr  = expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    setTimeout(function() {
      _toast('🎉 ' + planLabel + ' activated FREE until ' + expiryStr + '! Get a new code next month to continue. 🙏', 6000);
    }, 800);

    console.info('[PromoCode] Redeemed:', code, '→', planId);
  }

  /* ════════════════════════════════════════════════════════════════
     PROMO MODAL UI
  ═══════════════════════════════════════════════════════════════════ */
  function _toast(msg, dur) {
    try {
      if (typeof showToast === 'function') showToast(msg, dur || 3500);
    } catch(e) {}
  }

  function _showPromoError(msg) {
    var el = document.getElementById('_crackai_promo_error');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
      setTimeout(function() { el.style.display = 'none'; }, 4000);
    } else {
      _toast(msg);
    }
  }

  function _closePromoModal() {
    var m = document.getElementById('_crackai_promo_modal');
    if (m) {
      m.style.opacity = '0';
      m.style.transform = 'scale(0.95)';
      setTimeout(function() { m.remove(); }, 200);
    }
  }

  function openPromoModal() {
    // Remove stale modal if any
    var existing = document.getElementById('_crackai_promo_modal');
    if (existing) existing.remove();

    // Check if user is logged in
    if (!window._firebaseAuth || !window._firebaseAuth.currentUser) {
      _toast('🔐 Please log in first before redeeming a promo code.');
      return;
    }

    // Check if already on an active promo
    var meta = getPromoMeta();
    var currentPromoInfo = '';
    if (meta && Date.now() < meta.expiresAt) {
      var rem = meta.expiresAt - Date.now();
      var days = Math.ceil(rem / (24 * 60 * 60 * 1000));
      var planLabel = PLAN_LABELS[meta.plan] || meta.plan;
      currentPromoInfo =
        '<div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);' +
        'border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#10b981;text-align:left;">' +
        '✅ Active: <strong>' + planLabel + '</strong> — ' + days + ' day' + (days !== 1 ? 's' : '') + ' remaining.<br>' +
        '<span style="color:rgba(200,240,220,0.6);font-size:11px;">Enter a new code to extend your access.</span>' +
        '</div>';
    }

    var modal = document.createElement('div');
    modal.id = '_crackai_promo_modal';
    modal.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(10,10,20,0.72)', 'backdrop-filter:blur(6px)',
      'padding:20px', 'transition:opacity .2s',
    ].join(';');

    modal.innerHTML =
      '<div style="background:linear-gradient(145deg,#13121f,#1a1830);border:1px solid rgba(108,99,255,0.3);' +
      'border-radius:20px;padding:28px 24px;max-width:360px;width:100%;position:relative;' +
      'box-shadow:0 24px 60px rgba(0,0,0,0.7);animation:_pcFadeIn .2s ease;">' +

        /* Close button */
        '<button onclick="document.getElementById(\'_crackai_promo_modal\').remove()" ' +
        'style="position:absolute;top:14px;right:16px;background:none;border:none;color:rgba(200,195,255,0.4);' +
        'font-size:20px;cursor:pointer;line-height:1;padding:0;">✕</button>' +

        /* Header */
        '<div style="text-align:center;margin-bottom:20px;">' +
          '<div style="font-size:36px;margin-bottom:8px;">🎟️</div>' +
          '<div style="font-size:18px;font-weight:800;color:#e8e4ff;letter-spacing:-.01em;">Redeem Promo Code</div>' +
          '<div style="font-size:12px;color:rgba(200,195,255,0.5);margin-top:4px;">' +
            'Get 🏫 Coaching Pro or 🎓 Coaching Starter free for 30 days' +
          '</div>' +
        '</div>' +

        /* Active promo info (if any) */
        currentPromoInfo +

        /* Plan info chips */
        '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
          '<div style="flex:1;background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.2);' +
          'border-radius:10px;padding:8px 6px;text-align:center;">' +
            '<div style="font-size:16px;margin-bottom:2px;">🏫</div>' +
            '<div style="font-size:10px;font-weight:700;color:#a89cff;">Coaching Pro</div>' +
            '<div style="font-size:9px;color:rgba(200,195,255,0.4);margin-top:1px;">Unlimited groups</div>' +
          '</div>' +
          '<div style="flex:1;background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.2);' +
          'border-radius:10px;padding:8px 6px;text-align:center;">' +
            '<div style="font-size:16px;margin-bottom:2px;">🎓</div>' +
            '<div style="font-size:10px;font-weight:700;color:#a89cff;">Coaching Starter</div>' +
            '<div style="font-size:9px;color:rgba(200,195,255,0.4);margin-top:1px;">Up to 3 groups</div>' +
          '</div>' +
        '</div>' +

        /* Input */
        '<input id="_crackai_promo_input" type="text" placeholder="" ' +
        'style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(108,99,255,0.3);' +
        'border-radius:12px;padding:13px 14px;color:#e8e4ff;font-size:14px;font-weight:600;' +
        'letter-spacing:.05em;text-transform:uppercase;outline:none;margin-bottom:8px;" ' +
        'oninput="this.value=this.value.toUpperCase()" ' +
        'onkeydown="if(event.key===\'Enter\')window._crackaiRedeemPromo(this.value)"/>' +

        /* Error */
        '<div id="_crackai_promo_error" style="display:none;color:#ef4444;font-size:12px;' +
        'margin-bottom:8px;min-height:18px;padding:0 2px;"></div>' +

        /* CTA */
        '<button onclick="window._crackaiRedeemPromo(document.getElementById(\'_crackai_promo_input\').value)" ' +
        'style="width:100%;padding:14px;background:linear-gradient(135deg,#6C63FF,#8B5CF6);' +
        'border:none;border-radius:13px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;' +
        'letter-spacing:.02em;transition:opacity .15s;margin-bottom:10px;" ' +
        'onmouseover="this.style.opacity=\'.88\'" onmouseout="this.style.opacity=\'1\'">' +
          '🎟️ Activate Free Access' +
        '</button>' +

        /* Note */
        '<div style="text-align:center;font-size:11px;color:rgba(200,195,255,0.35);">' +
          'Codes are valid for 30 days · Issued by CrackAI admin only' +
        '</div>' +

      '</div>';

    // Animation keyframes (inject once)
    if (!document.getElementById('_pcAnim')) {
      var s = document.createElement('style');
      s.id  = '_pcAnim';
      s.textContent = '@keyframes _pcFadeIn{from{opacity:0;transform:scale(.94) translateY(10px)}to{opacity:1;transform:none}}';
      document.head.appendChild(s);
    }

    // Close on backdrop click
    modal.addEventListener('click', function(e) {
      if (e.target === modal) _closePromoModal();
    });

    document.body.appendChild(modal);

    // Auto-focus input
    setTimeout(function() {
      var inp = document.getElementById('_crackai_promo_input');
      if (inp) inp.focus();
    }, 80);
  }

  /* ════════════════════════════════════════════════════════════════
     GLOBAL API
  ═══════════════════════════════════════════════════════════════════ */
  window._crackaiRedeemPromo = redeemCode;
  window.openPromoModal      = openPromoModal;

  /* ════════════════════════════════════════════════════════════════
     INJECT "Have a promo code?" LINK INTO THE PREMIUM MODAL
     Waits for payment.js to render the modal, then injects a link.
  ═══════════════════════════════════════════════════════════════════ */
  function injectPromoLink() {
    // Attempt to find the premium modal footer / close button row
    var modal = document.getElementById('premiumModal');
    if (!modal) return;

    // Don't double-inject
    if (modal.querySelector('#_crackai_promo_link')) return;

    // Find the best anchor: look for a close button or bottom of the modal body
    var closeBtn = modal.querySelector('[onclick*="closePremiumModal"], [onclick*="close"], .modal-close, .pm-close-btn');
    var insertTarget = closeBtn ? closeBtn.parentElement : modal.querySelector('.premium-modal-body, .pm-body, .pm-inner, .pmg-body');

    var link = document.createElement('div');
    link.id = '_crackai_promo_link';
    link.style.cssText = 'text-align:center;margin-top:12px;padding-bottom:4px;';
    link.innerHTML =
      '<a href="#" onclick="openPromoModal();return false;" ' +
      'style="font-size:12px;color:rgba(200,195,255,0.5);text-decoration:none;' +
      'transition:color .15s;" ' +
      'onmouseover="this.style.color=\'#a89cff\'" onmouseout="this.style.color=\'rgba(200,195,255,0.5)\'">' +
        '🎟️ Have a promo code? Click here' +
      '</a>';

    if (closeBtn) {
      closeBtn.parentElement.insertBefore(link, closeBtn);
    } else if (insertTarget) {
      insertTarget.appendChild(link);
    } else {
      // Fallback: append to modal itself
      modal.appendChild(link);
    }
  }

  // Inject whenever premium modal becomes visible
  var _promoObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        var el = m.target;
        if (el.id === 'premiumModal' && el.classList.contains('active')) {
          setTimeout(injectPromoLink, 120);
        }
      }
      // Also watch for innerHTML changes (renderPremiumModal rebuilds inner HTML)
      if (m.type === 'childList') {
        var pm = document.getElementById('premiumModal');
        if (pm && pm.classList.contains('active')) {
          setTimeout(injectPromoLink, 120);
        }
      }
    });
  });

  function startObserver() {
    var pm = document.getElementById('premiumModal');
    if (pm) {
      _promoObserver.observe(pm, { attributes: true, childList: true, subtree: true });
      // Inject now if modal is already open
      if (pm.classList.contains('active')) injectPromoLink();
    } else {
      // Modal not in DOM yet — watch body for it
      _promoObserver.observe(document.body, { childList: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(startObserver, 500); });
  } else {
    setTimeout(startObserver, 500);
  }

  console.info('[PromoCode] v1.0 loaded — coaching promo system active');

})();