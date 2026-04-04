type GlobalLockState = {
  tail: Promise<void>;
};

const GLOBAL_LOCK_KEY = "__gittributorGlobalTestLock__";

const getLockState = (): GlobalLockState => {
  const globalScope = globalThis as typeof globalThis & {
    [GLOBAL_LOCK_KEY]?: GlobalLockState;
  };

  if (!globalScope[GLOBAL_LOCK_KEY]) {
    globalScope[GLOBAL_LOCK_KEY] = {
      tail: Promise.resolve(),
    };
  }

  return globalScope[GLOBAL_LOCK_KEY];
};

export const acquireGlobalTestLock = async (): Promise<() => void> => {
  const lockState = getLockState();

  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  const previous = lockState.tail;
  lockState.tail = previous.then(() => next);
  await previous;

  return release;
};
