/**
 * MOCK TEST MODULE v1.0
 * ─────────────────────────────────────────────────────────────
 * Loads mock test questions from Firebase Storage
 * Integrates with the main CrackAI app for exam preparation
 * Storage Path: gs://rankgpt-f8a64.firebasestorage.app/mock/{exam_type}/
 */

'use strict';

const MockTestModule = (function() {
  // ═══════════════════════════════════════════════════════════════
  // CONFIG & CONSTANTS
  // ═══════════════════════════════════════════════════════════════

  const FIREBASE_BUCKET = 'rankgpt-f8a64.firebasestorage.app';
  const MOCK_STORAGE_PATH = 'mock';

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
    error: null
  };

  // Cache for loaded questions
  const questionCache = {};

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
   * Load mock test questions from Firebase Storage
   * Path: mock/{examType}/questions.json
   */
  const loadQuestionsFromFirebase = async (examType) => {
    try {
      state.isLoading = true;
      state.error = null;

      const fb = getFirebaseServices();
      if (!fb) {
        throw new Error('Firebase not initialized');
      }

      // Check cache first
      if (questionCache[examType]) {
        return questionCache[examType];
      }

      // Build file path
      const filePath = `${MOCK_STORAGE_PATH}/${examType}/questions.json`;
      const fileRef = fb.storageRef(fb.storage, filePath);
      
      // Get download URL
      const url = await fb.getDownloadURL(fileRef);
      
      // Fetch the JSON file
      const response = await fetch(url, {
    cache: 'no-cache'
});

      if (!response.ok) {
        throw new Error(`Failed to load questions: HTTP ${response.status}`);
      }

      let questions = await response.json();

      // Ensure questions is an array
      if (!Array.isArray(questions)) {
        questions = [questions];
      }

      // Validate and normalize questions
      questions = questions.filter(q => q && q.question && q.options && typeof q.answerIndex !== 'undefined');

      // Cache the questions
      questionCache[examType] = questions;

      state.isLoading = false;
      return questions;

    } catch (error) {
      state.isLoading = false;
      state.error = error.message || 'Failed to load questions';
      console.error('[MockTest] Firebase Error:', error);
      return [];
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // MOCK TEST LOGIC
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start a new mock test
   */
  const startMockTest = async (examType, testConfig = {}) => {
    const {
      questionCount = 20,
      timeLimit = null, // in seconds
      shuffle = true
    } = testConfig;

    try {
      // Load questions from Firebase
      const allQuestions = await loadQuestionsFromFirebase(examType);

      if (allQuestions.length === 0) {
        throw new Error('No questions available for this exam');
      }

      // Select random questions or limit
      let selectedQuestions = allQuestions;
      if (shuffle) {
        selectedQuestions = _shuffleArray(selectedQuestions);
      }
      selectedQuestions = selectedQuestions.slice(0, questionCount);

      // Initialize state
      state.currentExam = examType;
      state.questions = selectedQuestions;
      state.userAnswers = new Array(selectedQuestions.length).fill(-1);
      state.startTime = Date.now();
      state.endTime = timeLimit ? Date.now() + (timeLimit * 1000) : null;
      state.results = null;

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
    const score = correctAnswers; // Can be customized with weightage

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

    // Core functions
    startMockTest,
    submitAnswer,
    finishMockTest,
    loadQuestionsFromFirebase,

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

/**
 * Initialize mock test opening function
 * Called when user clicks "📝 Mock Test" button
 */
window.openMockTest = async (examType) => {
  if (!examType || !MockTestModule.EXAM_TYPES[examType]) {
    alert('Invalid exam type selected');
    return;
  }

  const examName = MockTestModule.getExamName(examType);
  const result = await MockTestModule.startMockTest(examType, {
    questionCount: 20,
    timeLimit: 3600, // 1 hour
    shuffle: true
  });

  if (!result.success) {
    alert(`Error: ${result.error}`);
    return;
  }

  // Open mock test interface
  console.log(`Starting ${examName} mock test with ${result.questionCount} questions`);
  
  // Create and show mock test interface
  if (typeof showMockTestInterface === 'function') {
    showMockTestInterface(result);
  } else {
    // Fallback: simple alert
    alert(`✅ Mock Test Ready!\n\nExam: ${examName}\nQuestions: ${result.questionCount}\n\nMock test interface is being loaded...`);
  }
};

console.info('[MockTest] Module loaded successfully');
console.info('[MockTest] Available exams:', MockTestModule.getAllExams().length);
