local TOKENS_FIELD = 'tokens'
local UPDATED_AT_FIELD = 'updated_at'

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2]) / 1000
local ttl_ms = tonumber(ARGV[3])

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

local stored = redis.call('HMGET', key, TOKENS_FIELD, UPDATED_AT_FIELD)
local stored_tokens = tonumber(stored[1])
local stored_updated_at = tonumber(stored[2])

local available = capacity
local updated_at = now
if stored_tokens then
  local elapsed = math.max(0, now - stored_updated_at)
  available = math.min(capacity, stored_tokens + elapsed * refill_per_ms)
  updated_at = math.max(now, stored_updated_at)
end

local allowed = 0
local remaining = 0
local retry_after_ms = 0
if available >= 1 then
  available = available - 1
  allowed = 1
  remaining = math.floor(available)
else
  retry_after_ms = math.ceil((1 - available) / refill_per_ms)
end

redis.call('HSET', key, TOKENS_FIELD, available, UPDATED_AT_FIELD, updated_at)
redis.call('PEXPIRE', key, ttl_ms)

return { allowed, capacity, remaining, retry_after_ms }
