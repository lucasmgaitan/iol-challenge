import { Algorithm, type SlidingWindowRule, type TokenBucketRule } from '@iol/rate-limiter';
import { RateLimit, type RouteResult } from '@iol/rate-limiter/fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const HELLO_RULE: TokenBucketRule = {
  name: 'hello',
  algorithm: Algorithm.TokenBucket,
  capacity: 5,
  refillPerSecond: 1,
};

export const HELLO_WINDOW_RULE: SlidingWindowRule = {
  name: 'hello-window',
  algorithm: Algorithm.SlidingWindow,
  limit: 5,
  windowMs: 5000,
};

export const HELLO_MESSAGE = 'Hello, world!';

export class HelloController {
  @RateLimit(HELLO_RULE)
  hello(_request: FastifyRequest, reply: FastifyReply): RouteResult {
    return reply.send({ message: HELLO_MESSAGE });
  }

  @RateLimit(HELLO_WINDOW_RULE)
  helloWindow(_request: FastifyRequest, reply: FastifyReply): RouteResult {
    return reply.send({ message: HELLO_MESSAGE });
  }
}
