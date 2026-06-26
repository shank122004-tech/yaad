/* ============================================================
   SSC PrepAI — VOICE AI MODULE v2.0
   voice-ai.js  |  Load AFTER app.js
   ============================================================
   Integrates with the new Gemini-style model selector.
   Models:
     smart      → Text (DeepSeek) — default
     flash      → Text fast mode (DeepSeek, short responses)
     pro        → Text deep mode (DeepSeek, detailed)
     vision     → Vision (Gemini) — auto-triggered by attachments
     vision-pro → Vision Pro (Gemini, advanced)
     voice-text → Speak → STT → DeepSeek → text reply
     voice      → Speak → STT → DeepSeek → Browser TTS
     teacher    → Speak → STT → DeepSeek → Google TTS (Premium ₹1)
*/

'use strict';

// ─── CONFIG ─────────────────────────────────────────────────
const VOICE_PLAN_ID    = 'teacher';
const VOICE_PLAN_PRICE = 1;
const VOICE_PLAN_NAME  = 'AI Teacher Pro';
const GOOGLE_TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
// ★ PUT YOUR GOOGLE TTS API KEY HERE ★
// Get one at: https://console.cloud.google.com → Cloud Text-to-Speech API
// Google TTS removed — using browser TTS only
window.GOOGLE_TTS_KEY = ''; // disabled
const PREMIUM_VOICE_NAME = 'Leda';
const RECOG_LANGS = [
  { code: 'hi-IN',  label: 'हिंदी' },
  { code: 'en-IN',  label: 'English (IN)' },
  { code: 'en-US',  label: 'English (US)' },
];

// Model definitions (mirrors HTML)
const MODELS = {
  smart:      { icon: '🧠', label: 'PrepAI Smart',      chipName: 'Smart',       type: 'text',    chipClass: '' },
  flash:      { icon: '⚡', label: 'PrepAI Flash',      chipName: 'Flash',       type: 'text',    chipClass: '' },
  pro:        { icon: '✨', label: 'PrepAI Pro',         chipName: 'Pro',         type: 'text',    chipClass: '' },
  vision:     { icon: '🔍', label: 'PrepAI Vision',     chipName: 'Vision',      type: 'vision',  chipClass: 'vision-chip' },
  'vision-pro':{ icon: '🔬', label: 'PrepAI Vision Pro', chipName: 'Vision Pro',  type: 'vision',  chipClass: 'vision-chip' },
  'voice-text':{ icon: '🎙️', label: 'Voice → Text',     chipName: 'Voice→Text',  type: 'voice',   chipClass: 'voice-chip' },
  voice:      { icon: '🔊', label: 'Voice Mode',        chipName: 'Voice',       type: 'voice',   chipClass: 'voice-chip' },

};

// ─── STATE ──────────────────────────────────────────────────
const voiceState = {
  model: 'smart',         // current model id
  mode: 'text',           // derived: 'text' | 'voice' (for legacy compat)
  isListening: false,
  isSpeaking: false,
  recognitionLang: 'hi-IN',
  speechRate: 1.0,
  speechPitch: 1.0,
  currentUtterance: null,
  recognition: null,
  pendingTranscript: '',
  premiumVoice: false,
  teacherVoiceChoice: 'auto',  // 'auto' | 'leda' | 'hindi' — persisted in settings
};

// ─── HELPERS ─────────────────────────────────────────────────
function _isTeacherPremium() {
  return (
    (typeof state !== 'undefined' && state.isPremium && state.premiumPlan === VOICE_PLAN_ID) ||
    localStorage.getItem('sscai_teacher_unlocked') === 'true'
  );
}
function _saveTeacherUnlocked() {
  localStorage.setItem('sscai_teacher_unlocked', 'true');
  voiceState.premiumVoice = true;
  _updateTeacherLock();
}
function _stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '').replace(/^[-*]\s/gm, '')
    .replace(/^\d+\.\s/gm, '').replace(/<[^>]+>/g, '')
    .replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').trim();
}

// ─── MODEL SELECTOR LOGIC ────────────────────────────────────
function _initModelSelector() {
  const wrap = document.getElementById('modelSelectorWrap');
  const btn  = document.getElementById('modelSelectorBtn');
  const drop  = document.getElementById('modelDropdown');
  if (!wrap || !btn || !drop) return;

  // Toggle dropdown
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = wrap.classList.contains('open');
    _closeAllDropdowns();
    if (!isOpen) {
      wrap.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) _closeAllDropdowns();
  });

  // Option selection
  drop.addEventListener('click', (e) => {
    const opt = e.target.closest('.model-option');
    if (!opt) return;
    const modelId = opt.dataset.model;
    if (!modelId) return;

    // Teacher mode removed
    if (false && modelId === 'teacher') {
      _closeAllDropdowns();
      openTeacherPaywall();
      return;
    }

    selectModel(modelId);
    _closeAllDropdowns();
  });

  // Upload sub-menu
  const uploadWrap = document.getElementById('uploadBtnWrap');
  const uploadBtn  = document.getElementById('uploadMenuBtn');
  if (uploadWrap && uploadBtn) {
    uploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = uploadWrap.classList.contains('open');
      _closeAllDropdowns();
      if (!isOpen) uploadWrap.classList.add('open');
    });
    document.addEventListener('click', (e) => {
      if (!uploadWrap.contains(e.target)) uploadWrap.classList.remove('open');
    });
  }

  // Wire image/pdf buttons
  document.getElementById('imageUploadBtn')?.addEventListener('click', () => {
    document.getElementById('imageInput')?.click();
    document.getElementById('uploadBtnWrap')?.classList.remove('open');
  });
  document.getElementById('pdfUploadBtn')?.addEventListener('click', () => {
    document.getElementById('pdfInput')?.click();
    document.getElementById('uploadBtnWrap')?.classList.remove('open');
  });
}

function _closeAllDropdowns() {
  const wrap = document.getElementById('modelSelectorWrap');
  wrap?.classList.remove('open');
  document.getElementById('modelSelectorBtn')?.setAttribute('aria-expanded', 'false');
}

function selectModel(modelId) {
  if (!MODELS[modelId]) return;
  voiceState.model = modelId;

  const m = MODELS[modelId];

  // Update selector button label
  const icon  = document.getElementById('modelSelectorIcon');
  const label = document.getElementById('modelSelectorLabel');
  if (icon)  icon.textContent  = m.icon;
  if (label) label.textContent = m.label;

  // Update active chip inside input
  const chipIcon = document.getElementById('activeModelChipIcon');
  const chipName = document.getElementById('activeModelChipName');
  const chip     = document.getElementById('activeModelChip');
  if (chipIcon) chipIcon.textContent = m.icon;
  if (chipName) chipName.textContent = m.chipName;
  if (chip) {
    chip.className = 'active-model-chip ' + (m.chipClass || '');
  }

  // Update dropdown checkmarks
  document.querySelectorAll('.model-option').forEach(opt => {
    const isActive = opt.dataset.model === modelId;
    opt.classList.toggle('active', isActive);
    const check = opt.querySelector('.model-opt-check');
    if (check) check.textContent = isActive ? '✓' : '';
  });

  // Update input container classes
  const container = document.getElementById('mainInputContainer');
  if (container) {
    container.classList.remove('voice-mode-active', 'teacher-mode-active', 'hide-voice', 'vip-keyboard-fallback');
    if (m.type === 'voice') {
      container.classList.add('voice-mode-active');
      _buildVoiceInputPanel();
      _updateVoicePanel(modelId);
    } else {
      // Hide mic for non-voice models
      container.classList.add('hide-voice');
      // Reset keyboard toggle button state if panel exists
      const kbBtn = document.getElementById('vipKeyboardToggle');
      if (kbBtn) { kbBtn.textContent = '⌨️'; kbBtn.title = 'Switch to keyboard input'; }
    }
  }

  // Update placeholder text
  const input = document.getElementById('messageInput');
  if (input) {
    const placeholders = {
      smart:       'Ask your SSC question…',
      flash:       'Quick question for fast answer…',
      pro:         'Ask for a deep, detailed explanation…',
      vision:      'Describe the image or PDF, or just send…',
      'vision-pro':'Upload image/PDF for advanced analysis…',
      'voice-text':'Tap mic 🎙️ to speak your question…',
      voice:       'Tap mic 🎙️ to speak — AI will answer aloud…',
      teacher:     'Tap mic 👩‍🏫 to speak — Teacher will answer…',
    };
    input.placeholder = placeholders[modelId] || 'Ask your SSC question…';
  }

  // Legacy compat
  voiceState.mode = m.type === 'voice' ? modelId : 'text';

  // Toast
  if (typeof showToast === 'function') {
    showToast(`${m.icon} ${m.label} selected`);
  }

  // Stop active speech/listening when switching
  stopSpeaking();
}

