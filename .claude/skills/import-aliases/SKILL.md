---
name: import-aliases
description: Cómo importar módulos en el repo (la app en src/ y la librería en packages/rate-limiter/) usando alias por carpeta (subpath imports `#carpeta/*`) y nombres de paquete entre workspaces. Usar siempre que se agregue o mueva un import, se cree una carpeta nueva en src/, se cree un paquete, o se escriban tests.
---

# Imports con alias por carpeta

La raíz del repo es un workspace de npm con dos paquetes:

| Paquete             | Carpeta                         | Alias propios                                         |
| ------------------- | ------------------------------- | ----------------------------------------------------- |
| `@iol/rate-limiter` | `packages/rate-limiter/`        | `#core/*`, `#strategies/*`, `#stores/*`, `#fastify/*` |
| `@iol/api`          | raíz del repo (`src/`, `test/`) | `#controllers/*`, `#http/*`                           |

**Dentro de un paquete**, todo import de código propio usa un alias por carpeta de su `src/`. Nunca rutas relativas (`./`, `../`), ni siquiera dentro de la misma carpeta.

**Entre paquetes**, se importa por el nombre del paquete y sus `exports` públicos, nunca con un alias del otro paquete ni con una ruta a su `src/`.

```ts
// packages/rate-limiter/src/core/rate-limiter.ts
import { strategies } from '#strategies/registry.js';

// src/http/app.ts
import type { RateLimiter } from '@iol/rate-limiter';
import { rateLimiterPlugin } from '@iol/rate-limiter/fastify';
import { HelloController } from '#controllers/hello-controller.js';
```

Aplica igual en `src/` y en `test/`. Lo controla ESLint (`no-restricted-imports`), así que `npm run lint` falla con un import relativo.

## Cómo está configurado

Se usan los **subpath imports** (`"imports"`) y los **exports** (`"exports"`) de `package.json`, no `paths` de tsconfig. Los `paths` no se reescriben al compilar y harían fallar a `node dist/...` en runtime.

Cada alias y cada export tienen dos destinos, elegidos por la condición `source`:

```json
"imports": {
  "#core/*": { "source": "./src/core/*", "default": "./dist/core/*" }
},
"exports": {
  ".": { "source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }
}
```

| Entorno                        | Condición                                                             | Resuelve a |
| ------------------------------ | --------------------------------------------------------------------- | ---------- |
| TypeScript (typecheck, editor) | `customConditions: ["source"]` en `tsconfig.base.json`                | `src/`     |
| Vitest                         | `resolve.conditions` y `ssr.resolve.conditions` en `vitest.shared.ts` | `src/`     |
| Desarrollo                     | `tsx --conditions=source` (script `dev`)                              | `src/`     |
| Producción                     | ninguna (`node dist/...`)                                             | `dist/`    |

Por eso la app usa el código fuente de la librería en desarrollo y en los tests sin compilarla antes. En producción, `npm run build` compila primero la librería (`--workspaces`) y después la app.

## Reglas

1. El prefijo es `#` + el nombre de la carpeta de primer nivel de `src/`. No usar `@`: Node exige que los subpath imports empiecen con `#`, y `@` además se confunde con paquetes de npm con scope (`@types/node`).
2. La extensión es `.js` aunque el archivo sea `.ts` (ESM con `NodeNext`).
3. No crear alias para subcarpetas ni para archivos sueltos: un alias por carpeta de primer nivel.
4. Los paquetes de npm y los del workspace se importan por su nombre (`'fastify'`, `'@iol/rate-limiter'`).
5. Lo que otro paquete necesita usar se expone en el `index.ts` del punto de entrada correspondiente (`src/index.ts`, `src/fastify/index.ts`).

## Al crear una carpeta nueva en `src/`

Por ejemplo `src/plugins/` en la app:

1. Agregar la entrada en el `package.json` de ese paquete:
   ```json
   "#plugins/*": { "source": "./src/plugins/*", "default": "./dist/plugins/*" }
   ```
2. Correr `npm run check` y `npm run build` desde la raíz del repo.

No hace falta tocar `tsconfig.json` ni la config de Vitest.
