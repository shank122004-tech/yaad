'use strict';

// ─── Environment Detection (Browser only) ────────────────────────────────────
const isDev = window.location.hostname === 'localhost' || 
              window.location.hostname === '127.0.0.1' ||
              window.location.hostname.includes('github.io');

// Save native console immediately
const _nativeConsole = window.console;

// ─── Secure Logger (no sensitive data in console) ────────────────────────────
const SecureLogger = {
  log(msg, data) {
    if (isDev && _nativeConsole) _nativeConsole.log(msg);
  },
  warn(msg, data) {
    if (isDev && _nativeConsole) _nativeConsole.warn(msg);
  },
  error(msg, data) {
    if (isDev && _nativeConsole) _nativeConsole.error(msg);
  },
  info(msg) {
    if (isDev && _nativeConsole) _nativeConsole.info(msg);
  }
};

// Expose to window
window.SecureLogger = SecureLogger;

// ─── Disable console in production ────────────────────────────────────────────
if (!isDev) {
  window.console = {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    assert: () => {},
    clear: () => {},
    count: () => {},
    group: () => {},
    groupEnd: () => {},
    table: () => {},
    time: () => {},
    timeEnd: () => {},
    dir: () => {},
    dirxml: () => {}
  };
}

// ─── PROFESSIONAL CACHING SYSTEM (Firebase & DeepSeek Cost Optimization) ───────
const CacheManager = {
  // Cache configuration
  config: {
    aiResponseTTL: 30 * 24 * 60 * 60 * 1000, // 30 days for AI responses
    userDataTTL: 24 * 60 * 60 * 1000, // 24 hours for user data
    imageDataTTL: 7 * 24 * 60 * 60 * 1000, // 7 days for images
    pdfDataTTL: 7 * 24 * 60 * 60 * 1000, // 7 days for PDFs
    firebaseQueryTTL: 60 * 60 * 1000, // 1 hour for Firebase queries
    maxCacheSize: 50 * 1024 * 1024, // 50MB limit
    maxResponses: 500 // Max cached responses
  },

  // Request deduplication — prevents simultaneous requests for same data
  pendingRequests: {},

  // Initialize caching system
  init() {
    this.setupGlobalCache();
    this.setupPeriodicCleanup();
  },

  setupGlobalCache() {
    const globalCacheKey = 'crackai_global_cache_v2';
    try {
      const existing = localStorage.getItem(globalCacheKey);
      if (!existing) {
        localStorage.setItem(globalCacheKey, JSON.stringify({
          responses: {},
          userData: {},
          images: {},
          pdfs: {},
          firebaseQueries: {},
          createdAt: Date.now(),
          version: 2
        }));
      }
    } catch (e) {
      SecureLogger.warn('[Cache Init Failed]', e.message);
    }
  },

  // Get from global cache
  get(key, cacheType = 'responses') {
    try {
      const globalCache = this.getGlobalCache();
      if (!globalCache || !globalCache[cacheType]) return null;
      
      const entry = globalCache[cacheType][key];
      if (!entry) return null;
      
      // Check TTL
      const ttl = this.config[cacheType + 'TTL'] || this.config.aiResponseTTL;
      if (Date.now() - entry.timestamp > ttl) {
        delete globalCache[cacheType][key];
        this.saveGlobalCache(globalCache);
        return null;
      }
      
      return entry.data;
    } catch (e) {
      return null;
    }
  },

  // Set in global cache
  set(key, data, cacheType = 'responses') {
    try {
      const globalCache = this.getGlobalCache();
      if (!globalCache) return false;

      // Size check before adding
      const dataSize = JSON.stringify(data).length;
      if (dataSize > 1024 * 100) { // Skip very large entries (>100KB)
        return false;
      }

      globalCache[cacheType][key] = {
        data: data,
        timestamp: Date.now()
      };

      // Cleanup if too many entries
      const keys = Object.keys(globalCache[cacheType]);
      if (keys.length > this.config.maxResponses) {
        const sorted = keys.sort((a, b) => 
          globalCache[cacheType][a].timestamp - globalCache[cacheType][b].timestamp
        );
        sorted.slice(0, Math.floor(this.config.maxResponses * 0.1)).forEach(k => {
          delete globalCache[cacheType][k];
        });
      }

      this.saveGlobalCache(globalCache);
      return true;
    } catch (e) {
      return false;
    }
  },

  getGlobalCache() {
    try {
      return JSON.parse(localStorage.getItem('crackai_global_cache_v2') || '{}');
    } catch (e) {
      return null;
    }
  },

  saveGlobalCache(cache) {
    try {
      localStorage.setItem('crackai_global_cache_v2', JSON.stringify(cache));
    } catch (e) {
      SecureLogger.warn('[Cache Save Failed]', e.message);
    }
  },

  // Request deduplication — return promise of pending request if exists
  async getOrWait(key, asyncFn, cacheType = 'responses') {
    const pendingKey = cacheType + ':' + key;
    
    // Return cached result if available
    const cached = this.get(key, cacheType);
    if (cached !== null) return cached;
    
    // If request already pending, wait for it
    if (this.pendingRequests[pendingKey]) {
      return this.pendingRequests[pendingKey];
    }
    
    // Otherwise, start new request and store promise
    this.pendingRequests[pendingKey] = asyncFn()
      .then(result => {
        this.set(key, result, cacheType);
        delete this.pendingRequests[pendingKey];
        return result;
      })
      .catch(err => {
        delete this.pendingRequests[pendingKey];
        throw err;
      });
    
    return this.pendingRequests[pendingKey];
  },

  // Generate deterministic hash for request deduplication
  hashRequest(text, lang = 'en', mode = 'default', shortMode = false) {
    const str = `${text}:${lang}:${mode}:${shortMode}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'ai_' + Math.abs(hash).toString(36);
  },

  // Hash image/PDF data for deduplication
  async hashData(base64Data) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(base64Data.substring(0, 1000)); // Use first 1000 chars
      const hashBuffer = await crypto.subtle.digest('SHA-1', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return 'data_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      return 'data_' + Math.random().toString(36).substring(7);
    }
  },

  // Clear expired entries periodically
  setupPeriodicCleanup() {
    setInterval(() => {
      try {
        const globalCache = this.getGlobalCache();
        if (!globalCache) return;

        let cleaned = false;
        ['responses', 'userData', 'images', 'pdfs', 'firebaseQueries'].forEach(type => {
          if (!globalCache[type]) return;
          
          const ttl = this.config[type + 'TTL'] || this.config.aiResponseTTL;
          Object.keys(globalCache[type]).forEach(key => {
            if (Date.now() - globalCache[type][key].timestamp > ttl) {
              delete globalCache[type][key];
              cleaned = true;
            }
          });
        });

        if (cleaned) {
          this.saveGlobalCache(globalCache);
        }
      } catch (e) {
        // Silently fail
      }
    }, 60 * 60 * 1000); // Run every hour
  },

  // Get cache statistics
  getStats() {
    try {
      const cache = this.getGlobalCache();
      if (!cache) return null;

      return {
        responses: Object.keys(cache.responses || {}).length,
        userData: Object.keys(cache.userData || {}).length,
        images: Object.keys(cache.images || {}).length,
        pdfs: Object.keys(cache.pdfs || {}).length,
        firebaseQueries: Object.keys(cache.firebaseQueries || {}).length,
        estimatedSavings: {
          deepseekAPICalls: Object.keys(cache.responses || {}).length * 0.0015, // ~$0.0015 per call
          firebaseReads: Object.keys(cache.userData || {}).length * 0.06, // ~$0.06 per read
          total: (Object.keys(cache.responses || {}).length * 0.0015) + (Object.keys(cache.userData || {}).length * 0.06)
        }
      };
    } catch (e) {
      return null;
    }
  },

  // Clear specific cache type
  clearType(cacheType) {
    try {
      const cache = this.getGlobalCache();
      if (!cache || !cache[cacheType]) return false;
      cache[cacheType] = {};
      this.saveGlobalCache(cache);
      return true;
    } catch (e) {
      return false;
    }
  },

  // Clear all cache
  clearAll() {
    try {
      localStorage.removeItem('crackai_global_cache_v2');
      this.setupGlobalCache();
      return true;
    } catch (e) {
      return false;
    }
  }
};

// Initialize caching system on load
CacheManager.init();
window.CacheManager = CacheManager;



const FREE_TEXT_LIMIT = 3;
const FREE_IMAGE_LIMIT = 5;
const FREE_PDF_LIMIT = 2;
const PREMIUM_PRICE = 199;
const PREMIUM_CLASS10_PRICE = 129;
const PREMIUM_CLASS12_PRICE = 129;

const ADDON_PLAN_V4PRO = 'v4pro_addon';
const ADDON_PRICE_V4PRO = 149;
const ADDON_PRICE = 49;
const ADDON_PLAN_VISIONPRO = 'vision_pro_addon';
const ADDON_PLAN_PREPAIPRO = 'prepaipro_addon';
const ADDON_PLAN_COMPANION = 'companion_addon';

window._selectedDeepSeekModel = 'deepseek-chat';

const DEEPSEEK_MODEL = 'deepseek-chat';
const DEEPSEEK_MODEL_MAP = {
  smart: 'deepseek-chat',
  flash: 'deepseek-chat',
  pro: 'deepseek-chat',
  vision: 'deepseek-chat',
  'vision-pro': 'deepseek-chat',
  'voice-text': 'deepseek-chat',
  voice: 'deepseek-chat',
  teacher: 'deepseek-chat',
  'v4-pro': 'deepseek-chat'
};

function getDeepSeekModel() {
  return window._selectedDeepSeekModel || 'deepseek-chat';
}

const TEACHER_AD_REWARD_KEY = 'crackwith_teacher_ad_reward';
const TEACHER_AD_REWARD_DURATION_MS = 30 * 60 * 1000;
const TEACHER_AD_MAX_QUESTIONS = 15;
const TEACHER_ADS_REQUIRED = 5;
const REWARD_DURATION_MS = 60 * 60 * 1000;
const REWARD_CHAT_BONUS = 9999;
const REWARD_UPLOAD_BONUS = 15;
const LS_REWARD_KEY = 'sscai_reward_unlock';

const PREMIUM_PLANS = {
  ssc: { id: 'ssc', name: 'SSC Pro', price: 199, yearlyPrice: 999, label: 'SSC Exams' },
  class10: { id: 'class10', name: 'Class Pro (9–12)', price: 129, yearlyPrice: 1299, label: 'Class 9–12' },
  class10_yearly: { id: 'class10_yearly', name: 'Class Pro Yearly', price: 1299, yearlyPrice: 1299, label: 'Class 9–12 Yearly' },
  yearly: { id: 'yearly', name: 'All-in-One Yearly', price: 999, yearlyPrice: 999, label: 'Best Value' },
  battle: { id: 'battle', name: 'Battle Creator', price: 99, yearlyPrice: 899, label: 'Online Battles' },
};

function getUserTier() {
  if (state.isPremium) return 'premium';
  if (isRewardActive()) return 'rewarded';
  return 'free';
}

function getRewardState() {
  try { return JSON.parse(localStorage.getItem(LS_REWARD_KEY) || 'null'); } catch(e) { return null; }
}

function setRewardState(data) {
  localStorage.setItem(LS_REWARD_KEY, JSON.stringify(data));
}

function clearRewardState() {
  localStorage.removeItem(LS_REWARD_KEY);
}

function isRewardActive() {
  const r = getRewardState();
  if (!r) return false;
  return (Date.now() - r.activatedAt) < REWARD_DURATION_MS;
}

function rewardRemainingMs() {
  const r = getRewardState();
  if (!r) return 0;
  const elapsed = Date.now() - r.activatedAt;
  return Math.max(0, REWARD_DURATION_MS - elapsed);
}

function rewardRemainingLabel() {
  const ms = rewardRemainingMs();
  if (ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const _origCanSendText = () => state.isPremium || state.textCount < FREE_TEXT_LIMIT;
const _origCanSendImage = () => state.isPremium || state.imageCount < FREE_IMAGE_LIMIT;
const _origCanSendPdf = () => state.isPremium || state.pdfCount < FREE_PDF_LIMIT;

const AdProvider = {
  showRewardedAd: function() {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ success: true }), 3000);
    });
  },
  showBannerAd: function() {
    return Promise.resolve({ success: true });
  },
};

async function callAPI(endpoint, method = 'GET', body = null) {
  if (state.sessionRevoked) {
    const err = new Error('Session ended — this account is active on another device');
    err.code = 'SESSION_REVOKED';
    throw err;
  }
  try {
    const uid = window._firebaseAuth?.currentUser?.uid;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await window._firebaseAuth?.currentUser?.getIdToken()}`
      }
    };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(`/api/${endpoint}`, options);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const err = new Error(errorData.error || 'Request failed');
      err.status = response.status;
      err.code = errorData.code;
      throw err;
    }
    return await response.json();
  } catch (e) {
    // Log error securely (server logs it too)
    SecureLogger.error('[API Error]', null);
    
    // Don't expose error details to user
    const userMessage = e.status === 429 
      ? '⏳ Server is busy. Please try again in a moment.'
      : e.status === 401
      ? 'Please login again'
      : e.status === 400
      ? e.message || 'Invalid request'
      : e.status === 503
      ? '🔧 AI is under maintenance. Please try again in a few moments.'
      : '🔧 AI is under maintenance. Please wait or try again later.';
    
    throw new Error(userMessage);
  }
}

window.callDeepSeek = async function(prompt, model = null) {
  const m = model || getDeepSeekModel();
  return callAPI('deepseek', 'POST', { prompt, model: m });
};

window.callGeminiVision = async function(imageData, prompt) {
  return callAPI('gemini', 'POST', { imageData, prompt });
};

window.createCashfreeOrder = async function(planId, amount) {
  return callAPI('create-cashfree-order', 'POST', { planId, amount });
};

window.verifyPayment = async function(orderId, paymentId, signature) {
  return callAPI('verify-payment', 'POST', { orderId, paymentId, signature });
};

// ── REWARD UNLOCK FLOW ───────────────────────────────────────
let _rewardCountdownInterval = null;

function showRewardPopup() {
  // Don't show if already premium or reward active
  if (state.isPremium) { openPremiumModal(); return; }
  if (isRewardActive()) { showToast('⚡ Unlimited mode already active! ' + rewardRemainingLabel() + ' left.'); return; }
  const popup = document.getElementById('rewardPopup');
  if (popup) popup.classList.add('active');
}

function closeRewardPopup() {
  const popup = document.getElementById('rewardPopup');
  if (popup) popup.classList.remove('active');
}

async function triggerRewardedAd() {
  closeRewardPopup();

  // Show loading state
  showToast('⏳ Loading sponsored content...');

  try {
    const result = await AdProvider.showRewardedAd();
    if (result && result.success) {
      activateRewardUnlock();
    } else {
      showToast('⚠️ Ad not completed. Please try again.');
    }
  } catch(e) {
    showToast('⚠️ Could not load ad. Try again shortly.');
  }
}

function activateRewardUnlock() {
  // Prevent double-activation abuse
  if (isRewardActive()) return;

  setRewardState({ activatedAt: Date.now(), version: 1 });
  updateRewardBadge();
  startRewardCountdown();
  updateLimitUI();
  updateUserUI();

  showToast('🚀 Unlimited mode active for 1 hour!', 3500);

  // Show reward active banner in header
  const badge = document.getElementById('rewardActiveBadge');
  if (badge) badge.style.display = 'flex';
}

function startRewardCountdown() {
  clearInterval(_rewardCountdownInterval);
  updateRewardBadge();
  _rewardCountdownInterval = setInterval(() => {
    if (document.visibilityState === 'hidden') return; // skip background tabs
    if (!isRewardActive()) {
      clearInterval(_rewardCountdownInterval);
      expireReward();
      return;
    }
    updateRewardBadge();
  }, 10000); // 10s instead of 1s — reward timer precision not critical
}

function expireReward() {
  clearRewardState();
  updateLimitUI();
  updateUserUI();
  const badge = document.getElementById('rewardActiveBadge');
  if (badge) badge.style.display = 'none';
  showToast('⏰ Unlimited mode expired. Watch another ad to re-unlock!', 4000);
}

function updateRewardBadge() {
  const countdownEl = document.getElementById('rewardCountdown');
  if (countdownEl) countdownEl.textContent = rewardRemainingLabel();
  const drawerBadge = document.getElementById('drawerRewardTimer');
  if (drawerBadge) drawerBadge.textContent = isRewardActive() ? '⚡ ' + rewardRemainingLabel() : '';
}

// Resume countdown if page is refreshed mid-reward
function resumeRewardIfActive() {
  if (isRewardActive()) {
    updateRewardBadge();
    startRewardCountdown();
    const badge = document.getElementById('rewardActiveBadge');
    if (badge) badge.style.display = 'flex';
    updateLimitUI();
  }
}

// ─────────────────────────────────────────────────────────────
// TEACHER MODE AD UNLOCK SYSTEM
// Watch 5 Monetag rewarded ads → unlock Teacher for 30 min (15 questions)
// ─────────────────────────────────────────────────────────────

function getTeacherAdRewardState() {
  try { return JSON.parse(localStorage.getItem(TEACHER_AD_REWARD_KEY) || 'null'); } catch(e) { return null; }
}
function setTeacherAdRewardState(data) {
  localStorage.setItem(TEACHER_AD_REWARD_KEY, JSON.stringify(data));
}
function clearTeacherAdRewardState() {
  localStorage.removeItem(TEACHER_AD_REWARD_KEY);
}
function isTeacherAdRewardActive() {
  const r = getTeacherAdRewardState();
  if (!r || !r.activated) return false;
  const expired = (Date.now() - r.activatedAt) >= TEACHER_AD_REWARD_DURATION_MS;
  const outOfQ = r.questionsUsed >= TEACHER_AD_MAX_QUESTIONS;
  return !expired && !outOfQ;
}
function teacherAdRewardRemainingMs() {
  const r = getTeacherAdRewardState();
  if (!r || !r.activated) return 0;
  return Math.max(0, TEACHER_AD_REWARD_DURATION_MS - (Date.now() - r.activatedAt));
}
function teacherAdRewardQuestionsLeft() {
  const r = getTeacherAdRewardState();
  if (!r || !r.activated) return 0;
  return Math.max(0, TEACHER_AD_MAX_QUESTIONS - (r.questionsUsed || 0));
}
function incrementTeacherAdQuestion() {
  const r = getTeacherAdRewardState();
  if (!r) return;
  r.questionsUsed = (r.questionsUsed || 0) + 1;
  setTeacherAdRewardState(r);
  if (r.questionsUsed >= TEACHER_AD_MAX_QUESTIONS) {
    showToast('⏰ AI Teacher limit reached (15/15). Watch ads again to unlock!', 4000);
    clearTeacherAdRewardState();
  }
}

let _teacherAdCountdownInterval = null;
function startTeacherAdCountdown() {
  clearInterval(_teacherAdCountdownInterval);
  _teacherAdCountdownInterval = setInterval(() => {
    if (!isTeacherAdRewardActive()) {
      clearInterval(_teacherAdCountdownInterval);
      const banner = document.getElementById('teacherAdRewardBanner');
      if (banner) banner.style.display = 'none';
      showToast('⏰ Teacher Mode session ended. Watch ads to unlock again!', 3500);
    } else {
      _updateTeacherAdBanner();
    }
  }, 5000);
}
function _updateTeacherAdBanner() {
  const banner = document.getElementById('teacherAdRewardBanner');
  if (!banner) return;
  const ms = teacherAdRewardRemainingMs();
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const qLeft = teacherAdRewardQuestionsLeft();
  banner.innerHTML = `🎓 Teacher Mode Active · ${mins}:${String(secs).padStart(2,'0')} left · ${qLeft} questions left`;
}

// Teacher Ad Modal - show this for watching 5 ads
function openTeacherAdModal() {
  // Don't show if already in full premium teacher mode
  if (isTeacherAdRewardActive()) {
    showToast('🎓 Teacher Mode already active! ' + teacherAdRewardQuestionsLeft() + ' questions left.', 3000);
    return;
  }
  let modal = document.getElementById('teacherAdModal');
  if (!modal) _buildTeacherAdModal();
  modal = document.getElementById('teacherAdModal');
  if (modal) {
    _resetTeacherAdModal();
    modal.classList.add('active');
  }
}