function _updateTeacherLock() {
  const teacherOpt = document.querySelector('[data-model="teacher"] .model-opt-name');
  if (!teacherOpt) return;
  // Update tag if unlocked
  const tag = teacherOpt.querySelector('.model-tag');
  if (tag && _isTeacherPremium()) {
    tag.textContent = 'UNLOCKED';
    tag.className = 'model-tag free-tag';
  }
}

// ─── VOICE INPUT BUTTON ──────────────────────────────────────
function _wireVoiceInputBtn() {
  if (window._voiceBtnWired) return;
  window._voiceBtnWired = true;

  const voiceBtn = document.getElementById('voiceInputBtn');
  if (!voiceBtn) return;

  voiceBtn.addEventListener('click', (e) => {
    const m = MODELS[voiceState.model];
    if (!m || m.type !== 'voice') {
      // In text/vision mode: show a toast guide
      if (typeof showToast === 'function') showToast('🎙️ Select a Voice model to use mic');
      return;
    }

    e.stopImmediatePropagation();

    if (voiceState.isListening) {
      stopListening();
      _closeVoiceOverlay();
      return;
    }
    if (voiceState.model === 'teacher' && !_isTeacherPremium()) {
      openTeacherPaywall();
      return;
    }
    startVoiceListening();
  }, true);
}

// ─── AUTO-SWITCH TO VISION ON ATTACHMENT ────────────────────
function _watchAttachments() {
  // Switch to Vision model when an image/PDF is attached
  const imageInput = document.getElementById('imageInput');
  const pdfInput   = document.getElementById('pdfInput');
  if (imageInput) {
    imageInput.addEventListener('change', () => {
      if (imageInput.files?.length > 0) {
        const currentModel = MODELS[voiceState.model];
        if (currentModel?.type === 'text') {
          selectModel('vision');
        }
      }
    });
  }
  if (pdfInput) {
    pdfInput.addEventListener('change', () => {
      if (pdfInput.files?.length > 0) {
        const currentModel = MODELS[voiceState.model];
        if (currentModel?.type === 'text') {
          selectModel('vision');
        }
      }
    });
  }
}

// ─── INJECT VOICE OVERLAY CSS ────────────────────────────────
function _injectVoiceCSS() {
  if (document.getElementById('voice-ai-styles')) return;
  const style = document.createElement('style');
  style.id = 'voice-ai-styles';
  style.textContent = `
/* ── Voice Overlay ────────────────────────────────────────── */
#voiceAiOverlay {
  position: fixed; inset: 0; z-index: 88888;
  background: rgba(5,5,10,0.9);
  backdrop-filter: blur(16px);
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  animation: voiceOverlayIn 0.22s ease;
}
#voiceAiOverlay.active { display: flex; }
@keyframes voiceOverlayIn {
  from { opacity: 0; transform: scale(0.97); }
  to   { opacity: 1; transform: scale(1); }
}
.vai-orb-wrap {
  position: relative; width: 130px; height: 130px;
  display: flex; align-items: center; justify-content: center;
}
.vai-orb {
  width: 86px; height: 86px; border-radius: 50%;
  background: linear-gradient(135deg, #6C63FF 0%, #FF6B9D 100%);
  box-shadow: 0 0 50px rgba(108,99,255,0.6);
  display: flex; align-items: center; justify-content: center;
  position: relative; z-index: 2;
  animation: orbPulse 1.5s ease-in-out infinite;
}
.vai-orb.speaking-state {
  background: linear-gradient(135deg, #10B981 0%, #34D399 100%);
  box-shadow: 0 0 50px rgba(16,185,129,0.6);
  animation: speakPulse 0.8s ease-in-out infinite;
}
.vai-orb.teacher-state {
  background: linear-gradient(135deg, #FF6B9D 0%, #f59e0b 100%);
  box-shadow: 0 0 50px rgba(255,107,157,0.6);
}
@keyframes orbPulse {
  0%,100% { transform: scale(1); } 50% { transform: scale(1.08); }
}
@keyframes speakPulse {
  0%,100% { transform: scale(1); } 50% { transform: scale(1.04); }
}
.vai-orb-ring {
  position: absolute; border-radius: 50%;
  border: 1.5px solid rgba(108,99,255,0.35);
  animation: ringExpand 1.8s ease-out infinite;
}
.vai-orb-ring:nth-child(1) { width: 106px; height: 106px; animation-delay: 0s; }
.vai-orb-ring:nth-child(2) { width: 126px; height: 126px; animation-delay: 0.5s; }
.vai-orb-ring:nth-child(3) { width: 146px; height: 146px; animation-delay: 1s; }
@keyframes ringExpand {
  0% { opacity: 0.7; transform: scale(0.85); }
  100% { opacity: 0; transform: scale(1.2); }
}
.vai-orb-icon { font-size: 34px; line-height: 1; }
.vai-model-badge {
  display: inline-block;
  padding: 3px 12px;
  background: rgba(108,99,255,0.18);
  border: 1px solid rgba(108,99,255,0.3);
  border-radius: 20px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(200,195,255,0.85);
}
.vai-model-badge.teacher-badge {
  background: rgba(255,107,157,0.15);
  border-color: rgba(255,107,157,0.3);
  color: rgba(255,200,225,0.9);
}
.vai-status-label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 22px; font-weight: 600;
  color: var(--text-primary); letter-spacing: 0.02em; text-align: center;
}
.vai-transcript {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px; color: rgba(200,195,255,0.8);
  text-align: center; max-width: 300px; min-height: 22px;
  line-height: 1.5; font-style: italic;
  background: rgba(108,99,255,0.06);
  border-radius: 12px; padding: 8px 16px;
}
.vai-lang-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
.vai-lang-btn {
  padding: 5px 14px; border-radius: 16px;
  border: 1px solid rgba(108,99,255,0.3);
  background: rgba(108,99,255,0.1);
  color: rgba(200,195,255,0.8);
  font-size: 12px; font-family: 'Plus Jakarta Sans', sans-serif;
  cursor: pointer; transition: all 0.15s;
}
.vai-lang-btn.active { border-color: #6C63FF; background: rgba(108,99,255,0.25); color: var(--text-primary); }
.vai-controls { display: flex; gap: 12px; align-items: center; }
.vai-btn {
  padding: 12px 28px; border-radius: 24px; border: none;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all 0.18s ease;
}
.vai-btn-cancel { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.12); }
.vai-btn-cancel:hover { background: rgba(255,255,255,0.14); }
.vai-btn-stop { background: rgba(239,68,68,0.2); color: #EF4444; border: 1px solid rgba(239,68,68,0.3); }
.vai-btn-stop:hover { background: rgba(239,68,68,0.3); }
.vai-waveform { display: flex; align-items: center; gap: 3px; height: 36px; }
.vai-wave-bar {
  width: 4px; border-radius: 3px;
  background: linear-gradient(to top, #6C63FF, #FF6B9D);
  animation: waveAnim 0.6s ease-in-out infinite;
}
.vai-wave-bar:nth-child(1){animation-delay:0.0s}
.vai-wave-bar:nth-child(2){animation-delay:0.1s}
.vai-wave-bar:nth-child(3){animation-delay:0.2s}
.vai-wave-bar:nth-child(4){animation-delay:0.1s}
.vai-wave-bar:nth-child(5){animation-delay:0.0s}
@keyframes waveAnim { 0%,100%{height:6px} 50%{height:28px} }

/* ── Teacher Paywall ──────────────────────────────────────── */
#teacherPaywallModal {
  display: none; position: fixed; inset: 0; z-index: 99998;
  background: rgba(5,5,10,0.88);
  backdrop-filter: blur(18px);
  align-items: center; justify-content: center;
}
#teacherPaywallModal.active { display: flex; }
.tpw-card {
  background: linear-gradient(145deg, #0f0a25 0%, #1a0f3a 100%);
  border: 1px solid rgba(255,107,157,0.25);
  border-radius: 24px; padding: 36px 32px;
  max-width: 360px; width: calc(100% - 32px);
  position: relative; text-align: center;
  box-shadow: 0 24px 80px rgba(108,99,255,0.3);
}
.tpw-close {
  position: absolute; top: 14px; right: 14px;
  background: none; border: none; color: rgba(255,255,255,0.5);
  cursor: pointer; font-size: 20px; line-height: 1; padding: 4px;
}
.tpw-badge {
  display: inline-block;
  background: linear-gradient(135deg, #FF6B9D, #f59e0b);
  color: var(--text-primary); font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  padding: 3px 12px; border-radius: 20px; margin-bottom: 16px;
}
.tpw-icon { font-size: 52px; margin-bottom: 12px; }
.tpw-title { font-family:'Space Grotesk',sans-serif; font-size:22px; font-weight:700; color:var(--text-primary); margin-bottom:8px; }
.tpw-sub { font-size:13px; color:rgba(200,195,255,0.7); line-height:1.6; margin-bottom:20px; }
.tpw-features { list-style:none; padding:0; margin:0 0 24px; text-align:left; display:flex; flex-direction:column; gap:8px; }
.tpw-features li { font-size:13px; color:var(--text-secondary); display:flex; align-items:center; gap:8px; }
.tpw-features li::before { content:'✓'; color:#FF6B9D; font-weight:700; font-size:14px; flex-shrink:0; }
.tpw-price { font-family:'Space Grotesk',sans-serif; font-size:32px; font-weight:700; color:var(--text-primary); margin-bottom:4px; }
.tpw-price span { font-size:14px; color:rgba(200,195,255,0.6); font-weight:400; }
.tpw-pay-btn {
  width:100%; padding:14px;
  background:linear-gradient(135deg,#FF6B9D 0%,#f59e0b 100%);
  color:var(--text-primary); border:none; border-radius:14px;
  font-family:'Plus Jakarta Sans',sans-serif;
  font-size:15px; font-weight:700; cursor:pointer; margin-top:16px;
  box-shadow:0 4px 20px rgba(255,107,157,0.35); transition:all 0.18s ease;
}
.tpw-pay-btn:hover { transform:translateY(-1px); box-shadow:0 6px 28px rgba(255,107,157,0.45); }
.tpw-pay-btn:disabled { opacity:0.6; cursor:not-allowed; transform:none; }
.tpw-secure { font-size:11px; color:rgba(200,195,255,0.45); margin-top:12px; }

/* ── Speak btn on AI messages ─────────────────────────────── */
.msg-speak-btn {
  background: none; border: none; cursor: pointer;
  padding: 3px 6px; border-radius: 8px;
  font-size: 14px; color: var(--text-muted,rgba(255,255,255,0.4));
  transition: all 0.15s; line-height: 1;
}
.msg-speak-btn:hover { color: #6C63FF; background: rgba(108,99,255,0.12); }
.msg-speak-btn.speaking { color: #10B981; animation: speakBtnPulse 0.8s ease-in-out infinite; }
@keyframes speakBtnPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

/* ── Voice btn highlight when model is voice ──────────────── */
#voiceInputBtn.model-is-voice { color: #6C63FF !important; }
#voiceInputBtn.model-is-teacher { color: #FF6B9D !important; }

/* ── Voice Panel (replaces textarea in voice mode) ────────── */
#voiceInputPanel {
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 18px 16px 14px;
  width: 100%;
  min-height: 110px;
  position: relative;
}
#mainInputContainer.voice-mode-active #voiceInputPanel,
#mainInputContainer.teacher-mode-active #voiceInputPanel {
  display: flex;
}
#mainInputContainer.voice-mode-active .message-input,
#mainInputContainer.teacher-mode-active .message-input {
  display: none !important;
}
#mainInputContainer.voice-mode-active #activeModelChip,
#mainInputContainer.teacher-mode-active #activeModelChip {
  display: none !important;
}
/* hide the right-side actions (upload/send) in voice mode */
#mainInputContainer.voice-mode-active .input-actions-right,
#mainInputContainer.teacher-mode-active .input-actions-right {
  display: none !important;
}

/* Tap-to-speak large orb button */
#vipTapBtn {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  flex-shrink: 0;
  background: linear-gradient(135deg, #6C63FF 0%, #a78bfa 100%);
  box-shadow: 0 0 0 0 rgba(108,99,255,0.5), 0 4px 24px rgba(108,99,255,0.4);
  animation: vipIdle 2.4s ease-in-out infinite;
}
#vipTapBtn.teacher-orb {
  background: linear-gradient(135deg, #FF6B9D 0%, #f59e0b 100%);
  box-shadow: 0 0 0 0 rgba(255,107,157,0.5), 0 4px 24px rgba(255,107,157,0.4);
  animation: vipIdleTeacher 2.4s ease-in-out infinite;
}
#vipTapBtn:active { transform: scale(0.93); }
#vipTapBtn svg { pointer-events: none; }

@keyframes vipIdle {
  0%,100% { box-shadow: 0 0 0 0 rgba(108,99,255,0.45), 0 4px 24px rgba(108,99,255,0.35); }
  50%      { box-shadow: 0 0 0 12px rgba(108,99,255,0), 0 6px 30px rgba(108,99,255,0.5); }
}
@keyframes vipIdleTeacher {
  0%,100% { box-shadow: 0 0 0 0 rgba(255,107,157,0.45), 0 4px 24px rgba(255,107,157,0.35); }
  50%      { box-shadow: 0 0 0 12px rgba(255,107,157,0), 0 6px 30px rgba(255,107,157,0.5); }
}

/* Hint text */
#vipHintText {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: rgba(200,195,255,0.65);
  letter-spacing: 0.02em;
  text-align: center;
  line-height: 1.5;
}
#mainInputContainer.teacher-mode-active #vipHintText {
  color: rgba(255,200,225,0.65);
}

/* Keyboard toggle */
#vipKeyboardToggle {
  position: absolute;
  right: 12px;
  bottom: 10px;
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(200,195,255,0.4);
  font-size: 18px;
  padding: 4px;
  transition: color 0.15s;
  line-height: 1;
}
#vipKeyboardToggle:hover { color: rgba(200,195,255,0.8); }

/* When keyboard fallback is toggled on */
#mainInputContainer.vip-keyboard-fallback #voiceInputPanel { display: none !important; }
#mainInputContainer.vip-keyboard-fallback .message-input { display: block !important; }
#mainInputContainer.vip-keyboard-fallback #activeModelChip { display: flex !important; }
#mainInputContainer.vip-keyboard-fallback .input-actions-right { display: flex !important; }

@media (max-width: 420px) {
  .tpw-card { padding: 28px 20px; }
  .vai-status-label { font-size: 18px; }
  #vipTapBtn { width: 62px; height: 62px; }
}
  `;
  document.head.appendChild(style);
}

