/**
 * The choices a "New scholar" launch offers, in ONE place: the server validates against them and
 * the dialog renders them. No Fable: the standing rule is no Fable agents.
 */

export interface ModelChoice {
  /** The exact model id, sent as the SDK `model`. */
  id: string;
  label: string;
}

export const MODEL_CHOICES: readonly ModelChoice[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
];
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const ALLOWED_MODELS: readonly string[] = MODEL_CHOICES.map((m) => m.id);

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface EffortChoice {
  id: EffortLevel;
  label: string;
}
export const EFFORT_CHOICES: readonly EffortChoice[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Max' },
];
export const DEFAULT_EFFORT: EffortLevel = 'high';
export const ALLOWED_EFFORTS: readonly string[] = EFFORT_CHOICES.map((e) => e.id);

export const TOKEN_BUDGET_MIN = 50_000;
export const TOKEN_BUDGET_MAX = 10_000_000;
export const TOKEN_BUDGET_DEFAULT = 500_000;

export function modelLabel(id: string): string {
  return MODEL_CHOICES.find((m) => m.id === id)?.label ?? id;
}

/** Lower-case wording for the card: "xhigh" reads "extra high". */
export function effortWord(id: string): string {
  return EFFORT_CHOICES.find((e) => e.id === id)?.label.toLowerCase() ?? id;
}

/** "500K", "1.5M" or plain digits (commas and spaces allowed) -> a whole number, or null. */
export function parseTokenBudget(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([km]?)$/i.exec(text.replace(/[,\s]/g, ''));
  if (!m) return null;
  const mult = m[2].toLowerCase() === 'm' ? 1_000_000 : m[2].toLowerCase() === 'k' ? 1_000 : 1;
  const n = Math.round(Number(m[1]) * mult);
  return Number.isFinite(n) ? n : null;
}

export function validTokenBudget(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isSafeInteger(n) &&
    n >= TOKEN_BUDGET_MIN &&
    n <= TOKEN_BUDGET_MAX
  );
}

/** 512,300 -> "512K", 1,500,000 -> "1.5M", 940 -> "940". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 10_000) / 100}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}
