/**
 * Waits for the given number of milliseconds.
 */
export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retries an async function up to `attempts` times with exponential backoff.
 * Backoff delay sequence: backoff, backoff * 2, backoff * 4, ...
 */
export async function retry<T>(
  fn: () => Promise<T>,
  attempts: number,
  backoff: number,
): Promise<T> {
  if (attempts < 1) {
    throw new RangeError("attempts must be at least 1");
  }

  let lastError: unknown;

  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attemptIndex === attempts - 1) {
        throw error;
      }

      const delayMs = backoff * 2 ** attemptIndex;
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Truncates a string to len characters, appending "..." when truncated.
 */
export function truncate(str: string, len: number): string {
  const safeLength = Math.max(0, len);
  if (str.length <= safeLength) {
    return str;
  }

  return `${str.slice(0, safeLength)}...`;
}

/**
 * Formats milliseconds into a human-readable duration string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  if (ms < 60000) {
    const seconds = ms / 1000;
    const formattedSeconds = Number.isInteger(seconds)
      ? String(seconds)
      : String(Number(seconds.toFixed(1)));
    return `${formattedSeconds}s`;
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}
