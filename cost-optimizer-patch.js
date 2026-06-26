/**
 * cost-optimizer-patch.js — CrackAI Firebase Cost Reducer
 * ══════════════════════════════════════════════════════════
 *
 * WHAT THIS FIXES (and expected savings):
 * ─────────────────────────────────────────
 * 1. FREE_TEXT_LIMIT   100 → 12    (saves ~88% of Cloud Run invocations)
 * 2. FREE_IMAGE_LIMIT   5  → 3
 * 3. FREE_PDF_LIMIT     2  → 1
 * 4. Companion (BF/GF) chat: 12 messages free, then ₹15 for 15 more
 * 5. Payment polling: 5s every-5s → exponential backoff (10s,15s,20s…)
 *    + max 8 attempts instead of 24  → cuts verify calls by ~67%
 * 6. Firestore: debounce the updateDoc after premium activation (1 write,
 *    not 2-3 in quick succession)
 * 7. Firestore sync: only getDoc once per login session, cached in memory
 *
 * HOW TO INSTALL
 * ──────────────
 * Add ONE line just before </body> in index.html:
 *   <script src="cost-optimizer-patch.js" defer></script>
 *
 * Make sure it loads AFTER app.js (defer order = DOM order).
 */

(function () {
  'use strict';

  /* ── wait for app.js globals ── */
  function waitForApp(cb) {
    if (typeof canSendText === 'function') { cb(); return; }
    const t = setInterval(() => {
      if (typeof canSendText === 'function') { clearInterval(t); cb(); }
    }, 100);
  }

  waitForApp(applyPatches);

  /* ════════════════════════════════════════════════════════════════
     PATCH 1 — Usage limits (100 → 12 free messages per day)
  ════════════════════════════════════════════════════════════════ */
  function patchLimits() {
    // Override the module-level constants via closure replacement.
    // Because FREE_TEXT_LIMIT is `const` in app.js we can't reassign it,
    // but we CAN replace the canSend* functions on window (app.js reads
    // the local binding internally). We therefore shadow them globally so
    // the UI update functions (which read window.canSendText etc.) use our
    // tighter limits, AND we patch incrementCount to enforce hard caps.

    const HARD_TEXT  = 7;
    const HARD_IMAGE = 3;
    const HARD_PDF   = 1;

    // Replace canSend* helpers globally
    window.canSendText = function () {
      return (typeof state !== 'undefined' && (state.isPremium || isRewardActive?.() || state.textCount < HARD_TEXT));
    };
    window.canSendImage = function () {
      return (typeof state !== 'undefined' && (state.isPremium || isRewardActive?.() || state.imageCount < HARD_IMAGE));
    };
    window.canSendPdf = function () {
      return (typeof state !== 'undefined' && (state.isPremium || isRewardActive?.() || state.pdfCount < HARD_PDF));
    };

    // Patch the UI remaining-counter so it shows the new limit
    const _origUpdateLimitUI = window.updateLimitUI;
    window.updateLimitUI = function () {
      if (_origUpdateLimitUI) _origUpdateLimitUI();
      // Override the footer text
      try {
        const el = document.getElementById('messageLimitInfo');
        if (!el || state?.isPremium) return;
        const rem = Math.max(0, HARD_TEXT - (state?.textCount || 0));
        el.textContent = rem > 0
          ? `🤖 CrackAI — ${rem} free messages left today`
          : `🔒 Daily limit reached — Upgrade for unlimited access`;
      } catch (_) {}
    };

    console.info('[CostPatch] Limits patched → text:7 image:3 pdf:1');
  }

  /* ════════════════════════════════════════════════════════════════
     PATCH 2 — Companion chat monetisation
     Free users: 12 messages total across ALL personas.
     After that: show ₹15/15-chat upsell modal.
  ════════════════════════════════════════════════════════════════ */
  function patchCompanionLimit() {
    const COMPANION_FREE = 12;
    const COMPANION_PACK_PRICE = 15;
    const COMPANION_PACK_COUNT = 15;
    const LS_KEY = 'crackai_companion_count';
    const LS_PACK_KEY = 'crackai_companion_pack';

    function getCompanionUsed() {
      return parseInt(localStorage.getItem(LS_KEY) || '0');
    }
    function getPackRemaining() {
      try {
        const p = JSON.parse(localStorage.getItem(LS_PACK_KEY) || 'null');
        return p?.remaining || 0;
      } catch { return 0; }
    }
    function consumeCompanionMessage() {
      const used = getCompanionUsed();
      if (used < COMPANION_FREE) {
        localStorage.setItem(LS_KEY, used + 1);
        return true; // OK
      }
      const pr = getPackRemaining();
      if (pr > 0) {
        const p = JSON.parse(localStorage.getItem(LS_PACK_KEY));
        p.remaining = pr - 1;
        localStorage.setItem(LS_PACK_KEY, JSON.stringify(p));
        return true; // OK
      }
      return false; // blocked
    }
    function companionAllowed() {
      const used = getCompanionUsed();
      if (used < COMPANION_FREE) return true;
      return getPackRemaining() > 0;
    }

    // Intercept sendMessage to gate companion personas
    const _origSend = window.sendMessage;
    window.sendMessage = async function (...args) {
      const persona = typeof state !== 'undefined' ? state.aiPersona : null;
      const isCompanion = ['boyfriend', 'girlfriend'].includes(persona);

      if (isCompanion && !state?.isPremium) {
        if (!companionAllowed()) {
          showCompanionUpsell(COMPANION_PACK_PRICE, COMPANION_PACK_COUNT);
          return;
        }
        // Allowed — track usage
        const result = await _origSend(...args);
        consumeCompanionMessage();
        return result;
      }
      return _origSend(...args);
    };

    window._getCompanionStats = () => ({
      used: getCompanionUsed(),
      freeLeft: Math.max(0, COMPANION_FREE - getCompanionUsed()),
      packRemaining: getPackRemaining()
    });

    console.info('[CostPatch] Companion gating active — free:12 then ₹15/15');
  }

  function showCompanionUpsell(price, count) {
    if (document.getElementById('cpUpsellModal')) return;
    const m = document.createElement('div');
    m.id = 'cpUpsellModal';
    m.style.cssText = `position:fixed;inset:0;z-index:99997;display:flex;align-items:center;
      justify-content:center;background:rgba(4,4,16,0.93);backdrop-filter:blur(6px);padding:20px;`;
    m.innerHTML = `
      <div style="background:linear-gradient(135deg,#12082a,#1a0d35);border:1px solid rgba(255,107,157,0.35);
           border-radius:22px;padding:32px 24px;max-width:340px;width:100%;text-align:center;
           box-shadow:0 0 60px rgba(255,107,157,0.15);">
        <div style="font-size:40px;margin-bottom:12px;">💬</div>
        <div style="font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700;
             color:var(--text-primary);margin-bottom:8px;">Free chats used up!</div>
        <div style="font-size:13px;color:rgba(220,200,255,0.7);line-height:1.6;margin-bottom:20px;">
          You've used all <strong>${12}</strong> free companion messages today.<br>
          Get <strong>${count} more chats for just ₹${price}</strong> — instant access!
        </div>
        <div style="background:rgba(255,107,157,0.1);border:1px solid rgba(255,107,157,0.2);
             border-radius:14px;padding:14px;margin-bottom:20px;">
          <div style="font-size:28px;font-weight:800;color:#FF6B9D;font-family:'Space Grotesk',sans-serif;">
            ₹${price}
          </div>
          <div style="font-size:12px;color:rgba(220,200,255,0.6);margin-top:2px;">
            for ${count} more messages • no expiry
          </div>
        </div>
        <button id="cpUpsellPayBtn" style="width:100%;padding:14px;background:linear-gradient(135deg,#FF6B9D,#e0507a);
          color:var(--text-primary);border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;
          box-shadow:0 4px 20px rgba(255,107,157,0.4);margin-bottom:10px;">
          💖 Get ${count} Chats — ₹${price}
        </button>
        <button id="cpUpsellCloseBtn" style="width:100%;padding:10px;background:transparent;
          color:rgba(200,180,220,0.45);border:1px solid rgba(255,107,157,0.15);border-radius:10px;
          font-size:13px;cursor:pointer;">
          Maybe later
        </button>
      </div>`;
    document.body.appendChild(m);

    document.getElementById('cpUpsellCloseBtn').onclick = () => m.remove();

    document.getElementById('cpUpsellPayBtn').onclick = async () => {
      const btn = document.getElementById('cpUpsellPayBtn');
      if (!window._firebaseAuth?.currentUser) {
        if (typeof showToast === 'function') showToast('Please login first!');
        m.remove(); return;
      }
      btn.disabled = true;
      btn.textContent = 'Creating order…';
      try {
        const uid = window._firebaseAuth.currentUser.uid;
        const orderId = 'companion_pack_' + uid + '_' + Date.now();
        const token = await window._firebaseAuth.currentUser.getIdToken();
        const res = await fetch('/api/create-cashfree-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({
            order_id: orderId, order_amount: price,
            order_currency: 'INR',
            customer_id: uid,
            customer_email: window._firebaseAuth.currentUser.email || 'user@crackai.in',
            customer_phone: '9999999999',
            order_note: 'companion_pack_' + count
          })
        });
        const data = await res.json();
        if (data?.payment_session_id && window.Cashfree) {
          const cf = await window.Cashfree({ mode: 'production' });
          await cf.checkout({ paymentSessionId: data.payment_session_id, redirectTarget: '_modal' });
          m.remove();
          pollCompanionPack(orderId, count, price);
        } else {
          throw new Error(data?.error || 'Order creation failed');
        }
      } catch (e) {
        if (typeof showToast === 'function') showToast('❌ ' + e.message);
        btn.disabled = false;
        btn.textContent = `💖 Get ${count} Chats — ₹${price}`;
      }
    };
  }

  /* ════════════════════════════════════════════════════════════════
     PATCH 3 — Payment polling: exponential backoff + hard cap
     Old: every 5s × 24 = up to 120 seconds, 24 Function calls
     New: 10,15,20,25,30,35,40s × 8 = ~3 min max, 8 calls max
  ════════════════════════════════════════════════════════════════ */
  function patchPaymentPolling() {
    /**
     * Smart poll: attempt-based exponential delay.
     * attempt 0→10s, 1→15s, 2→20s … capped at 40s. Max 8 tries.
     */
    function smartPoll(verifyFn, onPaid, onFailed, attempt = 0) {
      const MAX = 8;
      if (attempt >= MAX) {
        if (typeof showToast === 'function')
          showToast('⏰ Payment not detected. If you paid, contact support@crackai.in');
        return;
      }
      const delay = Math.min(10000 + attempt * 5000, 40000); // 10s…40s
      setTimeout(async () => {
        try {
          const result = await verifyFn();
          if (result?.status === 'PAID')        { onPaid(); return; }
          if (result?.status === 'FAILED')      { onFailed(); return; }
        } catch (_) {}
        smartPoll(verifyFn, onPaid, onFailed, attempt + 1);
      }, delay);
    }

    // Patch the three polling functions by replacing them on window
    window.pollPaymentStatus = function (orderId, planId, attempt = 0) {
      smartPoll(
        () => verifyCashfreePayment(orderId),
        () => {
          activatePremium(planId);
          localStorage.removeItem('sscai_pending_order');
        },
        () => {
          if (typeof showToast === 'function') showToast('❌ Payment failed. Please try again.');
          localStorage.removeItem('sscai_pending_order');
        }
      );
    };

    window.pollAddonPayment = function (orderId, planId, attempt = 0) {
      smartPoll(
        () => verifyCashfreePayment(orderId),
        () => {
          setAddonActive(planId);
          document.getElementById('addonModal')?.remove();
          localStorage.removeItem('crackai_pending_addon');
          if (typeof showToast === 'function')
            showToast('🎉 Add-on unlocked!');
        },
        () => {
          if (typeof showToast === 'function') showToast('❌ Payment failed. Try again.');
        }
      );
    };

    window.pollV4ProPayment = function (orderId, attempt = 0) {
      smartPoll(
        () => verifyCashfreePayment(orderId),
        () => {
          if (typeof setAddonActive === 'function') setAddonActive('v4pro_addon');
          document.getElementById('v4ProModal')?.remove();
          localStorage.removeItem('crackai_pending_addon');
          if (window._selectedDeepSeekModel !== undefined) window._selectedDeepSeekModel = 'deepseek-v4-pro';
          if (typeof showToast === 'function') showToast('🚀 V4 Pro unlocked!');
          if (typeof _doConfetti === 'function') _doConfetti();
        },
        () => {
          if (typeof showToast === 'function') showToast('❌ Payment failed. Try again.');
        }
      );
    };

    console.info('[CostPatch] Payment polling patched → max 8 attempts, 10-40s backoff');
  }

  /* companion pack poll */
  function pollCompanionPack(orderId, count, price, attempt = 0) {
    const MAX = 8;
    if (attempt >= MAX) {
      if (typeof showToast === 'function') showToast('⏰ Pack not confirmed. Contact support if paid.');
      return;
    }
    const delay = Math.min(10000 + attempt * 5000, 40000);
    setTimeout(async () => {
      try {
        const result = await verifyCashfreePayment(orderId);
        if (result?.status === 'PAID') {
          localStorage.setItem('crackai_companion_pack', JSON.stringify({ remaining: count, boughtAt: Date.now() }));
          if (typeof showToast === 'function') showToast(`💖 ${count} companion chats unlocked! Enjoy! ❤️`);
          return;
        }
        if (result?.status === 'FAILED') {
          if (typeof showToast === 'function') showToast('❌ Payment failed. Try again.');
          return;
        }
      } catch (_) {}
      pollCompanionPack(orderId, count, price, attempt + 1);
    }, delay);
  }

  /* ════════════════════════════════════════════════════════════════
     PATCH 4 — Firestore: cache the login getDoc so it only fires
     ONCE per app session, not on every auth state re-fire
  ════════════════════════════════════════════════════════════════ */
  function patchFirestoreSync() {
    let _syncDone = false;
    let _lastUid  = null;

    const _origSync = window._syncFirestoreBackground;
    if (typeof _origSync !== 'function') {
      // It's a module-internal function; we can't override it directly.
      // Instead, we monkey-patch onAuthStateChanged to skip re-syncs.
      // This is handled by the uid cache below.
    }

    // Intercept repeated auth state fires for the same user
    const _origOnAuth = window._firebaseFns?.onAuthStateChanged;
    if (_origOnAuth) {
      // We can't patch onAuthStateChanged easily, but we can debounce
      // the getDoc call by tagging the user object.
    }

    // Simpler approach: prevent duplicate getDoc by tagging on state
    // We patch _syncFirestoreBackground if it's accessible on window
    if (typeof window._syncFirestoreBackground === 'function') {
      window._syncFirestoreBackground = async function (fbUser) {
        if (_syncDone && fbUser.uid === _lastUid) {
          console.info('[CostPatch] Skipping duplicate Firestore getDoc for', fbUser.uid);
          return;
        }
        _syncDone = true;
        _lastUid  = fbUser.uid;
        return _origSync(fbUser);
      };
      console.info('[CostPatch] Firestore sync deduplicated');
    }
  }

  /* ════════════════════════════════════════════════════════════════
     PATCH 5 — Debounce Firestore updateDoc writes
     App sometimes calls updateDoc twice in quick succession after
     payment (once in activatePremium, once in setAddonActive).
     We debounce writes to the same user doc within 2 seconds.
  ════════════════════════════════════════════════════════════════ */
  function patchFirestoreWrites() {
    if (!window._firebaseFns) return;
    const _origUpdateDoc = window._firebaseFns.updateDoc;
    if (!_origUpdateDoc) return;

    const _pendingWrites = new Map(); // docPath → { timer, mergedData }

    window._firebaseFns.updateDoc = function (docRef, data, ...rest) {
      // Build a key from the doc path
      const key = docRef?.path || JSON.stringify(docRef);
      if (_pendingWrites.has(key)) {
        const pending = _pendingWrites.get(key);
        clearTimeout(pending.timer);
        Object.assign(pending.data, data); // merge fields
        pending.timer = setTimeout(() => {
          _pendingWrites.delete(key);
          _origUpdateDoc(docRef, pending.data, ...rest).catch(() => {});
        }, 2000);
      } else {
        const entry = { data: { ...data }, timer: null };
        entry.timer = setTimeout(() => {
          _pendingWrites.delete(key);
          _origUpdateDoc(docRef, entry.data, ...rest).catch(() => {});
        }, 2000);
        _pendingWrites.set(key, entry);
      }
      return Promise.resolve(); // fire-and-forget
    };

    console.info('[CostPatch] Firestore updateDoc debounced (2s batching)');
  }

  /* ════════════════════════════════════════════════════════════════
     PATCH 6 — Show a clear "daily limit" banner in the chat
     so users understand and are nudged to upgrade
  ════════════════════════════════════════════════════════════════ */
  function patchLimitBanner() {
    const _origHandleLimitHit = window.handleLimitHit;
    window.handleLimitHit = function (type) {
      if (_origHandleLimitHit) _origHandleLimitHit(type);
      showLimitBanner(type);
    };
  }

  function showLimitBanner(type) {
    if (document.getElementById('cpLimitBanner')) return;
    const labels = { text: '💬 Daily chat', image: '🖼️ Image analysis', pdf: '📄 PDF analysis' };
    const label = labels[type] || '🔒 Daily';
    const b = document.createElement('div');
    b.id = 'cpLimitBanner';
    b.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
      z-index:9990;background:linear-gradient(135deg,#1a0d35,#12082a);
      border:1px solid rgba(255,107,157,0.4);border-radius:16px;
      padding:14px 20px;max-width:340px;width:calc(100% - 40px);
      text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.5);
      animation:cpSlideUp 0.3s ease;`;
    b.innerHTML = `
      <style>@keyframes cpSlideUp{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}</style>
      <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">
        ${label} limit reached for today
      </div>
      <div style="font-size:12px;color:rgba(220,200,255,0.6);margin-bottom:12px;">
        Resets at midnight • Upgrade for unlimited access
      </div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button onclick="document.getElementById('cpLimitBanner').remove()"
          style="padding:8px 16px;background:rgba(255,255,255,0.08);color:var(--text-secondary);
          border:1px solid rgba(255,255,255,0.12);border-radius:10px;font-size:12px;cursor:pointer;">
          Dismiss
        </button>
        <button onclick="document.getElementById('cpLimitBanner').remove();typeof openUpgradeModal==='function'&&openUpgradeModal();"
          style="padding:8px 16px;background:linear-gradient(135deg,#6C63FF,#a78bfa);color:var(--text-primary);
          border:none;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;">
          ✨ Upgrade Now
        </button>
      </div>`;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 8000);
  }

  /* ════════════════════════════════════════════════════════════════
     RUN ALL PATCHES
  ════════════════════════════════════════════════════════════════ */
  function applyPatches() {
    // patchLimits() and patchCompanionLimit() are intentionally disabled.
    // All usage limits and gates are managed by strict-gate-patch.js.
    // try { patchLimits();         } — handled by strict-gate-patch.js
    // try { patchCompanionLimit(); } — handled by strict-gate-patch.js
    try { patchPaymentPolling();  } catch (e) { console.warn('[CostPatch] polling:', e); }
    try { patchFirestoreSync();   } catch (e) { console.warn('[CostPatch] fs-sync:', e); }
    try { patchFirestoreWrites(); } catch (e) { console.warn('[CostPatch] fs-write:', e); }
    try { patchLimitBanner();     } catch (e) { console.warn('[CostPatch] banner:', e); }
    console.info('[CostPatch] ✅ Firestore/polling patches applied');
  }

})();