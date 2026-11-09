import type { Decision, RateLimitStore } from '@iol/rate-limiter';
import { RateLimitHeader, TOO_MANY_REQUESTS_STATUS } from '@iol/rate-limiter/fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HELLO_MESSAGE, HELLO_RULE, HELLO_WINDOW_RULE } from '#controllers/hello-controller.js';
import { buildApp, Route } from '#http/app.js';
import { MetricName, Outcome } from '#http/metrics.js';
import { CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_HALF_OPEN_AFTER_MS } from '#http/rate-limiter.js';

const allowed: Decision = {
  allowed: true,
  limit: 5,
  remaining: 4,
  retryAfterMs: 0,
  degraded: false,
};
const denied: Decision = { ...allowed, allowed: false, remaining: 0, retryAfterMs: 1000 };

async function appWith(consume: RateLimitStore['consume']) {
  return await buildApp({ store: { consume } });
}

async function metricsOf(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  return (await app.inject({ method: 'GET', url: Route.Metrics })).body;
}

describe(`GET ${Route.Hello}`, () => {
  it('greets the client', async () => {
    const app = await appWith(vi.fn<RateLimitStore['consume']>().mockResolvedValue(allowed));
    const response = await app.inject({ method: 'GET', url: Route.Hello });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: HELLO_MESSAGE });
    expect(response.headers[RateLimitHeader.Remaining]).toBe('4');
  });

  it('is rate limited by client IP with the hello rule', async () => {
    const consume = vi.fn<RateLimitStore['consume']>().mockResolvedValue(allowed);
    const app = await appWith(consume);
    await app.inject({ method: 'GET', url: Route.Hello, remoteAddress: '203.0.113.7' });
    expect(consume.mock.calls[0]?.[0]).toBe('hello:token-bucket:203.0.113.7');
    expect(consume.mock.calls[0]?.[1]).toBe(HELLO_RULE);
  });

  it('identifies clients by X-Forwarded-For only when the proxy is trusted', async () => {
    const consume = vi.fn<RateLimitStore['consume']>().mockResolvedValue(allowed);
    const forwarded = { 'x-forwarded-for': '198.51.100.9' };
    const trusted = await buildApp({ store: { consume }, trustProxy: true });
    const untrusted = await buildApp({ store: { consume } });
    await trusted.inject({ method: 'GET', url: Route.Hello, headers: forwarded });
    await untrusted.inject({
      method: 'GET',
      url: Route.Hello,
      headers: forwarded,
      remoteAddress: '203.0.113.7',
    });
    expect(consume.mock.calls.map(([key]) => key)).toEqual([
      'hello:token-bucket:198.51.100.9',
      'hello:token-bucket:203.0.113.7',
    ]);
  });

  it('responds 429 when the store denies the request', async () => {
    const app = await appWith(vi.fn<RateLimitStore['consume']>().mockResolvedValue(denied));
    const response = await app.inject({ method: 'GET', url: Route.Hello });
    expect(response.statusCode).toBe(TOO_MANY_REQUESTS_STATUS);
  });
});

describe(`GET ${Route.HelloWindow}`, () => {
  it('is rate limited with the sliding window rule', async () => {
    const consume = vi.fn<RateLimitStore['consume']>().mockResolvedValue(allowed);
    const app = await appWith(consume);
    const response = await app.inject({
      method: 'GET',
      url: Route.HelloWindow,
      remoteAddress: '203.0.113.7',
    });
    expect(response.json()).toEqual({ message: HELLO_MESSAGE });
    expect(consume.mock.calls[0]?.[0]).toBe('hello-window:sliding-window:203.0.113.7');
    expect(consume.mock.calls[0]?.[1]).toBe(HELLO_WINDOW_RULE);
  });
});

describe(`GET ${Route.Metrics}`, () => {
  it('counts rate limit decisions by rule and outcome', async () => {
    const app = await appWith(
      vi
        .fn<RateLimitStore['consume']>()
        .mockResolvedValueOnce(allowed)
        .mockResolvedValueOnce(denied),
    );
    await app.inject({ method: 'GET', url: Route.Hello });
    await app.inject({ method: 'GET', url: Route.Hello });
    const metrics = await metricsOf(app);
    expect(metrics).toContain(
      `${MetricName.Decisions}{rule="hello",outcome="${Outcome.Allowed}"} 1`,
    );
    expect(metrics).toContain(
      `${MetricName.Decisions}{rule="hello",outcome="${Outcome.Rejected}"} 1`,
    );
  });
});

describe('when the rate limit store fails', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails open, opens the circuit after consecutive failures and closes it once the store recovers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const consume = vi.fn<RateLimitStore['consume']>().mockRejectedValue(new Error('down'));
    const app = await appWith(consume);
    const hello = async () => (await app.inject({ method: 'GET', url: Route.Hello })).statusCode;

    for (let request = 0; request < CIRCUIT_FAILURE_THRESHOLD; request++) {
      expect(await hello()).toBe(200);
    }
    expect(consume).toHaveBeenCalledTimes(CIRCUIT_FAILURE_THRESHOLD);
    expect(await metricsOf(app)).toContain(`${MetricName.CircuitOpen} 1`);

    expect(await hello()).toBe(200);
    expect(consume).toHaveBeenCalledTimes(CIRCUIT_FAILURE_THRESHOLD);

    const metrics = await metricsOf(app);
    expect(metrics).toContain(
      `${MetricName.Decisions}{rule="hello",outcome="${Outcome.FailedOpen}"} ${String(CIRCUIT_FAILURE_THRESHOLD + 1)}`,
    );
    expect(metrics).toContain(
      `${MetricName.StoreErrors}{rule="hello"} ${String(CIRCUIT_FAILURE_THRESHOLD + 1)}`,
    );

    vi.setSystemTime(Date.now() + CIRCUIT_HALF_OPEN_AFTER_MS);
    consume.mockResolvedValue(allowed);
    expect(await hello()).toBe(200);
    expect(consume).toHaveBeenCalledTimes(CIRCUIT_FAILURE_THRESHOLD + 1);
    expect(await metricsOf(app)).toContain(`${MetricName.CircuitOpen} 0`);
  });
});
