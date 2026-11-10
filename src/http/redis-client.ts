import { Redis } from 'ioredis';

export const DEFAULT_COMMAND_TIMEOUT_MS = 100;
const CONNECT_TIMEOUT_MS = 1000;
const NO_COMMAND_RETRIES = 0;

interface RedisClientOptions {
  readonly url: string;
  readonly commandTimeoutMs?: number;
}

export function createRedisClient({
  url,
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
}: RedisClientOptions): Redis {
  return new Redis(url, {
    lazyConnect: true,
    commandTimeout: commandTimeoutMs,
    connectTimeout: CONNECT_TIMEOUT_MS,
    enableOfflineQueue: false,
    maxRetriesPerRequest: NO_COMMAND_RETRIES,
  });
}