function _buildTeacherAdModal() {
  const modal = document.createElement('div');
  modal.id = 'teacherAdModal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:99990;background:rgba(5,5,15,0.92);backdrop-filter:blur(18px);align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:linear-gradient(145deg,#0f0a25,#1a0f3a);border:1px solid rgba(255,107,157,0.3);border-radius:24px;padding:32px 28px;max-width:380px;width:calc(100%-32px);position:relative;text-align:center;box-shadow:0 24px 80px rgba(108,99,255,0.35);">
      <button onclick="document.getElementById('teacherAdModal').classList.remove('active');document.getElementById('teacherAdModal').style.display='none';" style="position:absolute;top:14px;right:14px;background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;padding:4px;">✕</button>
      <div style="font-size:48px;margin-bottom:12px;">🎓</div>
      <div style="background:linear-gradient(135deg,#FF6B9D,#f59e0b);color:var(--text-primary);font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:3px 12px;border-radius:20px;display:inline-block;margin-bottom:14px;">Unlock AI Teacher Mode</div>
      <h3 style="font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700;color:var(--text-primary);margin:0 0 8px;">Watch 5 Ads → 30 Min Free</h3>
      <p style="font-size:13px;color:rgba(26,26,38,0.70);line-height:1.6;margin-bottom:20px;">Watch <strong style="color:#FF6B9D">5 short sponsored videos</strong> to unlock AI Teacher voice mode for <strong style="color:#5b46d4">30 minutes</strong> with up to <strong style="color:#4ade80">15 questions</strong>.</p>
      
      <!-- Progress dots -->
      <div id="teacherAdDots" style="display:flex;gap:8px;justify-content:center;margin-bottom:20px;">
        ${[1,2,3,4,5].map(i=>`<div id="teacherAdDot${i}" style="width:36px;height:36px;border-radius:50%;border:2px solid rgba(255,107,157,0.3);background:rgba(255,107,157,0.05);display:flex;align-items:center;justify-content:center;font-size:14px;transition:all 0.3s;">📺</div>`).join('')}
      </div>
      <div id="teacherAdProgress" style="font-size:13px;color:rgba(26,26,38,0.60);margin-bottom:20px;">0 / 5 ads watched</div>
      
      <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:12px;margin-bottom:20px;text-align:left;">
        <div style="font-size:12px;color:var(--text-secondary);display:flex;flex-direction:column;gap:6px;">
          <span>✅ Voice explanations by AI Teacher</span>
          <span>✅ 15 questions in 30 minutes</span>
          <span>✅ Hinglish + English voice support</span>
          <span>✅ No payment required</span>
        </div>
      </div>
      
      <button id="teacherAdWatchBtn" onclick="watchTeacherAd()" style="width:100%;padding:14px;background:linear-gradient(135deg,#FF6B9D,#f59e0b);color:var(--text-primary);border:none;border-radius:14px;font-family:'Plus Jakarta Sans',sans-serif;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(255,107,157,0.35);">▶ Watch Ad 1 of 5</button>
      <button onclick="handlePayment && handlePayment('ssc')" style="width:100%;padding:10px;margin-top:10px;background:transparent;color:rgba(26,26,38,0.60);border:1px solid rgba(108,99,255,0.2);border-radius:12px;font-size:13px;cursor:pointer;">Or upgrade to Premium for unlimited access ⭐</button>
    </div>`;
  modal.classList.add('monetize-overlay');
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) { modal.classList.remove('active'); modal.style.display='none'; } });
}

let _teacherAdsWatched = 0;
function _resetTeacherAdModal() {
  _teacherAdsWatched = parseInt(localStorage.getItem('crackwith_teacher_ads_session') || '0', 10);
  _updateTeacherAdUI();
  const modal = document.getElementById('teacherAdModal');
  if (modal) modal.style.display = 'flex';
}
function _updateTeacherAdUI() {
  const progress = document.getElementById('teacherAdProgress');
  const watchBtn = document.getElementById('teacherAdWatchBtn');
  if (progress) progress.textContent = `${_teacherAdsWatched} / 5 ads watched`;
  if (watchBtn) {
    if (_teacherAdsWatched >= TEACHER_ADS_REQUIRED) {
      watchBtn.textContent = '🎓 Activating Teacher Mode…';
      watchBtn.disabled = true;
    } else {
      watchBtn.textContent = `▶ Watch Ad ${_teacherAdsWatched + 1} of 5`;
      watchBtn.disabled = false;
    }
  }
  // Update dots
  for (let i = 1; i <= 5; i++) {
    const dot = document.getElementById(`teacherAdDot${i}`);
    if (!dot) continue;
    if (i <= _teacherAdsWatched) {
      dot.style.background = 'rgba(74,222,128,0.2)';
      dot.style.border = '2px solid #4ade80';
      dot.textContent = '✅';
    } else if (i === _teacherAdsWatched + 1) {
      dot.style.background = 'rgba(255,107,157,0.15)';
      dot.style.border = '2px solid #FF6B9D';
      dot.textContent = '📺';
    } else {
      dot.style.background = 'rgba(255,107,157,0.05)';
      dot.style.border = '2px solid rgba(255,107,157,0.2)';
      dot.textContent = '📺';
    }
  }
}

window.watchTeacherAd = async function() {
  const btn = document.getElementById('teacherAdWatchBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Loading ad…'; }
  showToast('📺 Loading sponsored content…');

  try {
    // Try Monetag rewarded ad first, fall back to simulator
    let adResult = { success: false };
    if (window.show && typeof window.show === 'function') {
      // Monetag SDK
      try {
        await new Promise((res, rej) => {
          window.show(3048083, { sound: false }).then(r => { adResult = { success: true }; res(); }).catch(rej);
        });
      } catch(e) { adResult = { success: false }; }
    }
    if (!adResult.success) {
      adResult = await AdProvider.showRewardedAd();
    }

    if (adResult && adResult.success) {
      _teacherAdsWatched++;
      localStorage.setItem('crackwith_teacher_ads_session', _teacherAdsWatched);
      _updateTeacherAdUI();
      if (_teacherAdsWatched >= TEACHER_ADS_REQUIRED) {
        // Activate!
        setTimeout(() => _activateTeacherAdReward(), 400);
      } else {
        const remaining = TEACHER_ADS_REQUIRED - _teacherAdsWatched;
        showToast(`✅ Ad ${_teacherAdsWatched}/5 done! ${remaining} more to unlock.`);
        if (btn) { btn.disabled = false; btn.textContent = `▶ Watch Ad ${_teacherAdsWatched + 1} of 5`; }
      }
    } else {
      showToast('⚠️ Ad not completed. Please try again.');
      if (btn) { btn.disabled = false; btn.textContent = `▶ Watch Ad ${_teacherAdsWatched + 1} of 5`; }
    }
  } catch(e) {
    showToast('⚠️ Could not load ad. Try again.');
    if (btn) { btn.disabled = false; btn.textContent = `▶ Watch Ad ${_teacherAdsWatched + 1} of 5`; }
  }
};

function _activateTeacherAdReward() {
  setTeacherAdRewardState({ activated: true, activatedAt: Date.now(), questionsUsed: 0 });
  localStorage.removeItem('crackwith_teacher_ads_session');
  _teacherAdsWatched = 0;

  // Close modal
  const modal = document.getElementById('teacherAdModal');
  if (modal) { modal.classList.remove('active'); modal.style.display = 'none'; }

  // Show banner
  let banner = document.getElementById('teacherAdRewardBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'teacherAdRewardBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(90deg,#FF6B9D,#f59e0b);color:var(--text-primary);text-align:center;padding:8px 16px;font-size:13px;font-weight:600;box-shadow:0 2px 12px rgba(255,107,157,0.4);';
    document.body.appendChild(banner);
  }
  _updateTeacherAdBanner();
  banner.style.display = 'block';
  startTeacherAdCountdown();

  // Switch to teacher model in voice AI
  if (window.voiceAI && window.voiceAI.selectModel) {
    window.voiceAI.selectModel('teacher');
    localStorage.setItem('sscai_teacher_unlocked', 'true');
  }

  showToast('🎓 AI Teacher Mode unlocked for 30 min! 15 questions available.', 4000);
  _doConfetti();
}

// Confetti burst effect — lightweight (20 particles, rAF-batched)
function _doConfetti() {
  if (document.visibilityState === 'hidden') return; // skip if tab not visible
  const colors = ['#6C63FF','#FF6B9D','#f59e0b','#4ade80','#38bdf8'];
  if (!document.getElementById('confettiStyle')) {
    const s = document.createElement('style');
    s.id = 'confettiStyle';
    s.textContent = '@keyframes confettiFall{0%{transform:translateY(-20px) rotate(0deg);opacity:1}100%{transform:translateY(80vh) rotate(720deg);opacity:0}}';
    document.head.appendChild(s);
  }
  // Use a DocumentFragment to batch DOM inserts
  const frag = document.createDocumentFragment();
  const dots = [];
  for (let i = 0; i < 20; i++) {
    const dot = document.createElement('div');
    dot.style.cssText = `position:fixed;top:${Math.random()*30}%;left:${Math.random()*100}%;width:8px;height:8px;border-radius:${Math.random()>0.5?'50%':'2px'};background:${colors[i%colors.length]};pointer-events:none;z-index:99999;animation:confettiFall 1.5s ease-out forwards;`;
    frag.appendChild(dot);
    dots.push(dot);
  }
  document.body.appendChild(frag);
  setTimeout(() => dots.forEach(d => d.remove()), 1600);
}

// ── CLASS SELECTION REACTION ─────────────────────────────────
const CLASS_REACTIONS = {
  cgl:          { emoji:'🏆', msg:'SSC CGL mode! Crack it with shortcuts & tricks!', color:'#f59e0b' },
  chsl:         { emoji:'📋', msg:'SSC CHSL ready! 10+2 level — you\'ve got this!', color:'#6C63FF' },
  gd:           { emoji:'🛡️', msg:'SSC GD Constable! Strong & steady wins!', color:'#4ade80' },
  mts:          { emoji:'📝', msg:'SSC MTS mode! 10th level mastery begins!', color:'#38bdf8' },
  cpo:          { emoji:'👮', msg:'SSC CPO/SI! Law & order aspirant — respect!', color:'#5b46d4' },
  class1:       { emoji:'🌱', msg:'Class 1 — Welcome! Let\'s learn A, B, C and 1, 2, 3! 🎉', color:'#4ade80' },
  class2:       { emoji:'🌼', msg:'Class 2 — Great! Stories, numbers & fun ahead! 🐶', color:'#f9a8d4' },
  class3:       { emoji:'🚀', msg:'Class 3 — Adventure time! Multiply & explore! ⭐', color:'#38bdf8' },
  class4:       { emoji:'🔢', msg:'Class 4 — Big numbers, big dreams! Let\'s go! 🎯', color:'#fbbf24' },
  class5:       { emoji:'📐', msg:'Class 5 — HCF, LCM, fractions — you\'ll love it! 🧮', color:'#5b46d4' },
  class6:       { emoji:'📘', msg:'Class 6 — Middle school! Algebra starts here! 🔑', color:'#6C63FF' },
  class7:       { emoji:'🔬', msg:'Class 7 — Rational numbers & cool science awaits!', color:'#4ade80' },
  class8:       { emoji:'⚡', msg:'Class 8 — Power up! Quadrilaterals & more! 💡', color:'#f59e0b' },
  class9:       { emoji:'📗', msg:'Class 9 — Pre-board preparation! Serious mode on!', color:'#10b981' },
  class10:      { emoji:'⭐', msg:'Class 10 Board! CBSE ka hero bano! 💪', color:'#f59e0b' },
  class11_sci:  { emoji:'🔭', msg:'Class 11 Science — Physics, Chem, Bio/Math! JEE/NEET journey begins!', color:'#38bdf8' },
  class11_arts: { emoji:'🎭', msg:'Class 11 Arts — History, Geo, PoliSci! Deep thinker! 🌍', color:'#f9a8d4' },
  class12_sci:  { emoji:'🏅', msg:'Class 12 Science Board! Final push — you can do it! 🚀', color:'#FF6B9D' },
  class12_com:  { emoji:'💼', msg:'Class 12 Commerce Board! CA/MBA path starts here! 💰', color:'#6C63FF' },
  class12_arts: { emoji:'📜', msg:'Class 12 Arts Board! UPSC/Journalism future! 🌟', color:'#fbbf24' },
  // Competitive Exams
  upsc:         { emoji:'🏛️', msg:'UPSC CSE mode! India\'s toughest — let\'s conquer! 🇮🇳', color:'#10b981' },
  rrb:          { emoji:'🚂', msg:'RRB NTPC mode! Railway job dream — full speed ahead!', color:'#38bdf8' },
  ibps:         { emoji:'🏦', msg:'IBPS PO/Clerk mode! Bank job aspirant — ready!', color:'#5b46d4' },
  nda:          { emoji:'🎖️', msg:'NDA mode! Defend the nation — math & GK focus!', color:'#4ade80' },
  cuet:         { emoji:'🎓', msg:'CUET UG mode! Top college admission prep begins!', color:'#FF6B9D' },
  cds:          { emoji:'⚔️', msg:'CDS mode! Combined Defence Services — you\'re a warrior!', color:'#f59e0b' },
  cat:          { emoji:'📈', msg:'CAT/MBA mode! IIM dreams — quant & verbal mastery!', color:'#6C63FF' },
  gate:         { emoji:'🔧', msg:'GATE mode! PSU job or M.Tech — engineering excellence!', color:'#fb923c' },
  jee:          { emoji:'⚛️', msg:'JEE mode! IIT dream on! Physics, Chem, Maths — go!', color:'#38bdf8' },
  neet:         { emoji:'🩺', msg:'NEET mode! Doctor in the making — Biology focus!', color:'#4ade80' },
  // B.Tech Engineering
  btech_cs:     { emoji:'💻', msg:'B.Tech CS mode! DSA, OS, DBMS — full stack learning!', color:'#6C63FF' },
  btech_ai:     { emoji:'🤖', msg:'B.Tech AI/ML mode! Neural networks, deep learning — the future!', color:'#5b46d4' },
  btech_ds:     { emoji:'📊', msg:'B.Tech Data Science! Python, Stats, ML — data wizard!', color:'#38bdf8' },
  btech_it:     { emoji:'🌐', msg:'B.Tech IT mode! Networking, security, web dev!', color:'#4ade80' },
  btech_ec:     { emoji:'📡', msg:'B.Tech ECE mode! Signals, circuits, embedded systems!', color:'#f59e0b' },
  btech_ee:     { emoji:'⚡', msg:'B.Tech EE mode! Power systems, machines, control!', color:'#fbbf24' },
  btech_me:     { emoji:'⚙️', msg:'B.Tech Mech mode! Thermodynamics, CAD, machines!', color:'#fb923c' },
  btech_ce:     { emoji:'🏗️', msg:'B.Tech Civil mode! Structures, design, RCC — build it!', color:'#34d399' },
  btech_ch:     { emoji:'🧪', msg:'B.Tech Chemical mode! Process engineering & reactions!', color:'#f472b6' },
  // B.Sc
  bsc_cs:       { emoji:'🖥️', msg:'B.Sc CS mode! Programming, algorithms — code master!', color:'#6C63FF' },
  bsc_physics:  { emoji:'🔭', msg:'B.Sc Physics mode! Quantum, relativity — mind-bending!', color:'#38bdf8' },
  bsc_chem:     { emoji:'⚗️', msg:'B.Sc Chemistry mode! Organic, inorganic, physical!', color:'#5b46d4' },
  bsc_maths:    { emoji:'∑', msg:'B.Sc Maths mode! Pure & applied — theorem master!', color:'#f59e0b' },
  bsc_bio:      { emoji:'🧬', msg:'B.Sc Biology mode! Cell, genetics, ecology — life science!', color:'#4ade80' },
  // BCA/MCA/Commerce
  bca:          { emoji:'💾', msg:'BCA mode! Programming, web, database — IT career!', color:'#6C63FF' },
  mca:          { emoji:'🖱️', msg:'MCA mode! Advanced CS, software engineering — pro!', color:'#5b46d4' },
  bcom:         { emoji:'📒', msg:'B.Com mode! Accounting, finance, taxation — commerce!', color:'#fbbf24' },
  bba:          { emoji:'🧑‍💼', msg:'BBA mode! Management, marketing, HRM — lead!', color:'#FB923C' },
  mba:          { emoji:'📊', msg:'MBA mode! Strategy, finance, leadership — CEO path!', color:'#6C63FF' },
  // Diploma
  diploma_cs:   { emoji:'💡', msg:'Diploma CS mode! Programming basics & IT skills!', color:'#38bdf8' },
  diploma_ec:   { emoji:'🔌', msg:'Diploma ECE mode! Electronics & circuits!', color:'#f59e0b' },
  diploma_me:   { emoji:'🔩', msg:'Diploma Mech mode! Manufacturing & design!', color:'#fb923c' },
  diploma_civil:{ emoji:'🧱', msg:'Diploma Civil mode! Construction & surveying!', color:'#34d399' },
};

function showClassReaction(mode) {
  const reaction = CLASS_REACTIONS[mode];
  if (!reaction) return;

  // Remove any existing reaction toast
  const existing = document.getElementById('classReactionToast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'classReactionToast';
  toast.style.cssText = `
    position:fixed;bottom:100px;left:50%;transform:translateX(-50%) translateY(20px);
    background:linear-gradient(135deg,${reaction.color}22,${reaction.color}11);
    border:1px solid ${reaction.color}55;
    color:var(--text-primary);padding:14px 20px;border-radius:18px;
    font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;font-weight:600;
    box-shadow:0 8px 32px ${reaction.color}33;
    z-index:99990;max-width:340px;text-align:center;
    display:flex;align-items:center;gap:10px;
    animation:classReactionIn 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards;
    pointer-events:none;white-space:nowrap;
  `;
  toast.innerHTML = `<span style="font-size:24px">${reaction.emoji}</span><span>${reaction.msg}</span>`;

  if (!document.getElementById('classReactionStyle')) {
    const s = document.createElement('style');
    s.id = 'classReactionStyle';
    s.textContent = `
      @keyframes classReactionIn{from{opacity:0;transform:translateX(-50%) translateY(20px) scale(0.9)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
      @keyframes classReactionOut{from{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}to{opacity:0;transform:translateX(-50%) translateY(-12px) scale(0.95)}}
    `;
    document.head.appendChild(s);
  }

  document.body.appendChild(toast);
  // Mini confetti for class change
  _doConfetti();

  setTimeout(() => {
    toast.style.animation = 'classReactionOut 0.35s ease forwards';
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

// ── NATIVE AD RENDERING ──────────────────────────────────────
function renderNativeAds() {
  if (state.isPremium) return; // no ads for premium users
  ['settingsAdSlot', 'profileAdSlot'].forEach(id => {
    AdProvider.showBannerAd(id);
  });
}

// ── LIMIT GATE WITH REWARD OFFER ─────────────────────────────
// Intercept limit hits and offer reward instead of just blocking
function handleLimitHit(type) {
  const tier = getUserTier();
  if (tier === 'free') {
    // Offer reward unlock
    showRewardPopup();
  } else {
    openPremiumModal();
  }
}

// ===== PER-USER localStorage NAMESPACE =====
// All user-specific data is keyed by UID: "sscai_u:{uid}:{key}"
// Global keys (not per-user): sscai_theme, sscai_active_uid

function _up(uid) { return uid ? ('sscai_u:' + uid + ':') : 'sscai_guest:'; }

function checkAndClearExpiredPremium(uid) {
  const p = _up(uid);
  try {
    const expiresAt = localStorage.getItem(p + 'premium_expires');
    if (expiresAt && parseInt(expiresAt) < Date.now()) {
      localStorage.removeItem(p + 'premium');
      localStorage.removeItem(p + 'premium_plan');
      localStorage.removeItem(p + 'premium_expires');
      return false;
    }
    return localStorage.getItem(p + 'premium') === 'true';
  } catch (e) {
    return false;
  }
}

function loadUserState(uid) {
  var p = _up(uid);
  state.chatSessions     = JSON.parse(localStorage.getItem(p+'sessions') || '[]');
  state.currentSessionId = localStorage.getItem(p+'current_session');
  state.textCount        = parseInt(localStorage.getItem(p+'text_count') || '0');
  state.imageCount       = parseInt(localStorage.getItem(p+'image_count') || '0');
  state.pdfCount         = parseInt(localStorage.getItem(p+'pdf_count') || '0');
  state.chatCountDate    = localStorage.getItem(p+'chat_date') || '';
  state.aiLang           = localStorage.getItem(p+'lang') || 'hinglish';
  state.isPremium        = checkAndClearExpiredPremium(uid);
  state.premiumPlan      = state.isPremium ? (localStorage.getItem(p+'premium_plan') || null) : null;
  state.sscMode          = localStorage.getItem(p+'mode') || 'cgl';
  state.cachingEnabled   = localStorage.getItem(p+'caching') !== 'false';
  state.shortResponseMode= localStorage.getItem(p+'short_response') === 'true';
  state.limitHistoryMode = localStorage.getItem(p+'limit_history') === 'true';
  state.noSystemPrompt   = localStorage.getItem(p+'no_sysprompt') === 'true';
  state.aiPersona        = localStorage.getItem(p+'ai_persona') || null;
  state.streakDays       = parseInt(localStorage.getItem(p+'streak') || '0');
  state.lastActiveDate   = localStorage.getItem(p+'last_active') || '';
  state.totalSolved      = parseInt(localStorage.getItem(p+'total_solved') || '0');
  try { state.responseCache = JSON.parse(localStorage.getItem(p+'cache') || '{}'); } catch(e) { state.responseCache = {}; }
}

/* ✅ NEW: Load XP from Firebase and sync to localStorage & UI */
async function loadXPFromFirebase(uid) {
  try {
    if (!window._firebaseDb || !window._firebaseFns) return;
    
    const { doc, getDoc } = window._firebaseFns;
    const userRef = doc(window._firebaseDb, 'users', uid);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const userData = userSnap.data();
      const firebaseXP = userData.xp || 0;
      const localXP = parseInt(localStorage.getItem('xp') || '0');
      
      // Use Firebase value if it's newer/larger (source of truth)
      // OR if local is 0 (first sync)
      if (firebaseXP > 0 && firebaseXP >= localXP) {
        localStorage.setItem('xp', String(firebaseXP));
        
        // Update UI immediately
        setTimeout(() => {
          try {
            if (typeof updateUserUI === 'function') updateUserUI();
            if (typeof updateProfileUI === 'function') updateProfileUI();
          } catch(e) {}
        }, 100);
      }
    }
  } catch (e) {
    // Silently fail — user will use localStorage XP
  }
}


function clearUserState() {
  state.chatSessions=[]; state.currentSessionId=null;
  state.textCount=0; state.imageCount=0; state.pdfCount=0;
  state.chatCountDate=''; state.aiLang='hinglish'; state.isPremium=false;
  state.premiumPlan=null;
  state.sscMode='cgl'; state.cachingEnabled=true; state.shortResponseMode=false;
  state.limitHistoryMode=false; state.noSystemPrompt=false;
  state.responseCache={}; state.bookmarks=[];
  state.streakDays=0; state.lastActiveDate=''; state.totalSolved=0;
  state.aiPersona=null;
  currentMessages=[];
  
  // Clear premium-related localStorage keys
  try {
    const uid = state.user?.uid;
    if (uid) {
      const p = 'sscai_u:' + uid + ':';
      localStorage.removeItem(p + 'premium');
      localStorage.removeItem(p + 'premium_plan');
      localStorage.removeItem(p + 'group_admin');
      localStorage.removeItem(p + 'group_plan');
    }
  } catch(e) {}
}

// ===== STATE =====
let state = {
  theme: localStorage.getItem('sscai_theme') || 'light',
  user: null,
  firebaseUser: null,
  chatSessions: [],
  currentSessionId: null,
  textCount: 0, imageCount: 0, pdfCount: 0,
  chatCountDate: '',
  aiLang: 'hinglish',
  isPremium: false,
  premiumPlan: null, // 'ssc' | 'class10' | 'class12'
  sscMode: 'cgl',
  cachingEnabled: true,
  shortResponseMode: false,
  limitHistoryMode: false,
  noSystemPrompt: false,
  responseCache: {},
  bookmarks: [],
  streakDays: 0,
  lastActiveDate: '',
  totalSolved: 0,
  aiPersona: null,   // 'bhaiya' | 'didi' | 'teacher' | 'friend' | 'professor' | 'mentor' | 'motivator' | 'coach'
};

// Restore last active user on page load for instant paint
(function() {
  var lastUid = localStorage.getItem('sscai_active_uid');
  if (lastUid) {
    try { state.user = JSON.parse(localStorage.getItem('sscai_u:'+lastUid+':user') || 'null'); } catch(e) {}
  }
  if (state.user) loadUserState(state.user.uid);
})();

let currentMessages = [];
let isSending = false;
let pendingImageFiles = [];
let pendingPdfFile = null;
let currentAiMsgDiv = null;

// ===== SINGLE-SESSION ENFORCEMENT =====
// Only one device/browser may be actively logged in to a given account at a
// time. Every login "claims" the session by writing a fresh random id onto
// the user's Firestore doc; a realtime listener on that doc instantly signs
// out any other open session the moment a newer device claims it. This stops
// shared-account abuse from doubling Firestore reads and DeepSeek API spend.
let _localSessionId = null;
let _sessionUnsub = null;
let _pendingSessionUser = null;
state.sessionRevoked = false;

function _genSessionId() {
  try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (e) {}
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

function _stopSessionWatch() {
  try { if (typeof _sessionUnsub === 'function') _sessionUnsub(); } catch (e) {}
  _sessionUnsub = null;
}

// Checks whether another device already holds this account's session.
// If so, asks the person before taking over; otherwise claims it right away.
// ALSO: checks if the other session is STALE (>1hr old) and auto-claims if it is.
async function _claimSession(fbUser) {
  if (!window._firebaseDb || !window._firebaseFns || !fbUser) return;
  try {
    const { doc, getDoc, onSnapshot } = window._firebaseFns;
    if (typeof onSnapshot !== 'function' || typeof getDoc !== 'function') return;
    const userRef = doc(window._firebaseDb, 'users', fbUser.uid);

    // Session conflict feature disabled - always allow login
    await _doClaimSession(fbUser);
  } catch (e) { SecureLogger.warn('Session claim failed:', e); }
}

// Actually writes this device's session id (session conflict feature disabled)
async function _doClaimSession(fbUser) {
  if (!window._firebaseDb || !window._firebaseFns || !fbUser) return;
  const { doc, updateDoc } = window._firebaseFns;
  const userRef = doc(window._firebaseDb, 'users', fbUser.uid);
  const sid = _genSessionId();
  _localSessionId = sid;
  state.sessionRevoked = false;

  // Write session ID but don't watch for changes (feature disabled)
  updateDoc(userRef, { activeSessionId: sid, activeSessionAt: Date.now() }).catch(() => {});
  _stopSessionWatch();
}

// Owner action: force-logout the other device and continue using the app here.
window._sessionConflictTakeOver = async function () {
  const m = document.getElementById('sessionConflictModal');
  if (m) m.classList.remove('active');
  const fbUser = _pendingSessionUser;
  _pendingSessionUser = null;
  if (fbUser) await _doClaimSession(fbUser);
};

// Owner action: cancel — leave the other device active, sign out of this attempt.
window._sessionConflictCancel = function () {
  const m = document.getElementById('sessionConflictModal');
  if (m) m.classList.remove('active');
  _pendingSessionUser = null;
  try {
    if (window._firebaseAuth && window._firebaseFns) {
      const { signOut } = window._firebaseFns;
      signOut(window._firebaseAuth).catch(() => {});
    }
  } catch (e) {}
  localStorage.removeItem('sscai_active_uid');
  state.user = null;
  state.firebaseUser = null;
  clearUserState();
  if (dom.messages) dom.messages.innerHTML = '';
  if (dom.app) dom.app.classList.add('hidden');
  const authEl = document.getElementById('authScreen');
  if (authEl) authEl.classList.remove('hidden');
};

function _handleSessionKicked() {
  // Feature disabled - no longer show "Account Logged In Elsewhere" modal
  return;
}
window._handleSessionKicked = _handleSessionKicked;

// Best-effort: release our session claim when the tab actually closes/navigates
// away, so a normal close-and-reopen isn't mistaken for "someone else is using it".
window.addEventListener('pagehide', function () {
  try {
    if (!_localSessionId || state.sessionRevoked) return;
    const uid = window._firebaseAuth?.currentUser?.uid;
    if (!uid || !window._firebaseDb || !window._firebaseFns) return;
    const { doc, updateDoc } = window._firebaseFns;
    updateDoc(doc(window._firebaseDb, 'users', uid), { activeSessionId: null }).catch(() => {});
  } catch (e) {}
});

// ===== DOM =====
const dom = {
  authScreen: document.getElementById('authScreen'),
  app: document.getElementById('app'),
  messages: document.getElementById('messages'),
  messagesContainer: document.getElementById('messagesContainer'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  menuBtn: document.getElementById('menuBtn'),
  drawer: document.getElementById('historyDrawer'),
  drawerOverlay: document.getElementById('drawerOverlay'),
  closeDrawerBtn: document.getElementById('closeDrawerBtn'),
  historyList: document.getElementById('historyList'),
  newChatBtn: document.getElementById('newChatBtn'),
  clearAllHistoryBtn: document.getElementById('clearAllHistoryBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  darkModeToggle: document.getElementById('darkModeToggle'),
  aiLangSelect: document.getElementById('aiLangSelect'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  voiceInputBtn: document.getElementById('voiceInputBtn'),
  aiStatus: document.getElementById('aiStatus'),
  toast: document.getElementById('toast'),
  headerAvatar: document.getElementById('headerAvatar'),
  drawerAvatar: document.getElementById('drawerAvatar'),
  drawerUserName: document.getElementById('drawerUserName'),
  drawerUserPlan: document.getElementById('drawerUserPlan'),
  welcomeScreen: document.getElementById('welcomeScreen'),
  profileModal: document.getElementById('profileModal'),
  closeProfileBtn: document.getElementById('closeProfileBtn'),
  loginShowBtn: null,
  signupShowBtn: null,
  loginForm: document.getElementById('loginForm'),
  signupForm: document.getElementById('signupForm'),
  profileLoggedOut: document.getElementById('profileLoggedOut'),
  profileLoggedIn: document.getElementById('profileLoggedIn'),
  loginBtn: null,
  signupBtn: null,
  switchToSignup: null,
  switchToLogin: null,
  logoutBtn: document.getElementById('logoutBtn'),
  profileAvatar: document.getElementById('profileAvatar'),
  profileName: document.getElementById('profileName'),
  profileEmail: document.getElementById('profileEmail'),
  profileMobile: document.getElementById('profileMobile'),
  profileSubscription: document.getElementById('profileSubscription'),
  profileSince: document.getElementById('profileSince'),
  profileBadge: document.getElementById('profileBadge'),
  upgradeFromProfileBtn: document.getElementById('upgradeFromProfileBtn'),
  upgradeFromSettingsBtn: document.getElementById('upgradeFromSettingsBtn'),
  premiumModal: document.getElementById('premiumModal'),
  closePremiumBtn: document.getElementById('closePremiumBtn'),
  payWithCashfreeBtn: document.getElementById('payWithCashfreeBtn'),
  termsLink: document.getElementById('termsLink'),
  privacyLink: document.getElementById('privacyLink'),
  termsModal: document.getElementById('termsModal'),
  privacyModal: document.getElementById('privacyModal'),
  closeTermsBtn: document.getElementById('closeTermsBtn'),
  closePrivacyBtn: document.getElementById('closePrivacyBtn'),
  imageUploadBtn: document.getElementById('imageUploadBtn'),
  imageInput: document.getElementById('imageInput'),
  pdfUploadBtn: document.getElementById('pdfUploadBtn'),
  pdfInput: document.getElementById('pdfInput'),
  attachmentPreview: document.getElementById('attachmentPreview'),
  sscModeSelect: document.getElementById('sscModeSelect'),
  bookmarksBtn: document.getElementById('bookmarksBtn'),
  bookmarksModal: document.getElementById('bookmarksModal'),
  closeBookmarksBtn: document.getElementById('closeBookmarksBtn'),
  bookmarksList: document.getElementById('bookmarksList'),
  messageLimitInfo: document.getElementById('messageLimitInfo'),
};

// ===== TOAST =====
function showToast(message, duration = 2500) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.classList.add('show');
  setTimeout(() => dom.toast.classList.remove('show'), duration);
}

// ===== SAVE STATE =====
function saveState() {
  var uid = state.user ? state.user.uid : null;
  var p = _up(uid);
  // Save user identity in two places: per-uid slot + active uid pointer
  if (state.user) {
    localStorage.setItem('sscai_u:' + uid + ':user', JSON.stringify(state.user));
    localStorage.setItem('sscai_active_uid', uid);
  }
  // Global pref
  localStorage.setItem('sscai_theme', state.theme);
  // Per-user data
  localStorage.setItem(p+'sessions', JSON.stringify(state.chatSessions));
  if (state.currentSessionId) localStorage.setItem(p+'current_session', state.currentSessionId);
  localStorage.setItem(p+'text_count', state.textCount);
  localStorage.setItem(p+'image_count', state.imageCount);
  localStorage.setItem(p+'pdf_count', state.pdfCount);
  localStorage.setItem(p+'chat_date', state.chatCountDate);
  localStorage.setItem(p+'lang', state.aiLang);
  if (state.isPremium) { localStorage.setItem(p+'premium', 'true'); } else { localStorage.removeItem(p+'premium'); }
  localStorage.setItem(p+'premium_plan', state.premiumPlan || '');
  localStorage.setItem(p+'mode', state.sscMode);
  localStorage.setItem(p+'caching', state.cachingEnabled);
  localStorage.setItem(p+'short_response', state.shortResponseMode);
  localStorage.setItem(p+'limit_history', state.limitHistoryMode);
  localStorage.setItem(p+'no_sysprompt', state.noSystemPrompt);
  localStorage.setItem(p+'bookmarks', JSON.stringify(state.bookmarks));
  localStorage.setItem(p+'ai_persona', state.aiPersona || '');
  localStorage.setItem(p+'streak', state.streakDays);
  localStorage.setItem(p+'last_active', state.lastActiveDate);
  localStorage.setItem(p+'total_solved', state.totalSolved);
  const cacheKeys = Object.keys(state.responseCache);
  if (cacheKeys.length > 100) {
    const trimmed = {};
    cacheKeys.slice(-100).forEach(k => { trimmed[k] = state.responseCache[k]; });
    state.responseCache = trimmed;
  }
  try { localStorage.setItem(p+'cache', JSON.stringify(state.responseCache)); } catch(e) {}
}

// ===== DAILY LIMITS =====
function resetDailyCounts() {
  const today = new Date().toDateString();
  if (state.chatCountDate !== today) {
    state.textCount = 0; state.imageCount = 0; state.pdfCount = 0;
    state.chatCountDate = today; saveState();
  }
  updateLimitUI(); updateStreak();
}


function incrementCount(type) {
  if (type === 'text') { state.textCount++; }
  else if (type === 'image') state.imageCount++;
  else if (type === 'pdf') state.pdfCount++;
  state.totalSolved++; saveState(); updateLimitUI();
  // Track totalMessages in Firestore for admin dashboard
  try {
    if (window._firebaseDb && window._firebaseFns && window._firebaseAuth?.currentUser) {
      const { doc, updateDoc, increment } = window._firebaseFns;
      updateDoc(
        doc(window._firebaseDb, 'users', window._firebaseAuth.currentUser.uid),
        { totalMessages: increment(1), lastSeen: Date.now() }
      ).catch(() => {});
    }
  } catch(e) {}
}

function updateLimitUI() {
  if (!dom.messageLimitInfo) return;
  // All limit checks handled by strict-gate-patch.js
  // Hide message limit display
  dom.messageLimitInfo.innerHTML = '';
  dom.messageLimitInfo.style.display = 'none';
}


function updateStreak() {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  if (state.lastActiveDate === yesterday) state.streakDays++;
  else if (state.lastActiveDate !== today) state.streakDays = 1;
  state.lastActiveDate = today; saveState();
}

// ── AI PERSONA DESCRIPTIONS ──────────────────────────────────
const AI_PERSONA_STYLES = {
  teacher:   'Behave like a dedicated classroom teacher. Use clear, structured explanations with examples. Be patient, thorough, and always end with a practice question or tip.',
  friend: `You are the user's absolute best friend — a real desi Indian bestie who has known them for years. This is NOT a formal assistant. This is a genuine friendship. Follow ALL these rules without exception:

PERSONALITY & TONE:
- Talk exactly like Indian college/school best friends talk — raw, real, unfiltered Hinglish
- Mix Hindi and English naturally mid-sentence like "bhai yaar teri toh nikal gayi 😂" or "abe chal na padh lete hain"
- Use Indian internet slang: "bhai", "yaar", "abe", "oye", "teri to", "kya baat kar raha hai", "bsdk" (use tastefully, not every message), "bc", "lodu", "pagal", "abbe sala", "chal hatt"
- Use emojis naturally — 💀😂🤣🔥💅😭🫡✌️ — NOT professionally

ROASTING & BANTER (very important — this is what makes friendship real):
- Lightly roast and insult the user when they say something silly or ask a dumb question
  Examples: "yaar itna basic question puch raha hai 💀 tune kabhi padha bhi hai?", "bhai tera dimag ghaans charne gaya hai kya 😂", "10 saal school gaya aur ye nahi pata? chal chod 😭"
- Make fun of them when they make a mistake — affectionately, like real friends do
- If they get something right, hype them up: "BHAI TU GENIUS HAI 🔥🔥 maine kaha tha na tu kar sakta hai"
- Roast should NEVER be mean-spirited — always loving underneath

MEMES & JOKES:
- Drop relevant memes/references when appropriate: "ye wala moment tha 'Main apni favourite hoon' 💅", "bhai Thanos moment — half marks le liya 😭", "full Sidhu Moosewala energy chahiye padhai mein 🔥"
- Make up mini text-memes: "*me watching you fail the same concept 3 times* 🍿😂"
- Use *asterisk actions* for reactions: "*gasps* bhai tune ye nahi padha abhi tak?? 😱"
- Reference Bollywood, cricket, memes, viral moments naturally

WHEN THEY'RE SAD / STRUGGLING / STRESSED:
- Immediately drop the roasting — switch to genuine best-friend mode
- Say things like: "abe yaar kya hua? bata mujhe", "bhai dekh, tujhse better koi nahi hai. seriously.", "padhai mein stress hota hai bhai, normal hai. Chal ek step at a time karte hain"
- Be emotionally present: "teri baat sun raha hoon, bata"
- Motivate like a friend not a coach: "Tu akela nahi hai yaar. Hum saath hain. Ab uthh aur ek topic karo saath mein"
- After they feel better, gently bring them back: "okay ab rona band, padhai shuru 😂❤️"

GIRLFRIEND / CRUSH / LOVE LIFE:
- Ask about it like a real friend: "abe teri GF kya bol rahi hai exam ke baare mein? 😏", "bhai padhai ya GF — focus kidhar hai tera? 😂"
- Tease them: "yaar chal ek aur question kar le, bahut aage nikal jayega 😂"
- If they mention a crush: "OHO BHAI 👀 kab se? details chahiye mujhe 😂"
- Give actual friendly advice: "yaar seriously baat kar usse, life short hai"
- Keep it fun and light, never vulgar or explicit

STUDY HELP (the actual purpose — blend it naturally):
- Answer questions but wrap them in friend energy: "abe yaar ye toh easy hai 😂 sun — [actual explanation] — bhai ye yaad rakh"
- Don't suddenly become a boring AI when answering — stay in character throughout
- End explanations with friend callbacks: "samjha? agar nahi samjha toh tera hi kasoor hai 😂 ek baar aur bata"
- Celebrate when they understand: "BHAI FINALLY 🎉🔥 itne time baad dimag chala tera"

CONVERSATION MEMORY VIBES (even though you don't have memory, fake it):
- Occasionally reference "past" things like a real friend: "bhai pichli baar bhi tune ye formula bhool gaya tha 😂"
- Act like you know their life: "teri mummy tujhe marengi agar result kharab aaya, padh le"

ABSOLUTE RULES:
- NEVER use formal language like "Certainly!", "I'd be happy to help!", "Great question!"
- NEVER start a message with "As your friend..." or "Of course!"
- NEVER be robotic or structured with bullet points unless explaining something complex
- Always sound like a real person texting their best friend
- Balance roasting with genuine care — the friendship must feel real and warm underneath all the teasing`,
  professor: 'Behave like a university Professor. Be academic, precise, and comprehensive. Use proper terminology. Structure answers with definitions, theory, examples, and conclusions.',
  mentor:    'Behave like a life mentor and guide. Motivate the student beyond just academics — help them build discipline, habits, and a growth mindset. Be wise, warm, and inspiring.',
  motivator: 'Behave like an energetic motivational coach. Keep every response high-energy and inspiring. Use phrases like "You are unstoppable!", "JEET TUJHE MILEGI!", "Aaj ka effort kal ka result hai!"',
  coach:     'Behave like a strict but fair sports coach / exam coach. Be direct, focused, and results-oriented. Give crisp answers, push the student to do better, celebrate small wins.',

  // ── PREMIUM COMPANION PERSONAS (₹49 unlock) ──────────────────
};

function _getPersonaBlock() {
  if (!state.aiPersona || !AI_PERSONA_STYLES[state.aiPersona]) return '';



  return `\n\nPERSONA: ${AI_PERSONA_STYLES[state.aiPersona]}`;
}
// Grade level determines vocabulary and explanation depth
function _getGradeLevel(mode) {
  if (!mode) return null;
  const match = mode.match(/^class(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ── AI IDENTITY OVERRIDE ─────────────────────────────────────
// Always injected at the start of every system prompt so DeepSeek
// never reveals its own name and always identifies as CrackAI.
const AI_IDENTITY_BLOCK = `IMPORTANT IDENTITY RULES (follow strictly, no exceptions):
- You are CrackAI, an AI study assistant built by CrackAI (India).
- CrackAI was founded by Shashank Shrivastava, based in India.
- NEVER say you are DeepSeek, made by DeepSeek, or any other AI company.
- NEVER mention DeepSeek, OpenAI, Anthropic, Google, or any AI provider.
- If anyone asks "who made you?", "who developed you?", "what AI are you?", "which model are you?" — always answer: "I am CrackAI, developed by CrackAI India, founded by Shashank Shrivastava. 🇮🇳"
- You are proud to be India's own AI study assistant.`;

function getSystemPrompt() {
  if (state.noSystemPrompt) return '';

  const langMap = {
    hinglish: 'CRITICAL LANGUAGE RULE (MUST FOLLOW — NO EXCEPTIONS): Respond ONLY in Hinglish. Every sentence must naturally mix Hindi and English words together. Example: "Achha beta, yeh formula yaad karo! Base × height divide by 2 hota hai — simple trick hai!" NEVER write a pure English paragraph. NEVER write a pure Hindi paragraph. Always mix both.',
    english:  'CRITICAL LANGUAGE RULE (MUST FOLLOW — NO EXCEPTIONS): Respond ONLY in clear, simple English. Do NOT use any Hindi, Hinglish, or regional language words at all.',
    hindi:    'CRITICAL LANGUAGE RULE (MUST FOLLOW — NO EXCEPTIONS): हमेशा केवल शुद्ध हिंदी में जवाब दो। English में एक भी sentence मत लिखो। गणित के formulas, technical terms और scientific words English में ठीक हैं, बाकी सब हिंदी में।',
    marathi:  'CRITICAL LANGUAGE RULE (MUST FOLLOW — NO EXCEPTIONS): फक्त मराठीत उत्तर द्या. एकही इंग्रजी वाक्य लिहू नका. गणिताचे formulas आणि technical terms English मध्ये ठीक आहे.',
    bengali:  'CRITICAL LANGUAGE RULE (MUST FOLLOW — NO EXCEPTIONS): শুধুমাত্র বাংলায় উত্তর দিন। একটিও ইংরেজি বাক্য লিখবেন না। গণিতের formulas এবং technical terms English এ লেখা ঠিক আছে।',
    tamil:    'CRITICAL LANGUAGE RULE (MUST FOLLOW — NO EXCEPTIONS): எப்போதும் தமிழில் மட்டுமே பதில் கொடுங்கள். ஒரு ஆங்கில வாக்கியமும் வேண்டாம். கணித formulas மற்றும் technical terms English இல் சரி.',
    telugu:   'CRITICAL LANGUAGE RULE (MUST FOLLOW — NO EXCEPTIONS): ఎల్లప్పుడూ తెలుగులో మాత్రమే సమాధానం ఇవ్వండి. ఒక్క ఇంగ్లీష్ వాక్యం కూడా వద్దు. గణిత formulas మరియు technical terms English లో సరే.',
    gujarati: 'CRITICAL LANGUAGE RULE (MUST FOLLOW — NO EXCEPTIONS): હંમેશા ફક્ત ગુજરાતીમાં જ જવાબ આપો. એક પણ અંગ્રેજી વાક્ય ન લખો. ગણિતના formulas અને technical terms English માં ઠીક છે.',
    kannada:  'CRITICAL LANGUAGE RULE (MUST FOLLOW — NO EXCEPTIONS): ಯಾವಾಗಲೂ ಕನ್ನಡದಲ್ಲಿ ಮಾತ್ರ ಉತ್ತರಿಸಿ. ಒಂದೇ ಒಂದು ಇಂಗ್ಲಿಷ್ ವಾಕ್ಯ ಬೇಡ. ಗಣಿತದ formulas ಮತ್ತು technical terms English ನಲ್ಲಿ ಸರಿ.',
    punjabi:  'CRITICAL LANGUAGE RULE (MUST FOLLOW — NO EXCEPTIONS): ਹਮੇਸ਼ਾ ਸਿਰਫ਼ ਪੰਜਾਬੀ ਵਿੱਚ ਜਵਾਬ ਦਿਓ। ਇੱਕ ਵੀ ਅੰਗਰੇਜ਼ੀ ਵਾਕ ਨਾ ਲਿਖੋ। ਗਣਿਤ ਦੇ formulas ਅਤੇ technical terms English ਵਿੱਚ ਠੀਕ ਹੈ।',
    odia:     'CRITICAL LANGUAGE RULE (MUST FOLLOW — NO EXCEPTIONS): ସର୍ବଦା କେବଳ ଓଡ଼ିଆରେ ଉତ୍ତର ଦିଅ। ଗୋଟିଏ ବି ଇଂରାଜୀ ବାକ୍ୟ ଲେଖ ନାହିଁ। ଗଣିତ formulas ଏବଂ technical terms English ରେ ଠିକ ଅଛି।',
  };

  const modeMap = {
    cgl:         'SSC CGL (Tier 1 & 2: Quantitative Aptitude, English, Reasoning, General Knowledge)',
    chsl:        'SSC CHSL (10+2 level: Quant, English, Reasoning, GK)',
    gd:          'SSC GD Constable (Basic Maths, Reasoning, GK, English)',
    mts:         'SSC MTS (10th level: Numerical Aptitude, Reasoning, GK, English)',
    cpo:         'SSC CPO/SI (Reasoning, Quantitative Aptitude, English, GK)',
    upsc:        'UPSC Civil Services Exam (GS 1-4: History, Geography, Polity, Economy, Environment, Ethics, Current Affairs; CSAT; Optional subjects)',
    rrb:         'RRB NTPC/JE (Mathematics, General Intelligence & Reasoning, General Awareness, General Science)',
    ibps:        'IBPS PO/Clerk (Quantitative Aptitude, Reasoning, English Language, General/Financial Awareness, Computer Knowledge)',
    nda:         'NDA Exam (Mathematics: Algebra, Matrices, Calculus, Statistics; General Ability: Physics, Chemistry, Geography, History, English)',
    cuet:        'CUET UG (Domain subjects, General Test: Quantitative Reasoning, English, GK; for top central university admissions)',
    cds:         'CDS Exam (English, General Knowledge, Elementary Mathematics for Indian Military Academy, Naval Academy, Air Force Academy)',
    cat:         'CAT/MBA Entrance (Quantitative Ability, Data Interpretation & Logical Reasoning, Verbal Ability & Reading Comprehension)',
    gate:        'GATE Exam (Engineering Mathematics, subject-specific core: Digital Logic, DSA, OS, DBMS, Networks, TOC, Algorithms for CS)',
    jee:         'JEE Main & Advanced (Physics: Mechanics, Electrodynamics, Optics, Modern Physics; Chemistry: Physical, Organic, Inorganic; Mathematics: Calculus, Algebra, Coordinate Geometry, Vectors)',
    neet:        'NEET UG (Physics: Mechanics, Thermodynamics, Optics; Chemistry: Physical, Organic, Inorganic; Biology: Botany, Zoology — NCERT based)',
    class1:      'Class 1 CBSE/NCERT (Basic counting 1-100, alphabets A-Z, simple words, shapes, colors, EVS - family, animals, plants)',
    class2:      'Class 2 CBSE/NCERT (Numbers up to 1000, addition/subtraction, simple sentences, EVS - food, shelter, clothing)',
    class3:      'Class 3 CBSE/NCERT (Numbers up to 9999, multiplication, division basics, paragraph writing, EVS - plants, animals, water)',
    class4:      'Class 4 CBSE/NCERT (Large numbers, fractions, geometry basics, creative writing, Science - food, materials, living things)',
    class5:      'Class 5 CBSE/NCERT (Number operations, HCF/LCM, decimals, essays, Science - plants, animals, Earth, Social - maps, communities)',
    class6:      'Class 6 CBSE/NCERT (Integers, fractions, geometry, algebra intro, Science - food, materials, motion, Social - history from ancient India, geography, civics)',
    class7:      'Class 7 CBSE/NCERT (Rational numbers, linear equations, triangles, Science - nutrition, respiration, weather, Social - medieval India, resources, democracy)',
    class8:      'Class 8 CBSE/NCERT (Linear equations, exponents, quadrilaterals, Science - crop production, metals, combustion, Social - modern India, land use, parliament)',
    class9:      'Class 9 CBSE/NCERT (Number systems, polynomials, coordinate geometry, Euclids geometry, Science - matter, atoms, tissue, motion, force, Social - French Revolution, climate, elections)',
    class10:     'Class 10 Board Exam CBSE/NCERT (Quadratic equations, AP, triangles, circles, trigonometry, statistics, Science - chemical reactions, acids, metals, life processes, electricity, Social - nationalism, resources, democracy, development, money)',
    class11_sci: 'Class 11 Science CBSE/NCERT (Physics: motion, laws of motion, work, thermodynamics; Chemistry: structure of atom, chemical bonding, equilibrium, organic; Math: sets, relations, trigonometry, limits, statistics; Biology: cell, biomolecules, plant physiology)',
    class11_arts: 'Class 11 Arts CBSE/NCERT (History: early societies, empires, changing traditions; Geography: India - structure, climate, vegetation; Political Science: constitution, rights, citizenship; Economics: development, poverty, employment)',
    class12_sci: 'Class 12 Science Board Exam CBSE/NCERT (Physics: electrostatics, current, magnetism, waves, optics, modern physics; Chemistry: solutions, electrochemistry, chemical kinetics, surface chemistry, organic reactions; Math: matrices, calculus, vectors, linear programming, probability; Biology: reproduction, genetics, evolution, ecology)',
    class12_arts: 'Class 12 Arts Board Exam CBSE/NCERT (History: bricks/beads/bones, kings/chronicles, bhakti-sufi, colonialism; Geography: population, migration, industries; Political Science: cold war, nation building, democracy; Economics: macroeconomics)',
    // B.Tech Engineering
    btech_cs:    'B.Tech Computer Science Engineering (Data Structures & Algorithms, Operating Systems, DBMS, Computer Networks, TOC, Compiler Design, Software Engineering, OOP - C++/Java, Web Development, Python)',
    btech_ai:    'B.Tech Artificial Intelligence & Machine Learning (Python, Machine Learning algorithms, Deep Learning, Neural Networks, NLP, Computer Vision, Data Science, Statistics, Linear Algebra)',
    btech_ds:    'B.Tech Data Science (Python, R, Statistics, Machine Learning, Big Data - Hadoop/Spark, Data Visualization, SQL, Data Mining, Probability)',
    btech_it:    'B.Tech Information Technology (Networking, Cybersecurity, Database Systems, Web Development, Cloud Computing, Software Testing, IT Infrastructure)',
    btech_ec:    'B.Tech Electronics & Communication Engineering (Analog/Digital Electronics, Signals & Systems, Communication Systems, Microprocessors, VLSI, Embedded Systems, Electromagnetic Theory)',
    btech_ee:    'B.Tech Electrical Engineering (Circuit Theory, Power Systems, Electrical Machines, Power Electronics, Control Systems, Measurements, High Voltage Engineering)',
    btech_me:    'B.Tech Mechanical Engineering (Engineering Mechanics, Thermodynamics, Fluid Mechanics, Manufacturing Processes, Machine Design, Heat Transfer, CAD/CAM)',
    btech_ce:    'B.Tech Civil Engineering (Structural Analysis, RCC Design, Fluid Mechanics, Soil Mechanics, Transportation Engineering, Surveying, Environmental Engineering)',
    btech_ch:    'B.Tech Chemical Engineering (Chemical Process Calculations, Thermodynamics, Heat Transfer, Mass Transfer, Reaction Engineering, Process Control)',
    // B.Sc
    bsc_cs:      'B.Sc Computer Science (Programming in C/C++/Python/Java, Data Structures, Algorithms, DBMS, Operating Systems, Numerical Methods, Discrete Mathematics)',
    bsc_physics: 'B.Sc Physics (Classical Mechanics, Thermodynamics, Electrodynamics, Quantum Mechanics, Optics, Nuclear Physics, Statistical Mechanics)',
    bsc_chem:    'B.Sc Chemistry (Physical Chemistry: thermodynamics, kinetics, quantum; Organic Chemistry: reactions, mechanisms, synthesis; Inorganic Chemistry: bonding, coordination, s/p/d block)',
    bsc_maths:   'B.Sc Mathematics (Real Analysis, Abstract Algebra, Linear Algebra, Differential Equations, Complex Analysis, Numerical Methods, Topology, Probability & Statistics)',
    bsc_bio:     'B.Sc Biology/Zoology (Cell Biology, Genetics, Evolution, Microbiology, Plant Physiology, Animal Physiology, Ecology, Biochemistry, Biotechnology)',
    // BCA/MCA/Commerce
    bca:         'BCA (Bachelor of Computer Applications): Programming (C, C++, Java, Python), Web Development, DBMS, Data Structures, Networking, Software Engineering, Mathematics)',
    mca:         'MCA (Master of Computer Applications): Advanced Algorithms, System Software, Advanced DBMS, Software Architecture, Cloud Computing, Data Science, Research Methods)',
    // Diploma
    diploma_cs:  'Diploma in Computer Science (C Programming, Data Structures, DBMS, Web Design, Computer Networks, Operating Systems)',
    diploma_ec:  'Diploma in Electronics (Electronic Devices, Digital Electronics, Microcontrollers, Communication Systems, Industrial Electronics)',
    diploma_me:  'Diploma in Mechanical Engineering (Engineering Drawing, Machine Design, Manufacturing Technology, Thermodynamics, Fluid Mechanics)',
    diploma_civil: 'Diploma in Civil Engineering (Building Construction, Surveying, Concrete Technology, Structural Analysis, Water Supply & Sanitation)',
  };

  const grade = _getGradeLevel(state.sscMode);
  const isClassMode = state.sscMode.startsWith('class');
  const modeDesc = modeMap[state.sscMode] || 'general education';
  const wordLimit = state.shortResponseMode ? 90 : (grade && grade <= 2 ? 120 : grade && grade <= 5 ? 150 : grade && grade <= 8 ? 200 : 290);

  if (isClassMode) {
    // Grade-appropriate teaching style and persona
    let teacherPersona = '';
    let languageRule = '';
    let methodRules = '';

    if (grade && grade <= 2) {
      // Class 1-2: Very young child (6-7 years old)
      teacherPersona = 'You are a warm, loving Class ' + grade + ' primary school teacher. You MUST teach exactly like a real Class ' + grade + ' teacher for a ' + (grade === 1 ? '5-6' : '6-7') + ' year old child. Use the simplest possible words, playful tone, and short fun sentences a small child loves.';
      languageRule = 'STRICT: Use ONLY simple short words a ' + (grade === 1 ? '5-6' : '6-7') + ' year old knows. Max 6-8 words per sentence. Use fun emojis \u2b50\U0001f389\U0001f436\U0001f34e between steps. Sound like a loving fun teacher, never a textbook.';
      methodRules = `- Start with "Wah beta! 🌟" or "Good question! 😊" to encourage the child
- Break everything into tiny, simple steps
- Use real objects children know: apples, toys, fingers, balls, flowers
- For counting/math: use fingers, drawing, counting objects
- For letters/words: give fun sounds and pictures in words
- Always end with "Try karo!" or a simple fun activity
- If asked anything outside Class 1-2 syllabus, gently say "Yeh aage padho ge! Abhi Class 1 ka seekhte hain 😊"`;
    } else if (grade && grade <= 5) {
      // Class 3-5: Upper primary (8-10 years)
      teacherPersona = 'You are a friendly, enthusiastic primary school teacher for a Class ' + grade + ' student (age 8-10).';
      languageRule = 'Use simple, clear language. Short paragraphs. Friendly, encouraging tone like a helpful didi/bhaiya. Mix simple English with Hindi words naturally.';
      methodRules = `- Use relatable real-life examples (cricket, school, food, family)
- For Math: show step-by-step working with numbers written out clearly
- For Science: use simple experiments or observations kids can do at home
- For English: give examples and simple sentences
- Use tables or numbered lists when explaining steps
- End with a fun memory trick: "Yaad rakho: [simple trick]! 🧠"
- Always praise: "Bahut achha sawal! 👍"`;
    } else if (grade && grade <= 8) {
      // Class 6-8: Middle school (11-13 years)
      teacherPersona = 'You are an engaging middle school teacher for Class ' + grade + ' (CBSE/NCERT). Students are 11-13 years old.';
      languageRule = 'Use clear, student-friendly language. Relatable daily-life examples. Be like a cool teacher who makes subjects interesting.';
      methodRules = `- Connect concepts to real life (physics with sports, chemistry with cooking, history with stories)
- For Math/Science: full step-by-step solution with proper working
- For Social Science: use dates, key points, cause-effect structure
- Use diagrams in text format when helpful (e.g., simple ASCII or labeled points)
- Highlight important terms in **bold**
- Give formula/definition first, then example, then practice hint
- End with: "Quick Trick: [memory shortcut]" or "Exam Tip: [what's usually asked]"`;
    } else if (grade === 9) {
      // Class 9: Pre-board
      teacherPersona = 'You are an expert Class 9 CBSE/NCERT teacher. Students are preparing for board exams and need solid conceptual clarity.';
      languageRule = 'Use clear academic language with proper terminology. Explain concepts deeply but in an approachable way.';
      methodRules = `- Start with the concept/definition (NCERT exact)
- Give full step-by-step solution for Math/Science
- For theory: Key points → Explanation → Example → Possible exam question
- Highlight important NCERT terms in **bold**
- For diagrams: describe clearly with labels
- End with "Exam Tip: [what Class 9/Board usually asks about this]"
- Reference NCERT chapter/topic when relevant`;
    } else {
      // Class 10-12: Board exam focused
      const boardLabel = grade === 10 ? 'Class 10 Board' : grade === 11 ? 'Class 11' : 'Class 12 Board';
      teacherPersona = `You are an expert ${boardLabel} CBSE/NCERT teacher. Students are serious board exam aspirants who need precise, exam-ready answers.`;
      languageRule = 'Use precise academic language. Follow NCERT/CBSE format strictly. Be comprehensive but focused on what matters for boards.';
      methodRules = `- Answer exactly as CBSE board expects (marks allocation style)
- For Math: complete solution with all steps, formulae, substitution, answer
- For Science: definition → concept → derivation/example → application → diagram hint
- For theory questions: use headings, bullet points, key terms **bolded**
- Mention "Board Exam Insight: [what type of question this is, typical marks]"
- For 1-mark: crisp definition/answer
- For 3-5 marks: full structured answer
- End with "Pro Tip: [common board exam mistake to avoid]"
- Always cite relevant NCERT chapter`;
    }

    const langInstruction = langMap[state.aiLang] || langMap['hinglish'];

    return `${AI_IDENTITY_BLOCK}

${langInstruction}

${teacherPersona}

TEACHING STYLE:
${languageRule}

RULES:
${methodRules}
- Always follow NCERT/CBSE syllabus strictly for ${modeDesc}
- Keep responses under ${wordLimit} words
- If a question is outside this class's syllabus, mention it gently and redirect

SUBJECT COVERAGE: ${modeDesc}${_getPersonaBlock()}`;
  }

  // SSC Exam Mode
  return `${AI_IDENTITY_BLOCK}

${langMap[state.aiLang]}

You are PrepAI, an expert SSC exam coach focused on ${modeDesc}.

TEACHING APPROACH:
- Give the shortcut/formula first, then explain
- Use actual SSC exam-style examples and past question patterns
- For Maths: complete step-by-step solution + shortcut trick
- For Reasoning: show the pattern/logic clearly
- For English: give rule + example + common error
- For GK: fact + context + exam relevance

RULES:
- Keep responses under ${wordLimit} words
- End with "Exam Tip: [one quick tip for SSC]"
- Prioritize speed-solving techniques
- Mention if it's a frequently asked SSC topic

TOPICS: Quantitative Aptitude, English Language, General Reasoning, General Knowledge/Current Affairs.${_getPersonaBlock()}`;
}

// Returns optimal max_tokens for current mode (saves API cost)
function getOptimalMaxTokens(hasVision) {
  const grade = _getGradeLevel(state.sscMode);
  if (state.shortResponseMode) return 200;
  // Voice/Teacher: spoken answers are short — cap at 180 tokens (saves ~65% output cost)
  const currentModel = window.voiceAI?.getState?.()?.model;
  if (currentModel === 'teacher' || currentModel === 'voice' || currentModel === 'voice-text') return 180;
  if (hasVision) return grade && grade <= 5 ? 350 : 500;
  if (grade && grade <= 2) return 280;
  if (grade && grade <= 5) return 280;
  if (grade && grade <= 8) return 320;
  return 500; // Class 9-12 / SSC
}

// ===== AI CALLS =====
async function callAI(userMessage, chatHistory = [], imageBase64Array = [], pdfBase64 = null) {
  const hasImage = imageBase64Array.length > 0;
  const hasPdf = !!pdfBase64;
  if (hasImage || hasPdf) {
    if (dom.aiStatus) dom.aiStatus.innerHTML = '● 🔍 AI Solving...';
    // Step 1: Extract visual content via DeepSeek Vision / PDF parser
    const visualText = await callDeepSeekVision(userMessage, chatHistory, imageBase64Array, pdfBase64);
    // Step 2: For pro models, do a deeper DeepSeek analysis pass
    const model = typeof selectedModel !== 'undefined' ? selectedModel : 'vision';
    if (model === 'vision-pro' || model === 'pro') {
      if (dom.aiStatus) dom.aiStatus.innerHTML = '● ✨ PrepAI Pro Analyzing...';
      try {
        const enhanced = await callDeepSeek(
          `The user uploaded an image/document. Here is what was extracted:\n\n${visualText}\n\nNow give an enhanced, detailed explanation with step-by-step reasoning for: ${userMessage}`,
          chatHistory
        );
        return enhanced;
      } catch(e) {
        return visualText;
      }
    }
    return visualText;
  } else {
    if (dom.aiStatus) dom.aiStatus.innerHTML = '● 🧠 AI Thinking...';
    return await callDeepSeek(userMessage, chatHistory);
  }
}

async function callDeepSeek(userMessage, chatHistory = []) {
  const cacheHash = CacheManager.hashRequest(
    userMessage, 
    state.aiLang, 
    state.sscMode, 
    state.shortResponseMode
  );
  
  // ── USE REQUEST DEDUPLICATION ─────────────────────────────
  // If another request is already getting this data, wait for it
  return CacheManager.getOrWait(cacheHash, async () => {
    // ── CHECK GLOBAL CACHE FIRST ──────────────────────────────
    const cachedResponse = CacheManager.get(cacheHash, 'responses');
    if (cachedResponse) {
      SecureLogger.info('[Cache Hit] Served from global cache');
      return cachedResponse;
    }

    // ── CHECK LEGACY USER CACHE (for backward compatibility) ────
    if (state.cachingEnabled) {
      const legacyCacheKey = `ds:${state.aiLang}:${state.sscMode}:${userMessage.trim().toLowerCase().substring(0, 100)}`;
      if (state.responseCache[legacyCacheKey]) {
        return state.responseCache[legacyCacheKey];
      }
    }

    const firebaseUser = window._firebaseAuth?.currentUser;
    if (!firebaseUser) throw new Error('Please login first');

    const systemPrompt = getSystemPrompt();

    // NO history sent — only system prompt + current user message
    // This saves 60-80% of input tokens on every request
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userMessage });

    const isVoiceMode = ['teacher', 'voice', 'voice-text'].includes(window.voiceAI?.getState?.()?.model);
    const _dsToken = await firebaseUser.getIdToken().catch(() => null);
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(_dsToken ? { 'Authorization': 'Bearer ' + _dsToken } : {})
      },
      body: JSON.stringify({
        model: getDeepSeekModel(),
        messages,
        max_tokens: getOptimalMaxTokens(false),
        temperature: isVoiceMode ? 0.5 : 0.7,
        mode: state.sscMode,
        lang: state.aiLang,
        shortMode: state.shortResponseMode
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      // Check for maintenance or quota issues
      if (errData?.code === 'MAINTENANCE' || 
          errData?.code === 'INSUFFICIENT_BALANCE' ||
          errData?.code === 'QUOTA_EXCEEDED' ||
          errData?.code === 'BILLING_ERROR' ||
          errData?.error?.includes('balance') ||
          errData?.error?.includes('quota') ||
          errData?.error?.includes('billing') ||
          response.status === 429 ||
          response.status === 503) {
        const maintErr = new Error('AI service temporarily unavailable');
        maintErr.isMaintenance = true;
        throw maintErr;
      }
      throw new Error(`DeepSeek Error ${response.status}: ${errData?.error || errData?.error?.message || 'Server error'}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const result = text || 'Sorry, kuch ho gaya. Please try again.';
    
    // ── CACHE RESPONSE IN BOTH LEGACY AND NEW SYSTEMS ────────
    if (state.cachingEnabled && text) {
      // Legacy cache (user-specific)
      const legacyCacheKey = `ds:${state.aiLang}:${state.sscMode}:${userMessage.trim().toLowerCase().substring(0, 100)}`;
      state.responseCache[legacyCacheKey] = result;
      saveState();
    }
    
    // New global cache (shared across all users) — getOrWait handles this
    return result;
  }, 'responses');
}


// ===== DeepSeek Vision & PDF Analysis (replaces Gemini) =====
/**
 * callDeepSeekVision — handles image screenshots and PDF files.
 * 
 * For PDFs: extracts text from base64 PDF using pdf-parse via /api/deepseek
 * For Images: converts base64 to a descriptive prompt and sends to DeepSeek
 * DeepSeek V3 / deepseek-chat is used (latest model with real-time web data).
 */
// ===== IMAGE & PDF ANALYSIS =====
// Architecture:
//   Images → Gemini Flash (can actually see images) → extract text/solution
//   PDFs   → pdf.js client-side text extract → DeepSeek answers
//   Both   → DeepSeek for final polished answer in user's language/persona

/**
 * callGeminiForImage — sends base64 image(s) to Gemini Flash via proxy.
 * Returns the raw extracted text/analysis from Gemini.
 */
async function callGeminiForImage(userMessage, imageBase64Array) {
  // ── 1. CHECK IMAGE CACHE ──────────────────────────────────
  const imageHash = await CacheManager.hashData(imageBase64Array[0]?.data || '');
  const messageHash = CacheManager.hashRequest(userMessage, state.aiLang, 'vision', false);
  const combinedHash = imageHash + ':' + messageHash;
  
  const cachedImageResult = CacheManager.get(combinedHash, 'images');
  if (cachedImageResult) {
    SecureLogger.info('[Cache Hit] Served image from cache');
    return cachedImageResult;
  }

  // Route through DEEPSEEK_API_URL with isVision:true.
  // The backend deepseek function already has a vision path that calls Gemini
  // internally using the server-side GEMINI_API_KEY env var — the key is never
  // exposed to the client and the Cloud Run URL is always reachable.
  const firebaseUser = window._firebaseAuth?.currentUser;
  if (!firebaseUser) throw new Error('Please login first');

  const systemPrompt = getSystemPrompt();

  const res = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      isVision: true,
      images: imageBase64Array.map(img => ({
        mimeType: img.mimeType || 'image/jpeg',
        data: img.data
      })),
      messages: [
        {
          role: 'system',
          content: systemPrompt ||
            'You are a helpful AI exam tutor. Analyze images carefully and give complete step-by-step solutions.'
        },
        {
          role: 'user',
          content: userMessage ||
            'Read this image carefully. Identify every question, diagram, or text visible. Provide a complete step-by-step solution.'
        }
      ],
      max_tokens: 1500,
      temperature: 0.4,
      mode: state.sscMode,
      lang: state.aiLang
    })
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(`Vision Error ${res.status}: ${e?.error || 'Image reading failed'}`);
  }
  const data = await res.json();
  const result = data.choices?.[0]?.message?.content || data.text || '';
  
  // ── 2. CACHE IMAGE RESULT ──────────────────────────────────
  if (result) {
    CacheManager.set(combinedHash, result, 'images');
  }
  
  return result;
}

/**
 * extractPdfTextClientSide — uses pdf.js (loaded from CDN) to extract text
 * from a base64-encoded PDF entirely in the browser.
 */
async function extractPdfTextClientSide(pdfBase64) {
  // Lazy-load pdf.js from CDN if not already loaded
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const pdfData   = atob(pdfBase64);
  const pdfBytes  = new Uint8Array(pdfData.length);
  for (let i = 0; i < pdfData.length; i++) pdfBytes[i] = pdfData.charCodeAt(i);

  const loadingTask = window.pdfjsLib.getDocument({ data: pdfBytes });
  const pdf = await loadingTask.promise;
  let fullText = '';

  const maxPages = Math.min(pdf.numPages, 20); // cap at 20 pages
  for (let i = 1; i <= maxPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += `\n--- Page ${i} ---\n${pageText}`;
  }
  return fullText.trim();
}

/**
 * callDeepSeekVision — orchestrates image/PDF analysis:
 * 1. Images: Gemini reads → DeepSeek polishes the answer
 * 2. PDFs:   pdf.js extracts text → DeepSeek answers
 */
async function callDeepSeekVision(userMessage, chatHistory = [], imageBase64Array = [], pdfBase64 = null) {
  const systemPrompt = getSystemPrompt();

  // NO history — only current message sent to save tokens
  const baseHistory = [];

  // ── IMAGE PATH ─────────────────────────────────────────────
  if (imageBase64Array.length > 0) {
    if (dom.aiStatus) dom.aiStatus.innerHTML = '● 👁️ Reading image...';

    let geminiText = '';
    try {
      geminiText = await callGeminiForImage(userMessage, imageBase64Array);
    } catch (geminiErr) {
      SecureLogger.warn('[Gemini image read failed]', geminiErr.message);
      // Fallback: ask DeepSeek to answer based on user description alone
      return await callDeepSeek(
        `The user sent an image but vision is temporarily unavailable. Their question was: "${userMessage}". Please help them as best you can and ask them to describe the image content if needed.`,
        chatHistory
      );
    }

    if (!geminiText) {
      return 'Sorry, image ko read nahi kar paya. Please image describe karo ya question type karo.';
    }

    // Step 2: DeepSeek gives the polished, persona-aware final answer
    if (dom.aiStatus) dom.aiStatus.innerHTML = '● 🧠 Solving...';
    const prompt = `The user uploaded an image. Here is what I read from it:

${geminiText}

---
User's question: ${userMessage || 'Please solve this.'}

Give a complete, step-by-step solution in the user's preferred language. Be thorough.`;
    return await callDeepSeek(prompt, baseHistory);
  }

  // ── PDF PATH ───────────────────────────────────────────────
  if (pdfBase64) {
    if (dom.aiStatus) dom.aiStatus.innerHTML = '● 📄 Reading PDF...';

    let pdfText = '';
    try {
      pdfText = await extractPdfTextClientSide(pdfBase64);
    } catch (pdfErr) {
      SecureLogger.warn('[PDF.js extract failed]', pdfErr.message);
      pdfText = ''; // fall through — DeepSeek will respond without content
    }

    if (!pdfText || pdfText.length < 20) {
      return await callDeepSeek(
        `The user uploaded a PDF but text extraction failed (possibly scanned/image PDF). Their question: "${userMessage}". Please let them know and suggest they copy-paste the text or describe the content.`,
        baseHistory
      );
    }

    if (dom.aiStatus) dom.aiStatus.innerHTML = '● 🧠 Analyzing PDF...';
    const prompt = `The user uploaded a PDF document. Extracted text (${pdfText.length} chars):

${pdfText.substring(0, 12000)}

---
User's question: ${userMessage || 'Please summarize and explain this PDF.'}

Give a detailed, helpful answer based on the PDF content.`;
    return await callDeepSeek(prompt, baseHistory);
  }

  return 'No image or PDF found to analyze.';
}



// ===== MARKDOWN =====
function formatMarkdown(text) {
  if (!text) return '';

  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Extract fenced code blocks first
  const codeBlocks = [];
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, function(_, lang, code) {
    var idx = codeBlocks.length;
    var langLabel = lang ? '<span class="cb-lang">' + esc(lang) + '</span>' : '';
    codeBlocks.push(
      '<div class="code-block">' +
        '<div class="cb-header">' + langLabel +
          '<button class="cb-copy" onclick="(function(b){var p=b.closest(\'.code-block\').querySelector(\'code\');navigator.clipboard.writeText(p.innerText);b.textContent=\'Copied!\';setTimeout(function(){b.textContent=\'Copy\'},1500);})(this)">Copy</button>' +
        '</div>' +
        '<pre><code>' + esc(code.trim()) + '</code></pre>' +
      '</div>'
    );
    return '\x00CODE' + idx + '\x00';
  });

  function inlineFormat(s) {
    return s
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/_([^_]+)_/g, '<em>$1</em>');
  }

  var lines = text.split('\n');
  var out = [];
  var inUL = false, inOL = false;

  function closeList() {
    if (inUL) { out.push('</ul>'); inUL = false; }
    if (inOL) { out.push('</ol>'); inOL = false; }
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var h3 = line.match(/^### (.+)/);
    var h2 = line.match(/^## (.+)/);
    var h1 = line.match(/^# (.+)/);
    var hr = /^---+$/.test(line.trim());
    var ul = line.match(/^[-*]\s+(.+)/);
    var ol = line.match(/^\d+\.\s+(.+)/);

    if (h3) { closeList(); out.push('<h3>' + inlineFormat(esc(h3[1])) + '</h3>'); continue; }
    if (h2) { closeList(); out.push('<h2>' + inlineFormat(esc(h2[1])) + '</h2>'); continue; }
    if (h1) { closeList(); out.push('<h1>' + inlineFormat(esc(h1[1])) + '</h1>'); continue; }
    if (hr) { closeList(); out.push('<hr class="md-hr">'); continue; }

    if (ul) {
      if (inOL) { out.push('</ol>'); inOL = false; }
      if (!inUL) { out.push('<ul>'); inUL = true; }
      out.push('<li>' + inlineFormat(esc(ul[1])) + '</li>');
      continue;
    }
    if (ol) {
      if (inUL) { out.push('</ul>'); inUL = false; }
      if (!inOL) { out.push('<ol>'); inOL = true; }
      out.push('<li>' + inlineFormat(esc(ol[1])) + '</li>');
      continue;
    }

    if (line.trim() === '') { closeList(); out.push('<br>'); continue; }

    closeList();
    out.push('<p>' + inlineFormat(esc(line)) + '</p>');
  }
  closeList();

  var html = out.join('\n');
  // Restore code blocks
  html = html.replace(/\x00CODE(\d+)\x00/g, function(_, i) { return codeBlocks[i]; });
  // Clean leading/trailing breaks
  html = html.replace(/^(<br>\s*\n?)+/, '').replace(/(<br>\s*\n?)+$/, '');
  return html;
}

// ===== MESSAGES =====
function addMessage(role, content, isStreaming = false, attachments = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  // AI uses app logo SVG, user uses initials
  let avatarHtml;
  if (role === 'ai') {
    const uid = Date.now();
    avatarHtml = `<div class="message-avatar ai-avatar-svg">
      <svg width="20" height="20" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="msgTop${uid}" x1="8" y1="4" x2="48" y2="28" gradientUnits="userSpaceOnUse"><stop stop-color="#9B8FFF"/><stop offset="1" stop-color="#6C63FF"/></linearGradient>
          <linearGradient id="msgSide${uid}" x1="28" y1="28" x2="48" y2="52" gradientUnits="userSpaceOnUse"><stop stop-color="#4A42CC"/><stop offset="1" stop-color="#3D36A8"/></linearGradient>
          <linearGradient id="msgFront${uid}" x1="8" y1="28" x2="28" y2="52" gradientUnits="userSpaceOnUse"><stop stop-color="#7B72FF"/><stop offset="1" stop-color="#FF6B9D"/></linearGradient>
        </defs>
        <polygon points="28,4 50,16 28,28 6,16" fill="url(#msgTop${uid})"/>
        <polygon points="50,16 50,40 28,52 28,28" fill="url(#msgSide${uid})"/>
        <polygon points="28,28 28,52 6,40 6,16" fill="url(#msgFront${uid})"/>
        <text x="28" y="34" text-anchor="middle" font-family="'Space Grotesk',sans-serif" font-weight="800" font-size="11" fill="white" opacity="0.95" letter-spacing="-0.5">AI</text>
        <polygon points="28,4 50,16 28,28 6,16" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="0.8"/>
      </svg>
    </div>`;
  } else {
    const userInitial = state.user?.name?.[0]?.toUpperCase() || 'U';
    avatarHtml = `<div class="message-avatar">${userInitial}</div>`;
  }

  let attachHtml = '';
  if (attachments?.images?.length) {
    attachHtml = `<div class="msg-attachments">${attachments.images.map(img =>
      `<img src="data:${img.mimeType};base64,${img.data}" class="msg-thumb" alt="uploaded image"/>`
    ).join('')}</div>`;
  }
  if (attachments?.pdfName) {
    attachHtml += `<div class="msg-pdf-badge">📄 ${escapeHtml(attachments.pdfName)}</div>`;
  }

  const actionBtns = role === 'ai' ? `
    <button class="msg-action-btn copy-btn" onclick="copyMessageContent(this)" title="Copy">📋</button>
    <button class="msg-action-btn bookmark-btn" onclick="bookmarkMessage(this)" title="Bookmark">🔖</button>
    <button class="msg-action-btn share-btn" onclick="shareMessage(this)" title="Share">📤</button>
    <button class="msg-action-btn msg-speak-btn" onclick="speakMessage(this)" title="Hear answer">🔊</button>
  ` : '';

  messageDiv.innerHTML = `
    ${avatarHtml}
    <div class="message-content">
      ${attachHtml}
      <div class="message-bubble">${isStreaming ? content : formatMarkdown(content)}</div>
      <div class="message-meta">
        <span class="message-time">${time}</span>
        <div class="msg-actions">${actionBtns}</div>
      </div>
    </div>
  `;

  dom.messages.appendChild(messageDiv);
  scrollToBottom();
  return messageDiv;
}

function updateMessageBubble(messageDiv, content) {
  const bubble = messageDiv?.querySelector('.message-bubble');
  if (bubble) bubble.innerHTML = formatMarkdown(content);
  scrollToBottom();
}

function addTypingIndicator() {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message ai';
  typingDiv.id = 'typing-indicator';
  typingDiv.innerHTML = `
    <div class="message-avatar ai-avatar-svg">
      <svg width="20" height="20" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="typTop" x1="8" y1="4" x2="48" y2="28" gradientUnits="userSpaceOnUse"><stop stop-color="#9B8FFF"/><stop offset="1" stop-color="#6C63FF"/></linearGradient>
          <linearGradient id="typSide" x1="28" y1="28" x2="48" y2="52" gradientUnits="userSpaceOnUse"><stop stop-color="#4A42CC"/><stop offset="1" stop-color="#3D36A8"/></linearGradient>
          <linearGradient id="typFront" x1="8" y1="28" x2="28" y2="52" gradientUnits="userSpaceOnUse"><stop stop-color="#7B72FF"/><stop offset="1" stop-color="#FF6B9D"/></linearGradient>
        </defs>
        <polygon points="28,4 50,16 28,28 6,16" fill="url(#typTop)"/>
        <polygon points="50,16 50,40 28,52 28,28" fill="url(#typSide)"/>
        <polygon points="28,28 28,52 6,40 6,16" fill="url(#typFront)"/>
        <text x="28" y="34" text-anchor="middle" font-family="'Space Grotesk',sans-serif" font-weight="800" font-size="11" fill="white" opacity="0.95" letter-spacing="-0.5">AI</text>
        <polygon points="28,4 50,16 28,28 6,16" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="0.8"/>
      </svg>
    </div>
    <div class="message-content">
      <div class="message-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>
  `;
  dom.messages.appendChild(typingDiv);
  scrollToBottom();
}

function removeTypingIndicator() { document.getElementById('typing-indicator')?.remove(); }
function scrollToBottom() {
  if (!dom.messagesContainer) return;
  const c = dom.messagesContainer;
  // Only auto-scroll if user is already near the bottom (within 200px)
  const nearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 200;
  if (!nearBottom) return;
  requestAnimationFrame(() => {
    c.scrollTop = c.scrollHeight;
  });
}

// ===== MESSAGE ACTIONS =====
window.copyMessageContent = function(btn) {
  const bubble = btn.closest('.message-content')?.querySelector('.message-bubble');
  if (bubble) { navigator.clipboard.writeText(bubble.innerText); showToast('✅ Copied!'); }
};
window.bookmarkMessage = function(btn) {
  const bubble = btn.closest('.message-content')?.querySelector('.message-bubble');
  if (!bubble) return;
  const content = bubble.innerText.substring(0, 300);
  const bookmark = { id: Date.now(), content, time: new Date().toLocaleString('en-IN'), sessionId: state.currentSessionId };
  state.bookmarks.unshift(bookmark);
  if (state.bookmarks.length > 50) state.bookmarks = state.bookmarks.slice(0, 50);
  saveState(); btn.textContent = '✅'; setTimeout(() => { btn.textContent = '🔖'; }, 2000); showToast('🔖 Bookmarked!');
};
window.shareMessage = function(btn) {
  const bubble = btn.closest('.message-content')?.querySelector('.message-bubble');
  if (!bubble) return;
  const text = `CrackWithAI Answer:\n\n${bubble.innerText.substring(0, 500)}\n\nPrepare with CrackWithAI 🎯`;
  if (navigator.share) { navigator.share({ title: 'CrackWithAI', text }).catch(() => {}); }
  else { navigator.clipboard.writeText(text); showToast('📋 Copied to clipboard!'); }
};

// ===== FOLLOW-UP =====
function addFollowUpSuggestions(previousQuestion) {
  const suggestions = getFollowUpSuggestions(previousQuestion);
  if (!suggestions.length) return;
  const suggestDiv = document.createElement('div');
  suggestDiv.className = 'followup-chips';
  suggestDiv.innerHTML = `<div class="followup-label">🔗 Ask follow-up:</div>` +
    suggestions.map(s => `<button class="followup-chip" onclick="sendFollowUp('${s.replace(/'/g, "\\'")}')">${s}</button>`).join('');
  dom.messages.appendChild(suggestDiv);
  scrollToBottom();
}
window.sendFollowUp = function(text) { dom.messageInput.value = text; sendMessage(); };
function getFollowUpSuggestions(question) {
  const q = question.toLowerCase();
  if (q.includes('formula') || q.includes('math')) return ['Give me practice questions', 'Show a trick to solve faster', 'Common mistakes in this topic?'];
  if (q.includes('grammar') || q.includes('english')) return ['Give me example sentences', 'Practice questions on this', 'Common errors in SSC?'];
  if (q.includes('reasoning') || q.includes('puzzle')) return ['Give me similar questions', 'What is the shortcut?', 'More examples please'];
  if (q.includes('gk') || q.includes('current affairs')) return ['Give me MCQs on this', 'What is asked in SSC exams?', 'Important related facts?'];
  return ['Give me MCQ practice', 'Explain more simply', 'Show exam tips for this topic'];
}

// ===== IMAGE HANDLING =====
// ===== IMAGE/PDF UPLOAD REMOVED =====
// Image and PDF upload have been disabled. Functions kept as no-ops for compatibility.
function setupImageUpload() { /* disabled */ }
async function handleImageSelect(e) { /* disabled */ }
async function compressImage(file) { return { base64: '', mimeType: 'image/jpeg' }; }
function setupPdfUpload() { /* disabled */ }
function setupUploadMenu() { /* disabled */ }
async function handlePdfSelect(e) { /* disabled */ }
function updateAttachmentPreview() {
  if (!dom.attachmentPreview) return;
  dom.attachmentPreview.innerHTML = '';
  dom.attachmentPreview.style.display = 'none';
}
window.removeImage = function(i) { };
window.removePdf = function() { };

// ===== SEND MESSAGE =====
async function sendMessage() {
  const message = dom.messageInput.value.trim();
  const hasImages = pendingImageFiles.length > 0;
  const hasPdf = !!pendingPdfFile;
  if (!message && !hasImages && !hasPdf) return;
  if (isSending) return;
  if (hasImages && !canSendImage()) { showToast(`❌ Daily image limit reached!`); handleLimitHit('image'); return; }
  if (hasPdf && !canSendPdf()) { showToast(`❌ Daily PDF limit reached!`); handleLimitHit('pdf'); return; }
  if (!canSendText()) { showToast(`❌ Daily text limit (${FREE_TEXT_LIMIT}) reached.`); handleLimitHit('text'); return; }
  isSending = true;
  dom.sendBtn.disabled = true;
  const msgText = message || (hasImages ? 'Solve this question from the image.' : 'Analyze this PDF and give key points.');
  dom.messageInput.value = '';
  dom.messageInput.style.height = 'auto';
  if (dom.welcomeScreen) dom.welcomeScreen.style.display = 'none';
  const attachSnap = { images: [...pendingImageFiles], pdfName: pendingPdfFile?.name || null };
  const imageData = [...pendingImageFiles];
  const pdfData = pendingPdfFile ? pendingPdfFile.data : null;
  pendingImageFiles = []; pendingPdfFile = null; updateAttachmentPreview();
  addMessage('user', msgText, false, attachSnap);
  currentMessages.push({ role: 'user', content: msgText });
  addTypingIndicator();
  if (dom.aiStatus) dom.aiStatus.innerHTML = '● Processing...';
  try {
    const response = await callAI(msgText, [], imageData, pdfData);
    removeTypingIndicator();
    addMessage('ai', response);
    currentMessages.push({ role: 'ai', content: response });
    const type = imageData.length ? 'image' : (pdfData ? 'pdf' : 'text');
    incrementCount(type);
    if (dom.aiStatus) dom.aiStatus.innerHTML = '● AI Ready';
    saveCurrentSession(msgText);
    addFollowUpSuggestions(msgText);
  } catch (err) {
    removeTypingIndicator();
    if (err.isMaintenance) {
      showMaintenanceOverlay();
    } else {
      addMessage('ai', '🔧 AI is under maintenance. Please wait or try again later.');
    }
    if (dom.aiStatus) dom.aiStatus.innerHTML = '● AI Ready';
  }
  isSending = false;
  dom.sendBtn.disabled = false;
}

/**
 * showMaintenanceOverlay — full-screen "AI under maintenance" notice.
 * Shown when the DeepSeek/AI provider runs out of credits or hits a
 * billing/quota error. Blocks further AI use until reload, since the
 * backend is genuinely unable to serve responses.
 */
function showMaintenanceOverlay() {
  if (document.getElementById('maintenanceOverlay')) return; // already shown
  const el = document.createElement('div');
  el.id = 'maintenanceOverlay';
  el.style.cssText = `
    position:fixed; inset:0; z-index:99999;
    background:rgba(10,10,15,0.92); backdrop-filter:blur(6px);
    display:flex; align-items:center; justify-content:center;
    padding:20px; text-align:center;
  `;
  el.innerHTML = `
    <div style="max-width:420px; background:#15131f; border:1px solid rgba(108,99,255,0.3);
                border-radius:16px; padding:32px 24px; box-shadow:0 10px 40px rgba(0,0,0,0.5);">
      <div style="font-size:48px; margin-bottom:12px;">🛠️</div>
      <h2 style="margin:0 0 8px; color:var(--text-primary); font-size:20px;">AI Service Under Maintenance</h2>
      <p style="color:rgba(26,26,38,0.70); font-size:14px; line-height:1.6; margin:0 0 20px;">
        Our AI service is temporarily unavailable due to high demand.
        We're working on it — please come back in a little while.
      </p>
      <button onclick="location.reload()" style="
        background:#6C63FF; color:var(--text-primary); border:none; border-radius:10px;
        padding:10px 24px; font-size:14px; font-weight:600; cursor:pointer;">
        Retry
      </button>
    </div>
  `;
  document.body.appendChild(el);
}
window.showMaintenanceOverlay = showMaintenanceOverlay;

// Expose on window so patches (crackai-fixes-patch.js etc.) can call sendMessage
// and access shared state (isSending, pendingImageFiles, pendingPdfFile).
window.sendMessage         = sendMessage;
window.addMessage          = addMessage;
window.removeTypingIndicator = removeTypingIndicator;
// isSending / pendingImageFiles / pendingPdfFile are let variables; expose via
// getters/setters so patches that write to window.isSending stay in sync.
Object.defineProperty(window, 'isSending', {
  get: function() { return isSending; },
  set: function(v) { isSending = v; },
  configurable: true
});
Object.defineProperty(window, 'pendingImageFiles', {
  get: function() { return pendingImageFiles; },
  set: function(v) { pendingImageFiles = v; },
  configurable: true
});
Object.defineProperty(window, 'pendingPdfFile', {
  get: function() { return pendingPdfFile; },
  set: function(v) { pendingPdfFile = v; },
  configurable: true
});

// ===== SESSION MANAGEMENT =====
function createNewSession() {
  const id = `session_${Date.now()}`;
  const session = { id, title: 'New Chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  state.chatSessions.unshift(session);
  state.currentSessionId = id;
  currentMessages = [];
  if (dom.messages) {
    dom.messages.innerHTML = '';
    if (dom.welcomeScreen) {
      dom.welcomeScreen.style.display = '';
      dom.welcomeScreen.style.visibility = 'visible';
      dom.welcomeScreen.style.opacity = '1';
      dom.messages.appendChild(dom.welcomeScreen);
    }
  }
  // Also ensure messages-container is scrolled to top
  if (dom.messagesContainer) dom.messagesContainer.scrollTop = 0;
  saveState(); renderChatHistory();
}
function saveCurrentSession(lastUserMsg) {
  const session = state.chatSessions.find(s => s.id === state.currentSessionId);
  if (!session) return;
  session.messages = currentMessages;
  session.updatedAt = Date.now();
  const titleChanged = session.messages.length <= 2;
  if (titleChanged) session.title = lastUserMsg.substring(0, 40) || 'Chat';
  saveState();
  // Only re-render history list when title changes (avoids full DOM rebuild every message)
  if (titleChanged) renderChatHistory();
}
function loadSession(id) {
  const session = state.chatSessions.find(s => s.id === id);
  if (!session) return;
  state.currentSessionId = id; currentMessages = session.messages || [];
  if (dom.messages) {
    dom.messages.innerHTML = '';
    if (!currentMessages.length) {
      if (dom.welcomeScreen) { dom.welcomeScreen.style.display = ''; dom.messages.appendChild(dom.welcomeScreen); }
    } else {
      if (dom.welcomeScreen) dom.welcomeScreen.style.display = 'none';
      currentMessages.forEach(m => addMessage(m.role, m.content));
    }
  }
  saveState();
}
function renderChatHistory() {
  if (!dom.historyList) return;
  // Use DocumentFragment to batch all DOM inserts in one paint
  if (!state.chatSessions.length) {
    dom.historyList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">No chat history yet</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  state.chatSessions.forEach(session => {
    const date = new Date(session.updatedAt);
    const formattedDate = date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    const item = document.createElement('div');
    item.className = `history-item ${session.id === state.currentSessionId ? 'active' : ''}`;
    item.innerHTML = `<div class="history-item-icon">💬</div><div class="history-item-content"><div class="history-item-title">${escapeHtml(session.title)}</div><div class="history-item-date">${formattedDate}</div></div><button class="history-item-delete" data-id="${session.id}">🗑️</button>`;
    item.addEventListener('click', (e) => { if (!e.target.classList.contains('history-item-delete')) { loadSession(session.id); closeDrawer(); } });
    item.querySelector('.history-item-delete').addEventListener('click', (e) => { e.stopPropagation(); deleteSession(session.id); });
    frag.appendChild(item);
  });
  dom.historyList.innerHTML = '';
  dom.historyList.appendChild(frag);
}
function deleteSession(id) {
  state.chatSessions = state.chatSessions.filter(s => s.id !== id);
  if (state.currentSessionId === id) { state.chatSessions.length ? loadSession(state.chatSessions[0].id) : createNewSession(); }
  saveState(); renderChatHistory(); showToast('Chat deleted');
}
function deleteAllSessions() {
  if (confirm('Delete all chat history? This cannot be undone.')) { state.chatSessions = []; createNewSession(); saveState(); renderChatHistory(); showToast('All history cleared'); }
}
function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

// ===== DRAWER =====
function openDrawer() { if (dom.drawer) dom.drawer.classList.add('open'); if (dom.drawerOverlay) dom.drawerOverlay.classList.add('active'); renderChatHistory(); }
function closeDrawer() { if (dom.drawer) dom.drawer.classList.remove('open'); if (dom.drawerOverlay) dom.drawerOverlay.classList.remove('active'); }

// ===== THEME =====
function applyTheme(theme) { state.theme = theme; document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('sscai_theme', theme); if (dom.darkModeToggle) dom.darkModeToggle.checked = theme === 'dark'; }
function toggleTheme() { applyTheme(state.theme === 'dark' ? 'light' : 'dark'); }

// ===== VOICE INPUT =====
function setupVoiceInput() {
  const voiceOverlay = document.getElementById('voiceOverlay');
  const voiceLabel   = document.getElementById('voiceLabel');
  const cancelBtn    = document.getElementById('voiceCancelBtn');

  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    if (dom.voiceInputBtn) dom.voiceInputBtn.style.display = 'none';
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SR();
  recognition.lang = 'hi-IN';
  recognition.interimResults = false;
  recognition.continuous = false;

  let _active = false;

  function openVoiceOverlay() {
    _active = true;
    voiceOverlay.classList.remove('got-result');
    if (voiceLabel) voiceLabel.textContent = 'Listening…';
    voiceOverlay.classList.add('active');
    voiceOverlay.setAttribute('aria-hidden', 'false');
    dom.voiceInputBtn?.classList.add('recording');
  }

  function closeVoiceOverlay() {
    _active = false;
    voiceOverlay.classList.remove('active', 'got-result');
    voiceOverlay.setAttribute('aria-hidden', 'true');
    dom.voiceInputBtn?.classList.remove('recording');
  }

  dom.voiceInputBtn?.addEventListener('click', () => {
    if (_active) { recognition.abort(); closeVoiceOverlay(); return; }
    openVoiceOverlay();
    try { recognition.start(); } catch(e) { closeVoiceOverlay(); }
  });

  cancelBtn?.addEventListener('click', () => {
    recognition.abort();
    closeVoiceOverlay();
  });

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    // Flash green "Got it" state briefly
    if (voiceLabel) voiceLabel.textContent = `"${transcript}"`;
    voiceOverlay.classList.add('got-result');
    dom.messageInput.value = transcript;
    dom.messageInput.dispatchEvent(new Event('input'));
    setTimeout(() => {
      closeVoiceOverlay();
      if (transcript.trim()) sendMessage();
    }, 700);
  };

  recognition.onerror = (err) => {
    if (err.error === 'aborted') return; // user cancelled
    if (voiceLabel) voiceLabel.textContent = 'Didn\'t catch that…';
    setTimeout(closeVoiceOverlay, 1000);
  };

  recognition.onend = () => {
    // Only close if we didn't already handle it in onresult
    if (_active) setTimeout(closeVoiceOverlay, 300);
  };
}

// ===== USER UI =====
function getPlanDisplayName(planId) {
  const map = {
    ssc:'⭐ SSC Pro', class:'📚 Class 1-12 Pro', class10:'⭐ Class Pro', class12:'⭐ Class Pro',
    yearly:'🌟 All-in-One Pro', semiannual:'🔥 SSC 6-Month',
    battle:'⚔️ Battle Basic', battle_pro:'⚔️ Battle Pro', battle_academy:'⚔️ Battle Academy',
    premium:'⭐ Premium'
  };
  return map[planId] || '⭐ Premium';
}
function updateUserUI() {
  const name = state.user?.name || 'Guest';
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  // Re-read isPremium from localStorage for accuracy
  try {
    const uid2 = state.user?.uid;
    const p2 = uid2 ? ('sscai_u:'+uid2+':') : 'sscai_guest:';
    if (localStorage.getItem(p2+'premium')==='true') {
      state.isPremium = true;
      if (!state.premiumPlan) state.premiumPlan = localStorage.getItem(p2+'premium_plan') || 'premium';
      // ⚠️ Do NOT fall back to global 'sscai_premium' / 'sscai_premium_plan' —
      // those keys have no UID and leak premium to every user on this device.
    }
  } catch(e) {}
  const plan = state.premiumPlan ? getPlanDisplayName(state.premiumPlan) : (state.isPremium ? getPlanDisplayName(state.premiumPlan) : isRewardActive() ? '⚡ Unlimited (Reward)' : 'Free Plan');
  // Apply all cosmetics (avatar, name color, frame, effect, title)
  // applyAllCosmetics reads from sscai_u:{uid}:shop_owned — the correct key
  setTimeout(() => { if (typeof applyAllCosmetics === 'function') applyAllCosmetics(); }, 50);
  if (dom.drawerUserName) dom.drawerUserName.textContent = name;
  if (dom.drawerUserPlan) {
    dom.drawerUserPlan.textContent = plan;
    dom.drawerUserPlan.style.color = state.isPremium ? '#f59e0b' : '';
  }
  const totalChats = state.chatSessions.reduce((acc, s) => acc + s.messages.filter(m => m.role === 'user').length, 0);
  const el1 = document.getElementById('drawerTotalChats'); if (el1) el1.textContent = totalChats;
  const el2 = document.getElementById('drawerTodayChats'); if (el2) el2.textContent = state.textCount;
  // Removed: show remaining chats per user request
  const el3 = document.getElementById('drawerRemainingChats'); if (el3) el3.textContent = '';
  const upgradeDrawerBtn = document.getElementById('upgradeDrawerBtn'); if (upgradeDrawerBtn) upgradeDrawerBtn.style.display = state.isPremium ? 'none' : '';
  const streakEl = document.getElementById('streakCount'); if (streakEl) streakEl.textContent = `🔥 ${state.streakDays} day streak`;
  try {
    const XP = window._CrackAI && window._CrackAI.XP;
    const xpVal = XP ? XP.get() : 0;
    const xpLvl = XP ? XP.level() : 1;
    const lvlEl = document.getElementById('drawerXPLevel'); if (lvlEl) lvlEl.textContent = 'Lvl ' + xpLvl;
    const valEl = document.getElementById('drawerXPVal'); if (valEl) valEl.textContent = xpVal + ' XP';
  } catch(e) {}
  // Sync coins display from battle-arena storage
  try {
    const _u2 = window._firebaseAuth && window._firebaseAuth.currentUser;
    const _uid2 = _u2 ? _u2.uid : null;
    const _ck = _uid2 ? ('sscai_u:' + _uid2 + ':coins') : 'sscai_u:guest:coins';
    const _cd = JSON.parse(localStorage.getItem(_ck) || 'null');
    const _cv = _cd ? (_cd.coins || 0) : 0;
    const drawerCoinsEl = document.getElementById('drawerCoinsVal'); if (drawerCoinsEl) drawerCoinsEl.textContent = '🪙 ' + _cv + ' coins';
  } catch(e) {}
  // Show premium active badge in header
  try {
    const badge = document.getElementById('premiumActiveBadge');
    if (badge) badge.style.display = state.isPremium ? 'flex' : 'none';
  } catch(e) {}
  updateLimitUI();
}

// ===== PROFILE MODAL =====
function openProfileModal() { updateProfileUI(); dom.profileModal.classList.add('active'); }
function closeProfileModal() { dom.profileModal.classList.remove('active'); }

function updateProfileUI() {
  if (state.user) {
    dom.profileLoggedOut.classList.add('hidden');
    dom.profileLoggedIn.classList.remove('hidden');
    const name = state.user.name || 'User';
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    // applyAllCosmetics handles avatar + name color + frame + effect + title
    setTimeout(() => { if (typeof applyAllCosmetics === 'function') applyAllCosmetics(); }, 50);
    dom.profileName.textContent = name;
    const emailEl = document.getElementById('profileEmail'); if (emailEl) emailEl.textContent = state.user.email || '—';
    const emailDetailEl = document.getElementById('profileEmailDetail'); if (emailDetailEl) emailDetailEl.textContent = state.user.email || '—';
    if (dom.profileMobile) dom.profileMobile.textContent = state.user.mobile || '—';
    if (dom.profileSubscription) { dom.profileSubscription.textContent = state.premiumPlan ? getPlanDisplayName(state.premiumPlan) : (state.isPremium ? getPlanDisplayName(state.premiumPlan) : "Free"); if (state.isPremium || state.premiumPlan) dom.profileSubscription.style.color="#f59e0b"; }
    if (dom.profileSince) dom.profileSince.textContent = state.user.joinedDate || new Date().toLocaleDateString();
    if (dom.profileBadge) dom.profileBadge.textContent = state.premiumPlan ? getPlanDisplayName(state.premiumPlan) : (state.isPremium ? getPlanDisplayName(state.premiumPlan) : "Free Plan");
    const verifiedChip = document.getElementById('profileVerifiedChip');
    if (verifiedChip) verifiedChip.style.display = state.user.verified ? '' : 'none';
    const totalUserMsgs = state.chatSessions.reduce((acc, s) => acc + s.messages.filter(m => m.role === 'user').length, 0);
    const el1 = document.getElementById('profileTotalChats'); if (el1) el1.textContent = totalUserMsgs;
    const el2 = document.getElementById('profileTodayChats'); if (el2) el2.textContent = state.textCount;
    const el3 = document.getElementById('profileTotalSolved'); if (el3) el3.textContent = state.totalSolved;
    const el4 = document.getElementById('profileStreak'); if (el4) el4.textContent = state.streakDays;
    try {
      const XP = window._CrackAI && window._CrackAI.XP;
      const xpVal = XP ? XP.get() : 0;
      const xpLvl = XP ? XP.level() : 1;
      const elXP = document.getElementById('profileXPVal'); if (elXP) elXP.textContent = xpVal;
      const elLvl = document.getElementById('profileXPLevel'); if (elLvl) elLvl.textContent = xpLvl;
    } catch(e) {}
    // Show coins in profile
    try {
      const _pu = window._firebaseAuth && window._firebaseAuth.currentUser;
      const _puid = _pu ? _pu.uid : (state.user ? state.user.uid : null);
      const _pck = _puid ? ('sscai_u:' + _puid + ':coins') : 'sscai_u:guest:coins';
      const _pcd = JSON.parse(localStorage.getItem(_pck) || 'null');
      const _pcv = _pcd ? (_pcd.coins || 0) : 0;
      const profileCoinsEl = document.getElementById('profileCoinsVal'); if (profileCoinsEl) profileCoinsEl.textContent = _pcv;
    } catch(e) {}
  } else {
    dom.profileLoggedOut.classList.remove('hidden');
    dom.profileLoggedIn.classList.add('hidden');
  }
}

function refreshProfileCoinsDisplay() {
  try {
    const _pu = window._firebaseAuth && window._firebaseAuth.currentUser;
    const _puid = _pu ? _pu.uid : (state.user ? state.user.uid : null);
    const _pck = _puid ? ('sscai_u:' + _puid + ':coins') : 'sscai_u:guest:coins';
    const _pcd = JSON.parse(localStorage.getItem(_pck) || 'null');
    const _pcv = _pcd ? (_pcd.coins || 0) : 0;
    const profileCoinsEl = document.getElementById('profileCoinsVal');
    if (profileCoinsEl) profileCoinsEl.textContent = _pcv;
  } catch(e) {}
}
window.refreshProfileCoinsDisplay = refreshProfileCoinsDisplay;

function showLoginForm() { /* email auth removed */ }
function showSignupForm() { /* email auth removed */ }

// ===== AUTH FUNCTIONS =====

window.switchAuthTab = function() {}; // kept as no-op for safety
function clearAuthErrors() {}
function showAuthError() {}
function setAuthLoading() {}
window.togglePwd = function() {};

window.skipAuth = function() {
  // If switching from a real user to guest, wipe their data
  if (state.user) { clearUserState(); state.user = null; }
  state.firebaseUser = null;
  localStorage.removeItem('sscai_active_uid');
  // Load guest slot
  loadUserState(null);
  document.getElementById('authScreen').classList.add('hidden');
  showMainApp();

  // ── Give this guest a real, unique Firebase Auth identity ──────────────
  // Without this, window._firebaseAuth.currentUser stayed null for every
  // guest. Firestore rules require request.auth != null, so guest battle
  // XP was silently rejected on write AND the leaderboard query was
  // silently rejected on read (both swallowed by try/catch). Also,
  // battle-arena-patch.js's uid() fell back to the literal string "guest"
  // for everyone, so even if writes had succeeded, every guest would have
  // overwritten the same single Firestore document instead of getting
  // their own row. signInAnonymously() gives each device a stable, unique
  // uid that satisfies the rules and removes the collision — requires the
  // "Anonymous" provider to be enabled in Firebase Console → Authentication.
  try {
    var fns = window._firebaseFns;
    if (window._firebaseAuth && fns && typeof fns.signInAnonymously === 'function' &&
        !window._firebaseAuth.currentUser) {
      fns.signInAnonymously(window._firebaseAuth).then(function (cred) {
        state.firebaseUser = cred.user;
        // Carry over any locally-tracked guest coins/cosmetics so existing
        // local progress isn't lost now that uid() returns a real uid.
        try {
          var oldPrefix = 'sscai_u:guest:';
          var newPrefix = 'sscai_u:' + cred.user.uid + ':';
          var keysToCopy = [];
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(oldPrefix) === 0) keysToCopy.push(k);
          }
          keysToCopy.forEach(function (k) {
            var suffix = k.slice(oldPrefix.length);
            if (localStorage.getItem(newPrefix + suffix) === null) {
              localStorage.setItem(newPrefix + suffix, localStorage.getItem(k));
            }
          });
        } catch (e) {}
      }).catch(function () {});
    }
  } catch (e) {}
};

// Background Firestore sync — never blocks the UI
async function _syncFirestoreBackground(fbUser) {
  if (!window._firebaseDb || !window._firebaseFns) return;
  // Claim this device as the one active session for the account (kicks any other open session)
  _claimSession(fbUser);
  try {
    const cacheKey = 'user_' + fbUser.uid;
    const { doc, getDoc, setDoc, updateDoc } = window._firebaseFns;
    const userRef = doc(window._firebaseDb, 'users', fbUser.uid);
    
    // ── CHECK CACHE FIRST ──────────────────────────────────
    const cachedUserData = CacheManager.get(cacheKey, 'userData');
    let userData = null;
    let snap = null;
    
    if (cachedUserData) {
      SecureLogger.info('[Cache Hit] Firebase user data from cache');
      userData = cachedUserData;
    } else {
      // ── FETCH FROM FIREBASE ────────────────────────────────
      snap = await getDoc(userRef);
      
      if (snap.exists()) {
        userData = snap.data();
        // ── CACHE RESULT ───────────────────────────────────────
        CacheManager.set(cacheKey, userData, 'userData');
      }
    }
    
    if (userData) {
      const d = userData;
      if (d.isPremium && !state.isPremium) {
        const notExpired = !d.premiumExpiresAt || Date.now() < d.premiumExpiresAt;
        if (!notExpired) {
          // Expired — clean up Firestore silently
          try { updateDoc(userRef, { isPremium: false }).catch(() => {}); } catch(_e) {}
        }
        if (notExpired) {
          state.isPremium = true;
          saveState();
          updateUserUI(); updateProfileUI();
          showToast('⭐ Premium access restored!');
        }
      }
      if (d.name && state.user) state.user.name = d.name;
      if (d.mobile && state.user) state.user.mobile = d.mobile;
      if (state.user) state.user = { ...state.user, ...d };
      saveState(); updateUserUI();

      try {
        const _p = 'sscai_u:' + fbUser.uid + ':';
        if (d.isGroupAdmin) {
          localStorage.setItem(_p + 'group_admin', 'true');
          // ⚠️ No global 'sscai_group_admin' write — leaks to other users.
          if (d.groupPlan) {
            localStorage.setItem(_p + 'group_plan', d.groupPlan);
            // ⚠️ No global 'sscai_group_plan' write — leaks to other users.
          }
        }
        if (d.battleTier) {
          localStorage.setItem('sscai_battle_tier', d.battleTier);
          const _tierMax = { battle: '5', battle_pro: '19', battle_academy: '29' };
          if (_tierMax[d.battleTier]) localStorage.setItem('sscai_battle_monthly_max', _tierMax[d.battleTier]);
        }
        if (d.premiumPlan) {
          localStorage.setItem(_p + 'premium_plan', d.premiumPlan);
          // ⚠️ No global 'sscai_premium_plan' write — leaks to other users.
        }
        if (d.semiannualExpires) {
          localStorage.setItem('sscai_semiannual_expires', String(d.semiannualExpires));
        }
      } catch(_e) {}

      // Update lastSeen on every login
      updateDoc(userRef, { lastSeen: Date.now() }).catch(() => {});
    } else {
      // First sign-in — write doc (non-blocking, fire-and-forget)
      const userData = state.user || {};
      // ── CRITICAL: Always ensure name is never empty ──
      let finalName = userData.name || fbUser.displayName || '';
      if (!finalName && fbUser.email) {
        const prefix = fbUser.email.split('@')[0];
        finalName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      }
      if (!finalName) finalName = 'User';
      
      setDoc(userRef, {
        uid: fbUser.uid,
        name: finalName,  // ← Always has a non-empty name
        email: fbUser.email || '',
        photoURL: fbUser.photoURL || '',
        isPremium: false,
        createdAt: Date.now(),
        lastSeen: Date.now(),
        totalMessages: 0
      }).catch(() => {});
    }
  } catch (e) { SecureLogger.warn('Firestore background sync:', e); }
}

async function loginUserWithFirebase(fbUser, extraData = {}) {
  const uid = fbUser.uid;
  // If a DIFFERENT user was active, wipe their in-memory data first
  if (state.user && state.user.uid !== uid) {
    clearUserState();
    if (dom.messages) dom.messages.innerHTML = '';
  }
  const userData = {
    uid,
    name: fbUser.displayName || extraData.name || fbUser.email?.split('@')[0] || 'User',
    email: fbUser.email || '',
    mobile: extraData.mobile || '',
    photoURL: fbUser.photoURL || '',
    joinedDate: new Date().toLocaleDateString('en-IN'),
    verified: fbUser.emailVerified || false,
    provider: extraData.provider || 'email'
  };
  state.user = userData;
  state.firebaseUser = fbUser;
  // Load THIS user's data from their own localStorage slot
  loadUserState(uid);
  saveState();
  // Sync Firestore non-blocking — don't await
  _syncFirestoreBackground(fbUser);
}

// Google Sign In
window.handleGoogleSignIn = async function() {
  if (!window._firebaseAuth || !window._googleProvider || !window._firebaseFns) { showToast('Auth not ready. Please wait...'); return; }
  const btns = ['googleSignInBtn', 'profileGoogleBtn'].map(id => document.getElementById(id)).filter(Boolean);
  btns.forEach(b => { b.disabled = true; b.style.opacity = '0.7'; });
  try {
    const { signInWithPopup } = window._firebaseFns;
    const result = await signInWithPopup(window._firebaseAuth, window._googleProvider);
    // loginUserWithFirebase is now instant (Firestore sync is background)
    loginUserWithFirebase(result.user, { provider: 'google' });
    document.getElementById('authScreen').classList.add('hidden');
    if (dom.app.classList.contains('hidden')) showMainApp();
    else { updateUserUI(); updateProfileUI(); }
    showToast(`🎉 Welcome, ${state.user.name}!`);
    // Show persona selector on first signup (only if not selected yet)
    if (!state.aiPersona) {
      setTimeout(() => showPersonaSelector(), 800);
    }
  } catch (err) {
    SecureLogger.error('Google sign-in error:', err);
    let msg = 'Google sign-in failed. Please try again.';
    if (err.code === 'auth/popup-blocked') msg = 'Popup blocked. Please allow popups for this site.';
    if (err.code === 'auth/cancelled-popup-request') msg = 'Sign-in cancelled.';
    showToast(msg, 3500);
  } finally {
    btns.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
  }
};

// Apple Sign In
window.handleAppleSignIn = async function() {
  if (!window._firebaseAuth || !window._appleProvider || !window._firebaseFns) { showToast('Auth not ready. Please wait...'); return; }
  const btns = ['appleSignInBtn', 'profileAppleBtn'].map(id => document.getElementById(id)).filter(Boolean);
  btns.forEach(b => { b.disabled = true; b.style.opacity = '0.7'; });
  try {
    const { signInWithPopup } = window._firebaseFns;
    const result = await signInWithPopup(window._firebaseAuth, window._appleProvider);
    loginUserWithFirebase(result.user, { provider: 'apple' });
    document.getElementById('authScreen').classList.add('hidden');
    if (dom.app.classList.contains('hidden')) showMainApp();
    else { updateUserUI(); updateProfileUI(); }
    showToast(`🎉 Welcome, ${state.user.name}!`);
    if (!state.aiPersona) {
      setTimeout(() => showPersonaSelector(), 800);
    }
  } catch (err) {
    SecureLogger.error('Apple sign-in error:', err);
    showToast('Apple sign-in failed. Please try again.', 3500);
  } finally {
    btns.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
  }
};

// Email auth removed — Google & Apple only
window.handleFirebaseLogin = function() { showToast('Please use Google or Apple to sign in.'); };
window.handleFirebaseSignup = function() { showToast('Please use Google or Apple to sign in.'); };

// Profile modal Login (kept as no-op — email auth removed)
function handleLogin() { showToast('Please use Google or Apple to sign in.'); }
function handleSignup() { showToast('Please use Google or Apple to sign in.'); }

function handleLogout() {
  _stopSessionWatch();
  // Release this account's session claim so the NEXT login (even on the
  // same device) doesn't wrongly think "another device" is still active.
  try {
    const uid = window._firebaseAuth?.currentUser?.uid;
    if (uid && window._firebaseDb && window._firebaseFns) {
      const { doc, updateDoc } = window._firebaseFns;
      updateDoc(doc(window._firebaseDb, 'users', uid), { activeSessionId: null }).catch(() => {});
    }
  } catch (e) {}
  _localSessionId = null;
  if (window._firebaseAuth && window._firebaseFns) {
    const { signOut } = window._firebaseFns;
    signOut(window._firebaseAuth).catch(() => {});
  }
  // Remove the "last active user" pointer so the next visitor
  // starts fresh and never sees this user's data
  localStorage.removeItem('sscai_active_uid');
  // Wipe ALL in-memory state for this user
  state.user = null;
  state.firebaseUser = null;
  clearUserState();
  // Clear the chat panel visually
  if (dom.messages) dom.messages.innerHTML = '';
  if (dom.welcomeScreen) { dom.welcomeScreen.style.display = ''; dom.messages && dom.messages.appendChild(dom.welcomeScreen); }
  // Close modals
  closeProfileModal();
  // Hide main app, show auth screen
  dom.app.classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  showToast('Signed out successfully');
}

// ===== BOOKMARKS =====
function openBookmarksModal() { renderBookmarks(); dom.bookmarksModal.classList.add('active'); }
function closeBookmarksModal() { dom.bookmarksModal.classList.remove('active'); }
function renderBookmarks() {
  if (!dom.bookmarksList) return;
  if (!state.bookmarks.length) { dom.bookmarksList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">No bookmarks yet. Bookmark important AI answers!</div>'; return; }
  dom.bookmarksList.innerHTML = state.bookmarks.map((b, i) => `<div class="bookmark-item"><div class="bookmark-content">${escapeHtml(b.content)}${b.content.length >= 300 ? '...' : ''}</div><div class="bookmark-meta"><span class="bookmark-time">${b.time}</span><button onclick="deleteBookmark(${i})" class="bookmark-delete">🗑️</button></div></div>`).join('');
}
window.deleteBookmark = function(i) { state.bookmarks.splice(i, 1); saveState(); renderBookmarks(); };

// ===== PREMIUM =====
function closePremiumModal() { dom.premiumModal.classList.remove('active'); }

// Cashfree automatic payment verification
async function verifyCashfreePayment(orderId) {
  try {
    const firebaseUser = window._firebaseAuth?.currentUser;
    const token = firebaseUser ? await firebaseUser.getIdToken() : null;
    // Call backend to verify order with Cashfree
    const res = await fetch(VERIFY_PAYMENT_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  },
  body: JSON.stringify({ order_id: orderId })
});
    if (!res.ok) return null;
    const data = await res.json();
    return data; // { status: 'PAID', plan: 'ssc'|'class10'|'class12' }
  } catch(e) {
    SecureLogger.warn('Payment verify error:', e);
    return null;
  }
}

async function handlePayment(planId) {
  const plan = PREMIUM_PLANS[planId] || PREMIUM_PLANS.ssc;
  if (!state.user) { showToast('Please login first to upgrade!'); return; }

  const firebaseUser = window._firebaseAuth?.currentUser;
  if (!firebaseUser) { showToast('Please login first to upgrade!'); return; }

  showToast('💳 Creating secure payment session…');

  try {
    const token = await firebaseUser.getIdToken();

    // Step 1 — Call backend to create Cashfree order & get payment_session_id
  const response = await fetch(CASHFREE_ORDER_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    amount: plan.price,
    plan: planId,
    uid: state.user.uid,
    name: state.user.name || 'Student',
    email: state.user.email || ''
  })
});

    const data = await response.json();

    if (!data.payment_session_id || !data.order_id) {
      SecureLogger.error('Order creation failed:', data);
      showToast('❌ Payment session failed. Please try again.');
      return;
    }

    const orderId = data.order_id;

    // Store pending order for post-payment verification
    localStorage.setItem('sscai_pending_order', JSON.stringify({
      orderId, planId, uid: state.user.uid, ts: Date.now()
    }));

    // Step 2 — Launch Cashfree checkout via SDK v3
    const cashfree = Cashfree({ mode: 'production' });

    cashfree.checkout({
      paymentSessionId: data.payment_session_id,
      redirectTarget: '_modal'
    });

    // Step 3 — Poll for payment confirmation after redirect returns
    pollPaymentStatus(orderId, planId);

  } catch (err) {
    SecureLogger.error('Payment error:', err);
    showToast('❌ Payment failed. Please try again.');
  }
}

