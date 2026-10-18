import { useCallback, useEffect, useRef, useState } from 'react';

import { useExtensionMessages } from '../../webview-ui/src/hooks/useExtensionMessages.js';
import { OfficeState } from '../../webview-ui/src/office/engine/officeState.js';
import { PersonaStore } from './agents/personaStore.js';
import { useAgentLabels } from './agents/useAgentLabels.js';
import { MessageBoard } from './board/MessageBoard.tsx';
import { useMessageFeed } from './board/useMessageFeed.js';
import { installDebugHook } from './debug.js';
import type { AgentInfo } from './grammar/label.js';
import { agentTag, latestStatus, subagentTag } from './grammar/label.js';
import { Hud } from './hud/Hud.tsx';
import { NewScholarDialog } from './steer/NewScholarDialog.js';
import type { SteerView } from './steer/SteerCard.js';
import { steerSend, useSteer } from './steer/steer.js';
import type { SteerState } from './steer/steerStore.js';
import { answersReady, unseenAnswer } from './steer/steerStore.js';
import type { CardTarget } from './inspect/InspectCard.tsx';
import { InspectCard } from './inspect/InspectCard.tsx';
import { needsYouQueue, nextNeedsYou } from './inspect/inspectModel.js';
import { Peek } from './inspect/Peek.tsx';
import { useInspectModel } from './inspect/useInspectModel.js';
import { PromoOverlay } from './promo/PromoOverlay.tsx';
import { Scene } from './scene/Scene.tsx';
import { promoSegment, transportMode } from './transport/index.js';
import { resolveDirector } from './transport/mode.js';
import type { MoodSetting } from './world/mood.js';
import { loadMoodSetting, moodFromSearch, saveMoodSetting } from './world/mood.js';
import { activeWorld, switchWorld, switcherWorlds } from './worlds/registry.js';

const world = activeWorld();
const personas = new PersonaStore(world.personas);
const officeStateRef: { current: OfficeState | null } = { current: null };

function getOfficeState(): OfficeState {
  officeStateRef.current ??= new OfficeState(world.floorPlan);
  return officeStateRef.current;
}

installDebugHook(getOfficeState);