// ─── BUILD VOICE OVERLAY DOM ─────────────────────────────────
function _buildVoiceDOM() {
  if (document.getElementById('voiceAiOverlay')) return;

  // Listening overlay
  const overlay = document.createElement('div');
  overlay.id = 'voiceAiOverlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="vai-model-badge" id="vaiModelBadge">Voice → Text</div>
    <div class="vai-orb-wrap">
      <div class="vai-orb-ring"></div>
      <div class="vai-orb-ring"></div>
      <div class="vai-orb-ring"></div>
      <div class="vai-orb" id="vaiOrb">
        <div id="vaiOrbIcon" class="vai-orb-icon">🎙️</div>
      </div>
    </div>
    <div class="vai-status-label" id="vaiStatusLabel">Listening…</div>
    <div class="vai-transcript" id="vaiTranscript"></div>
    <div class="vai-waveform" id="vaiWaveform">
      <div class="vai-wave-bar"></div>
      <div class="vai-wave-bar"></div>
      <div class="vai-wave-bar"></div>
      <div class="vai-wave-bar"></div>
      <div class="vai-wave-bar"></div>
    </div>
    <div class="vai-lang-row" id="vaiLangRow">
      <button class="vai-lang-btn active" data-lang="hi-IN">हिंदी</button>
      <button class="vai-lang-btn" data-lang="en-IN">English (IN)</button>
      <button class="vai-lang-btn" data-lang="en-US">EN-US</button>
    </div>
    <div class="vai-controls">
      <button class="vai-btn vai-btn-cancel" id="vaiCancelBtn">✕ Cancel</button>
      <button class="vai-btn vai-btn-stop" id="vaiStopSpeakBtn" style="display:none">⏹ Stop Speaking</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Teacher paywall
  const paywall = document.createElement('div');
  paywall.id = 'teacherPaywallModal';
  paywall.setAttribute('aria-modal', 'true');
  paywall.innerHTML = `
    <div class="tpw-card">
      <button class="tpw-close" id="tpwClose">✕</button>
      <div class="tpw-badge">✨ Premium Feature</div>
      <div class="tpw-icon">👩‍🏫</div>
      <div class="tpw-title">Teacher Mode Pro</div>
      <div class="tpw-sub">Crystal-clear, high-quality teacher voice — like having a personal tutor speaking to you.</div>
      <ul class="tpw-features">
        <li>Google Premium TTS — natural teacher voice</li>
        <li>Story-style explanations with emotion</li>
        <li>Adjustable voice speed & pitch</li>
        <li>Ideal for listening while travelling</li>
        <li>Powered by DeepSeek AI brain</li>
      </ul>
      <div class="tpw-price">₹1 <span>/ month</span></div>
      <button class="tpw-pay-btn" id="tpwPayBtn">💳 Unlock Teacher Mode — ₹499</button>
      <div class="tpw-secure">🔒 Secured by Cashfree · UPI · Cards · Net Banking</div>
    </div>
  `;
  document.body.appendChild(paywall);
}

