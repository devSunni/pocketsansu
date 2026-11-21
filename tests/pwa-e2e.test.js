const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createSansuEngine, CATCH_STEP } = require("../engine.js");

const ROOT = path.resolve(__dirname, "..");

test("PWA files exist, manifest.json is valid, and sw.js caches all runtime assets", () => {
  const manifestPath = path.join(ROOT, "manifest.json");
  const swPath = path.join(ROOT, "sw.js");
  const htmlPath = path.join(ROOT, "index.html");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 1);

  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(ROOT, icon.src)), `Missing icon: ${icon.src}`);
  }

  const swText = fs.readFileSync(swPath, "utf8");
  for (const asset of ["./index.html", "./engine.js", "./sound.js", "./manifest.json", "./icons/icon.svg"]) {
    assert.ok(swText.includes(asset), `sw.js missing asset ${asset}`);
    const rel = asset.replace(/^\.\//, "");
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `Asset on disk missing: ${rel}`);
  }

  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.includes('rel="manifest" href="manifest.json"'));
  assert.ok(html.includes("100dvh"));
  assert.ok(html.includes("touch-action: manipulation"));
  assert.ok(html.includes("user-select: none"));
  assert.ok(html.includes("serviceWorker.register"));
});

test("HTML DOM integrity: all referenced LCD segment IDs & 3-row hardware buttons exist", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  // Verify all setSeg("...") targets exist as id="..." in index.html
  const segRefs = [...html.matchAll(/setSeg\("([^"]+)"/g)].map((m) => m[1]);
  assert.ok(segRefs.length > 15, "Expected many LCD segment references");
  for (const id of new Set(segRefs)) {
    assert.ok(html.includes(`id="${id}"`), `Missing SVG segment element id="${id}"`);
  }

  // Verify all 12 ball segment IDs (2 lanes x 6 steps)
  for (let lane = 0; lane <= 1; lane++) {
    for (let step = 0; step <= 5; step++) {
      const id = `seg-ball-${lane}-${step}`;
      assert.ok(html.includes(`id="${id}"`), `Missing ball segment ${id}`);
    }
  }

  // Verify 3 rows of hardware buttons: 5 yellow, 6 orange, 10 digits (1..9, 0)
  const yellowBtns = html.match(/class="hw-btn btn-yellow"/g) || [];
  const orangeBtns = html.match(/class="hw-btn btn-orange"/g) || [];
  const digitBtns = html.match(/class="hw-btn btn-digit"/g) || [];
  assert.equal(yellowBtns.length, 5, "Row 1 must have 5 yellow buttons");
  assert.equal(orangeBtns.length, 5, "Row 2 must have 5 orange buttons (catch, +, -, =, backspace)");
  assert.equal(digitBtns.length, 10, "Row 3 must have 10 digit buttons");

  // Verify digit order 1 2 3 4 5 6 7 8 9 0
  const digitsOrder = [...html.matchAll(/data-digit="(\d)"/g)].map((m) => m[1]).join("");
  assert.equal(digitsOrder, "1234567890");
});

test("Real-world E2E journey: Boot -> Quiz -> Calc -> 100-point Catch Game -> OFF", () => {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v))
  };
  let clock = 0;
  const eng = createSansuEngine({ storage, random: () => 0.37, now: () => clock });

  // 1. Boot
  eng.pressOn();
  eng.finishBoot();
  assert.equal(eng.getState().mode, "standby");

  // 2. Solve 3 quizzes across add, sub, mul
  for (const kind of ["add", "sub", "mul"]) {
    eng.startQuiz(kind);
    const ans = String(eng.getState().quiz.answer);
    for (const ch of ans) eng.pressDigit(ch);
    const r = eng.pressEquals();
    assert.equal(r.result, "correct");
  }

  // 3. Calculator: 45 + 55 - 30 = 70
  eng.startCalc();
  for (const ch of "45") eng.pressDigit(ch);
  eng.pressOperator("+");
  for (const ch of "55") eng.pressDigit(ch);
  eng.pressOperator("-");
  for (const ch of "30") eng.pressDigit(ch);
  eng.pressEquals();
  assert.equal(eng.getState().calc.display, "70");

  // 4. Catch game all the way to 100 points!
  eng.startGame();
  let ticks = 0;
  while (eng.getState().game.score < 100 && ticks < 1000) {
    ticks++;
    clock += 400;
    const balls = eng.getState().game.balls;
    if (balls.some((b) => b.step === CATCH_STEP)) {
      const c = eng.pressCatch();
      assert.ok(c.caught >= 1);
    } else {
      const t = eng.tickGame();
      assert.equal(t.active, true);
    }
  }
  assert.ok(eng.getState().game.score >= 100);
  assert.equal(eng.getState().game.bestScore, eng.getState().game.score);
  assert.equal(eng.getTickInterval(100), 130);

  // 5. Power OFF
  eng.pressOff();
  assert.equal(eng.getState().power, "off");
});
