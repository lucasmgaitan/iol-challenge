import { slidingWindow, type SlidingWindowState } from '../algorithms/sliding-window.js';
import { tokenBucket, type TokenBucketState } from '../algorithms/token-bucket.js';
import { systemClock, type Clock } from '../core/clock.js';
import { assertValidRule } from '../core/rule.js';
import { Algorithm, type Decision, type RateLimiter, type Rule } from '../core/types.js';

type State = TokenBucketState | SlidingWindowState;

const STATE_KEY_SEPARATOR = ':';

export class MemoryStore implements RateLimiter {
  private readonly states = new Map<string, State>();

  constructor(private readonly clock: Clock = systemClock) {}

  consume(key: string, rule: Rule): Promise<Decision> {
    try {
      return Promise.resolve(this.consumeSync(key, rule));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private consumeSync(key: string, rule: Rule): Decision {
    assertValidRule(rule);
    const now = this.clock.now();
    const stateKey = `${rule.algorithm}${STATE_KEY_SEPARATOR}${key}`;

    const result =
      rule.algorithm === Algorithm.TokenBucket
        ? tokenBucket(this.states.get(stateKey) as TokenBucketState | undefined, rule, now)
        : slidingWindow(this.states.get(stateKey) as SlidingWindowState | undefined, rule, now);

    this.states.set(stateKey, result.state);
    return result.decision;
  }
}
