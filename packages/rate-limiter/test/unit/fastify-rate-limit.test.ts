import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { RateLimiterUnavailableError } from '#core/errors.js';
import { Algorithm, type Decision, type RateLimiter, type Rule } from '#core/types.js';
import { rateLimiterPlugin } from '#fastify/plugin.js';
import {
  RateLimit,
  RateLimitErrorMessage,
  RateLimitHeader,
  SERVICE_UNAVAILABLE_STATUS,
  TOO_MANY_REQUESTS_STATUS,
  type RouteResult,
} from '#fastify/rate-limit.js';

const rule: Rule = {
  name: 'hello',
  algorithm: Algorithm.TokenBucket,
  capacity: 5,
  refillPerSecond: 1,
};
const allowed: Decision = {
  allowed: true,
  limit: 5,
  remaining: 4,
  retryAfterMs: 0,
  degraded: false,
};
const denied: Decision = {
  allowed: false,
  limit: 5,
  remaining: 0,
  retryAfterMs: 1500,
  degraded: false,
};

class HelloController {
  readonly greeting = 'hello';

  @RateLimit(rule)
  byIp(_request: FastifyRequest, reply: FastifyReply): RouteResult {
    return reply.send({ message: this.greeting });
  }

  @RateLimit(rule, { identify: (request) => String(request.headers['x-api-key']) })
  byApiKey(_request: FastifyRequest, reply: FastifyReply): RouteResult {
    return reply.send({ message: this.greeting });
  }
}

function appWith(decision: Decision, register = true) {
  return appWithLimiter(vi.fn<RateLimiter['consume']>().mockResolvedValue(decision), register);
}

function appWithLimiter(consume: RateLimiter['consume'], register = true) {
  const app = Fastify();
  if (register) void app.register(rateLimiterPlugin, { limiter: { consume } });
  const controller = new HelloController();
  app.get('/by-ip', controller.byIp.bind(controller));
  app.get('/by-api-key', controller.byApiKey.bind(controller));
  return { app, consume };
}

describe('@RateLimit', () => {
  it('runs the handler and sets rate limit headers when allowed', async () => {
    const { app } = appWith(allowed);
    const response = await app.inject({ method: 'GET', url: '/by-ip' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'hello' });
    expect(response.headers[RateLimitHeader.Limit]).toBe('5');
    expect(response.headers[RateLimitHeader.Remaining]).toBe('4');
    expect(response.headers[RateLimitHeader.RetryAfter]).toBeUndefined();
  });

  it('responds 429 with Retry-After in seconds and skips the handler when denied', async () => {
    const { app } = appWith(denied);
    const response = await app.inject({ method: 'GET', url: '/by-ip' });
    expect(response.statusCode).toBe(TOO_MANY_REQUESTS_STATUS);
    expect(response.json()).toEqual({ error: RateLimitErrorMessage.tooManyRequests });
    expect(response.headers[RateLimitHeader.Remaining]).toBe('0');
    expect(response.headers[RateLimitHeader.RetryAfter]).toBe('2');
  });

  it('identifies the client by IP by default', async () => {
    const { app, consume } = appWith(allowed);
    await app.inject({ method: 'GET', url: '/by-ip', remoteAddress: '203.0.113.7' });
    expect(consume).toHaveBeenCalledWith('203.0.113.7', rule);
  });

  it('identifies the client with a custom function', async () => {
    const { app, consume } = appWith(allowed);
    await app.inject({ method: 'GET', url: '/by-api-key', headers: { 'x-api-key': 'key-1' } });
    expect(consume).toHaveBeenCalledWith('key-1', rule);
  });

  it('fails with a clear error when the plugin is not registered', async () => {
    const { app } = appWith(allowed, false);
    const response = await app.inject({ method: 'GET', url: '/by-ip' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ message: RateLimitErrorMessage.pluginNotRegistered });
  });

  it('runs the handler without rate limit headers when the decision is degraded', async () => {
    const { app } = appWith({ ...allowed, degraded: true });
    const response = await app.inject({ method: 'GET', url: '/by-ip' });
    expect(response.statusCode).toBe(200);
    expect(response.headers[RateLimitHeader.Limit]).toBeUndefined();
    expect(response.headers[RateLimitHeader.Remaining]).toBeUndefined();
  });

  it('responds 503 when the rate limiter is unavailable', async () => {
    const consume = vi
      .fn<RateLimiter['consume']>()
      .mockRejectedValue(new RateLimiterUnavailableError(new Error('down')));
    const { app } = appWithLimiter(consume);
    const response = await app.inject({ method: 'GET', url: '/by-ip' });
    expect(response.statusCode).toBe(SERVICE_UNAVAILABLE_STATUS);
    expect(response.json()).toEqual({ error: RateLimitErrorMessage.serviceUnavailable });
  });
});
