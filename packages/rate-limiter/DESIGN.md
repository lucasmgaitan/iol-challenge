# Design

A distributed rate limiter based on chapter 4 of _System Design Interview_ (Alex Xu). This folder is the library (`@iol/rate-limiter`); the repository root is a small Fastify API that uses it to protect two endpoints. How to run it is in the [README](../../README.md).

## Scope

**In:** the token bucket and sliding window counter algorithms, shared state in Redis so several API instances enforce one limit, a `@RateLimit` decorator for Fastify handlers, `429` responses with `X-Ratelimit-*` and `Retry-After` headers, and a resilience layer (timeouts, fail-open, circuit breaker).

**Out, on purpose:**

| Left out                                                               | Why                                                                                                                                                       |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The other three algorithms (leaking bucket, fixed window, sliding log) | The book recommends token bucket and sliding window counter for production. Two algorithms are enough to show the abstraction without inflating the code. |
| A rules service / rules loaded from config                             | Rules live next to the handler they protect. Changing a limit needs a redeploy, which is acceptable for a prototype.                                      |
| Multi-datacenter sync                                                  | One Redis is the source of truth. Replicating counters across regions is a different problem (eventual consistency, CRDTs).                               |
| Metrics and load tests                                                 | I built them (Prometheus, Grafana, k6, Locust) and removed them: they added more code to explain than value to the prototype. Fastify's logger is kept.   |

## Architecture

```
request ─▶ @RateLimit ─▶ RateLimiter ─▶ ExecutionPolicy ─▶ RateLimitRepository ─▶ Redis
           (fastify/)     (core/)       (circuit breaker)   (stores/)
                            │
                            └─▶ strategy (strategies/): validate, retention, decide
```

The library has four folders, and each depends only on the ones to its left:

- **`core/`** defines the public interface, `RateLimiter.consume(key, rule) → Decision`, and the two ports the limiter needs: `RateLimitRepository` (where state lives) and `ExecutionPolicy` (how a call to the repository is wrapped). It builds the Redis key as `<rule>:<algorithm>:<client>` and applies the failure policy.
- **`strategies/`** holds one object per algorithm: how to validate its rule, how long its state must be kept, and `decide(rule, stored, nowMs)`, a **pure function** that returns the decision and the new state. No I/O, no clock.
- **`stores/`** has the only repository, `RedisRateLimitRepository`, which runs a strategy's transition atomically against Redis.
- **`fastify/`** has the plugin that attaches a limiter to the Fastify instance and the `@RateLimit` decorator. Fastify is an optional peer dependency; the core does not import it.

The interface is deliberately small (one method, one result type). Callers never see Redis, keys, clocks or retries, which follows the "deep module" idea from _A Philosophy of Software Design_.

## Algorithms

**Token bucket** stores `{ tokens, updatedAt }`. On each request it refills `elapsed × rate` tokens (capped at `capacity`), and allows the request if at least one token is left. When it denies, `retryAfter` is the time until the next whole token. A rejection does not write any state.

**Sliding window counter** stores `{ windowStart, current, previous }`: the counts of the current fixed window and the one before it. It estimates the requests in the last `W` ms as `current + previous × (1 − elapsed/W)`, so it needs two counters per client instead of a log of timestamps. The price is that it is an approximation: it assumes the previous window's requests were evenly spread. The retry time is solved from that same formula (the two one-line comments in `sliding-window.ts` show the derivation).

Both are tested with a fixed clock, which is possible only because they are pure functions.

## Atomicity on Redis

Several instances can update the same key at the same moment, so the read-modify-write has to be atomic. I considered two options:

| Option                                       | Pros                                                                      | Cons                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Lua script per algorithm                     | One round trip, no retries                                                | The algorithm is written twice (Lua for Redis, TS for tests) or only in Lua, which is hard to unit test |
| **Optimistic transaction (`WATCH`/`MULTI`)** | Algorithms stay in TypeScript as pure functions, tested with a fake clock | Two round trips per request, and retries under contention                                               |

I first implemented Lua and then moved to `WATCH`/`MULTI`/`EXEC`, because keeping each algorithm in one language and testable without Redis mattered more to me than one round trip. The flow in `RedisRateLimitRepository.transact`:

