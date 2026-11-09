---
name: import-aliases
description: Cómo importar módulos en rate-limiter/ usando alias por carpeta (subpath imports `#carpeta/*`). Usar siempre que se agregue o mueva un import, se cree una carpeta nueva en src/, o se escriban tests.
---

# Imports con alias por carpeta

Todo import de código propio usa un alias por carpeta de `src/`. Nunca rutas relativas (`./`, `../`), ni siquiera dentro de la misma carpeta.

```ts
import { Algorithm, type Rule } from '#core/types.js';
import { tokenBucket } from '#strategies/token-bucket.js';
import { MemoryStore } from '#stores/memory-store.js';
```

Aplica igual en `src/` y en `test/`. Lo controla ESLint (`no-restricted-imports`), así que `npm run lint` falla con un import relativo.

## Cómo está configurado

Se usan los **subpath imports** de Node (`"imports"` en `package.json`), no `paths` de tsconfig. Los `paths` no se reescriben al compilar y harían fallar a `node dist/...` en runtime. Los subpath imports los resuelven Node, TypeScript, Vitest y tsx sin dependencias extra.

Cada alias tiene dos destinos, elegidos por la condición `source`:

```json
"imports": {
  "#core/*": { "source": "./src/core/*", "default": "./dist/core/*" }
}
```

| Entorno | Condición | Resuelve a |
|---|---|---|
| TypeScript (typecheck, editor) | `customConditions: ["source"]` en `tsconfig.json` | `src/` |
| Vitest | `resolve.conditions` y `ssr.resolve.conditions` en `vitest.config.ts` | `src/` |
| Desarrollo | `tsx --conditions=source` (script `dev`) | `src/` |
| Producción | ninguna (`node dist/...`) | `dist/` |

## Reglas

1. El prefijo es `#` + el nombre de la carpeta de primer nivel de `src/`: `#core/*`, `#strategies/*`, `#stores/*`. No usar `@`: Node exige que los subpath imports empiecen con `#`, y `@` además se confunde con paquetes de npm con scope (`@types/node`).
2. La extensión es `.js` aunque el archivo sea `.ts` (ESM con `NodeNext`).
3. No crear alias para subcarpetas ni para archivos sueltos: un alias por carpeta de primer nivel.
4. Los paquetes de npm se importan por su nombre, como siempre (`'vitest'`, `'fastify'`).

## Al crear una carpeta nueva en `src/`

Por ejemplo `src/http/`:

1. Agregar la entrada en `package.json`:
   ```json
   "#http/*": { "source": "./src/http/*", "default": "./dist/http/*" }
   ```
2. Agregar el alias al `message` de la regla `no-restricted-imports` en `eslint.config.js`.
3. Correr `npm run check` y `npm run build` desde `rate-limiter/`.

No hace falta tocar `tsconfig.json` ni `vitest.config.ts`.
