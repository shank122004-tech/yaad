/**
 * crackwithai-master-patch.js — CrackwithAI v1.1 (Performance-Safe)
 * All changes in one lightweight file. No MutationObserver, no heavy DOM walks.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════
   * 1. BRANDING — targeted rename, runs ONCE
   * ═══════════════════════════════════════════ */
  function renameBranding() {
    var yr = new Date().getFullYear();

    // Only scan elements likely to contain branding text (not the whole DOM)
    var TARGETS = [
      '.cai-logo-name', '.prf-version', '.app-name', '#appTitle',
      '.footer-brand', '.about-app-name', '.pvs-app-name',
      '[data-brand]', 'title', '.modal-title', '.brand-text',
      '.premium-modal-title', '.onboard-title'
    ];

    TARGETS.forEach(function(sel) {
      try {
        document.querySelectorAll(sel).forEach(function(el) {
          if (el.textContent.includes('CrackAI')) {
            el.textContent = el.textContent.replace(/CrackAI/g, 'CrackwithAI');
          }
        });
      } catch(e) {}
    });

    // Fix <title>
    if (document.title && document.title.includes('CrackAI')) {
      document.title = document.title.replace(/CrackAI/g, 'CrackwithAI');
    }

    // Update year in any element with class cwai-year or data-year
    document.querySelectorAll('.cwai-year,[data-cwai-year]').forEach(function(el) {
      el.textContent = yr;
    });
  }

  /* ═══════════════════════════════════════════
   * 2. FREE LIMIT — 3 msgs/day
   * ═══════════════════════════════════════════ */
  function patchFreeLimit() {
    var FREE_TEXT = 3, FREE_IMAGE = 2, FREE_PDF = 1;

    function isPremium() {
      try {
        var uid = window._firebaseAuth && window._firebaseAuth.currentUser
                  ? window._firebaseAuth.currentUser.uid : null;
        var p = uid ? ('sscai_u:' + uid + ':') : 'sscai_guest:';
        return localStorage.getItem(p + 'premium') === 'true';
      } catch(e) { return false; }
    }

    window.canSendText  = function() { return isPremium() || (typeof state!=='undefined' && state.textCount  < FREE_TEXT); };
    window.canSendImage = function() { return isPremium() || (typeof state!=='undefined' && state.imageCount < FREE_IMAGE); };
    window.canSendPdf   = function() { return isPremium() || (typeof state!=='undefined' && state.pdfCount   < FREE_PDF); };

    window.handleLimitHit = function(type) {
      var msgs = { text:'Daily limit: 3 free messages used', image:'Daily image limit reached', pdf:'Daily PDF limit reached' };
      try { if (typeof showToast==='function') showToast('🔒 ' + (msgs[type]||'Limit reached') + ' — Upgrade ₹199/month'); } catch(e){}
      try {
        if (typeof openPremiumModal==='function') { openPremiumModal(); return; }
        var m = document.getElementById('premiumModal'); if (m) m.classList.add('active');
      } catch(e){}
    };

    // Patch updateLimitUI for correct count display
    var _orig = window.updateLimitUI;
    window.updateLimitUI = function() {
      try { if (typeof _orig==='function') _orig(); } catch(e){}
      try {
        var el = document.getElementById('messageLimitInfo');
        if (!el || isPremium()) return;
        var used = typeof state!=='undefined' ? (state.textCount||0) : 0;
        var rem  = Math.max(0, FREE_TEXT - used);
        var col  = rem===0 ? '#ef4444' : rem===1 ? '#f59e0b' : 'rgba(200,195,255,0.6)';
        el.innerHTML = rem > 0
          ? '<span style="color:'+col+';font-size:11px;">🤖 Free: <strong>'+rem+'</strong>/3 messages left today · <a href="#" onclick="openPremiumModal&&openPremiumModal();return false;" style="color:#6C63FF;text-decoration:none;">Upgrade ⭐</a></span>'
          : '<span style="color:#ef4444;font-size:11px;">🔒 Free limit reached (3/day) · <a href="#" onclick="openPremiumModal&&openPremiumModal();return false;" style="color:#f59e0b;font-weight:600;text-decoration:none;">Upgrade ₹199/mo ⭐</a></span>';
      } catch(e){}
    };
  }

  /* ═══════════════════════════════════════════
   * 3. REMOVE SPEECH LANGUAGE SECTION (targeted)
   * ═══════════════════════════════════════════ */
  function removeSpeechSection() {
    // Only target specific IDs and classes — no full tree scan
    var IDS = [
      'speechLangSection','ttsLangSection','voiceLangSection','teacherVoiceSection',
      'pvsSpeechLang','pvsTtsVoice','speechLanguageWrap','ttsVoiceWrap',
      'teacherVoiceRow','voiceModelRow','pvs-lang-row','tts-voice-row'
    ];
    IDS.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });

    var CLASSES = [
      '.pvs-lang-section','.tts-lang-section','.voice-lang-section',
      '.speech-language-section','.teacher-voice-picker','.tts-voice-picker'
    ];
    CLASSES.forEach(function(cls) {
      try { document.querySelectorAll(cls).forEach(function(el){ el.remove(); }); } catch(e){}
    });

    // Remove "Test Voice Settings" button by text (scans only buttons — fast)
    document.querySelectorAll('button').forEach(function(btn) {
      if (btn.textContent.trim().includes('Test Voice Settings') ||
          btn.textContent.trim().includes('🔊 Test Voice')) {
        btn.remove();
      }
    });
  }

  /* ═══════════════════════════════════════════
   * 4. PREMIUM ANIMATIONS (CSS-only, zero JS cost)
   * ═══════════════════════════════════════════ */
  function injectAnimationCSS() {
    if (document.getElementById('cwai-anim-css')) return;
    var s = document.createElement('style');
    s.id = 'cwai-anim-css';
    s.textContent = [
      '@keyframes cwShimmer{0%{background-position:-200% center}100%{background-position:200% center}}',
      '@keyframes cwGlow{0%,100%{box-shadow:0 0 0 0 rgba(108,99,255,0)}50%{box-shadow:0 0 14px 3px rgba(108,99,255,0.35),0 0 28px 6px rgba(255,107,157,0.15)}}',
      '@keyframes cwBorder{0%{border-color:rgba(108,99,255,0.4)}33%{border-color:rgba(255,107,157,0.5)}66%{border-color:rgba(245,158,11,0.4)}100%{border-color:rgba(108,99,255,0.4)}}',
      '@keyframes cwFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}',
      '@keyframes cwHue{0%{filter:hue-rotate(0deg) drop-shadow(0 0 4px rgba(108,99,255,0.6))}100%{filter:hue-rotate(360deg) drop-shadow(0 0 4px rgba(255,107,157,0.6))}}',

      // Pro model options
      '.model-option[data-model="pro"],.model-option[data-model="vision-pro"],.model-option[data-model="v4-pro"]{border:1.5px solid rgba(108,99,255,0.4);animation:cwBorder 3s ease-in-out infinite,cwGlow 2.5s ease-in-out infinite;background:linear-gradient(135deg,rgba(108,99,255,0.06),rgba(255,107,157,0.04));position:relative;overflow:hidden;}',
      '.model-option[data-model="pro"]::before,.model-option[data-model="vision-pro"]::before,.model-option[data-model="v4-pro"]::before{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,0.06) 50%,transparent 60%);background-size:200% 100%;animation:cwShimmer 2.5s linear infinite;pointer-events:none;}',
      '.model-option[data-model="pro"] .model-opt-icon,.model-option[data-model="vision-pro"] .model-opt-icon,.model-option[data-model="v4-pro"] .model-opt-icon{animation:cwHue 4s linear infinite;}',

      // Pro tag shimmer
      '.pro-tag{background:linear-gradient(90deg,rgba(108,99,255,0.3),rgba(255,107,157,0.3),rgba(245,158,11,0.3),rgba(108,99,255,0.3));background-size:300% 100%;animation:cwShimmer 2s linear infinite;color:#f9d71c !important;font-weight:800;letter-spacing:.08em;border:1px solid rgba(245,158,11,0.3);}',

      // Voice / Teacher model
      '.model-option[data-model="teacher"]{border:1.5px solid rgba(167,139,250,0.4);animation:cwGlow 3s ease-in-out infinite;background:linear-gradient(135deg,rgba(167,139,250,0.07),rgba(108,99,255,0.04));position:relative;overflow:hidden;}',
      '.model-option[data-model="teacher"]::before{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 40%,rgba(167,139,250,0.08) 50%,transparent 60%);background-size:200% 100%;animation:cwShimmer 3s linear infinite;pointer-events:none;}',
      '.model-option[data-model="teacher"] .model-opt-icon{animation:cwFloat 2.5s ease-in-out infinite;}',

      // Group label gradient text
      '.model-group-label{background:linear-gradient(90deg,#6C63FF,#FF6B9D,#f59e0b,#6C63FF);background-size:300% 100%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:cwShimmer 4s linear infinite;font-weight:800;}',

      // Active model
      '.model-option.active{background:linear-gradient(135deg,rgba(108,99,255,0.2),rgba(255,107,157,0.1)) !important;box-shadow:0 0 0 1.5px rgba(108,99,255,0.5),0 4px 16px rgba(108,99,255,0.2);animation:cwGlow 2s ease-in-out infinite;}',

      // Leaderboard avatar
      '.lb-avatar{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex-shrink:0;border:2px solid rgba(255,255,255,0.1);}',
      '.lb-row.top3{background:rgba(245,158,11,0.06);border-color:rgba(245,158,11,0.2);}',
      '.lb-row.me{background:rgba(108,99,255,0.08);}',
      '.lb-xp-col{text-align:right;flex-shrink:0;}',
      '.lb-xp-val{font-size:15px;font-weight:800;color:#f59e0b;}',
      '.lb-xp-lbl{font-size:10px;color:rgba(200,195,255,0.45);}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════════
   * 5. 29-DAY EXPIRY + RENEWAL POPUP
   * ═══════════════════════════════════════════ */
  function patchExpiry() {
    var EXPIRY_MS = 29 * 24 * 60 * 60 * 1000;

    function getP() {
      try {
        var u = window._firebaseAuth && window._firebaseAuth.currentUser;
        return u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
      } catch(e) { return 'sscai_guest:'; }
    }

    function checkExpiry() {
      try {
        var p = getP();
        if (localStorage.getItem(p + 'premium') !== 'true') return;
        var at = parseInt(localStorage.getItem(p + 'premium_activated_at') || '0', 10);
        if (!at) { localStorage.setItem(p + 'premium_activated_at', String(Date.now())); return; }
        if (Date.now() - at >= EXPIRY_MS) {
          localStorage.setItem(p + 'premium', 'false');
          localStorage.removeItem(p + 'premium_plan');
          try { if (typeof state !== 'undefined') state.isPremium = false; } catch(e){}
          try { if (typeof updateLimitUI === 'function') updateLimitUI(); } catch(e){}
          showRenewalPopup();
        }
      } catch(e){}
    }

    function showRenewalPopup() {
      if (document.getElementById('cwai-renew-popup')) return;
      var d = document.createElement('div');
      d.id = 'cwai-renew-popup';
      d.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);padding:20px;';
      d.innerHTML = '<div style="background:linear-gradient(135deg,#1a1040,#0f0a28);border:1.5px solid rgba(108,99,255,0.4);border-radius:20px;padding:28px 24px;max-width:360px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.6);">'
        + '<div style="font-size:40px;margin-bottom:12px;">⭐</div>'
        + '<div style="font-size:18px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">Premium Expired</div>'
        + '<div style="font-size:13px;color:rgba(200,195,255,0.7);line-height:1.6;margin-bottom:20px;">Your 29-day plan has ended.<br>Renew to continue unlimited access,<br>Mock Tests, PYQ Bank &amp; all AI models.</div>'
        + '<button onclick="document.getElementById(\'cwai-renew-popup\').remove();if(typeof openPremiumModal===\'function\')openPremiumModal();" style="width:100%;padding:13px;border-radius:12px;border:none;cursor:pointer;background:linear-gradient(135deg,#6C63FF,#FF6B9D);color:var(--text-primary);font-size:15px;font-weight:700;margin-bottom:10px;">🔄 Renew Premium — ₹199/mo</button>'
        + '<button onclick="document.getElementById(\'cwai-renew-popup\').remove();" style="width:100%;padding:10px;border-radius:12px;border:1px solid rgba(108,99,255,0.3);background:transparent;color:rgba(200,195,255,0.6);font-size:13px;cursor:pointer;">Maybe Later</button>'
        + '</div>';
      document.body.appendChild(d);
    }

    // Patch activatePlan to stamp activation time
    var _orig = window.activatePlan;
    window.activatePlan = function(planId) {
      var MAIN = ['premium','ssc','class10','class10_yearly','semiannual','yearly','ssc_monthly'];
      if (MAIN.indexOf(planId) > -1) {
        localStorage.setItem(getP() + 'premium_activated_at', String(Date.now()));
      }
      if (typeof _orig === 'function') return _orig(planId);
    };

    setTimeout(checkExpiry, 3000);
    setInterval(checkExpiry, 30 * 60 * 1000);
  }

  /* ═══════════════════════════════════════════
   * 6. BATTLE — unique questions + question count
   * ═══════════════════════════════════════════ */
  function patchBattles() {
    /* ── Enhanced question generator ── */
    window._cwaiGenQuestions = async function(exam, count, seed) {
      count = count || 10;
      // Load from Firebase Storage — NOT DeepSeek (DeepSeek only used for home chat)
      try {
        const storage  = window._firebaseStorage;
        const sRef     = window._storageRef;
        const getDLUrl = window._getDownloadURL;
        if (storage && sRef && getDLUrl) {
          const paths = [
            'battles/' + exam + '/questions.json',
            'mock/' + exam + '/questions.json',
            'pyq/' + exam + '/questions.json'
          ];
          for (const path of paths) {
            try {
              const fileRef = sRef(storage, path);
              const url = await getDLUrl(fileRef);
              const res = await fetch(url, { cache: 'no-cache' });
              if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length) {
                  return data.sort(() => Math.random() - 0.5).slice(0, count);
                }
              }
            } catch(_) {}
          }
        }
      } catch(e) {}
      return [];
    };;

    /* ── Patch _generateBattleQuestions to use new generator + seed ── */
    function tryPatch() {
      if (typeof _generateBattleQuestions === 'undefined' && typeof BA === 'undefined') {
        setTimeout(tryPatch, 300); return;
      }

      // Override the global function if it exists
      if (typeof window._generateBattleQuestions !== 'undefined') {
        var _origGen = window._generateBattleQuestions;
        window._generateBattleQuestions = function(exam, count, seedParam) {
          var seed = seedParam || (exam + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,5));
          return window._cwaiGenQuestions(exam, count, seed);
        };
      }

      if (typeof BA === 'undefined') return;

      /* ── Demo battle: no cache, unique questions each time ── */
      var _origDemoQ = BA._getDemoQuestionsForExam;
      if (typeof _origDemoQ === 'function') {
        BA._getDemoQuestionsForExam = async function(examKey, battleId) {
          try { localStorage.removeItem('demoQ_' + examKey); } catch(e){}
          var seed = 'demo_' + (battleId || examKey) + '_' + Date.now();
          return await window._cwaiGenQuestions(examKey, 10, seed);
        };
      }

      /* ── Real battle: use questionCount from Firestore doc ── */
      var _origGenStart = BA._generateAndStart;
      if (typeof _origGenStart === 'function') {
        BA._generateAndStart = async function(battleId, examHint) {
          var db = window._firebaseDb;
          var fns = window._firebaseFns;
          if (!db || !fns) return _origGenStart.call(BA, battleId, examHint);
          try {
            var snap = await fns.getDoc(fns.doc(db,'publicBattles',battleId));
            if (!snap.exists()) return;
            var battle = snap.data();
            if (['generating','countdown','active','finished'].includes(battle.status)) return;
            await fns.updateDoc(fns.doc(db,'publicBattles',battleId), {status:'generating'});
            var exam  = examHint || battle.exam;
            var count = battle.questionCount || 10;
            var seed  = 'real_' + battleId + '_' + Date.now();
            var questions = await window._cwaiGenQuestions(exam, count, seed);
            if (!questions || !questions.length) {
              await fns.updateDoc(fns.doc(db,'publicBattles',battleId),{status:'waiting'});
              try{if(typeof showToast==='function')showToast('❌ Question generation failed. Please retry.');}catch(e){}
              return;
            }
            await fns.updateDoc(fns.doc(db,'publicBattles',battleId),{questions,status:'countdown',countdownAt:Date.now()});
            if (typeof BA._handleCountdown==='function') BA._handleCountdown({...battle,questions,countdownAt:Date.now()},battleId);
          } catch(e) {
            try{fns.updateDoc(fns.doc(db,'publicBattles',battleId),{status:'waiting'});}catch(_){}
            try{if(typeof showToast==='function')showToast('❌ Could not start battle.');}catch(_){}
          }
        };
      }

      /* ── Inject question count selector into create-battle form ── */
      function injectCountPicker() {
        if (document.getElementById('cwai-q-count')) return;
        var goBtn = document.getElementById('ba-create-go-btn');
        if (!goBtn) return;
        var wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom:12px;';
        wrap.innerHTML = '<label style="font-size:11px;color:rgba(200,195,255,0.55);font-weight:600;display:block;margin-bottom:6px;">📝 Number of Questions</label>'
          + '<select id="cwai-q-count" style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid rgba(108,99,255,0.3);background:rgba(255,255,255,0.05);color:var(--text-primary);font-size:13px;cursor:pointer;outline:none;">'
          + '<option value="10">10 Questions (Standard)</option>'
          + '<option value="15">15 Questions</option>'
          + '<option value="20">20 Questions</option>'
          + '<option value="25">25 Questions (Marathon)</option>'
          + '</select>';
        goBtn.parentNode.insertBefore(wrap, goBtn);
      }
      injectCountPicker();
      setTimeout(injectCountPicker, 500);
      setTimeout(injectCountPicker, 1500);

      /* ── Patch _createBattle to save questionCount ── */
      var _origCreate = BA._createBattle;
      if (typeof _origCreate === 'function') {
        BA._createBattle = async function() {
          var sel = document.getElementById('cwai-q-count');
          var count = sel ? parseInt(sel.value, 10) : 10;
          // Store so setDoc can pick it up
          window._cwai_pending_qcount = count;
          return _origCreate.apply(BA, arguments);
        };
      }

      // If BA uses setDoc internally, patch it temporarily
      var _origSetDoc = window._firebaseFns && window._firebaseFns.setDoc;
      if (_origSetDoc) {
        window._firebaseFns.setDoc = function(ref, data) {
          if (data && data.status === 'waiting' && !data.questionCount && window._cwai_pending_qcount) {
            data.questionCount = window._cwai_pending_qcount;
            window._cwai_pending_qcount = null;
          }
          return _origSetDoc.apply(this, arguments);
        };
      }
    }

    setTimeout(tryPatch, 600);
  }

  /* ═══════════════════════════════════════════
   * 7. LEADERBOARD FIXES — all participants shown
   * ═══════════════════════════════════════════ */
  function patchLeaderboard() {
    if (typeof BA === 'undefined') { setTimeout(patchLeaderboard, 500); return; }

    function getWeekKy() {
      try { if (typeof getWeekKey==='function') return getWeekKey(); } catch(e){}
      var d=new Date(), day=d.getDay(), diff=d.getDate()-day+(day===0?-6:1);
      var m=new Date(d.setDate(diff));
      return m.getFullYear()+'-W'+String(Math.ceil(m.getDate()/7)).padStart(2,'0');
    }
    function getAvatar(uid) {
      try {
        var emap={av_fire:'🔥',av_crown:'👑',av_brain:'🧠',av_star:'🌟',av_lightning:'⚡',av_shield:'🛡️',av_gem:'💎',av_rocket:'🚀',av_ninja:'🥷',av_robot:'🤖',av_dragon:'🐉',av_wizard:'🧙',av_astronaut:'🧑‍🚀'};
        var c=JSON.parse(localStorage.getItem('sscai_u:'+uid+':cosmetics')||'null');
        if(c&&c.activeAvatar) return emap[c.activeAvatar]||'';
        var a=JSON.parse(localStorage.getItem('sscai_cosmetics')||'{}');
        if(a.equipped_avatar) return emap[a.equipped_avatar]||'';
      } catch(e){}
      return '';
    }
    function getMyName() {
      try {
        var u=window._firebaseAuth&&window._firebaseAuth.currentUser;
        if(u&&u.displayName) return u.displayName;
        if(u&&u.email) return u.email.split('@')[0];
      } catch(e){}
      return 'Student';
    }

    /* Save every participant (not just winner) */
    BA._saveToLeaderboard = async function(userUid, userName, battleXP) {
      try {
        var db=window._firebaseDb, fns=window._firebaseFns;
        if(!db||!fns) return;
        var wk=getWeekKy(), docId=wk+'_'+userUid;
        var snap=await fns.getDoc(fns.doc(db,'battleLeaderboard',docId));
        var ex=snap.exists()?snap.data():null;
        var photoURL='';
        try{var u=window._firebaseAuth&&window._firebaseAuth.currentUser;if(u&&u.photoURL)photoURL=u.photoURL;}catch(e){}
        var avatar=getAvatar(userUid);
        await fns.setDoc(fns.doc(db,'battleLeaderboard',docId),{
          uid:userUid, name:userName,
          xp:(ex&&ex.xp||0)+battleXP,
          battles:(ex&&ex.battles||0)+1,
          wins:ex&&ex.wins||0,
          weekKey:wk, updatedAt:Date.now(), photoURL, avatar
        });
        // All-time
        try {
          var ar=fns.doc(db,'battleLeaderboardAllTime',userUid);
          var as=await fns.getDoc(ar);
          var ad=as.exists()?as.data():null;
          await fns.setDoc(ar,{uid:userUid,name:userName,xp:(ad&&ad.xp||0)+battleXP,battles:(ad&&ad.battles||0)+1,wins:ad&&ad.wins||0,updatedAt:Date.now(),photoURL,avatar});
        } catch(e){}
      } catch(e){}
    };

    /* Render leaderboard with all players */
    BA._renderLeaderboard = async function() {
      var body=document.getElementById('lb-body');
      if(!body) return;
      body.innerHTML='<div class="ba-loading"><div class="ba-spinner"></div>Loading...</div>';
      var db=window._firebaseDb, fns=window._firebaseFns;
      if(!db||!fns){body.innerHTML='<div class="ba-empty">⏳ Connecting...</div>';return;}
      try {
        var wk=getWeekKy(), myUid=window._firebaseAuth&&window._firebaseAuth.currentUser&&window._firebaseAuth.currentUser.uid||'guest';
        var entries=[];
        try {
          var q=fns.query(fns.collection(db,'battleLeaderboard'),fns.where('weekKey','==',wk),fns.orderBy('xp','desc'),fns.limit(100));
          var sn=await fns.getDocs(q);
          entries=sn.docs.map(function(d){return d.data();});
        } catch(e) {
          try {
            var q2=fns.query(fns.collection(db,'battleLeaderboard'),fns.where('weekKey','==',wk));
            var sn2=await fns.getDocs(q2);
            entries=sn2.docs.map(function(d){return d.data();}).sort(function(a,b){return(b.xp||0)-(a.xp||0);});
          } catch(e2){ entries=[]; }
        }
        // Add current user if not already listed
        if(!entries.find(function(e){return e.uid===myUid;})) {
          try{var myXP=typeof getBattleXP==='function'?getBattleXP():0;if(myXP>0)entries.push({uid:myUid,name:getMyName(),xp:myXP,battles:1,wins:0,weekKey:wk});}catch(ex){}
        }
        entries.sort(function(a,b){return(b.xp||0)-(a.xp||0);});
        _drawLb(body,entries,myUid,true);
      } catch(e){ body.innerHTML='<div class="ba-empty">📭 No battles yet this week.</div>'; }
    };

    BA._renderAllTimeLeaderboard = async function() {
      var body=document.getElementById('lb-body');
      if(!body) return;
      body.innerHTML='<div class="ba-loading"><div class="ba-spinner"></div>Loading all-time...</div>';
      var db=window._firebaseDb, fns=window._firebaseFns;
      if(!db||!fns){body.innerHTML='<div class="ba-empty">⏳ Connecting...</div>';return;}
      try {
        var myUid=window._firebaseAuth&&window._firebaseAuth.currentUser&&window._firebaseAuth.currentUser.uid||'guest';
        var entries=[];
        try {
          var q=fns.query(fns.collection(db,'battleLeaderboardAllTime'),fns.orderBy('xp','desc'),fns.limit(100));
          var sn=await fns.getDocs(q);
          entries=sn.docs.map(function(d){return d.data();});
        } catch(e) {
          var sn2=await fns.getDocs(fns.collection(db,'battleLeaderboardAllTime'));
          entries=sn2.docs.map(function(d){return d.data();}).sort(function(a,b){return(b.xp||0)-(a.xp||0);}).slice(0,100);
        }
        _drawLb(body,entries,myUid,false);
      } catch(e){ body.innerHTML='<div class="ba-empty">📭 No all-time data yet.</div>'; }
    };

    function _drawLb(body, entries, myUid, isWeekly) {
      var TIERS=[
        {min:0,max:9,t:'Beginner',e:'🌱',c:'#4ade80'},
        {min:10,max:24,t:'Aspirant',e:'📘',c:'#38bdf8'},
        {min:25,max:49,t:'Expert',e:'⚡',c:'#a78bfa'},
        {min:50,max:74,t:'SSC Master',e:'🏆',c:'#f59e0b'},
        {min:75,max:99,t:'Champion',e:'👑',c:'#FF6B9D'},
        {min:100,max:9999,t:'Legend',e:'🌟',c:'#fff'}
      ];
      function tier(lv){return TIERS.find(function(t){return lv>=t.min&&lv<=t.max;})||TIERS[0];}
      function avHtml(e,tr){
        var init=(e.name||'?').charAt(0).toUpperCase();
        var av=e.avatar||getAvatar(e.uid);
        if(av) return '<div class="lb-avatar" style="background:linear-gradient(135deg,'+tr.c+'44,'+tr.c+'22);font-size:20px;">'+av+'</div>';
        if(e.photoURL) return '<div class="lb-avatar" style="padding:0;overflow:hidden;background:none;"><img src="'+e.photoURL+'" style="width:38px;height:38px;border-radius:50%;object-fit:cover;" onerror="this.parentElement.textContent=\''+init+'\';this.parentElement.style.background=\'linear-gradient(135deg,'+tr.c+'44,'+tr.c+'22)\';"/></div>';
        return '<div class="lb-avatar" style="background:linear-gradient(135deg,'+tr.c+'44,'+tr.c+'22);color:'+tr.c+';">'+init+'</div>';
      }

      var myRank=entries.findIndex(function(e){return e.uid===myUid;})+1;
      var myD=entries.find(function(e){return e.uid===myUid;});
      var html='<div class="lb-tab-row"><button class="lb-tab '+(isWeekly?'active':'')+'" onclick="BA._renderLeaderboard&&BA._renderLeaderboard()">📅 This Week</button><button class="lb-tab '+(isWeekly?'':'active')+'" onclick="BA._renderAllTimeLeaderboard&&BA._renderAllTimeLeaderboard()">🌐 All Time</button></div>';

      if(myRank>0&&myD){
        var mlv=Math.floor((myD.xp||0)/10),mt=tier(mlv);
        html+='<div style="background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.3);border-radius:12px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;gap:12px;">'
          +avHtml(myD,mt)
          +'<div style="flex:1;"><div style="font-size:13px;font-weight:700;color:var(--text-primary);">Your Rank: #'+myRank+'</div>'
          +'<div style="font-size:11px;color:rgba(200,195,255,0.5);">Lv.'+mlv+' '+mt.t+' · '+(myD.wins||0)+' wins</div></div>'
          +'<div style="text-align:right;"><div style="font-size:14px;font-weight:800;color:#f59e0b;">'+(myD.xp||0)+' XP</div>'
          +'<div style="font-size:10px;color:rgba(200,195,255,0.4);">'+(myD.battles||0)+' battles</div></div></div>';
      }

      if(!entries.length){
        html+='<div class="ba-empty">📭 No battles yet. Be the first! ⚔️</div>';
      } else {
        entries.forEach(function(e,i){
          var isMe=e.uid===myUid, rank=i+1;
          var badge=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'#'+rank;
          var lv=Math.floor((e.xp||0)/10), tr=tier(lv);
          html+='<div class="lb-row'+(isMe?' me':'')+(rank<=3?' top3':'')+'" style="'+(isMe?'border:1px solid rgba(108,99,255,0.4);':'')+'">'
            +'<div class="lb-rank">'+badge+'</div>'
            +avHtml(e,tr)
            +'<div class="lb-info"><div class="lb-name">'+((e.name)||'Student')+(isMe?' <span style="font-size:10px;background:rgba(108,99,255,0.2);color:#a78bfa;padding:1px 6px;border-radius:10px;">You</span>':'')+'</div>'
            +'<div class="lb-level" style="color:'+tr.c+';">'+tr.e+' Lv.'+lv+' '+tr.t+' · '+(e.wins||0)+' wins</div></div>'
            +'<div class="lb-xp-col"><div class="lb-xp-val">'+(e.xp||0)+'</div><div class="lb-xp-lbl">'+(e.battles||0)+' battles</div></div>'
            +'</div>';
        });
      }
      body.innerHTML=html;
    }
  }

  /* ═══════════════════════════════════════════
   * INIT
   * ═══════════════════════════════════════════ */
  function init() {
    patchFreeLimit();
    patchExpiry();

    function onDom() {
      injectAnimationCSS();
      renameBranding();
      removeSpeechSection();
      // One-time delayed re-runs for dynamically rendered content only
      setTimeout(renameBranding, 1200);
      setTimeout(removeSpeechSection, 1200);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onDom);
    else onDom();

    // BA patches after a delay (BA loads last with defer)
    setTimeout(function tryBA() {
      if (typeof BA !== 'undefined') {
        patchBattles();
        patchLeaderboard();
      } else {
        setTimeout(tryBA, 400);
      }
    }, 800);
  }

  init();
  console.info('[CrackwithAI Patch] v1.1 — performance-safe ✅');
})();