import { useEffect, useMemo, useRef, useState } from 'react';

import type { TransportState } from '../../../core/src/transport.js';
import type { OfficeState } from '../../../webview-ui/src/office/engine/officeState.js';
import { setUserMuted } from '../../../webview-ui/src/notificationSound.js';
import { KIND_COLORS, KIND_LABELS } from '../grammar/kindColors.js';
import type { ToolKind } from '../grammar/toolKind.js';
import { countCharacters } from '../grammar/visualState.js';
import type { MoodSetting } from '../world/mood.js';
import type { PersonaRoster } from '../worlds/personas.js';
import { approvalText, formatCounts } from '../worlds/personas.js';
import { transport } from '../transport/index.js';
import type { TransportMode } from '../transport/mode.js';
import { answersReadyText } from '../steer/steerStore.js';
import { demoHref, emptyHint } from './emptyState.js';

const LEGEND_KINDS = (Object.keys(KIND_LABELS) as ToolKind[]).filter((k) => k !== 'other');

const MOODS: { id: MoodSetting; label: string }[] = [
  { id: 'golden', label: 'Golden' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'auto', label: 'Auto' },
];

const KEY_STORAGE = 'diwan.hud.key';
const SOUND_STORAGE = 'diwan.hud.sound';

function loadSoundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_STORAGE) !== '0';
  } catch {
    return true;
  }
}

function saveSoundOn(on: boolean): void {
  try {
    localStorage.setItem(SOUND_STORAGE, on ? '1' : '0');
  } catch {
    /* storage unavailable: the toggle still works for this visit */
  }
}

function loadKeyOpen(): boolean {
  try {
    return localStorage.getItem(KEY_STORAGE) === '1';
  } catch {
    return false;
  }
}

function saveKeyOpen(open: boolean): void {
  try {
    localStorage.setItem(KEY_STORAGE, open ? '1' : '0');
  } catch {
    /* storage unavailable: the legend still works, it just forgets */
  }
}

export function Hud(props: {
  /** Registered worlds; the World control shows only with more than one. */
  worlds?: readonly { id: string; name: string }[];
  worldId?: string;
  onWorldChange?: (id: string) => void;
  mode: TransportMode;
  worldName: string;
  nouns: PersonaRoster['nouns'];
  getOfficeState: () => OfficeState;
  mood: MoodSetting;
  onMoodChange: (setting: MoodSetting) => void;
  director: boolean;
  onDirectorChange: (on: boolean) => void;
  /** Show the scholar whose approval has waited longest; each further click moves to the next. */
  onNeedsYou: () => void;
  /** Launched scholars whose answer has not been opened yet; the HUD counts them. */
  answersReady?: number;
  onAnswersReady?: () => void;
  /** Steer mode only: open the New scholar dialog. Absent = no button. */
  onNewScholar?: () => void;
}) {
  const { mood, onMoodChange } = props;
  const [connection, setConnection] = useState<TransportState>(transport.state);
  const [counts, setCounts] = useState({ agents: 0, subagents: 0, needsYou: 0 });
  const [keyOpen, setKeyOpen] = useState(loadKeyOpen);
  const [soundOn, setSoundOn] = useState(loadSoundOn);
  useEffect(() => setUserMuted(!soundOn), [soundOn]);
  const [emptyMs, setEmptyMs] = useState(0);
  const emptySince = useRef<number | null>(null);

  useEffect(() => {
    setConnection(transport.state); // the state may have moved between first render and now
    return transport.onStateChange(setConnection);
  }, []);
  useEffect(() => {
    emptySince.current = performance.now();
    const timer = setInterval(() => {
      const c = countCharacters(props.getOfficeState().getCharacters());
      setCounts(c);
      if (c.agents + c.subagents > 0) emptySince.current = null;
      else emptySince.current ??= performance.now();
      setEmptyMs(emptySince.current === null ? 0 : performance.now() - emptySince.current);
    }, 500);
    return () => clearInterval(timer);
  }, [props.getOfficeState]);

  const toggleSound = () => {
    setSoundOn((on) => {
      saveSoundOn(!on);
      return !on;
    });
  };
  const toggleKey = () => {
    setKeyOpen((open) => {
      saveKeyOpen(!open);
      return !open;
    });
  };
  const hint = emptyHint(
    props.mode,
    connection === 'connected',
    counts.agents + counts.subagents,
    emptyMs,
  );
  const demoLink = useMemo(() => demoHref(window.location.href), []);

  return (
    <div className="hud">
      <div className="hud-bar">
        <div className="hud-brand">
          Diwan <span>· J. Servo edition</span>
        </div>
        <div className="hud-where">
          {props.worlds && props.worlds.length > 1 && props.onWorldChange ? (
            // the world's name IS the switcher when there is more than one world
            <select
              className="hud-world"
              aria-label="World"
              title="Switch world (reloads the page)"
              value={props.worldId}
              onChange={(e) => props.onWorldChange?.(e.target.value)}
            >
              {props.worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          ) : (
            props.worldName
          )}
          <span className="hud-where-text">
            {' · '}
            {props.mode === 'demo' ? 'Demo' : `Live (${connection})`}
          </span>
        </div>
        <div className="hud-counts">
          {formatCounts({ ...counts, needsYou: 0 }, props.nouns)}
          {counts.needsYou > 0 && (
            <>
              {' \u00b7 '}
              <button
                type="button"
                className="hud-alert hud-needs"
                aria-label={`Show the next ${props.nouns.agent} who needs you`}
                onClick={props.onNeedsYou}
              >
                {approvalText(counts.needsYou)}
              </button>
            </>
          )}
          {(props.answersReady ?? 0) > 0 && (
            <>
              {' \u00b7 '}
              <button
                type="button"
                className="hud-answer"
                aria-label={`Show the next ${props.nouns.agent} whose answer is ready`}
                onClick={props.onAnswersReady}
              >
                {answersReadyText(props.answersReady ?? 0)}
              </button>
            </>
          )}
        </div>
        {props.onNewScholar && (
          <button type="button" className="hud-new" onClick={props.onNewScholar}>
            New {props.nouns.agent}
          </button>
        )}
        <div className="hud-mood" role="group" aria-label="Light">
          {MOODS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={mood === id}
              onClick={() => onMoodChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="hud-mood" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={props.director}
            title="The camera moves by itself to whoever needs you, delegates or finishes"
            onClick={() => props.onDirectorChange(!props.director)}
          >
            Auto camera
          </button>
          <button
            type="button"
            aria-pressed={keyOpen}
            aria-expanded={keyOpen}
            aria-controls="hud-legend"
            title="What the colour around each working bubble means"
            onClick={toggleKey}
          >
            Colours
          </button>
          <button
            type="button"
            aria-pressed={soundOn}
            title={`Soft bells when a ${props.nouns.agent} finishes or needs you`}
            onClick={toggleSound}
          >
            Sound
          </button>
        </div>
      </div>
      <div className="hud-drop">
        {keyOpen && (
          <ul className="hud-legend" id="hud-legend">
            {LEGEND_KINDS.map((kind) => (
              <li key={kind}>
                <i style={{ background: KIND_COLORS[kind] }} />
                {KIND_LABELS[kind]}
              </li>
            ))}
          </ul>
        )}
        {hint && (
          <div className="hud-empty" role="status">
            {hint === 'disconnected'
              ? 'No agents yet — the Diwan server is not running (start it with: diwan)'
              : 'No agents yet — start Claude Code'}{' '}
            · <a href={demoLink}>Watch the demo</a>
          </div>
        )}
      </div>
    </div>
  );
}
