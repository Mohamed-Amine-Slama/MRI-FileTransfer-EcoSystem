'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { haptic } from '../../../lib/site/haptics';
import { useSite } from '../../../lib/site/site-provider';
import { FocalReveal } from '../motion/FocalReveal';
import { Plate } from '../primitives/Plate';

/**
 * Scene 04 — Upload that survives. Landing-Page-Specs §Scene 04.
 *
 * ---------------------------------------------------------------------------
 * THIS SCENE IS THE ARGUMENT.
 *
 * "The single strongest proof point you have. Your P7 phase is genuinely hard
 * engineering and nobody else in this corridor has it. Show it working, not
 * described."
 *
 * The doctor's specific fear is losing an hour of upload. So they are handed a
 * button labelled "Cut the connection" and invited to break it personally,
 * and it survives. §16 is emphatic that this must not sit behind a "book a
 * demo" form: the demo IS the argument, so it is given away.
 *
 * §11 names the metric that matters: "upload-demo interaction rate. If people
 * are not pressing 'Cut the connection', the scene has failed and the site's
 * core argument is not landing."
 * ---------------------------------------------------------------------------
 *
 * THE SIMULATION IS FAKE AND LOCAL. No network calls, no upload, no bytes
 * leaving the browser — §Scene 04 budgets ~14 KB of JS for exactly this. It is
 * an honest demonstration of a real behaviour, not a live one, and the copy
 * says so ("this simulation runs in your browser").
 */

const TOTAL_FILES = 312;
/** Files per tick. 120 ms per tick puts a full upload at about 12 seconds. */
const TICK_MS = 120;
const FILES_PER_TICK = 3;
/** Seconds of "reconnecting" before it resumes on its own. */
const RETRY_SECONDS = 5;

type Phase = 'idle' | 'uploading' | 'interrupted' | 'complete';

interface LogLine {
  id: number;
  text: string;
  tone: 'ash' | 'sand' | 'phosphor';
}

interface State {
  phase: Phase;
  files: number;
  /** MB/s, for the readout. Zero whenever the connection is cut. */
  rate: number;
  retryIn: number;
  log: LogLine[];
  /** Where the last interruption happened, so "resumed at" is a real number. */
  resumedAt: number | null;
  nextLogId: number;
}

type Action =
  | { type: 'start' }
  | { type: 'tick' }
  | { type: 'cut'; message: string }
  | { type: 'countdown' }
  | { type: 'resume'; message: (chunk: number) => string }
  | { type: 'complete'; message: string }
  | { type: 'reset' };

const INITIAL: State = {
  phase: 'idle',
  files: 0,
  rate: 0,
  retryIn: 0,
  log: [],
  resumedAt: null,
  nextLogId: 1,
};

function log(state: State, text: string, tone: LogLine['tone']): Pick<State, 'log' | 'nextLogId'> {
  return {
    // Newest last, and capped: an unbounded log in a scene someone might poke
    // at for a minute is a slow leak on the device least able to afford one.
    log: [...state.log, { id: state.nextLogId, text, tone }].slice(-6),
    nextLogId: state.nextLogId + 1,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start':
      return { ...state, phase: 'uploading', rate: 2.4 };

    case 'tick': {
      const files = Math.min(TOTAL_FILES, state.files + FILES_PER_TICK);
      return {
        ...state,
        files,
        // A little variance, so the readout reads as a measurement rather than
        // as a constant someone typed in.
        rate: 2.1 + ((files * 7919) % 60) / 100,
      };
    }

    case 'cut':
      return {
        ...state,
        phase: 'interrupted',
        rate: 0,
        retryIn: RETRY_SECONDS,
        resumedAt: state.files,
        ...log(state, action.message, 'sand'),
      };

    case 'countdown':
      return { ...state, retryIn: Math.max(0, state.retryIn - 1) };

    case 'resume':
      return {
        ...state,
        phase: 'uploading',
        rate: 2.4,
        retryIn: 0,
        ...log(state, action.message(state.resumedAt ?? state.files), 'phosphor'),
      };

    case 'complete':
      return {
        ...state,
        phase: 'complete',
        files: TOTAL_FILES,
        rate: 0,
        ...log(state, action.message, 'phosphor'),
      };

    case 'reset':
      return { ...INITIAL };
  }
}

