/**
 * Science Cypher beat, synthesised with the Web Audio API (no audio files).
 * Notes are scheduled ahead against the audio clock (AudioContext.currentTime),
 * never with timers, so the beat does not drift.
 * The AudioContext is created on the first start() call, which the station
 * only makes from a click or key press.
 */
import { spb, COUNT_IN, BEATS_PER_SLOT, STAR_BEAT } from './beat.js';

const BASS = [41, 41, 44, 39];      // MIDI notes per bar (F, F, Ab, Eb), a simple loop
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

export function createBeatEngine() {
  /** @type {AudioContext|null} */ let ac = null;
  let master = null, noise = null;
  /** Per-song bus: stop() fades and drops it, so notes queued ahead never leak into the next song. */
  let bus = null;
  let t0 = 0, bpm = 90, next = 0, running = false, muted = false;
  let tsCache = null;

  function ensure() {
    if (ac) return ac;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ac = new AC({ latencyHint: 'interactive' });
    master = ac.createGain();
    master.gain.value = 0.8;
    master.connect(ac.destination);
    // one second of white noise, reused for snare and hats
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    let x = 12345;
    for (let i = 0; i < d.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; d[i] = x / 0x3fffffff - 1; }
    return ac;
  }

  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function kick(t) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    env(g, t, 0.9, 0.004, 0.22);
    o.connect(g).connect(bus || master); o.start(t); o.stop(t + 0.3);
  }

  function noiseHit(t, peak, dur, hp) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise;
    f.type = 'highpass'; f.frequency.value = hp;
    env(g, t, peak, 0.002, dur);
    s.connect(f).connect(g).connect(bus || master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  function tone(t, freq, type, peak, dur, out = bus || master) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    env(g, t, peak, 0.01, dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }

  /** Schedule everything for beat n. */
  function scheduleBeat(n) {
    const s = spb(bpm);
    const t = t0 + n * s;
    if (n < COUNT_IN) {          // count-in: four woodblock clicks, the first one higher
      tone(t, n === 0 ? 1320 : 990, 'square', 0.12, 0.05);
      return;
    }
    const inBar = (n - COUNT_IN) % 4;
    const bar = Math.floor((n - COUNT_IN) / 4);
    const inSlot = (n - COUNT_IN) % BEATS_PER_SLOT;
    if (inBar === 0 || inBar === 2) kick(t);
    if (inBar === 1 || inBar === 3) noiseHit(t, 0.35, 0.16, 1800);
    noiseHit(t, 0.08, 0.04, 7000);
    noiseHit(t + s / 2, 0.06, 0.035, 7000);
    if (inBar === 0 || inBar === 2) tone(t, midiHz(BASS[bar % 4]), 'triangle', 0.35, s * 1.7);
    // a soft rising cue on the beat before the star, so the ear knows it is coming
    if (inSlot === STAR_BEAT - 1) tone(t + s / 2, 880, 'sine', 0.05, 0.08);
  }

  /** Fade out and drop the current song bus (and every note queued on it). */
  function dropBus() {
    if (!bus || !ac) { bus = null; return; }
    const old = bus, now = ac.currentTime;
    old.gain.cancelScheduledValues(now);
    old.gain.setValueAtTime(old.gain.value, now);
    old.gain.linearRampToValueAtTime(0, now + 0.08);
    setTimeout(() => { try { old.disconnect(); } catch { /* closed */ } }, 200);
    bus = null;
  }

  function newBus() {
    dropBus();
    bus = ac.createGain();
    bus.gain.value = 1;
    bus.connect(master);
  }

  return {
    get ready() { return !!ac; },
    get running() { return running; },
    /** Create or resume the context. Call from a click or key handler. */
    unlock() {
      const a = ensure();
      if (a && a.state === 'suspended') a.resume();
      return !!a;
    },
    /** Start a song: beat 0 sounds `lead` seconds from now. */
    start(tempo, lead = 0.35) {
      if (!ensure()) return false;
      if (ac.state === 'suspended') ac.resume();
      bpm = tempo;
      t0 = ac.currentTime + lead;
      next = 0;
      running = true;
      newBus();
      return true;
    },
    /** Calibration: n plain clicks, beat 0 sounding `lead` seconds from now. */
    clicks(tempo, n, lead = 0.6) {
      if (!ensure()) return false;
      if (ac.state === 'suspended') ac.resume();
      bpm = tempo;
      t0 = ac.currentTime + lead;
      running = false;
      newBus();
      const s = spb(bpm);
      for (let i = 0; i < n; i++) tone(t0 + i * s, i < 4 ? 990 : 1320, 'square', 0.12, 0.05);
      return true;
    },
    /** Schedule all beats that start before song time `until`. Call every frame. */
    schedule(until) {
      if (!running) return;
      const s = spb(bpm);
      while (next * s < until) { scheduleBeat(next); next++; }
    },
    /** Song time now as scheduled (what the audio clock is producing). */
    songNow() { return ac ? ac.currentTime - t0 : 0; },
    /**
     * Song time the listener is hearing now, corrected for output latency.
     * Uses getOutputTimestamp when the browser gives a usable one.
     */
    heardNow(perfNow) {
      if (!ac) return 0;
      const ts = ac.getOutputTimestamp ? ac.getOutputTimestamp() : null;
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        tsCache = ts;
        return ts.contextTime + (perfNow - ts.performanceTime) / 1000 - t0;
      }
      return ac.currentTime - (ac.outputLatency || ac.baseLatency || 0) - t0;
    },
    /** Song time (as heard) at the moment of an input event, from event.timeStamp. */
    heardAt(eventTimeStamp, perfNow) {
      return this.heardNow(perfNow) - (perfNow - eventTimeStamp) / 1000;
    },
    /** Short feedback sounds, played right away. */
    feedback(kind) {
      if (!ac || muted) return;
      const t = ac.currentTime + 0.005;
      if (kind === 'right') { tone(t, 784, 'triangle', 0.25, 0.12, master); tone(t + 0.08, 1175, 'triangle', 0.2, 0.18, master); }
      else if (kind === 'tap') tone(t, 660, 'sine', 0.15, 0.06, master);
      else tone(t, 220, 'triangle', 0.25, 0.22, master);
    },
    /** Silence without stopping the clock (sound turned off mid-song). */
    setMuted(m) {
      muted = !!m;
      if (ac && master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ac.currentTime, 0.02);
    },
    /** Stop the song: fade out, stop scheduling. Notes already queued fade with it. */
    stop() {
      running = false;
      dropBus();
    },
    close() {
      running = false;
      if (ac) { try { ac.close(); } catch { /* already closed */ } }
      ac = null; master = null; noise = null; bus = null; tsCache = null;
    },
  };
}
