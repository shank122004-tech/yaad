/**
 * index.js — Cloud Functions entry point  v3.0
 *
 * CHANGES from v2.x:
 *  - Every request now requires a valid Firebase ID token  (Authorization: Bearer <token>)
 *  - isPremium is read from Firestore users/{uid}.isPremium + premiumExpiry  — never from client data
 *  - Free users are rate-limited via Firestore usage/{uid}/daily/{YYYY-MM-DD}
 *  - POST /api/validate-promo  — server-side promo code validation (code never in client JS)
 *  - GET  /api/status           — returns { isPremium, dailyRemaining } for the caller
 *  - verifyPayment now writes isPremium / premiumExpiry to Firestore on PAID status
 *
 * ROUTING LOGIC (unchanged):
 *   Real-time queries  → Gemini 2.5 Flash  (Google Search grounding)
 *   All other queries  → DeepSeek          (cheap + fast)
 *   Images / Vision    → geminiVision endpoint
 */

const cors      = require('cors')({
 origin: [
  'http://127.0.0.1:5502',
  'http://localhost:5502',
  'http://localhost:3000',
  'https://crackwithai.in',
  'https://www.crackwithai.in',
  'https://rankgpt-f8a64.web.app',
  'https://shank122004-tech.github.io',
  'https://rankgpt-f8a64.firebaseapp.com'
  
],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});
const { onRequest } = require('firebase-functions/v2/https');
const functions     = require('firebase-functions');
const admin         = require('firebase-admin');
const axios         = require('axios');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ─── Secure Error Handler ──────────────────────────────────────────────────────
function handleError(err, res, uid = null) {
  const isProduction = process.env.NODE_ENV === 'production';
  const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Log full error internally
  functions.logger.error(`[ERROR] ${errorId}`, {
    message: err.message,
    code: err.code,
    uid,
    status: err.status || 500,
    timestamp: new Date().toISOString()
  });
  
  // Return generic error to user (no stack trace)
  const status = err.status || 500;
  const message = isProduction 
    ? (err.status === 429 ? 'Too many requests' : 'An error occurred')
    : err.message;

  res.status(status).json({
    error: message,
    errorId: isProduction ? errorId : undefined,
    code: err.code || status
  });
}

// ─── API Keys ─────────────────────────────────────────────────────────────────
const DEEPSEEK_KEY = () => process.env.DEEPSEEK_API_KEY  || '';
const GEMINI_KEY   = () => process.env.GEMINI_API_KEY    || '';

// ─── Allowed DeepSeek models ──────────────────────────────────────────────────
const ALLOWED_MODELS = new Set([
  'deepseek-chat',      // V4 Flash — default, fast, cheap
  'deepseek-reasoner',  // V4 Flash thinking/CoT — pro mode
  'deepseek-v4-pro',    // V4 Pro flagship — paid addon ₹149/mo
]);

// ─── Usage limits ─────────────────────────────────────────────────────────────
const FREE_DAILY_MESSAGES = 7;   // total messages/day for free users

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getTextContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(p => p.type === 'text').map(p => p.text || '').join(' ');
  return String(content);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD  UTC
}

// ─── Firebase Config (served from backend, not exposed in frontend) ────────────
exports.config = onRequest((req, res) => {
  enforceHttps(req, res);
  cors(req, res, async () => {
    try {
      const firebaseConfig = {
        apiKey: process.env.FIREBASE_API_KEY || '',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.FIREBASE_APP_ID || '',
        measurementId: process.env.FIREBASE_MEASUREMENT_ID || ''
      };
      res.json(firebaseConfig);
    } catch (err) {
      handleError(err, res);
    }
  });
});

// ─── Auth middleware ──────────────────────────────────────────────────────────
/**
 * verifyToken(req)
 * Returns decoded token { uid, ... } or throws with HTTP-friendly message.
 */
// ─── HTTPS Enforcement ────────────────────────────────────────────────────────
function enforceHttps(req, res, next) {
  if (req.protocol === 'http' && process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return res.status(403).json({ error: 'HTTPS required' });
  }
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '1; mode=block');
  if (next) next();
}

