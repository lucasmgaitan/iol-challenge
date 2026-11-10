# Plan: Rate Limiter en TypeScript

## 1. Alcance

Una librería de rate limiting distribuido (`@iol/rate-limiter`) y una app de Fastify (`@iol/api`) que la consume como dependencia, siguiendo el capítulo 4 del libro: reglas declaradas con el decorador `@RateLimit` en cada controller y estado compartido en Redis para que varias instancias respeten el mismo límite. Si la cuenta supera el límite, la respuesta es `429` con los headers `X-Ratelimit-*`.

**Queda afuera, a propósito:** los 5 algoritmos del libro, un servicio de reglas dinámico y multi-datacenter. Cada uno se menciona en `DESIGN.md` como trade-off.

## 2. Decisiones de diseño clave

| Tema           | Decisión                                                                                                                                                                                                   | Por qué                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Algoritmos     | **Token bucket** (principal) + **sliding window counter**                                                                                                                                                  | Son los dos que el libro recomienda para producción. Dos alcanzan para mostrar la abstracción sin inflar el código.                                                                |
| Interfaz       | Un módulo "profundo": `limiter.consume(key, rule) → Decision { allowed, limit, remaining, retryAfterMs }`                                                                                                  | Estilo APOSD: interfaz chica que esconde algoritmo, storage y reloj.                                                                                                               |
| Storage        | `RedisRateLimitRepository` con **transacciones optimistas** (`WATCH`/`MULTI`/`EXEC`, reintentos acotados); el dominio depende del puerto `RateLimitRepository` y los algoritmos son funciones puras en TS  | Todo en un solo lenguaje y testeable con reloj inyectado. `WATCH` hace atómico el read-modify-write; cuesta 2 viajes a Redis por request (Lua era 1) y reintentos bajo contención. |
| Reloj          | `TIME` de Redis, leído en el mismo pipeline que el estado                                                                                                                                                  | Un solo reloj para todas las instancias; los algoritmos reciben `nowMs`, así que sus tests unitarios no dependen del tiempo real.                                                  |
| Reglas         | Declaradas en el decorador `@RateLimit(rule)` de cada handler                                                                                                                                              | La regla vive junto al código que protege y TypeScript la valida. Trade-off: cambiar un límite requiere redeploy.                                                                  |
| Falla de Redis | Timeouts en ioredis (100 ms por comando, sin cola offline ni reintentos) + **fail-open** por defecto (`failurePolicy`, `closed` → 503) + circuit breaker de **cockatiel** inyectado como `ExecutionPolicy` | La API no cae si cae Redis; el breaker evita esperar el timeout en cada request mientras Redis no responde. El dominio no depende de cockatiel.                                    |
| HTTP           | **Fastify**; la librería expone `@iol/rate-limiter/fastify` (plugin + decorador estándar)                                                                                                                  | El núcleo no depende de Fastify (peerDependency opcional).                                                                                                                         |
| Ejecución      | `./run.sh start`: Redis en Docker + la API con Node                                                                                                                                                        | Alcanza para probar los endpoints a mano; la verificación automática son los tests de Vitest (unitarios + integración con Redis real).                                             |

## 3. Estructura

```
iol-challenge/                 la app (@iol/api) y raíz del workspace de npm
  src/
    controllers/               controllers decorados con @RateLimit
    http/                      armado de la app
    server.ts
  test/                        unit (limiter falso) + integration (Redis real)
  packages/
    rate-limiter/              @iol/rate-limiter (acá va DESIGN.md)
      src/core/                dominio: RateLimiter, RateLimitRepository (puerto), Rule, Decision
      src/strategies/          validación y TTL por algoritmo (patrón Strategy)
      src/stores/              infra: redis-rate-limit-repository.ts + serial-queue.ts
      src/fastify/             plugin + decorador @RateLimit
  run.sh                       ./run.sh start (Redis en Docker + API local)
  README.md
```

## 4. Fases

1. **Setup:** `git init`, Node 22, TS strict, Vitest, ESLint/Prettier, script `npm test` y CI de GitHub Actions.
2. **Core + algoritmos:** token bucket y sliding window. (Primero se implementaron en TS; en la fase 3 se unificaron en Lua.)
3. **RedisStore + Lua:** tests de integración contra un Redis real y un test de concurrencia (por ejemplo, 200 requests en paralelo con límite 50 deben dar exactamente 50 permitidas).
4. **Workspace + Fastify:** librería instalable, plugin y decorador `@RateLimit`, app con `GET /hello` y tests e2e.
5. **Resiliencia:** timeouts, fail-open/closed y circuit breaker.
6. **Docs:** README (cómo correrlo) y `DESIGN.md` con arquitectura, trade-offs y una sección honesta sobre el uso de IA.

## 5. Para la entrevista

- El código va a ser chico y vas a poder explicar cada parte. Lo más delicado es la transacción optimista: por qué `WATCH` necesita una conexión que no se comparta entre transacciones concurrentes (de ahí la cola por conexión).
- En `DESIGN.md` conviene anotar lo que **decidiste no hacer** y por qué. Eso es justo lo que miran cuando evalúan "avoiding overengineering".

## 6. Scaffolding (fase 1)

| Tema               | Elección                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Gestor de paquetes | npm                                                                                         |
| Módulos            | ESM (`"type": "module"`, `module: NodeNext`)                                                |
| Build / dev        | `tsc` (build) + `tsx` (dev)                                                                 |
| TypeScript         | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`                        |
| Tests              | Vitest (+ coverage v8)                                                                      |
| Lint / format      | ESLint flat config (`typescript-eslint` strict type-checked) + Prettier                     |
| Layout             | La app en la raíz (`src/`) y la librería en `packages/rate-limiter/`, como workspace de npm |
| CI                 | GitHub Actions: typecheck, lint, format, shellcheck, tests unitarios e integración, build   |

## Estado

- [x] Fase 1: setup
- [x] Fase 2: core + algoritmos
- [x] Fase 3: RedisStore + Lua
- [x] Fase 4: workspace + Fastify
- [x] Fase 5: resiliencia
- [x] Recorte: se eliminaron la observabilidad (métricas y observer) y la prueba de carga (k6, Docker Compose); se mantienen los dos endpoints, el decorador, los algoritmos y la resiliencia
- [x] Refactor: los algoritmos pasan de Lua a TypeScript (funciones puras) y Redis queda detrás de `RedisRateLimitRepository` con `WATCH`/`MULTI`/`EXEC`
- [ ] Fase 6: README y DESIGN
