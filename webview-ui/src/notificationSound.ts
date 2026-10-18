import {
  BELL_ATTACK_SEC,
  BELL_LOWPASS_HZ,
  BELL_OVERTONE_GAIN,
  NOTIFICATION_MIN_GAP_MS,
  NOTIFICATION_NOTE_1_HZ,
  NOTIFICATION_NOTE_1_START_SEC,
  NOTIFICATION_NOTE_2_HZ,
  NOTIFICATION_NOTE_2_START_SEC,
  NOTIFICATION_NOTE_DURATION_SEC,
  NOTIFICATION_VOLUME,
  PERMISSION_MIN_GAP_MS,
  PERMISSION_NOTE_1_HZ,
  PERMISSION_NOTE_1_START_SEC,
  PERMISSION_NOTE_2_HZ,
  PERMISSION_NOTE_2_START_SEC,
  PERMISSION_NOTE_DURATION_SEC,
  PERMISSION_VOLUME,
} from './constants.js';
import { isE2E } from './runtime.js';

let soundEnabled = true;
/** The viewer's own mute (e.g. the 3D hall's Sound button); the server setting can't override it. */
let userMuted = false;
let audioCtx: AudioContext | null = null;
let lastDoneAt = -Infinity;
let lastPermissionAt = -Infinity;

/** E2E test hook: append every (attempted) sound invocation to a window-side log
 *  under window.__pixelAgentsTestHooks.playedSounds (namespace and type
 *  declared by testHooks.ts). Records BEFORE the soundEnabled gate so tests
 *  verify dispatch independent of user audio prefs. Gated on the e2e harness
 *  flag so this unbounded log never grows in a real session. */
function recordSoundForTests(kind: 'done' | 'permission'): void {
  if (!isE2E || typeof window === 'undefined') return;
  if (!window.__pixelAgentsTestHooks) window.__pixelAgentsTestHooks = {};
  if (!window.__pixelAgentsTestHooks.playedSounds) {
    window.__pixelAgentsTestHooks.playedSounds = [];
  }
  window.__pixelAgentsTestHooks.playedSounds.push({ kind, at: Date.now() });
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

export function setUserMuted(muted: boolean): void {
  userMuted = muted;
}

function playNote(
  ctx: AudioContext,
  freq: number,
  startOffset: number,
  duration: number = NOTIFICATION_NOTE_DURATION_SEC,
  volume: number = NOTIFICATION_VOLUME,
): void {
  const t = ctx.currentTime + startOffset;
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(BELL_LOWPASS_HZ, t);

  // Soft bell: no click at the start, a long gentle decay.
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(volume, t + BELL_ATTACK_SEC);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  gain.connect(filter);
  filter.connect(ctx.destination);

  for (const [mult, level] of [
    [1, 1],
    [2, BELL_OVERTONE_GAIN],
  ] as const) {
    const osc = ctx.createOscillator();
    const partial = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * mult, t);
    partial.gain.setValueAtTime(level, t);
    osc.connect(partial);
    partial.connect(gain);
    osc.start(t);
    osc.stop(t + duration);
  }
}

export async function playDoneSound(): Promise<void> {
  recordSoundForTests('done');
  if (!soundEnabled || userMuted) return;
  const now = Date.now();
  if (now - lastDoneAt < NOTIFICATION_MIN_GAP_MS) return;
  lastDoneAt = now;
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    // Resume suspended context (webviews suspend until user gesture)
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    // One soft low bell (G4)
    playNote(audioCtx, NOTIFICATION_NOTE_1_HZ, NOTIFICATION_NOTE_1_START_SEC);
    if (NOTIFICATION_NOTE_2_HZ > 0) {
      playNote(audioCtx, NOTIFICATION_NOTE_2_HZ, NOTIFICATION_NOTE_2_START_SEC);
    }
  } catch {
    // Audio may not be available
  }
}

export async function playPermissionSound(): Promise<void> {
  recordSoundForTests('permission');
  if (!soundEnabled || userMuted) return;
  const now = Date.now();
  if (now - lastPermissionAt < PERMISSION_MIN_GAP_MS) return;
  lastPermissionAt = now;
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    // Two soft descending bells: D5 → A4
    playNote(
      audioCtx,
      PERMISSION_NOTE_1_HZ,
      PERMISSION_NOTE_1_START_SEC,
      PERMISSION_NOTE_DURATION_SEC,
      PERMISSION_VOLUME,
    );
    playNote(
      audioCtx,
      PERMISSION_NOTE_2_HZ,
      PERMISSION_NOTE_2_START_SEC,
      PERMISSION_NOTE_DURATION_SEC,
      PERMISSION_VOLUME,
    );
  } catch {
    // Audio may not be available
  }
}

/** Call from any user-gesture handler to ensure AudioContext is unlocked */
export function unlockAudio(): void {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch {
    // ignore
  }
}
