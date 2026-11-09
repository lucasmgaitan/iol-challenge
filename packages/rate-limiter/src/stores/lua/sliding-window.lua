local WINDOW_START_FIELD = 'window_start'
local CURRENT_FIELD = 'current'
local PREVIOUS_FIELD = 'previous'

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local ttl_ms = tonumber(ARGV[3])

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local window_start = math.floor(now / window_ms) * window_ms

local stored = redis.call('HMGET', key, WINDOW_START_FIELD, CURRENT_FIELD, PREVIOUS_FIELD)
local stored_start = tonumber(stored[1])

local current = 0
local previous = 0
if stored_start == window_start then
  current = tonumber(stored[2])
  previous = tonumber(stored[3])
elseif stored_start == window_start - window_ms then
  previous = tonumber(stored[2])
elseif stored_start and stored_start > window_start then
  window_start = stored_start
  now = stored_start
  current = tonumber(stored[2])
  previous = tonumber(stored[3])
end

local elapsed = now - window_start
local estimated = current + previous * (1 - elapsed / window_ms)

local allowed = 0
local remaining = 0
local retry_after_ms = 0
if estimated + 1 <= limit then
  current = current + 1
  allowed = 1
  remaining = math.max(0, math.floor(limit - estimated - 1))
elseif current + 1 <= limit then
  -- previous * (1 - t/W) <= limit - 1 - current  →  t >= W * (1 - (limit - 1 - current) / previous)
  local t = window_ms * (1 - (limit - 1 - current) / previous)
  retry_after_ms = math.max(1, math.ceil(t - elapsed))
else
  -- current * (1 - t/W) <= limit - 1  →  t >= W * (1 - (limit - 1) / current)
  local t = window_ms * (1 - (limit - 1) / current)
  retry_after_ms = math.ceil(window_ms - elapsed + t)
end

redis.call('HSET', key, WINDOW_START_FIELD, window_start, CURRENT_FIELD, current, PREVIOUS_FIELD, previous)
redis.call('PEXPIRE', key, ttl_ms)

return { allowed, limit, remaining, retry_after_ms }