1. In one pipeline: `WATCH key`, `TIME`, `HGETALL key`.
2. Run the strategy's `decide` in TypeScript.
3. If the request is denied, `UNWATCH` and return: rejections write nothing, so they never conflict.
4. Otherwise `MULTI` / `HSET` / `PEXPIRE` / `EXEC`. If another client changed the key after the `WATCH`, `EXEC` returns `null` and the loop retries.
5. After `maxAttempts` (10) conflicts, it throws `RateLimitContentionError` and the limiter **denies** the request with `retryAfter = 0`.

Details that matter:

- **One clock.** `now` comes from Redis `TIME`, read in the same pipeline as the state, so instances with skewed clocks still agree.
- **`WATCH` belongs to a connection.** Two transactions sharing a connection would watch each other's keys and break. The repository keeps a small set of connections (4 in the API) and maps each key to one of them by hash. Each connection has a `SerialQueue`, so its transactions run one after another. Requests for the same key inside one instance therefore queue instead of conflicting; conflicts only happen between instances.
- **TTL.** Every write sets `PEXPIRE` to the time after which the state no longer affects any decision (a full refill for the bucket, two windows for the sliding window), so idle clients disappear on their own.

The integration test that proves this sends 200 concurrent requests from 3 repositories (simulating 3 instances) against a capacity of 50, and expects exactly 50 to be allowed.

## Failure handling

| Failure                           | Behaviour                                                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid rule (e.g. `capacity: 0`) | Throws a validation error on the first request. It is a programming error, so it is not hidden by the failure policy.                                                      |
| Redis slow or down                | ioredis is configured with a 100 ms command timeout, no offline queue and no retries. The error reaches the limiter quickly.                                               |
| Repeated Redis failures           | A `cockatiel` circuit breaker (injected as the `ExecutionPolicy`) opens after 5 consecutive failures and tries again after 10 s, so requests stop waiting for timeouts.    |
| Any repository failure            | **Fail-open** by default: the request is allowed and the decision is marked `degraded`, so no rate limit headers are sent. `FailurePolicy.Closed` turns this into a `503`. |
| Too much contention on one key    | Deny with `retryAfter = 0` (see above).                                                                                                                                    |

Fail-open is the default because for this API being unavailable is worse than briefly not limiting. A login endpoint, for example, would choose fail-closed.

The circuit breaker lives in the API (`src/http/rate-limiter.ts`), not in the library: the core only knows the `ExecutionPolicy` interface, so it does not depend on cockatiel.

## Testing

- **Unit (library):** both algorithms with a fixed clock (bursts, refill, window weighting, retry times, clock going backwards), rule validation, the key layout, the failure policy, the serial queue, and the decorator (headers, `429`, `503`, client identification).
- **Integration (library, real Redis via testcontainers):** both algorithms end to end, TTLs, retry on a concurrent write, giving up after `maxAttempts`, and the 200-requests / 3-instances concurrency test.
- **API:** unit tests with a mocked repository (routes, keys, circuit breaker opening and closing) and integration tests against Redis, including Redis unreachable.

CI (GitHub Actions) runs typecheck, lint, formatting, shellcheck, unit and integration tests, and the build on every push.

## How I used AI

I used **Claude Code** for the whole challenge. The split was: I made the design decisions, Claude Code wrote most of the code and tests, and I reviewed every change before keeping it.

What I kept for myself:

- **Choosing the problem and the scope:** which algorithms, Redis as the shared store, the decorator as the way to declare rules, fail-open as the default.
- **Rejecting abstractions.** The AI tended to add layers: open/closed extension points, separate domain and infrastructure types, pattern names that described the pattern rather than the code. I pushed back on the ones that did not pay for themselves. The result is one port for storage and one for the execution policy, and nothing else.
- **Cutting scope.** At one point the repository had Prometheus metrics, a Grafana dashboard, k6 and Locust load tests and a Docker Compose stack. They worked, but they were more code to maintain and explain than the prototype needed, so I removed them.
- **Setting conventions so the output would not be slop.** The repository has written conventions (`.claude/skills/`) that the agent follows: no comments that restate the code, no magic strings, `async`/`await` only, English identifiers, import aliases. They keep the generated code consistent and small.

Every change had to pass `npm run check` and the integration tests locally, and the same checks run in CI.