export default function App() {
  const [mood, setMood] = useState<MoodSetting>(
    () => moodFromSearch(window.location.search) ?? loadMoodSetting(),
  );
  const [director, setDirector] = useState(() =>
    resolveDirector(window.location.search, transportMode),
  );
  const changeMood = useCallback((setting: MoodSetting) => {
    setMood(setting);
    saveMoodSetting(setting);
  }, []);

  const { agentTools, subagentTools } = useExtensionMessages(getOfficeState);

  const feed = useMessageFeed(personas);
  const labels = useAgentLabels();
  const inspect = useInspectModel();
  const steer = useSteer();
  const [launching, setLaunching] = useState(false);
  // The answerSeq of each scholar's answer the user has looked at (opening its card counts).
  const [seen, setSeen] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<CardTarget | null>(null);
  // The camera lets go of a figure that has left; the card stays a few seconds to say so.
  const [focusLost, setFocusLost] = useState(false);

  const infoFor = useCallback(
    (id: number): AgentInfo => {
      const os = getOfficeState();
      const meta = os.subagentMeta.get(id);
      if (meta) {
        return {
          ...subagentTag(
            personas.apprenticeOf(meta.parentAgentId, meta.parentToolId),
            world.personas.nouns.subagent,
          ),
          status: latestStatus(subagentTools[meta.parentAgentId]?.[meta.parentToolId]),
        };
      }
      const folder = os.characters.get(id)?.folderName;
      const persona = personas.titleOf(id, folder);
      return {
        ...agentTag(persona.title, labels[id] ?? persona.folder),
        status: latestStatus(agentTools[id]),
        ...(unseenAnswer(steer.agents[id], seen[id]) ? { answerReady: true } : {}),
      };
    },
    [agentTools, subagentTools, labels, steer.agents, seen],
  );

  const select = useCallback((id: number) => {
    const os = getOfficeState();
    const meta = os.subagentMeta.get(id);
    const parentFolder = meta ? os.characters.get(meta.parentAgentId)?.folderName : undefined;
    setFocusLost(false);
    setSelected(
      meta
        ? {
            id,
            title: `${personas.apprenticeOf(meta.parentAgentId, meta.parentToolId)} \u00b7 ${world.personas.nouns.subagent}`,
            parent: {
              id: meta.parentAgentId,
              toolId: meta.parentToolId,
              title: personas.titleOf(meta.parentAgentId, parentFolder).title,
            },
          }
        : { id, title: personas.titleOf(id, os.characters.get(id)?.folderName).title },
    );
  }, []);
  const closeCard = useCallback(() => {
    setSelected(null);
    setFocusLost(false);
  }, []);
  const lostFocus = useCallback(() => setFocusLost(true), []);

  // Esc closes the card, releases the camera and hands the keyboard back to the canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      closeCard();
      const canvas = document.querySelector('canvas');
      if (canvas) {
        canvas.tabIndex = -1;
        canvas.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeCard]);

  // Opening a scholar's card is looking at its answer: the marker goes, the card keeps saying so.
  useEffect(() => {
    const id = selected && !selected.parent ? selected.id : null;
    const agent = id !== null ? steer.agents[id] : undefined;
    if (id !== null && agent?.turn === 'answered' && (seen[id] ?? 0) < agent.answerSeq) {
      setSeen((prev) => ({ ...prev, [id]: agent.answerSeq }));
    }
  }, [selected, steer.agents, seen]);
  const waitingAnswers = answersReady(steer.agents, seen);
  const showNextAnswer = useCallback(() => {
    if (waitingAnswers.length > 0) select(waitingAnswers[0]);
  }, [waitingAnswers, select]);

  // The HUD's "needs you": the scholar whose approval is oldest, then the next one on each click.
  const live = useRef({ inspect, selected });
  live.current = { inspect, selected };
  const showNextNeedsYou = useCallback(() => {
    const current = live.current.selected;
    const next = nextNeedsYou(
      needsYouQueue(live.current.inspect),
      current?.parent?.id ?? current?.id ?? null,
    );
    if (next !== null) select(next);
  }, [select]);

  const subFigureId = useCallback(
    (parentId: number, parentToolId: string) =>
      getOfficeState().getSubagentId(parentId, parentToolId),
    [],
  );
  const apprenticeName = useCallback(
    (parentId: number, parentToolId: string) =>
      `${personas.apprenticeOf(parentId, parentToolId)} \u00b7 ${world.personas.nouns.subagent}`,
    [],
  );

  return (
    <>
      <Scene
        getOfficeState={getOfficeState}
        world={world}
        infoFor={infoFor}
        feed={feed}
        mood={mood}
        director={director}
        focusId={selected && !focusLost ? selected.id : null}
        onSelect={select}
        onClear={closeCard}
        onFocusLost={lostFocus}
      />
      {promoSegment && <PromoOverlay segment={promoSegment} />}
      <Hud
        mode={transportMode}
        worldName={world.name}
        worlds={switcherWorlds(world)}
        worldId={world.id}
        onWorldChange={switchWorld}
        nouns={world.personas.nouns}
        getOfficeState={getOfficeState}
        mood={mood}
        onMoodChange={changeMood}
        director={director}
        onDirectorChange={setDirector}
        onNeedsYou={showNextNeedsYou}
        answersReady={waitingAnswers.length}
        onAnswersReady={showNextAnswer}
        onNewScholar={steer.control ? () => setLaunching(true) : undefined}
      />
      {launching && steer.control && (
        <NewScholarDialog
          steer={steer}
          onLaunch={({ ref, project, task, model, effort, tokenBudget }) =>
            steerSend({ type: 'steerLaunch', ref, project, task, model, effort, tokenBudget })
          }
          onClose={() => setLaunching(false)}
        />
      )}
      {selected ? (
        <InspectCard
          target={selected}
          state={inspect}
          onClose={closeCard}
          onOpen={select}
          apprenticeName={apprenticeName}
          subFigureId={subFigureId}
          steer={steerViewFor(selected, steer)}
        />
      ) : (
        <MessageBoard entries={feed} />
      )}
      <Peek infoFor={infoFor} />
    </>
  );
}

/** What the card may do for a scholar this hall launched; undefined for a terminal session. */
function steerViewFor(target: CardTarget, steer: SteerState): SteerView | undefined {
  const agent = steer.control && !target.parent ? steer.agents[target.id] : undefined;
  if (!agent) return undefined;
  const id = target.id;
  return {
    agent,
    asks: steer.asks[id] ?? [],
    replies: steer.replies[id] ?? [],
    notice:
      steer.notice && !steer.notice.ref && Date.now() - steer.notice.at < 20_000
        ? steer.notice.text
        : undefined,
    answer: (requestId, allow) => steerSend({ type: 'steerAnswer', requestId, allow }),
    followUp: (text) => steerSend({ type: 'steerFollowUp', id, text }),
    interrupt: () => steerSend({ type: 'steerInterrupt', id }),
    stop: () => steerSend({ type: 'steerStop', id }),
  };
}
