import type { FastifyPluginCallback } from 'fastify';
import { fastifyPlugin } from 'fastify-plugin';
import type { RateLimiter } from '#core/types.js';

declare module 'fastify' {
  interface FastifyInstance {
    rateLimiter?: RateLimiter;
  }
}

export const RATE_LIMITER_PLUGIN_NAME = '@iol/rate-limiter';
const SUPPORTED_FASTIFY_VERSION = '5.x';

interface RateLimiterPluginOptions {
  readonly limiter: RateLimiter;
}

const register: FastifyPluginCallback<RateLimiterPluginOptions> = (fastify, { limiter }, done) => {
  fastify.decorate('rateLimiter', limiter);
  done();
};

export const rateLimiterPlugin = fastifyPlugin(register, {
  name: RATE_LIMITER_PLUGIN_NAME,
  fastify: SUPPORTED_FASTIFY_VERSION,
});
