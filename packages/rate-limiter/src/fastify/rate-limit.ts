import type { FastifyReply, FastifyRequest } from 'fastify';
import { RateLimiterUnavailableError } from '#core/errors.js';
import type { Decision, RateLimiter, Rule } from '#core/types.js';
import { RATE_LIMITER_PLUGIN_NAME } from '#fastify/plugin.js';

export const RateLimitHeader = {
  Limit: 'x-ratelimit-limit',
  Remaining: 'x-ratelimit-remaining',
  RetryAfter: 'retry-after',
} as const;

export const TOO_MANY_REQUESTS_STATUS = 429;
export const SERVICE_UNAVAILABLE_STATUS = 503;
const MS_PER_SECOND = 1000;

export const RateLimitErrorMessage = {
  tooManyRequests: 'Too Many Requests',
  serviceUnavailable: 'Service Unavailable',
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

      const decision = await consumeOrUnavailable(limiter, identify(request), rule);
      if (!decision) {
        return reply
          .code(SERVICE_UNAVAILABLE_STATUS)
          .send({ error: RateLimitErrorMessage.serviceUnavailable });
      }

      if (!decision.degraded) reply.headers(headersFor(decision));
      if (!decision.allowed) {
        return reply
          .code(TOO_MANY_REQUESTS_STATUS)
          .send({ error: RateLimitErrorMessage.tooManyRequests });
      }
      return handler.call(this, request, reply);
    };
  };
}

async function consumeOrUnavailable(
  limiter: RateLimiter,
  key: string,
  rule: Rule,
): Promise<Decision | undefined> {
  try {
    return await limiter.consume(key, rule);
  } catch (error) {
    if (error instanceof RateLimiterUnavailableError) return undefined;
    throw error;
  }
}

function headersFor({ allowed, limit, remaining, retryAfterMs }: Decision): Record<string, number> {
  const headers: Record<string, number> = {
    [RateLimitHeader.Limit]: limit,
    [RateLimitHeader.Remaining]: remaining,
  };
  if (!allowed) headers[RateLimitHeader.RetryAfter] = Math.ceil(retryAfterMs / MS_PER_SECOND);
  return headers;
}
