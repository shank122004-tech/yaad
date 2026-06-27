/**
 * MOCK TEST MODULE v2.0
 * ─────────────────────────────────────────────────────────────
 * Fixed: Firebase Storage loading, 10 questions per test, daily limits
 * Features: Full-screen interface, premium support, daily 3 free tests
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
    currentQuestionIndex: 0
  };

  // Cache for loaded questions
  const questionCache = {};

  // ═══════════════════════════════════════════════════════════════
  // DAILY USAGE TRACKING
  // ═══════════════════════════════════════════════════════════════

  const getDailyTestKey = (uid) => {
    const today = new Date().toISOString().slice(0, 10);
    return `mock_tests_${uid}_${today}`;
  };

  const getTodayDate = () => {
    return new Date().toISOString().slice(0, 10);
  };

  /**
   * Check and update daily free test usage
   */
  const checkDailyLimit = (uid, isPremium) => {
    try {
      const key = getDailyTestKey(uid);
      const stored = localStorage.getItem(key);
      let testData = stored ? JSON.parse(stored) : { count: 0, date: getTodayDate() };

      // Reset if date changed
      if (testData.date !== getTodayDate()) {
        testData = { count: 0, date: getTodayDate() };
      }

      // Premium users have no limit
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
   * Increment daily test counter
   */
  const incrementDailyTest = (uid) => {
    try {
      const key = getDailyTestKey(uid);
      const stored = localStorage.getItem(key);
      let testData = stored ? JSON.parse(stored) : { count: 0, date: getTodayDate() };

      if (testData.date !== getTodayDate()) {
        testData = { count: 0, date: getTodayDate() };
      }

      testData.count += 1;
      localStorage.setItem(key, JSON.stringify(testData));
      return testData;
    } catch (error) {
      console.error('[MockTest] Increment daily test error:', error);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // FIREBASE INTEGRATION FUNCTIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get Firebase Storage instance and refs
   */
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

  /**
   * Convert letter answer to index
   * A → 0, B → 1, C → 2, D → 3
   */
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

  /**
   * Normalize a single question object
   */
  const _normalizeQuestion = (q) => {
    if (!q) return null;

    // Ensure options is an array
    if (!Array.isArray(q.options)) {
      if (q.options && typeof q.options === 'object') {
        q.options = Object.values(q.options);
      } else {
        return null;
      }
    }

    // If answerIndex already exists and is valid, keep it
    if (typeof q.answerIndex === 'number' && q.answerIndex >= 0 && q.answerIndex <= 3) {
      return q;
    }

    // If answerIndex is a string number, parse it
    if (typeof q.answerIndex === 'string') {
      const parsed = parseInt(q.answerIndex, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 3) {
        q.answerIndex = parsed;
        return q;
      }
    }

    // If answer exists, try to convert it
    if (q.answer !== undefined && q.answer !== null) {
      // First try: letter format (A, B, C, D)
      const letterIndex = _convertAnswerToIndex(q.answer);
      if (letterIndex >= 0 && letterIndex <= 3) {
        q.answerIndex = letterIndex;
        return q;
      }

      // Second try: numeric string
      if (typeof q.answer === 'string') {
        const parsed = parseInt(q.answer, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 3) {
          q.answerIndex = parsed;
          return q;
        }
      }

      // Third try: numeric value
      if (typeof q.answer === 'number' && q.answer >= 0 && q.answer <= 3) {
        q.answerIndex = q.answer;
        return q;
      }

      // Fourth try: full option text match
      if (q.options && Array.isArray(q.options) && q.options.length > 0) {
        const answerText = String(q.answer).trim();
        const exactMatchIndex = q.options.findIndex(opt => String(opt).trim() === answerText);
        if (exactMatchIndex !== -1) {
          q.answerIndex = exactMatchIndex;
          return q;
        }

        // Case-insensitive match
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

  /**
   * Load mock test questions from Firebase Storage
   * Path: mock/{examType}/questions.json
   * FIXED: Proper error handling and retry logic
   */
  const loadQuestionsFromFirebase = async (examType) => {
    try {
      state.isLoading = true;
      state.error = null;

      const fb = getFirebaseServices();
      if (!fb) {
        throw new Error('Firebase Storage not initialized. Please ensure Firebase is loaded.');
      }

      // Check cache first
      if (questionCache[examType]) {
        state.isLoading = false;
        return questionCache[examType];
      }

      // Build file path
      const filePath = `${MOCK_STORAGE_PATH}/${examType}/questions.json`;
      console.log(`[MockTest] Loading questions from: ${filePath}`);

      const fileRef = fb.storageRef(fb.storage, filePath);

      // Get download URL with retry logic
      let url;
      let retries = 3;
      while (retries > 0) {
        try {
          url = await fb.getDownloadURL(fileRef);
          break;
        } catch (e) {
          retries--;
          if (retries === 0) throw e;
          await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
        }
      }

      // Fetch the JSON file with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(url, {
        cache: 'no-cache',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to load questions: HTTP ${response.status} - ${response.statusText}`);
      }

      let questions = await response.json();

      // Ensure questions is an array
      if (!Array.isArray(questions)) {
        if (questions && typeof questions === 'object') {
          // If it's a single object, wrap in array
          questions = Object.keys(questions).length > 0 ? [questions] : [];
        } else {
          questions = [];
        }
      }

      if (questions.length === 0) {
        throw new Error(`No questions found for ${EXAM_TYPES[examType]?.name || examType}`);
      }

      console.log(`[MockTest] Loaded ${questions.length} total questions from Firebase`);

      // Normalize each question
      const normalizedQuestions = [];
      for (const q of questions) {
        const normalized = _normalizeQuestion(q);
        if (normalized) {
          normalizedQuestions.push(normalized);
        }
      }

      // Validate and filter questions
      const validatedQuestions = normalizedQuestions.filter(q =>
        q &&
        q.question &&
        q.options &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        typeof q.answerIndex !== 'undefined' &&
        q.answerIndex >= 0 &&
        q.answerIndex < q.options.length
      );

      if (validatedQuestions.length === 0) {
        throw new Error('No valid questions found after validation');
      }

      console.log(`[MockTest] Validated ${validatedQuestions.length} questions`);

      // Cache the questions
      questionCache[examType] = validatedQuestions;

      state.isLoading = false;
      return validatedQuestions;

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

  /**
   * Start a new mock test (FIXED: Limited to 10 questions)
   */
  const startMockTest = async (examType, testConfig = {}) => {
    const {
      questionCount = QUESTIONS_PER_TEST, // FIXED: Hardcoded to 10
      timeLimit = null,
      shuffle = true
    } = testConfig;

    try {
      // Load questions from Firebase
      const allQuestions = await loadQuestionsFromFirebase(examType);

      if (allQuestions.length === 0) {
        throw new Error('No questions available for this exam');
      }

      // Select random questions or limit to 10
      let selectedQuestions = allQuestions;
      if (shuffle) {
        selectedQuestions = _shuffleArray(selectedQuestions);
      }
      selectedQuestions = selectedQuestions.slice(0, Math.min(questionCount, QUESTIONS_PER_TEST));

      // Initialize state
      state.currentExam = examType;
      state.questions = selectedQuestions;
      state.userAnswers = new Array(selectedQuestions.length).fill(-1);
      state.startTime = Date.now();
      state.endTime = timeLimit ? Date.now() + (timeLimit * 1000) : null;
      state.results = null;
      state.currentQuestionIndex = 0;

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

  /**
   * Submit answer for a question
   */
  const submitAnswer = (questionIndex, answerIndex) => {
    if (questionIndex < 0 || questionIndex >= state.questions.length) {
      return { success: false, error: 'Invalid question index' };
    }

    state.userAnswers[questionIndex] = answerIndex;
    return { success: true };
  };

  /**
   * Get current question
   */
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

  /**
   * Go to next question
   */
  const nextQuestion = () => {
    if (state.currentQuestionIndex < state.questions.length - 1) {
      state.currentQuestionIndex++;
      return true;
    }
    return false;
  };

  /**
   * Go to previous question
   */
  const previousQuestion = () => {
    if (state.currentQuestionIndex > 0) {
      state.currentQuestionIndex--;
      return true;
    }
    return false;
  };

  /**
   * Finish mock test and calculate results
   */
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
      detailedResults
    };

    return {
      success: true,
      results: state.results
    };
  };

  /**
   * Get current state
   */
  const getState = () => {
    return { ...state };
  };

  /**
   * Reset state
   */
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
    // Constants
    EXAM_TYPES,
    FIREBASE_BUCKET,
    MOCK_STORAGE_PATH,
    QUESTIONS_PER_TEST,
    FREE_DAILY_TESTS,

    // Core functions
    startMockTest,
    submitAnswer,
    finishMockTest,
    loadQuestionsFromFirebase,

    // Navigation
    getCurrentQuestion,
    nextQuestion,
    previousQuestion,

    // Daily limits
    checkDailyLimit,
    incrementDailyTest,
    getDailyTestKey,

    // Utilities
    getState,
    reset,
    getExamName: (examType) => EXAM_TYPES[examType]?.name || examType,
    getAllExams: () => Object.keys(EXAM_TYPES),
    getExamsByCategory: (category) =>
      Object.keys(EXAM_TYPES).filter(key => EXAM_TYPES[key].category === category),

    // Cache management
    clearCache: (examType) => {
      if (examType) {
        delete questionCache[examType];
      } else {
        Object.keys(questionCache).forEach(key => delete questionCache[key]);
      }
    }
  };
})();

// ═════════════════════════════════════════════════════════════════
// EXPOSE TO WINDOW FOR GLOBAL ACCESS
// ═════════════════════════════════════════════════════════════════

window.MockTestModule = MockTestModule;

console.info('[MockTest] Module loaded successfully v2.0');
console.info('[MockTest] Questions per test:', MockTestModule.QUESTIONS_PER_TEST);
console.info('[MockTest] Free daily tests:', MockTestModule.FREE_DAILY_TESTS);
console.info('[MockTest] Available exams:', MockTestModule.getAllExams().length);