// ─── Secure Error Handler ─────────────────────────────────────────────────────
function handleError(err, res, uid = null) {
  const isProduction = process.env.NODE_ENV === 'production';
  const errorId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Log full error securely (don't expose to user)
  functions.logger.error('[ERROR]', {
    errorId,
    uid,
    message: err.message,
    status: err.status || 500,
    code: err.code,
    stack: isProduction ? 'hidden' : err.stack
  });

  // Return generic error to user (don't expose stack trace)
  const status = err.status || 500;
  const message = isProduction 
    ? (err.status === 429 ? 'Too many requests' : 'An error occurred')
    : err.message;

  res.status(status).json({
    error: message,
    errorId: isProduction ? errorId : undefined,
    code: err.code || status
  });
}

// ─── Verify Token ─────────────────────────────────────────────────────────────
async function verifyToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) throw { status: 401, message: 'Missing Authorization header' };
  const idToken = auth.slice(7);
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!decoded.uid) throw new Error('Invalid token structure');
    if (decoded.exp * 1000 < Date.now()) throw new Error('Token expired');
    return decoded;
  } catch (e) {
    throw { status: 401, message: 'Invalid or expired token' };
  }
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────
async function checkRateLimit(uid, endpoint, limit = 100) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const docRef = db.collection('usage').doc(uid).collection('endpoints').doc(`${endpoint}_${today}`);
    const doc = await docRef.get();
    const count = doc.exists ? (doc.data().count || 0) : 0;
    if (count >= limit) return false;
    await docRef.set({ count: count + 1, updated: Date.now() }, { merge: true });
    return true;
  } catch (e) {
    functions.logger.error('[rateLimit] error', { uid, endpoint, err: e.message });
    return true;
  }
}

// ─── Input Validation ─────────────────────────────────────────────────────────
function validateInput(input, type = 'text') {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (type === 'text' && trimmed.length > 50000) throw new Error('Input too long');
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw new Error('Invalid email');
  if (type === 'prompt' && trimmed.length > 10000) throw new Error('Prompt too long');
  if (typeof input === 'string') {
    if (input.includes('<script') || input.includes('javascript:')) throw new Error('Invalid input');
  }
  return trimmed;
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/[<>\"']/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;'
  }[c] || c));
}

// ─── Premium check ────────────────────────────────────────────────────────────
/**
 * getPremiumStatus(uid)
 * Returns { isPremium: boolean } — reads from Firestore users/{uid}.
 * A user is premium only when BOTH flags are true:
 *   • isPremium === true
 *   • premiumExpiry > Date.now()  (or premiumExpiry is absent, treated as lifetime)
 */
async function getPremiumStatus(uid) {
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return { isPremium: false };
    const data = snap.data();
    if (!data.isPremium) return { isPremium: false };
    // If an expiry is set, enforce it
    if (data.premiumExpiry && data.premiumExpiry < Date.now()) {
      // Lazy-expire: clear the flag so next read is fast
      db.collection('users').doc(uid).update({ isPremium: false }).catch(() => {});
      return { isPremium: false };
    }
    return { isPremium: true };
  } catch (e) {
    functions.logger.warn('[getPremiumStatus] error', { uid, err: e.message });
    return { isPremium: false };
  }
}

// ─── Daily usage counter (free users only) ────────────────────────────────────
/**
 * checkAndIncrementUsage(uid)
 * Returns { allowed: boolean, remaining: number }
 * Uses Firestore transaction to atomically increment and check.
 */
async function checkAndIncrementUsage(uid) {
  const date    = todayKey();
  const docRef  = db.collection('usage').doc(uid).collection('daily').doc(date);

  try {
    let allowed = false;
    let remaining = 0;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const count = snap.exists ? (snap.data().count || 0) : 0;

      if (count < FREE_DAILY_MESSAGES) {
        tx.set(docRef, { count: count + 1, updatedAt: Date.now() }, { merge: true });
        remaining = FREE_DAILY_MESSAGES - count - 1;
        allowed   = true;
      } else {
        remaining = 0;
        allowed   = false;
      }
    });

    return { allowed, remaining };
  } catch (e) {
    functions.logger.warn('[checkAndIncrementUsage] error', { uid, err: e.message });
    // Fail open — don't block the user if Firestore hiccups
    return { allowed: true, remaining: FREE_DAILY_MESSAGES };
  }
}