// ─── BUILD VOICE INPUT PANEL (inline in chat input area) ─────
function _buildVoiceInputPanel() {
  if (document.getElementById('voiceInputPanel')) return;
  const container = document.getElementById('mainInputContainer');
  if (!container) return;

  const panel = document.createElement('div');
  panel.id = 'voiceInputPanel';
  panel.setAttribute('aria-label', 'Voice input panel');
  panel.innerHTML = `
    <button id="vipTapBtn" title="Tap to speak" aria-label="Tap to speak">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 1a3 3 0 013 3v8a3 3 0 01-6 0V4a3 3 0 013-3z"/>
        <path d="M19 10v2a7 7 0 01-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    </button>
    <div id="vipHintText">Tap mic to speak your question</div>
    <button id="vipKeyboardToggle" title="Switch to keyboard input" aria-label="Type instead">⌨️</button>
  `;

  // Insert panel as first child of container (before textarea)
  container.insertBefore(panel, container.firstChild);

  // Tap-to-speak
  document.getElementById('vipTapBtn')?.addEventListener('click', () => {
    const cnt = document.getElementById('mainInputContainer');
    if (cnt?.classList.contains('vip-keyboard-fallback')) return;
    if (voiceState.model === 'teacher' && !_isTeacherPremium()) {
      openTeacherPaywall();
      return;
    }
    startVoiceListening();
  });

  // Keyboard toggle
  document.getElementById('vipKeyboardToggle')?.addEventListener('click', () => {
    const cnt = document.getElementById('mainInputContainer');
    if (!cnt) return;
    const isKB = cnt.classList.toggle('vip-keyboard-fallback');
    const btn = document.getElementById('vipKeyboardToggle');
    if (btn) { btn.title = isKB ? 'Switch back to voice' : 'Switch to keyboard input'; btn.textContent = isKB ? '🎙️' : '⌨️'; }
    if (isKB) setTimeout(() => document.getElementById('messageInput')?.focus(), 50);
  });
}

function _updateVoicePanel(modelId) {
  const tapBtn = document.getElementById('vipTapBtn');
  const hint   = document.getElementById('vipHintText');

  const m = MODELS[modelId];
  if (!m || m.type !== 'voice') return;

  const isTeacher = modelId === 'teacher';
  if (tapBtn) tapBtn.classList.toggle('teacher-orb', isTeacher);

  if (hint) {
    const hints = {
      'voice-text': 'Tap mic · Speak · Get text answer',
      'voice':      'Tap mic · Speak · Hear answer aloud 🔊',
      'teacher':    'Tap mic · Teacher will explain aloud 👩‍🏫',
    };
    hint.textContent = hints[modelId] || 'Tap mic to speak your question';
  }

  // Reset keyboard fallback when switching voice models
  document.getElementById('mainInputContainer')?.classList.remove('vip-keyboard-fallback');
  const kbBtn = document.getElementById('vipKeyboardToggle');
  if (kbBtn) { kbBtn.textContent = '⌨️'; kbBtn.title = 'Switch to keyboard input'; }
}

// ─── SPEECH RECOGNITION ──────────────────────────────────────
function _initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = voiceState.recognitionLang;
  r.interimResults = true;
  r.continuous = false;
  voiceState.recognition = r;
  return r;
}

function startVoiceListening() {
  if (voiceState.isListening) return;
  if (voiceState.isSpeaking) stopSpeaking();

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    if (typeof showToast === 'function') showToast('⚠️ Speech recognition not supported. Use Chrome.');
    return;
  }

  voiceState.recognition = null;
  const r = _initRecognition();
  voiceState.isListening = true;

  const overlay  = document.getElementById('voiceAiOverlay');
  const orb      = document.getElementById('vaiOrb');
  const icon     = document.getElementById('vaiOrbIcon');
  const label    = document.getElementById('vaiStatusLabel');
  const trans    = document.getElementById('vaiTranscript');
  const waveform = document.getElementById('vaiWaveform');
  const stopBtn  = document.getElementById('vaiStopSpeakBtn');
  const badge    = document.getElementById('vaiModelBadge');

  const m = MODELS[voiceState.model];
  if (badge) {
    badge.textContent = m?.label || 'Voice';
    badge.className = 'vai-model-badge' + (voiceState.model === 'teacher' ? ' teacher-badge' : '');
  }
  if (overlay) { overlay.classList.add('active'); overlay.setAttribute('aria-hidden', 'false'); }
  if (orb)     { orb.classList.remove('speaking-state', 'teacher-state'); }
  if (icon)    { icon.textContent = m?.icon || '🎙️'; }
  if (label)   { label.textContent = 'Listening…'; }
  if (trans)   { trans.textContent = 'Speak your question clearly…'; }
  if (waveform){ waveform.style.display = 'flex'; }
  if (stopBtn) { stopBtn.style.display = 'none'; }

  r.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    if (trans) trans.textContent = (final || interim) ? `"${final || interim}"` : 'Listening…';
    voiceState.pendingTranscript = final || interim;
  };

  r.onend = () => {
    voiceState.isListening = false;
    const transcript = voiceState.pendingTranscript.trim();
    voiceState.pendingTranscript = '';
    if (!transcript) {
      _closeVoiceOverlay();
      if (typeof showToast === 'function') showToast('⚠️ Could not hear you. Try again.');
      return;
    }
    _handleVoiceTranscript(transcript);
  };

  r.onerror = (err) => {
    voiceState.isListening = false;
    if (err.error === 'aborted') { _closeVoiceOverlay(); return; }
    if (label) label.textContent = 'Could not hear. Try again.';
    setTimeout(_closeVoiceOverlay, 1400);
  };

  try { r.start(); } catch(e) { voiceState.isListening = false; _closeVoiceOverlay(); }
}

function stopListening() {
  if (voiceState.recognition) try { voiceState.recognition.stop(); } catch(e) {}
  voiceState.isListening = false;
}

function _closeVoiceOverlay() {
  const overlay = document.getElementById('voiceAiOverlay');
  if (overlay) { overlay.classList.remove('active'); overlay.setAttribute('aria-hidden', 'true'); }
  voiceState.isListening = false;
}

