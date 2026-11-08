---
name: code-conventions
description: Convenciones de código del proyecto (comentarios, idioma, nombres de archivo, no magic strings, async/await). Usar siempre que se escriba, edite, renombre o revise código en rate-limiter/ (src/, test/, configs, scripts Lua).
---

# Convenciones de código

## 1. No escribir comentarios

El código tiene que explicarse solo. Por defecto no se escriben comentarios.

- No agregar comentarios que describan **qué** hace el código, ni JSDoc en tipos, interfaces o funciones.
- Si algo necesita un comentario para entenderse, primero mejorar el código:
  - nombres más precisos de variables, funciones y tipos;
  - extraer una función o constante con nombre;
  - un test que documente el comportamiento.
- En los tests, el nombre del `it(...)` es la explicación. No agregar comentarios dentro del cuerpo.
- Las decisiones de diseño y los trade-offs van en `rate-limiter/DESIGN.md`, no en el código.

### Excepciones (las únicas permitidas)

- **Derivaciones no obvias**, como una fórmula matemática que no se puede leer directamente del código. Una línea, sin prosa:
  ```ts
  // previous * (1 - t/W) <= limit - 1 - current  →  t >= W * (1 - (limit - 1 - current) / previous)
  ```
- **Código que el autor no domina del todo.** El enunciado del challenge exige documentar con un comentario cualquier código generado por IA que el autor no entienda por completo; lo que no tiene comentario se asume entendido y se puede preguntar en la entrevista. Ese comentario lo escribe o aprueba el autor, es breve y explica el porqué. Caso típico: los scripts Lua. Un agente no agrega estos comentarios por su cuenta: pregunta si hace falta.
- **Directivas** que interpretan las herramientas: `// @ts-check`, `// eslint-disable-next-line <regla>` (con la regla explícita), `#!/usr/bin/env node`.

Ante la duda, no comentar.

## 2. El código se escribe solo en inglés

Identificadores, strings, mensajes de error, logs, nombres de tests, comentarios permitidos y mensajes de commit van en inglés.

```ts
throw new RangeError(`limit must be a positive integer, got ${String(rule.limit)}`);
it('allows up to the limit within one window', () => { ... });
```

## 3. Nombres de archivo en kebab-case

Todos los archivos y carpetas de código van en minúsculas, con palabras separadas por guiones.

| Bien | Mal |
|---|---|
| `token-bucket.ts` | `tokenBucket.ts`, `TokenBucket.ts`, `token_bucket.ts` |
| `memory-store.test.ts` | `memoryStore.test.ts` |
| `lua/token-bucket.lua` | `lua/tokenBucket.lua` |

Esto aplica al nombre del archivo, no a lo que exporta: `token-bucket.ts` exporta `tokenBucket` y `TokenBucketState`. Al renombrar, actualizar los imports (con extensión `.js`, por ESM).

Quedan afuera los nombres que fija una herramienta o una convención externa: `README.md`, `DESIGN.md`, `SKILL.md`, `Dockerfile`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.nvmrc`, `docker-compose.yml`.

## 4. No magic strings

Todo valor string se define una sola vez como constante con nombre y se usa a través de ella. Esto incluye discriminadores, claves y prefijos de Redis, separadores, nombres de headers y métricas, valores de configuración y mensajes de error.

- **Conjuntos de valores** (como un enum): objeto `as const` y un tipo derivado con el mismo nombre. No usar `enum` de TypeScript.
  ```ts
  export const Algorithm = { TokenBucket: 'token-bucket', SlidingWindow: 'sliding-window' } as const;
  export type Algorithm = (typeof Algorithm)[keyof typeof Algorithm];
  ```
- **Valores sueltos**: `const` en `UPPER_SNAKE_CASE`, en el módulo que es dueño del concepto.
  ```ts
  const STATE_KEY_SEPARATOR = ':';
  ```
- **Mensajes con datos variables**: una función dentro de un objeto de mensajes, para que el texto viva en un solo lugar y los tests puedan comparar contra él.
  ```ts
  export const RuleErrorMessage = {
    positiveInteger: (field: string, value: number) => `${field} must be a positive integer, got ${String(value)}`,
  } as const;
  ```
- Los tests usan las mismas constantes (`algorithm: Algorithm.TokenBucket`, `toThrow(CLOCK_BACKWARDS_ERROR)`), no copias del literal.

Quedan afuera:
- especificadores de import;
- títulos de `describe` / `it`;
- datos arbitrarios de tests, como claves de ejemplo (`'a'`, `'user-1'`);
- nombres de propiedad tipados como `keyof`, porque los valida el compilador (`requirePositiveInteger(rule, 'capacity')`).

## 5. async/await, no Promises explícitas

El código asíncrono se escribe con `async`/`await`.

- No usar `.then()`, `.catch()` ni `.finally()`, ni construir promesas a mano con `Promise.resolve`, `Promise.reject` o `new Promise(...)`.
- **Toda función `async` tiene al menos un `await` real.** Lo controla `@typescript-eslint/require-await`, que está activa; no se desactiva ni con directivas.
- **Una función que no es `async` no devuelve promesas.** Si no hay nada que esperar, la función es síncrona y devuelve el valor directamente.
- Cuando una interfaz tiene implementaciones síncronas y asíncronas, el tipo de retorno es `T | Promise<T>`. Cada implementación devuelve lo que corresponde, y quien llama hace `await` siempre.
  ```ts
  interface RateLimiter {
    consume(key: string, rule: Rule): Decision | Promise<Decision>;
  }
  class MemoryStore implements RateLimiter {
    consume(key: string, rule: Rule): Decision { ... }
  }
  class RedisStore implements RateLimiter {
    async consume(key: string, rule: Rule): Promise<Decision> { ... await this.redis.evalsha(...) ... }
  }
  const decision = await limiter.consume(key, rule);
  ```
- Los errores se lanzan con `throw` también en las funciones síncronas. Al llamar con `await`, el error llega igual.
- Los combinadores sí se usan, siempre con `await`: `await Promise.all(...)`, `await Promise.race(...)`.
- Para esperar un tiempo usar `await setTimeout(ms)` de `node:timers/promises`, no `new Promise(r => setTimeout(r, ms))`.

## Al terminar

- Eliminar los comentarios que no entren en las excepciones, y no borrar las válidas.
- Correr `npm run check` desde `rate-limiter/`.
