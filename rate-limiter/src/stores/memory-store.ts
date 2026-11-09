import type { StateStore, StateTransition } from '#core/types.js';

export class MemoryStore implements StateStore {
  private readonly entries = new Map<string, unknown>();

  update<S, R>(key: string, transition: (prev: S | undefined) => StateTransition<S, R>): R {
    const { state, result } = transition(this.entries.get(key) as S | undefined);
    this.entries.set(key, state);
    return result;
  }
}
