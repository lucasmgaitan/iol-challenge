# Distributed rate limiter

[![CI](https://github.com/lucasmgaitan/iol-challenge/actions/workflows/ci.yml/badge.svg)](https://github.com/lucasmgaitan/iol-challenge/actions/workflows/ci.yml)

A distributed rate limiter in TypeScript, based on chapter 4 of _System Design Interview_ (Alex Xu):

- **`packages/rate-limiter`** (`@iol/rate-limiter`) is the library: the **token bucket** and **sliding window counter** algorithms, written in TypeScript and applied atomically on Redis with optimistic transactions (`WATCH`/`MULTI`/`EXEC`), plus a Fastify plugin and a `@RateLimit` decorator.
- **The repository root** is a Fastify API that installs the library as a dependency and protects two endpoints with the decorator.

The counters live in Redis, so every API instance shares them: a client gets **one** limit no matter which instance serves each request.

## Quick start

With Node.js 22+ and Docker running:

```bash
git clone https://github.com/lucasmgaitan/iol-challenge.git
cd iol-challenge
./run.sh start
```

Then, in another terminal, send 7 requests in a row:

```bash
for i in 1 2 3 4 5 6 7; do curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/hello; done
```

You should see five `200` followed by two `429`. `Ctrl+C` in the first terminal stops the API and removes the Redis container.

## Contents

1. [What you need](#1-what-you-need)
2. [Run the tests](#2-run-the-tests)
3. [Try the endpoints by hand](#3-try-the-endpoints-by-hand)
4. [How to interpret the results](#4-how-to-interpret-the-results)
5. [How it works](#5-how-it-works)
6. [Configuration](#6-configuration)
7. [Troubleshooting](#7-troubleshooting)
8. [Repository layout](#8-repository-layout)

## 1. What you need

- **Node.js 22+** and npm (the repository has an `.nvmrc`: `nvm use` picks the right version)
- **Docker** (Docker Desktop, OrbStack, Colima…), used to run Redis for the integration tests and for the API
- **curl**, only to try the endpoints by hand

Nothing else needs to be installed: `./run.sh start` installs the npm dependencies on its first run, and the tests start their own Redis.

## 2. Run the tests

```bash
git clone https://github.com/lucasmgaitan/iol-challenge.git
cd iol-challenge
npm ci
npm run check              # typecheck, lint, formatting and unit tests
npm run test:integration   # tests against a real Redis, started automatically in Docker
```

Both commands must finish without errors. Vitest prints one summary per package (library and API); every summary must say `passed` and none `failed`:

```
 Test Files  6 passed (6)
      Tests  39 passed (39)
```

The integration tests start a disposable Redis container (with [testcontainers](https://testcontainers.com/)) and remove it when they finish. The first run pulls the Redis image, so it takes a little longer.

### What the tests prove

**Algorithms, against a real Redis** (`packages/rate-limiter/test/integration`)

| Test                                                                        | Expected result                                                                                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| token bucket: allows a burst up to capacity, then rejects                   | 3 allowed with `remaining` 2, 1, 0, then a rejection                                                                                                   |
| sliding window: allows up to the limit within the window, then rejects      | 4 allowed with `remaining` 3, 2, 1, 0, then a rejection with a positive retry time                                                                     |
| refills tokens using the Redis clock                                        | an empty bucket accepts a request again after waiting                                                                                                  |
| keeps independent counters per key and per rule                             | another client, or another rule, still has its full limit                                                                                              |
| allows exactly `capacity` out of concurrent requests from several instances | **200 simultaneous requests from 3 instances against a capacity of 50: exactly 50 allowed**. This is what makes the limiter distributed and race-free. |
| stores state under the key prefix with the TTL requested by the strategy    | each Redis key expires once its state no longer matters                                                                                                |
| retries when another client writes the key between the read and the commit  | the transaction is retried and the second attempt is the one stored                                                                                    |
| gives up after the configured attempts when the key keeps changing          | the repository stops retrying and the limiter denies the request                                                                                       |
| does not write anything when the request is rejected                        | a rejection leaves the stored state untouched                                                                                                          |

**The two endpoints, against a real Redis** (`test/integration`)

| Test                                                                  | Expected result                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| allows a burst up to the rule capacity, then responds 429             | `/hello`: five `200`, then `429`                              |
| tells the rejected client when to retry                               | the `429` carries `Retry-After` greater than 0                |
| keeps a separate limit for each client                                | a second IP still gets `200`                                  |
| limits /hello-window with its own sliding window                      | `/hello-window`: five `200`, then `429`                       |
| keeps serving requests without rate limit headers (Redis unreachable) | `200` without `x-ratelimit-*` headers: the API **fails open** |

**Unit tests** cover both algorithms with an injected clock (burst, refill, window weighting, retry times), the queue that serializes transactions per connection, the `@RateLimit` decorator (headers, `429`, `503` when configured to fail closed, client identification), rule validation, the Redis key layout (`<rule>:<algorithm>:<client>`), the failure policy, and the circuit breaker: after 5 consecutive Redis failures it stops calling Redis, and it resumes once Redis recovers.

## 3. Try the endpoints by hand

```bash
./run.sh start
```

This installs the dependencies if needed, builds the project, starts Redis in Docker (on port 6380) and the API on `http://localhost:3000`. Stop it with `Ctrl+C`; the Redis container is removed too, so every run starts with empty counters.

### Token bucket: `GET /hello`

In another terminal:

```bash
for i in 1 2 3 4 5 6 7; do
  curl -s -o /dev/null -D - http://localhost:3000/hello |
    grep -iE '^HTTP|x-ratelimit|retry-after' | tr -d '\r' | paste -sd' ' -
done
```

```
HTTP/1.1 200 OK x-ratelimit-limit: 5 x-ratelimit-remaining: 4
HTTP/1.1 200 OK x-ratelimit-limit: 5 x-ratelimit-remaining: 3
HTTP/1.1 200 OK x-ratelimit-limit: 5 x-ratelimit-remaining: 2
HTTP/1.1 200 OK x-ratelimit-limit: 5 x-ratelimit-remaining: 1
HTTP/1.1 200 OK x-ratelimit-limit: 5 x-ratelimit-remaining: 0
HTTP/1.1 429 Too Many Requests x-ratelimit-limit: 5 x-ratelimit-remaining: 0 retry-after: 1
HTTP/1.1 429 Too Many Requests x-ratelimit-limit: 5 x-ratelimit-remaining: 0 retry-after: 1
```

Wait one second and send another request: it passes, because one token was refilled.

### Sliding window: `GET /hello-window`

Run the same loop against `/hello-window`:

```
HTTP/1.1 200 OK x-ratelimit-limit: 5 x-ratelimit-remaining: 4
...
HTTP/1.1 200 OK x-ratelimit-limit: 5 x-ratelimit-remaining: 0
HTTP/1.1 429 Too Many Requests x-ratelimit-limit: 5 x-ratelimit-remaining: 0 retry-after: 3
```

Unlike the bucket, waiting one second is not enough: the window keeps the last 5 seconds under 5 requests, so `retry-after` is between 1 and 6 seconds depending on where the current window started.

### Redis down: fail-open

While the API is running, stop Redis:

```bash
docker stop iol-rate-limiter-redis-dev
curl -s -o /dev/null -D - http://localhost:3000/hello | grep -iE '^HTTP|x-ratelimit'
```

```
HTTP/1.1 200 OK
```

The API keeps answering `200`, **without** rate limit headers: when Redis is unavailable the limiter lets requests through instead of taking the API down. After 5 consecutive failures a circuit breaker stops calling Redis for 10 seconds, so requests do not wait for Redis timeouts. Restart everything with `Ctrl+C` and `./run.sh start`.

## 4. How to interpret the results

### The rules

| Endpoint        | Algorithm              | Rule                                                      |
| --------------- | ---------------------- | --------------------------------------------------------- |
| `/hello`        | Token bucket           | Bursts of up to **5**, refilled at **1 token per second** |
| `/hello-window` | Sliding window counter | At most **5 requests in any 5-second window**             |

Limits are **per client** (by IP): two clients never share a bucket or a window.

### The responses

| Response                  | Headers                                                        | Meaning                                                            |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `200 OK`                  | `x-ratelimit-limit`, `x-ratelimit-remaining`                   | Allowed; `remaining` is how many more requests fit right now       |
| `429 Too Many Requests`   | `x-ratelimit-limit`, `x-ratelimit-remaining: 0`, `retry-after` | Rejected; `retry-after` is how many seconds to wait                |
| `200 OK` without headers  | —                                                              | Redis is unavailable and the request was let through (fail-open)   |
| `503 Service Unavailable` | —                                                              | Only if the limiter is configured to fail closed (not the default) |

### Token bucket vs. sliding window

Both enforce "5" but mean different things:

- The **token bucket** allows a burst of 5 and then a steady **1 request per second**. A client that was idle can burst again. Over any minute it can get up to about 5 + 60.
- The **sliding window** never lets more than 5 requests into **any** 5-second span, so a client cannot exceed 5 in a row even after waiting a little. It estimates the last 5 seconds as `current window + previous window × overlap`, which needs only two counters per client instead of every timestamp.

## 5. How it works

```
request ─▶ @RateLimit ─▶ RateLimiter ─▶ circuit breaker ─▶ RedisRateLimitRepository ─▶ Redis
             (Fastify)    validates the rule,               WATCH + TIME + HGETALL
                          picks the algorithm               algorithm decides (pure TypeScript)
                                                            MULTI + HSET + PEXPIRE + EXEC
```

- **The algorithms are pure TypeScript functions** (`packages/rate-limiter/src/strategies/`): given the rule, the stored state and the current time, they return the decision and the new state. They know nothing about Redis, so their unit tests use a fixed clock.
- **Redis holds one hash per client and rule**, under `rate-limiter:<rule>:<algorithm>:<client>`, with a TTL so idle clients disappear on their own.
- **Read-modify-write is atomic thanks to an optimistic transaction.** The repository `WATCH`es the key, reads the state and the Redis clock (`TIME`) in one round trip, lets the algorithm decide, and writes with `MULTI`/`EXEC`. If another instance changed the key in between, `EXEC` is discarded and the repository retries (up to 10 times; after that the request is rejected). Rejections write nothing, so they never conflict.
- **`WATCH` belongs to a connection**, so two transactions must never share one at the same time. The repository keeps a few Redis connections and sends each key always to the same one, where transactions run one after another. Requests for the same key in one instance therefore queue up instead of conflicting; conflicts only happen between instances.
- **One clock for every instance:** time comes from Redis, not from each server.
- **If Redis fails** (100 ms timeout per command), the limiter fails open: the request passes without rate limit headers. A circuit breaker stops calling Redis after 5 consecutive failures and tries again after 10 seconds.

## 6. Configuration

`./run.sh start` accepts:

| Variable     | Default | Meaning                     |
| ------------ | ------- | --------------------------- |
| `API_PORT`   | `3000`  | Port of the API             |
| `REDIS_PORT` | `6380`  | Port where Redis is exposed |

To run the API yourself (for example with hot reload against your own Redis):

```bash
docker run -d --rm --name redis -p 6379:6379 redis:7.4-alpine
npm ci
npm run dev
```

The API reads these environment variables:

| Variable                   | Default                  | Meaning                           |
| -------------------------- | ------------------------ | --------------------------------- |
| `REDIS_URL`                | `redis://localhost:6379` | Redis to keep the counters in     |
| `REDIS_COMMAND_TIMEOUT_MS` | `100`                    | How long a Redis command may take |
| `PORT`                     | `3000`                   | Port of the API                   |
| `HOST`                     | `0.0.0.0`                | Interface the API listens on      |

For a production build: `npm run build && npm start`.

## 7. Troubleshooting

| Symptom                                                     | Fix                                                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run test:integration` fails with a Docker error        | Start Docker and retry                                                                                                |
| `./run.sh start` says `Docker is installed but not running` | Start Docker and retry                                                                                                |
| `port is already allocated` (3000 or 6380)                  | Free the port, or change it: `API_PORT=4000 REDIS_PORT=6390 ./run.sh start`                                           |
| `Node.js 22+ is required`                                   | Install Node.js 22 or newer (`nvm install 22`)                                                                        |
| The first `curl` already shows `remaining` below 4          | The limit is per IP and counts every request, including earlier ones: wait a few seconds, or restart `./run.sh start` |

## 8. Repository layout

```
src/                      the Fastify API: controllers with @RateLimit, app wiring, server
test/                     API unit and integration tests
packages/rate-limiter/    the library
  src/core/               rate limiter, rules, errors, types
  src/strategies/         each algorithm: validation, TTL and the decision as a pure function
  src/stores/             Redis repository (optimistic transactions) and per-connection queue
  src/fastify/            Fastify plugin and @RateLimit decorator
  test/                   library unit and integration tests
run.sh                    ./run.sh start: Redis in Docker + the API
```