// ─── VOICE TRANSCRIPT → AI → SPEAK ──────────────────────────
async function _handleVoiceTranscript(transcript) {
  const overlay = document.getElementById('voiceAiOverlay');
  const orb     = document.getElementById('vaiOrb');
  const icon    = document.getElementById('vaiOrbIcon');
  const label   = document.getElementById('vaiStatusLabel');
  const trans   = document.getElementById('vaiTranscript');
  const wave    = document.getElementById('vaiWaveform');

  if (label) label.textContent = '🧠 AI Thinking…';
  if (trans) trans.textContent = `You said: "${transcript}"`;
  if (wave)  wave.style.display = 'none';

  const isTeacher  = voiceState.model === 'teacher';
  const isVoice    = voiceState.model === 'voice' || isTeacher;

  let aiResponse = '';
  try {
    // ── Token-saving voice prompt builder ───────────────────────
    // Teacher mode: sounds like a real Indian classroom teacher
    // Voice mode: natural spoken sentences
    // Both: NO markdown (saves output tokens), short answer (saves cost)
    let extraPrompt = '';
    if (isTeacher) {
      const teacherLang = voiceState.recognitionLang?.startsWith('hi') ? 'hi' : 'en';
      if (teacherLang === 'hi') {
        extraPrompt = '\n\n[VOICE TEACHER RULES — FOLLOW STRICTLY:\n'
          + '- Ek real Indian classroom teacher ki tarah bolein — jaise Patna ya Delhi ka government school teacher.\n'
          + '- Hinglish mein baat karein: Hindi dominant, English terms natural rakhein (formula, example, answer ke liye).\n'
          + '- Aise bolein jaise whiteboard par samjha rahe ho: "Dekho beta,", "Achha yaad rakho,", "Yeh wala point important hai,", "Samjhe?"\n'
          + '- Ek concrete example zaroor dein — real life se (train, dukaan, cricket, roti)\n'
          + '- Ek chhota sa memory trick dein agar possible ho.\n'
          + '- Sirf ek topic explain karein — distract mat karo.\n'
          + '- NO markdown, NO bullets, NO asterisks, NO headings — yeh aloud bola jayega.\n'
          + '- MAX 100 words. Kam words = better. Sirf jo zaruri hai.]\n';
      } else {
        extraPrompt = '\n\n[VOICE TEACHER RULES — FOLLOW STRICTLY:\n'
          + '- Speak like a real Indian school teacher (think: experienced CBSE/SSC teacher from India).\n'
          + '- Use natural classroom phrases: "Now listen carefully,", "Good question beta,", "Remember this point,", "Understood?"\n'
          + '- Give ONE concrete real-life example (train, market, cricket, daily life).\n'
          + '- Give a short memory trick if useful.\n'
          + '- Speak one idea clearly — do not drift to multiple topics.\n'
          + '- NO markdown, NO bullets, NO asterisks, NO headings — this will be spoken aloud.\n'
          + '- MAX 100 words. Fewer words = better quality. Say only what is needed.]\n';
      }
    } else if (isVoice) {
      extraPrompt = '\n\n[VOICE RULES: Natural spoken sentences only. No markdown, bullets, or asterisks. Max 80 words. Be conversational and clear.]';
    }

    if (typeof callDeepSeek === 'function') {
      // ── Token cache key for voice (saves repeated API calls) ──
      const cacheKey = `voice:${voiceState.recognitionLang}:${transcript.trim().toLowerCase().substring(0, 80)}`;
      if (window._voiceResponseCache && window._voiceResponseCache[cacheKey]) {
        aiResponse = window._voiceResponseCache[cacheKey];
      } else {
        const voiceMsg = transcript + extraPrompt;
        // Send ZERO chat history for voice — saves 60-80% input tokens
        aiResponse = await callDeepSeek(voiceMsg, []);
        // Cache this response (session-only, max 50 entries)
        if (!window._voiceResponseCache) window._voiceResponseCache = {};
        const cacheKeys = Object.keys(window._voiceResponseCache);
        if (cacheKeys.length >= 50) delete window._voiceResponseCache[cacheKeys[0]];
        window._voiceResponseCache[cacheKey] = aiResponse;
      }
    } else {
      throw new Error('AI function not available');
    }
  } catch (err) {
    aiResponse = 'Sorry, AI answer nahi aa paya. Please try again.';
    if (typeof showToast === 'function') showToast('❌ AI Error: ' + err.message);
  }

  // Add to chat
  if (typeof addMessage === 'function' && typeof dom !== 'undefined') {
    if (dom.welcomeScreen) dom.welcomeScreen.style.display = 'none';
    addMessage('user', transcript);
    addMessage('ai', aiResponse);
    if (typeof currentMessages !== 'undefined') {
      currentMessages.push({ role: 'user', content: transcript });
      currentMessages.push({ role: 'ai', content: aiResponse });
    }
    if (typeof incrementCount === 'function') incrementCount('text');
    if (typeof saveCurrentSession === 'function') saveCurrentSession(transcript);
  }

  // Speak if voice/teacher mode
  if (isVoice) {
    if (label) label.textContent = '🔊 Speaking…';
    if (orb) { orb.classList.remove('teacher-state'); orb.classList.add('speaking-state'); }
    if (icon) icon.textContent = '🔊';
    if (wave) wave.style.display = 'flex';
    const stopBtn = document.getElementById('vaiStopSpeakBtn');
    if (stopBtn) stopBtn.style.display = '';
    await _speakResponse(aiResponse);
  }

  _closeVoiceOverlay();
}

// ─── TTS ─────────────────────────────────────────────────────
async function _speakResponse(text) {
  const clean = _stripMarkdown(text);
  // Use Google TTS for teacher model (premium) OR voice model if key available
  const shouldUseGoogle = false; // Google TTS removed
  if (shouldUseGoogle) {
    await _speakGoogleTTS(clean);
  } else {
    await _speakBrowserTTS(clean);
  }
}

async function _speakBrowserTTS(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) { resolve(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    voiceState.currentUtterance = utter;
    voiceState.isSpeaking = true;
    const voices = window.speechSynthesis.getVoices();
    // Use preferred voice from settings if set
    let preferred = null;
    if (voiceState.preferredVoiceName) {
      preferred = voices.find(v => v.name === voiceState.preferredVoiceName);
    }
    if (!preferred) {
      const lang = voiceState.recognitionLang || 'hi-IN';
      preferred = voices.find(v => v.lang === lang)
        || voices.find(v => v.lang === 'hi-IN')
        || voices.find(v => v.lang === 'en-IN' || v.name.includes('India'))
        || voices.find(v => v.name.includes('Google'))
        || voices.find(v => v.lang.startsWith('en')) || voices[0];
    }
    if (preferred) utter.voice = preferred;
    utter.lang   = voiceState.recognitionLang || 'hi-IN';
    utter.rate   = voiceState.speechRate  || 1.0;
    utter.pitch  = voiceState.speechPitch || 1.0;
    utter.volume = voiceState.speechVolume !== undefined ? voiceState.speechVolume : 1.0;
    utter.onend  = () => { voiceState.isSpeaking = false; voiceState.currentUtterance = null; resolve(); };
    utter.onerror = () => { voiceState.isSpeaking = false; voiceState.currentUtterance = null; resolve(); };
    window.speechSynthesis.speak(utter);
  });
}

async function _speakGoogleTTS(text) {
  const key = GOOGLE_TTS_KEY || window.GOOGLE_TTS_KEY;
  if (!key || key === 'YOUR_GOOGLE_TTS_API_KEY') {
    if (voiceState.model === 'teacher') {
      if (typeof showToast === 'function') showToast('⚠️ Google TTS key not set. Add GOOGLE_TTS_KEY in voice-ai.js');
      console.error('[TeacherMode] GOOGLE_TTS_KEY is not configured in voice-ai.js');
    }
    return _speakBrowserTTS(text);
  }
  try {
    const isHindi = (voiceState.recognitionLang || 'en-IN').startsWith('hi');

    // ── Determine voice based on user's settings selection ───────
    // voiceState.teacherVoiceChoice: 'leda' | 'hindi' | 'auto' (default)
    //
    // LEDA = en-US-Journey-F (Google Journey voice)
    //   · This is the EXACT voice in assets/premium-demo.wav
    //   · Journey voices: languageCode MUST be 'en-US', NO ssmlGender
    //   · Leda handles Hinglish text well — she pronounces Hindi words naturally
    //
    // HINDI = hi-IN-Wavenet-D (pure Hindi Wavenet female)
    //   · Only used when user explicitly selects "Hindi Teacher" in settings
    //
    // AUTO default = always Leda (matches demo audio the user hears in preview)
    const choice = voiceState.teacherVoiceChoice || 'auto';
    let voiceConfig;

    if (choice === 'hindi') {
      // Only use Hindi Wavenet when user explicitly chose it
      voiceConfig = { languageCode: 'hi-IN', name: 'hi-IN-Wavenet-D', ssmlGender: 'FEMALE' };
    } else {
      // 'leda' OR 'auto' → always Leda (en-US-Journey-F)
      // This matches the demo audio — same voice the user previewed before unlocking
      voiceConfig = { languageCode: 'en-US', name: 'en-US-Journey-F' };
    }

    const body = {
      input: { text },
      voice: voiceConfig,
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: voiceState.speechRate || 1.0,
        // Journey voices ignore pitch — only set for Wavenet
        ...(!voiceConfig.name.includes('Journey') ? { pitch: ((voiceState.speechPitch || 1.0) - 1) * 10 } : {})
      }
    };
    const res = await fetch(`${GOOGLE_TTS_ENDPOINT}?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || 'Google TTS HTTP ' + res.status);
    }
    const data = await res.json();
    if (!data.audioContent) throw new Error('No audioContent in Google TTS response');
    const audio = new Audio('data:audio/mp3;base64,' + data.audioContent);
    voiceState.isSpeaking = true;
    voiceState._currentTeacherAudio = audio; // store ref so stopSpeaking can cancel it
    return new Promise((resolve) => {
      audio.onended = () => { voiceState.isSpeaking = false; voiceState._currentTeacherAudio = null; resolve(); };
      audio.onerror = (e) => {
        console.error('[TeacherMode] Audio playback error:', e);
        voiceState.isSpeaking = false; voiceState._currentTeacherAudio = null; resolve();
      };
      audio.play().catch((e) => {
        console.error('[TeacherMode] Audio play() failed:', e);
        voiceState.isSpeaking = false; voiceState._currentTeacherAudio = null; resolve();
      });
    });
  } catch(e) {
    console.error('[TeacherMode] Google TTS error:', e.message);
    if (typeof showToast === 'function') showToast('❌ Teacher TTS error: ' + e.message);
    // In teacher mode: DO NOT fall back to browser TTS — show error only
    if (voiceState.model === 'teacher') return;
    return _speakBrowserTTS(text);
  }
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  // Also stop any active Google TTS audio (teacher mode)
  if (voiceState._currentTeacherAudio) {
    try { voiceState._currentTeacherAudio.pause(); voiceState._currentTeacherAudio.currentTime = 0; } catch(e) {}
    voiceState._currentTeacherAudio = null;
  }
  voiceState.isSpeaking = false;
  voiceState.currentUtterance = null;
}

// ─── SPEAK BUTTON ON AI MESSAGES (disabled — removed from chat screen) ───
function _observeMessages() {
  // AI teacher voice auto-speak on chat messages is disabled.
  // Voice is available via Voice Mode in the model selector instead.
}

// ─── OVERLAY CONTROLS ────────────────────────────────────────
function _bindOverlayControls() {
  document.getElementById('vaiCancelBtn')?.addEventListener('click', () => {
    stopListening(); stopSpeaking(); _closeVoiceOverlay();
  });
  document.getElementById('vaiStopSpeakBtn')?.addEventListener('click', () => {
    stopSpeaking(); _closeVoiceOverlay();
  });
  document.getElementById('voiceAiOverlay')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.vai-lang-btn');
    if (!btn) return;
    const lang = btn.dataset.lang;
    if (!lang) return;
    voiceState.recognitionLang = lang;
    document.querySelectorAll('.vai-lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    if (voiceState.recognition) voiceState.recognition.lang = lang;
  });
}

// ─── TEACHER PAYWALL ─────────────────────────────────────────
function openTeacherPaywall() {
  const modal = document.getElementById('teacherPaywallModal');
  if (modal) modal.classList.add('active');
}
function closeTeacherPaywall() {
  const modal = document.getElementById('teacherPaywallModal');
  if (modal) modal.classList.remove('active');
}

function _bindPaywall() {
  document.getElementById('tpwClose')?.addEventListener('click', closeTeacherPaywall);
  document.getElementById('teacherPaywallModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('teacherPaywallModal')) closeTeacherPaywall();
  });
  document.getElementById('tpwPayBtn')?.addEventListener('click', async () => {
    if (!window._firebaseAuth?.currentUser) {
      closeTeacherPaywall();
      if (typeof showToast === 'function') showToast('Please login first to upgrade!');
      return;
    }
    const btn = document.getElementById('tpwPayBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Opening payment…';
    const uid = window._firebaseAuth.currentUser.uid;
    const orderId = `sscprepai_teacher_${uid}_${Date.now()}`;
    localStorage.setItem('sscai_pending_order', JSON.stringify({ orderId, planId: VOICE_PLAN_ID, uid, ts: Date.now() }));
    const userState = typeof state !== 'undefined' ? state : {};
    const payUrl = `https://payments.cashfree.com/forms/sscprepai?amount=${VOICE_PLAN_PRICE}&order_id=${orderId}&name=${encodeURIComponent(userState.user?.name || 'Student')}&email=${encodeURIComponent(userState.user?.email || '')}&plan=${VOICE_PLAN_ID}`;
    window.open(payUrl, '_blank');
    if (typeof showToast === 'function') showToast('💳 Payment page opened. Complete payment there.');
    btn.textContent = '⏳ Waiting for payment…';
    _pollTeacherPayment(orderId);
  });
}

