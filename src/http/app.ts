import type { RateLimitStore } from '@iol/rate-limiter';
import { rateLimiterPlugin } from '@iol/rate-limiter/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { HelloController } from '#controllers/hello-controller.js';
import { createMetrics } from '#http/metrics.js';
import { createAppRateLimiter } from '#http/rate-limiter.js';

export const Route = {
  Hello: '/hello',
  HelloWindow: '/hello-window',
  Metrics: '/metrics',
} as const;

export interface AppDependencies {
  readonly store: RateLimitStore;
  readonly logger?: FastifyServerOptions['logger'];
  readonly trustProxy?: boolean;
}

export async function buildApp({
  store,
  logger = false,
  trustProxy = false,
}: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger, trustProxy });
  const metrics = createMetrics();
  const limiter = createAppRateLimiter({ store, logger: app.log, metrics });
  await app.register(rateLimiterPlugin, { limiter });

  const hello = new HelloController();
  app.get(Route.Hello, hello.hello.bind(hello));
  app.get(Route.HelloWindow, hello.helloWindow.bind(hello));

  app.get(Route.Metrics, async (_request, reply) => {
    const body = await metrics.registry.metrics();
    return reply.type(metrics.registry.contentType).send(body);
  });

  return app;
}
