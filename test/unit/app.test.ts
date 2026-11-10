import type { Decision, RateLimitRepository } from '@iol/rate-limiter';
import { RateLimitHeader, TOO_MANY_REQUESTS_STATUS } from '@iol/rate-limiter/fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HELLO_MESSAGE, HELLO_RULE, HELLO_WINDOW_RULE } from '#controllers/hello-controller.js';
import { buildApp, Route } from '#http/app.js';
import { CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_HALF_OPEN_AFTER_MS } from '#http/rate-limiter.js';

const allowed: Decision = {
  allowed: true,
  limit: 5,
  remaining: 4,
  retryAfterMs: 0,
  degraded: false,
};
const denied: Decision = { ...allowed, allowed: false, remaining: 0, retryAfterMs: 1000 };

async function appWith(update: RateLimitRepository['update']) {
  return await buildApp({ repository: { update } });
}

describe(`GET ${Route.Hello}`, () => {
  it('greets the client', async () => {
    const app = await appWith(vi.fn<RateLimitRepository['update']>().mockResolvedValue(allowed));
    const response = await app.inject({ method: 'GET', url: Route.Hello });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: HELLO_MESSAGE });
    expect(response.headers[RateLimitHeader.Remaining]).toBe('4');
  });

  it('is rate limited by client IP with the hello rule', async () => {
    const update = vi.fn<RateLimitRepository['update']>().mockResolvedValue(allowed);
    const app = await appWith(update);
    await app.inject({ method: 'GET', url: Route.Hello, remoteAddress: '203.0.113.7' });
    expect(update.mock.calls[0]?.[0]).toBe('hello:token-bucket:203.0.113.7');
    const transition = update.mock.calls[0]?.[2];
    expect(transition?.(undefined, 0).decision.limit).toBe(HELLO_RULE.capacity);
  });

  it('responds 429 when the repository denies the request', async () => {
    const app = await appWith(vi.fn<RateLimitRepository['update']>().mockResolvedValue(denied));
    const response = await app.inject({ method: 'GET', url: Route.Hello });
    expect(response.statusCode).toBe(TOO_MANY_REQUESTS_STATUS);
  });
});

describe(`GET ${Route.HelloWindow}`, () => {
  it('is rate limited with the sliding window rule', async () => {
    const update = vi.fn<RateLimitRepository['update']>().mockResolvedValue(allowed);
    const app = await appWith(update);
    const response = await app.inject({
      method: 'GET',
      url: Route.HelloWindow,
      remoteAddress: '203.0.113.7',
    });
    expect(response.json()).toEqual({ message: HELLO_MESSAGE });
    expect(update.mock.calls[0]?.[0]).toBe('hello-window:sliding-window:203.0.113.7');
    const transition = update.mock.calls[0]?.[2];
    expect(transition?.(undefined, 0).decision.limit).toBe(HELLO_WINDOW_RULE.limit);
  });
});

describe('when the rate limit repository fails', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails open, stops calling the repository after consecutive failures and resumes once it recovers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const update = vi.fn<RateLimitRepository['update']>().mockRejectedValue(new Error('down'));
    const app = await appWith(update);
    const hello = () => app.inject({ method: 'GET', url: Route.Hello });

    for (let request = 0; request < CIRCUIT_FAILURE_THRESHOLD; request++) {
      const response = await hello();
      expect(response.statusCode).toBe(200);
      expect(response.headers[RateLimitHeader.Remaining]).toBeUndefined();
    }
    expect(update).toHaveBeenCalledTimes(CIRCUIT_FAILURE_THRESHOLD);

    expect((await hello()).statusCode).toBe(200);
    expect(update).toHaveBeenCalledTimes(CIRCUIT_FAILURE_THRESHOLD);

    vi.setSystemTime(Date.now() + CIRCUIT_HALF_OPEN_AFTER_MS);
    update.mockResolvedValue(allowed);
    expect((await hello()).headers[RateLimitHeader.Remaining]).toBe('4');
    expect((await hello()).headers[RateLimitHeader.Remaining]).toBe('4');
    expect(update).toHaveBeenCalledTimes(CIRCUIT_FAILURE_THRESHOLD + 2);
  });
});
