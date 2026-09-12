/**
 * Sound — Landing-Page-Specs §2.2 channel 5.
 *
 * ---------------------------------------------------------------------------
 * FOUR CUES, ZERO BYTES.
 *
 * §2.2 allows four sounds: scene arrival, consent stamp,
 * upload complete, CTA press. It also budgets the page at 2.5 MB on the best
 * tier and 450 KB on the worst, and §15 lists sound design as the first thing
 * to cut when money is short.
 *
 * All three pressures point the same way, so these are SYNTHESISED with
 * WebAudio oscillators rather than loaded as files. Four short cues as audio
 * assets is ~60–120 KB and four more requests; as ~40 lines of code it is
 * nothing, needs no licence, no sound designer, and no CDN origin the CSP
 * would have to permit.
 *
 * The palette is deliberately narrow: sine and triangle partials, short
 * envelopes, one soft filtered noise burst for the stamp. Nothing here is
 * musical. A radiology workstation does not play chords.
 * ---------------------------------------------------------------------------
 *
 * THE RULES, WHICH ARE NOT NEGOTIABLE (§2.2, §16):
 *
 *   - Muted by default. Always. §16 lists autoplaying sound as an instant
 *     abandonment, and on a shared clinic desktop it is genuinely embarrassing
 *     for the user.
 *   - One persistent toggle, state in localStorage.
 *   - The AudioContext is not even CREATED until the user turns sound on,
 *     which is a gesture, which is what browsers require anyway.
 *   - Off entirely under Tier C.
 */

export type Cue = 'scene' | 'stamp' | 'complete' | 'press';

const STORAGE_KEY = 'mir.site.sound';

let context: AudioContext | null = null;
let master: GainNode | null = null;

/** Has the user asked for sound? Defaults to no, and stays no on any error. */
export function soundEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    // A private window, or site data blocked. Silence is the safe answer.
    return false;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Preference not persisted. The toggle still works for this session.
  }
  if (!on) {
    void context?.suspend();
  } else {
    ensureContext();
    void context?.resume();
  }
}

interface WebkitWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

function ensureContext(): AudioContext | null {
  if (context !== null) return context;
  if (typeof window === 'undefined') return null;

  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (Ctor === undefined) return null;

  try {
    context = new Ctor();
    master = context.createGain();
    // Quiet. These are punctuation, not effects — the user is in a clinic.
    master.gain.value = 0.14;
    master.connect(context.destination);
    return context;
  } catch {
    return null;
  }
}

interface CueSpec {
  /** Partial frequencies in Hz. The first is the fundamental. */
  partials: number[];
  type: OscillatorType;
  /** Seconds. */
  attack: number;
  decay: number;
  gain: number;
  /** Semitone-ish downward sweep over the decay, as a frequency ratio. */
  bend?: number;
  /** A filtered noise transient layered underneath — the physical impact. */
  noise?: { gain: number; decay: number; cutoff: number };
}

/**
 * The four cues.
 */
const CUES: Record<Cue, CueSpec> = {
  scene: { partials: [420, 630], type: 'sine', attack: 0.006, decay: 0.34, gain: 0.5 },
  stamp: {
    partials: [140],
    type: 'triangle',
    attack: 0.001,
    decay: 0.16,
    gain: 0.9,
    bend: 0.6,
    noise: { gain: 0.5, decay: 0.09, cutoff: 1800 },
  },
  complete: { partials: [660, 990, 1320], type: 'sine', attack: 0.004, decay: 0.42, gain: 0.42 },
  press: { partials: [880], type: 'sine', attack: 0.001, decay: 0.06, gain: 0.3, bend: 0.85 },
};

/**
 * Play a cue, if and only if the user has asked for sound.
 *
 * Never throws and never blocks: on a browser with no WebAudio, a suspended
 * context, or a locked-down profile, this returns having done nothing. A
 * decorative channel may not be able to break the page.
 */
export function playCue(cue: Cue): void {
  if (!soundEnabled()) return;

  const ctx = ensureContext();
  if (ctx === null || master === null) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const spec = CUES[cue];
  const now = ctx.currentTime;
  const end = now + spec.attack + spec.decay;

  const bus = ctx.createGain();
  bus.gain.value = spec.gain;
  bus.connect(master);

  for (const [index, frequency] of spec.partials.entries()) {
    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(frequency, now);
    if (spec.bend !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(frequency * spec.bend, end);
    }

    const env = ctx.createGain();
    // Upper partials sit under the fundamental, or the cue reads as a chime.
    const level = 1 / (index + 1);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(level, now + spec.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(env);
    env.connect(bus);
    osc.start(now);
    osc.stop(end + 0.02);
  }

  if (spec.noise !== undefined) {
    playNoise(ctx, bus, spec.noise, now);
  }
}

/** The transient under the consent stamp: a sheet of paper meeting a lightbox. */
function playNoise(
  ctx: AudioContext,
  destination: AudioNode,
  spec: { gain: number; decay: number; cutoff: number },
  now: number,
): void {
  const frames = Math.floor(ctx.sampleRate * spec.decay);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Linear fade rather than exponential: a paper impact stops, it does not ring.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = spec.cutoff;

  const env = ctx.createGain();
  env.gain.value = spec.gain;

  source.connect(filter);
  filter.connect(env);
  env.connect(destination);
  source.start(now);
}

/** Release the audio hardware. Called when the page unmounts. */
export function closeSound(): void {
  void context?.close();
  context = null;
  master = null;
}
