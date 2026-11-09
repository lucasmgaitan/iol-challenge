import { RedisStore } from '@iol/rate-limiter';
import { RateLimitHeader, TOO_MANY_REQUESTS_STATUS } from '@iol/rate-limiter/fastify';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HELLO_RULE, HELLO_WINDOW_RULE } from '#controllers/hello-controller.js';
import { buildApp, Route } from '#http/app.js';
import { MetricName } from '#http/metrics.js';
import { CIRCUIT_FAILURE_THRESHOLD } from '#http/rate-limiter.js';
import { createRedisClient } from '#http/redis-client.js';

const REDIS_IMAGE = 'redis:7.4-alpine';
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;
const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:1';

describe(`GET ${Route.Hello} backed by Redis`, () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new RedisContainer(REDIS_IMAGE).start();
    redis = createRedisClient({ url: container.getConnectionUrl() });
    await redis.connect();
    app = await buildApp({ store: new RedisStore({ redis }) });
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

  it(`limits ${Route.HelloWindow} with its own sliding window`, async () => {
    const statuses: number[] = [];
    for (let request = 0; request <= HELLO_WINDOW_RULE.limit; request++) {
      const response = await app.inject({
        method: 'GET',
        url: Route.HelloWindow,
        remoteAddress: '198.51.100.1',
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, TOO_MANY_REQUESTS_STATUS]);
  });
});

describe(`GET ${Route.Hello} when Redis is unreachable`, () => {
  let redis: Redis;
  let app: FastifyInstance;

  beforeAll(async () => {
    redis = createRedisClient({ url: UNREACHABLE_REDIS_URL });
    redis.on('error', vi.fn());
    await expect(redis.connect()).rejects.toThrow();
    app = await buildApp({ store: new RedisStore({ redis }) });
  });

  afterAll(async () => {
    await app.close();
    redis.disconnect();
  });

  it('keeps serving requests and opens the circuit', async () => {
    for (let request = 0; request <= CIRCUIT_FAILURE_THRESHOLD; request++) {
      const response = await app.inject({ method: 'GET', url: Route.Hello });
      expect(response.statusCode).toBe(200);
      expect(response.headers[RateLimitHeader.Remaining]).toBeUndefined();
    }
    const metrics = (await app.inject({ method: 'GET', url: Route.Metrics })).body;
    expect(metrics).toContain(`${MetricName.CircuitOpen} 1`);
    expect(metrics).toContain(
      `${MetricName.StoreErrors}{rule="hello"} ${String(CIRCUIT_FAILURE_THRESHOLD + 1)}`,
    );
  });
});