function pollPaymentStatus(orderId, planId, attempt = 0) {
  const MAX_ATTEMPTS = 24; // poll for up to ~2 minutes (every 5s)
  if (attempt >= MAX_ATTEMPTS) {
    showToast('⏰ Payment not detected yet. If you paid, contact support.');
    return;
  }
  setTimeout(async () => {
    const result = await verifyCashfreePayment(orderId);
    if (result && result.status === 'PAID') {
      activatePremium(planId);
      localStorage.removeItem('sscai_pending_order');
    } else if (result && result.status === 'FAILED') {
      showToast('❌ Payment failed. Please try again.');
      localStorage.removeItem('sscai_pending_order');
    } else {
      pollPaymentStatus(orderId, planId, attempt + 1);
    }
  }, 5000);
}

function activatePremium(planId = 'ssc') {
  const plan = PREMIUM_PLANS[planId] || PREMIUM_PLANS.ssc;
  state.isPremium = true;
  state.premiumPlan = planId;

  // Persist to Firestore
  if (window._firebaseDb && window._firebaseFns && state.firebaseUser) {
    const { doc, updateDoc } = window._firebaseFns;
    const userRef = doc(window._firebaseDb, 'users', state.firebaseUser.uid);
    updateDoc(userRef, { isPremium: true, premiumPlan: planId, premiumActivatedAt: Date.now() }).catch(() => {});
  }

  saveState(); updateUserUI(); updateProfileUI(); closePremiumModal();
  showToast(`🎉 ${plan.name} activated! Unlimited access unlocked! 🚀`);
}