function _pollTeacherPayment(orderId, attempt = 0) {
  const MAX = 24;
  if (attempt >= MAX) {
    const btn = document.getElementById('tpwPayBtn');
    if (btn) { btn.disabled = false; btn.textContent = `💳 Unlock Teacher Mode — ₹${VOICE_PLAN_PRICE}`; }
    if (typeof showToast === 'function') showToast('⏰ Payment not detected. Contact support if paid.');
    return;
  }
  setTimeout(async () => {
    try {
      if (typeof verifyCashfreePayment === 'function') {
        const result = await verifyCashfreePayment(orderId);
        if (result?.status === 'PAID') { _activateTeacherPlan(); localStorage.removeItem('sscai_pending_order'); closeTeacherPaywall(); return; }
        if (result?.status === 'FAILED') {
          const btn = document.getElementById('tpwPayBtn');
          if (btn) { btn.disabled = false; btn.textContent = `💳 Unlock Teacher Mode — ₹${VOICE_PLAN_PRICE}`; }
          if (typeof showToast === 'function') showToast('❌ Payment failed. Please try again.');
          localStorage.removeItem('sscai_pending_order');
          return;
        }
      }
    } catch(e) {}
    _pollTeacherPayment(orderId, attempt + 1);
  }, 5000);
}

function _activateTeacherPlan() {
  _saveTeacherUnlocked();
  if (typeof state !== 'undefined') {
    state.isPremium = true; state.premiumPlan = VOICE_PLAN_ID;
    if (typeof saveState === 'function') saveState();
    if (typeof updateUserUI === 'function') updateUserUI();
  }
  if (window._firebaseDb && window._firebaseFns && window._firebaseAuth?.currentUser) {
    try {
      const { doc, updateDoc } = window._firebaseFns;
      const ref = doc(window._firebaseDb, 'users', window._firebaseAuth.currentUser.uid);
      updateDoc(ref, { isPremium: true, premiumPlan: VOICE_PLAN_ID, teacherActivatedAt: Date.now() }).catch(() => {});
    } catch(e) {}
  }
  selectModel('teacher');
  if (typeof showToast === 'function') showToast('🎉 Teacher Mode unlocked! 👩‍🏫');
}

function _checkPendingTeacherPayment() {
  try {
    const pending = JSON.parse(localStorage.getItem('sscai_pending_order') || 'null');
    if (pending && pending.planId === VOICE_PLAN_ID && (Date.now() - pending.ts) < 600000) {
      _pollTeacherPayment(pending.orderId);
    }
  } catch(e) {}
}

// ─── VOICE SETTINGS IN SETTINGS MODAL ───────────────────────
function _loadVoicePrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('crackai_voice_prefs') || '{}');
    if (saved.rate) voiceState.speechRate = saved.rate;
    if (saved.pitch) voiceState.speechPitch = saved.pitch;
    if (saved.volume !== undefined) voiceState.speechVolume = saved.volume;
    if (saved.lang) voiceState.recognitionLang = saved.lang;
    if (saved.voiceName) voiceState.preferredVoiceName = saved.voiceName;
    if (saved.useGoogle !== undefined) voiceState.alwaysUseGoogle = saved.useGoogle;
    if (saved.teacherVoice) voiceState.teacherVoiceChoice = saved.teacherVoice;
  } catch(e) {}
}
function _saveVoicePrefs() {
  localStorage.setItem('crackai_voice_prefs', JSON.stringify({
    rate: voiceState.speechRate,
    pitch: voiceState.speechPitch,
    volume: voiceState.speechVolume !== undefined ? voiceState.speechVolume : 1,
    lang: voiceState.recognitionLang,
    voiceName: voiceState.preferredVoiceName || '',
    useGoogle: !!voiceState.alwaysUseGoogle,
    teacherVoice: voiceState.teacherVoiceChoice || 'auto'
  }));
}

