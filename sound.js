(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SansuSound = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STORAGE_KEY_MUTE = "pocket_sansu_mute_v1";
  const STORAGE_KEY_STYLE = "pocket_sansu_sound_style_v1";

  function createSoundEngine(options = {}) {
    const AudioCtx = options.AudioContext ||
      (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)) ||
      null;

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

    let ctx = null;
    let muted = storage.getItem(STORAGE_KEY_MUTE) === "1";
    let style = storage.getItem(STORAGE_KEY_STYLE) === "modern" ? "modern" : "retro";

    function ensureContext() {
      if (!AudioCtx) return null;
      if (!ctx) {
        ctx = new AudioCtx();
      }
      if (ctx.state === "suspended" && typeof ctx.resume === "function") {
        ctx.resume().catch(() => {});
      }
      return ctx;
    }

    function isMuted() { return muted; }
    function getStyle() { return style; }

    function setMuted(val) {
      muted = Boolean(val);
      storage.setItem(STORAGE_KEY_MUTE, muted ? "1" : "0");
      return muted;
    }

    function toggleMute() {
      return setMuted(!muted);
    }

    function setStyle(nextStyle) {
      style = nextStyle === "modern" ? "modern" : "retro";
      storage.setItem(STORAGE_KEY_STYLE, style);
      return style;
    }

    function toggleStyle() {
      return setStyle(style === "retro" ? "modern" : "retro");
    }

    // --- RETRO 1980s PIEZO BUZZER SYNTH ---
    function playPiezoTone(ac, freq, startOffset, duration, gainLevel = 0.14, freqEnd = null) {
      const t0 = ac.currentTime + startOffset;
      const osc = ac.createOscillator();
      const filter = ac.createBiquadFilter();
      const gain = ac.createGain();

      osc.type = "square";
      osc.frequency.setValueAtTime(freq, t0);
      if (freqEnd !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + duration);
      }

      // Authentic tinny plastic-housed piezo buzzer resonance
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(Math.min(3400, Math.max(900, freq * 1.15)), t0);
      filter.Q.setValueAtTime(1.4, t0);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(gainLevel, t0 + 0.004);
      gain.gain.setValueAtTime(gainLevel * 0.85, t0 + Math.max(0.006, duration - 0.01));
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ac.destination);

      osc.start(t0);
      osc.stop(t0 + duration + 0.015);
    }

    // --- MODERN HI-FI CHIME / WARM SYNTH ---
    function playModernTone(ac, freq, startOffset, duration, gainLevel = 0.16, opts = {}) {
      const t0 = ac.currentTime + startOffset;
      const oscMain = ac.createOscillator();
      const oscHarm = ac.createOscillator();
      const filter = ac.createBiquadFilter();
      const gain = ac.createGain();
      const harmGain = ac.createGain();

      oscMain.type = opts.wave || "triangle";
      oscHarm.type = "sine";

      oscMain.frequency.setValueAtTime(freq, t0);
      oscHarm.frequency.setValueAtTime(freq * (opts.harmonic || 2), t0);

      if (opts.freqEnd) {
        oscMain.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), t0 + duration);
        oscHarm.frequency.exponentialRampToValueAtTime(Math.max(80, opts.freqEnd * (opts.harmonic || 2)), t0 + duration);
      }

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(opts.cutoff || 3800, t0);
      filter.frequency.exponentialRampToValueAtTime(900, t0 + duration);

      harmGain.gain.setValueAtTime(opts.harmLevel || 0.25, t0);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(gainLevel, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      oscMain.connect(filter);
      oscHarm.connect(harmGain);
      harmGain.connect(filter);
      filter.connect(gain);
      gain.connect(ac.destination);

      oscMain.start(t0);
      oscHarm.start(t0);
      oscMain.stop(t0 + duration + 0.03);
      oscHarm.stop(t0 + duration + 0.03);
    }

    function play(eventName) {
      if (muted || !eventName) return false;
      const ac = ensureContext();
      if (!ac) return false;

      if (style === "retro") {
        switch (eventName) {
          case "boot":
            playPiezoTone(ac, 2093, 0, 0.11, 0.15);
            playPiezoTone(ac, 2637, 0.12, 0.16, 0.15);
            break;
          case "powerOff":
            playPiezoTone(ac, 1480, 0, 0.09, 0.12, 520);
            break;
          case "click":
            playPiezoTone(ac, 1680, 0, 0.024, 0.09);
            break;
          case "gameStart":
            playPiezoTone(ac, 1046.5, 0, 0.07, 0.13);
            playPiezoTone(ac, 1318.5, 0.08, 0.07, 0.13);
            playPiezoTone(ac, 1568.0, 0.16, 0.12, 0.14);
            break;
          case "tickL":
            playPiezoTone(ac, 880, 0, 0.028, 0.085);
            break;
          case "tickR":
            playPiezoTone(ac, 1046.5, 0, 0.028, 0.085);
            break;
          case "catch":
            playPiezoTone(ac, 1396.9, 0, 0.045, 0.14);
            playPiezoTone(ac, 1975.5, 0.05, 0.075, 0.15);
            break;
          case "levelUp":
            playPiezoTone(ac, 1046.5, 0, 0.055, 0.14);
            playPiezoTone(ac, 1318.5, 0.06, 0.055, 0.14);
            playPiezoTone(ac, 1568.0, 0.12, 0.055, 0.14);
            playPiezoTone(ac, 2093.0, 0.18, 0.12, 0.15);
            break;
          case "correct":
            playPiezoTone(ac, 1046.5, 0, 0.08, 0.14);
            playPiezoTone(ac, 1318.5, 0.09, 0.08, 0.14);
            playPiezoTone(ac, 1568.0, 0.18, 0.08, 0.14);
            playPiezoTone(ac, 2093.0, 0.27, 0.22, 0.15);
            break;
          case "wrong":
            playPiezoTone(ac, 240, 0, 0.14, 0.16, 185);
            playPiezoTone(ac, 190, 0.16, 0.2, 0.16, 145);
            break;
          case "gameOver":
            playPiezoTone(ac, 659.25, 0, 0.12, 0.15);
            playPiezoTone(ac, 587.33, 0.13, 0.12, 0.15);
            playPiezoTone(ac, 523.25, 0.26, 0.12, 0.15);
            playPiezoTone(ac, 440.0, 0.39, 0.14, 0.15);
            playPiezoTone(ac, 329.63, 0.54, 0.32, 0.16, 290);
            break;
          default:
            return false;
        }
      } else {
        // MODERN HI-FI CHIME / TACTILE SYNTH
        switch (eventName) {
          case "boot":
            playModernTone(ac, 523.25, 0, 0.35, 0.14, { wave: "sine", harmonic: 2 });
            playModernTone(ac, 659.25, 0.06, 0.35, 0.14, { wave: "sine", harmonic: 2 });
            playModernTone(ac, 783.99, 0.12, 0.38, 0.14, { wave: "sine", harmonic: 2 });
            playModernTone(ac, 1174.66, 0.18, 0.45, 0.12, { wave: "sine", harmonic: 1.5 });
            break;
          case "powerOff":
            playModernTone(ac, 620, 0, 0.22, 0.12, { wave: "sine", freqEnd: 240, harmLevel: 0.1 });
            break;
          case "click":
            playModernTone(ac, 720, 0, 0.045, 0.11, { wave: "sine", freqEnd: 420, harmLevel: 0.08, cutoff: 2200 });
            break;
          case "gameStart":
            playModernTone(ac, 523.25, 0, 0.16, 0.14);
            playModernTone(ac, 659.25, 0.08, 0.16, 0.14);
            playModernTone(ac, 1046.5, 0.16, 0.28, 0.15);
            break;
          case "tickL":
            playModernTone(ac, 440, 0, 0.05, 0.085, { wave: "sine", freqEnd: 360, harmLevel: 0.12, cutoff: 1600 });
            break;
          case "tickR":
            playModernTone(ac, 554.37, 0, 0.05, 0.085, { wave: "sine", freqEnd: 460, harmLevel: 0.12, cutoff: 1800 });
            break;
          case "catch":
            playModernTone(ac, 880, 0, 0.18, 0.15, { wave: "sine", harmonic: 1.5, harmLevel: 0.35 });
            playModernTone(ac, 1318.5, 0.045, 0.22, 0.14, { wave: "sine", harmonic: 2, harmLevel: 0.25 });
            break;
          case "levelUp":
            playModernTone(ac, 587.33, 0, 0.18, 0.14);
            playModernTone(ac, 739.99, 0.07, 0.18, 0.14);
            playModernTone(ac, 880.0, 0.14, 0.22, 0.14);
            playModernTone(ac, 1174.66, 0.21, 0.36, 0.15);
            break;
          case "correct":
            playModernTone(ac, 523.25, 0, 0.2, 0.14);
            playModernTone(ac, 659.25, 0.09, 0.2, 0.14);
            playModernTone(ac, 783.99, 0.18, 0.22, 0.14);
            playModernTone(ac, 1046.5, 0.27, 0.42, 0.16, { wave: "sine", harmonic: 1.5 });
            break;
          case "wrong":
            playModernTone(ac, 260, 0, 0.14, 0.14, { wave: "triangle", freqEnd: 210, cutoff: 900 });
            playModernTone(ac, 200, 0.14, 0.22, 0.14, { wave: "triangle", freqEnd: 160, cutoff: 800 });
            break;
          case "gameOver":
            playModernTone(ac, 523.25, 0, 0.22, 0.13);
            playModernTone(ac, 466.16, 0.16, 0.22, 0.13);
            playModernTone(ac, 415.30, 0.32, 0.24, 0.13);
            playModernTone(ac, 349.23, 0.48, 0.48, 0.15, { wave: "sine", cutoff: 1400 });
            break;
          default:
            return false;
        }
      }
      return true;
    }

    return {
      play,
      isMuted,
      setMuted,
      toggleMute,
      getStyle,
      setStyle,
      toggleStyle,
      ensureContext
    };
  }

  return {
    createSoundEngine,
    STORAGE_KEY_MUTE,
    STORAGE_KEY_STYLE
  };
});

