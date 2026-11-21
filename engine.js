(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SansuEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STORAGE_KEY_BEST = "pocket_sansu_best_v1";
  const SPEED_TIERS_MS = [540, 460, 400, 350, 305, 265, 230, 200, 175, 150, 130];
  const CATCH_STEP = 4;
  const GROUND_STEP = 5;
  const POST_CATCH_DEBOUNCE_MS = 140;
  const CALC_MAX = 999999;

  function getTickInterval(score) {
    const tier = Math.max(0, Math.floor((score || 0) / 10));
    if (tier < SPEED_TIERS_MS.length) return SPEED_TIERS_MS[tier];
    return 120;
  }

  function createSansuEngine(options = {}) {
    const random = options.random || Math.random;
    const now = options.now || (() => Date.now());
    const storage = options.storage || {
      getItem(k) {
        try { return typeof localStorage !== "undefined" ? localStorage.getItem(k) : null; }
        catch { return null; }
      },
      setItem(k, v) {
        try { if (typeof localStorage !== "undefined") localStorage.setItem(k, v); }
        catch {}
      }
    };

    function loadBest() {
      const raw = storage.getItem(STORAGE_KEY_BEST);
      const parsed = parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    function saveBest(val) {
      storage.setItem(STORAGE_KEY_BEST, String(val));
    }

    function randInt(min, max) {
      return min + Math.floor(random() * (max - min + 1));
    }

    const state = {
      power: "off", // 'off' | 'booting' | 'on'
      mode: "off",  // 'off' | 'standby' | 'game' | 'quiz' | 'calc'
      pierrotPose: "idle", // 'idle' | 'catchL' | 'catchR' | 'catchBoth' | 'happy' | 'miss'

      // Game state
      game: {
        status: "idle", // 'idle' | 'playing' | 'gameover'
        score: 0,
        bestScore: loadBest(),
        balls: [], // [{ id, lane: 0|1, step: 0..5 }]
        nextBallId: 1,
        nextLane: 0,
        missReason: null, // 'drop' | 'timing' | null
        lastCatchTime: -1000,
        caughtFlashLane: null
      },

      // Quiz state
      quiz: {
        type: null, // 'add' | 'sub' | 'mul'
        a: 0,
        b: 0,
        op: "+",
        answer: 0,
        input: "",
        score: 0,
        attempts: 0,
        feedback: null, // null | 'correct' | 'wrong' | 'reveal'
        ball: null,     // { lane: 0|1, step: 0..5 } | null
        nextLane: 0
      },

      // Calculator state
      calc: {
        display: "0",
        accumulator: null,
        pendingOp: null,
        waitingForOperand: false,
        lastOp: null,
        lastOperand: null,
        error: false
      }
    };

    function getState() {
      return state;
    }

    function isInteractive() {
      return state.power === "on";
    }

    // --- POWER ---
    function pressOn() {
      if (state.power === "off") {
        state.power = "booting";
        state.mode = "booting";
        state.pierrotPose = "idle";
        return { sound: "boot", startBootTimer: true };
      }
      if (state.power === "booting") {
        return { sound: null };
      }
      // Already on: reset to standby
      state.mode = "standby";
      state.pierrotPose = "idle";
      state.game.status = "idle";
      state.game.balls = [];
      state.quiz.feedback = null;
      return { sound: "click", stopTimers: true };
    }

    function finishBoot() {
      if (state.power !== "booting") return false;
      state.power = "on";
      state.mode = "standby";
      state.pierrotPose = "idle";
      return true;
    }

    function pressOff() {
      if (state.power === "off") return { sound: null };
      state.power = "off";
      state.mode = "off";
      state.pierrotPose = "idle";
      state.game.status = "idle";
      state.game.balls = [];
      state.quiz.feedback = null;
      return { sound: "powerOff", stopTimers: true };
    }

    // --- GAME MODE ---
    function startGame() {
      if (!isInteractive()) return { sound: null };
      state.mode = "game";
      state.pierrotPose = "idle";
      state.game.status = "playing";
      state.game.score = 0;
      state.game.balls = [];
      state.game.missReason = null;
      state.game.lastCatchTime = -1000;
      state.game.caughtFlashLane = null;
      state.game.nextLane = randInt(0, 1);

      // Spawn first ball at top
      spawnBall(state.game.nextLane);
      state.game.nextLane = 1 - state.game.nextLane;
      return { sound: "gameStart", startGameLoop: true };
    }

    function spawnBall(lane) {
      state.game.balls.push({
        id: state.game.nextBallId++,
        lane,
        step: 0
      });
    }

    function tickGame() {
      if (!isInteractive() || state.mode !== "game" || state.game.status !== "playing") {
        return { sound: null, active: false };
      }

      const g = state.game;
      state.pierrotPose = "idle";
      g.caughtFlashLane = null;

      // Advance all balls
      let dropped = false;
      let soundLane = 0;
      for (let i = 0; i < g.balls.length; i++) {
        g.balls[i].step += 1;
        soundLane = g.balls[i].lane;
        if (g.balls[i].step >= GROUND_STEP) {
          dropped = true;
        }
      }

      if (dropped) {
        g.status = "gameover";
        g.missReason = "drop";
        state.pierrotPose = "miss";
        if (g.score > g.bestScore) {
          g.bestScore = g.score;
          saveBest(g.bestScore);
        }
        return { sound: "gameOver", active: false, gameOver: true, reason: "drop" };
      }

      // Spawn logic
      const maxBalls = g.score >= 10 ? 2 : 1;
      if (g.balls.length === 0) {
        soundLane = g.nextLane;
        spawnBall(g.nextLane);
        g.nextLane = 1 - g.nextLane;
      } else if (g.balls.length < maxBalls) {
        // Stagger second ball in opposite lane when existing ball is at step 2 or 3
        const existing = g.balls[0];
        if (existing.step >= 2 && existing.step <= 3) {
          spawnBall(1 - existing.lane);
        }
      }

      return {
        sound: soundLane === 0 ? "tickL" : "tickR",
        active: true,
        interval: getTickInterval(g.score)
      };
    }

    function pressCatch() {
      if (!isInteractive()) return { sound: null };
      if (state.mode !== "game") return { sound: "click" };
      const g = state.game;
      if (g.status !== "playing") {
        // Allow restarting game easily or ignore; spec says '게임 키' starts game
        return { sound: null };
      }

      const catchable = g.balls.filter((b) => b.step === CATCH_STEP);
      if (catchable.length > 0) {
        const prevTier = Math.floor(g.score / 10);
        g.balls = g.balls.filter((b) => b.step !== CATCH_STEP);
        g.score += catchable.length;
        const newTier = Math.floor(g.score / 10);
        g.lastCatchTime = now();

        if (catchable.length >= 2) {
          state.pierrotPose = "catchBoth";
          g.caughtFlashLane = 2;
        } else {
          state.pierrotPose = catchable[0].lane === 0 ? "catchL" : "catchR";
          g.caughtFlashLane = catchable[0].lane;
        }

        if (g.score > g.bestScore) {
          g.bestScore = g.score;
          saveBest(g.bestScore);
        }

        return {
          sound: newTier > prevTier ? "levelUp" : "catch",
          caught: catchable.length,
          leveledUp: newTier > prevTier,
          interval: getTickInterval(g.score)
        };
      }

      // Post-catch bounce debounce prevents accidental double-tap death
      if (now() - g.lastCatchTime < POST_CATCH_DEBOUNCE_MS) {
        return { sound: null, debounced: true };
      }

      // Timing miss -> Game Over
      g.status = "gameover";
      g.missReason = "timing";
      state.pierrotPose = "miss";
      if (g.score > g.bestScore) {
        g.bestScore = g.score;
        saveBest(g.bestScore);
      }
      return { sound: "gameOver", gameOver: true, reason: "timing" };
    }

    // --- QUIZ MODE ---
    function generateQuestion(type) {
      let a = 0, b = 0, op = "+", answer = 0;
      if (type === "add") {
        op = "+";
        a = randInt(1, 50);
        b = randInt(1, Math.min(49, 99 - a));
        answer = a + b;
      } else if (type === "sub") {
        op = "-";
        a = randInt(5, 99);
        b = randInt(1, a);
        answer = a - b;
      } else if (type === "mul") {
        op = "×";
        a = randInt(2, 9);
        b = randInt(1, 9);
        answer = a * b;
      }
      state.quiz.type = type;
      state.quiz.a = a;
      state.quiz.b = b;
      state.quiz.op = op;
      state.quiz.answer = answer;
      state.quiz.input = "";
      state.quiz.attempts = 0;
      state.quiz.feedback = null;
      state.quiz.ball = { lane: state.quiz.nextLane, step: 0 };
      state.quiz.nextLane = 1 - state.quiz.nextLane;
      state.pierrotPose = "idle";
    }

    function getQuizBallInterval(quizScore) {
      return Math.max(1000, 1650 - Math.min(13, quizScore || 0) * 50);
    }

    function startQuiz(type) {
      if (!isInteractive()) return { sound: null };
      state.mode = "quiz";
      state.game.status = "idle";
      state.game.balls = [];
      state.quiz.score = 0;
      state.quiz.nextLane = randInt(0, 1);
      generateQuestion(type);
      return { sound: "click", stopTimers: true, startQuizBall: true };
    }

    function tickQuizBall() {
      if (!isInteractive() || state.mode !== "quiz" || state.quiz.feedback !== null || !state.quiz.ball) {
        return { sound: null, active: false };
      }
      const q = state.quiz;
      q.ball.step += 1;
      if (q.ball.step >= GROUND_STEP) {
        q.feedback = "reveal";
        q.input = String(q.answer);
        state.pierrotPose = "miss";
        return { sound: "wrong", active: false, result: "timeout", nextDelayMs: 1400 };
      }
      return {
        sound: q.ball.lane === 0 ? "tickL" : "tickR",
        active: true,
        interval: getQuizBallInterval(q.score)
      };
    }

    function nextQuizQuestion() {
      if (!isInteractive() || state.mode !== "quiz") return false;
      generateQuestion(state.quiz.type);
      return true;
    }

    function clearQuizFeedbackForRetry() {
      if (!isInteractive() || state.mode !== "quiz") return false;
      state.quiz.input = "";
      state.quiz.feedback = null;
      state.pierrotPose = "idle";
      return true;
    }

    function submitQuizAnswer() {
      if (!isInteractive() || state.mode !== "quiz") return { sound: null };
      const q = state.quiz;
      if (q.feedback !== null || q.input === "") return { sound: null };

      const val = parseInt(q.input, 10);
      if (val === q.answer) {
        const lane = q.ball ? q.ball.lane : 0;
        q.ball = null;
        q.feedback = "correct";
        q.score += 1;
        state.pierrotPose = lane === 0 ? "quizCatchL" : "quizCatchR";
        return { sound: "correct", result: "correct", nextDelayMs: 1100 };
      } else {
        q.attempts += 1;
        state.pierrotPose = "miss";
        if (q.attempts >= 2) {
          if (q.ball) q.ball.step = GROUND_STEP;
          q.feedback = "reveal";
          q.input = String(q.answer);
          return { sound: "wrong", result: "reveal", nextDelayMs: 1400 };
        }
        q.feedback = "wrong";
        return { sound: "wrong", result: "retry", retryDelayMs: 750 };
      }
    }

    // --- CALCULATOR MODE ---
    function resetCalc() {
      state.calc.display = "0";
      state.calc.accumulator = null;
      state.calc.pendingOp = null;
      state.calc.waitingForOperand = false;
      state.calc.lastOp = null;
      state.calc.lastOperand = null;
      state.calc.error = false;
    }

    function startCalc() {
      if (!isInteractive()) return { sound: null };
      state.mode = "calc";
      state.game.status = "idle";
      state.game.balls = [];
      state.pierrotPose = "idle";
      resetCalc();
      return { sound: "click", stopTimers: true };
    }

    function formatCalcNumber(num) {
      if (!Number.isFinite(num) || num > CALC_MAX || num < -CALC_MAX) {
        state.calc.error = true;
        return "Err";
      }
      return String(Math.trunc(num));
    }

    function computeCalc(a, op, b) {
      if (op === "+") return a + b;
      if (op === "-") return a - b;
      return b;
    }

    // --- SHARED INPUT KEYS ---
    function pressDigit(digitChar) {
      if (!isInteractive()) return { sound: null };
      const d = String(digitChar);
      if (!/^[0-9]$/.test(d)) return { sound: null };

      if (state.mode === "quiz") {
        const q = state.quiz;
        if (q.feedback !== null) return { sound: null };
        if (q.input.length >= 3) return { sound: "click" };
        if (q.input === "0") {
          q.input = d;
        } else {
          q.input += d;
        }
        const expectedLen = String(q.answer).length;
        const autoSubmit = q.input.length === expectedLen;
        return { sound: "click", autoSubmit };
      }

      if (state.mode === "calc") {
        const c = state.calc;
        if (c.error) resetCalc();
        if (c.waitingForOperand) {
          c.display = d;
          c.waitingForOperand = false;
        } else if (c.display === "0") {
          c.display = d;
        } else if (c.display.replace("-", "").length < 6) {
          c.display += d;
        }
        return { sound: "click" };
      }

      return { sound: "click" };
    }

    function pressBackspace() {
      if (!isInteractive()) return { sound: null };
      if (state.mode === "quiz" && state.quiz.feedback === null) {
        state.quiz.input = state.quiz.input.slice(0, -1);
        return { sound: "click" };
      }
      if (state.mode === "calc") {
        const c = state.calc;
        if (c.error) { resetCalc(); return { sound: "click" }; }
        if (!c.waitingForOperand) {
          const next = c.display.slice(0, -1);
          c.display = next === "" || next === "-" ? "0" : next;
        }
        return { sound: "click" };
      }
      return { sound: null };
    }

    function pressOperator(op) {
      if (!isInteractive()) return { sound: null };
      if (op !== "+" && op !== "-") return { sound: null };

      if (state.mode === "calc") {
        const c = state.calc;
        if (c.error) resetCalc();
        const current = parseInt(c.display, 10) || 0;

        if (c.accumulator !== null && c.pendingOp && !c.waitingForOperand) {
          const res = computeCalc(c.accumulator, c.pendingOp, current);
          c.display = formatCalcNumber(res);
          if (c.error) return { sound: "wrong" };
          c.accumulator = res;
        } else {
          c.accumulator = current;
        }
        c.pendingOp = op;
        c.waitingForOperand = true;
        c.lastOp = null;
        c.lastOperand = null;
        return { sound: "click" };
      }

      return { sound: "click" };
    }

    function pressEquals() {
      if (!isInteractive()) return { sound: null };

      if (state.mode === "quiz") {
        return submitQuizAnswer();
      }

      if (state.mode === "calc") {
        const c = state.calc;
        if (c.error) {
          resetCalc();
          return { sound: "click" };
        }
        const current = parseInt(c.display, 10) || 0;

        if (c.pendingOp && c.accumulator !== null) {
          const operand = c.waitingForOperand ? c.accumulator : current;
          const res = computeCalc(c.accumulator, c.pendingOp, operand);
          c.lastOp = c.pendingOp;
          c.lastOperand = operand;
          c.display = formatCalcNumber(res);
          c.accumulator = c.error ? null : res;
          c.pendingOp = null;
          c.waitingForOperand = true;
          return { sound: c.error ? "wrong" : "click" };
        }

        // Repeated '='
        if (c.lastOp && c.lastOperand !== null) {
          const res = computeCalc(current, c.lastOp, c.lastOperand);
          c.display = formatCalcNumber(res);
          c.accumulator = c.error ? null : res;
          c.waitingForOperand = true;
          return { sound: c.error ? "wrong" : "click" };
        }

        return { sound: "click" };
      }

      return { sound: "click" };
    }

    return {
      getState,
      getTickInterval,
      pressOn,
      finishBoot,
      pressOff,
      startGame,
      tickGame,
      pressCatch,
      startQuiz,
      tickQuizBall,
      getQuizBallInterval,
      nextQuizQuestion,
      clearQuizFeedbackForRetry,
      submitQuizAnswer,
      startCalc,
      pressDigit,
      pressBackspace,
      pressOperator,
      pressEquals,
      CATCH_STEP,
      GROUND_STEP
    };
  }

  return {
    createSansuEngine,
    getTickInterval,
    CATCH_STEP,
    GROUND_STEP,
    STORAGE_KEY_BEST
  };
});