function _addVoiceSettings() {
  const settingsModal = document.getElementById('settingsModal');
  if (!settingsModal || document.getElementById('voiceSettingsSection')) return;

  // Load saved prefs first
  _loadVoicePrefs();

  // Build available browser voices list
  const allVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const voiceOpts = allVoices
    .filter(v => v.lang.startsWith('en') || v.lang.startsWith('hi'))
    .map(v => `<option value="${v.name}" ${voiceState.preferredVoiceName === v.name ? 'selected' : ''}>${v.name} (${v.lang})</option>`)
    .join('');

  const section = document.createElement('div');
  section.id = 'voiceSettingsSection';
  section.style.cssText = 'padding:16px 20px;border-top:1px solid var(--border,rgba(255,255,255,0.08));';
  section.innerHTML = `
    <div style="font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;color:rgba(180,170,255,0.9);margin-bottom:14px;letter-spacing:0.06em;text-transform:uppercase;display:flex;align-items:center;gap:8px;">
      🔊 Voice Settings
    </div>
    <div style="display:flex;flex-direction:column;gap:14px;">

      <!-- Speed -->
      <div>
        <label style="font-size:12px;color:var(--text-muted,rgba(180,170,255,0.6));display:flex;justify-content:space-between;margin-bottom:5px;">
          Speech Speed <span id="speechRateVal" style="color:#6C63FF;font-weight:700;">${(voiceState.speechRate || 1.0).toFixed(1)}×</span>
        </label>
        <input type="range" id="speechRateSlider" min="0.5" max="2.0" step="0.1"
          value="${voiceState.speechRate || 1.0}"
          style="width:100%;accent-color:#6C63FF;cursor:pointer;" />
        <div style="display:flex;justify-content:space-between;font-size:10px;color:rgba(180,170,255,0.3);margin-top:2px;">
          <span>0.5× Slow</span><span>1.0× Normal</span><span>2.0× Fast</span>
        </div>
      </div>

      <!-- Pitch -->
      <div>
        <label style="font-size:12px;color:var(--text-muted,rgba(180,170,255,0.6));display:flex;justify-content:space-between;margin-bottom:5px;">
          Voice Pitch <span id="speechPitchVal" style="color:#FF6B9D;font-weight:700;">${(voiceState.speechPitch || 1.0).toFixed(2)}</span>
        </label>
        <input type="range" id="speechPitchSlider" min="0.5" max="1.5" step="0.05"
          value="${voiceState.speechPitch || 1.0}"
          style="width:100%;accent-color:#FF6B9D;cursor:pointer;" />
        <div style="display:flex;justify-content:space-between;font-size:10px;color:rgba(180,170,255,0.3);margin-top:2px;">
          <span>Deep</span><span>Normal</span><span>High</span>
        </div>
      </div>

      <!-- Volume -->
      <div>
        <label style="font-size:12px;color:var(--text-muted,rgba(180,170,255,0.6));display:flex;justify-content:space-between;margin-bottom:5px;">
          Volume <span id="speechVolVal" style="color:#a78bfa;font-weight:700;">${Math.round((voiceState.speechVolume !== undefined ? voiceState.speechVolume : 1) * 100)}%</span>
        </label>
        <input type="range" id="speechVolSlider" min="0" max="1" step="0.05"
          value="${voiceState.speechVolume !== undefined ? voiceState.speechVolume : 1}"
          style="width:100%;accent-color:#a78bfa;cursor:pointer;" />
      </div>

      <!-- Language -->
      <div>
        <label style="font-size:12px;color:var(--text-muted,rgba(180,170,255,0.6));margin-bottom:6px;display:block;">Speech Language</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${['hi-IN','en-IN','en-US','hi'].map(lang =>
            `<button class="voice-lang-btn" data-lang="${lang}"
              style="padding:5px 12px;border-radius:20px;border:1px solid ${voiceState.recognitionLang===lang?'#6C63FF':'rgba(108,99,255,0.25)'};
              background:${voiceState.recognitionLang===lang?'rgba(108,99,255,0.25)':'transparent'};
              color:${voiceState.recognitionLang===lang?'#a78bfa':'rgba(180,170,255,0.6)'};font-size:11px;cursor:pointer;font-weight:${voiceState.recognitionLang===lang?'700':'400'};">
              ${lang === 'hi-IN' ? '🇮🇳 Hindi' : lang === 'en-IN' ? '🇮🇳 English' : lang === 'en-US' ? '🇺🇸 English' : '🌐 Hindi'}
            </button>`
          ).join('')}
        </div>
      </div>

      ${voiceOpts ? `
      <!-- Browser Voice Selection -->
      <div>
        <label style="font-size:12px;color:var(--text-muted,rgba(180,170,255,0.6));margin-bottom:5px;display:block;">Browser TTS Voice</label>
        <select id="voiceNameSelect" style="width:100%;padding:8px;background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.25);border-radius:8px;color:rgba(200,195,255,0.9);font-size:12px;cursor:pointer;">
          <option value="">Auto (recommended)</option>
          ${voiceOpts}
        </select>
      </div>` : ''}

      <!-- Google TTS toggle -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:rgba(108,99,255,0.08);border-radius:10px;border:1px solid rgba(108,99,255,0.15);">
        <div>
          <div style="font-size:12px;color:rgba(200,195,255,0.85);font-weight:600;">Google TTS (Premium)</div>
          <div style="font-size:10px;color:rgba(180,170,255,0.45);margin-top:2px;">Crystal-clear voice for Teacher mode</div>
        </div>
        <label style="position:relative;width:40px;height:22px;cursor:pointer;">
          <input type="checkbox" id="googleTtsToggle" ${voiceState.alwaysUseGoogle ? 'checked' : ''}
            style="opacity:0;width:0;height:0;position:absolute;" />
          <span id="googleTtsTrack" style="position:absolute;inset:0;background:${voiceState.alwaysUseGoogle?'#6C63FF':'rgba(255,255,255,0.15)'};border-radius:22px;transition:background 0.3s;">
            <span style="position:absolute;top:3px;left:${voiceState.alwaysUseGoogle?'20px':'3px'};width:16px;height:16px;background:white;border-radius:50%;transition:left 0.3s;"></span>
          </span>
        </label>
      </div>

      <!-- Teacher Voice Selection (Teacher Mode Only) -->
        <div style="font-size:10px;color:rgba(200,180,220,0.5);margin-bottom:10px;">Only active in AI Teacher Mode. Leda is the same voice in the demo preview.</div>
        <div style="display:flex;flex-direction:column;gap:7px;" id="teacherVoicePicker">
          ${[
            { val: 'auto',  icon: '✨', label: 'Leda — Auto (Recommended)', sub: 'Google Journey-F · same voice as demo preview' },
            { val: 'leda',  icon: '🎙️', label: 'Leda — English only',       sub: 'Google Journey-F · clearest for English text' },
            { val: 'hindi', icon: '🇮🇳', label: 'Hindi Teacher',             sub: 'hi-IN Wavenet-D · pure Hindi voice' },
          ].map(({ val, icon, label, sub }) => {
            const active = (voiceState.teacherVoiceChoice || 'auto') === val;
            return `<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:8px 10px;border-radius:9px;border:1px solid ${active ? '#FF6B9D' : 'rgba(255,107,157,0.12)'};background:${active ? 'rgba(255,107,157,0.1)' : 'transparent'};transition:all 0.15s;" class="teacher-voice-opt" data-val="${val}">
              <input type="radio" name="teacherVoiceRadio" value="${val}" ${active ? 'checked' : ''} style="margin-top:2px;accent-color:#FF6B9D;flex-shrink:0;"/>
              <div>
                <div style="font-size:12px;font-weight:600;color:var(--text-secondary);">${icon} ${label}</div>
                <div style="font-size:10px;color:rgba(200,180,220,0.5);margin-top:1px;">${sub}</div>
              </div>
            </label>`;
          }).join('')}
        </div>
      </div>

      <!-- Test voice button -->
      <button id="testVoiceBtn" style="width:100%;padding:10px;background:linear-gradient(135deg,rgba(108,99,255,0.2),rgba(255,107,157,0.15));border:1px solid rgba(108,99,255,0.3);border-radius:10px;color:rgba(200,195,255,0.9);font-size:13px;font-weight:600;cursor:pointer;transition:opacity 0.2s;">
        🔊 Test Voice Settings
      </button>
    </div>
  `;
  const modalBody = settingsModal.querySelector('.modal-body') || settingsModal;
  modalBody.appendChild(section);

  // ── Wire controls ─────────────────────────────────────────
  document.getElementById('speechRateSlider')?.addEventListener('input', (e) => {
    voiceState.speechRate = parseFloat(e.target.value);
    const v = document.getElementById('speechRateVal');
    if (v) v.textContent = voiceState.speechRate.toFixed(1) + '×';
    // Also update the global speakMessage function
    if (window._ttsRate !== undefined) window._ttsRate = voiceState.speechRate;
    _saveVoicePrefs();
  });

  document.getElementById('speechPitchSlider')?.addEventListener('input', (e) => {
    voiceState.speechPitch = parseFloat(e.target.value);
    const v = document.getElementById('speechPitchVal');
    if (v) v.textContent = voiceState.speechPitch.toFixed(2);
    if (window._ttsPitch !== undefined) window._ttsPitch = voiceState.speechPitch;
    _saveVoicePrefs();
  });

  document.getElementById('speechVolSlider')?.addEventListener('input', (e) => {
    voiceState.speechVolume = parseFloat(e.target.value);
    const v = document.getElementById('speechVolVal');
    if (v) v.textContent = Math.round(voiceState.speechVolume * 100) + '%';
    _saveVoicePrefs();
  });

  document.querySelectorAll('.voice-lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      voiceState.recognitionLang = btn.dataset.lang;
      document.querySelectorAll('.voice-lang-btn').forEach(b => {
        b.style.borderColor = 'rgba(108,99,255,0.25)';
        b.style.background = 'transparent';
        b.style.color = 'rgba(180,170,255,0.6)';
        b.style.fontWeight = '400';
      });
      btn.style.borderColor = '#6C63FF';
      btn.style.background = 'rgba(108,99,255,0.25)';
      btn.style.color = '#a78bfa';
      btn.style.fontWeight = '700';
      // Update recognition
      if (voiceState.recognition) voiceState.recognition.lang = voiceState.recognitionLang;
      _saveVoicePrefs();
    });
  });

  document.getElementById('voiceNameSelect')?.addEventListener('change', (e) => {
    voiceState.preferredVoiceName = e.target.value;
    _saveVoicePrefs();
  });

  // ── Teacher Voice Picker (Leda / Hindi / Auto) ───────────────
  document.getElementById('teacherVoicePicker')?.addEventListener('change', (e) => {
    if (e.target.name === 'teacherVoiceRadio') {
      voiceState.teacherVoiceChoice = e.target.value;
      // Update label styles
      document.querySelectorAll('.teacher-voice-opt').forEach(el => {
        const active = el.dataset.val === e.target.value;
        el.style.borderColor = active ? '#FF6B9D' : 'rgba(255,107,157,0.12)';
        el.style.background  = active ? 'rgba(255,107,157,0.1)' : 'transparent';
      });
      _saveVoicePrefs();
      const names = { auto: 'Auto', leda: 'Leda (English)', hindi: 'Hindi Teacher' };
      if (typeof showToast === 'function') showToast(`👩‍🏫 Teacher voice: ${names[e.target.value] || e.target.value}`);
    }
  });

  const googleToggle = document.getElementById('googleTtsToggle');
  const googleTrack = document.getElementById('googleTtsTrack');
  googleToggle?.addEventListener('change', (e) => {
    voiceState.alwaysUseGoogle = e.target.checked;
    if (googleTrack) {
      googleTrack.style.background = e.target.checked ? '#6C63FF' : 'rgba(255,255,255,0.15)';
      const dot = googleTrack.querySelector('span');
      if (dot) dot.style.left = e.target.checked ? '20px' : '3px';
    }
    _saveVoicePrefs();
    showToast && showToast(e.target.checked ? '✅ Google TTS enabled' : '🔊 Using Browser TTS');
  });

  document.getElementById('testVoiceBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('testVoiceBtn');
    btn.textContent = '🔊 Speaking…';
    btn.disabled = true;

    // Build test text based on selected teacher voice and language
    const choice = voiceState.teacherVoiceChoice || 'auto';
    const isHindiLang = voiceState.recognitionLang?.startsWith('hi');
    let testText;
    if (choice === 'leda') {
      testText = 'Hello! I am your AI Teacher on CrackAI. Now listen carefully — this is how I will explain your exam topics. Good question beta, let us begin!';
    } else if (choice === 'hindi' || (choice === 'auto' && isHindiLang)) {
      testText = 'Namaste! Main aapka AI Teacher hun CrackAI par. Dekho beta, aaj hum ek important topic samjhenge. Dhyan se suno — yeh exam mein bahut kaam aayega. Samjhe?';
    } else {
      testText = 'Hello! I am your AI Teacher on CrackAI. Now listen carefully — this is how I will explain your exam topics. Good question beta, let us begin!';
    }

    // Use Google TTS (with selected voice) for teacher mode test
    if (voiceState.model === 'teacher') {
      await _speakGoogleTTS(testText);
    } else {
      await _speakBrowserTTS(testText);
    }
    btn.textContent = '🔊 Test Voice Settings';
    btn.disabled = false;
  });
}

