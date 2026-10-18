import type { ServerMessage } from '../../../core/src/messages.js';
import type { PersonaRoster } from '../worlds/personas.js';
import { assignPersona } from '../worlds/personas.js';

export interface AgentPersona {
  title: string;
  /** Project folder, when the server reported one. */
  folder?: string;
}

/** An immutable look at the cast, safe to hand to a pure reducer. */
export interface PersonaView {
  nouns: PersonaRoster['nouns'];
  agent: (id: number) => AgentPersona;
  apprentice: (parentId: number, parentToolId: string) => string;
}

const apprenticeKey = (parentId: number, parentToolId: string) => `${parentId}:${parentToolId}`;

/**
 * Who is who, for one world. Titles are held while an agent is open and given back when it
 * closes; apprentices likewise between their first message and subagentClear. Everything that
 * shows a name (tags, board, HUD) reads from here, so no fallback names exist elsewhere.
 */
export class PersonaStore {
  private agents = new Map<number, AgentPersona>();
  private apprentices = new Map<string, string>();
  /** Closed agents and cleared apprentices: a late message or a despawn re-render must not re-add them. */
  private closed = new Set<number>();
  private cleared = new Set<string>();

  private roster: PersonaRoster;

  constructor(roster: PersonaRoster) {
    this.roster = roster;
  }

  /** An id is (re)announced: its apprentice keys are live again, so lift their tombstones. */
  private reopen(id: number) {
    this.closed.delete(id);
    for (const key of [...this.cleared]) if (key.startsWith(`${id}:`)) this.cleared.delete(key);
  }

  private pickTitle(id: number, folder: string | undefined, agents: Map<number, AgentPersona>) {
    const taken = new Set([...agents.values()].map((a) => a.title));
    return assignPersona(folder ?? String(id), taken, this.roster.titles);
  }

  private pickApprentice(key: string, apprentices: Map<string, string>) {
    return assignPersona(key, new Set(apprentices.values()), this.roster.apprentices);
  }

  /** Assigns (message handling only). A tombstoned id yields a transient pick, never an insert. */
  private assignAgent(id: number, folder?: string): AgentPersona {
    const known = this.agents.get(id);
    if (known) {
      if (folder && !known.folder) known.folder = folder;
      return known;
    }
    const title = this.pickTitle(id, folder, this.agents);
    const persona: AgentPersona = folder ? { title, folder } : { title };
    if (!this.closed.has(id)) this.agents.set(id, persona);
    return persona;
  }

  private assignApprentice(parentId: number, parentToolId: string): string {
    const key = apprenticeKey(parentId, parentToolId);
    const known = this.apprentices.get(key);
    if (known) return known;
    const name = this.pickApprentice(key, this.apprentices);
    if (!this.cleared.has(key) && !this.closed.has(parentId)) this.apprentices.set(key, name);
    return name;
  }

  /** Read-only: the held persona, or a transient pick that is not stored (safe at render time). */
  agent(id: number, folder?: string): AgentPersona {
    const known = this.agents.get(id);
    if (known) return folder && !known.folder ? { ...known, folder } : known;
    const title = this.pickTitle(id, folder, this.agents);
    return folder ? { title, folder } : { title };
  }

  /** Read-only, like agent(). */
  apprentice(parentId: number, parentToolId: string): string {
    const key = apprenticeKey(parentId, parentToolId);
    return this.apprentices.get(key) ?? this.pickApprentice(key, this.apprentices);
  }

  titleOf(id: number, folder?: string): AgentPersona {
    return this.agent(id, folder);
  }

  apprenticeOf(parentId: number, parentToolId: string): string {
    return this.apprentice(parentId, parentToolId);
  }

  view(): PersonaView {
    const agents = new Map([...this.agents].map(([id, p]) => [id, { ...p }]));
    const apprentices = new Map(this.apprentices);
    return {
      nouns: this.roster.nouns,
      agent: (id) => agents.get(id) ?? { title: this.pickTitle(id, undefined, agents) },
      apprentice: (parentId, toolId) => {
        const key = apprenticeKey(parentId, toolId);
        return apprentices.get(key) ?? this.pickApprentice(key, apprentices);
      },
    };
  }

  /**
   * Feed one server message through. Returns the view the message should be described with:
   * after assignment, but for a closing agent or a returning apprentice, before the release.
   */
  handle(msg: ServerMessage): PersonaView {
    switch (msg.type) {
      case 'existingAgents':
        for (const id of msg.agents) {
          this.reopen(id);
          this.assignAgent(id, msg.folderNames[String(id)]);
        }
        break;
      case 'agentCreated':
        this.reopen(msg.id);
        this.assignAgent(msg.id, msg.folderName);
        break;
      case 'subagentToolStart':
      case 'subagentToolPermission':
        this.assignAgent(msg.id);
        this.assignApprentice(msg.id, msg.parentToolId);
        break;
      case 'subagentClear': {
        const view = this.view();
        const key = apprenticeKey(msg.id, msg.parentToolId);
        this.apprentices.delete(key);
        this.cleared.add(key);
        return view;
      }
      case 'agentClosed': {
        const view = this.view();
        this.agents.delete(msg.id);
        this.closed.add(msg.id);
        for (const key of [...this.apprentices.keys()]) {
          if (key.startsWith(`${msg.id}:`)) {
            this.apprentices.delete(key);
            this.cleared.add(key);
          }
        }
        return view;
      }
      default:
        break;
    }
    return this.view();
  }
}
