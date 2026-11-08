---
name: code-conventions
description: Convenciones de código del proyecto (comentarios, idioma, nombres de archivo). Usar siempre que se escriba, edite, renombre o revise código en rate-limiter/ (src/, test/, configs, scripts Lua).
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

## Al terminar

- Eliminar los comentarios que no entren en las excepciones, y no borrar las válidas.
- Correr `npm run check` desde `rate-limiter/`.
