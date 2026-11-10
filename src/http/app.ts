import type { RateLimitRepository } from '@iol/rate-limiter';
import { rateLimiterPlugin } from '@iol/rate-limiter/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { HelloController } from '#controllers/hello-controller.js';
import { createAppRateLimiter } from '#http/rate-limiter.js';

export const Route = {
  Hello: '/hello',
  HelloWindow: '/hello-window',
} as const;

interface AppDependencies {
  readonly repository: RateLimitRepository;
  readonly logger?: FastifyServerOptions['logger'];
}

export async function buildApp({
  repository,
  logger = false,
}: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  await app.register(rateLimiterPlugin, { limiter: createAppRateLimiter(repository) });

  const hello = new HelloController();
  app.get(Route.Hello, hello.hello.bind(hello));
  app.get(Route.HelloWindow, hello.helloWindow.bind(hello));

  return app;
}