export function S04UploadDemo(): React.JSX.Element {
  const { t, budget } = useSite();

  return (
    <section id="upload" className="scene" aria-labelledby="upload-title">
      <div className="shell">
        <FocalReveal plane={1}>
          <p className="eyebrow">{t.uploadEyebrow}</p>
          <h2 id="upload-title" className="display t-h1 measure">
            {t.uploadTitle}
          </h2>
          <p className="t-body-l ash measure upload-body">{t.uploadBody}</p>
        </FocalReveal>

        <FocalReveal plane={2}>
          {budget.interactiveDemo ? <InteractiveDemo /> : <StaticStates />}
        </FocalReveal>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The interactive simulation — Tiers A and B
// ---------------------------------------------------------------------------

function InteractiveDemo(): React.JSX.Element {
  const { t, budget, cue } = useSite();
  const [state, dispatch] = useReducer(reducer, INITIAL);

  /*
   * "Resumed at chunk 142 · 0 bytes re-sent" — §Scene 04's payoff line, and
   * the number in it is the real one: the file count at the moment the
   * connection was cut, carried through the interruption in `resumedAt`.
   * A hardcoded 142 would be a claim rather than a demonstration.
   */
  const resumedLine = useCallback(
    (chunk: number) => `${t.uploadResumedLine} · chunk ${chunk} · 0 B re-sent`,
    [t.uploadResumedLine],
  );

  /*
   * The upload starts when the scene is first seen rather than on load.
   * A progress bar that finished while the reader was four scenes away has
   * demonstrated nothing — the whole point is that they watch it.
   *
   * ---------------------------------------------------------------------------
   * THE RECT CHECK IS NOT REDUNDANT WITH THE OBSERVER.
   *
   * An IntersectionObserver reports the FIRST time it is notified, and while
   * the scene is still skipped by `content-visibility: auto` its subtree has
   * no box to intersect with. Someone who arrives at `#upload` directly — from
   * the nav, from a shared link, or from a keyboard tab that scrolled the
   * button into view before hydration finished — can therefore end up with the
   * scene on screen, the observer attached, and no notification ever arriving,
   * because nothing moves afterwards.
   *
   * The symptom is a dead button labelled "Cut the connection" on the one
   * scene that is the site's entire argument. So the element's own rectangle
   * is checked once at mount as well, and whichever answers first wins.
   * ---------------------------------------------------------------------------
   */
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = rootRef.current;
    if (element === null) return;

    const onScreen = (): boolean => {
      const rect = element.getBoundingClientRect();
      if (rect.height === 0) return false;
      return rect.top < window.innerHeight && rect.bottom > 0;
    };

    if (onScreen()) {
      dispatch({ type: 'start' });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          dispatch({ type: 'start' });
          observer.disconnect();
        }
      },
      // A third of the plate, so the reader has actually arrived rather than
      // caught its top edge on the way past.
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The upload itself.
  useEffect(() => {
    if (state.phase !== 'uploading') return;

    const id = window.setInterval(() => {
      dispatch({ type: 'tick' });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [state.phase]);

  // Completion is derived from the counter rather than scheduled, so it cannot
  // fire while the connection is cut.
  useEffect(() => {
    if (state.phase !== 'uploading' || state.files < TOTAL_FILES) return;
    dispatch({ type: 'complete', message: t.uploadCompleteLine });
    cue('complete');
    /*
     * One of the two haptic moments on the entire page (§2.2 channel 6). The
     * other is the consent stamp. Nothing else vibrates, ever.
     */
    haptic('upload-complete', budget.expressive);
  }, [state.phase, state.files, t.uploadCompleteLine, cue, budget.expressive]);

  // The retry countdown, and the automatic resume at zero.
  useEffect(() => {
    if (state.phase !== 'interrupted') return;

    const id = window.setInterval(() => dispatch({ type: 'countdown' }), 1000);
    return () => window.clearInterval(id);
  }, [state.phase]);

  // Countdown expired: the connection comes back on its own, which is what
  // actually happens on a clinic link and is the behaviour worth showing.
  useEffect(() => {
    if (state.phase !== 'interrupted' || state.retryIn > 0) return;
    dispatch({ type: 'resume', message: resumedLine });
    cue('scene');
  }, [state.phase, state.retryIn, resumedLine, cue]);

  const cut = (): void => {
    cue('press');
    dispatch({ type: 'cut', message: t.uploadAnnounceInterrupted });
  };

  const restore = (): void => {
    cue('press');
    dispatch({ type: 'resume', message: resumedLine });
  };

  const percent = Math.round((state.files / TOTAL_FILES) * 100);

  return (
    <div ref={rootRef}>
      <Plate label="UPLOAD · RESUMABLE · SIMULATION" counter={`${state.files} / ${TOTAL_FILES}`}>
        <div className="upload-head">
          <span className={`mono ${state.phase === 'interrupted' ? 'sand' : 'phosphor'}`}>
            {
              {
                idle: t.uploadStateIdle,
                uploading: t.uploadStateUploading,
                interrupted: t.uploadStateInterrupted,
                complete: t.uploadStateComplete,
              }[state.phase]
            }
          </span>
          <span className="mono dim">
            {t.uploadRateLabel} {state.rate.toFixed(1)} MB/s
          </span>
        </div>

        {/*
          A real `progressbar` role with real values. §9 requires the demo to be
          operable and legible without sight, and a div with a width style is
          a picture of a progress bar rather than one.
        */}
        <div
          className="upload-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={TOTAL_FILES}
          aria-valuenow={state.files}
          aria-valuetext={`${state.files} / ${TOTAL_FILES}`}
          data-phase={state.phase}
        >
          <span className="upload-bar-fill" style={{ inlineSize: `${percent}%` }} />
        </div>

        <div className="upload-controls">
          {state.phase === 'complete' ? (
            <button type="button" className="btn btn--ghost" onClick={() => dispatch({ type: 'reset' })}>
              {t.uploadRestart}
            </button>
          ) : state.phase === 'interrupted' ? (
            <>
              <button type="button" className="btn btn--primary" onClick={restore}>
                {t.uploadRestore}
              </button>
              <span className="mono sand">
                {t.uploadRetryIn} {state.retryIn}
                {t.uploadSeconds}
              </span>
            </>
          ) : (
            /*
              A real <button>, not a styled div — §9. It is the single most
              important control on the page and it has to be reachable by tab,
              operable by space and enter, and announced as a button.
            */
            <button
              type="button"
              className="btn btn--ghost upload-cut"
              onClick={cut}
              disabled={state.phase === 'idle'}
              data-testid="upload-cut"
            >
              {t.uploadCut}
            </button>
          )}
        </div>

        <div className="upload-log mono">
          {state.log.map((line) => (
            <p key={line.id} className={line.tone}>
              {line.text}
            </p>
          ))}
        </div>

        {/*
          The announcements. `polite` so it waits for a pause rather than
          interrupting, and it carries the STATE CHANGE in a sentence — "the
          upload resumed at the same point with nothing re-sent" — because the
          progress bar's own value says nothing about the argument being made.
        */}
        <p className="sr-only" role="status" aria-live="polite">
          {state.phase === 'interrupted' && t.uploadAnnounceInterrupted}
          {state.phase === 'uploading' && state.resumedAt !== null && t.uploadAnnounceResumed}
          {state.phase === 'complete' && t.uploadAnnounceComplete}
        </p>
      </Plate>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier C — three static states, side by side (§Scene 04 fallback)
// ---------------------------------------------------------------------------

/**
 * The same argument, made as a diagram instead of a demonstration.
 *
 * §Scene 04's fallback offers a 180 KB muted video loop for Tier B and three
 * static states for Tier C. The interactive demo already runs on Tier B — it
 * is ~2 KB of state machine, not cinema — so the video would be 180 KB spent
 * to replace something cheaper that already works. Tier C, which is where
 * reduced-motion and save-data land, gets the three states, and they are live
 * text rather than a picture of text.
 */
function StaticStates(): React.JSX.Element {
  const { t } = useSite();

  const states = [
    { label: t.uploadStateUploading, files: 142, tone: 'phosphor', width: 45 },
    { label: t.uploadStateInterrupted, files: 142, tone: 'sand', width: 45 },
    { label: t.uploadStateComplete, files: TOTAL_FILES, tone: 'phosphor', width: 100 },
  ] as const;

  return (
    <div className="upload-static">
      {states.map((state) => (
        <Plate key={state.label} label="UPLOAD" counter={`${state.files} / ${TOTAL_FILES}`}>
          <p className={`mono ${state.tone}`}>{state.label}</p>
          <div className="upload-bar" aria-hidden="true">
            <span className="upload-bar-fill" style={{ inlineSize: `${state.width}%` }} />
          </div>
        </Plate>
      ))}
      <p className="mono ash upload-static-note">{t.uploadResumedLine}</p>
    </div>
  );
}
