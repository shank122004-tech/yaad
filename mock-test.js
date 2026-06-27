/**
 * MOCK TEST MODULE v3.0 - ENHANCED
 * ─────────────────────────────────────────────────────────────
 * Features: XP System, Premium UI, Mobile Responsive, Dark Mode
 * Auto-advance questions, Professional Results Display
 * Storage Path: gs://rankgpt-f8a64.firebasestorage.app/mock/{exam_type}/
 */

'use strict';

const MockTestModule = (function() {
  // ═══════════════════════════════════════════════════════════════
  // CONFIG & CONSTANTS
  // ═══════════════════════════════════════════════════════════════

  const FIREBASE_BUCKET = 'rankgpt-f8a64.firebasestorage.app';
  const MOCK_STORAGE_PATH = 'mock';
  const QUESTIONS_PER_TEST = 10;
  const FREE_DAILY_TESTS = 3;

  // XP Configuration
  const XP_CONFIG = {
    correctAnswer: 10,        // XP for correct answer
    wrongAnswer: -3,          // XP deducted for wrong answer
    unattempted: 0,           // No XP for unattempted
    streak: 5,                // Bonus points per correct streak
    speedBonus: 15            // Bonus if answered in < 30 seconds
  };

  // Exam type to display name mapping
  const EXAM_TYPES = {
    cat: { name: 'CAT', category: 'Competitive' },
    cds: { name: 'CDS', category: 'Competitive' },
    cgl: { name: 'SSC CGL', category: 'Competitive' },
    chsl: { name: 'SSC CHSL', category: 'Competitive' },
    class1: { name: 'Class 1', category: 'School' },
    class10: { name: 'Class 10', category: 'School' },
    class11_arts: { name: 'Class 11 (Arts)', category: 'School' },
    class11_com: { name: 'Class 11 (Commerce)', category: 'School' },
    class11_sci: { name: 'Class 11 (Science)', category: 'School' },
    class12_arts: { name: 'Class 12 (Arts)', category: 'School' },
    class12_com: { name: 'Class 12 (Commerce)', category: 'School' },
    class12_sci: { name: 'Class 12 (Science)', category: 'School' },
    class2: { name: 'Class 2', category: 'School' },
    class3: { name: 'Class 3', category: 'School' },
    class4: { name: 'Class 4', category: 'School' },
    class5: { name: 'Class 5', category: 'School' },
    class6: { name: 'Class 6', category: 'School' },
    class7: { name: 'Class 7', category: 'School' },
    class8: { name: 'Class 8', category: 'School' },
    class9: { name: 'Class 9', category: 'School' },
    cpo: { name: 'SSC CPO/SI', category: 'Competitive' },
    cuet: { name: 'CUET', category: 'Competitive' },
    gate: { name: 'GATE', category: 'Competitive' },
    gd: { name: 'SSC GD', category: 'Competitive' },
    ibps_po: { name: 'IBPS PO', category: 'Competitive' },
    jee: { name: 'JEE', category: 'Competitive' },
    mts: { name: 'SSC MTS', category: 'Competitive' },
    nda: { name: 'NDA', category: 'Competitive' },
    neet: { name: 'NEET', category: 'Competitive' },
    rrb_ntpc: { name: 'RRB NTPC', category: 'Competitive' },
    upsc: { name: 'UPSC CSE', category: 'Competitive' }
  };

  // State management
  const state = {
    currentExam: null,
    currentTest: null,
    questions: [],
    userAnswers: [],
    startTime: null,
    endTime: null,
    results: null,
    isLoading: false,
    error: null,
    currentQuestionIndex: 0,
    questionStartTimes: [],
    xpEarned: 0
  };

  // Cache for loaded questions
  const questionCache = {};

  // ═══════════════════════════════════════════════════════════════
  // XP SYSTEM
  // ═══════════════════════════════════════════════════════════════

  const getUserXP = (uid) => {
    try {
      // Validate UID
      if (!uid || uid === 'undefined' || uid === 'null') {
        console.warn('[MockTest] Invalid UID for XP retrieval:', uid);
        return { total: 0, level: 1, tests: [], lastUpdated: Date.now() };
      }

      const hashedUID = btoa(String(uid)).substring(0, 16);
      const xpKey = `user_xp_${hashedUID}`;
      const stored = localStorage.getItem(xpKey);
      return stored ? JSON.parse(stored) : { total: 0, level: 1, tests: [], lastUpdated: Date.now() };
    } catch (error) {
      console.error('[MockTest] XP retrieval error:', error);
      return { total: 0, level: 1, tests: [], lastUpdated: Date.now() };
    }
  };

  const saveUserXP = (uid, xpData) => {
    try {
      // Validate UID
      if (!uid || uid === 'undefined' || uid === 'null') {
        console.error('[MockTest] Cannot save XP - invalid UID:', uid);
        return false;
      }

      const hashedUID = btoa(String(uid)).substring(0, 16);
      const xpKey = `user_xp_${hashedUID}`;
      xpData.lastUpdated = Date.now();
      xpData.uid = uid; // Store UID for verification
      localStorage.setItem(xpKey, JSON.stringify(xpData));
      console.log('[MockTest] XP saved for user:', uid);
      return true;
    } catch (error) {
      console.error('[MockTest] XP save error:', error);
      return false;
    }
  };

  const calculateXP = (testResults) => {
    let totalXP = 0;
    let streak = 0;

    testResults.detailedResults.forEach((result, index) => {
      if (result.isCorrect) {
        totalXP += XP_CONFIG.correctAnswer;
        streak++;
        
        // Speed bonus - if answered in less than 30 seconds
        const timeTaken = (state.questionStartTimes[index + 1] || Date.now()) - state.questionStartTimes[index];
        if (timeTaken < 30000) {
          totalXP += XP_CONFIG.speedBonus;
        }

        // Streak bonus every 5 correct answers
        if (streak % XP_CONFIG.streak === 0) {
          totalXP += XP_CONFIG.streak * 2;
        }
      } else if (result.userAnswer !== -1) {
        totalXP += XP_CONFIG.wrongAnswer;
        streak = 0;
      }
    });

    return Math.max(0, totalXP);
  };

  const calculateLevel = (totalXP) => {
    // Level progression: each level needs 100 XP more than previous
    let level = 1;
    let xpRequired = 100;
    let accumulatedXP = 0;

    while (accumulatedXP + xpRequired <= totalXP) {
      accumulatedXP += xpRequired;
      level++;
      xpRequired += 50;
    }

    return {
      level,
      currentXP: totalXP,
      xpForCurrentLevel: totalXP - accumulatedXP,
      xpNeededForNextLevel: xpRequired - (totalXP - accumulatedXP)
    };
  };

  // ═══════════════════════════════════════════════════════════════
  // DAILY USAGE TRACKING - PER USER
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get unique storage key for daily limits - MUST include user authentication ID
   * Prevents cross-user data sharing
   */
  const getDailyTestKey = (uid) => {
    if (!uid || uid === 'undefined' || uid === null) {
      console.error('[MockTest] Invalid UID for daily limit tracking:', uid);
      return null;
    }
    const today = new Date().toISOString().slice(0, 10);
    // Use hash of UID for extra security + today's date
    const hashedUID = btoa(String(uid)).substring(0, 16);
    return `mock_test_daily_${hashedUID}_${today}`;
  };

  const getTodayDate = () => {
    return new Date().toISOString().slice(0, 10);
  };

  /**
   * Check daily limit for specific user
   * Each user has independent counter
   */
  const checkDailyLimit = (uid, isPremium) => {
    try {
      // Validate UID
      if (!uid || uid === 'undefined' || uid === null) {
        console.warn('[MockTest] No valid UID provided for daily limit check');
        return { allowed: true, remaining: FREE_DAILY_TESTS, total: FREE_DAILY_TESTS };
      }

      const key = getDailyTestKey(uid);
      if (!key) {
        return { allowed: true, remaining: FREE_DAILY_TESTS, total: FREE_DAILY_TESTS };
      }

      const stored = localStorage.getItem(key);
      let testData = stored ? JSON.parse(stored) : { count: 0, date: getTodayDate(), uid: uid };

      // Reset if date changed OR if UID changed (user switch detection)
      if (testData.date !== getTodayDate() || testData.uid !== uid) {
        testData = { count: 0, date: getTodayDate(), uid: uid };
        localStorage.setItem(key, JSON.stringify(testData));
      }

      // Premium users have unlimited tests
      if (isPremium) {
        return { allowed: true, remaining: -1, total: FREE_DAILY_TESTS };
      }

      // Free users limited to 3 per day
      const remaining = Math.max(0, FREE_DAILY_TESTS - testData.count);
      return {
        allowed: remaining > 0,
        remaining: remaining,
        total: FREE_DAILY_TESTS,
        used: testData.count
      };
    } catch (error) {
      console.error('[MockTest] Daily limit check error:', error);
      return { allowed: true, remaining: FREE_DAILY_TESTS, total: FREE_DAILY_TESTS };
    }
  };

  /**
   * Increment daily test counter for specific user
   * IMPORTANT: Only increments for the current authenticated user
   */
  const incrementDailyTest = (uid) => {
    try {
      // Validate UID
      if (!uid || uid === 'undefined' || uid === null) {
        console.error('[MockTest] Cannot increment daily test - invalid UID:', uid);
        return null;
      }

      const key = getDailyTestKey(uid);
      if (!key) {
        console.error('[MockTest] Failed to generate daily test key');
        return null;
      }

      const stored = localStorage.getItem(key);
      let testData = stored ? JSON.parse(stored) : { count: 0, date: getTodayDate(), uid: uid };

      // Reset if date changed OR if UID changed
      if (testData.date !== getTodayDate() || testData.uid !== uid) {
        testData = { count: 0, date: getTodayDate(), uid: uid };
      }

      testData.count += 1;
      testData.uid = uid; // Always store UID to prevent cross-user issues
      localStorage.setItem(key, JSON.stringify(testData));
      
      console.log('[MockTest] Daily test incremented for user:', uid, 'Count:', testData.count);
      return testData;
    } catch (error) {
      console.error('[MockTest] Increment daily test error:', error);
      return null;
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // FIREBASE INTEGRATION FUNCTIONS
  // ═══════════════════════════════════════════════════════════════

  const getFirebaseServices = () => {
    if (!window._firebaseStorage || !window._storageRef) {
      console.error('[MockTest] Firebase Storage not initialized');
      return null;
    }
    return {
      storage: window._firebaseStorage,
      storageRef: window._storageRef,
      getDownloadURL: window._getDownloadURL,
      listAll: window._listAll
    };
  };

  const _convertAnswerToIndex = (answer) => {
    if (typeof answer === 'string') {
      const upper = answer.toUpperCase().trim();
      if (upper === 'A') return 0;
      if (upper === 'B') return 1;
      if (upper === 'C') return 2;
      if (upper === 'D') return 3;
    }
    return -1;
  };

  const _normalizeQuestion = (q) => {
    if (!q) return null;

    if (!Array.isArray(q.options)) {
      if (q.options && typeof q.options === 'object') {
        q.options = Object.values(q.options);
      } else {
        return null;
      }
    }

    if (typeof q.answerIndex === 'number' && q.answerIndex >= 0 && q.answerIndex <= 3) {
      return q;
    }

    if (typeof q.answerIndex === 'string') {
      const parsed = parseInt(q.answerIndex, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 3) {
        q.answerIndex = parsed;
        return q;
      }
    }

    if (q.answer !== undefined && q.answer !== null) {
      const letterIndex = _convertAnswerToIndex(q.answer);
      if (letterIndex >= 0 && letterIndex <= 3) {
        q.answerIndex = letterIndex;
        return q;
      }

      if (typeof q.answer === 'string') {
        const parsed = parseInt(q.answer, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 3) {
          q.answerIndex = parsed;
          return q;
        }
      }

      if (typeof q.answer === 'number' && q.answer >= 0 && q.answer <= 3) {
        q.answerIndex = q.answer;
        return q;
      }

      if (q.options && Array.isArray(q.options) && q.options.length > 0) {
        const answerText = String(q.answer).trim();
        const exactMatchIndex = q.options.findIndex(opt => String(opt).trim() === answerText);
        if (exactMatchIndex !== -1) {
          q.answerIndex = exactMatchIndex;
          return q;
        }

        const lowerAnswer = answerText.toLowerCase();
        const caseInsensitiveMatchIndex = q.options.findIndex(opt => String(opt).trim().toLowerCase() === lowerAnswer);
        if (caseInsensitiveMatchIndex !== -1) {
          q.answerIndex = caseInsensitiveMatchIndex;
          return q;
        }
      }
    }

    return null;
  };

  const loadQuestionsFromFirebase = async (examType) => {
    try {
      state.isLoading = true;
      state.error = null;

      const fb = getFirebaseServices();
      if (!fb) {
        throw new Error('Firebase Storage not available');
      }

      const path = `${MOCK_STORAGE_PATH}/${examType}/questions.json`;
      const fileRef = fb.storageRef(fb.storage, path);
      
      const url = await fb.getDownloadURL(fileRef);
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to load questions: ${response.statusText}`);
      }

      const data = await response.json();
      let questions = Array.isArray(data) ? data : data.questions || [];

      questions = questions
        .map(q => _normalizeQuestion(q))
        .filter(q => q !== null);

      if (questions.length === 0) {
        throw new Error('No valid questions found');
      }

      state.isLoading = false;
      return questions;
    } catch (error) {
      state.isLoading = false;
      state.error = error.message || 'Failed to load questions from Firebase Storage';
      console.error('[MockTest] Firebase Error:', error);
      return [];
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // MOCK TEST LOGIC
  // ═══════════════════════════════════════════════════════════════

  const startMockTest = async (examType, testConfig = {}) => {
    const {
      questionCount = QUESTIONS_PER_TEST,
      timeLimit = null,
      shuffle = true
    } = testConfig;

    try {
      const allQuestions = await loadQuestionsFromFirebase(examType);

      if (allQuestions.length === 0) {
        throw new Error('No questions available for this exam');
      }

      let selectedQuestions = allQuestions;
      if (shuffle) {
        selectedQuestions = _shuffleArray(selectedQuestions);
      }
      selectedQuestions = selectedQuestions.slice(0, Math.min(questionCount, QUESTIONS_PER_TEST));

      state.currentExam = examType;
      state.questions = selectedQuestions;
      state.userAnswers = new Array(selectedQuestions.length).fill(-1);
      state.questionStartTimes = new Array(selectedQuestions.length + 1).fill(Date.now());
      state.startTime = Date.now();
      state.endTime = timeLimit ? Date.now() + (timeLimit * 1000) : null;
      state.results = null;
      state.currentQuestionIndex = 0;
      state.xpEarned = 0;

      return {
        success: true,
        examName: EXAM_TYPES[examType]?.name || examType,
        questionCount: selectedQuestions.length,
        timeLimit: timeLimit,
        questions: selectedQuestions
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  };

  const submitAnswer = (questionIndex, answerIndex) => {
    if (questionIndex < 0 || questionIndex >= state.questions.length) {
      return { success: false, error: 'Invalid question index' };
    }

    state.userAnswers[questionIndex] = answerIndex;
    if (questionIndex < state.questionStartTimes.length - 1) {
      state.questionStartTimes[questionIndex + 1] = Date.now();
    }
    return { success: true };
  };

  const getCurrentQuestion = () => {
    if (state.currentQuestionIndex >= 0 && state.currentQuestionIndex < state.questions.length) {
      return {
        ...state.questions[state.currentQuestionIndex],
        index: state.currentQuestionIndex,
        total: state.questions.length
      };
    }
    return null;
  };

  const nextQuestion = () => {
    if (state.currentQuestionIndex < state.questions.length - 1) {
      state.currentQuestionIndex++;
      return true;
    }
    return false;
  };

  const previousQuestion = () => {
    if (state.currentQuestionIndex > 0) {
      state.currentQuestionIndex--;
      return true;
    }
    return false;
  };

  const finishMockTest = () => {
    if (!state.questions || state.questions.length === 0) {
      return { success: false, error: 'No test in progress' };
    }

    let correctAnswers = 0;
    let wrongAnswers = 0;
    let unattempted = 0;
    const detailedResults = [];

    state.questions.forEach((question, index) => {
      const userAnswer = state.userAnswers[index];
      const isCorrect = userAnswer === question.answerIndex;

      if (userAnswer === -1) {
        unattempted++;
      } else if (isCorrect) {
        correctAnswers++;
      } else {
        wrongAnswers++;
      }

      detailedResults.push({
        questionIndex: index,
        question: question.question,
        userAnswer: userAnswer,
        correctAnswer: question.answerIndex,
        isCorrect: isCorrect,
        explanation: question.explanation || 'No explanation available',
        options: question.options
      });
    });

    const timeTaken = state.startTime ? Math.round((Date.now() - state.startTime) / 1000) : 0;
    const totalQuestions = state.questions.length;
    const accuracy = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
    const score = correctAnswers;
    const xpEarned = calculateXP({ detailedResults });

    state.results = {
      examType: state.currentExam,
      examName: EXAM_TYPES[state.currentExam]?.name || state.currentExam,
      totalQuestions,
      correctAnswers,
      wrongAnswers,
      unattempted,
      score,
      accuracy,
      timeTaken,
      detailedResults,
      xpEarned
    };

    state.xpEarned = xpEarned;

    return {
      success: true,
      results: state.results
    };
  };

  const getState = () => {
    return { ...state };
  };

  const reset = () => {
    state.currentExam = null;
    state.currentTest = null;
    state.questions = [];
    state.userAnswers = [];
    state.startTime = null;
    state.endTime = null;
    state.results = null;
    state.isLoading = false;
    state.error = null;
    state.currentQuestionIndex = 0;
    state.questionStartTimes = [];
    state.xpEarned = 0;
  };

  // ═════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═════════════════════════════════════════════════════════════════

  const _shuffleArray = (array) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // ═════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═════════════════════════════════════════════════════════════════

  return {
    EXAM_TYPES,
    FIREBASE_BUCKET,
    MOCK_STORAGE_PATH,
    QUESTIONS_PER_TEST,
    FREE_DAILY_TESTS,
    XP_CONFIG,

    startMockTest,
    submitAnswer,
    finishMockTest,
    loadQuestionsFromFirebase,

    getCurrentQuestion,
    nextQuestion,
    previousQuestion,

    checkDailyLimit,
    incrementDailyTest,
    getDailyTestKey,

    getUserXP,
    saveUserXP,
    calculateXP,
    calculateLevel,

    getState,
    reset,
    getExamName: (examType) => EXAM_TYPES[examType]?.name || examType,
    getAllExams: () => Object.keys(EXAM_TYPES),
    getExamsByCategory: (category) =>
      Object.keys(EXAM_TYPES).filter(key => EXAM_TYPES[key].category === category),

    clearCache: (examType) => {
      if (examType) {
        delete questionCache[examType];
      } else {
        Object.keys(questionCache).forEach(key => delete questionCache[key]);
      }
    }
  };
})();

window.MockTestModule = MockTestModule;

console.info('[MockTest] Enhanced Module v3.0 loaded');
console.info('[MockTest] XP System enabled');