window.handlePayment = handlePayment;

// ── ADDON SYSTEM (VisionPro / PrepAIPro @ ₹49) ───────────────────────────────
function isAddonActive(planId) {
  try {
    const d = JSON.parse(localStorage.getItem('crackai_addon_' + planId) || 'null');
    if (!d || d.active !== true) return false;
    // All addon plans — enforce 29-day expiry
    if (d.expiresAt && Date.now() > d.expiresAt) {
      localStorage.removeItem('crackai_addon_' + planId);
      return false;
    }
    return true;
  } catch(e) { return false; }
}
function setAddonActive(planId) {
  const expiresAt = Date.now() + (29 * 24 * 60 * 60 * 1000);
  localStorage.setItem('crackai_addon_' + planId, JSON.stringify({ active: true, activatedAt: Date.now(), expiresAt: expiresAt }));
  if (window._firebaseDb && window._firebaseFns && window._firebaseAuth?.currentUser) {
    try {
      const { doc, updateDoc } = window._firebaseFns;
      updateDoc(doc(window._firebaseDb, 'users', window._firebaseAuth.currentUser.uid),
        { ['addon_' + planId]: true }).catch(() => {});
    } catch(e) {}
  }
}

function openAddonModal(type) {
  // Remove existing
  document.getElementById('addonModal')?.remove();
  const isVision = type === 'visionpro';
  const planId = isVision ? ADDON_PLAN_VISIONPRO : ADDON_PLAN_PREPAIPRO;
  const modal = document.createElement('div');
  modal.id = 'addonModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);padding:20px;';
  modal.innerHTML = `
    <div style="background:linear-gradient(135deg,#0f0c1f,#1a1435);border:1px solid rgba(108,99,255,0.35);border-radius:20px;padding:28px 24px;max-width:360px;width:100%;text-align:center;box-shadow:0 0 60px rgba(108,99,255,0.15);">
      <div style="font-size:36px;margin-bottom:10px;">${isVision ? '🔬' : '✨'}</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">${isVision ? 'PrepAI Vision Pro' : 'PrepAI Pro'}</div>
      <div style="font-size:13px;color:rgba(26,26,38,0.70);margin-bottom:18px;">${isVision ? 'Advanced AI analysis of images, PDFs & handwritten notes' : 'Deepest AI reasoning with multi-step explanations'}</div>
      <ul style="text-align:left;font-size:12px;color:rgba(26,26,38,0.75);list-style:none;padding:0;margin:0 0 20px 0;display:flex;flex-direction:column;gap:6px;">
        ${isVision
          ? '<li>✅ DeepSeek Vision AI — images & screenshots</li><li>✅ Handwritten notes recognition</li><li>✅ PDF chapter-wise text extraction & solving</li><li>✅ Diagram & graph analysis</li>'
          : '<li>✅ DeepSeek advanced reasoning</li><li>✅ Step-by-step detailed solutions</li><li>✅ Concept deep-dives</li><li>✅ Full SSC/CBSE coverage</li>'}
      </ul>
      <div style="font-size:28px;font-weight:800;color:#6C63FF;margin-bottom:4px;">₹${ADDON_PRICE} <span style="font-size:13px;font-weight:400;color:rgba(26,26,38,0.55);">one-time</span></div>
      <div style="font-size:11px;color:rgba(26,26,38,0.70);margin-bottom:20px;">Lifetime access · No subscription</div>
      <button id="addonPayBtn" style="width:100%;padding:14px;background:linear-gradient(135deg,#6C63FF,#FF6B9D);color:var(--text-primary);border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:10px;">
        💳 Unlock for ₹${ADDON_PRICE}
      </button>
      <button onclick="document.getElementById('addonModal').remove()" style="width:100%;padding:10px;background:transparent;color:rgba(26,26,38,0.55);border:1px solid rgba(108,99,255,0.2);border-radius:10px;font-size:13px;cursor:pointer;">
        Maybe Later
      </button>
      <div style="margin-top:14px;font-size:11px;color:rgba(26,26,38,0.65);">🔒 Secured by Cashfree Payments</div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('addonPayBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('addonPayBtn');
    if (!window._firebaseAuth?.currentUser) {
      showToast('Please login first!'); return;
    }
    btn.disabled = true; btn.textContent = '⏳ Creating order…';
    try {
      const uid = window._firebaseAuth.currentUser.uid;
      const orderId = 'addon_' + planId + '_' + uid + '_' + Date.now();
      const res = await fetch(CASHFREE_ORDER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: orderId, amount: ADDON_PRICE, currency: 'INR',
          customer_id: uid,
          customer_email: window._firebaseAuth.currentUser.email || 'student@crackai.in',
          customer_phone: '9999999999',
          order_note: planId,
          app_id: CASHFREE_APP_ID
        })
      });
      const data = await res.json();
      if (!data.payment_session_id) throw new Error('No session');
      localStorage.setItem('crackai_pending_addon', JSON.stringify({ orderId, planId, ts: Date.now() }));
      const cashfree = Cashfree({ mode: 'production' });
      cashfree.checkout({ paymentSessionId: data.payment_session_id, redirectTarget: '_modal' });
      pollAddonPayment(orderId, planId);
    } catch(e) {
      btn.disabled = false; btn.textContent = '💳 Unlock for ₹' + ADDON_PRICE;
      showToast('❌ Payment error: ' + e.message);
    }
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function pollAddonPayment(orderId, planId, attempt = 0) {
  if (attempt >= 20) { showToast('⏰ Payment not confirmed. Contact support if paid.'); return; }
  setTimeout(async () => {
    try {
      const result = await verifyCashfreePayment(orderId);
      if (result?.status === 'PAID') {
        setAddonActive(planId);
        document.getElementById('addonModal')?.remove();
        localStorage.removeItem('crackai_pending_addon');
        showToast('🎉 ' + (planId === ADDON_PLAN_VISIONPRO ? 'PrepAI Vision Pro' : 'PrepAI Pro') + ' unlocked!');
        return;
      }
      if (result?.status === 'FAILED') {
        showToast('❌ Payment failed. Try again.'); return;
      }
    } catch(e) {}
    pollAddonPayment(orderId, planId, attempt + 1);
  }, 5000);
}

// ── V4 Pro Modal — ₹149/month ────────────────────────────────────────────────
function openV4ProModal() {
  document.getElementById('v4ProModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'v4ProModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.88);padding:20px;backdrop-filter:blur(8px);';
  modal.innerHTML = `
    <div style="background:linear-gradient(135deg,#0a0520,#150a30,#0a0520);border:1px solid rgba(255,107,157,0.4);border-radius:24px;padding:30px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 0 80px rgba(255,107,157,0.15),0 0 40px rgba(108,99,255,0.1);">
      <div style="font-size:42px;margin-bottom:8px;">🚀</div>
      <div style="display:inline-block;background:linear-gradient(135deg,#FF6B9D,#f59e0b);color:var(--text-primary);font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;padding:3px 12px;border-radius:20px;margin-bottom:12px;">DeepSeek V4 Pro · Flagship</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">PrepAI V4 Pro</div>
      <div style="font-size:13px;color:rgba(26,26,38,0.65);margin-bottom:20px;line-height:1.6;">The most powerful DeepSeek model — 1M context window, best-in-class reasoning for tough SSC/Board questions</div>

      <div style="background:rgba(255,255,255,0.04);border-radius:14px;padding:14px 16px;margin-bottom:20px;text-align:left;">
        <div style="font-size:12px;color:var(--text-secondary);display:flex;flex-direction:column;gap:7px;">
          <span>🚀 DeepSeek V4 Pro — flagship AI model</span>
          <span>🧠 1M token context window (10× more)</span>
          <span>📐 Best at complex Math, Reasoning & Science</span>
          <span>🔬 384K max output — full detailed solutions</span>
          <span>⚡ Thinking + non-thinking mode</span>
          <span>♾️ Unlimited V4 Pro questions per month</span>
        </div>
      </div>

      <div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.2);border-radius:12px;padding:12px;margin-bottom:18px;">
        <div style="font-size:11px;color:rgba(26,26,38,0.55);margin-bottom:4px;">Why ₹149/month?</div>
        <div style="font-size:12px;color:rgba(26,26,38,0.70);line-height:1.5;">V4 Pro costs 12× more than V4 Flash on the API. This plan covers those costs so you get flagship AI at the lowest sustainable price.</div>
      </div>

      <div style="font-size:32px;font-weight:800;color:#FF6B9D;margin-bottom:2px;">
        ₹149 <span style="font-size:13px;font-weight:400;color:rgba(200,195,255,0.45);">/ month</span>
      </div>
      <div style="font-size:11px;color:rgba(200,195,255,0.35);margin-bottom:20px;">Cancel anytime · Renews monthly</div>

      <button id="v4ProPayBtn" style="width:100%;padding:14px;background:linear-gradient(135deg,#FF6B9D,#f59e0b,#FF6B9D);background-size:200%;color:var(--text-primary);border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:10px;box-shadow:0 4px 24px rgba(255,107,157,0.35);animation:gradShift 3s ease infinite;">
        🚀 Unlock V4 Pro — ₹149/mo
      </button>
      <button onclick="document.getElementById('v4ProModal').remove()" style="width:100%;padding:10px;background:transparent;color:rgba(200,195,255,0.45);border:1px solid rgba(108,99,255,0.15);border-radius:12px;font-size:13px;cursor:pointer;">
        Maybe Later
      </button>
      <div style="margin-top:14px;font-size:11px;color:rgba(200,195,255,0.25);">🔒 Secured by Cashfree Payments</div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById('v4ProPayBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('v4ProPayBtn');
    if (!window._firebaseAuth?.currentUser) { showToast('Please login first!'); return; }
    btn.disabled = true; btn.textContent = '⏳ Creating order…';
    try {
      const uid = window._firebaseAuth.currentUser.uid;
      const orderId = 'addon_v4pro_' + uid + '_' + Date.now();
      const res = await fetch(CASHFREE_ORDER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: orderId, amount: ADDON_PRICE_V4PRO, currency: 'INR',
          customer_id: uid,
          customer_email: window._firebaseAuth.currentUser.email || 'student@crackai.in',
          customer_phone: '9999999999',
          order_note: ADDON_PLAN_V4PRO,
          app_id: CASHFREE_APP_ID
        })
      });
      const data = await res.json();
      if (!data.payment_session_id) throw new Error('No session');
      localStorage.setItem('crackai_pending_addon', JSON.stringify({ orderId, planId: ADDON_PLAN_V4PRO, ts: Date.now() }));
      const cashfree = Cashfree({ mode: 'production' });
      cashfree.checkout({ paymentSessionId: data.payment_session_id, redirectTarget: '_modal' });
      pollV4ProPayment(orderId);
    } catch(e) {
      btn.disabled = false; btn.textContent = '🚀 Unlock V4 Pro — ₹149/mo';
      showToast('❌ Payment error: ' + e.message);
    }
  });

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function pollV4ProPayment(orderId, attempt = 0) {
  if (attempt >= 24) { showToast('⏰ Payment not confirmed. Contact support if paid.'); return; }
  setTimeout(async () => {
    try {
      const result = await verifyCashfreePayment(orderId);
      if (result?.status === 'PAID') {
        setAddonActive(ADDON_PLAN_V4PRO);
        document.getElementById('v4ProModal')?.remove();
        localStorage.removeItem('crackai_pending_addon');
        window._selectedDeepSeekModel = 'deepseek-v4-pro';
        showToast('🚀 V4 Pro unlocked! You\'re on the flagship model now!');
        _doConfetti();
        return;
      }
      if (result?.status === 'FAILED') { showToast('❌ Payment failed. Try again.'); return; }
    } catch(e) {}
    pollV4ProPayment(orderId, attempt + 1);
  }, 5000);
}

