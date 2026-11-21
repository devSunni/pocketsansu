const test = require("node:test");
const assert = require("node:assert/strict");
const { createSansuEngine, getTickInterval, CATCH_STEP, GROUND_STEP } = require("../engine.js");
const { createSoundEngine } = require("../sound.js");

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v))
  };
}

// ---------- POWER & BOOT TESTS ----------
test("Power ON boot sequence and OFF disables inputs", () => {
  const eng = createSansuEngine({ storage: createMemoryStorage() });
  assert.equal(eng.getState().power, "off");

  // Inputs ignored while off
  assert.equal(eng.startGame().sound, null);
  assert.equal(eng.pressDigit("5").sound, null);
  assert.equal(eng.pressCatch().sound, null);

  // Press ON -> booting
  const onRes = eng.pressOn();
  assert.equal(onRes.sound, "boot");
  assert.equal(onRes.startBootTimer, true);
  assert.equal(eng.getState().power, "booting");

  // Inputs still ignored while booting
  assert.equal(eng.startGame().sound, null);

  // Finish boot -> standby
  assert.equal(eng.finishBoot(), true);
  assert.equal(eng.getState().power, "on");
  assert.equal(eng.getState().mode, "standby");

  // Press OFF -> off
  const offRes = eng.pressOff();
  assert.equal(offRes.sound, "powerOff");
  assert.equal(eng.getState().power, "off");
  assert.equal(eng.startCalc().sound, null);
});

// ---------- GAME MODE TESTS ----------
test("Pierrot Catch Game: single ball catch, score increment, high score persistence", () => {
  const storage = createMemoryStorage();
  let fakeNow = 1000;
  const eng = createSansuEngine({ storage, random: () => 0.1, now: () => fakeNow });
  eng.pressOn();
  eng.finishBoot();

  const startRes = eng.startGame();
  assert.equal(startRes.sound, "gameStart");
  assert.equal(eng.getState().game.balls.length, 1);
  assert.equal(eng.getState().game.balls[0].step, 0);

  // Tick 4 times -> ball reaches CATCH_STEP (4)
  for (let i = 0; i < CATCH_STEP; i++) {
    const t = eng.tickGame();
    assert.equal(t.active, true);
  }
  assert.equal(eng.getState().game.balls[0].step, CATCH_STEP);

  // Catch at step 4 -> score +1, bestScore persisted
  const catchRes = eng.pressCatch();
  assert.equal(catchRes.caught, 1);
  assert.equal(catchRes.sound, "catch");
  assert.equal(eng.getState().game.score, 1);
  assert.equal(eng.getState().game.bestScore, 1);
  assert.equal(storage.getItem("pocket_sansu_best_v1"), "1");

  // Post-catch bounce debounce (<140ms) should NOT cause instant death
  fakeNow += 50;
  const bounceRes = eng.pressCatch();
  assert.equal(bounceRes.debounced, true);
  assert.equal(eng.getState().game.status, "playing");
});

test("Pierrot Catch Game: timing miss and floor drop both trigger game over", () => {
  let fakeNow = 2000;
  const eng = createSansuEngine({ storage: createMemoryStorage(), random: () => 0.1, now: () => fakeNow });
  eng.pressOn();
  eng.finishBoot();
  eng.startGame();

  // Ball is at step 0 -> pressing catch too early causes timing miss
  const earlyRes = eng.pressCatch();
  assert.equal(earlyRes.gameOver, true);
  assert.equal(earlyRes.reason, "timing");
  assert.equal(earlyRes.sound, "gameOver");
  assert.equal(eng.getState().game.status, "gameover");

  // Restart and let ball drop to GROUND_STEP (5)
  eng.startGame();
  for (let i = 0; i < GROUND_STEP - 1; i++) {
    assert.equal(eng.tickGame().active, true);
  }
  const dropRes = eng.tickGame();
  assert.equal(dropRes.gameOver, true);
  assert.equal(dropRes.reason, "drop");
  assert.equal(eng.getState().game.status, "gameover");
});

test("Pierrot Catch Game: 10+ points spawns 2 balls and accelerates every 10 points up to 100+", () => {
  // Verify speed curve strictly accelerates every 10 points
  let prev = getTickInterval(0);
  for (let s = 10; s <= 110; s += 10) {
    const cur = getTickInterval(s);
    assert.ok(cur < prev, `Expected interval at ${s} (${cur}) < previous (${prev})`);
    prev = cur;
  }
  assert.ok(getTickInterval(100) <= 130);

  let fakeNow = 5000;
  const eng = createSansuEngine({ storage: createMemoryStorage(), random: () => 0.2, now: () => fakeNow });
  eng.pressOn();
  eng.finishBoot();
  eng.startGame();

  // Play cleanly up to 10 points
  let sawTwoBalls = false;
  let sawLevelUpSound = false;
  for (let stepCount = 0; stepCount < 160 && eng.getState().game.score < 14; stepCount++) {
    fakeNow += 500;
    const balls = eng.getState().game.balls;
    if (balls.length >= 2) sawTwoBalls = true;
    if (balls.some((b) => b.step === CATCH_STEP)) {
      const c = eng.pressCatch();
      if (c.leveledUp && c.sound === "levelUp") sawLevelUpSound = true;
    } else {
      const t = eng.tickGame();
      assert.equal(t.active, true);
    }
  }

  assert.ok(eng.getState().game.score >= 12, "Should reach 12+ points cleanly");
  assert.equal(sawLevelUpSound, true, "Should emit levelUp at 10-point boundary");
  assert.equal(sawTwoBalls, true, "Should spawn 2 balls simultaneously once score >= 10");
});