// ─── Real-time detection ──────────────────────────────────────────────────────
const REALTIME_PATTERNS = [
  /who is (the )?(current |new |present )?/i,
  /who (is|are|was|were) .*(president|pm|prime minister|ceo|minister|chief|head|leader|governor|mayor|chairman)/i,
  /president of/i,
  /prime minister of/i,
  /(current|latest|recent|new|today|now|2025|2026).*(president|pm|minister|ceo|winner|champion|rank|result|score|rate|price)/i,
  /(price|rate|value) of (gold|silver|petrol|diesel|dollar|usd|bitcoin|share|stock)/i,
  /latest (news|update|result|match|score|notification)/i,
  /who won/i,
  /election result/i,
  /ipl|world cup|olympic|cricket score|football score|match result/i,
  /today.*(weather|news|rate|price)/i,
  /current (affairs|news|events|rate|price|government)/i,
  /admit card|answer key|result date|exam date|cutoff.*2025|cutoff.*2026/i,
  /vacancy.*2025|vacancy.*2026|notification.*2025|notification.*2026/i,
];

const REALTIME_KEYWORDS = [
  'who is','who are','current president','current pm','current ceo',
  'latest news','recent news','today news','breaking news',
  'live score','match score','ipl score','cricket score',
  'gold price','silver price','petrol price','diesel price',
  'stock price','share price','bitcoin price','dollar rate',
  'election result','election 2026','election 2025',
  'current affairs 2026','current affairs 2025',
  'admit card 2026','answer key 2026','result date 2026',
  'ssc result','upsc result','ibps result','rrb result',
];

function isRealTimeQuery(text) {
  const lower = text.toLowerCase();
  if (REALTIME_PATTERNS.some(p => p.test(lower))) return true;
  if (REALTIME_KEYWORDS.some(k => lower.includes(k))) return true;
  return false;
}

// ─── Gemini real-time ─────────────────────────────────────────────────────────
async function callGeminiRealTime(userQuestion, systemContext) {
  const GEMINI_MODEL = 'gemini-2.5-flash';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY()}`;

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata',
  });

  const prompt = `Today is ${today}.\n\n${systemContext ? `Context: ${systemContext.substring(0, 300)}\n\n` : ''}User question: ${userQuestion}\n\nAnswer using the most current information available. Be accurate, concise and helpful. If this is a current affairs / GK question relevant to Indian exams (SSC/UPSC/IBPS), also mention why it's important for exams.`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 800, temperature: 0.3 },
  };

  const response = await axios.post(geminiUrl, requestBody, {
    timeout: 20000,
    headers: { 'Content-Type': 'application/json' },
  });

  return response.data?.candidates?.[0]?.content?.parts
    ?.filter(p => p.text)?.map(p => p.text)?.join('') || '';
}

// ─── Cleanup scheduled job (unchanged) ───────────────────────────────────────
exports.cleanupExpiredPendingBookings = functions
  .pubsub.schedule('every 30 minutes')
  .onRun(async () => {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    functions.logger.info(`🧹 Cleaning up pending bookings older than ${cutoff.toISOString()}`);
    const expiredSnap = await db.collection('pending_bookings')
      .where('createdAt', '<', cutoff)
      .where('status', '==', 'pending_payment')
      .get();
    if (expiredSnap.empty) { functions.logger.info('No expired pending bookings found'); return null; }
    const batch = db.batch();
    for (const doc of expiredSnap.docs) {
      const pending = doc.data();
      batch.delete(doc.ref);
      try {
        const [startTime] = pending.slotTime.split('-');
        const slotSnap = await db.collection('slots')
          .where('groundId',    '==', pending.groundId)
          .where('date',        '==', pending.date)
          .where('startTime',   '==', startTime.trim())
          .where('lockOrderId', '==', doc.id)
          .limit(1).get();
        if (!slotSnap.empty) {
          batch.update(slotSnap.docs[0].ref, {
            status: 'available', lockOrderId: null, lockExpiresAt: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (e) {
        functions.logger.warn(`Could not release slot for ${doc.id}:`, e.message);
      }
    }
    await batch.commit();
    functions.logger.info(`✅ Cleaned up ${expiredSnap.size} expired pending bookings`);
    return null;
  });

// ─── GET /api/status ──────────────────────────────────────────────────────────
// Returns { isPremium, dailyRemaining } for the authenticated caller.
// Called by strict-gate-patch.js every 60 s as the authoritative premium check.
exports.status = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    try {
      const decoded     = await verifyToken(req);
      const { isPremium } = await getPremiumStatus(decoded.uid);

      let dailyRemaining = null;
      if (!isPremium) {
        const date   = todayKey();
        const snap   = await db.collection('usage').doc(decoded.uid)
                               .collection('daily').doc(date).get();
        const count  = snap.exists ? (snap.data().count || 0) : 0;
        dailyRemaining = Math.max(0, FREE_DAILY_MESSAGES - count);
      }

      return res.json({ isPremium, dailyRemaining });
    } catch (e) {
      return handleError(e, res, 'status');
    }
  });
});

