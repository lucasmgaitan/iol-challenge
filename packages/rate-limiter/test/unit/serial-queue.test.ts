import { setTimeout } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { SerialQueue } from '#stores/serial-queue.js';

describe('SerialQueue', () => {
  it('runs tasks one after another in the order they were queued', async () => {
    const queue = new SerialQueue();
    const events: string[] = [];
    const task = (name: string, delayMs: number) => async () => {
      events.push(`start ${name}`);
      await setTimeout(delayMs);
      events.push(`end ${name}`);
      return name;
    };
    const results = await Promise.all([queue.run(task('a', 20)), queue.run(task('b', 0))]);
    expect(results).toEqual(['a', 'b']);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('keeps running queued tasks after one fails', async () => {
    const queue = new SerialQueue();
    const failure = new Error('boom');
    const failing = queue.run(async () => {
      await setTimeout(0);
      throw failure;
    });
    const next = queue.run(async () => {
      await setTimeout(0);
      return 'next';
    });
    await expect(failing).rejects.toBe(failure);
    expect(await next).toBe('next');
  });
});
