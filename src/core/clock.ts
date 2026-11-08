/** Fuente de tiempo inyectable: permite tests deterministas sin `sleep`. */
export interface Clock {
  /** Milisegundos desde epoch. */
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** Reloj controlable manualmente, para tests. */
export class FakeClock implements Clock {
  constructor(private current = 0) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) throw new RangeError('cannot move clock backwards');
    this.current += ms;
  }
}
