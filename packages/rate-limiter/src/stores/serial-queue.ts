export class SerialQueue {
  private tail: Promise<void> | undefined;

  async run<T>(task: () => Promise<T>): Promise<T> {
    const result = runAfter(this.tail, task);
    const settledResult = settled(result);
    this.tail = settledResult;
    try {
      return await result;
    } finally {
      if (this.tail === settledResult) this.tail = undefined;
    }
  }
}

async function runAfter<T>(
  previous: Promise<void> | undefined,
  task: () => Promise<T>,
): Promise<T> {
  if (previous) await previous;
  return await task();
}

async function settled(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    return;
  }
}
