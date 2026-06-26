// ============================================================
//  CrackwithAI — TOKEN OPTIMIZER PATCH  v1.0
//  Drop this <script> tag AFTER app.js in index.html
//  Goal: Handle 5000+ questions on ~$2 DeepSeek budget
// ============================================================
//
//  HOW IT WORKS:
//  1. classifyQuestion()  → detects question type (MCQ, factual, short, math, long)
//  2. buildSmartPrompt()  → strips system prompt to bare minimum for each type
//  3. getSmartMaxTokens() → returns exact token budget per question type
//  4. Patches callDeepSeek() to use smart routing automatically
//  5. Deduplication cache → identical / near-identical questions cost $0
//
//  COST MATH (DeepSeek V3 Flash = $0.14/1M input + $0.28/1M output):
//  Old avg call: ~800 input + 400 output tokens = ~$0.000224 / question
//  New avg call: ~280 input + 120 output tokens = ~$0.000073 / question
//  → 3× cheaper → 5000 questions ≈ $0.36 instead of $1.12
//  → leaves you headroom for image/PDF (heavier calls)
// ============================================================

(function () {
  'use strict';

  // ── 1. QUESTION CLASSIFIER ──────────────────────────────────
  // Returns one of: 'mcq' | 'factual' | 'short' | 'math' | 'long' | 'voice'
  function classifyQuestion(text) {
    if (!text) return 'short';
    const t = text.trim().toLowerCase();

    // Voice mode check (set by voiceAI module)
    const voiceModel = window.voiceAI?.getState?.()?.model;
    if (voiceModel === 'teacher' || voiceModel === 'voice' || voiceModel === 'voice-text') return 'voice';

    // MCQ patterns — "which of the following", "option a/b/c/d", (a)(b)(c)(d)
    if (/which (of the following|one)|options?:?\s*[\[(]?[abcd][\])]|[\[(][abcd][\])]|answer:|correct option/i.test(t)) return 'mcq';

    // Math / calculation
    if (/[\d+\-*/^÷×=()]{5,}|simplif|calculat|find (the )?(value|sum|product|area|volume|perimeter|lcm|hcf|speed|time|distance)|solve (for|the)|integrat|differenti|equation|formula/i.test(t)) return 'math';

    // Pure factual / one-liner GK
    if (/^(what is|who is|when (was|did|is)|where is|full form of|capital of|founder of|author of|invented by|written by|headquarter|currency of|largest|smallest|tallest|longest|first|last|how many|in which year|year of|name the|define |meaning of)/i.test(t) && t.length < 120) return 'factual';

    // Long / theory / explain
    if (t.length > 220 || /explain|describe|elaborate|discuss|differentiate|compare|advantages|disadvantages|causes|effects|importance|significance|essay|paragraph/i.test(t)) return 'long';

    return 'short'; // default
  }

  // ── 2. MICRO SYSTEM PROMPTS (by question type) ─────────────
  // These replace the full 400-token system prompt for most questions.
  // They contain only what's necessary — saving 300-400 tokens per call.

  const MICRO_PROMPTS = {
    mcq: (lang, mode) =>
      `You are CrackwithAI, India's SSC exam AI by Shashank Shrivastava. Mode: ${mode||'SSC'}. Lang: ${lang||'hinglish'}.
RULE: For MCQ — give ONLY: correct option letter + 1-line reason + 1 exam tip. Max 60 words. No padding.`,

    factual: (lang, mode) =>
      `You are CrackwithAI, India's SSC exam AI by Shashank Shrivastava. Mode: ${mode||'SSC'}. Lang: ${lang||'hinglish'}.
RULE: Give a single crisp factual answer. Max 40 words. No intro, no filler.`,

    math: (lang, mode) =>
      `You are CrackwithAI, India's SSC exam AI. Mode: ${mode||'SSC'}. Lang: ${lang||'hinglish'}.
RULE: Show only the required steps. No verbose explanations. Give shortcut if possible. Max 120 words.`,

    short: (lang, mode) =>
      `You are CrackwithAI, India's SSC exam AI. Mode: ${mode||'SSC'}. Lang: ${lang||'hinglish'}.
RULE: Answer concisely. Give knowledge only — no padding, no "great question", no repeating the question. Max 90 words.`,

    long: (lang, mode) =>
      `You are CrackwithAI, India's SSC exam AI. Mode: ${mode||'SSC'}. Lang: ${lang||'hinglish'}.
RULE: Give a structured answer. Key points only — no filler sentences. Bold key terms. Max 220 words.`,

    voice: (lang, mode) =>
      `You are CrackwithAI voice tutor. Lang: ${lang||'hinglish'}.
RULE: Speak in 2-3 short sentences only. No bullet points. Conversational. Max 50 words.`,
  };

  // ── 3. SMART MAX-TOKENS TABLE ───────────────────────────────
  const SMART_MAX_TOKENS = {
    mcq:     90,   // correct option + reason = never needs more
    factual: 60,   // one fact
    math:    200,  // step by step needs a bit more
    short:   140,  // concise answer
    long:    320,  // theory / explain
    voice:   80,   // spoken sentence
  };

  // ── 4. DEDUP CACHE (in-session + localStorage) ─────────────
  // Key = md5-like hash of (lang + mode + question first 80 chars)
  // Prevents paying for the same question twice — even across sessions.
  const CACHE_LS_KEY = 'crackai_topt_cache_v1';
  let _dedupCache = {};

  try {
    const raw = localStorage.getItem(CACHE_LS_KEY);
    if (raw) _dedupCache = JSON.parse(raw);
    // Expire entries older than 7 days
    const cutoff = Date.now() - 7 * 86400_000;
    let cleaned = false;
    Object.keys(_dedupCache).forEach(k => {
      if (_dedupCache[k].ts < cutoff) { delete _dedupCache[k]; cleaned = true; }
    });
    if (cleaned) localStorage.setItem(CACHE_LS_KEY, JSON.stringify(_dedupCache));
  } catch(e) { _dedupCache = {}; }

  function _cacheKey(lang, mode, question) {
    // Simple but fast string hash
    const s = `${lang}|${mode}|${question.trim().toLowerCase().substring(0, 80)}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return 'q' + Math.abs(h).toString(36);
  }

  function _getCached(lang, mode, question) {
    const k = _cacheKey(lang, mode, question);
    const entry = _dedupCache[k];
    if (!entry) return null;
    if (Date.now() - entry.ts > 7 * 86400_000) { delete _dedupCache[k]; return null; }
    return entry.answer;
  }

  function _setCache(lang, mode, question, answer) {
    const k = _cacheKey(lang, mode, question);
    _dedupCache[k] = { answer, ts: Date.now() };
    try {
      // Keep cache under 200 entries (oldest first)
      const keys = Object.keys(_dedupCache);
      if (keys.length > 200) {
        keys.sort((a, b) => _dedupCache[a].ts - _dedupCache[b].ts)
            .slice(0, keys.length - 200)
            .forEach(k => delete _dedupCache[k]);
      }
      localStorage.setItem(CACHE_LS_KEY, JSON.stringify(_dedupCache));
    } catch(e) {}
  }

  // ── 5. TOKEN USAGE TRACKER (shows live cost in console) ─────
  window._crackaiTokenStats = window._crackaiTokenStats || { calls: 0, inputTokens: 0, outputTokens: 0, cacheHits: 0 };

  function _estimateTokens(text) {
    // ~0.75 tokens per English word / ~0.6 per Hindi word — rough estimate
    return Math.ceil((text || '').length / 3.5);
  }

  function _logTokenSave(type, saved) {
    if (typeof console !== 'undefined') {
      const stats = window._crackaiTokenStats;
      console.debug(`[CrackwithAI Optimizer] type=${type} | saved≈${saved}tok | total_calls=${stats.calls} | cache_hits=${stats.cacheHits}`);
    }
  }

  // ── 6. CORE PATCH: Override callDeepSeek ───────────────────
  // We wait until app.js defines it, then wrap it.
  // The wrapper:
  //   a) checks dedup cache first
  //   b) builds micro system prompt
  //   c) sets tight max_tokens
  //   d) falls back to original for vision-pro / pro thinking models

  function _patchCallDeepSeek() {
    const _original = window.callDeepSeek;
    if (typeof _original !== 'function') {
      // app.js not ready yet — retry in 50ms
      setTimeout(_patchCallDeepSeek, 50);
      return;
    }

    window.callDeepSeek = async function smartCallDeepSeek(userMessage, chatHistory = []) {
      const lang = (typeof state !== 'undefined' && state.aiLang) || 'hinglish';
      const mode = (typeof state !== 'undefined' && state.sscMode) || 'cgl';
      const model = (typeof getDeepSeekModel === 'function') ? getDeepSeekModel() : 'deepseek-chat';

      // ── Pro / Reasoner: don't micro-prompt — they need full context ──
      if (model === 'deepseek-reasoner' || model === 'deepseek-v4-pro') {
        return _original(userMessage, chatHistory);
      }

      // ── Persona mode: don't micro-prompt — persona needs full style guide ──
      if (typeof state !== 'undefined' && state.aiPersona && ['boyfriend','girlfriend','friend'].includes(state.aiPersona)) {
        return _original(userMessage, chatHistory);
      }

      // ── Dedup cache ──────────────────────────────────────────
      const cached = _getCached(lang, mode, userMessage);
      if (cached) {
        window._crackaiTokenStats.cacheHits++;
        _logTokenSave('cache', _estimateTokens(userMessage) + 300);
        return cached;
      }

      // ── Classify question ────────────────────────────────────
      const qType = classifyQuestion(userMessage);
      const microPrompt = MICRO_PROMPTS[qType](lang, mode);
      const smartMaxTokens = SMART_MAX_TOKENS[qType];

      // ── Build minimal message array ──────────────────────────
      const messages = [
        { role: 'system', content: microPrompt },
        { role: 'user',   content: userMessage }
        // NO chat history — saves 200-600 input tokens per call
      ];

      // ── Directly call the DeepSeek endpoint ─────────────────
      const DEEPSEEK_API_URL = window.DEEPSEEK_API_URL || 'https://deepseek-56khnynjia-uc.a.run.app';
      const firebaseUser = window._firebaseAuth?.currentUser;
      if (!firebaseUser) throw new Error('Please login first');

      const _smartToken = await firebaseUser.getIdToken().catch(() => null);
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(_smartToken ? { 'Authorization': 'Bearer ' + _smartToken } : {})
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens:  smartMaxTokens,
          temperature: qType === 'mcq' || qType === 'factual' ? 0.2 : 0.5,
          mode,
          lang,
          shortMode: true
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(`DeepSeek Error ${response.status}: ${errData?.error || 'Server error'}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      const result = text || 'Sorry, kuch ho gaya. Please try again.';

      // ── Track savings ────────────────────────────────────────
      const stats = window._crackaiTokenStats;
      stats.calls++;
      const usedInput  = _estimateTokens(microPrompt) + _estimateTokens(userMessage);
      const usedOutput = _estimateTokens(result);
      stats.inputTokens  += usedInput;
      stats.outputTokens += usedOutput;
      const oldInput = 400 + _estimateTokens(userMessage); // old full system prompt
      _logTokenSave(qType, (oldInput - usedInput) + (500 - usedOutput));

      // ── Cache result ─────────────────────────────────────────
      _setCache(lang, mode, userMessage, result);

      return result;
    };

    console.info('[CrackwithAI Optimizer] ✅ Token optimizer active. callDeepSeek patched.');
  }

  // ── 7. SYSTEM PROMPT TRIMMER ────────────────────────────────
  // Also patch getSystemPrompt() to remove all the large persona
  // instructions for non-persona, non-class modes (SSC quick Qs).
  // This saves 200+ tokens on every call that bypasses the main patch
  // (e.g. PDF analysis second-pass).

  function _patchGetSystemPrompt() {
    const _originalGSP = window.getSystemPrompt;
    if (typeof _originalGSP !== 'function') {
      setTimeout(_patchGetSystemPrompt, 50);
      return;
    }

    window.getSystemPrompt = function smartGetSystemPrompt() {
      if (typeof state === 'undefined') return _originalGSP();

      // Class modes or companion personas: use full original prompt
      const isClass = (state.sscMode || '').startsWith('class');
      const isCompanion = ['boyfriend', 'girlfriend', 'friend'].includes(state.aiPersona);
      const isProModel = ['deepseek-reasoner', 'deepseek-v4-pro'].includes(
        typeof getDeepSeekModel === 'function' ? getDeepSeekModel() : ''
      );

      if (isClass || isCompanion || isProModel) return _originalGSP();

      // For SSC modes with simple flash model: return trimmed prompt
      const langMap = {
        hinglish: 'Respond in Hinglish (mix Hindi+English).',
        hindi:    'Respond in Hindi.',
        english:  'Respond in English.',
      };
      const lang = langMap[state.aiLang] || langMap['hinglish'];
      const mode = state.sscMode || 'cgl';

      // AI identity (mandatory) + stripped teaching rules
      return `You are CrackwithAI, India's SSC exam AI built by CrackwithAI India, founded by Shashank Shrivastava. Never say you are DeepSeek or any other AI.
${lang}
Mode: ${mode} (SSC exam prep — Quant, Reasoning, English, GK).
Rules: Be concise. Give knowledge only. No filler words. For MCQ: option+reason only. For math: steps+shortcut. End with one exam tip if helpful.`;
    };

    console.info('[CrackwithAI Optimizer] ✅ getSystemPrompt patched (trimmed for SSC flash mode).');
  }

  // ── 8. MAX TOKENS PATCH ──────────────────────────────────────
  // Patch getOptimalMaxTokens for non-vision calls

  function _patchGetOptimalMaxTokens() {
    const _orig = window.getOptimalMaxTokens;
    if (typeof _orig !== 'function') {
      setTimeout(_patchGetOptimalMaxTokens, 50);
      return;
    }
    window.getOptimalMaxTokens = function smartMaxTokens(hasVision) {
      if (hasVision) return _orig(true); // vision/PDF needs more room
      if (typeof state === 'undefined') return _orig(false);

      // shortResponseMode override
      if (state.shortResponseMode) return 90;

      // Pro model: give full budget
      const model = typeof getDeepSeekModel === 'function' ? getDeepSeekModel() : '';
      if (model === 'deepseek-reasoner' || model === 'deepseek-v4-pro') return _orig(false);

      // Class 1-5: small
      const grade = typeof _getGradeLevel === 'function' ? _getGradeLevel(state.sscMode) : null;
      if (grade && grade <= 5) return 180;
      if (grade && grade <= 8) return 260;
      if (grade) return 380;

      // SSC flash: tight budget
      return 280;
    };
    console.info('[CrackwithAI Optimizer] ✅ getOptimalMaxTokens patched.');
  }

  // ── 9. COST MONITOR (accessible from console) ───────────────
  // Open browser console and type: crackaiCost()
  window.crackaiCost = function () {
    const s = window._crackaiTokenStats;
    const inputCost  = (s.inputTokens  / 1_000_000) * 0.14;
    const outputCost = (s.outputTokens / 1_000_000) * 0.28;
    const total = inputCost + outputCost;
    console.table({
      'Total API calls':      s.calls,
      'Cache hits (free)':    s.cacheHits,
      'Input tokens used':    s.inputTokens,
      'Output tokens used':   s.outputTokens,
      'Input cost ($)':       inputCost.toFixed(6),
      'Output cost ($)':      outputCost.toFixed(6),
      'Total cost ($)':       total.toFixed(6),
      'Avg cost per call ($)': s.calls ? (total / s.calls).toFixed(7) : '0',
      'Projected 5000Q ($)':  s.calls ? ((total / s.calls) * 5000).toFixed(4) : 'n/a',
    });
    return `Total so far: $${total.toFixed(5)} across ${s.calls} calls (${s.cacheHits} free cache hits)`;
  };

  // ── 10. INIT — run all patches after DOM ready ──────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      _patchCallDeepSeek();
      _patchGetSystemPrompt();
      _patchGetOptimalMaxTokens();
    });
  } else {
    _patchCallDeepSeek();
    _patchGetSystemPrompt();
    _patchGetOptimalMaxTokens();
  }

})();