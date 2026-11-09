import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Decision, Rule } from '#core/types.js';
import { RATE_LIMITER_PLUGIN_NAME } from '#fastify/plugin.js';

export const RateLimitHeader = {
  Limit: 'x-ratelimit-limit',
  Remaining: 'x-ratelimit-remaining',
  RetryAfter: 'retry-after',
} as const;

export const TOO_MANY_REQUESTS_STATUS = 429;
const MS_PER_SECOND = 1000;

export const RateLimitErrorMessage = {
  tooManyRequests: 'Too Many Requests',
  pluginNotRegistered: `the ${RATE_LIMITER_PLUGIN_NAME} plugin must be registered before using @RateLimit`,
} as const;

export type RouteResult = FastifyReply | Promise<FastifyReply>;

export type RouteHandler<This> = (
  this: This,
  request: FastifyRequest,
  reply: FastifyReply,
) => RouteResult;

export interface RateLimitOptions {
  readonly identify?: (request: FastifyRequest) => string;
}

const identifyByIp = (request: FastifyRequest): string => request.ip;

export function RateLimit(rule: Rule, { identify = identifyByIp }: RateLimitOptions = {}) {
  return function <This>(
    handler: RouteHandler<This>,
    _context: ClassMethodDecoratorContext<This, RouteHandler<This>>,
  ): RouteHandler<This> {
    return async function rateLimited(this: This, request, reply) {
      const limiter = request.server.rateLimiter;
      if (!limiter) throw new Error(RateLimitErrorMessage.pluginNotRegistered);

      const decision = await limiter.consume(identify(request), rule);
      reply.headers(headersFor(decision));
      if (!decision.allowed) {
        return reply
          .code(TOO_MANY_REQUESTS_STATUS)
          .send({ error: RateLimitErrorMessage.tooManyRequests });
      }
      return handler.call(this, request, reply);
    };
  };
}

function headersFor({ allowed, limit, remaining, retryAfterMs }: Decision): Record<string, number> {
  const headers: Record<string, number> = {
    [RateLimitHeader.Limit]: limit,
    [RateLimitHeader.Remaining]: remaining,
  };
  if (!allowed) headers[RateLimitHeader.RetryAfter] = Math.ceil(retryAfterMs / MS_PER_SECOND);
  return headers;
}
