import type { Redis } from 'ioredis';
import { RateLimitContentionError } from '#core/errors.js';
import type { Decision, RateLimitRepository, StateTransition, StoredState } from '#core/types.js';
import { SerialQueue } from '#stores/serial-queue.js';

export const KEY_PREFIX = 'rate-limiter:';
const DEFAULT_MAX_ATTEMPTS = 10;
const MS_PER_SECOND = 1000;
const MICROSECONDS_PER_MS = 1000;
const KEY_HASH_MULTIPLIER = 31;
const TIME_REPLY_LENGTH = 2;

const RedisRepositoryErrorMessage = {
  noConnections: 'at least one redis connection is required',
  unexpectedReply: (reply: unknown) => `unexpected reply from redis: ${String(reply)}`,
} as const;

interface Lane {
  readonly redis: Redis;
  readonly queue: SerialQueue;
}

interface StoredRead {
  readonly stored: StoredState | undefined;
  readonly nowMs: number;
}

interface RedisRateLimitRepositoryOptions {
  readonly connections: readonly Redis[];
  readonly maxAttempts?: number;
}

export class RedisRateLimitRepository implements RateLimitRepository {
  private readonly lanes: readonly Lane[];
  private readonly maxAttempts: number;

  constructor({
    connections,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  }: RedisRateLimitRepositoryOptions) {
    if (connections.length === 0) throw new RangeError(RedisRepositoryErrorMessage.noConnections);
    this.lanes = connections.map((redis) => ({ redis, queue: new SerialQueue() }));
    this.maxAttempts = maxAttempts;
  }

  async update(key: string, ttlMs: number, transition: StateTransition): Promise<Decision> {
    const storeKey = KEY_PREFIX + key;
    const { redis, queue } = this.laneFor(storeKey);
    return await queue.run(async () => await this.transact(redis, storeKey, ttlMs, transition));
  }

  private laneFor(storeKey: string): Lane {
    let hash = 0;
    for (let index = 0; index < storeKey.length; index++) {
      hash = (hash * KEY_HASH_MULTIPLIER + storeKey.charCodeAt(index)) >>> 0;
    }
    return this.lanes[hash % this.lanes.length] as Lane;
  }

  private async transact(
    redis: Redis,
    storeKey: string,
    ttlMs: number,
    transition: StateTransition,
  ): Promise<Decision> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const { stored, nowMs } = await watchAndRead(redis, storeKey);
      const { decision, state } = transition(stored, nowMs);
      if (!state) {
        await redis.unwatch();
        return decision;
      }
      if (await commit(redis, storeKey, state, ttlMs)) return decision;
    }
    throw new RateLimitContentionError(storeKey);
  }
}

async function watchAndRead(redis: Redis, storeKey: string): Promise<StoredRead> {
  const replies = await redis.pipeline().watch(storeKey).time().hgetall(storeKey).exec();
  const [, time, hash] = resultsOf(replies);
  return { stored: toState(hash), nowMs: toMilliseconds(time) };
}

async function commit(
  redis: Redis,
  storeKey: string,
  state: StoredState,
  ttlMs: number,
): Promise<boolean> {
  const replies = await redis.multi().hset(storeKey, state).pexpire(storeKey, ttlMs).exec();
  if (replies === null) return false;
  resultsOf(replies);
  return true;
}

function resultsOf(replies: [Error | null, unknown][] | null): unknown[] {
  if (replies === null) throw new TypeError(RedisRepositoryErrorMessage.unexpectedReply(replies));
  return replies.map(([error, result]) => {
    if (error) throw error;
    return result;
  });
}

function toMilliseconds(time: unknown): number {
  if (!Array.isArray(time) || time.length !== TIME_REPLY_LENGTH) {
    throw new TypeError(RedisRepositoryErrorMessage.unexpectedReply(time));
  }
  const [seconds, microseconds] = time.map(Number) as [number, number];
  return seconds * MS_PER_SECOND + Math.floor(microseconds / MICROSECONDS_PER_MS);
}

function toState(hash: unknown): StoredState | undefined {
  if (typeof hash !== 'object' || hash === null) {
    throw new TypeError(RedisRepositoryErrorMessage.unexpectedReply(hash));
  }
  const fields = Object.entries(hash);
  if (fields.length === 0) return undefined;
  return Object.fromEntries(fields.map(([field, value]) => [field, Number(value)]));
}
