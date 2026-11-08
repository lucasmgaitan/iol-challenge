# Plan: Rate Limiter en TypeScript

## 1. Alcance

Un rate limiter distribuido que funciona como middleware HTTP, siguiendo el capítulo 4 del libro: reglas configurables y estado compartido en Redis para que varias instancias respeten el mismo límite. Si la cuenta supera el límite, la respuesta es `429` con los headers `X-Ratelimit-*`.

**Queda afuera, a propósito:** los 5 algoritmos del libro, un servicio de reglas dinámico y multi-datacenter. Cada uno se menciona en `DESIGN.md` como trade-off.

## 2. Decisiones de diseño clave

| Tema           | Decisión                                                                                                  | Por qué                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Algoritmos     | **Token bucket** (principal) + **sliding window counter**                                                 | Son los dos que el libro recomienda para producción. Dos alcanzan para mostrar la abstracción sin inflar el código.                                             |
| Interfaz       | Un módulo "profundo": `limiter.consume(key, rule) → Decision { allowed, limit, remaining, retryAfterMs }` | Estilo APOSD: interfaz chica que esconde algoritmo, storage y reloj.                                                                                            |
| Storage        | `MemoryStore` (tests/dev) y `RedisStore` con **scripts Lua atómicos**                                     | Node no tiene condiciones de carrera en memoria; la carrera real aparece entre instancias. Lua hace atómico el read-modify-write, que es la solución del libro. |
| Reloj          | `Clock` inyectable en memoria; en Redis se usa `TIME` dentro del Lua                                      | Tests deterministas sin `sleep`, y sin depender de los relojes de cada instancia.                                                                               |
| Reglas         | Archivo YAML validado con `zod` (por ruta + identificador: IP, API key)                                   | Mismo formato tipo Lyft que muestra el libro; si la config es inválida, el arranque falla rápido.                                                               |
| Falla de Redis | Timeout corto + **fail-open** configurable + circuit breaker simple                                       | Manejo de errores y diseño defensivo, que son _nice to have_ explícitos.                                                                                        |
| HTTP           | **Fastify** (trae pino y `inject()` para tests)                                                           | Menos dependencias, y logging incluido.                                                                                                                         |
| Observabilidad | Logs con pino + `/metrics` con `prom-client` (allowed/rejected/errors)                                    | Nice to have, de bajo costo.                                                                                                                                    |
| Deploy         | `docker-compose up` → app + Redis                                                                         | Fácil de desplegar.                                                                                                                                             |

## 3. Estructura propuesta

```
<raíz del repo>/
  src/
    core/          # Decision, Rule, Clock, interfaz RateLimiter
    algorithms/    # tokenBucket.ts, slidingWindow.ts
    stores/        # memoryStore.ts, redisStore.ts, lua/*.lua
    config/        # carga + validación de reglas YAML
    http/          # plugin Fastify, headers, identificación del cliente
    resilience/    # circuit breaker, timeouts
    server.ts      # app demo
  test/
    unit/          # algoritmos con reloj falso, config, breaker
    integration/   # RedisStore real (testcontainers), concurrencia
    e2e/           # Fastify inject: 200 → 429, headers
  DESIGN.md  README.md  docker-compose.yml  Dockerfile
```

## 4. Fases

1. **Setup:** `git init`, Node 22, TS strict, Vitest, ESLint/Prettier, script `npm test` y CI de GitHub Actions.
2. **Core + algoritmos en memoria:** token bucket y sliding window con reloj falso. Tests de bordes: ráfagas, refill parcial, cambio de ventana y límites en 0.
3. **RedisStore + Lua:** tests de integración contra un Redis real y un test de concurrencia (por ejemplo, 200 requests en paralelo con límite 50 deben dar exactamente 50 permitidas).
4. **Middleware HTTP + config:** headers, 429, reglas por ruta y tests e2e.
5. **Resiliencia y observabilidad:** timeouts, fail-open/closed, circuit breaker, logs y métricas.
6. **Deploy y docs:** Docker, README (cómo correrlo) y `DESIGN.md` con arquitectura, trade-offs y una sección honesta sobre el uso de IA.

## 5. Para la entrevista

- El código va a ser chico y vas a poder explicar cada parte. Los scripts Lua son lo más "mágico", así que los comentamos línea por línea.
- En `DESIGN.md` conviene anotar lo que **decidiste no hacer** y por qué. Eso es justo lo que miran cuando evalúan "avoiding overengineering".

## 6. Scaffolding (fase 1)

| Tema               | Elección                                                                |
| ------------------ | ----------------------------------------------------------------------- |
| Gestor de paquetes | npm                                                                     |
| Módulos            | ESM (`"type": "module"`, `module: NodeNext`)                            |
| Build / dev        | `tsc` (build) + `tsx` (dev)                                             |
| TypeScript         | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`    |
| Tests              | Vitest (+ coverage v8)                                                  |
| Lint / format      | ESLint flat config (`typescript-eslint` strict type-checked) + Prettier |
| Layout             | Un solo paquete en la raíz del repo                                     |
| CI                 | GitHub Actions: typecheck, lint, format, test, build                    |

## Estado

- [x] Fase 1: setup
- [ ] Fase 2: core + algoritmos en memoria
- [ ] Fase 3: RedisStore + Lua
- [ ] Fase 4: middleware HTTP + config
- [ ] Fase 5: resiliencia y observabilidad
- [ ] Fase 6: deploy y docs
