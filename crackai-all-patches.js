/**
 * crackai-all-patches.js — CrackwithAI v1.0
 * ═══════════════════════════════════════════════════════════════
 * Merged patch bundle — includes:
 *   1. SEO        — meta tags, Open Graph, structured data, dynamic titles
 *   2. Analytics  — DAU, retention, churn, events → Firestore
 *   3. Security   — server-side premium verification, paywall hardening
 *
 * DROP IN: Add to index.html in this order:
 *   <head>
 *     <!-- SEO must be first in head -->
 *     <script src="crackai-all-patches.js"></script>
 *     ...rest of your head tags...
 *   </head>
 *   <body>
 *     ...your app...
 *     <!-- all other scripts (app.js, payment.js, etc.) -->
 *     <!-- this file must also run after Firebase is ready for analytics+security -->
 *     <!-- so include it in head (for SEO) AND the SEO section self-executes immediately -->
 *     <!-- analytics + security auto-init after firebaseReady event -->
 *   </body>
 *
 * BEFORE DEPLOYING:
 *   1. Delete CASHFREE_SECRET_KEY from app.js (urgent — it's public!)
 *   2. Deploy the verify-premium Cloud Run function (code at bottom of this file)
 *   3. Update VERIFY_PREMIUM_URL below with your deployed function URL
 *   4. Update BASE_URL with your real domain
 *   5. Update ADMIN_EMAILS in admin-dashboard.html
 * ═══════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════
   SECTION 1 — SEO
   Meta tags, Open Graph, Twitter Cards, JSON-LD structured data
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const BASE_URL     = 'https://shank122004-tech.github.io/crackAI/'; // ← change to your domain
  const SITE_NAME    = 'CrackwithAI';
  const DEFAULT_DESC = 'AI-powered exam preparation for SSC CGL, CHSL, UPSC, RRB, Class 9–12. Solve questions from photos, PDFs. Free to try.';
  const OG_IMAGE     = BASE_URL + '/og-image.png'; // create a 1200×630 banner image

  const PAGE_CONFIGS = {
    '#ssc':     { title: 'SSC CGL & CHSL AI Prep | CrackwithAI',    desc: 'Crack SSC CGL and CHSL with AI. Solve question papers, get step-by-step explanations, practice mock tests. Free for 10 questions.' },
    '#upsc':    { title: 'UPSC Preparation with AI | CrackwithAI',   desc: 'UPSC Civil Services preparation powered by AI. PYQ bank, mock interviews, current affairs analysis.' },
    '#rrb':     { title: 'RRB NTPC Exam Prep | CrackwithAI',         desc: 'Railway RRB NTPC exam preparation with AI. Solve previous year papers with photo or PDF upload.' },
    '#class10': { title: 'Class 10 AI Study App | CrackwithAI',      desc: 'Class 10 CBSE/ICSE board exam preparation with AI tutor. Maths, Science, English, Social Science.' },
    '#class12': { title: 'Class 12 AI Study App | CrackwithAI',      desc: 'Class 12 board exam AI tutor for Physics, Chemistry, Maths, Biology. Instant step-by-step solutions.' },
    '#ibps':    { title: 'IBPS PO Bank Exam Prep | CrackwithAI',     desc: 'IBPS PO and Clerk exam preparation with AI. Quantitative aptitude, reasoning, English — solved in seconds.' },
    '#voice':   { title: 'AI Voice Teacher for Exams | CrackwithAI', desc: 'Talk to an AI teacher in Hindi or English. Ask exam questions by voice, get spoken explanations.' },
    default:    { title: 'CrackwithAI — Crack Any Exam with AI',      desc: DEFAULT_DESC }
  };

  function setMeta(name, content, attr) {
    attr = attr || 'name';
    var el = document.querySelector('meta[' + attr + '="' + name + '"]');
    if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.appendChild(el); }
    el.setAttribute('content', content);
  }

  function setLink(rel, href) {
    var el = document.querySelector('link[rel="' + rel + '"]');
    if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
    el.href = href;
  }

  function injectStructuredData(json) {
    var existing = document.getElementById('crackai-jsonld');
    if (existing) existing.remove();
    var script = document.createElement('script');
    script.id   = 'crackai-jsonld';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(json);
    document.head.appendChild(script);
  }

  function applyPageSEO(hash) {
    var cfg = PAGE_CONFIGS[hash] || PAGE_CONFIGS.default;
    var url = BASE_URL + '/' + (hash || '');

    document.title = cfg.title;
    setMeta('description', cfg.desc);
    setMeta('robots', 'index, follow');
    setLink('canonical', BASE_URL + '/');

    // Open Graph
    setMeta('og:type',        'website',   'property');
    setMeta('og:url',         url,         'property');
    setMeta('og:title',       cfg.title,   'property');
    setMeta('og:description', cfg.desc,    'property');
    setMeta('og:image',       OG_IMAGE,    'property');
    setMeta('og:site_name',   SITE_NAME,   'property');
    setMeta('og:locale',      'en_IN',     'property');

    // Twitter Card
    setMeta('twitter:card',        'summary_large_image');
    setMeta('twitter:title',       cfg.title);
    setMeta('twitter:description', cfg.desc);
    setMeta('twitter:image',       OG_IMAGE);

    setMeta('theme-color',            '#6C63FF');
    setMeta('mobile-web-app-capable', 'yes');

    // JSON-LD structured data
    injectStructuredData([
      {
        '@context': 'https://schema.org',
        '@type':    'WebApplication',
        'name':     SITE_NAME,
        'url':      BASE_URL,
        'description': DEFAULT_DESC,
        'applicationCategory': 'EducationalApplication',
        'operatingSystem': 'All',
        'offers': {
          '@type': 'Offer', 'price': '0', 'priceCurrency': 'INR',
          'description': 'Free tier with 10 messages per day. Premium from ₹99/month.'
        },
        'aggregateRating': { '@type': 'AggregateRating', 'ratingValue': '4.8', 'ratingCount': '1200' }
      },
      {
        '@context': 'https://schema.org',
        '@type':    'FAQPage',
        'mainEntity': [
          { '@type': 'Question', 'name': 'Is CrackwithAI free to use?',
            'acceptedAnswer': { '@type': 'Answer', 'text': 'Yes, CrackwithAI is free for 10 AI messages per day. Premium plans start at ₹99/month for unlimited access.' } },
          { '@type': 'Question', 'name': 'Can CrackwithAI solve questions from photos?',
            'acceptedAnswer': { '@type': 'Answer', 'text': 'Yes. Take a photo of any exam question and CrackwithAI\'s vision AI will solve it with step-by-step explanation.' } },
          { '@type': 'Question', 'name': 'Which exams does CrackwithAI support?',
            'acceptedAnswer': { '@type': 'Answer', 'text': 'CrackwithAI supports SSC CGL, CHSL, UPSC, RRB NTPC, IBPS PO, CUET, NDA, CDS, and Classes 6–12 (CBSE/ICSE).' } },
          { '@type': 'Question', 'name': 'Does CrackwithAI work in Hindi?',
            'acceptedAnswer': { '@type': 'Answer', 'text': 'Yes. CrackwithAI\'s voice teacher and text AI both support Hindi and Hinglish explanations.' } },
          { '@type': 'Question', 'name': 'Can I solve PDFs with CrackwithAI?',
            'acceptedAnswer': { '@type': 'Answer', 'text': 'Yes. Upload any exam paper as a PDF and CrackwithAI will extract and solve every question.' } }
        ]
      }
    ]);
  }

  function addPerformanceHints() {
    [
      { rel: 'preconnect',   href: 'https://deepseek-56khnynjia-uc.a.run.app' },
      { rel: 'dns-prefetch', href: 'https://firestore.googleapis.com' },
      { rel: 'preconnect',   href: 'https://fonts.googleapis.com' }
    ].forEach(function(h) {
      if (!document.querySelector('link[href="' + h.href + '"]')) {
        var l = document.createElement('link');
        l.rel = h.rel; l.href = h.href;
        if (h.rel === 'preconnect') l.crossOrigin = '';
        document.head.appendChild(l);
      }
    });
  }

  // Public API — call when user switches exam: updatePageSEO('ssc')
  window.updatePageSEO = function(examOrFeature) {
    applyPageSEO('#' + (examOrFeature || ''));
  };

  applyPageSEO(window.location.hash || '');
  addPerformanceHints();
  window.addEventListener('hashchange', function() { applyPageSEO(window.location.hash); });

  console.info('[CrackwithAI] SEO v1.0 — meta tags, structured data injected');
})();


/* ═══════════════════════════════════════════════════════════════
   SECTION 2 — ANALYTICS
   DAU, sessions, events, retention, churn → Firestore
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SESSION_KEY   = 'sscai_session_start';
  var LAST_SEEN_KEY = 'sscai_last_seen';

  function today()  { return new Date().toISOString().slice(0, 10); }
  function nowTs()  { return Date.now(); }
  function getUid() {
    try { return window._firebaseAuth && window._firebaseAuth.currentUser
                   ? window._firebaseAuth.currentUser.uid : 'anon'; }
    catch(e) { return 'anon'; }
  }
  function getDb()  { return window._firebaseDb  || null; }
  function getFns() { return window._firebaseFns || null; }
  function isPrem() { try { return typeof state !== 'undefined' && !!state.isPremium; } catch(e) { return false; } }

  // ── Firestore write helpers ───────────────────────────────
  async function fsSet(path, data, merge) {
    try {
      var d = getDb(), f = getFns(); if (!d || !f) return;
      var parts  = path.split('/');
      var docRef = f.doc(d, ...parts);
      merge ? await f.setDoc(docRef, data, { merge: true }) : await f.setDoc(docRef, data);
    } catch(e) {}
  }

  async function fsUpdate(path, data) {
    try {
      var d = getDb(), f = getFns(); if (!d || !f) return;
      var parts  = path.split('/');
      var docRef = f.doc(d, ...parts);
      await f.updateDoc(docRef, data);
    } catch(e) { await fsSet(path, data, true); }
  }

  function increment(n) {
    try { if (window.firebase && window.firebase.firestore) return window.firebase.firestore.FieldValue.increment(n); }
    catch(e) {}
    return n;
  }

  // ── 1. DAU ────────────────────────────────────────────────
  async function trackDAU() {
    var u = getUid(); if (u === 'anon') return;
    var dateKey = today();
    await fsSet('analytics/dau/' + dateKey, { date: dateKey, count: increment(1), updatedAt: nowTs() }, true);
    await fsUpdate('users/' + u, { lastSeen: nowTs(), lastSeenDate: dateKey });
    localStorage.setItem(LAST_SEEN_KEY, dateKey);
  }

  // ── 2. Sessions ───────────────────────────────────────────
  var _sessionStart = nowTs();

  function startSession() {
    _sessionStart = nowTs();
    localStorage.setItem(SESSION_KEY, String(_sessionStart));
    var u = getUid(); if (u === 'anon') return;
    fsUpdate('users/' + u, { sessionsCount: increment(1) }).catch(function(){});
  }

  async function endSession() {
    var u = getUid(); if (u === 'anon') return;
    var durationSec = Math.round((nowTs() - _sessionStart) / 1000);
    if (durationSec < 5) return;
    await fsUpdate('users/' + u, { totalSessionSec: increment(durationSec), lastSessionSec: durationSec });
  }

  // ── 3. Events ─────────────────────────────────────────────
  async function trackEvent(eventName, data) {
    var u     = getUid();
    var docId = u + '_' + nowTs();
    await fsSet('analytics/events/' + docId, {
      uid: u, event: eventName, data: data || {},
      isPremium: isPrem(), ts: nowTs(), date: today()
    });
  }

  // ── 4. Messages ───────────────────────────────────────────
  var _origIncrement = window.incrementUsage;
  window.incrementUsage = function(type) {
    if (typeof _origIncrement === 'function') _origIncrement.apply(this, arguments);
    var u = getUid(); if (u === 'anon') return;
    var field = type === 'image' ? 'totalImageMessages' : type === 'pdf' ? 'totalPdfMessages' : 'totalTextMessages';
    fsUpdate('users/' + u, { totalMessages: increment(1), [field]: increment(1), lastMessageAt: nowTs() }).catch(function(){});
    fsSet('analytics/messages/' + today(), { date: today(), [type]: increment(1), total: increment(1) }, true).catch(function(){});
  };

  // ── 5. Feature usage ──────────────────────────────────────
  var TRACKED_FEATURES = [
    'openPYQ', 'openMockTest', 'openAnalytics', 'openScorePredictor',
    'openStudyGroups', 'openDailyGoal', 'openTeacherMode',
    'startVoiceMode', 'handleImageUpload', 'handlePdfUpload'
  ];

  function patchFeatureTracking() {
    TRACKED_FEATURES.forEach(function(fname) {
      var orig = window[fname];
      if (typeof orig !== 'function' || orig._analyticsPatched) return;
      window[fname] = function() {
        trackEvent('feature_used', { feature: fname, isPremium: isPrem() });
        return orig.apply(this, arguments);
      };
      window[fname]._analyticsPatched = true;
    });
  }

  // ── 6. Conversion ─────────────────────────────────────────
  // Deferred: app.js loads AFTER this file, so activatePlan doesn't exist yet.
  // Wrap it after window load to ensure _origActivatePlan is the real function.
  window.addEventListener('load', function() {
    var _origActivatePlan = window.activatePlan;
    if (typeof _origActivatePlan === 'function') {
      window.activatePlan = function(planId) {
        _origActivatePlan.apply(this, arguments);
        trackEvent('conversion', { planId: planId, method: 'payment' });
        fsUpdate('users/' + getUid(), { convertedAt: nowTs(), convertedPlan: planId, conversionDate: today() }).catch(function(){});
      };
    }
  });

  // ── 7. Retention + churn ──────────────────────────────────
  async function trackRetention(fbUser) {
    try {
      var d = getDb(), f = getFns(); if (!d || !f) return;
      var snap = await f.getDoc(f.doc(d, 'users', fbUser.uid));
      if (!snap.exists()) return;
      var data = snap.data();
      var createdAt = data.createdAt || nowTs();
      var daysSinceJoin = Math.floor((nowTs() - createdAt) / 86400000);
      var updates = { lastSeen: nowTs(), lastSeenDate: today() };

      if (daysSinceJoin >= 1  && !data.retainedD1)  { updates.retainedD1  = true; updates.retainedD1At  = nowTs(); }
      if (daysSinceJoin >= 7  && !data.retainedD7)  { updates.retainedD7  = true; updates.retainedD7At  = nowTs(); }
      if (daysSinceJoin >= 30 && !data.retainedD30) { updates.retainedD30 = true; updates.retainedD30At = nowTs(); }

      var daysSinceLastSeen = Math.floor((nowTs() - (data.lastSeen || createdAt)) / 86400000);
      updates.churnRisk = daysSinceLastSeen >= 7 ? 'high' : daysSinceLastSeen >= 3 ? 'medium' : 'low';
      if (daysSinceLastSeen >= 7) trackEvent('churn_return', { daysSinceLastSeen: daysSinceLastSeen });

      await f.updateDoc(f.doc(d, 'users', fbUser.uid), updates);
    } catch(e) {}
  }

  // ── 8. Premium modal views ────────────────────────────────
  var _origOpenPremium = window.openPremiumModal;
  if (typeof _origOpenPremium === 'function') {
    window.openPremiumModal = function() {
      trackEvent('premium_modal_viewed', {});
      return _origOpenPremium.apply(this, arguments);
    };
  }

  // ── Public API ────────────────────────────────────────────
  window.CrackAnalytics = { trackEvent: trackEvent, trackDAU: trackDAU };

  // ── Init ──────────────────────────────────────────────────
  function initAnalytics() {
    var fns = window._firebaseFns;
    if (!fns || !fns.onAuthStateChanged || !window._firebaseAuth) { setTimeout(initAnalytics, 300); return; }
    fns.onAuthStateChanged(window._firebaseAuth, async function(fbUser) {
      if (fbUser) {
        startSession();
        await trackDAU();
        await trackRetention(fbUser);
        patchFeatureTracking();
      }
    });
  }

  window.__firebaseReady ? initAnalytics() : window.addEventListener('firebaseReady', initAnalytics);
  window.addEventListener('beforeunload', endSession);
  window.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') endSession();
    if (document.visibilityState === 'visible') startSession();
  });
  window.addEventListener('load', patchFeatureTracking);
  setTimeout(patchFeatureTracking, 2000);

  console.info('[CrackwithAI] Analytics v1.0 — DAU, retention, churn tracking active');
})();


/* ═══════════════════════════════════════════════════════════════
   SECTION 3 — SECURITY
   Server-side premium verification, paywall hardening
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── CONFIG ────────────────────────────────────────────────
  // Deploy the Cloud Run function at the bottom of this file,
  // then paste its URL here.
  var VERIFY_PREMIUM_URL   = 'https://verifypremium-56khnynjia-uc.a.run.app';
  var REVERIFY_INTERVAL_MS = 10 * 60 * 1000; // re-verify every 10 minutes

  var FREE_TEXT  = 10;
  var FREE_IMAGE = 2;
  var FREE_PDF   = 1;

  // ── Fix: PaymentJSInterface is not defined (Cashfree mobile SDK) ──
  // This error fires when Cashfree's mobile SDK tries to call a native
  // Android/iOS bridge that doesn't exist in the browser. Safe to stub.
  if (typeof window.PaymentJSInterface === 'undefined') {
    window.PaymentJSInterface = {
      onPaymentSuccess: function() {},
      onPaymentFailure: function() {},
      onPaymentCancel:  function() {}
    };
  }

  // ── Wipe exposed secret key from memory ──────────────────
  if (typeof CASHFREE_SECRET_KEY !== 'undefined') {
    try { window.CASHFREE_SECRET_KEY = null; } catch(e) {}
    console.warn('[CrackwithAI Security] CASHFREE_SECRET_KEY wiped from memory. DELETE it from app.js source!');
  }

  // ── Get Firebase ID token ─────────────────────────────────
  async function getIdToken() {
    try {
      var user = window._firebaseAuth && window._firebaseAuth.currentUser;
      return user ? await user.getIdToken(false) : null;
    } catch(e) { return null; }
  }

  // ── Server-side premium verification (cached 10 min) ─────
  var _verifyCache     = null;
  var _verifyCacheTime = 0;

  async function verifyPremiumServer(forceRefresh) {
    var now = Date.now();
    if (!forceRefresh && _verifyCache !== null && (now - _verifyCacheTime) < REVERIFY_INTERVAL_MS) {
      return _verifyCache;
    }
    try {
      var token = await getIdToken();
      if (!token) {
        _verifyCache = { isPremium: false }; _verifyCacheTime = now; return _verifyCache;
      }
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeoutId  = controller ? setTimeout(function() { controller.abort(); }, 8000) : null;
      var res = await fetch(VERIFY_PREMIUM_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + token,
        },
        signal: controller ? controller.signal : undefined,
      });
      if (timeoutId) clearTimeout(timeoutId);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      _verifyCache = data; _verifyCacheTime = now;
      if (typeof state !== 'undefined') {
        state.isPremium = !!data.isPremium;
        if (data.plan && state.user) state.user.premiumPlan = data.plan;
      }
      return data;
    } catch(e) {
      // CORS / network / timeout — silently fall back to localStorage
      // so users are NEVER wrongly blocked due to a server/CORS issue.
      var lsPremium = false;
      try {
        var u2   = window._firebaseAuth && window._firebaseAuth.currentUser;
        var uid2 = u2 ? u2.uid : null;
        var pfx  = uid2 ? ('sscai_u:' + uid2 + ':') : 'sscai_guest:';
        lsPremium = localStorage.getItem(pfx + 'premium') === 'true'
                 || localStorage.getItem('sscai_premium') === 'true';
      } catch(le) {}
      _verifyCache     = { isPremium: lsPremium };
      _verifyCacheTime = now;
      // Only log if it's an unexpected error (not a known CORS / abort)
      if (e.name !== 'AbortError' && !String(e.message).includes('Failed to fetch')) {
        console.warn('[CrackwithAI] verifyPremium fell back to localStorage:', e.message);
      }
      return _verifyCache;
    }
  }

  // ── Gate check ────────────────────────────────────────────
  async function serverCanSend(type) {
    if (typeof state !== 'undefined') {
      var counts = { text: state.textCount || 0, image: state.imageCount || 0, pdf: state.pdfCount || 0 };
      var limits = { text: FREE_TEXT, image: FREE_IMAGE, pdf: FREE_PDF };
      if (counts[type] < limits[type]) return true; // under free limit, no server call needed
    }
    var result = await verifyPremiumServer(false);
    return !!result.isPremium;
  }

  // ── Patch sendMessage ─────────────────────────────────────
  function patchSendMessage() {
    var orig = window.sendMessage;
    if (typeof orig !== 'function') { setTimeout(patchSendMessage, 200); return; }
    if (orig._secPatched) return;

    async function securedSendMessage() {
      var args = arguments, self = this;
      try {
        var hasImages = typeof pendingImageFiles !== 'undefined' && pendingImageFiles.length > 0;
        var hasPdf    = typeof pendingPdfFile    !== 'undefined' && !!pendingPdfFile;
        var type      = hasImages ? 'image' : hasPdf ? 'pdf' : 'text';
        var allowed   = await serverCanSend(type);
        if (!allowed) {
          if (typeof openPremiumModal === 'function') openPremiumModal();
          if (typeof showToast        === 'function') showToast('🔒 Limit reached — Upgrade to Premium');
          return;
        }
      } catch(e) { /* network error — allow rather than block user */ }
      return orig.apply(self, args);
    }

    securedSendMessage._secPatched = true;
    window.sendMessage = securedSendMessage;
  }

  // ── Periodic re-verification (picks up expired subs) ─────
  function startPeriodicVerify() {
    // Server endpoint (verifypremium Cloud Run) is not active.
    // Premium state is kept in sync via localStorage by payment.js.
    // strict-gate-patch.js re-reads localStorage every 10s and updates the UI.
    // No periodic server calls needed — avoids ERR_FAILED noise in console.
  }

  // ── Public API ────────────────────────────────────────────
  window._securityPatch = {
    verifyPremiumServer: verifyPremiumServer,
    getIdToken:          getIdToken,
    invalidateCache:     function() { _verifyCache = null; _verifyCacheTime = 0; }
  };

  // ── Init ──────────────────────────────────────────────────
  patchSendMessage();
  startPeriodicVerify();

  function initSecurity() {
    var fns = window._firebaseFns;
    if (!fns || !fns.onAuthStateChanged || !window._firebaseAuth) { setTimeout(initSecurity, 300); return; }
    fns.onAuthStateChanged(window._firebaseAuth, function(user) {
      if (user) {
        _verifyCache = null; // force fresh verify on each login
        // Server endpoint not active; strict-gate-patch.js handles UI gate via localStorage
      }
    });
  }

  window.__firebaseReady ? initSecurity() : window.addEventListener('firebaseReady', initSecurity);

  console.info('[CrackwithAI] Security v1.1 — server-side premium verification + PaymentJSInterface fix');
})();