// ─── POST /api/validate-promo ─────────────────────────────────────────────────
// Validates a battle promo code entirely server-side.
// The code is stored in the BATTLE_PROMO_CODE environment variable — never in
// any client-side JS.  Returns { valid: true/false }.
exports.validatePromo = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    try {
      const decoded = await verifyToken(req);

      const { code } = req.body;
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ valid: false, error: 'code is required' });
      }

      const serverCode = process.env.BATTLE_PROMO_CODE || '';
      if (!serverCode) {
        functions.logger.warn('[validatePromo] BATTLE_PROMO_CODE env var not set');
        return res.json({ valid: false });
      }

      const valid = code.trim().toUpperCase() === serverCode.trim().toUpperCase();

      if (valid) {
        // Record that this UID used the promo so they can't spam it
        await db.collection('users').doc(decoded.uid).set(
          { battlePromoUsed: true, battlePromoUsedAt: Date.now() },
          { merge: true }
        );
        functions.logger.info('[validatePromo] valid redemption', { uid: decoded.uid });
      } else {
        functions.logger.info('[validatePromo] invalid attempt', { uid: decoded.uid });
      }

      return res.json({ valid });
    } catch (e) {
      return handleError(e, res, 'validatePromo');
    }
  });
});

// ─── geminiVision ─────────────────────────────────────────────────────────────
exports.geminiVision = onRequest((req, res) => {
  enforceHttps(req, res);
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    try {
      // ── Auth ──
      const decoded = await verifyToken(req);
      
      // ── Rate Limiting ──
      const rateLimited = await checkRateLimit(decoded.uid, 'gemini', 500);
      if (!rateLimited) return res.status(429).json({ error: 'Too many requests' });

      // ── Input Validation ──
      try {
        if (req.body.prompt) req.body.prompt = validateInput(req.body.prompt, 'text');
        req.body.prompt = sanitizeInput(req.body.prompt || '');
      } catch (validErr) {
        return res.status(400).json({ error: validErr.message });
      }

      const { isPremium } = await getPremiumStatus(decoded.uid);

      if (!isPremium) {
        const { allowed } = await checkAndIncrementUsage(decoded.uid);
        if (!allowed) return res.status(429).json({ error: 'Daily limit reached', code: 'LIMIT_HIT', type: 'image' });
      }

      const key = GEMINI_KEY();
      if (!key) {
        functions.logger.error('[geminiVision] GEMINI_API_KEY env var is not set');
        return res.status(500).json({ error: 'Vision service not configured. Set GEMINI_API_KEY env var.' });
      }

      const GEMINI_MODEL = 'gemini-2.5-flash';
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

      const requestBody = {
        contents: req.body.contents || [{
          parts: [{ text: req.body.message || 'Describe this image in detail.' }],
        }],
        generationConfig: req.body.generationConfig || { maxOutputTokens: 1500, temperature: 0.4 },
      };

      const response = await axios.post(geminiUrl, requestBody, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' },
      });

      const parts = response.data?.candidates?.[0]?.content?.parts || [];
      const text = parts.filter(p => p.text).map(p => p.text).join('\n') || '';

      functions.logger.info('[geminiVision] OK', { chars: text.length });
      res.json({ text });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      const geminiMsg = e.response?.data?.error?.message || e.message;
      functions.logger.error('[geminiVision] FAILED', { message: geminiMsg });
      res.status(e.response?.status || 500).json({ error: geminiMsg });
    }
  });
});

