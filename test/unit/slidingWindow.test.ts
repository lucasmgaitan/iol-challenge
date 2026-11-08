import { describe, expect, it } from 'vitest';
import { slidingWindow, type SlidingWindowState } from '../../src/algorithms/slidingWindow.js';
import type { Decision, SlidingWindowRule } from '../../src/core/types.js';

const rule: SlidingWindowRule = { algorithm: 'sliding-window', limit: 4, windowMs: 1000 };

function run(times: number[], r: SlidingWindowRule = rule): Decision[] {
  let state: SlidingWindowState | undefined;
  return times.map((t) => {
    const out = slidingWindow(state, r, t);
    state = out.state;
    return out.decision;
  });
}

describe('slidingWindow', () => {
  it('allows up to the limit within one window', () => {
    const d = run([0, 100, 200, 300, 400]);
    expect(d.map((x) => x.allowed)).toEqual([true, true, true, true, false]);
    expect(d.map((x) => x.remaining)).toEqual([3, 2, 1, 0, 0]);
  });

  it('weights the previous window by its remaining overlap', () => {
    // 4 requests en [0,1000). A t=1250 la ventana anterior pesa 75% → 3 estimadas → entra 1.
    const d = run([0, 0, 0, 0, 1250, 1250]);
    expect(d[4]?.allowed).toBe(true);
    expect(d[5]?.allowed).toBe(false);
  });

  it('prevents the fixed-window double burst at the boundary', () => {
    // Una ventana fija dejaría pasar 4 en t=999 y otras 4 en t=1000.
    const d = run([999, 999, 999, 999, 1000, 1000]);
    expect(d.slice(4).map((x) => x.allowed)).toEqual([false, false]);
  });

  it('computes retry-after within the current window', () => {
    // previous=4, current=0, a t=1000 estimado=4. Necesita previous*(1-t/W) <= 3 → t >= 250.
    const d = run([0, 0, 0, 0, 1000]);
    expect(d[4]).toMatchObject({ allowed: false, retryAfterMs: 250 });
    // Y efectivamente a t=1250 entra (verificado en el test de overlap).
  });

  it('computes retry-after spanning into the next window', () => {
    // current=4 en [0,1000) a t=500: hay que esperar a 1000 + 250.
    const d = run([0, 0, 0, 0, 500]);
    expect(d[4]).toMatchObject({ allowed: false, retryAfterMs: 750 });
  });

  it('forgets everything after two idle windows', () => {
    const d = run([0, 0, 0, 0, 2000, 2000, 2000, 2000]);
    expect(d.slice(4).map((x) => x.allowed)).toEqual([true, true, true, true]);
  });

  it('does not count rejected requests', () => {
    const d = run([0, 0, 0, 0, 0, 0, 0, 1500]);
    // Si los rechazos contaran, current sería 7 y a t=1500 seguiría bloqueado.
    expect(d[7]?.allowed).toBe(true);
  });

  it('keeps the newest state when the clock goes backwards', () => {
    const d = run([5000, 5000, 5000, 5000, 3000]);
    expect(d[4]?.allowed).toBe(false);
  });
});
