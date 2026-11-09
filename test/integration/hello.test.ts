import { createRateLimiter, RedisStore } from '@iol/rate-limiter';
import { RateLimitHeader, TOO_MANY_REQUESTS_STATUS } from '@iol/rate-limiter/fastify';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HELLO_RULE } from '#controllers/hello-controller.js';
import { buildApp, Route } from '#http/app.js';

const REDIS_IMAGE = 'redis:7.4-alpine';
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;

describe(`GET ${Route.Hello} backed by Redis`, () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new RedisContainer(REDIS_IMAGE).start();
    redis = new Redis(container.getConnectionUrl());
    app = await buildApp({ limiter: createRateLimiter({ store: new RedisStore({ redis }) }) });
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await app.close();
    await redis.quit();
    await container.stop();
  });

  const hello = (remoteAddress: string) =>
    app.inject({ method: 'GET', url: Route.Hello, remoteAddress });

  it('allows a burst up to the rule capacity, then responds 429', async () => {
    const statuses: number[] = [];
    for (let request = 0; request <= HELLO_RULE.capacity; request++) {
      statuses.push((await hello('198.51.100.1')).statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, TOO_MANY_REQUESTS_STATUS]);
  });

  it('tells the rejected client when to retry', async () => {
    const response = await hello('198.51.100.1');
    expect(response.statusCode).toBe(TOO_MANY_REQUESTS_STATUS);
    expect(Number(response.headers[RateLimitHeader.RetryAfter])).toBeGreaterThan(0);
  });

  it('keeps a separate limit for each client', async () => {
    expect((await hello('198.51.100.2')).statusCode).toBe(200);
  });
});