// ─── deepseek — main AI endpoint ──────────────────────────────────────────────
exports.deepseek = onRequest((req, res) => {
  enforceHttps(req, res);
  cors(req, res, async () => {
    try {
      // ── 1. Auth ──────────────────────────────────────────────────────────────
      const decoded = await verifyToken(req);
      const uid     = decoded.uid;

      // ── 1.5. Rate Limiting ───────────────────────────────────────────────────
      const rateLimited = await checkRateLimit(uid, 'deepseek', 1000);
      if (!rateLimited) return res.status(429).json({ error: 'Too many requests' });

      // ── 1.75. Input Validation ──────────────────────────────────────────────
      try {
        if (req.body.prompt) req.body.prompt = validateInput(req.body.prompt, 'prompt');
        if (req.body.userQuestion) req.body.userQuestion = validateInput(req.body.userQuestion, 'text');
        req.body.prompt = sanitizeInput(req.body.prompt || '');
      } catch (validErr) {
        return res.status(400).json({ error: validErr.message });
      }

      // ── 2. Premium / usage gate ───────────────────────────────────────────────
      const { isPremium } = await getPremiumStatus(uid);

      if (!isPremium) {
        const { allowed, remaining } = await checkAndIncrementUsage(uid);
        if (!allowed) {
          const type = (req.body.isVision || (req.body.images && req.body.images.length > 0)) ? 'image'
                     : (req.body.isPdf ? 'pdf' : 'text');
          return res.status(429).json({
            error: 'Daily limit reached',
            code: 'LIMIT_HIT',
            type,
            remaining: 0,
          });
        }
        // Pass remaining back so client can update UI without a separate /api/status call
        res.setHeader('X-Daily-Remaining', String(remaining));
      }

      // ── 3. Request handling (identical to v2.x) ───────────────────────────────
      const isPdf    = req.body.isPdf    || false;
      const isVision = req.body.isVision || false;

      const requestedModel = req.body.model || 'deepseek-chat';
      const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : 'deepseek-chat';

      let messages  = req.body.messages || [];
      const systemMsg  = messages.find(m => m.role === 'system');
      const lastUser   = [...messages].reverse().find(m => m.role === 'user');
      const userText   = getTextContent(lastUser?.content || '').trim();
      const systemText = getTextContent(systemMsg?.content || '').trim();

      if (!userText) return res.status(400).json({ error: 'No user message found' });

      // PDF path
      if (isPdf && req.body.pdfBase64) {
        try {
          const pdfParse  = require('pdf-parse');
          const pdfBuffer = Buffer.from(req.body.pdfBase64, 'base64');
          const pdfData   = await pdfParse(pdfBuffer);
          const extracted = (pdfData.text || '').substring(0, 10000);
          const questionMatch = userText.match(/then answer:\s*([\s\S]+)$/i);
          const userQuestion  = questionMatch ? questionMatch[1].trim() : userText.replace(/\[PDF.*?\]/g, '').trim();

          const pdfMessages = [
            { role: 'system', content: systemText || 'You are a helpful AI exam assistant.' },
            { role: 'user',   content: `[PDF — ${pdfData.numpages} pages]\n\n${extracted}\n\n---\nQuestion: ${userQuestion}` },
          ];
          const response = await axios.post(
            'https://api.deepseek.com/chat/completions',
            { model, messages: pdfMessages, max_tokens: 800, temperature: 0.7 },
            { headers: { Authorization: `Bearer ${DEEPSEEK_KEY()}` }, timeout: 45000 }
          );
          return res.json(response.data);
        } catch (pdfErr) {
          functions.logger.warn('[PDF parse skipped]', pdfErr.message);
        }
      }

      // Vision path
      if (isVision && req.body.images && Array.isArray(req.body.images) && req.body.images.length > 0) {
        const key = GEMINI_KEY();
        if (!key) return res.status(500).json({ error: 'Vision service not configured. Set GEMINI_API_KEY env var.' });

        const imageParts = req.body.images.map(img => ({
          inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.data },
        }));
        imageParts.push({
          text: userText || 'Read this image carefully. Identify every question, diagram, or text visible. Provide a complete step-by-step solution.',
        });

        const geminiUrl  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
        const geminiBody = {
          contents: [{ parts: imageParts }],
          systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
          generationConfig: { maxOutputTokens: 1500, temperature: 0.4 },
        };

        const geminiRes = await axios.post(geminiUrl, geminiBody, {
          timeout: 45000, headers: { 'Content-Type': 'application/json' },
        });

        const parts = geminiRes.data?.candidates?.[0]?.content?.parts || [];
        const text  = parts.filter(p => p.text).map(p => p.text).join('\n') || '';
        functions.logger.info('[vision] Gemini OK', { chars: text.length });

        return res.json({
          choices: [{ message: { content: text }, finish_reason: 'stop' }],
          _source: 'gemini-2.5-flash-vision',
        });
      }

      // Vision text-only fallback
      if (isVision) {
        const visionMessages = [
          { role: 'system', content: systemText || 'You are a helpful AI exam assistant.' },
          { role: 'user',   content: userText },
        ];
        const response = await axios.post(
          'https://api.deepseek.com/chat/completions',
          { model, messages: visionMessages, max_tokens: 800, temperature: 0.7 },
          { headers: { Authorization: `Bearer ${DEEPSEEK_KEY()}` }, timeout: 45000 }
        );
        return res.json(response.data);
      }

      // Real-time → Gemini
      if (isRealTimeQuery(userText)) {
        functions.logger.info('[router] Real-time → Gemini:', userText.substring(0, 80));
        try {
          const geminiAnswer = await callGeminiRealTime(userText, systemText);
          if (geminiAnswer) {
            return res.json({
              choices: [{ message: { content: geminiAnswer }, finish_reason: 'stop' }],
              _source: 'gemini-2.5-flash',
            });
          }
        } catch (geminiErr) {
          functions.logger.warn('[Gemini real-time failed, falling back to DeepSeek]', geminiErr.message);
        }
      }

      // Standard → DeepSeek
      functions.logger.info('[router] Standard → DeepSeek:', userText.substring(0, 80));
      const today = new Date().toLocaleDateString('en-IN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata',
      });

      const deepseekMessages = [
        { role: 'system', content: `Today is ${today}.\n\n${systemText || 'You are a helpful AI exam assistant for Indian students.'}` },
        { role: 'user',   content: userText },
      ];

      const maxTok = req.body.max_tokens || 600;
      const response = await axios.post(
        'https://api.deepseek.com/chat/completions',
        { model, messages: deepseekMessages, max_tokens: maxTok, temperature: 0.7 },
        { headers: { Authorization: `Bearer ${DEEPSEEK_KEY()}` }, timeout: 45000 }
      );
      return res.json(response.data);

    } catch (err) {
      const dsErr = err.response?.data?.error;
      const dsStatus = err.response?.status;
      const isQuotaExhausted =
        dsStatus === 402 ||
        dsStatus === 429 ||
        /insufficient|quota|balance|credit/i.test(dsErr?.message || dsErr?.code || err.message || '');

      if (isQuotaExhausted) {
        return res.status(503).json({
          error: 'AI service temporarily unavailable',
          code: 'MAINTENANCE'
        });
      }

      handleError(err, res, (await verifyToken(req).catch(() => null))?.uid);
    }
  });
});

