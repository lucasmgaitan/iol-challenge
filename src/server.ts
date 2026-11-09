import { createRateLimiter, RedisStore } from '@iol/rate-limiter';
import { Redis } from 'ioredis';
import { buildApp } from '#http/app.js';

const Env = {
  RedisUrl: 'REDIS_URL',
  Port: 'PORT',
  Host: 'HOST',
} as const;

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

const redis = new Redis(process.env[Env.RedisUrl] ?? DEFAULT_REDIS_URL);
const app = await buildApp({
  limiter: createRateLimiter({ store: new RedisStore({ redis }) }),
  logger: true,
});

app.addHook('onClose', async () => {
  await redis.quit();
});

for (const signal of SHUTDOWN_SIGNALS) {
  process.once(signal, () => {
    void app.close();
  });
}

await app.listen({
  port: Number(process.env[Env.Port] ?? DEFAULT_PORT),
  host: process.env[Env.Host] ?? DEFAULT_HOST,
});
