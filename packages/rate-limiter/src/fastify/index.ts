export { rateLimiterPlugin, type RateLimiterPluginOptions } from '#fastify/plugin.js';
export {
  RateLimit,
  RateLimitErrorMessage,
  RateLimitHeader,
  SERVICE_UNAVAILABLE_STATUS,
  TOO_MANY_REQUESTS_STATUS,
  type RateLimitOptions,
  type RouteHandler,
  type RouteResult,
} from '#fastify/rate-limit.js';