// ─── createCashfreeOrder ──────────────────────────────────────────────────────
const CF_APP_ID     = () => process.env.CASHFREE_APP_ID     || '';
const CF_SECRET_KEY = () => process.env.CASHFREE_SECRET_KEY || '';
const CF_API        = process.env.CASHFREE_ENV === 'sandbox'
  ? 'https://sandbox.cashfree.com/pg'
  : 'https://api.cashfree.com/pg';

exports.createCashfreeOrder = onRequest((req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization'); enforceHttps(req, res); cors(req, res, async () => { if (req.method === 'OPTIONS') { return res.status(204).send(''); }
    try {
      // Auth: must be a logged-in user to create an order
      const decoded = await verifyToken(req);

      // Rate Limiting
      const rateLimited = await checkRateLimit(decoded.uid, 'cashfree', 50);
      if (!rateLimited) return res.status(429).json({ error: 'Too many requests' });

      // Input Validation
      try {
        if (req.body.planId) req.body.planId = validateInput(req.body.planId, 'text');
        if (typeof req.body.amount !== 'number' || req.body.amount < 0) throw new Error('Invalid amount');
      } catch (validErr) {
        return res.status(400).json({ error: validErr.message });
      }

      const {
        order_id, amount, plan, currency = 'INR',
        customer_id, customer_name, customer_email,
        customer_phone = '9999999999', order_note,
        uid, name, email,
      } = req.body;

      if (!amount) return res.status(400).json({ error: 'amount is required' });

      // Always use the UID from the verified token — never trust client-provided uid
      const verifiedUid = decoded.uid;
      const orderId   = order_id  || `plan_${plan}_${verifiedUid}_${Date.now()}`;
      const custId    = customer_id || verifiedUid;
      const custName  = customer_name || name  || 'Student';
      const custEmail = customer_email || email || 'student@crackai.in';

      functions.logger.info('[createCashfreeOrder] creating', { orderId, amount, plan, uid: verifiedUid });

      const cfRes = await axios.post(`${CF_API}/orders`, {
        order_id:       orderId,
        order_amount:   Number(amount),
        order_currency: currency,
        order_note:     order_note || plan || orderId,
        customer_details: {
          customer_id:    custId,
          customer_name:  custName,
          customer_email: custEmail,
          customer_phone: String(customer_phone),
        },
      }, {
        headers: {
          'Content-Type':    'application/json',
          'x-api-version':   '2023-08-01',
          'x-client-id':     CF_APP_ID(),
          'x-client-secret': CF_SECRET_KEY(),
        },
        timeout: 15000,
      });

      functions.logger.info('[createCashfreeOrder] OK', { orderId });
      return res.json({
        payment_session_id: cfRes.data.payment_session_id,
        order_id:           cfRes.data.order_id || orderId,
        order_status:       cfRes.data.order_status,
      });

    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      const cfErr = err.response?.data;
      functions.logger.error('[createCashfreeOrder] FAILED', cfErr || err.message);
      return res.status(err.response?.status || 500).json({ error: cfErr?.message || err.message });
    }
  });
});