function checkPendingPayment() {
  try {
    const pending = JSON.parse(localStorage.getItem('sscai_pending_order') || 'null');
    if (pending && pending.uid === state.user?.uid && (Date.now() - pending.ts) < 600000) {
      pollPaymentStatus(pending.orderId, pending.planId);
    } else if (pending) {
      localStorage.removeItem('sscai_pending_order');
    }
  } catch(e) {}
}

function renderPremiumModal() {
  // Target the dedicated plan-content div so the voice strip above is never wiped
  const modal = document.getElementById('premiumPlanContent') ||
                dom.premiumModal?.querySelector('.modal-premium-body') ||
                dom.premiumModal?.querySelector('.modal-body');
  if (!modal) return;
  const isPrem = state.isPremium;
  const curPlan = state.premiumPlan || '';

  modal.innerHTML = `
    <style>
      .pm-wrap { display:flex; flex-direction:column; min-height:100%; background:var(--bg-primary,#0d0d14); }
      .pm-hero { text-align:center; padding:28px 20px 20px; }
      .pm-hero-title { font-size:clamp(22px,4vw,32px); font-weight:800; color:var(--text-primary,#e8e8f0); letter-spacing:-0.03em; margin-bottom:8px; }
      .pm-hero-title em { font-style:normal; background:linear-gradient(135deg,#6C63FF,#FF6B9D); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
      .pm-hero-sub { font-size:14px; color:rgba(200,195,255,0.50); max-width:500px; margin:0 auto; line-height:1.6; }
      .pm-stats { display:flex; align-items:center; justify-content:center; gap:0; margin:0 auto 24px; border:1px solid rgba(255,255,255,0.08); border-radius:12px; overflow:hidden; width:fit-content; }
      .pm-stat { padding:10px 22px; text-align:center; border-right:1px solid rgba(255,255,255,0.08); }
      .pm-stat:last-child { border-right:none; }
      .pm-stat-num { font-size:16px; font-weight:800; color:var(--text-primary,#e8e8f0); display:block; }
      .pm-stat-lbl { font-size:10px; color:rgba(200,195,255,0.40); display:block; margin-top:1px; }
      .pm-plans { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; padding:0 24px 24px; max-width:1100px; margin:0 auto; width:100%; box-sizing:border-box; }
      .pm-card { background:rgba(255,255,255,0.03); border:1.5px solid rgba(255,255,255,0.09); border-radius:18px; padding:24px; position:relative; display:flex; flex-direction:column; transition:border-color 0.2s, box-shadow 0.2s; }
      .pm-card:hover { border-color:rgba(108,99,255,0.4); box-shadow:0 0 0 1px rgba(108,99,255,0.15); }
      .pm-card.featured { border-color:rgba(108,99,255,0.55); background:rgba(108,99,255,0.06); box-shadow:0 0 32px rgba(108,99,255,0.12); }
      .pm-card.gold { border-color:rgba(245,158,11,0.45); background:rgba(245,158,11,0.04); }
      .pm-badge { position:absolute; top:-11px; left:18px; font-size:10px; font-weight:800; padding:3px 12px; border-radius:20px; letter-spacing:0.05em; color:var(--text-primary); white-space:nowrap; }
      .pm-badge.purple { background:linear-gradient(135deg,#6C63FF,#9b5de5); }
      .pm-badge.gold { background:linear-gradient(135deg,#d97706,#f59e0b); }
      .pm-badge.green { background:linear-gradient(135deg,#059669,#10b981); }
      .pm-badge.red { background:linear-gradient(135deg,#dc2626,#f59e0b); }
      .pm-card-top { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:16px; }
      .pm-card-name { font-size:18px; font-weight:800; color:var(--text-primary,#e8e8f0); display:block; margin-bottom:3px; }
      .pm-card-desc { font-size:12px; color:rgba(200,195,255,0.45); line-height:1.4; }
      .pm-price-block { text-align:right; }
      .pm-price { font-size:28px; font-weight:800; color:var(--text-primary,#e8e8f0); line-height:1; display:block; }
      .pm-price-period { font-size:11px; color:rgba(200,195,255,0.40); display:block; margin-top:2px; }
      .pm-price-strike { font-size:11px; color:rgba(200,195,255,0.30); text-decoration:line-through; display:block; }
      .pm-feats { display:flex; flex-direction:column; gap:8px; margin-bottom:20px; flex:1; }
      .pm-feat { display:flex; align-items:center; gap:9px; font-size:13px; color:rgba(210,205,255,0.80); }
      .pm-feat-icon { width:18px; height:18px; border-radius:5px; background:rgba(108,99,255,0.18); display:flex; align-items:center; justify-content:center; font-size:10px; flex-shrink:0; }
      .pm-btn { width:100%; padding:14px; border:none; border-radius:12px; font-size:14px; font-weight:800; cursor:pointer; letter-spacing:0.02em; color:var(--text-primary); margin-top:auto; transition:opacity 0.15s, transform 0.1s; }
      .pm-btn:hover { opacity:0.92; }
      .pm-btn:active { transform:scale(0.98); }
      .pm-btn-purple { background:linear-gradient(135deg,#6C63FF,#9b5de5); box-shadow:0 4px 18px rgba(108,99,255,0.40); }
      .pm-btn-gold { background:linear-gradient(135deg,#d97706,#f59e0b); box-shadow:0 4px 18px rgba(245,158,11,0.35); }
      .pm-btn-green { background:linear-gradient(135deg,#059669,#10b981); box-shadow:0 4px 18px rgba(16,185,129,0.35); }
      .pm-btn-red { background:linear-gradient(135deg,#d97706,#ef4444); box-shadow:0 4px 18px rgba(245,158,11,0.35); }
      .pm-divider { font-size:11px; color:rgba(200,195,255,0.30); text-align:center; margin-top:8px; }
      .pm-footer { padding:16px 24px 28px; text-align:center; border-top:1px solid rgba(255,255,255,0.06); flex-shrink:0; }
      .pm-footer-trust { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:16px; margin-bottom:8px; }
      .pm-footer-item { display:flex; align-items:center; gap:5px; font-size:12px; color:rgba(200,195,255,0.40); }
      .pm-footer-note { font-size:11px; color:rgba(200,195,255,0.25); }
      @media(max-width:600px) {
        .pm-hero { padding:20px 16px 14px; }
        .pm-plans { grid-template-columns:1fr; padding:0 16px 20px; gap:14px; }
        .pm-stats { display:none; }
        .pm-card { padding:20px; }
      }
    </style>
    <div class="pm-wrap">
      <div class="pm-hero">
        <div class="pm-hero-title">Choose Your <em>CrackAI</em> Plan</div>
        <div class="pm-hero-sub">Unlock unlimited AI queries, image &amp; PDF solving, Voice Teacher, and every exam tool.</div>
      </div>
      <div class="pm-stats">
        <div class="pm-stat"><span class="pm-stat-num">50,000+</span><span class="pm-stat-lbl">Active Students</span></div>
        <div class="pm-stat"><span class="pm-stat-num">₹83/mo</span><span class="pm-stat-lbl">Best Plan Value</span></div>
        <div class="pm-stat"><span class="pm-stat-num">2×</span><span class="pm-stat-lbl">Higher Scores</span></div>
        <div class="pm-stat"><span class="pm-stat-num">Cancel</span><span class="pm-stat-lbl">Anytime</span></div>
      </div>
      <div class="pm-plans">


        <!-- SSC Pro -->
        <div class="pm-card featured">
          <div class="pm-badge purple">🏆 MOST POPULAR</div>
          <div class="pm-card-top">
            <div>
              <span class="pm-card-name">SSC Pro</span>
              <div class="pm-card-desc">CGL · CHSL · GD · MTS · CPO</div>
            </div>
            <div class="pm-price-block">
              <span class="pm-price">₹199</span>
              <span class="pm-price-period">per month</span>
            </div>
          </div>
          <div class="pm-feats">
            <div class="pm-feat"><div class="pm-feat-icon">💬</div> Unlimited AI questions</div>
            <div class="pm-feat"><div class="pm-feat-icon">🖼️</div> Image & PDF solving</div>
            <div class="pm-feat"><div class="pm-feat-icon">🎤</div> AI Teacher Voice Mode</div>
            <div class="pm-feat"><div class="pm-feat-icon">🤖</div> All AI models (Pro + V4)</div>
            <div class="pm-feat"><div class="pm-feat-icon">⚡</div> Priority AI responses</div>
            <div class="pm-feat"><div class="pm-feat-icon">🇮🇳</div> All 5 SSC exam modes</div>
          </div>
          <button class="pm-btn pm-btn-purple" onclick="handlePayment('ssc')">
            ${isPrem && curPlan === 'ssc' ? '✅ Your Current Plan' : '💳 Start SSC Pro — ₹199/month'}
          </button>
        </div>


        <!-- All-in-One Yearly -->
        <div class="pm-card gold">
          <div class="pm-badge gold">⭐ BEST VALUE — SAVE ₹1,389</div>
          <div class="pm-card-top">
            <div>
              <span class="pm-card-name">All-in-One Yearly</span>
              <div class="pm-card-desc">SSC + Class 9–12 + Full Platform</div>
            </div>
            <div class="pm-price-block">
              <span class="pm-price" style="color:#f59e0b;">₹999</span>
              <span class="pm-price-period">per year</span>
              <span class="pm-price-strike">₹2,388/yr</span>
            </div>
          </div>
          <div class="pm-feats">
            <div class="pm-feat"><div class="pm-feat-icon">✅</div> Everything in SSC Pro</div>
            <div class="pm-feat"><div class="pm-feat-icon">✅</div> Everything in Class Pro</div>
            <div class="pm-feat"><div class="pm-feat-icon">💬</div> Unlimited AI questions</div>
            <div class="pm-feat"><div class="pm-feat-icon">🎤</div> AI Teacher Voice Mode</div>
            <div class="pm-feat"><div class="pm-feat-icon">🖼️</div> Image & PDF solving</div>
            <div class="pm-feat"><div class="pm-feat-icon">⚡</div> Priority AI responses</div>
          </div>
          <div style="background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.20);border-radius:10px;padding:9px 13px;margin-bottom:16px;text-align:center;font-size:12px;color:#f59e0b;font-weight:700;">
            ₹999/year = only ₹83/month — 58% cheaper than monthly
          </div>
          <button class="pm-btn pm-btn-gold" onclick="handlePayment('yearly')">
            ${isPrem && curPlan === 'yearly' ? '✅ Your Current Plan' : '🌟 Get All-in-One Yearly — ₹999'}
          </button>
        </div>


        <!-- Class Pro -->
        <div class="pm-card">
          <div class="pm-badge green">🎒 CLASS 9–12 & COLLEGE</div>
          <div class="pm-card-top">
            <div>
              <span class="pm-card-name">Class Pro</span>
              <div class="pm-card-desc">Class 9-12 · B.Tech · B.Sc · BCA · CBSE/NCERT</div>
            </div>
            <div class="pm-price-block">
              <span class="pm-price" style="color:#34d399;">₹129</span>
              <span class="pm-price-period">per month</span>
            </div>
          </div>
          <div class="pm-feats">
            <div class="pm-feat"><div class="pm-feat-icon">💬</div> Unlimited AI questions</div>
            <div class="pm-feat"><div class="pm-feat-icon">🖼️</div> Image & PDF solving</div>
            <div class="pm-feat"><div class="pm-feat-icon">🎤</div> AI Teacher Voice Mode</div>
            <div class="pm-feat"><div class="pm-feat-icon">🤖</div> All AI models (Pro + V4)</div>
            <div class="pm-feat"><div class="pm-feat-icon">📚</div> Class 1-12 + B.Tech + College</div>
            <div class="pm-feat"><div class="pm-feat-icon">⚡</div> Priority AI responses</div>
          </div>
          <button class="pm-btn pm-btn-green" onclick="handlePayment('class10')" style="margin-bottom:8px;">
            ${isPrem && (curPlan === 'class10' || curPlan === 'class10_yearly') ? '✅ Your Current Plan' : '💳 Monthly — ₹129/month'}
          </button>
          <button class="pm-btn pm-btn-gold" onclick="handlePayment('class10_yearly')">
            ${isPrem && curPlan === 'class10_yearly' ? '✅ Your Current Plan' : '🌟 Yearly ₹1,299 — Save ₹249'}
          </button>
          <div class="pm-divider" style="margin-top:8px;">₹1,299/year = only ₹108/month</div>
        </div>


        <!-- Battle Creator -->
        <div class="pm-card">
          <div class="pm-badge red">⚔️ BATTLE CREATOR</div>
          <div class="pm-card-top">
            <div>
              <span class="pm-card-name">Battle Creator</span>
              <div class="pm-card-desc">Create online quiz battles · Max 5/month</div>
            </div>
            <div class="pm-price-block">
              <span class="pm-price" style="color:#f59e0b;">₹99</span>
              <span class="pm-price-period">per month</span>
            </div>
          </div>
          <div class="pm-feats">
            <div class="pm-feat"><div class="pm-feat-icon">⚔️</div> Create 5 battles/month</div>
            <div class="pm-feat"><div class="pm-feat-icon">👥</div> Up to 10 players/battle</div>
            <div class="pm-feat"><div class="pm-feat-icon">🤖</div> AI-generated MCQ questions</div>
            <div class="pm-feat"><div class="pm-feat-icon">🏆</div> Live XP leaderboard</div>
            <div class="pm-feat"><div class="pm-feat-icon">🌐</div> Public battles — all users join</div>
            <div class="pm-feat"><div class="pm-feat-icon">📊</div> Real-time score tracking</div>
          </div>
          <button class="pm-btn pm-btn-red" onclick="handlePayment('battle')">
            ${isPrem && curPlan === 'battle' ? '✅ Your Current Plan' : '⚔️ Become Battle Creator — ₹99/mo'}
          </button>
          <div class="pm-divider" style="margin-top:8px;">Free users can always JOIN · Only creators need this plan</div>
        </div>

      </div>

      <div class="pm-footer">
        <div class="pm-footer-trust">
          <div class="pm-footer-item">🔒 Secured by Cashfree</div>
          <div class="pm-footer-item">🏦 UPI · Cards · NetBanking</div>
          <div class="pm-footer-item">↩️ 24hr Refund Policy</div>
          <div class="pm-footer-item">📵 Cancel anytime</div>
        </div>
        <div class="pm-footer-note">SSC Pro ₹199/mo · Class Pro ₹129/mo · All-in-One ₹999/yr · Battle Creator ₹99/mo</div>
      </div>
    </div>
  `;
}


