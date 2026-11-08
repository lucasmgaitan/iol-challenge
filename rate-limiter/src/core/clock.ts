export const CLOCK_BACKWARDS_ERROR = 'cannot move clock backwards';

export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export class FakeClock implements Clock {
  constructor(private current = 0) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) throw new RangeError(CLOCK_BACKWARDS_ERROR);
    this.current += ms;
  }
}
