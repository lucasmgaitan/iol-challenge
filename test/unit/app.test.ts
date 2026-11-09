import type { Decision, RateLimiter } from '@iol/rate-limiter';
import { RateLimitHeader, TOO_MANY_REQUESTS_STATUS } from '@iol/rate-limiter/fastify';
import { describe, expect, it, vi } from 'vitest';
import { HELLO_MESSAGE, HELLO_RULE } from '#controllers/hello-controller.js';
import { buildApp, Route } from '#http/app.js';

const allowed: Decision = { allowed: true, limit: 5, remaining: 4, retryAfterMs: 0 };
const denied: Decision = { allowed: false, limit: 5, remaining: 0, retryAfterMs: 1000 };

async function appWith(decision: Decision) {
  const consume = vi.fn<RateLimiter['consume']>().mockResolvedValue(decision);
  return { app: await buildApp({ limiter: { consume } }), consume };
}

describe(`GET ${Route.Hello}`, () => {
  it('greets the client', async () => {
    const { app } = await appWith(allowed);
    const response = await app.inject({ method: 'GET', url: Route.Hello });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: HELLO_MESSAGE });
    expect(response.headers[RateLimitHeader.Remaining]).toBe('4');
  });

  it('is rate limited by client IP with the hello rule', async () => {
    const { app, consume } = await appWith(allowed);
    await app.inject({ method: 'GET', url: Route.Hello, remoteAddress: '203.0.113.7' });
    expect(consume).toHaveBeenCalledWith('203.0.113.7', HELLO_RULE);
  });

  it('responds 429 when the limiter denies the request', async () => {
    const { app } = await appWith(denied);
    const response = await app.inject({ method: 'GET', url: Route.Hello });
    expect(response.statusCode).toBe(TOO_MANY_REQUESTS_STATUS);
  });
});