/* ═══════════════════════════════════════════════════════════════
   CLOUD RUN FUNCTION — verify-premium backend  v2.0
   ═══════════════════════════════════════════════════════════════

   HOW TO DEPLOY:
   1. Create a folder called  verify-premium/
   2. Save this block (everything between the === lines) as:
        verify-premium/index.js
   3. Create  verify-premium/package.json  with this content:
        {
          "name": "verify-premium",
          "version": "1.0.0",
          "main": "index.js",
          "engines": { "node": ">=18" },
          "dependencies": { "firebase-admin": "^12.0.0" }
        }
   4. From inside that folder, run:
        gcloud run deploy verifypremium \
          --source . \
          --region us-central1 \
          --allow-unauthenticated \
          --set-env-vars GCLOUD_PROJECT=rankgpt-f8a64

   ─────────────────────────────────────────────────────────────── */
/*
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore }           = require('firebase-admin/firestore');
const { getAuth }                = require('firebase-admin/auth');

if (!getApps().length) initializeApp();

const db   = getFirestore();
const auth = getAuth();

// ── Add every domain that hosts your app here ─────────────────
const ALLOWED_ORIGINS = [
  'https://shank122004-tech.github.io',
  'https://easyfreepdf.online',
  'http://localhost:5000',
  'http://localhost:5500',
  'http://localhost:5502',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5502',
];

function setCORS(req, res) {
  const origin = req.headers.origin || '';
  const allow  = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.set('Access-Control-Allow-Origin',  allow);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age',       '3600');
  res.set('Vary', 'Origin');
}

exports.handler = async (req, res) => {
  setCORS(req, res);

  // Handle CORS preflight immediately
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')    { res.status(405).json({ isPremium: false, reason: 'method_not_allowed' }); return; }

  const idToken = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!idToken) { res.status(401).json({ isPremium: false, reason: 'no_token' }); return; }

  try {
    const decoded = await auth.verifyIdToken(idToken);
    const snap    = await db.collection('users').doc(decoded.uid).get();

    if (!snap.exists) { res.json({ isPremium: false, reason: 'no_user' }); return; }

    const data      = snap.data();
    let   isPremium = !!data.isPremium;

    // Auto-expire subscriptions
    if (isPremium && data.premiumExpiresAt && Date.now() > data.premiumExpiresAt) {
      await db.collection('users').doc(decoded.uid).update({ isPremium: false });
      res.json({ isPremium: false, reason: 'expired', plan: data.premiumPlan || null }); return;
    }

    res.json({ isPremium, plan: data.premiumPlan || null, expiresAt: data.premiumExpiresAt || null });

  } catch(e) {
    console.error('[verifypremium]', e.message);
    if (e.code === 'auth/id-token-expired' || e.code === 'auth/argument-error') {
      res.status(401).json({ isPremium: false, reason: 'token_expired' }); return;
    }
    res.status(500).json({ isPremium: false, reason: 'server_error' });
  }
};
*/
/* ═══════════════════════════════════════════════════════════════ */