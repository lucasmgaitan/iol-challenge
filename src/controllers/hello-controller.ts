import { Algorithm } from '@iol/rate-limiter';
import { RateLimit, type RouteResult } from '@iol/rate-limiter/fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const HELLO_MESSAGE = 'Hello, world!';

export class HelloController {
  @RateLimit({
    name: 'hello',
    algorithm: Algorithm.TokenBucket,
    capacity: 5,
    refillPerSecond: 1,
  })
  hello(_request: FastifyRequest, reply: FastifyReply): RouteResult {
    return reply.send({ message: HELLO_MESSAGE });
  }

  @RateLimit({
    name: 'hello-window',
    algorithm: Algorithm.SlidingWindow,
    limit: 5,
    windowMs: 5000,
  })
  helloWindow(_request: FastifyRequest, reply: FastifyReply): RouteResult {
    return reply.send({ message: HELLO_MESSAGE });
  }
}
