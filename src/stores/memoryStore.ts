import { slidingWindow, type SlidingWindowState } from '../algorithms/slidingWindow.js';
import { tokenBucket, type TokenBucketState } from '../algorithms/tokenBucket.js';
import { systemClock, type Clock } from '../core/clock.js';
import { assertValidRule } from '../core/rule.js';
import type { Decision, RateLimiter, Rule } from '../core/types.js';

type State = TokenBucketState | SlidingWindowState;

/**
 * RateLimiter en memoria de un solo proceso. Sirve para tests y desarrollo;
 * con varias instancias cada una tendría su propio contador (para eso está Redis).
 *
 * No hay condiciones de carrera: `consume` es síncrono por dentro, y el event loop
 * de Node no lo interrumpe entre leer y escribir el estado.
 *
 * Trade-off conocido: el Map no expira claves. Con muchas claves únicas crece
 * sin límite; en Redis eso lo resuelve el TTL.
 */
export class MemoryStore implements RateLimiter {
  private readonly states = new Map<string, State>();

  constructor(private readonly clock: Clock = systemClock) {}

  consume(key: string, rule: Rule): Promise<Decision> {
    // Un método que devuelve Promise nunca debe lanzar de forma síncrona.
    try {
      return Promise.resolve(this.consumeSync(key, rule));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private consumeSync(key: string, rule: Rule): Decision {
    assertValidRule(rule);
    const now = this.clock.now();
    // El algoritmo forma parte de la clave: cambiar de algoritmo no mezcla estados.
    const stateKey = `${rule.algorithm}:${key}`;

    const result =
      rule.algorithm === 'token-bucket'
        ? tokenBucket(this.states.get(stateKey) as TokenBucketState | undefined, rule, now)
        : slidingWindow(this.states.get(stateKey) as SlidingWindowState | undefined, rule, now);

    this.states.set(stateKey, result.state);
    return result.decision;
  }
}
