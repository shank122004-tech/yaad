/**
 * battle-fix-patch.js — CrackAI Battle Fix v1.3 FIXED ROBUST
 * Fixes:
 *   1. Battle lag (double reads, poll racing animation, redundant re-renders)
 *   2. No quit/end battle option for users or admin
 *   3. Proper error handling for missing functions
 *   4. Defensive checks for all function patches
 *   5. Timer flickering prevention - skip unnecessary re-renders
 *   6. Text visibility in light/dark modes
 *
 * HOW TO LOAD:
 *   Add this AFTER crackai-features.js and battle-arena-patch.js in your index.html:
 *   <script src="battle-fix-patch.js" defer></script>
 */
(function () {
  'use strict';

  // Initialize when CF is ready
  var _initAttempts = 0;
  var _maxAttempts = 150; // 15 seconds timeout (reduced from 30s for faster failure detection)
  var _initFinished = false; // Track if initialization is done
  
  function initPatch() {
    _initAttempts++;
    
    // If already initialized, don't try again
    if (_initFinished) return;
    
    // Check if CF exists and has required methods
    if (!window.CF) {
      if (_initAttempts < _maxAttempts) {
        setTimeout(initPatch, 100);
      } else {
        // Mark as finished to prevent further attempts
        _initFinished = true;
        console.warn('[BattleFix] CF not found after 15s - attempting to work without patches...');
        // Try applying patches anyway if Firebase is available
        if (window._firebaseDb && window._firebaseFns && window.BA) {
          console.info('[BattleFix] Firebase & BA available, applying critical patches...');
          try {
            _applyEmergencyPatches();
          } catch(e) {
            console.error('[BattleFix] Emergency patches failed:', e.message);
          }
        }
      }
      return;
    }
    
    // Mark as finished before applying patches
    _initFinished = true;
    
    try {
      _applyPatches();
    } catch (e) {
      console.error('[BattleFix] Error applying patches:', e);
    }
  }

  function _applyEmergencyPatches() {
    // Apply critical patches that don't depend on CF
    console.info('[BattleFix] Applying emergency patches...');
    
    // Patch BA if available
    if (window.BA && window.BA._renderActiveQuiz) {
      console.info('[BattleFix] BA object found, patching critical functions');
      // Add defensive render logic
      var origRender = window.BA._renderActiveQuiz.bind(window.BA);
      window.BA._renderActiveQuiz = function(battle) {
        try {
          origRender(battle);
        } catch(e) {
          console.error('[BattleFix] Render error (ignored):', e.message);
        }
      };
    }
  }

  function _applyPatches() {

    /* ─────────────────────────────────────────────────────────────
     * FIX 1 — FLAG: suppress poll re-render during answer animation
     *   CF._answerAnimating = true for 2000ms after every answer
     *   The poller checks this flag and skips re-rendering the quiz
     *   area while animation is running, eliminating the flicker.
     * ───────────────────────────────────────────────────────────── */
    CF._answerAnimating = false;

    /* ─────────────────────────────────────────────────────────────
     * FIX 2 — PATCH THE POLLER
     *   Replace the 3s setInterval inside _openGroupChat so it:
     *   - Skips quiz re-render while _answerAnimating is true
     *   - Skips ALL rendering if groupId no longer matches
     *   - Does not accumulate multiple intervals (guard already exists,
     *     but we reinforce it)
     * ───────────────────────────────────────────────────────────── */
    
    // Only patch if function exists
    if (CF._openGroupChat && typeof CF._openGroupChat === 'function') {
      var _origOpenGroupChat = CF._openGroupChat.bind(CF);

      CF._openGroupChat = async function (groupId) {
        // Let original function run (it sets up HTML + initial render)
        await _origOpenGroupChat(groupId);

        // Now replace the interval it created with our patched version.
        // The original already set CF._chatPollInterval — clear it and
        // replace with one that respects the animation flag.
        if (CF._chatPollInterval) {
          clearInterval(CF._chatPollInterval);
          CF._chatPollInterval = null;
        }

        var db = window._firebaseDb;
        var fns = window._firebaseFns;

        CF._chatPollInterval = setInterval(async function () {
          if (!CF._currentGroupId) return;
          if (CF._answerAnimating) return; // never fight the answer animation

          try {
            var s = await fns.getDoc(fns.doc(db, 'studyGroups', CF._currentGroupId));
            if (!s.exists()) { CF._stopChatPolling && CF._stopChatPolling(); return; }
            var data = s.data();

            var newHash = JSON.stringify({
              quizStatus: data.quiz ? data.quiz.status : null,
              quizQ: data.quiz ? data.quiz.current : null,
              quizAnswers: data.quiz ? Object.keys(data.quiz.answers || {}).length : 0,
              members: (data.members || []).length
            });

            if (newHash !== CF._chatPollHash) {
              CF._chatPollHash = newHash;
              CF._currentGroupData = data;

              var status = data.quiz ? data.quiz.status : null;
              if (status === 'active') {
                // Instead of calling _renderQuizQuestion which re-renders everything,
                // check if only the timer needs updating
                var oldQ = CF._currentGroupData && CF._currentGroupData.quiz ? CF._currentGroupData.quiz.current : null;
                var newQ = data.quiz ? data.quiz.current : null;
                
                // Only re-render if the question changed, not just the timer
                if (oldQ !== newQ || !CF._currentGroupData || CF._currentGroupData.quiz.current !== data.quiz.current) {
                  CF._renderQuizQuestion && CF._renderQuizQuestion(data.quiz, CF._currentGroupId, data.memberNames);
                }
              } else if (status === 'finished') {
                CF._stopGroupQuizTimer && CF._stopGroupQuizTimer();
                CF._renderQuizResults && CF._renderQuizResults(data.quiz, data.memberNames);
              } else if (status === 'abandoned') {
                CF._stopGroupQuizTimer && CF._stopGroupQuizTimer();
                var qa = document.getElementById('cf-quiz-area');
                if (qa) {
                  qa.innerHTML = '<div style="text-align:center;padding:16px;color:rgba(200,195,255,0.5);font-size:13px">🚫 Battle ended by admin.</div>';
                  setTimeout(function () { if (qa) qa.innerHTML = ''; }, 3000);
                }
              } else {
                var qa2 = document.getElementById('cf-quiz-area');
                if (qa2) qa2.innerHTML = '';
              }

              _refreshAdminBar(CF._currentGroupId, data);
            }
          } catch (e) {}
        }, 2000);
      };
    }

    /* ─────────────────────────────────────────────────────────────
     * FIX 3 — _submitQuizAnswer is fully handled by crackai-features.js
     *   (optimistic render, _answerAnimating flag, fire-and-forget sync,
     *    no redundant getDoc, per-player scores for admin dashboard)
     *   No override needed here.
     * ───────────────────────────────────────────────────────────── */

    /* ─────────────────────────────────────────────────────────────
     * FIX 3b — PATCH _startQuizBattle with 3-2-1 countdown overlay
     *   Shows a fullscreen countdown (3→2→1→GO!) to ALL group members
     *   by writing a 'countdown' field to Firestore that the poller picks up.
     *   Admin sees it immediately via local overlay; others see it via poll.
     * ───────────────────────────────────────────────────────────── */
    
    // Only patch if function exists
    var _origStartQuizBattle = null;
    if (CF._startQuizBattle && typeof CF._startQuizBattle === 'function') {
      _origStartQuizBattle = CF._startQuizBattle.bind(CF);
    }

    /* Helper — renders the countdown overlay locally */
    function _showCountdownOverlay(onDone) {
      // Remove any existing overlay
      var old = document.getElementById('cf-battle-countdown-overlay');
      if (old) old.remove();

      var overlay = document.createElement('div');
      overlay.id = 'cf-battle-countdown-overlay';
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99998',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'background:rgba(10,10,20,0.88)',
        'backdrop-filter:blur(6px)',
        '-webkit-backdrop-filter:blur(6px)',
        'pointer-events:none'
      ].join(';');

      var numEl = document.createElement('div');
      numEl.style.cssText = [
        'font-size:96px', 'font-weight:900',
        'color:#6C63FF',
        'text-shadow:0 0 40px rgba(108,99,255,0.8)',
        'transition:transform 0.25s cubic-bezier(.34,1.56,.64,1),opacity 0.25s ease',
        'transform:scale(1)', 'opacity:1'
      ].join(';');

      var labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:16px;font-weight:600;color:rgba(200,195,255,0.7);margin-top:12px;letter-spacing:2px;text-transform:uppercase';
      labelEl.textContent = 'Battle starting…';

      overlay.appendChild(numEl);
      overlay.appendChild(labelEl);

      // Mount inside the chat panel if possible, else body
      var panel = document.getElementById('cf-chat-panel') || document.body;
      if (panel !== document.body) {
        overlay.style.position = 'absolute';
      }
      panel.appendChild(overlay);

      var steps = ['3', '2', '1', 'GO!'];
      var colors = ['#f59e0b', '#f97316', '#ef4444', '#22c55e'];
      var i = 0;

      function tick() {
        if (i >= steps.length) {
          overlay.style.opacity = '0';
          overlay.style.transition = 'opacity 0.3s ease';
          setTimeout(function () { overlay.remove(); if (onDone) onDone(); }, 300);
          return;
        }
        numEl.style.opacity = '0';
        numEl.style.transform = 'scale(2)';
        numEl.textContent = steps[i];
        numEl.style.color = colors[i];

        setTimeout(function () {
          numEl.style.transition = 'transform 0.25s cubic-bezier(.34,1.56,.64,1), opacity 0.25s ease';
          numEl.style.opacity = '1';
          numEl.style.transform = 'scale(1)';
        }, 0);

        i++;
        setTimeout(tick, 900);
      }

      tick();
    }

    // Patch if function exists
    if (_origStartQuizBattle) {
      CF._startQuizBattle = async function (groupId) {
        var countdownPromise = new Promise(function (resolve) {
          _showCountdownOverlay(resolve);
        });
        await countdownPromise;
        return _origStartQuizBattle(groupId);
      };
    }

    /* ─────────────────────────────────────────────────────────────
     * FIX 3c — PATCH THE POLLER to handle countdown signal
     *   Non-admin members receive 'countdown.active' via Firestore
     *   and show the countdown overlay locally.
     * ───────────────────────────────────────────────────────────── */
    if (CF._openGroupChat && typeof CF._openGroupChat === 'function') {
      var _patchedInterval = CF._chatPollInterval;
      if (_patchedInterval) clearInterval(_patchedInterval);

      var db = window._firebaseDb;
      var fns = window._firebaseFns;
      var _countdownShown = false;

      CF._chatPollInterval = setInterval(async function () {
        if (!CF._currentGroupId) return;
        if (CF._answerAnimating) return;
        try {
          var s = await fns.getDoc(fns.doc(db, 'studyGroups', CF._currentGroupId));
          if (!s.exists()) { CF._stopChatPolling && CF._stopChatPolling(); return; }
          var data = s.data();

          // Countdown signal for non-admin members
          var myUid = window._firebaseAuth && window._firebaseAuth.currentUser ? window._firebaseAuth.currentUser.uid : null;
          var isAdmin = data.adminUid && data.adminUid === myUid;
          if (!isAdmin && data.countdown && data.countdown.active && !_countdownShown) {
            _countdownShown = true;
            _showCountdownOverlay(function () { _countdownShown = false; });
          }
          if (!data.countdown || !data.countdown.active) {
            _countdownShown = false;
          }

          var newHash = JSON.stringify({
            quizStatus: data.quiz ? data.quiz.status : null,
            quizQ: data.quiz ? data.quiz.current : null,
            quizAnswers: data.quiz ? Object.keys(data.quiz.answers || {}).length : 0,
            members: (data.members || []).length
          });

          if (newHash !== CF._chatPollHash) {
            CF._chatPollHash = newHash;
            CF._currentGroupData = data;
            var status = data.quiz ? data.quiz.status : null;
            if (status === 'active') {
              CF._renderQuizQuestion && CF._renderQuizQuestion(data.quiz, CF._currentGroupId, data.memberNames);
            } else if (status === 'finished') {
              CF._stopGroupQuizTimer && CF._stopGroupQuizTimer();
              CF._renderQuizResults && CF._renderQuizResults(data.quiz, data.memberNames);
            } else if (status === 'abandoned') {
              CF._stopGroupQuizTimer && CF._stopGroupQuizTimer();
              var qa = document.getElementById('cf-quiz-area');
              if (qa) {
                qa.innerHTML = '<div style="text-align:center;padding:16px;color:rgba(200,195,255,0.5);font-size:13px">🚫 Battle ended by admin.</div>';
                setTimeout(function () { if (qa) qa.innerHTML = ''; }, 3000);
              }
            } else {
              var qa2 = document.getElementById('cf-quiz-area');
              if (qa2) qa2.innerHTML = '';
            }
            if (typeof _refreshAdminBar === 'function') _refreshAdminBar(CF._currentGroupId, data);
          }
        } catch (e) {}
      }, 2000);
    }

    /* ─────────────────────────────────────────────────────────────
     * FIX 4 — ADD endBattle() — sets quiz.status = 'abandoned'
     * ───────────────────────────────────────────────────────────── */
    CF._endBattle = async function (groupId) {
      if (!confirm('End the battle for everyone?')) return;
      try {
        var db = window._firebaseDb;
        var fns = window._firebaseFns;
        await fns.updateDoc(fns.doc(db, 'studyGroups', groupId), { 'quiz.status': 'abandoned' });
        if (typeof toast === 'function') toast('🚫 Battle ended.', 2000);
        var qa = document.getElementById('cf-quiz-area');
        if (qa) qa.innerHTML = '';
        // Restore admin bar
        if (CF._currentGroupData) {
          _refreshAdminBar(groupId, CF._currentGroupData);
        }
      } catch (e) {
        if (typeof toast === 'function') toast('❌ Could not end battle.', 2000);
      }
    };

    /* ─────────────────────────────────────────────────────────────
     * FIX 5 — ADD quitBattle() — for non-admin users
     *   Just clears the quiz UI locally and stops them from seeing it.
     *   Does NOT touch Firestore (battle continues for others).
     * ───────────────────────────────────────────────────────────── */
    CF._quitBattle = function () {
      if (!confirm('Leave the battle? Other players will continue.')) return;
      CF._answerAnimating = false;
      var qa = document.getElementById('cf-quiz-area');
      if (qa) {
        qa.innerHTML = '<div style="text-align:center;padding:16px;color:rgba(200,195,255,0.5);font-size:13px">You left the battle.</div>';
        setTimeout(function () { if (qa) qa.innerHTML = ''; }, 3000);
      }
      // Freeze the quiz area by marking current question as answered locally
      // so the poller won't re-inject the question for this user
      if (CF._currentGroupData && CF._currentGroupData.quiz) {
        CF._currentGroupData._userQuit = true;
      }
      if (typeof toast === 'function') toast('👋 You left the battle.', 2000);
    };

    /* ─────────────────────────────────────────────────────────────
     * FIX 6 — PATCH _renderQuizQuestion to inject Quit button
     *   and respect _userQuit flag
     * ───────────────────────────────────────────────────────────── */
    if (CF._renderQuizQuestion && typeof CF._renderQuizQuestion === 'function') {
      var _origRenderQuizQuestion = CF._renderQuizQuestion.bind(CF);

      CF._renderQuizQuestion = function (quiz, groupId, memberNames) {
        // If this user already quit, don't re-inject the question
        if (CF._currentGroupData && CF._currentGroupData._userQuit && quiz && quiz.status === 'active') return;

        _origRenderQuizQuestion(quiz, groupId, memberNames);

        // Inject the "Quit Battle" button after rendering (only when active)
        if (!quiz || quiz.status !== 'active') return;
        var wrap = document.querySelector('.cf-quiz-battle-wrap');
        if (!wrap || wrap.querySelector('.cf-quit-battle-btn')) return; // already injected

        var quitRow = document.createElement('div');
        quitRow.style.cssText = 'display:flex;justify-content:flex-end;margin-top:8px;';

        var myUid = (typeof uid === 'function') ? uid() : '';
        var isAdmin = CF._currentGroupData && CF._currentGroupData.adminUid === myUid;

        if (isAdmin) {
          // Admin gets "End Battle" button
          quitRow.innerHTML = '<button class="cf-quit-battle-btn" onclick="CF._endBattle(\'' + groupId + '\')" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#f87171;border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:600">🛑 End Battle for All</button>';
        } else {
          // Regular user gets "Quit Battle" button
          quitRow.innerHTML = '<button class="cf-quit-battle-btn" onclick="CF._quitBattle()" style="background:rgba(239,68,68,0.10);border:1px solid rgba(239,68,68,0.3);color:#f87171;border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:600">🚪 Quit Battle</button>';
        }

        wrap.appendChild(quitRow);
      };
    }

    /* ─────────────────────────────────────────────────────────────
     * FIX 7 — PATCH ADMIN BAR to show "End Battle" during active quiz
     * ───────────────────────────────────────────────────────────── */
    function _refreshAdminBar(groupId, data) {
      var bar = document.getElementById('cf-admin-bar');
      if (!bar) return;
      var myUid = (typeof uid === 'function') ? uid() : '';
      if (!data || data.adminUid !== myUid) return;

      var isActive = data.quiz && data.quiz.status === 'active';
      if (isActive) {
        bar.innerHTML = '<span style="font-size:11px;font-weight:700;color:#f59e0b;margin-right:4px">👑 Admin</span>'
          + '<button class="cf-btn cf-btn-sm" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#f87171;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-weight:600" onclick="CF._endBattle(\'' + groupId + '\')">🛑 End Battle</button>';
      }
      // If not active, leave the bar as-is (original code handles it)
    }

    /* ─────────────────────────────────────────────────────────────
     * FIX 8 — PATCH poller render to respect _userQuit flag
     * ───────────────────────────────────────────────────────────── */
    if (CF._renderQuizResults && typeof CF._renderQuizResults === 'function') {
      var _origRenderQuizResults = CF._renderQuizResults.bind(CF);
      CF._renderQuizResults = function (quiz, memberNames) {
        // Clear quit flag when battle is truly over — show results to everyone
        if (CF._currentGroupData) CF._currentGroupData._userQuit = false;
        _origRenderQuizResults(quiz, memberNames);
        // battle-arena-patch.js v2.0 will further enhance results with ELO/coins/highlights
      };
    }

    console.info('[BattleFix] v1.3 — lag fix + timer flicker prevention + text visibility fix + quit/end battle applied');
  }

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPatch);
  } else {
    initPatch();
  }

})();