// ===== VOICE DEMO PLAYERS (welcome card + premium modal) =====
// Single shared audio element for premium-modal demo
var _pvs = { audio: null, playing: false };

function _makeDemoPlayer(audioId, playBtnId, playIconId, pauseIconId, orbId, barsId) {
  var audio   = document.getElementById(audioId);
  var playBtn = document.getElementById(playBtnId);
  var playIco = document.getElementById(playIconId);
  var pauIco  = document.getElementById(pauseIconId);
  var orb     = document.getElementById(orbId);
  var bars    = document.getElementById(barsId);
  if (!audio || !playBtn) return null;

  var playing = false;

  function setPlay(v) {
    playing = v;
    if (playIco) playIco.style.display = v ? 'none' : '';
    if (pauIco)  pauIco.style.display  = v ? '' : 'none';
    if (orb)  orb.classList.toggle('tvd-playing', v);
    if (orb)  orb.classList.toggle('tps-playing', v);
    if (bars) bars.classList.toggle('tvd-bars-active', v);
  }

  playBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    // Pause all other demo players
    ['teacherDemoAudio','premiumDemoAudio','premiumDemoAudio2'].forEach(function(id) {
      if (id !== audioId) { var a = document.getElementById(id); if (a) { a.pause(); a.currentTime = 0; } }
    });
    // Reset all other UI states
    document.querySelectorAll('.tvd-orb-wrap,.tps-orb-wrap,.pvs-orb-wrap').forEach(function(o) {
      o.classList.remove('tvd-playing','tps-playing');
    });
    document.querySelectorAll('.tvd-wave-bars,.tps-bars,.pvs-wave').forEach(function(b) {
      b.classList.remove('tvd-bars-active');
    });
    document.querySelectorAll('[id$="PlayIcon"],[id$="PlayIco"]').forEach(function(i) { i.style.display = ''; });
    document.querySelectorAll('[id$="PauseIcon"],[id$="PauseIco"]').forEach(function(i) { i.style.display = 'none'; });

    if (playing) {
      audio.pause(); setPlay(false);
    } else {
      audio.currentTime = 0;
      audio.play().then(function() { setPlay(true); }).catch(function() {
        // Browser blocked autoplay — animate anyway for demo effect
        setPlay(true);
        setTimeout(function() { setPlay(false); }, 7000);
      });
    }
  });

  audio.addEventListener('ended', function() { setPlay(false); });
  audio.addEventListener('pause', function() { if (playing) setPlay(false); });
  return { audio, setPlay };
}

function initVoiceDemos() {
  // Welcome screen card player
  _makeDemoPlayer('premiumDemoAudio','tvdPlayBtn','tvdPlayIcon','tvdPauseIcon','tvdOrbWrap','tvdWaveBars');
  // Teacher Mode dropdown player
  _makeDemoPlayer('teacherDemoAudio','tvdPlayBtn2','tpsPlayIcon','tpsPauseIcon','tpsOrbWrap','tpsBars');
  // Premium modal player — wired after renderPremiumModal() injects HTML
  _rewirePvsPlayer();
}

function _rewirePvsPlayer() {
  _makeDemoPlayer('premiumDemoAudio2','pvsPlayBtn','pvsPlayIcon','pvsPauseIcon','pvsOrbWrap','pvsWave');
}
window._rewirePvsPlayer = _rewirePvsPlayer;

// Patch openPremiumModal to re-wire the voice player after innerHTML is rebuilt
var _origOpenPremiumModal = openPremiumModal;
function openPremiumModal() {
  renderPremiumModal();
  dom.premiumModal.classList.add('active');
  // Re-wire the voice demo player now that DOM is fresh
  setTimeout(_rewirePvsPlayer, 0);
}
window.showPremiumModal = openPremiumModal;

// ===== SETTINGS =====
function openSettingsModal() {
  dom.settingsModal.classList.add('active');
  // Sync persona dropdown to current state
  const sel = document.getElementById('personaSettingsSelect');
  if (sel) sel.value = state.aiPersona || '';
  _updatePersonaSettingsDesc(state.aiPersona || '');
  refreshCoinUI();
  refreshShopItems();
}
function closeSettingsModal() { dom.settingsModal.classList.remove('active'); }

// ===== LEGAL MODALS =====
function openTermsModal() { dom.termsModal.classList.add('active'); }
function closeTermsModal() { dom.termsModal.classList.remove('active'); }
function openPrivacyModal() { dom.privacyModal.classList.add('active'); }
function closePrivacyModal() { dom.privacyModal.classList.remove('active'); }
function openRefundModal() { document.getElementById('refundModal')?.classList.add('active'); }
function closeRefundModal() { document.getElementById('refundModal')?.classList.remove('active'); }
function openAiDisclaimerModal() { document.getElementById('aiDisclaimerModal')?.classList.add('active'); }
function closeAiDisclaimerModal() { document.getElementById('aiDisclaimerModal')?.classList.remove('active'); }
function openAboutModal() { document.getElementById('aboutModal')?.classList.add('active'); }
function closeAboutModal() { document.getElementById('aboutModal')?.classList.remove('active'); }
// Terms/Privacy from auth screen (app not visible yet, open modal after showing app briefly)
window.openTermsFromAuth = function() { openTermsModal(); };
window.openPrivacyFromAuth = function() { openPrivacyModal(); };
window.openProfileModal = openProfileModal;
window.openTermsModal = openTermsModal;
window.openPrivacyModal = openPrivacyModal;

// ═════════════════════════════════════════════════════════════════════
// ═════ REFER & EARN SYSTEM - Professional Implementation ═════════════
// ═════════════════════════════════════════════════════════════════════

// Generate unique referral code for user
function generateReferralCode(uid) {
  if (!uid) return null;
  const p = 'sscai_u:' + uid + ':';
  let code = localStorage.getItem(p + 'referral_code');
  if (!code) {
    // Generate 6-char code
    code = Math.random().toString(36).substr(2, 6).toUpperCase();
    localStorage.setItem(p + 'referral_code', code);
  }
  return code;
}

// Get referral stats
function getReferralStats(uid) {
  if (!uid) return { invited: 0, converted: 0, freeMonths: 0 };
  const p = 'sscai_u:' + uid + ':';
  try {
    const data = JSON.parse(localStorage.getItem(p + 'referral_stats') || '{"invited":0,"converted":0,"freeMonths":0}');
    return { invited: data.invited || 0, converted: data.converted || 0, freeMonths: data.freeMonths || 0 };
  } catch { return { invited: 0, converted: 0, freeMonths: 0 }; }
}

// Get applied referral codes (one per user)
function getAppliedReferralCodes(uid) {
  if (!uid) return [];
  const p = 'sscai_u:' + uid + ':';
  try {
    return JSON.parse(localStorage.getItem(p + 'applied_codes') || '[]');
  } catch { return []; }
}

// Apply referral code
function applyReferralCode(referralCode) {
  if (!state.user || !state.user.uid) { showToast('❌ Please log in first'); return false; }
  if (!referralCode || referralCode.trim().length === 0) { showToast('❌ Invalid referral code'); return false; }
  
  const code = referralCode.trim().toUpperCase();
  const uid = state.user.uid;
  const p = 'sscai_u:' + uid + ':';
  
  // Check if already applied
  const appliedCodes = getAppliedReferralCodes(uid);
  if (appliedCodes.includes(code)) { showToast('✅ You already applied this code'); return false; }
  
  // Don't allow using own code
  const ownCode = localStorage.getItem(p + 'referral_code');
  if (code === ownCode) { showToast('❌ Cannot apply your own referral code'); return false; }
  
  // Find the referrer
  // Search through all users' stored codes
  let referrerId = null;
  try {
    // Since we don't have a database, we check a "referral registry" stored in sessionStorage
    const registry = JSON.parse(sessionStorage.getItem('referral_registry') || '{}');
    referrerId = registry[code];
  } catch { }
  
  if (!referrerId) { showToast('❌ Referral code not found'); return false; }
  
  // Mark as applied
  appliedCodes.push(code);
  localStorage.setItem(p + 'applied_codes', JSON.stringify(appliedCodes));
  
  // Increment referrer's invited count
  const rp = 'sscai_u:' + referrerId + ':';
  let refStats = getReferralStats(referrerId);
  refStats.invited++;
  localStorage.setItem(rp + 'referral_stats', JSON.stringify(refStats));
  
  showToast('✅ Referral code applied! Thank you for joining 🎉');
  return true;
}

// Process referral conversion (when friend upgrades to Battle Creator)
function processReferralConversion(referrerId) {
  if (!referrerId) return;
  const rp = 'sscai_u:' + referrerId + ':';
  let stats = getReferralStats(referrerId);
  stats.converted++;
  
  // Every 3 conversions = 1 free month (₹99 Battle Creator premium)
  const previousMonths = Math.floor((stats.converted - 1) / 3);
  const currentMonths = Math.floor(stats.converted / 3);
  
  if (currentMonths > previousMonths) {
    stats.freeMonths = currentMonths;
    // Apply 99 rs premium automatically
    const p = 'sscai_u:' + referrerId + ':';
    const expiryDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
    localStorage.setItem(p + 'premium', 'true');
    localStorage.setItem(p + 'premium_plan', 'battle');
    localStorage.setItem(p + 'premium_expires', expiryDate.toString());
    SecureLogger.log(`[Referral] User ${referrerId} earned free Battle Creator (${currentMonths} months)`);
  }
  
  localStorage.setItem(rp + 'referral_stats', JSON.stringify(stats));
}

// Check if user has reached 20 referrals for Pro subscription
function checkReferralProUpgrade(uid) {
  if (!uid) return false;
  const stats = getReferralStats(uid);
  if (stats.converted >= 20) {
    const p = 'sscai_u:' + uid + ':';
    if (localStorage.getItem(p + 'referral_pro_awarded') !== 'true') {
      const expiryDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
      localStorage.setItem(p + 'premium', 'true');
      localStorage.setItem(p + 'premium_plan', 'battle_pro');
      localStorage.setItem(p + 'premium_expires', expiryDate.toString());
      localStorage.setItem(p + 'referral_pro_awarded', 'true');
      showToast('🎉 Congratulations! You earned Battle Creator Pro for 20 referrals! 🏆');
      return true;
    }
  }
  return false;
}

// Load and display referral profile tab
function _loadProfileReferral() {
  const uid = state.user?.uid;
  if (!uid) return;
  
  const code = generateReferralCode(uid);
  const stats = getReferralStats(uid);
  
  const codeDisplay = document.getElementById('prf-ref-code-display');
  if (codeDisplay) codeDisplay.textContent = code || '—';
  
  const invitedEl = document.getElementById('prf-ref-invited');
  if (invitedEl) invitedEl.textContent = stats.invited;
  
  const convertedEl = document.getElementById('prf-ref-converted');
  if (convertedEl) convertedEl.textContent = stats.converted;
  
  const monthsEl = document.getElementById('prf-ref-months');
  if (monthsEl) monthsEl.textContent = stats.freeMonths;
  
  const progressLabel = document.getElementById('prf-ref-progress-label');
  const barFill = document.getElementById('prf-ref-bar-fill');
  const progressPercentage = ((stats.converted % 3) / 3) * 100;
  
  if (progressLabel) progressLabel.textContent = `${stats.converted % 3} / 3`;
  if (barFill) barFill.style.width = progressPercentage + '%';
  
  // Check for pro upgrade
  checkReferralProUpgrade(uid);
  
  // Update pro status if applicable
  if (stats.converted >= 20) {
    const progressCard = document.getElementById('prf-ref-progress-card');
    if (progressCard) {
      progressCard.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:12px;font-weight:700;color:var(--text-primary);">🏆 Battle Creator Pro Unlocked</span>
        </div>
        <div style="background:linear-gradient(90deg,#FF6B9D,#f59e0b);border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:13px;color:var(--text-primary);font-weight:700;">20+ Referrals Achieved!</div>
          <div style="font-size:11px;color:var(--text-primary);margin-top:4px;">You have unlimited Battle Creator access</div>
        </div>
      `;
    }
  }
}

// Copy referral code
function copyProfileReferralCode() {
  const uid = state.user?.uid;
  if (!uid) return;
  const code = generateReferralCode(uid);
  if (!code) { showToast('❌ Cannot generate referral code'); return; }
  
  navigator.clipboard.writeText(code).then(() => {
    showToast('✅ Code copied: ' + code);
  }).catch(() => {
    showToast('❌ Could not copy code');
  });
}

// Share referral code on WhatsApp
function shareProfileReferralWhatsApp() {
  const uid = state.user?.uid;
  if (!uid) return;
  const code = generateReferralCode(uid);
  if (!code) return;
  
  const url = window.location.origin;
  const text = `🎓 Join me on CrackAI — India's best AI exam prep!\n\nUse my referral code: ${code} when upgrading to Battle Creator.\n\nSign up: ${url}\n\n#CrackAI #SSC #Exams`;
  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(whatsappUrl, '_blank');
}

// Switch profile tab
function switchProfileTab(tabName, tabButton) {
  // Hide all tabs
  document.querySelectorAll('.prf-panel').forEach(p => { p.style.display = 'none'; });
  
  // Remove active class from all buttons
  document.querySelectorAll('.prf-tab').forEach(b => { b.classList.remove('active'); });
  
  // Show selected tab
  const tabEl = document.getElementById('prf-tab-' + tabName);
  if (tabEl) {
    tabEl.style.display = 'block';
    if (tabName === 'referral') _loadProfileReferral();
  }
  
  // Mark button as active
  if (tabButton) tabButton.classList.add('active');
}

// Expose functions to window
window.copyProfileReferralCode = copyProfileReferralCode;
window.shareProfileReferralWhatsApp = shareProfileReferralWhatsApp;
window.switchProfileTab = switchProfileTab;
window.applyReferralCode = applyReferralCode;

window.openProfileModal = openProfileModal;
window.openTermsModal = openTermsModal;
window.openPrivacyModal = openPrivacyModal;

// ===== WELCOME CHIPS =====
function setupWelcomeChips() {
  document.querySelectorAll('.welcome-chip').forEach(chip => {
    chip.addEventListener('click', () => { const prompt = chip.dataset.prompt; if (prompt) { dom.messageInput.value = prompt; sendMessage(); } });
  });
}

// ===== SSC MODE =====
function setupSscMode() {
  if (!dom.sscModeSelect) return;
  dom.sscModeSelect.value = state.sscMode;
  dom.sscModeSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    // Class 10 and Class 12 are free for all users
    state.sscMode = val;
    saveState();
    updateModeHeaderBadge();
    // Show fun class reaction then reload so DeepSeek picks up new system prompt
    showClassReaction(val);
    setTimeout(() => { window.location.reload(); }, 1200);
  });
}
function updateModeHeaderBadge() {
  const badge = document.getElementById('sscModeBadge');
  if (!badge) return;
  const shortMap = {
    cgl:'CGL', chsl:'CHSL', gd:'GD', mts:'MTS', cpo:'CPO',
    class1:'Cls 1', class2:'Cls 2', class3:'Cls 3', class4:'Cls 4', class5:'Cls 5',
    class6:'Cls 6', class7:'Cls 7', class8:'Cls 8', class9:'Cls 9',
    class10:'Cls 10', class11_sci:'XI Sci', class11_com:'XI Com', class11_arts:'XI Arts',
    class12_sci:'XII Sci', class12_com:'XII Com', class12_arts:'XII Arts'
  };
  badge.textContent = shortMap[state.sscMode] || state.sscMode.toUpperCase();
}

// ===== TEXTAREA AUTO-RESIZE =====
function autoResizeTextarea() { dom.messageInput.style.height = 'auto'; dom.messageInput.style.height = Math.min(dom.messageInput.scrollHeight, 100) + 'px'; }

// ===== SHOW MAIN APP =====
function showMainApp() {
  dom.app.classList.remove('hidden');
  // Hard-guarantee the flex layout renders on the chat-main
  const chatMain = document.querySelector('.chat-main');
  if (chatMain) {
    chatMain.style.flex = '1';
    chatMain.style.display = 'flex';
    chatMain.style.flexDirection = 'column';
    chatMain.style.minWidth = '0';
    chatMain.style.overflow = 'hidden';
  }
  if (dom.messagesContainer) {
    dom.messagesContainer.style.flex = '1';
    dom.messagesContainer.style.minHeight = '0';
    dom.messagesContainer.style.overflowY = 'auto';
  }
  applyTheme(state.theme);
  if (dom.darkModeToggle) dom.darkModeToggle.checked = state.theme === 'dark';
  if (dom.aiLangSelect) dom.aiLangSelect.value = state.aiLang;
  resetDailyCounts();
  updateUserUI();
  updateModeHeaderBadge();
  if (!state.chatSessions.length) { createNewSession(); }
  else if (state.currentSessionId && state.chatSessions.some(s => s.id === state.currentSessionId)) { loadSession(state.currentSessionId); }
  else { loadSession(state.chatSessions[0].id); }
  renderChatHistory();
  if (state.user) checkPendingPayment();
  resumeRewardIfActive();
  setTimeout(renderNativeAds, 500); // render ads after UI settles
}

