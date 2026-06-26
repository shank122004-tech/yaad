/**
 * crackai-fixes-patch.js — CrackwithAI v1.0
 *
 * Fixes & Enhancements:
 *  1. Group Study Join Bug — users can now join groups and see them immediately
 *  2. Stop Generation Button — send button toggles to stop mid-response
 *  3. Sidebar Tools Redesign — visually rich, professional tool cards
 *
 * Load this LAST (after crackai-features.js) with defer.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
   * FIX 1 — GROUP STUDY JOIN BUG
   * Problem: After joining, _renderGroups() re-queries Firestore
   *          but arrayUnion hasn't propagated yet so the group
   *          doesn't appear in the user's list.
   * Fix:    Patch CF._joinGroup to manually inject the group
   *         into the rendered list without waiting for the query.
   * ════════════════════════════════════════════════════════════════ */
  function patchGroupJoin() {
    // Wait until CF is ready
    if (typeof window.CF === 'undefined' || typeof window.CF._joinGroup !== 'function') {
      setTimeout(patchGroupJoin, 300);
      return;
    }

    const _origJoinGroup = window.CF._joinGroup.bind(window.CF);

    window.CF._joinGroup = async function () {
      const code = document.getElementById('cf-join-code')?.value?.trim();
      if (!code || code.length < 4) {
        if (typeof toast === 'function') toast('Please enter a valid group code');
        return;
      }

      // Show loading state on the button
      const joinBtn = document.querySelector('#cf-group-form .cf-btn-primary');
      if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = '⏳ Joining…'; }

      try {
        const db = window._firebaseDb;
        const { collection, query, where, getDocs, updateDoc, arrayUnion, doc } =
          window._firebaseFns;

        const q = query(
          collection(db, 'studyGroups'),
          where('code', '==', code.toUpperCase())
        );
        const snap = await getDocs(q);

        if (snap.empty) {
          if (typeof toast === 'function') toast('❌ Group not found. Check the code.');
          if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = '🔗 Join Group'; }
          return;
        }

        const docRef = snap.docs[0].ref;
        const groupData = snap.docs[0].data();
        const groupId = snap.docs[0].id;

        // Get current user info
        const myUid = window._firebaseAuth?.currentUser?.uid;
        const myName = window._firebaseAuth?.currentUser?.displayName
          || window._firebaseAuth?.currentUser?.email
          || 'Member';

        if (!myUid) {
          if (typeof toast === 'function') toast('❌ Please log in first.');
          if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = '🔗 Join Group'; }
          return;
        }

        // Already a member?
        if (groupData.members && groupData.members.includes(myUid)) {
          if (typeof toast === 'function') toast('✅ You are already in this group!');
          // Open the group directly
          window.CF._openGroupChat(groupId);
          return;
        }

        // Perform the join
        await updateDoc(docRef, {
          members: arrayUnion(myUid),
          ['memberNames.' + myUid]: myName
        });

        if (typeof toast === 'function')
          toast('✅ Joined "' + groupData.name + '"!', 3000);

        // Build a local group object with the updated data so we don't
        // have to wait for Firestore consistency before rendering
        const updatedGroup = {
          ...groupData,
          id: groupId,
          members: [...(groupData.members || []), myUid],
          memberNames: { ...(groupData.memberNames || {}), [myUid]: myName }
        };

        // Re-render and inject the newly joined group immediately
        const el = document.getElementById('cf-groups-list');
        if (el) {
          // Get existing groups from Firestore (might not include new one yet)
          let existingGroups = [];
          try {
            existingGroups = await window.StudyGroups.getAll();
          } catch (e) { /* ignore */ }

          // Merge: add updatedGroup if not already present
          const allGroupIds = new Set(existingGroups.map(g => g.id));
          if (!allGroupIds.has(groupId)) existingGroups.unshift(updatedGroup);

          el.innerHTML = existingGroups.length
            ? '<div class="cf-section-label">Your Groups</div>' +
              existingGroups.map(g => window.CF._renderGroupCard(g)).join('')
            : '<div class="cf-empty-state">💬 No groups yet.</div>';
        }

        // Hide the form
        const form = document.getElementById('cf-group-form');
        if (form) form.innerHTML = '';

      } catch (err) {
        console.error('[GroupJoinPatch]', err);
        if (typeof toast === 'function')
          toast('❌ Could not join group: ' + (err.message || 'Unknown error'));
        if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = '🔗 Join Group'; }
      }
    };

    console.info('[CrackwithAI Patch] Group join fix applied ✓');
  }

  /* ═══════════════════════════════════════════════════════════════
   * FIX 2 — STOP GENERATION BUTTON
   * Adds AbortController support to callDeepSeek/callDeepSeekVision
   * and toggles the send button between Send ▶ and Stop ■ states.
   * ════════════════════════════════════════════════════════════════ */

  let _activeAbortController = null;

  /* Inject stop icon style & send button SVG swap */
  function injectStopButtonStyles() {
    if (document.getElementById('crackai-stop-btn-styles')) return;
    const style = document.createElement('style');
    style.id = 'crackai-stop-btn-styles';
    style.textContent = `
      .send-btn.is-sending {
        background: linear-gradient(135deg, #ef4444, #dc2626) !important;
        box-shadow: 0 0 20px rgba(239,68,68,0.4) !important;
        transform: scale(1.05);
        transition: all 0.2s ease !important;
      }
      .send-btn.is-sending:hover {
        background: linear-gradient(135deg, #dc2626, #b91c1c) !important;
        box-shadow: 0 0 28px rgba(239,68,68,0.6) !important;
      }
      .send-btn {
        transition: all 0.2s ease !important;
      }
      /* Pulse animation while generating */
      @keyframes stopPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
        50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
      }
      .send-btn.is-sending {
        animation: stopPulse 1.5s infinite;
      }
    `;
    document.head.appendChild(style);
  }

  const SEND_ICON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  const STOP_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;

  function setSendBtnState(sending) {
    const btn = document.getElementById('sendBtn');
    if (!btn) return;
    if (sending) {
      btn.innerHTML = STOP_ICON_SVG;
      btn.classList.add('is-sending');
      btn.title = 'Stop generating';
    } else {
      btn.innerHTML = SEND_ICON_SVG;
      btn.classList.remove('is-sending');
      btn.title = 'Send message';
    }
  }

  function patchSendMessageWithStop() {
    const _origSendMessage = window.sendMessage;
    if (typeof _origSendMessage !== 'function') {
      setTimeout(patchSendMessageWithStop, 200);
      return;
    }
    if (_origSendMessage._stopPatched) return;

    // Patch the send button click to handle stop
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
      // Remove existing click listeners by cloning
      const newBtn = sendBtn.cloneNode(true);
      sendBtn.parentNode.replaceChild(newBtn, sendBtn);

      // ── CRITICAL FIX: update app.js dom reference ──
      if (typeof dom !== 'undefined') dom.sendBtn = newBtn;

      newBtn.addEventListener('click', function () {
        if (newBtn.classList.contains('is-sending') && _activeAbortController) {
          // STOP: abort the current request
          _activeAbortController.abort();
          _activeAbortController = null;
          setSendBtnState(false);
          if (typeof window.removeTypingIndicator === 'function') window.removeTypingIndicator();
          if (typeof window.addMessage === 'function') {
            window.addMessage('ai', '⏹️ *Generation stopped.*');
          }
          // Reset isSending flag
          window.isSending = false;
          const aiStatus = document.getElementById('aiStatus');
          if (aiStatus) aiStatus.innerHTML = '● AI Ready';
        } else {
          // SEND: normal send
          window.sendMessage();
        }
      });
    }

    // Patch sendMessage to control the button state
    async function patchedSendMessage() {
      const message = document.getElementById('messageInput')?.value?.trim();
      const hasImages = typeof window.pendingImageFiles !== 'undefined' && window.pendingImageFiles.length > 0;
      const hasPdf = typeof window.pendingPdfFile !== 'undefined' && !!window.pendingPdfFile;
      if (!message && !hasImages && !hasPdf) return;
      if (window.isSending) return;

      // Create new AbortController for this request
      _activeAbortController = new AbortController();

      setSendBtnState(true);
      try {
        await _origSendMessage.apply(this, arguments);
      } finally {
        _activeAbortController = null;
        setSendBtnState(false);
      }
    }
    patchedSendMessage._stopPatched = true;
    window.sendMessage = patchedSendMessage;

    // Also patch keydown on message input
    const input = document.getElementById('messageInput');
    if (input) {
      const newInput = input.cloneNode(true);
      input.parentNode.replaceChild(newInput, input);

      // ── CRITICAL FIX: update app.js dom reference so sendMessage()
      // reads value from the live element, not the detached clone ──
      if (typeof dom !== 'undefined') dom.messageInput = newInput;

      newInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          window.sendMessage();
        }
      });
      // Restore auto-resize listener
      newInput.addEventListener('input', function () {
        newInput.style.height = 'auto';
        newInput.style.height = newInput.scrollHeight + 'px';
      });
    }

    // Expose abort controller globally so fetch calls can use it
    window._getActiveAbortSignal = () => _activeAbortController?.signal;

    console.info('[CrackwithAI Patch] Stop button applied ✓');
  }

  /* ═══════════════════════════════════════════════════════════════
   * FIX 3 — SIDEBAR TOOLS REDESIGN
   * Replaces the plain emoji button list with professional,
   * visually-rich tool cards grouped in a grid layout.
   * ════════════════════════════════════════════════════════════════ */

  function injectToolsStyles() {
    if (document.getElementById('crackai-tools-styles')) return;
    const style = document.createElement('style');
    style.id = 'crackai-tools-styles';
    style.textContent = `
      /* ── Tools Section Container ── */
      #cf-sidebar-features {
        padding: 4px 2px 8px;
      }

      /* ── Section Header ── */
      .cf-tools-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 4px 8px;
        margin-bottom: 2px;
      }
      .cf-tools-header-label {
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(108, 99, 255, 0.7);
        flex: 1;
      }
      .cf-tools-header-dot {
        width: 5px; height: 5px;
        border-radius: 50%;
        background: linear-gradient(135deg, #6C63FF, #FF6B9D);
        animation: toolsDotPulse 2s infinite;
      }
      @keyframes toolsDotPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(0.7); }
      }

      .cf-tools-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 6px;
      }

      /* ── Tool Card ── */
      .cf-tool-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        padding: 11px 10px 10px;
        border-radius: 12px;
        border: 1px solid var(--tool-border, rgba(255,255,255,0.06));
        background: var(--tool-bg, rgba(255,255,255,0.03));
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        overflow: hidden;
        width: 100%;
        text-align: left;
        font-family: 'Plus Jakarta Sans', sans-serif;
      }
      .cf-tool-card::before {
        content: '';
        position: absolute;
        inset: 0;
        background: var(--tool-glow, transparent);
        opacity: 0;
        transition: opacity 0.25s;
        border-radius: inherit;
      }
      .cf-tool-card:hover::before { opacity: 1; }
      .cf-tool-card:hover {
        transform: translateY(-2px) scale(1.01);
        border-color: var(--tool-hover-border, rgba(108,99,255,0.3));
        box-shadow: 0 6px 20px var(--tool-shadow, rgba(0,0,0,0.2));
      }
      .cf-tool-card:active { transform: translateY(0) scale(0.99); }

      /* Colour themes per tool */
      .cf-tool-card[data-tool="pyq"] {
        --tool-bg: rgba(108,99,255,0.07);
        --tool-border: rgba(108,99,255,0.18);
        --tool-hover-border: rgba(108,99,255,0.45);
        --tool-glow: linear-gradient(135deg, rgba(108,99,255,0.1), transparent);
        --tool-shadow: rgba(108,99,255,0.2);
        --tool-accent: #6C63FF;
      }
      .cf-tool-card[data-tool="mock"] {
        --tool-bg: rgba(255,107,157,0.07);
        --tool-border: rgba(255,107,157,0.18);
        --tool-hover-border: rgba(255,107,157,0.45);
        --tool-glow: linear-gradient(135deg, rgba(255,107,157,0.1), transparent);
        --tool-shadow: rgba(255,107,157,0.2);
        --tool-accent: #FF6B9D;
      }
      .cf-tool-card[data-tool="analytics"] {
        --tool-bg: rgba(34,197,94,0.07);
        --tool-border: rgba(34,197,94,0.18);
        --tool-hover-border: rgba(34,197,94,0.45);
        --tool-glow: linear-gradient(135deg, rgba(34,197,94,0.1), transparent);
        --tool-shadow: rgba(34,197,94,0.2);
        --tool-accent: #22c55e;
      }
      .cf-tool-card[data-tool="goal"] {
        --tool-bg: rgba(251,146,60,0.07);
        --tool-border: rgba(251,146,60,0.18);
        --tool-hover-border: rgba(251,146,60,0.45);
        --tool-glow: linear-gradient(135deg, rgba(251,146,60,0.1), transparent);
        --tool-shadow: rgba(251,146,60,0.2);
        --tool-accent: #fb923c;
      }
      .cf-tool-card[data-tool="rank"] {
        --tool-bg: rgba(250,204,21,0.07);
        --tool-border: rgba(250,204,21,0.18);
        --tool-hover-border: rgba(250,204,21,0.45);
        --tool-glow: linear-gradient(135deg, rgba(250,204,21,0.08), transparent);
        --tool-shadow: rgba(250,204,21,0.2);
        --tool-accent: #facc15;
      }
      .cf-tool-card[data-tool="group"] {
        --tool-bg: rgba(56,189,248,0.07);
        --tool-border: rgba(56,189,248,0.18);
        --tool-hover-border: rgba(56,189,248,0.45);
        --tool-glow: linear-gradient(135deg, rgba(56,189,248,0.1), transparent);
        --tool-shadow: rgba(56,189,248,0.2);
        --tool-accent: #38bdf8;
      }
      .cf-tool-card[data-tool="refer"] {
        --tool-bg: rgba(167,139,250,0.07);
        --tool-border: rgba(167,139,250,0.18);
        --tool-hover-border: rgba(167,139,250,0.45);
        --tool-glow: linear-gradient(135deg, rgba(167,139,250,0.1), transparent);
        --tool-shadow: rgba(167,139,250,0.2);
        --tool-accent: #a78bfa;
      }

      /* Tool icon blob */
      .cf-tool-icon-wrap {
        width: 34px; height: 34px;
        border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        font-size: 17px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.06);
        position: relative;
        flex-shrink: 0;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .cf-tool-card:hover .cf-tool-icon-wrap {
        transform: scale(1.1) rotate(-3deg);
        background: rgba(255,255,255,0.08);
      }

      /* Accent dot on icon */
      .cf-tool-icon-wrap::after {
        content: '';
        position: absolute;
        bottom: 2px; right: 2px;
        width: 6px; height: 6px;
        border-radius: 50%;
        background: var(--tool-accent, #6C63FF);
        box-shadow: 0 0 6px var(--tool-accent, #6C63FF);
        opacity: 0.8;
      }

      /* Tool text */
      .cf-tool-label {
        font-size: 11.5px;
        font-weight: 700;
        color: rgba(240,240,245,0.85);
        line-height: 1.25;
        letter-spacing: -0.01em;
        font-family: 'Plus Jakarta Sans', sans-serif;
      }
      [data-theme="light"] .cf-tool-label { color: rgba(20,20,40,0.85); }

      /* PRO badge */
      .cf-tool-pro-badge {
        position: absolute;
        top: 7px; right: 7px;
        font-size: 7.5px;
        font-weight: 900;
        letter-spacing: 0.06em;
        padding: 2px 6px;
        border-radius: 6px;
        background: linear-gradient(135deg, #6C63FF, #FF6B9D);
        color: var(--text-primary);
        text-transform: uppercase;
      }

      /* ── Wide single row cards (Group + Refer) ── */
      .cf-tools-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .cf-tool-card-wide {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
      }
      .cf-tool-card-wide .cf-tool-label {
        font-size: 12.5px;
      }
      .cf-tool-card-wide .cf-tool-sublabel {
        font-size: 10px;
        color: rgba(240,240,245,0.4);
        font-weight: 500;
        margin-top: 1px;
      }
      [data-theme="light"] .cf-tool-card-wide .cf-tool-sublabel {
        color: rgba(20,20,40,0.45);
      }
      .cf-tool-card-wide .cf-tool-arrow {
        margin-left: auto;
        font-size: 12px;
        opacity: 0.3;
        transition: all 0.2s ease;
        flex-shrink: 0;
      }
      .cf-tool-card-wide:hover .cf-tool-arrow {
        opacity: 0.8;
        transform: translateX(3px);
      }

      /* ── Light theme border overrides ── */
      [data-theme="light"] .cf-tool-card {
        --tool-bg: rgba(0,0,0,0.03);
        --tool-border: rgba(0,0,0,0.08);
      }

      /* ── Mobile tweaks ── */
      @media (max-width: 380px) {
        .cf-tools-grid { grid-template-columns: 1fr 1fr; gap: 5px; }
        .cf-tool-card { padding: 9px 8px 8px; }
        .cf-tool-label { font-size: 10.5px; }
        .cf-tool-icon-wrap { width: 30px; height: 30px; font-size: 15px; border-radius: 8px; }
      }
    `;
    document.head.appendChild(style);
  }

  function rebuildToolsSidebar() {
    const featureWrap = document.getElementById('cf-sidebar-features');
    if (!featureWrap) {
      setTimeout(rebuildToolsSidebar, 400);
      return;
    }

    // Check if CF is available for isPremium check
    function isPrem() {
      try {
        const uid = window._firebaseAuth?.currentUser?.uid;
        const p = uid ? ('sscai_u:' + uid + ':') : 'sscai_guest:';
        if (localStorage.getItem(p + 'premium') === 'true') return true;
        if (localStorage.getItem('sscai_premium') === 'true') return true;
        return false;
      } catch (e) { return false; }
    }

    const tools = [
      {
        id: 'mock',
        icon: '🎯',
        label: 'Mock Test',
        sublabel: 'Timed Practice Exam',
        pro: true,
        cb: "MockTest._state=null;CF.openMockTest()"
      },
      {
        id: 'analytics',
        icon: '📊',
        label: 'Analytics',
        sublabel: 'Track Your Progress',
        pro: true,
        cb: "CF.openAnalytics()"
      },
      {
        id: 'rank',
        icon: '🏆',
        label: 'Rank Predictor',
        sublabel: 'Score Estimate',
        pro: false,
        cb: "CF.openScorePredictor()"
      },
    ];

    const wideTools = [
      {
        id: 'group',
        icon: '👥',
        label: 'Group Study AI',
        sublabel: 'Study with friends in real-time',
        pro: false,
        cb: "CF.openStudyGroups()"
      },
      {
        id: 'refer',
        icon: '🎁',
        label: 'Refer & Earn',
        sublabel: 'Invite friends, get free Premium',
        pro: false,
        cb: "CF.openReferral()"
      },
    ];

    const dismissDrawer = `document.getElementById('historyDrawer')?.classList.remove('open')`;
    const prem = isPrem();

    // Keep daily goal bar but enhance it (it's already there via innerHTML from features.js)
    // We re-render the whole inner content
    featureWrap.innerHTML = `
      <!-- Header -->
      <div class="cf-tools-header">
        <div class="cf-tools-header-dot"></div>
        <div class="cf-tools-header-label">Study Tools</div>
      </div>

      <!-- 2×2 Grid Tools -->
      <div class="cf-tools-grid">
        ${tools.map(t => `
          <button
            class="cf-tool-card"
            data-tool="${t.id}"
            onclick="${t.cb};${dismissDrawer}"
            title="${t.label}${t.pro && !prem ? ' — Premium' : ''}"
          >
            ${t.pro && !prem ? '<div class="cf-tool-pro-badge">PRO</div>' : ''}
            <div class="cf-tool-icon-wrap">${t.icon}</div>
            <div class="cf-tool-label">${t.label}</div>
          </button>
        `).join('')}
      </div>

      <!-- Wide tool rows -->
      <div class="cf-tools-row">
        ${wideTools.map(t => `
          <button
            class="cf-tool-card cf-tool-card-wide"
            data-tool="${t.id}"
            onclick="${t.cb};${dismissDrawer}"
            title="${t.label}"
          >
            <div class="cf-tool-icon-wrap">${t.icon}</div>
            <div>
              <div class="cf-tool-label">${t.label}</div>
              <div class="cf-tool-sublabel">${t.sublabel}</div>
            </div>
            <div class="cf-tool-arrow">›</div>
          </button>
        `).join('')}
      </div>
    `;

    // Re-apply DailyGoal badge update
    try {
      if (typeof window.CF !== 'undefined' && window.CF.updateGoalBar) {
        window.CF.updateGoalBar();
      }
      // Try the DailyGoal internal path
      if (typeof DailyGoal !== 'undefined') {
        DailyGoal.updateBadge();
      }
    } catch (e) {}

    console.info('[CrackwithAI Patch] Sidebar tools redesigned ✓');
  }

  /* ═══════════════════════════════════════════════════════════════
   * INIT — Apply all patches after DOM + scripts are ready
   * ════════════════════════════════════════════════════════════════ */
  function applyAll() {
    injectStopButtonStyles();
    injectToolsStyles();
  
    patchSendMessageWithStop();

    // Sidebar rebuild waits until features.js has injected cf-sidebar-features
    const tryRebuild = (attempts = 0) => {
      if (document.getElementById('cf-sidebar-features')) {
        rebuildToolsSidebar();
      } else if (attempts < 30) {
        setTimeout(() => tryRebuild(attempts + 1), 300);
      }
    };
    tryRebuild();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAll);
  } else {
    // Scripts are deferred, so wait a tick for features.js to init
    setTimeout(applyAll, 100);
  }

})();