// ---------- QUIZ MODE TESTS ----------
test("Quiz Mode: Addition, Subtraction, Multiplication generation, auto-submit, retry & answer reveal", () => {
  const eng = createSansuEngine({ storage: createMemoryStorage(), random: () => 0.5 });
  eng.pressOn();
  eng.finishBoot();

  // Addition
  eng.startQuiz("add");
  let q = eng.getState().quiz;
  assert.equal(q.op, "+");
  assert.equal(q.answer, q.a + q.b);

  // Enter correct answer digits
  const ansStr = String(q.answer);
  let lastRes;
  for (const ch of ansStr) {
    lastRes = eng.pressDigit(ch);
  }
  assert.equal(lastRes.autoSubmit, true);
  const subRes = eng.submitQuizAnswer();
  assert.equal(subRes.result, "correct");
  assert.equal(subRes.sound, "correct");
  assert.equal(eng.getState().pierrotPose, "happy");
  assert.equal(eng.getState().quiz.score, 1);

  // Subtraction (non-negative)
  eng.startQuiz("sub");
  q = eng.getState().quiz;
  assert.equal(q.op, "-");
  assert.ok(q.a >= q.b && q.answer >= 0);

  // Multiplication (2..9 x 1..9)
  eng.startQuiz("mul");
  q = eng.getState().quiz;
  assert.equal(q.op, "×");
  assert.ok(q.a >= 2 && q.a <= 9 && q.b >= 1 && q.b <= 9);
  assert.equal(q.answer, q.a * q.b);

  // Wrong answer 1st attempt -> retry
  const wrongAns = String(q.answer + 1);
  for (const ch of wrongAns) eng.pressDigit(ch);
  const w1 = eng.pressEquals();
  assert.equal(w1.result, "retry");
  assert.equal(w1.sound, "wrong");
  eng.clearQuizFeedbackForRetry();
  assert.equal(eng.getState().quiz.input, "");

  // Wrong answer 2nd attempt -> reveal correct answer
  for (const ch of wrongAns) eng.pressDigit(ch);
  const w2 = eng.pressEquals();
  assert.equal(w2.result, "reveal");
  assert.equal(eng.getState().quiz.input, String(q.answer));
});

// ---------- CALCULATOR MODE TESTS ----------
test("Calculator Mode: +, -, = chained operations, negative results, repeated equals, overflow", () => {
  const eng = createSansuEngine({ storage: createMemoryStorage() });
  eng.pressOn();
  eng.finishBoot();
  eng.startCalc();

  // 12 + 8 - 5 = 15
  eng.pressDigit("1"); eng.pressDigit("2");
  eng.pressOperator("+");
  eng.pressDigit("8");
  eng.pressOperator("-");
  assert.equal(eng.getState().calc.display, "20");
  eng.pressDigit("5");
  eng.pressEquals();
  assert.equal(eng.getState().calc.display, "15");

  // Repeated '=' subtracts 5 again -> 10
  eng.pressEquals();
  assert.equal(eng.getState().calc.display, "10");

  // Negative result: 10 - 25 = -15
  eng.pressOperator("-");
  eng.pressDigit("2"); eng.pressDigit("5");
  eng.pressEquals();
  assert.equal(eng.getState().calc.display, "-15");

  // Overflow: 999999 + 1 = Err
  eng.startCalc();
  for (let i = 0; i < 6; i++) eng.pressDigit("9");
  eng.pressOperator("+");
  eng.pressDigit("1");
  const ovRes = eng.pressEquals();
  assert.equal(ovRes.sound, "wrong");
  assert.equal(eng.getState().calc.display, "Err");
});

// ---------- SOUND ENGINE TESTS ----------
test("Sound Engine: Retro vs Modern modes, Mute toggle, and storage persistence", () => {
  const storage = createMemoryStorage();
  const playedOscTypes = [];

  class FakeAudioContext {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = {};
    }
    createOscillator() {
      const osc = {
        type: "sine",
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        start() { playedOscTypes.push(osc.type); },
        stop() {}
      };
      return osc;
    }
    createBiquadFilter() {
      return {
        type: "lowpass",
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        Q: { setValueAtTime() {} },
        connect() {}
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}
      };
    }
  }

  const sfx = createSoundEngine({ AudioContext: FakeAudioContext, storage });
  assert.equal(sfx.getStyle(), "retro");
  assert.equal(sfx.isMuted(), false);

  // Retro uses square wave piezo
  assert.equal(sfx.play("catch"), true);
  assert.ok(playedOscTypes.length >= 2);
  assert.ok(playedOscTypes.every((t) => t === "square"));

  // Switch to modern -> uses sine/triangle
  playedOscTypes.length = 0;
  sfx.toggleStyle();
  assert.equal(sfx.getStyle(), "modern");
  assert.equal(storage.getItem("pocket_sansu_sound_style_v1"), "modern");
  assert.equal(sfx.play("correct"), true);
  assert.ok(playedOscTypes.some((t) => t === "triangle" || t === "sine"));
  assert.ok(!playedOscTypes.includes("square"));

  // Mute blocks playback
  sfx.toggleMute();
  assert.equal(sfx.isMuted(), true);
  assert.equal(sfx.play("boot"), false);
});

