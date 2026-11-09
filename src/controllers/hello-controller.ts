import { Algorithm, type TokenBucketRule } from '@iol/rate-limiter';
import { RateLimit, type RouteResult } from '@iol/rate-limiter/fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const HELLO_RULE: TokenBucketRule = {
  name: 'hello',
  algorithm: Algorithm.TokenBucket,
  capacity: 5,
  refillPerSecond: 1,
};

export const HELLO_MESSAGE = 'Hello, world!';

export class HelloController {
  @RateLimit(HELLO_RULE)
  hello(_request: FastifyRequest, reply: FastifyReply): RouteResult {
    return reply.send({ message: HELLO_MESSAGE });
  }
}
