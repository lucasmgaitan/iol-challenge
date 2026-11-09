import { RedisStore } from '@iol/rate-limiter';
import { buildApp } from '#http/app.js';
import { createRedisClient, DEFAULT_COMMAND_TIMEOUT_MS } from '#http/redis-client.js';

const Env = {
  RedisUrl: 'REDIS_URL',
  RedisCommandTimeoutMs: 'REDIS_COMMAND_TIMEOUT_MS',
  Port: 'PORT',
  Host: 'HOST',
  TrustProxy: 'TRUST_PROXY',
} as const;

const ENABLED = 'true';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

const LogMessage = {
  redisError: 'redis connection error',
  redisUnavailableAtStartup: 'redis is unavailable at startup, rate limiting will fail open',
} as const;

const redis = createRedisClient({
  url: process.env[Env.RedisUrl] ?? DEFAULT_REDIS_URL,
  commandTimeoutMs: Number(process.env[Env.RedisCommandTimeoutMs] ?? DEFAULT_COMMAND_TIMEOUT_MS),
});
const app = await buildApp({
  store: new RedisStore({ redis }),
  logger: true,
  trustProxy: process.env[Env.TrustProxy] === ENABLED,
});

redis.on('error', (error: Error) => {
  app.log.warn({ err: error }, LogMessage.redisError);
});
app.addHook('onClose', (_instance, done) => {
  redis.disconnect();
  done();
});

for (const signal of SHUTDOWN_SIGNALS) {
  process.once(signal, () => {
    void app.close();
  });
}

try {
  await redis.connect();
} catch (error) {
  app.log.warn({ err: error }, LogMessage.redisUnavailableAtStartup);
}

await app.listen({
  port: Number(process.env[Env.Port] ?? DEFAULT_PORT),
  host: process.env[Env.Host] ?? DEFAULT_HOST,
});