// ─── verifyPayment ────────────────────────────────────────────────────────────
// On PAID status this function writes isPremium + premiumExpiry to
// Firestore users/{uid} so the client can never fake a premium upgrade.

const PLAN_EXPIRY_MS = {
  semiannual:     183 * 24 * 60 * 60 * 1000,
  yearly:         365 * 24 * 60 * 60 * 1000,
  class10_yearly: 365 * 24 * 60 * 60 * 1000,
  // All monthly plans: 32 days (small buffer for late renewals)
  _default:        32 * 24 * 60 * 60 * 1000,
};

function expiryForPlan(planId) {
  const ms = PLAN_EXPIRY_MS[planId] || PLAN_EXPIRY_MS._default;
  return Date.now() + ms;
}

exports.verifyPayment = onRequest((req, res) => {
  enforceHttps(req, res);
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    try {
      const decoded = await verifyToken(req);
      const uid     = decoded.uid;

      // Rate Limiting
      const rateLimited = await checkRateLimit(uid, 'verify-payment', 100);
      if (!rateLimited) return res.status(429).json({ error: 'Too many requests' });

      // Input Validation
      try {
        if (req.body.order_id) req.body.order_id = validateInput(req.body.order_id, 'text');
        if (req.body.plan) req.body.plan = validateInput(req.body.plan, 'text');
      } catch (validErr) {
        return res.status(400).json({ error: validErr.message });
      }

      const { order_id, plan } = req.body;
      if (!order_id) return res.status(400).json({ error: 'order_id required' });

      const cfRes = await axios.get(`${CF_API}/orders/${order_id}`, {
        headers: {
          'x-api-version':   '2023-08-01',
          'x-client-id':     CF_APP_ID(),
          'x-client-secret': CF_SECRET_KEY(),
        },
        timeout: 10000,
      });

      const status = cfRes.data?.order_status;
      functions.logger.info('[verifyPayment]', { order_id, status, uid });

      if (status === 'PAID' && plan) {
        // ── Write premium to Firestore — this is the ONLY place it is written ──
        const expiry = expiryForPlan(plan);
        const updateData = {
          isPremium:          true,
          premiumPlan:        plan,
          premiumExpiry:      expiry,
          premiumActivatedAt: Date.now(),
          updatedAt:          Date.now(),
        };

        // Extra plan-specific fields
        if (groupPlans.includes(plan)) {
          updateData.isGroupAdmin  = true;
          updateData.groupPlan     = plan;
        }
        const battlePlans = { battle: 5, battle_pro: 19, battle_academy: 29 };
        if (battlePlans[plan] !== undefined) {
          updateData.battleTier       = plan;
          updateData.battleMonthlyMax = battlePlans[plan];
        }

        await db.collection('users').doc(uid).set(updateData, { merge: true });
        functions.logger.info('[verifyPayment] premium written to Firestore', { uid, plan, expiry });
      }

      return res.json({ status });

    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      functions.logger.error('[verifyPayment] FAILED', err.response?.data || err.message);
      return res.status(500).json({ error: err.message });
    }
  });
});