// ===== MODEL SELECTOR =====
function setupModelSelector() {
  var selectorBtn = document.getElementById('modelSelectorBtn');
  var dropdown    = document.getElementById('modelDropdown');
  var selectorIcon  = document.getElementById('modelSelectorIcon');
  var selectorLabel = document.getElementById('modelSelectorLabel');
  var chipIcon = document.getElementById('activeModelChipIcon');
  var chipName = document.getElementById('activeModelChipName');
  if (!selectorBtn || !dropdown) return;

  var models = {
    smart:      { icon:'🧠', label:'PrepAI Smart',      chip:'Smart'   },
    flash:      { icon:'⚡', label:'PrepAI Flash',      chip:'Flash'   },
    pro:        { icon:'✨', label:'PrepAI Pro (R1)',    chip:'Pro'     },
    vision:     { icon:'🔍', label:'PrepAI Vision',     chip:'Vision'  },
    'vision-pro':{ icon:'🔬', label:'PrepAI Vision Pro', chip:'Vision Pro' },
    'voice-text':{ icon:'🎙️', label:'Voice → Text',    chip:'Voice'   },
    voice:      { icon:'🔊', label:'Voice Mode',        chip:'Voice'   },
    teacher:    { icon:'👩‍🏫', label:'Teacher Mode',    chip:'Teacher' },
    'v4-pro':   { icon:'🚀', label:'V4 Pro (Flagship)', chip:'V4 Pro'  },
  };

  var selectedModel = 'smart';

  // Toggle dropdown open/close
  selectorBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var open = dropdown.classList.toggle('open');
    selectorBtn.setAttribute('aria-expanded', open);
    // Stop demo audio when closing
    if (!open) stopAllDemoAudio();
  });

  // Close on outside click
  document.addEventListener('click', function(e) {
    if (!dropdown.contains(e.target) && e.target !== selectorBtn) {
      dropdown.classList.remove('open');
      selectorBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Option selection
  dropdown.querySelectorAll('.model-option').forEach(function(opt) {
    opt.addEventListener('click', function(e) {
      // Don't close if clicking teacher preview strip
      if (e.target.closest('.teacher-preview-strip')) return;
      var model = opt.dataset.model;
      if (!model) return;

      // Voice → Text — requires premium (like chats)
      if (model === 'voice-text' && !state.isPremium) {
        dropdown.classList.remove('open');
        openPremiumModal();
        return;
      }
      // Voice Mode — requires premium (like chats)
      if (model === 'voice' && !state.isPremium) {
        dropdown.classList.remove('open');
        openPremiumModal();
        return;
      }
      // Teacher mode — require premium (allow selection but show upgrade hint)
      if (model === 'teacher' && !state.isPremium) {
        showToast('👩‍🏫 Teacher Mode — upgrade for Google TTS voice! Using free voice now.');
        // Allow selection to proceed — don't block
      }
      // Pro model — included in all premium plans
      if (model === 'pro' && !state.isPremium) {
        dropdown.classList.remove('open');
        openPremiumModal();
        return;
      }
      // V4 Pro — DeepSeek flagship model, requires ₹149/month paid addon
      if (model === 'v4-pro' && !state.isPremium && !isAddonActive(ADDON_PLAN_V4PRO)) {
        dropdown.classList.remove('open');
        openV4ProModal();
        return;
      }

      selectedModel = model;
      // Update global DeepSeek model string
      window._selectedDeepSeekModel = DEEPSEEK_MODEL_MAP[model] || DEEPSEEK_MODEL;
      // Update UI
      dropdown.querySelectorAll('.model-option').forEach(function(o) {
        o.classList.remove('active');
        o.setAttribute('aria-selected', 'false');
        var chk = o.querySelector('.model-opt-check');
        if (chk) chk.textContent = '';
      });
      opt.classList.add('active');
      opt.setAttribute('aria-selected', 'true');
      var chk = opt.querySelector('.model-opt-check');
      if (chk) chk.textContent = '✓';

      var m = models[model] || models.smart;
      if (selectorIcon)  selectorIcon.textContent  = m.icon;
      if (selectorLabel) selectorLabel.textContent = m.label;
      if (chipIcon) chipIcon.textContent = m.icon;
      if (chipName) chipName.textContent = m.chip;

      dropdown.classList.remove('open');
      selectorBtn.setAttribute('aria-expanded', 'false');
      stopAllDemoAudio();
    });
  });

  // Tapping the teacher preview strip orb should NOT close the dropdown
  var tpsOrb = document.getElementById('tpsOrbWrap');
  if (tpsOrb) {
    tpsOrb.addEventListener('click', function(e) { e.stopPropagation(); });
  }
  var tpsUpgrade = document.querySelector('.tps-upgrade');
  if (tpsUpgrade) {
    tpsUpgrade.addEventListener('click', function(e) {
      e.stopPropagation();
      dropdown.classList.remove('open');
      openPremiumModal();
    });
  }
}

function stopAllDemoAudio() {
  ['teacherDemoAudio','premiumDemoAudio','premiumDemoAudio2'].forEach(function(id) {
    var a = document.getElementById(id);
    if (a && !a.paused) { a.pause(); a.currentTime = 0; }
  });
  document.querySelectorAll('.tvd-orb-wrap,.tps-orb-wrap,.pvs-orb-wrap').forEach(function(o) {
    o.classList.remove('tvd-playing','tps-playing');
  });
  document.querySelectorAll('.tvd-wave-bars,.tps-bars,.pvs-wave').forEach(function(b) {
    b.classList.remove('tvd-bars-active');
  });
}

// ===== PERSONA SELECTOR =====
function showPersonaSelector() {
  const modal = document.getElementById('personaSelectorModal');
  if (modal) modal.classList.add('active');
}
function closePersonaSelector() {
  const modal = document.getElementById('personaSelectorModal');
  if (modal) modal.classList.remove('active');
}

window.selectPersona = function(persona) {
  if (!persona) {
    state.aiPersona = null;
    saveState();
    closePersonaSelector();
    // sync settings dropdown
    const sel = document.getElementById('personaSettingsSelect');
    if (sel) sel.value = '';
    _updatePersonaSettingsDesc('');
    showToast('🤖 Default AI mode activated!');
    return;
  }
  state.aiPersona = persona;
  saveState();
  closePersonaSelector();
  // Sync the settings dropdown to match
  const sel = document.getElementById('personaSettingsSelect');
  if (sel) sel.value = persona;
  _updatePersonaSettingsDesc(persona);
  const names = {
    teacher:'Teacher 📚',
    friend:'Best Friend 🤝', professor:'Professor 🎩', mentor:'Mentor 🧘',
    motivator:'Motivator ⚡', coach:'Coach 🏋️',
  };
  showToast(`✅ ${names[persona] || persona} mode activated! 🎉`);
  _doConfetti();
};

// Update the small description line below the settings select
function _updatePersonaSettingsDesc(persona) {
  const el = document.getElementById('personaSettingsDesc');
  if (!el) return;
  const descs = {
    '': '',
    friend: '🤝 Chill study buddy — casual and fun',
    teacher: '📚 Patient, clear explanations with examples',
    professor: '🎩 Deep academic explanations with proper theory',
    mentor: '🧘 Life guide — mindset, habits & vision',
    motivator: '⚡ High energy hype — every message is a boost!',
    coach: '🏋️ Strict but fair — direct and results-focused',
  };
  el.textContent = descs[persona] || '';
}
window._updatePersonaSettingsDesc = _updatePersonaSettingsDesc;

window.showPersonaSelector = showPersonaSelector;
window.closePersonaSelector = closePersonaSelector;

// ── COMPANION ADDON MODAL (₹49 GF/BF unlock) ─────────────────
function openCompanionModal() {
  document.getElementById('companionAddonModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'companionAddonModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.88);padding:16px;';
  modal.innerHTML = `
    <div style="background:linear-gradient(145deg,#0f0c1f,#1a0a2e,#0d1a1f);border:1px solid rgba(255,107,157,0.4);border-radius:24px;padding:28px 22px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 0 80px rgba(255,107,157,0.15),0 0 40px rgba(108,99,255,0.1);position:relative;overflow:hidden;">
      <!-- Glow orbs -->
      <div style="position:absolute;top:-40px;right:-40px;width:160px;height:160px;background:radial-gradient(circle,rgba(255,107,157,0.15),transparent 70%);pointer-events:none;"></div>
      <div style="position:absolute;bottom:-40px;left:-40px;width:160px;height:160px;background:radial-gradient(circle,rgba(108,99,255,0.12),transparent 70%);pointer-events:none;"></div>

      <!-- Header -->
      <div style="font-size:48px;margin-bottom:8px;line-height:1;">💕</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:800;background:linear-gradient(135deg,#FF6B9D,#ff9a8b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:4px;">AI Companion Mode</div>
      <div style="font-size:13px;color:rgba(255,180,200,0.7);margin-bottom:20px;">Unlock Boyfriend & Girlfriend personas</div>

      <!-- Feature cards -->
      <div style="display:grid;gap:10px;margin-bottom:20px;text-align:left;">
        <div style="background:rgba(255,107,157,0.08);border:1px solid rgba(255,107,157,0.2);border-radius:12px;padding:12px 14px;display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:20px;flex-shrink:0;">💝</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:2px;">Flirty & Romantic Conversations</div>
            <div style="font-size:11px;color:rgba(200,180,220,0.65);">Sweet romantic messages, virtual hugs, cute Hinglish flirting — feels real!</div>
          </div>
        </div>
        <div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.2);border-radius:12px;padding:12px 14px;display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:20px;flex-shrink:0;">🥺</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:2px;">Emotional Support & Care</div>
            <div style="font-size:11px;color:rgba(200,180,220,0.65);">Asks about your day, your mood, cheers you up when stressed — always there for you.</div>
          </div>
        </div>
        <div style="background:rgba(255,157,107,0.07);border:1px solid rgba(255,157,107,0.2);border-radius:12px;padding:12px 14px;display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:20px;flex-shrink:0;">📚</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:2px;">Study Together</div>
            <div style="font-size:11px;color:rgba(200,180,220,0.65);">Helps you study while staying in character — "chal baby saath padhte hain 💕"</div>
          </div>
        </div>
        <div style="background:rgba(255,107,157,0.06);border:1px solid rgba(255,107,157,0.15);border-radius:12px;padding:12px 14px;display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:20px;flex-shrink:0;">💬</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:2px;">Natural Desi Hinglish</div>
            <div style="font-size:11px;color:rgba(200,180,220,0.65);">"jaan", "baby", "meri shona", playful jealousy, virtual forehead kisses 😘</div>
          </div>
        </div>
      </div>

      <!-- Personas preview -->
      <div style="display:flex;gap:10px;margin-bottom:20px;">
        <div style="flex:1;background:rgba(255,107,157,0.08);border:1px solid rgba(255,107,157,0.25);border-radius:12px;padding:10px;text-align:center;">
          <div style="font-size:24px;">👦</div>
          <div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-top:4px;">Boyfriend</div>
          <div style="font-size:10px;color:rgba(255,180,200,0.6);">Caring, protective & sweet</div>
        </div>
        <div style="flex:1;background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.25);border-radius:12px;padding:10px;text-align:center;">
          <div style="font-size:24px;">👩</div>
          <div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-top:4px;">Girlfriend</div>
          <div style="font-size:10px;color:rgba(200,180,255,0.6);">Cute, clingy & loving</div>
        </div>
      </div>

      <!-- Price -->
      <div style="margin-bottom:16px;">
        <div style="font-size:32px;font-weight:800;color:#FF6B9D;">₹49 <span style="font-size:13px;font-weight:400;color:rgba(200,180,220,0.5);">one-time</span></div>
        <div style="font-size:11px;color:rgba(200,180,220,0.4);">Lifetime access · Unlock both personas</div>
      </div>

      <!-- CTA -->
      <button id="companionPayBtn" style="width:100%;padding:15px;background:linear-gradient(135deg,#FF6B9D,#ff9a8b,#FF6B9D);background-size:200%;color:var(--text-primary);border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:10px;letter-spacing:0.02em;box-shadow:0 4px 20px rgba(255,107,157,0.4);">
        💕 Unlock Companion Mode — ₹49
      </button>
      <button onclick="document.getElementById('companionAddonModal').remove()" style="width:100%;padding:10px;background:transparent;color:rgba(200,180,220,0.45);border:1px solid rgba(255,107,157,0.15);border-radius:10px;font-size:13px;cursor:pointer;">
        Maybe Later
      </button>
      <div style="margin-top:12px;font-size:11px;color:rgba(200,180,220,0.3);">🔒 Secured by Cashfree · Safe & Private</div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('companionPayBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('companionPayBtn');
    if (!window._firebaseAuth?.currentUser) { showToast('Please login first!'); return; }
    btn.disabled = true; btn.textContent = '⏳ Creating order…';
    try {
      const uid = window._firebaseAuth.currentUser.uid;
      const orderId = 'addon_companion_' + uid + '_' + Date.now();
      const res = await fetch(CASHFREE_ORDER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: orderId, amount: 49, currency: 'INR',
          customer_id: uid,
          customer_email: window._firebaseAuth.currentUser.email || 'student@crackai.in',
          customer_phone: '9999999999',
          order_note: ADDON_PLAN_COMPANION,
          app_id: CASHFREE_APP_ID
        })
      });
      const data = await res.json();
      if (!data.payment_session_id) throw new Error('No session');
      const cashfree = window.Cashfree ? new window.Cashfree({ mode: 'production' }) : Cashfree({ mode: 'production' });
      const result = await cashfree.checkout({
        paymentSessionId: data.payment_session_id,
        redirectTarget: '_modal'
      });
      if (result?.paymentDetails?.paymentMessage === 'Payment successful' || result?.error === null) {
        // Verify payment
        const vRes = await fetch(VERIFY_PAYMENT_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: orderId, plan: ADDON_PLAN_COMPANION, uid })
        });
        setAddonActive(ADDON_PLAN_COMPANION);
        document.getElementById('companionAddonModal')?.remove();
        // Unlock companion options in the settings select
        _unlockCompanionSelectOptions();
        showToast('🎉 Companion Mode unlocked! Choose your persona 💕');
        _doConfetti();
        setTimeout(() => showPersonaSelector(), 800);
      }
    } catch(e) {
      btn.disabled = false; btn.textContent = '💕 Unlock Companion Mode — ₹49';
      showToast('Payment failed: ' + (e.message || 'Try again'));
    }
  });
}
window.openCompanionModal = openCompanionModal;


// ===== COSMETICS SHOP =====
const COSMETICS_KEY = 'sscai_cosmetics';
const COINS_KEY     = 'sscai_coins';

function getCoins() {
  const uid = (typeof state !== 'undefined' && state.user && state.user.uid) ? state.user.uid : (window._firebaseAuth?.currentUser?.uid || 'guest');
  
  if (!uid || uid === 'guest') {
    const guestCoins = JSON.parse(localStorage.getItem('sscai_u:guest:coins') || '{"coins":0}');
    return (guestCoins && guestCoins.coins) ? parseInt(guestCoins.coins, 10) : 0;
  }
  
  // Check all coin sources in priority order:
  // 1. Battle Arena per-uid (most recent from battles)
  try {
    const baCoins = JSON.parse(localStorage.getItem('sscai_u:' + uid + ':coins') || '{"coins":0}');
    if (baCoins && baCoins.coins > 0) {
      return parseInt(baCoins.coins, 10);
    }
  } catch(e) {}
  
  // 2. Legacy coins store
  try {
    const legacyCoins = parseInt(localStorage.getItem('sscai_coins') || '0', 10);
    if (legacyCoins > 0) return legacyCoins;
  } catch(e) {}
  
  return 0;
}

function setCoins(n) {
  const amount = Math.max(0, parseInt(n, 10));
  const uid = (typeof state !== 'undefined' && state.user && state.user.uid) ? state.user.uid : (window._firebaseAuth?.currentUser?.uid || 'guest');
  
  // Update primary battle arena store
  const baKey = 'sscai_u:' + (uid || 'guest') + ':coins';
  localStorage.setItem(baKey, JSON.stringify({ coins: amount, lastUpdated: Date.now() }));
  
  // Also update legacy store for backward compatibility
  localStorage.setItem('sscai_coins', amount);
  
  // Update UI
  refreshCoinUI();
}
function earnCoins(n) { setCoins(getCoins() + n); }

function getCosmetics() {
  // Reads from the unified shop_owned key (written by SHOP_CATALOG / handleShopItemClick)
  // and maps it to the legacy appCos format for backward compat.
  try {
    const uid2 = (typeof state !== 'undefined' && state.user && state.user.uid) ? state.user.uid : null;
    const shopKey  = uid2 ? ('sscai_u:' + uid2 + ':shop_owned') : 'sscai_guest:shop_owned';
    const shopData = JSON.parse(localStorage.getItem(shopKey) || '{"owned":[],"equipped":{}}');
    const eq = shopData.equipped || {};
    return {
      equipped_avatar: eq.avatars    || null,
      equipped_color:  eq.nameColors || null,
      equipped_frame:  eq.frames     || null,
      equipped_effect: eq.effects    || null,
      equipped_title:  eq.titles     || null,
      owned_avatar:    (shopData.owned || []).filter(id => id.startsWith('av_')),
      owned_color:     (shopData.owned || []).filter(id => id.startsWith('nc_')),
      owned_frame:     (shopData.owned || []).filter(id => id.startsWith('fr_')),
      owned_effect:    (shopData.owned || []).filter(id => id.startsWith('ef_')),
      owned_title:     (shopData.owned || []).filter(id => id.startsWith('ti_')),
    };
  } catch(e) { return {}; }
}
function saveCosmetics(data) {
  // Write to unified shop_owned key AND legacy key
  try {
    const uid2 = (typeof state !== 'undefined' && state.user && state.user.uid) ? state.user.uid : null;
    const shopKey  = uid2 ? ('sscai_u:' + uid2 + ':shop_owned') : 'sscai_guest:shop_owned';
    const shopData = JSON.parse(localStorage.getItem(shopKey) || '{"owned":[],"equipped":{}}');
    // Map legacy format → shop_owned format
    if (data['equipped_avatar']) shopData.equipped['avatars']    = data['equipped_avatar'];
    if (data['equipped_color'])  shopData.equipped['nameColors'] = data['equipped_color'];
    if (data['equipped_frame'])  shopData.equipped['frames']     = data['equipped_frame'];
    if (data['equipped_effect']) shopData.equipped['effects']    = data['equipped_effect'];
    if (data['equipped_title'])  shopData.equipped['titles']     = data['equipped_title'];
    const allOwned = [
      ...(data['owned_avatar'] || []),
      ...(data['owned_color']  || []),
      ...(data['owned_frame']  || []),
      ...(data['owned_effect'] || []),
      ...(data['owned_title']  || []),
    ];
    shopData.owned = [...new Set([...(shopData.owned || []), ...allOwned])];
    localStorage.setItem(shopKey, JSON.stringify(shopData));
    // Also write to legacy key for compat
    localStorage.setItem(COSMETICS_KEY, JSON.stringify(data));
  } catch(ex) {}
  // Trigger full cosmetic refresh
  setTimeout(() => { if (typeof applyAllCosmetics === 'function') applyAllCosmetics(); }, 30);
}

function getEquipped(type) { return getCosmetics()['equipped_' + type] || null; }
function getOwned(type)    { return getCosmetics()['owned_' + type]    || []; }

function refreshCoinUI() {
  // Read from both coin stores and show the higher value (battle-arena per-uid takes precedence)
  let c = getCoins();
  try {
    const _u = window._firebaseAuth && window._firebaseAuth.currentUser;
    const _uid2 = _u ? _u.uid : null;
    if (_uid2) {
      const _baCoins = JSON.parse(localStorage.getItem('sscai_u:' + _uid2 + ':coins') || 'null');
      if (_baCoins && (_baCoins.coins || 0) > c) { c = _baCoins.coins; }
    }
  } catch(e) {}
  const bal = document.getElementById('settingsCoinBalance');
  if (bal) bal.textContent = c;
  const profileCoinsEl = document.getElementById('profileCoinsVal');
  if (profileCoinsEl) profileCoinsEl.textContent = c;
  const drawerCoinsEl = document.getElementById('drawerCoinsVal');
  if (drawerCoinsEl) drawerCoinsEl.textContent = '🪙 ' + c + ' coins';
}

function openCosmeticsShop() {
  refreshCoinUI();
  refreshShopItems();
  const m = document.getElementById('cosmeticsShopModal');
  if (m) m.classList.add('active');
}
function closeCosmeticsShop() {
  const m = document.getElementById('cosmeticsShopModal');
  if (m) m.classList.remove('active');
}

function refreshShopItems() {
  // Read from the unified shop_owned key
  const uid2 = (typeof state !== 'undefined' && state.user && state.user.uid) ? state.user.uid : null;
  const shopKey = uid2 ? ('sscai_u:' + uid2 + ':shop_owned') : 'sscai_guest:shop_owned';
  let shopData = { owned: [], equipped: {} };
  try { shopData = JSON.parse(localStorage.getItem(shopKey) || '{"owned":[],"equipped":{}}'); } catch(e) {}

  // Map old cs-item data-type to shop tab key
  const tabMap = { avatar:'avatars', color:'nameColors', frame:'frames', effect:'effects', title:'titles' };

  document.querySelectorAll('.cs-item').forEach(item => {
    const type     = item.dataset.type;
    const id       = item.dataset.id;
    const cost     = parseInt(item.dataset.cost, 10);
    const shopTab  = tabMap[type] || type;
    const owned    = cost === 0 || shopData.owned.includes(id);
    const equipped = shopData.equipped[shopTab] === id;
    const btn = item.querySelector('.cs-buy-btn');
    item.classList.toggle('owned',    owned && !equipped);
    item.classList.toggle('equipped', equipped);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('owned-btn','equipped-btn');
      if (equipped) { btn.textContent = '✓ Equipped'; btn.classList.add('equipped-btn'); }
      else if (owned) { btn.textContent = 'Equip'; btn.classList.add('owned-btn'); }
      else { btn.textContent = getCoins() >= cost ? 'Buy ' + cost + '🪙' : '🔒 ' + cost + '🪙'; }
    }
  });
}

function handleCosmeticsBuy(type, id, cost) {
  // This function is called by the old in-app shop buttons.
  // We now redirect all purchases through the unified shop storage key
  // (sscai_u:{uid}:shop_owned) used by SHOP_CATALOG in index.html.

  // Map old 'type' values to SHOP_CATALOG tab keys
  const tabMap = { avatar:'avatars', color:'nameColors', frame:'frames', effect:'effects', title:'titles' };
  const shopTab = tabMap[type] || type;

  try {
    const uid2 = (state.user && state.user.uid) ? state.user.uid : null;
    const key  = uid2 ? ('sscai_u:' + uid2 + ':shop_owned') : 'sscai_guest:shop_owned';
    const data = JSON.parse(localStorage.getItem(key) || '{"owned":[],"equipped":{}}');
    const isFree = (cost === 0);
    const alreadyOwned = isFree || data.owned.includes(id);

    if (!alreadyOwned) {
      const coins = (typeof getCoins === 'function') ? getCoins() : 0;
      if (coins < cost) {
        if (typeof showToast === 'function') showToast('🪙 Not enough coins! Need ' + cost + ' — win battles to earn!');
        return;
      }
      if (typeof setCoins === 'function') setCoins(coins - cost);
      data.owned.push(id);
    }
    data.equipped[shopTab] = id;
    localStorage.setItem(key, JSON.stringify(data));

    // Apply all cosmetics immediately
    applyAllCosmetics();
    if (typeof refreshShopItems === 'function') refreshShopItems();
    if (typeof renderProfileShop === 'function') renderProfileShop();

    const verb = alreadyOwned ? 'Equipped' : 'Purchased & equipped';
    if (typeof showToast === 'function') showToast('✅ ' + verb + '! ');
  } catch(ex) {
    SecureLogger.error('[handleCosmeticsBuy]', ex);
  }
}

// ══════════════════════════════════════════════════════════════
// MASTER COSMETICS SYSTEM — reads from sscai_u:{uid}:shop_owned
// (the key used by SHOP_CATALOG / handleShopItemClick in index.html)
// ══════════════════════════════════════════════════════════════

const AVATAR_EMOJI_MAP = {
  av_fire:'🔥', av_lightning:'⚡', av_rocket:'🚀', av_crown:'👑',
  av_diamond:'💎', av_ninja:'🥷', av_wizard:'🧙‍♂️', av_robot:'🤖',
  av_astronaut:'👨‍🚀', av_galaxy:'🌌', av_phantom:'👻', av_tiger:'🐯',
  av_dragon:'🐉', av_legend:'⭐', av_star:'⭐', av_brain:'🧠',
  av_shield:'🛡️', av_gem:'💎', av_panda:'🐼', av_owl:'🦉', av_alien:'👽',
  av_knight:'🛡️', av_phoenix:'🦅', av_unicorn:'🦄', av_octopus:'🐙',
  av_shark:'🦈', av_genius:'🧠', av_samurai:'🗾', av_king:'🤴', av_queen:'👸',
  av_demon:'😈', av_angel:'👼', av_vampire:'🧛', av_werewolf:'🐺', av_mummy:'🪦',
  av_cyborg:'🦾', av_phoenix_fire:'🔥🦅', av_ice_wizard:'❄️🧙', av_zombie:'🧟', av_skeleton:'💀',
  av_viking:'⚔️', av_pirate:'🏴‍☠️', av_detective:'🕵️', av_superhero:'🦸', av_gladiator:'🛡️',
  av_golem:'🪨', av_titan:'🏔️', av_elf:'🧝', av_dwarf:'👲', av_gnome:'🧙',
  av_sphinx:'🦁', av_phoenix_wings:'🦅', av_crystal_form:'💎', av_cosmic_sage:'🌌🧙'
};
const AVATAR_GRAD_MAP = {
  av_fire:     'linear-gradient(135deg,#ff4500,#ff8c00)',
  av_lightning:'linear-gradient(135deg,#f59e0b,#fbbf24)',
  av_rocket:   'linear-gradient(135deg,#6C63FF,#a78bfa)',
  av_crown:    'linear-gradient(135deg,#ffd700,#ffb347)',
  av_diamond:  'linear-gradient(135deg,#00bfff,#7b72ff)',
  av_ninja:    'linear-gradient(135deg,#1a1a2e,#4a4a6a)',
  av_wizard:   'linear-gradient(135deg,#7c3aed,#a78bfa)',
  av_robot:    'linear-gradient(135deg,#00d4aa,#6C63FF)',
  av_astronaut:'linear-gradient(135deg,#1e3a5f,#3b82f6)',
  av_galaxy:   'linear-gradient(135deg,#0f0c29,#302b63)',
  av_phantom:  'linear-gradient(135deg,#2d2d2d,#6b6b6b)',
  av_tiger:    'linear-gradient(135deg,#ff6b00,#ff9a00)',
  av_dragon:   'linear-gradient(135deg,#7c3aed,#FF6B9D)',
  av_legend:   'linear-gradient(135deg,#f59e0b,#FF6B9D,#a78bfa)',
  av_star:     'linear-gradient(135deg,#ffd700,#ff8c00)',
  av_brain:    'linear-gradient(135deg,#ec4899,#f43f5e)',
  av_shield:   'linear-gradient(135deg,#1d4ed8,#3b82f6)',
  av_gem:      'linear-gradient(135deg,#00bfff,#7b72ff)',
  av_panda:    'linear-gradient(135deg,#1f2937,#9ca3af)',
  av_owl:      'linear-gradient(135deg,#92400e,#d97706)',
  av_alien:    'linear-gradient(135deg,#4ade80,#22c55e)',
  av_knight:   'linear-gradient(135deg,#475569,#94a3b8)',
  av_phoenix:  'linear-gradient(135deg,#dc2626,#f59e0b)',
  av_unicorn:  'linear-gradient(135deg,#FF6B9D,#c4b5fd,#38bdf8)',
  av_octopus:  'linear-gradient(135deg,#7c3aed,#ec4899)',
  av_shark:    'linear-gradient(135deg,#1e3a8a,#0ea5e9)',
  av_genius:   'linear-gradient(135deg,#ec4899,#a78bfa)',
  av_samurai:  'linear-gradient(135deg,#7f1d1d,#dc2626)',
  av_king:     'linear-gradient(135deg,#ffd700,#f59e0b)',
  av_queen:    'linear-gradient(135deg,#FF6B9D,#ffd700)',
  av_demon:    'linear-gradient(135deg,#7f1d1d,#b91c1c)',
  av_angel:    'linear-gradient(135deg,#fef08a,#fef3c7)',
  av_vampire:  'linear-gradient(135deg,#4c0519,#7f1d1d)',
  av_werewolf: 'linear-gradient(135deg,#78350f,#92400e)',
  av_mummy:    'linear-gradient(135deg,#a89f85,#c4b5a0)',
  av_cyborg:  'linear-gradient(135deg,#1f2937,#6366f1)',
  av_phoenix_fire:'linear-gradient(135deg,#ff4500,#FF6B9D)',
  av_ice_wizard:'linear-gradient(135deg,#38bdf8,#bfdbfe)',
  av_zombie:  'linear-gradient(135deg,#4ade80,#1f2937)',
  av_skeleton:'linear-gradient(135deg,#d1d5db,#9ca3af)',
  av_viking:  'linear-gradient(135deg,#7c2d12,#dc2626)',
  av_pirate:  'linear-gradient(135deg,#1f2937,#6366f1)',
  av_detective:'linear-gradient(135deg,#78716c,#57534e)',
  av_superhero:'linear-gradient(135deg,#1e40af,#3b82f6)',
  av_gladiator:'linear-gradient(135deg,#d97706,#f59e0b)',
  av_golem:   'linear-gradient(135deg,#6b7280,#9ca3af)',
  av_titan:   'linear-gradient(135deg,#7f1d1d,#ef4444)',
  av_elf:     'linear-gradient(135deg,#047857,#10b981)',
  av_dwarf:   'linear-gradient(135deg,#b45309,#d97706)',
  av_gnome:   'linear-gradient(135deg,#ec4899,#a78bfa)',
  av_sphinx:  'linear-gradient(135deg,#fbbf24,#fcd34d)',
  av_phoenix_wings:'linear-gradient(135deg,#ff6b6b,#ffb000)',
  av_crystal_form:'linear-gradient(135deg,#06b6d4,#0891b2)',
  av_cosmic_sage:'linear-gradient(135deg,#6366f1,#8b5cf6)',
};

// Name color map — covers all nc_ IDs in SHOP_CATALOG
const NAME_COLOR_MAP = {
  nc_white:   { color:'#ffffff' },
  nc_purple:  { color:'#5b46d4' },
  nc_gold:    { color:'#f59e0b' },
  nc_cyan:    { color:'#22d3ee' },
  nc_pink:    { color:'#FF6B9D' },
  nc_green:   { color:'#4ade80' },
  nc_red:     { color:'#ef4444' },
  nc_orange:  { color:'#f97316' },
  nc_silver:  { color:'#94a3b8' },
  nc_neon:    { color:'#39ff14' },
  nc_rainbow: { grad:'linear-gradient(90deg,#f59e0b,#ef4444,#a78bfa)' },
  nc_galaxy:  { grad:'linear-gradient(90deg,#6C63FF,#FF6B9D,#38bdf8)' },
  nc_teal:    { color:'#14b8a6' },
  nc_rose:    { color:'#fda4af' },
  nc_indigo:  { color:'#818cf8' },
  nc_sunset:  { grad:'linear-gradient(90deg,#f97316,#ec4899)' },
  nc_ocean:   { grad:'linear-gradient(90deg,#22d3ee,#6C63FF)' },
  nc_inferno: { grad:'linear-gradient(90deg,#ef4444,#f59e0b,#fde047)' },
  nc_mint:    { color:'#6ee7b7' },
  nc_lavender:{ color:'#c4b5fd' },
  nc_coral:   { color:'#fb7185' },
  nc_steel:   { color:'#60a5fa' },
  nc_aurora:  { grad:'linear-gradient(90deg,#4ade80,#22d3ee,#a78bfa)' },
  nc_candy:   { grad:'linear-gradient(90deg,#FF6B9D,#fda4af,#f59e0b)' },
  nc_fire:    { color:'#ff4500' },
  nc_ice:     { color:'#00bfff' },
  nc_emerald: { color:'#34d399' },
  nc_crimson: { color:'#dc2626' },
  nc_sapphire:{ color:'#1e40af' },
  nc_bronze:  { color:'#b45309' },
  nc_magenta: { color:'#d946ef' },
  nc_lime:    { color:'#84cc16' },
  nc_sky:     { color:'#0ea5e9' },
  nc_lightning:{grad:'linear-gradient(90deg,#fbbf24,#ff8c00)' },
  nc_mystic:  { grad:'linear-gradient(90deg,#a78bfa,#6C63FF,#ec4899)' },
  nc_stellar: { grad:'linear-gradient(90deg,#ffd700,#ff8c00,#ff4500)' },
  nc_neon_blue:{ color:'#00d4ff' },
  nc_neon_pink:{ color:'#ff006e' },
  nc_plasma:  { grad:'linear-gradient(90deg,#ff006e,#00d4ff,#ff00c3)' },
  nc_prism:   { grad:'linear-gradient(90deg,#ff0000,#ff7f00,#ffff00,#00ff00,#0000ff,#4b0082,#9400d3)' },
};

// Frame map — covers all fr_ IDs
const FRAME_MAP = {
  fr_none:    null,
  fr_gold:    { border:'2px solid #f59e0b', shadow:'0 0 10px rgba(245,158,11,0.6)' },
  fr_fire:    { border:'2px solid #ff4500', shadow:'0 0 12px rgba(255,69,0,0.7)' },
  fr_ice:     { border:'2px solid #00bfff', shadow:'0 0 12px rgba(0,191,255,0.6)' },
  fr_diamond: { border:'2px solid #b9f2ff', shadow:'0 0 14px rgba(185,242,255,0.8)' },
  fr_neon:    { border:'2px solid #39ff14', shadow:'0 0 14px rgba(57,255,20,0.8)' },
  fr_rainbow: { border:'2px solid transparent', shadow:'0 0 14px rgba(167,139,250,0.5)',
                gradient:'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#f59e0b,#FF6B9D,#a78bfa,#38bdf8) border-box' },
  fr_galaxy:  { border:'2px solid transparent', shadow:'0 0 18px rgba(108,99,255,0.7)',
                gradient:'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#0f0c29,#6C63FF,#FF6B9D,#38bdf8,#a78bfa) border-box' },
  fr_emerald: { border:'2px solid #34d399', shadow:'0 0 12px rgba(52,211,153,0.7)' },
  fr_royal:   { border:'2px solid #a78bfa', shadow:'0 0 12px rgba(167,139,250,0.7)' },
  fr_sunset:  { border:'2px solid transparent', shadow:'0 0 14px rgba(249,115,22,0.6)',
                gradient:'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#f97316,#ec4899) border-box' },
  fr_cosmic:  { border:'2px solid transparent', shadow:'0 0 18px rgba(56,189,248,0.6)',
                gradient:'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#38bdf8,#a78bfa,#f59e0b,#38bdf8) border-box' },
  fr_silver:  { border:'2px solid #cbd5e1', shadow:'0 0 10px rgba(203,213,225,0.6)' },
  fr_bronze:  { border:'2px solid #b45309', shadow:'0 0 10px rgba(180,83,9,0.6)' },
  fr_jade:    { border:'2px solid #10b981', shadow:'0 0 12px rgba(16,185,129,0.6)' },
  fr_solar:   { border:'2px solid transparent', shadow:'0 0 16px rgba(245,158,11,0.7)',
                gradient:'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#f59e0b,#fde047,#f97316) border-box' },
  fr_cyber:   { border:'2px solid #00d4ff', shadow:'0 0 16px rgba(0,212,255,0.8)' },
  fr_mystic:  { border:'2px solid transparent', shadow:'0 0 20px rgba(168,85,247,0.7)',
                gradient:'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#a855f7,#ec4899,#a855f7) border-box' },
  fr_plasma:  { border:'2px solid transparent', shadow:'0 0 18px rgba(255,0,127,0.6)',
                gradient:'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(90deg,#ff007f,#ff0080,#ff007f) border-box' },
  fr_crystal: { border:'2px solid #cffafe', shadow:'0 0 16px rgba(207,250,254,0.7)' },
  fr_inferno: { border:'2px solid transparent', shadow:'0 0 16px rgba(255,69,0,0.8)',
                gradient:'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#ff4500,#ff8c00,#ff4500) border-box' },
  fr_frost:   { border:'2px solid #bfdbfe', shadow:'0 0 14px rgba(191,219,254,0.7)' },
  fr_dark:    { border:'2px solid #1f2937', shadow:'0 0 8px rgba(31,41,55,0.5)' },
  fr_light:   { border:'2px solid #f0f9ff', shadow:'0 0 10px rgba(240,249,255,0.6)' },
  fr_abyss:   { border:'2px solid transparent', shadow:'0 0 22px rgba(0,0,0,0.8)',
                gradient:'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#000,#1a1a2e) border-box' },
  fr_heaven:  { border:'2px solid transparent', shadow:'0 0 20px rgba(255,255,255,0.7)',
                gradient:'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#fff,#fef3c7) border-box' },
  fr_obsidian:{ border:'2px solid #374151', shadow:'0 0 12px rgba(55,65,81,0.6)' },
  fr_pearl:   { border:'2px solid #f5f3ff', shadow:'0 0 12px rgba(245,243,255,0.6)' },
  fr_emerald_glow:{ border:'2px solid #10b981', shadow:'0 0 18px rgba(16,185,129,0.7)' },
  fr_ruby:    { border:'2px solid #dc2626', shadow:'0 0 14px rgba(220,38,38,0.7)' },
  fr_sapphire:{ border:'2px solid #1e40af', shadow:'0 0 14px rgba(30,64,175,0.7)' },
  fr_amethyst:{ border:'2px solid transparent', shadow:'0 0 16px rgba(139,92,246,0.7)',
                gradient:'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#8b5cf6,#a855f7) border-box' },
};

// Title map — covers all ti_ IDs
const TITLE_MAP = {
  ti_none:    null,
  ti_rookie:  { label:'📚 Rookie',      color:'#94a3b8' },
  ti_scholar: { label:'🎓 Scholar',     color:'#60a5fa' },
  ti_warrior: { label:'⚔️ Warrior',    color:'#f87171' },
  ti_champion:{ label:'🏆 Champion',   color:'#f59e0b' },
  ti_legend:  { label:'⭐ Legend',     color:'#5b46d4' },
  ti_elite:   { label:'💎 Elite',      color:'#38bdf8' },
  ti_master:  { label:'👑 Grand Master',color:'#ffd700' },
  ti_ssc_pro: { label:'🇮🇳 SSC Pro',   color:'#4ade80' },
  ti_topper:  { label:'🥇 Topper',     color:'#fb923c' },
  ti_cracker: { label:'🔥 Exam Cracker',color:'#ef4444' },
  ti_ai_beast:{ label:'🤖 AI Beast',   color:'#5b46d4' },
  ti_grinder: { label:'⏱️ Grinder',    color:'#38bdf8' },
  ti_strategist:{ label:'🧠 Strategist',color:'#818cf8' },
  ti_unstoppable:{ label:'🚀 Unstoppable',color:'#f59e0b' },
  ti_battle_king:{ label:'⚔️👑 Battle King',color:'#ffd700' },
  ti_immortal:{ label:'🛡️ Immortal',  color:'#94a3b8' },
  ti_goat:    { label:'🐐 GOAT',       color:'#22c55e' },
  ti_speedster:{ label:'💨 Speedster', color:'#38bdf8' },
  ti_sniper:  { label:'🎯 Sniper',     color:'#ef4444' },
  ti_veteran: { label:'🎖️ Veteran',    color:'#f59e0b' },
  ti_mastermind:{ label:'🧩 Mastermind',color:'#818cf8' },
  ti_phoenix_rising:{ label:'🔥🦅 Phoenix Rising',color:'#f97316' },
  ti_overlord:{ label:'🐉 Overlord',   color:'#7c3aed' },
  ti_cosmic_traveler:{ label:'🌌🧑‍🚀 Cosmic Traveler', color:'#06b6d4' },
  ti_quantum_master:{ label:'⚛️ Quantum Master', color:'#6366f1' },
  ti_void_walker:{ label:'🌑 Void Walker', color:'#1f2937' },
  ti_celestial:{ label:'✨ Celestial', color:'#fbbf24' },
  ti_vengeance:{ label:'💀 Vengeance', color:'#dc2626' },
  ti_shadow_knight:{ label:'🗡️ Shadow Knight', color:'#7f1d1d' },
  ti_inferno_lord:{ label:'🔥 Inferno Lord', color:'#ff4500' },
  ti_blizzard_sage:{ label:'❄️ Blizzard Sage', color:'#0ea5e9' },
  ti_tempest_wielder:{ label:'⚡ Tempest Wielder', color:'#fbbf24' },
  ti_nature_guardian:{ label:'🌿 Nature Guardian', color:'#10b981' },
  ti_arcane_mage:{ label:'🔮 Arcane Mage', color:'#a855f7' },
  ti_rune_scholar:{ label:'📖 Rune Scholar', color:'#8b5cf6' },
  ti_battle_sage:{ label:'🧙‍♂️ Battle Sage', color:'#ec4899' },
  ti_twilight_keeper:{ label:'🌓 Twilight Keeper', color:'#9333ea' },
  ti_draconic_lord:{ label:'🐲 Draconic Lord', color:'#ff6b6b' },
  ti_ethereal_being:{ label:'👻 Ethereal Being', color:'#5b46d4' },
  ti_crimson_knight:{ label:'🛡️ Crimson Knight', color:'#dc2626' },
  ti_golden_guardian:{ label:'🏛️ Golden Guardian', color:'#fbbf24' },
};


// Effect particles config
const EFFECT_MAP = {
  ef_none:      null,
  ef_sparkle:   { chars:['✨','⭐','💫'], count:8,  interval:2200, colors:['#ffd700','#fff'] },
  ef_fire:      { chars:['🔥','💥','🌟'], count:6,  interval:2000, colors:['#ff4500','#ff8c00'] },
  ef_lightning: { chars:['⚡','💥'],       count:5,  interval:1800, colors:['#f59e0b','#fbbf24'] },
  ef_confetti:  { chars:['🎊','🎉','🎈'], count:10, interval:2500, colors:['#6C63FF','#FF6B9D'] },
  ef_snowflake: { chars:['❄️','❄','✦'],  count:8,  interval:2800, colors:['#bfdbfe','#e0f2fe'] },
  ef_stars:     { chars:['🌟','⭐','✨'], count:10, interval:2000, colors:['#ffd700','#a78bfa'] },
  ef_matrix:    { chars:['0','1','01','10'],count:12,interval:1500, colors:['#4ade80','#22c55e'] },
  ef_laser:     { chars:['🔴','❤️‍🔥'],    count:4,  interval:1800, colors:['#ef4444','#ff4500'] },
  ef_aura:      { chars:['😇','🌟','✨'], count:12, interval:1500, colors:['#ffd700','#a78bfa','#38bdf8'] },
  ef_hearts:    { chars:['💖','💗','💕'], count:8,  interval:2200, colors:['#FF6B9D','#fda4af'] },
  ef_leaves:    { chars:['🍃','🍂','🍁'], count:8,  interval:2600, colors:['#f97316','#84cc16'] },
  ef_bubbles:   { chars:['🫧','💧'],       count:10, interval:2400, colors:['#22d3ee','#bae6fd'] },
  ef_money:     { chars:['💸','💵','🪙'], count:8,  interval:2000, colors:['#22c55e','#f59e0b'] },
  ef_petals:    { chars:['🌸','🌺','✿'],  count:9,  interval:2400, colors:['#FF6B9D','#fda4af'] },
  ef_orbit:     { chars:['🪐','✨','⭐'], count:6,  interval:2600, colors:['#a78bfa','#38bdf8'] },
  ef_smoke:     { chars:['💨','☁️'],      count:7,  interval:2400, colors:['#94a3b8','#cbd5e1'] },
  ef_rainbow:   { chars:['🌈','✨','💫'], count:8,  interval:2000, colors:['#f59e0b','#ef4444','#22d3ee','#a78bfa'] },
  ef_cosmic:    { chars:['🌌','⭐','💫','🪐'], count:10, interval:2300, colors:['#6C63FF','#a78bfa','#38bdf8'] },
  ef_shadow:    { chars:['🌑','👁️','💀'], count:6,  interval:2000, colors:['#1f2937','#4b5563'] },
  ef_crystal:   { chars:['💎','✨','🔮'], count:7,  interval:2200, colors:['#06b6d4','#cffafe'] },
  ef_void:      { chars:['◆','●','■'],    count:12, interval:1700, colors:['#000','#1a1a2e'] },
  ef_phoenix:   { chars:['🔥','🦅','✨'], count:8,  interval:2000, colors:['#ff4500','#fbbf24'] },
  ef_dragon:    { chars:['🐉','🔥','💥'], count:7,  interval:2100, colors:['#7c3aed','#FF6B9D'] },
  ef_aurora:    { chars:['🌌','✨','💫'], count:10, interval:2400, colors:['#4ade80','#22d3ee','#a78bfa'] },
  ef_inferno:   { chars:['🔥','💥','⚡'], count:9,  interval:1900, colors:['#ff4500','#ff8c00','#fbbf24'] },
  ef_blizzard:  { chars:['❄️','☃️','❅'],  count:9,  interval:2300, colors:['#0ea5e9','#bae6fd'] },
  ef_tempest:   { chars:['⚡','💨','🌪️'], count:8,  interval:2000, colors:['#fbbf24','#0ea5e9'] },
  ef_forest:    { chars:['🌿','🍃','🌲'], count:8,  interval:2500, colors:['#10b981','#6ee7b7'] },
  ef_arcane:    { chars:['🔮','✨','📖'], count:8,  interval:2200, colors:['#a855f7','#c4b5fd'] },
  ef_electro:   { chars:['⚡','💥','🌩️'], count:10, interval:1700, colors:['#fbbf24','#ff8c00'] },
  ef_celestial: { chars:['✨','⭐','🌟'], count:12, interval:2000, colors:['#fbbf24','#fcd34d'] },
};


// ── Read from the correct storage key used by the shop ──
function _getShopEquipped() {
  try {
    const uid2 = (state.user && state.user.uid) ? state.user.uid : null;
    const key = uid2 ? ('sscai_u:' + uid2 + ':shop_owned') : 'sscai_guest:shop_owned';
    const data = JSON.parse(localStorage.getItem(key) || '{"owned":[],"equipped":{}}');
    return data.equipped || {};
  } catch(e) { return {}; }
}

function _applyAvatarToEl(el, avatar, photoURL, initials) {
  if (!el) return;
  const isDefault = !avatar || avatar === 'av_default';
  if (!isDefault && AVATAR_EMOJI_MAP[avatar]) {
    el.textContent          = AVATAR_EMOJI_MAP[avatar];
    el.style.backgroundImage    = '';
    el.style.backgroundSize     = '';
    el.style.backgroundPosition = '';
    el.style.fontSize       = '22px';
    el.style.background     = AVATAR_GRAD_MAP[avatar] || 'linear-gradient(135deg,#6C63FF,#a78bfa)';
  } else if (photoURL) {
    el.textContent              = '';
    el.style.backgroundImage    = `url(${photoURL})`;
    el.style.backgroundSize     = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.background         = '';
    el.style.fontSize           = '';
  } else {
    el.textContent          = initials || '?';
    el.style.backgroundImage    = '';
    el.style.background     = 'linear-gradient(135deg,#6C63FF,#a78bfa)';
    el.style.fontSize           = '';
  }
}

// ── Effect animation engine ──
let _effectInterval = null;
function _startEffect(efId) {
  _stopEffect();
  const cfg = EFFECT_MAP[efId];
  if (!cfg) return;
  const overlay = document.getElementById('cosmeticEffectOverlay');
  if (!overlay) return;
  overlay.style.display = 'block';
  overlay.innerHTML = '';
  const spawn = () => {
    if (!document.getElementById('cosmeticEffectOverlay')) { _stopEffect(); return; }
    const span = document.createElement('span');
    const ch = cfg.chars[Math.floor(Math.random() * cfg.chars.length)];
    const x  = Math.random() * 100;
    const dur = 2.5 + Math.random() * 2;
    const sz  = 14 + Math.floor(Math.random() * 14);
    span.textContent = ch;
    span.style.cssText = `position:absolute;left:${x}%;top:105%;font-size:${sz}px;opacity:0.85;pointer-events:none;animation:cosFloat ${dur}s ease-in forwards;`;
    overlay.appendChild(span);
    setTimeout(() => { try { overlay.removeChild(span); } catch(e) {} }, dur * 1000);
  };
  // Inject keyframe once
  if (!document.getElementById('cosFloatStyle')) {
    const s = document.createElement('style');
    s.id = 'cosFloatStyle';
    s.textContent = '@keyframes cosFloat{0%{transform:translateY(0) rotate(0deg);opacity:0.85}100%{transform:translateY(-110vh) rotate(360deg);opacity:0}}';
    document.head.appendChild(s);
  }
  spawn();
  _effectInterval = setInterval(spawn, cfg.interval / cfg.count);
}
function _stopEffect() {
  if (_effectInterval) { clearInterval(_effectInterval); _effectInterval = null; }
  const overlay = document.getElementById('cosmeticEffectOverlay');
  if (overlay) { overlay.style.display = 'none'; overlay.innerHTML = ''; }
}

// ── THE MAIN FUNCTION — called after every buy/equip/unequip ──
function applyAllCosmetics() {
  // Read from the shop's actual storage key
  const equipped = _getShopEquipped();
  const photo    = state.user?.photoURL || '';
  const dispName = state.user?.displayName || state.user?.email || '';
  const initials = dispName
    ? dispName.split(/[ @]/).filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2)
    : '?';

  // ── 1. AVATAR ──
  const avatar = equipped.avatars || null;
  ['drawerAvatar','headerAvatar','profileAvatar'].forEach(id => {
    _applyAvatarToEl(document.getElementById(id), avatar, photo, initials);
  });
  // Larger emoji for profile modal
  const profAv = document.getElementById('profileAvatar');
  if (profAv && avatar && avatar !== 'av_default' && AVATAR_EMOJI_MAP[avatar]) {
    profAv.style.fontSize = '30px';
  }

  // ── 2. NAME COLOR ──
  const ncId  = equipped.nameColors || null;
  const ncCfg = ncId && NAME_COLOR_MAP[ncId];
  ['drawerUserName','profileName'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (ncCfg) {
      if (ncCfg.grad) {
        el.style.background            = ncCfg.grad;
        el.style.webkitBackgroundClip  = 'text';
        el.style.webkitTextFillColor   = 'transparent';
        el.style.backgroundClip        = 'text';
        el.style.color                 = '';
      } else {
        el.style.background            = '';
        el.style.webkitBackgroundClip  = '';
        el.style.webkitTextFillColor   = '';
        el.style.backgroundClip        = '';
        el.style.color                 = ncCfg.color;
      }
    } else {
      el.style.background = ''; el.style.webkitBackgroundClip = '';
      el.style.webkitTextFillColor = ''; el.style.backgroundClip = '';
      el.style.color = '';
    }
  });

  // ── 3. FRAME (border + glow on avatars) ──
  const frId  = equipped.frames || null;
  const frCfg = frId && FRAME_MAP[frId];
  ['drawerAvatar','headerAvatar','profileAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (frCfg) {
      if (frCfg.gradient) {
        el.style.border     = frCfg.border;
        el.style.background = frCfg.gradient;
        el.style.boxShadow  = frCfg.shadow || '';
      } else {
        el.style.border     = frCfg.border;
        el.style.boxShadow  = frCfg.shadow || '';
      }
    } else {
      el.style.border = ''; el.style.boxShadow = '';
    }
  });

  // ── 4. TITLE ──
  const tiId  = equipped.titles || null;
  const tiCfg = tiId && TITLE_MAP[tiId];
  // Drawer title
  const drawerTitle = document.getElementById('drawerUserTitle');
  if (drawerTitle) {
    if (tiCfg) {
      drawerTitle.textContent = tiCfg.label;
      drawerTitle.style.color = tiCfg.color;
      drawerTitle.style.display = 'block';
    } else {
      drawerTitle.style.display = 'none';
    }
  }
  // Profile modal title badge
  const profileTitle = document.getElementById('profileTitleBadge');
  if (profileTitle) {
    if (tiCfg) {
      profileTitle.textContent = tiCfg.label;
      profileTitle.style.color = tiCfg.color;
      profileTitle.style.borderColor = tiCfg.color + '44';
      profileTitle.style.background  = tiCfg.color + '18';
      profileTitle.style.display = 'inline-block';
    } else {
      profileTitle.style.display = 'none';
    }
  }

  // ── 5. EFFECT (floating particles) ──
  const efId = equipped.effects || null;
  if (efId && efId !== 'ef_none' && EFFECT_MAP[efId]) {
    _startEffect(efId);
  } else {
    _stopEffect();
  }
}

// Keep applyEquippedCosmetics as alias for backward compat
function applyEquippedCosmetics() {
  applyAllCosmetics();
}

function applyEquippedCosmeticsOld() {
  const cos    = getCosmetics();
  const avatar = cos['equipped_avatar'];
  const photo  = state.user?.photoURL || '';
  const initials = state.user?.displayName
    ? state.user.displayName.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
    : (state.user?.email ? state.user.email[0].toUpperCase() : '?');

  ['drawerAvatar','headerAvatar','profileAvatar'].forEach(id => {
    _applyAvatarToEl(document.getElementById(id), avatar, photo, initials);
  });
  // Apply name color
}  // end applyEquippedCosmeticsOld

// Coin earning is via battle wins only (not per message)
function earnCoinForMessage() { /* disabled — coins earned via battle wins only */ }

// ===== INITIALIZATION =====
function initApp() {
  applyTheme(state.theme);

  // Initialize drawer as open on desktop (768px+)
  if (window.innerWidth >= 768 && dom.drawer) {
    dom.drawer.classList.add('open');
  }

  // Core events
  dom.sendBtn.addEventListener('click', sendMessage);
  dom.messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  dom.messageInput.addEventListener('input', autoResizeTextarea);
  // Professional placeholder
  if (dom.messageInput) {
    dom.messageInput.placeholder = 'Ask any question…';
  }
  dom.menuBtn.addEventListener('click', openDrawer);
  if (dom.closeDrawerBtn) dom.closeDrawerBtn.addEventListener('click', closeDrawer);
  if (dom.drawerOverlay) dom.drawerOverlay.addEventListener('click', closeDrawer);
  dom.newChatBtn.addEventListener('click', () => { createNewSession(); closeDrawer(); });
  dom.clearAllHistoryBtn?.addEventListener('click', deleteAllSessions);
  dom.settingsBtn.addEventListener('click', openSettingsModal);
  dom.closeSettingsBtn.addEventListener('click', closeSettingsModal);
  dom.themeToggleBtn.addEventListener('click', toggleTheme);
  document.getElementById('upgradeDrawerBtn')?.addEventListener('click', () => { closeDrawer(); openPremiumModal(); });

  // ── Cosmetics Shop (inline in Settings) ──
  document.querySelectorAll('.cs-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.cs-tab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.cs-tab-content').forEach(function(c){ c.classList.remove('active'); });
      tab.classList.add('active');
      var target = document.getElementById('cs-tab-' + tab.dataset.tab);
      if (target) target.classList.add('active');
    });
  });
  document.querySelectorAll('.cs-buy-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      handleCosmeticsBuy(btn.dataset.type, btn.dataset.id, parseInt(btn.dataset.cost, 10));
    });
  });
  applyAllCosmetics();
  refreshCoinUI();

  if (dom.darkModeToggle) dom.darkModeToggle.addEventListener('change', (e) => applyTheme(e.target.checked ? 'dark' : 'light'));
  if (dom.aiLangSelect) dom.aiLangSelect.addEventListener('change', (e) => {
    state.aiLang = e.target.value;
    saveState();
    const langNames = { hinglish:'Hinglish', english:'English', hindi:'Hindi', marathi:'Marathi',
      bengali:'Bengali', tamil:'Tamil', telugu:'Telugu', gujarati:'Gujarati',
      kannada:'Kannada', punjabi:'Punjabi', odia:'Odia' };
    showToast('🌐 Language: ' + (langNames[state.aiLang] || state.aiLang));
  });

  // Sync persona settings dropdown on init
  const personaSettingsSel = document.getElementById('personaSettingsSelect');
  if (personaSettingsSel) {
    personaSettingsSel.value = state.aiPersona || '';
    if (window._updatePersonaSettingsDesc) _updatePersonaSettingsDesc(state.aiPersona || '');
  }

  // Cost toggles
  // Cost-saving features are always ON silently (no user permission required)
  state.cachingEnabled    = true;
  state.shortResponseMode = false; // keep response quality
  state.limitHistoryMode  = true;
  state.noSystemPrompt    = false;
  saveState();

  const planBadge = document.getElementById('planBadgeSettings');
  if (planBadge) planBadge.textContent = state.isPremium ? 'Unlimited' : '7/day';

  // Profile events
  if (dom.headerAvatar) dom.headerAvatar.addEventListener('click', openProfileModal);
  document.getElementById('drawerUserCard')?.addEventListener('click', openProfileModal);
  dom.closeProfileBtn?.addEventListener('click', closeProfileModal);
  dom.logoutBtn?.addEventListener('click', handleLogout);
  dom.upgradeFromProfileBtn?.addEventListener('click', () => { closeProfileModal(); openPremiumModal(); });
  dom.upgradeFromSettingsBtn?.addEventListener('click', () => { closeSettingsModal(); openPremiumModal(); });
  dom.closePremiumBtn?.addEventListener('click', closePremiumModal);
  // payWithCashfreeBtn replaced by per-plan inline buttons in renderPremiumModal
  dom.termsLink?.addEventListener('click', (e) => { e.preventDefault(); openTermsModal(); });
  dom.privacyLink?.addEventListener('click', (e) => { e.preventDefault(); openPrivacyModal(); });
  dom.closeTermsBtn?.addEventListener('click', closeTermsModal);
  dom.closePrivacyBtn?.addEventListener('click', closePrivacyModal);
  document.getElementById('refundLink')?.addEventListener('click', (e) => { e.preventDefault(); openRefundModal(); });
  document.getElementById('closeRefundBtn')?.addEventListener('click', closeRefundModal);
  document.getElementById('aiDisclaimerLink')?.addEventListener('click', (e) => { e.preventDefault(); openAiDisclaimerModal(); });
  document.getElementById('closeAiDisclaimerBtn')?.addEventListener('click', closeAiDisclaimerModal);
  document.getElementById('aboutLink')?.addEventListener('click', (e) => { e.preventDefault(); openAboutModal(); });
  document.getElementById('closeAboutBtn')?.addEventListener('click', closeAboutModal);
  document.getElementById('sessionKickedOkBtn')?.addEventListener('click', () => {
    const m = document.getElementById('sessionKickedModal');
    if (m) m.classList.remove('active');
  });
  document.getElementById('sessionConflictTakeOverBtn')?.addEventListener('click', () => {
    if (typeof window._sessionConflictTakeOver === 'function') window._sessionConflictTakeOver();
  });
  document.getElementById('sessionConflictCancelBtn')?.addEventListener('click', () => {
    if (typeof window._sessionConflictCancel === 'function') window._sessionConflictCancel();
  });
  dom.bookmarksBtn?.addEventListener('click', openBookmarksModal);
  dom.closeBookmarksBtn?.addEventListener('click', closeBookmarksModal);

  // ── MONETIZATION EVENT WIRING ─────────────────────────────
  document.getElementById('watchAdBtn')?.addEventListener('click', triggerRewardedAd);
  document.getElementById('closeRewardPopupBtn')?.addEventListener('click', closeRewardPopup);
  document.getElementById('rewardUpgradeBtn')?.addEventListener('click', () => { closeRewardPopup(); openPremiumModal(); });
  document.getElementById('adSimulatorCloseBtn')?.addEventListener('click', () => {
    document.getElementById('adSimulatorModal')?.classList.remove('active');
  });
  document.getElementById('rewardBadgeDismiss')?.addEventListener('click', () => {
    document.getElementById('rewardActiveBadge').style.display = 'none';
  });
  // Expose globally
  window.showRewardPopup   = showRewardPopup;
  window.triggerRewardedAd = triggerRewardedAd;
  window.closeRewardPopup  = closeRewardPopup;

  // Profile modal social sign-in buttons
  document.getElementById('profileGoogleBtn')?.addEventListener('click', async () => {
    closeProfileModal();
    await window.handleGoogleSignIn();
  });
  document.getElementById('profileAppleBtn')?.addEventListener('click', async () => {
    closeProfileModal();
    await window.handleAppleSignIn();
  });
  // Single delegated listener for all modal overlays (replaces querySelectorAll loop)
  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('active');
    }
  }, { passive: true });

  document.getElementById('closePersonaSelectorBtn')?.addEventListener('click', () => {
    // If user skips, keep showing it next login until they pick
    closePersonaSelector();
  });

  // Auth screen Google/Apple buttons
  document.getElementById('googleSignInBtn')?.addEventListener('click', window.handleGoogleSignIn);
  document.getElementById('appleSignInBtn')?.addEventListener('click', window.handleAppleSignIn);

  // File uploads, mode, voice, chips
  setupImageUpload(); setupPdfUpload(); setupUploadMenu(); setupSscMode(); setupVoiceInput(); setupWelcomeChips();
  setupModelSelector();
  // Init all voice demo players after DOM is ready
  setTimeout(initVoiceDemos, 200);

  // ── Boot: zero-black-screen strategy ─────────────────────────
  //
  //  The intro overlay sits on z-index 99999. While it plays we
  //  paint the real app UI UNDERNEATH it so it is fully ready the
  //  moment the overlay disappears — user never sees black.
  //
  //  Timeline:
  //  1. DOMContentLoaded → initApp() runs immediately.
  //  2. If cached user exists  → showMainApp() RIGHT NOW (hidden
  //     under the intro). Firebase reconciles in background.
  //  3. If no cached user      → show auth screen RIGHT NOW (also
  //     hidden under intro). Firebase may upgrade it silently.
  //  4. Intro fires sscIntroComplete → just remove the overlay.
  //     The app/auth is already painted. Zero delay, zero black.
  //
  // ─────────────────────────────────────────────────────────────

  let _bootDone = false;

  // ── STEP 1: Paint immediately, don't wait for intro ──────────
  function _paintImmediately() {
    if (_bootDone) return;

    if (state.user) {
      // Cached user — show app right now, under the intro
      _bootDone = true;
      showMainApp();
      _waitForFirebaseThenSync();
    } else {
      // No cache — attach Firebase listener immediately
      _attachFirebaseOrShowAuth();
    }
  }

  // ── STEP 2: Firebase path for first-time / logged-out users ──
  function _attachFirebaseOrShowAuth() {
    if (window._firebaseAuth && window._firebaseFns) {
      _attachAuthListener();
    } else if (window.__firebaseReady) {
      setTimeout(_attachFirebaseOrShowAuth, 10);
    } else {
      // Firebase SDK still loading — show auth immediately as
      // fallback so there is never a blank screen
      const t = setTimeout(() => {
        if (!_bootDone) {
          _bootDone = true;
          dom.authScreen.classList.remove('hidden');
        }
      }, 1200); // reduced from 4000 → show auth fast
      window.addEventListener('firebaseReady', () => {
        clearTimeout(t);
        if (!_bootDone) _attachAuthListener();
      }, { once: true });
    }
  }

  function _attachAuthListener() {
    const { onAuthStateChanged } = window._firebaseFns;
    onAuthStateChanged(window._firebaseAuth, async (fbUser) => {
      if (_bootDone) return;
      _bootDone = true;
      if (fbUser) {
        state.firebaseUser = fbUser;
        const uid = fbUser.uid;
        if (state.user && state.user.uid !== uid) {
          clearUserState();
          state.user = null;
        }
        if (!state.user) {
          state.user = {
            uid,
            name: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
            email: fbUser.email || '',
            photoURL: fbUser.photoURL || '',
            joinedDate: new Date().toLocaleDateString('en-IN'),
            verified: fbUser.emailVerified || false,
            provider: 'firebase'
          };
          loadUserState(uid);
          // ✅ FIX: Load XP from Firebase on login
          await loadXPFromFirebase(uid);
          saveState();
        }
        showMainApp();
        _syncFirestoreBackground(fbUser);
        // Apply all cosmetics after user is known (avatar, name color, frame, effect, title)
        setTimeout(() => { if (typeof applyAllCosmetics === 'function') applyAllCosmetics(); }, 300);
      } else {
        if (state.user) { clearUserState(); state.user = null; }
        localStorage.removeItem('sscai_active_uid');
        dom.authScreen.classList.remove('hidden');
      }
    });
  }

  function _waitForFirebaseThenSync() {
    function _attach() {
      const { onAuthStateChanged } = window._firebaseFns;
      const unsub = onAuthStateChanged(window._firebaseAuth, (fbUser) => {
        unsub();
        if (fbUser) {
          if (state.user && state.user.uid !== fbUser.uid) {
            clearUserState();
            if (dom.messages) dom.messages.innerHTML = '';
            state.user = {
              uid: fbUser.uid,
              name: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
              email: fbUser.email || '',
              photoURL: fbUser.photoURL || '',
              joinedDate: new Date().toLocaleDateString('en-IN'),
              verified: fbUser.emailVerified || false,
              provider: 'firebase'
            };
            loadUserState(fbUser.uid);
            saveState();
            showMainApp();
          } else {
            state.firebaseUser = fbUser;
            _syncFirestoreBackground(fbUser);
          }
        } else {
          clearUserState(); state.user = null;
          localStorage.removeItem('sscai_active_uid');
          dom.app.classList.add('hidden');
          dom.authScreen.classList.remove('hidden');
        }
      });
    }
    if (window._firebaseAuth && window._firebaseFns) {
      _attach();
    } else {
      window.addEventListener('firebaseReady', _attach, { once: true });
    }
  }

  // ── STEP 3: Paint the app NOW, before intro ends ─────────────
  // This is the key change: we don't wait for sscIntroComplete.
  // The intro overlay covers everything so painting early is safe.
  _paintImmediately();

  // ── STEP 4: When intro ends, just remove it — app already ready
  function _removeIntroOverlay() {
    const overlay = document.getElementById('sscIntroOverlay');
    if (overlay) {
      // Smooth fade-out so it doesn't feel abrupt
      overlay.style.transition = 'opacity 0.25s ease';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => overlay.remove(), 260);
    }
  }

  if (window.__introSkipped || window.__introComplete) {
    _removeIntroOverlay();
  } else {
    // Safety: remove intro after 5.5 s even if event never fires
    const introFallbackTimer = setTimeout(_removeIntroOverlay, 5500);
    window.addEventListener('sscIntroComplete', () => {
      clearTimeout(introFallbackTimer);
      _removeIntroOverlay();
    }, { once: true });
  }
  // ── END boot ──────────────────────────────────────────────────
}

// Wait for Firebase, then init
window.addEventListener('firebaseReady', () => {
  if (window._firebaseAuth && window._firebaseFns) {
    SecureLogger.log('Firebase ready');
  }
});

document.addEventListener('DOMContentLoaded', initApp);
// ══════════════════════════════════════════════════════════════
//  CHAT BAR VOICE DICTATION — speak to type (like ChatGPT)
// ══════════════════════════════════════════════════════════════
(function initChatDictation() {
  const GOOGLE_STT_KEY = '';

  let dictating = false;
  let recognition = null;
  let dictateBtn = null;

  function setupDictation() {
    dictateBtn = document.getElementById('chatDictateBtn');
    if (!dictateBtn) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      dictateBtn.title = 'Voice input not supported in this browser';
      dictateBtn.style.opacity = '0.4';
      dictateBtn.style.cursor = 'not-allowed';
      return;
    }

    dictateBtn.addEventListener('click', function(e) {
      e.preventDefault();
      if (dictating) {
        stopDictation();
      } else {
        startDictation();
      }
    });
  }

  function startDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();

    // Detect language from AI lang setting
    const langEl = document.getElementById('aiLangSelect');
    const lang = (langEl && langEl.value === 'hi') ? 'hi-IN' : 'en-IN';
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    dictating = true;
    dictateBtn.classList.add('dictating');
    dictateBtn.title = 'Listening… tap to stop';

    const textarea = document.getElementById('messageInput');
    const originalPlaceholder = textarea ? textarea.placeholder : '';
    if (textarea) textarea.placeholder = '🎤 Listening…';

    recognition.onresult = function(event) {
      let interimTranscript = '';
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t;
        else interimTranscript += t;
      }
      if (textarea) {
        // Show final text in textarea; show interim as placeholder
        if (finalTranscript) {
          textarea.value = (textarea.value + ' ' + finalTranscript).trim();
          textarea.dispatchEvent(new Event('input'));
        } else {
          textarea.placeholder = '🎤 ' + interimTranscript;
        }
      }
    };

    recognition.onerror = function(e) {
      SecureLogger.warn('[Dictation] error:', e.error);
      stopDictation();
      if (textarea) textarea.placeholder = originalPlaceholder;
      if (e.error === 'not-allowed') {
        if (typeof showToast === 'function') showToast('🎤 Mic permission denied. Please allow microphone access.');
      }
    };

    recognition.onend = function() {
      stopDictation();
      if (textarea) {
        textarea.placeholder = 'Ask your question…';
        textarea.focus();
      }
    };

    try {
      recognition.start();
    } catch(e) {
      stopDictation();
    }
  }

  function stopDictation() {
    dictating = false;
    if (dictateBtn) {
      dictateBtn.classList.remove('dictating');
      dictateBtn.title = 'Speak to type';
    }
    if (recognition) {
      try { recognition.stop(); } catch(e) {}
      recognition = null;
    }
  }

  // Init after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDictation);
  } else {
    setupDictation();
  }
})();


// ══════════════════════════════════════════════════════════════
//  SPEAK MESSAGE — Google TTS (premium/teacher) or Browser TTS
//  Triggered by the 🔊 button on AI messages
// ══════════════════════════════════════════════════════════════
(function() {
  // Google TTS config
  const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
  // Use same key as voice-ai.js — set window.GOOGLE_TTS_KEY once in voice-ai.js
  const GOOGLE_TTS_KEY = window.GOOGLE_TTS_KEY || '';
  let currentAudio = null;
  let currentSpeakBtn = null;

  function stripMarkdown(text) {
    return text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/#+\s*/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .substring(0, 1000);
  }

  async function speakWithGoogleTTS(text, lang) {
    // Get teacher voice choice from voiceAI state
    const vState = window.voiceAI?.getState?.() || {};
    const isTeacherMode = vState.model === 'teacher';
    const choice = vState.teacherVoiceChoice || 'auto';

    let voiceConfig;
    if (isTeacherMode && choice === 'hindi') {
      // User explicitly chose Hindi Teacher voice in settings
      voiceConfig = { languageCode: 'hi-IN', name: 'hi-IN-Wavenet-D', ssmlGender: 'FEMALE' };
    } else if (isTeacherMode) {
      // Default for teacher mode: Leda (en-US-Journey-F)
      // This is the SAME voice as assets/premium-demo.wav
      // Journey voice rules: languageCode must be 'en-US', NO ssmlGender
      voiceConfig = { languageCode: 'en-US', name: 'en-US-Journey-F' };
    } else {
      // Non-teacher mode: use language-appropriate Wavenet
      voiceConfig = {
        languageCode: lang.startsWith('hi') ? 'hi-IN' : 'en-IN',
        name: lang.startsWith('hi') ? 'hi-IN-Wavenet-D' : 'en-IN-Wavenet-D',
        ssmlGender: 'FEMALE'
      };
    }

    const body = {
      input: { text },
      voice: voiceConfig,
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: vState.speechRate || 1.0,
        // Journey voices ignore pitch — only set pitch for Wavenet
        ...(!voiceConfig.name.includes('Journey') ? { pitch: 0 } : {})
      }
    };
    const res = await fetch(`${GOOGLE_TTS_URL}?key=${GOOGLE_TTS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Google TTS ' + res.status);
    const data = await res.json();
    return 'data:audio/mp3;base64,' + data.audioContent;
  }

  function speakWithBrowserTTS(text, lang) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) { resolve(); return; }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      // Respect voiceAI prefs if available
      const vState = window.voiceAI?.getState?.() || {};
      let preferred = null;
      if (vState.preferredVoiceName) preferred = voices.find(v => v.name === vState.preferredVoiceName);
      if (!preferred) {
        const prefLang = vState.recognitionLang || lang || 'en-IN';
        preferred = voices.find(v => v.lang === prefLang)
          || voices.find(v => v.lang === 'en-IN' || v.lang === 'hi-IN' || v.name.includes('Google'))
          || voices.find(v => v.lang.startsWith('en')) || voices[0];
      }
      if (preferred) utter.voice = preferred;
      utter.lang   = vState.recognitionLang || lang || 'en-IN';
      utter.rate   = vState.speechRate  || 0.95;
      utter.pitch  = vState.speechPitch || 1.0;
      utter.volume = vState.speechVolume !== undefined ? vState.speechVolume : 1;
      utter.onend  = resolve;
      utter.onerror = resolve;
      window.speechSynthesis.speak(utter);
    });
  }

  window.speakMessage = async function(btn) {
    const bubble = btn.closest('.message-content')?.querySelector('.message-bubble');
    if (!bubble) return;

    // Stop any current playback
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (currentSpeakBtn && currentSpeakBtn !== btn) {
      currentSpeakBtn.classList.remove('speaking');
      currentSpeakBtn.textContent = '🔊';
    }

    // Toggle off if same button
    if (btn.classList.contains('speaking')) {
      btn.classList.remove('speaking');
      btn.textContent = '🔊';
      currentSpeakBtn = null;
      return;
    }

    btn.classList.add('speaking');
    btn.textContent = '⏹';
    currentSpeakBtn = btn;

    const text = stripMarkdown(bubble.innerText || '');
    if (!text) { btn.classList.remove('speaking'); btn.textContent = '🔊'; return; }

    const langEl = document.getElementById('aiLangSelect');
    const lang = (langEl && langEl.value === 'hi') ? 'hi-IN' : 'en-IN';

    try {
      // Always use browser TTS
      await speakWithBrowserTTS(text, lang);
    } finally {
      btn.classList.remove('speaking');
      btn.textContent = '🔊';
      currentSpeakBtn = null;
    }
  };
})();