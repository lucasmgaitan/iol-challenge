import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Redis } from 'ioredis';
import {
  Algorithm,
  type Decision,
  type RateLimitStore,
  type Rule,
  type RuleByAlgorithm,
} from '#core/types.js';

export const DEFAULT_KEY_PREFIX = 'rate-limiter:';
const SCRIPT_DIRECTORY = new URL('./lua/', import.meta.url);
const SCRIPT_EXTENSION = '.lua';
const SCRIPT_ENCODING = 'utf8';
const SCRIPT_HASH_ALGORITHM = 'sha1';
const SCRIPT_HASH_ENCODING = 'hex';
const SCRIPT_KEY_COUNT = 1;
const NO_SCRIPT_ERROR_PREFIX = 'NOSCRIPT';
const DECISION_REPLY_LENGTH = 4;
const ALLOWED_REPLY = 1;

export const RedisStoreErrorMessage = {
  unexpectedReply: (reply: unknown) => `unexpected reply from rate limit script: ${String(reply)}`,
} as const;

interface LuaScript<R> {
  readonly source: string;
  readonly sha: string;
  args(rule: R): readonly number[];
}

function defineScript<R>(name: string, args: (rule: R) => readonly number[]): LuaScript<R> {
  const source = readFileSync(new URL(name + SCRIPT_EXTENSION, SCRIPT_DIRECTORY), SCRIPT_ENCODING);
  const sha = createHash(SCRIPT_HASH_ALGORITHM).update(source).digest(SCRIPT_HASH_ENCODING);
  return { source, sha, args };
}

const scripts: { readonly [A in Algorithm]: LuaScript<RuleByAlgorithm[A]> } = {
  [Algorithm.TokenBucket]: defineScript(Algorithm.TokenBucket, (rule) => [
    rule.capacity,
    rule.refillPerSecond,
  ]),
  [Algorithm.SlidingWindow]: defineScript(Algorithm.SlidingWindow, (rule) => [
    rule.limit,
    rule.windowMs,
  ]),
};

export interface RedisStoreOptions {
  readonly redis: Redis;
  readonly keyPrefix?: string;
}

export class RedisStore implements RateLimitStore {
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor({ redis, keyPrefix = DEFAULT_KEY_PREFIX }: RedisStoreOptions) {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  async consume(key: string, rule: Rule, ttlMs: number): Promise<Decision> {
    return await this.consumeWith(rule.algorithm, rule, key, ttlMs);
  }

  private async consumeWith<A extends Algorithm>(
    algorithm: A,
    rule: RuleByAlgorithm[A],
    key: string,
    ttlMs: number,
  ): Promise<Decision> {
    const script = scripts[algorithm];
    const reply = await this.run(script, this.keyPrefix + key, [...script.args(rule), ttlMs]);
    return toDecision(reply);
  }

  private async run<R>(
    script: LuaScript<R>,
    key: string,
    args: readonly number[],
  ): Promise<unknown> {
    try {
      return await this.redis.evalsha(script.sha, SCRIPT_KEY_COUNT, key, ...args);
    } catch (error) {
      if (!isNoScriptError(error)) throw error;
      return await this.redis.eval(script.source, SCRIPT_KEY_COUNT, key, ...args);
    }
  }
}

function isNoScriptError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(NO_SCRIPT_ERROR_PREFIX);
}

function toDecision(reply: unknown): Decision {
  if (
    !Array.isArray(reply) ||
    reply.length !== DECISION_REPLY_LENGTH ||
    !reply.every((value) => typeof value === 'number')
  ) {
    throw new TypeError(RedisStoreErrorMessage.unexpectedReply(reply));
  }
  const [allowed, limit, remaining, retryAfterMs] = reply as [number, number, number, number];
  return { allowed: allowed === ALLOWED_REPLY, limit, remaining, retryAfterMs, degraded: false };
}
