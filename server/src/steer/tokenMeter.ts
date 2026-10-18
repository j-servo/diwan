/**
 * Token accounting for one launched session. A token here is anything processed:
 * input + cache creation + cache read + output, summed over every assistant message, sub-agent
 * (Task) messages included. One API message can arrive as several SDK messages that share its id,
 * each carrying usage that grows as the stream finishes, so each id is counted once, at the
 * largest figure seen. At a turn's result the SDK's own cumulative `modelUsage` (main loop,
 * sub-agents and internal calls such as compaction) replaces the running figure.
 */

interface UsageLike {
  input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens?: number | null;
}

interface ModelUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

const n = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;

export class TokenMeter {
  private sum = 0;
  private readonly perId = new Map<string, number>();
  private anonymous = 0;

  get total(): number {
    return this.sum;
  }

  /** An SDK assistant message. Returns the new total. */
  addAssistant(msg: {
    uuid?: string;
    message?: { id?: string; usage?: UsageLike | null };
  }): number {
    const u = msg.message?.usage;
    if (!u) return this.sum;
    const tokens =
      n(u.input_tokens) +
      n(u.cache_creation_input_tokens) +
      n(u.cache_read_input_tokens) +
      n(u.output_tokens);
    const id = msg.message?.id;
    if (!id) {
      // No id to dedupe on: count it as its own call.
      this.anonymous += tokens;
      this.sum += tokens;
      return this.sum;
    }
    const before = this.perId.get(id) ?? 0;
    if (tokens > before) {
      this.perId.set(id, tokens);
      this.sum += tokens - before;
    }
    return this.sum;
  }

  /** A result's cumulative per-model usage. Returns the new total. */
  reconcile(modelUsage: Record<string, ModelUsageLike> | undefined): number {
    if (!modelUsage) return this.sum;
    let total = 0;
    for (const m of Object.values(modelUsage)) {
      total +=
        n(m.inputTokens) +
        n(m.outputTokens) +
        n(m.cacheReadInputTokens) +
        n(m.cacheCreationInputTokens);
    }
    if (total > 0) this.sum = total;
    return this.sum;
  }
}
