import type { RateLimiter } from '@iol/rate-limiter';
import { rateLimiterPlugin } from '@iol/rate-limiter/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { HelloController } from '#controllers/hello-controller.js';

export const Route = {
  Hello: '/hello',
} as const;

export interface AppDependencies {
  readonly limiter: RateLimiter;
  readonly logger?: FastifyServerOptions['logger'];
}

export async function buildApp({
  limiter,
  logger = false,
}: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  await app.register(rateLimiterPlugin, { limiter });

  const hello = new HelloController();
  app.get(Route.Hello, hello.hello.bind(hello));

  return app;
}