// ─── INIT ────────────────────────────────────────────────────
function initVoiceAI() {
  _injectVoiceCSS();
  _buildVoiceDOM();
  _buildVoiceInputPanel();
  _initModelSelector();
  _bindOverlayControls();
  _bindPaywall();
  _wireVoiceInputBtn();
  _observeMessages();
  _addVoiceSettings();
  _watchAttachments();
  _updateTeacherLock();
  _checkPendingTeacherPayment();

  // Boot with smart model
  selectModel('smart');

  // Restore teacher unlock
  if (_isTeacherPremium()) voiceState.premiumVoice = true;

  // ── Hook sendMessage for Teacher Mode typed input ──────────────
  // When teacher mode is active and user types (not speaks), intercept
  // the AI response and speak it via Google TTS automatically.
  _hookSendMessageForTeacher();

  console.log('[VoiceAI v2] Initialized. Default model: smart');
}

// ─── TEACHER TYPED-INPUT AUTO-SPEAK HOOK ────────────────────
function _hookSendMessageForTeacher() {
  // Patch the global sendMessage so teacher mode auto-speaks typed answers
  const _origSendMessage = window.sendMessage;
  if (typeof _origSendMessage !== 'function') {
    // app.js not loaded yet — retry once it's ready
    setTimeout(_hookSendMessageForTeacher, 500);
    return;
  }

  window.sendMessage = async function() {
    // Not in teacher mode — just run original
    if (voiceState.model !== 'teacher') {
      return _origSendMessage.apply(this, arguments);
    }

    // Teacher mode: inject Indian-teacher voice prompt before sending
    // This modifies the input box value temporarily to shape AI response
    const inputEl = document.getElementById('messageInput');
    let injectedPrompt = false;
    if (inputEl && inputEl.value.trim()) {
      const teacherLang = voiceState.recognitionLang?.startsWith('hi') ? 'hi' : 'en';
      const suffix = teacherLang === 'hi'
        ? ' [VOICE: Ek real Indian classroom teacher ki tarah jawab do. Hinglish use karo. Whiteboard jaisi bhasha: "Dekho beta,", "Yaad rakho,". Ek real-life example do. No markdown/bullets/asterisks. Max 100 words.]'
        : ' [VOICE: Answer like a real Indian school teacher. Use classroom phrases like "Now listen carefully,", "Good question beta,". Give one real-life example. No markdown, bullets, or asterisks. Max 100 words.]';
      const orig = inputEl.value;
      // Only inject if not already injected
      if (!orig.includes('[VOICE:')) {
        inputEl.value = orig + suffix;
        injectedPrompt = true;
        // Restore after tick so sendMessage reads the injected value
        setTimeout(() => { if (injectedPrompt) inputEl.value = orig; injectedPrompt = false; }, 200);
      }
    }

    // Teacher mode: run original then speak the response via Google TTS
    await _origSendMessage.apply(this, arguments);
    injectedPrompt = false;

    // Find the new AI message bubble that was just added
    const allAiBubbles = document.querySelectorAll('.message.ai-message .message-bubble');
    if (!allAiBubbles.length) return;
    const lastBubble = allAiBubbles[allAiBubbles.length - 1];
    const rawText = lastBubble?.innerText || '';
    if (!rawText.trim()) return;

    // Strip markdown for clean speech
    const clean = _stripMarkdown(rawText);
    if (!clean) return;

    // Show speaking indicator in UI
    if (typeof showToast === 'function') showToast('👩‍🏫 Teacher is speaking…', 2000);

    // Speak via Google TTS (never browser TTS for teacher mode)
    voiceState.isSpeaking = true;
    await _speakGoogleTTS(clean);
    voiceState.isSpeaking = false;
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────
window.voiceAI = {
  selectModel,
  startListening: startVoiceListening,
  stopListening,
  stopSpeaking,
  openTeacherPaywall,
  closeTeacherPaywall,
  getState: () => ({ ...voiceState }),
  activateTeacher: _activateTeacherPlan,
};

// Expose setVoiceMode alias for any legacy callers
window.setVoiceMode = (mode) => {
  const map = { text: 'smart', 'voice-text': 'voice-text', voice: 'voice', teacher: 'teacher' };
  selectModel(map[mode] || mode);
};

// ─── BOOT ────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initVoiceAI);
} else {
  setTimeout(initVoiceAI, 0);
}
// PREMIUM DEMO VOICE
document.addEventListener('DOMContentLoaded', () => {

  const playBtn = document.getElementById('playDemoVoiceBtn');
  const audio = document.getElementById('premiumDemoAudio');

  if(playBtn && audio){

    playBtn.addEventListener('click', () => {

      audio.currentTime = 0;
      audio.play();

    });

  }

});
async function playPremiumVoice(text){
  // Delegates to the main _speakGoogleTTS which uses en-US-Journey-F (Leda)
  if (typeof _speakGoogleTTS === 'function') {
    await _speakGoogleTTS(text);
  }
}
// DEMO VOICE PLAYER
window.addEventListener('DOMContentLoaded', () => {

  const btn = document.getElementById('playDemoVoiceBtn');
  const audio = document.getElementById('premiumDemoAudio');

  if(!btn || !audio){
    console.log("Demo voice elements missing");
    return;
  }

  btn.addEventListener('click', async () => {

    try{

      audio.currentTime = 0;

      await audio.play();

      console.log("Voice playing");

    }catch(err){

      console.error(err);

      alert("Audio file not found.");

    }

  });

});