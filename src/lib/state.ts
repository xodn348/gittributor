import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { GittributorError } from "./errors";
import { debug, info } from "./logger";
import type { PipelineState, PipelineStatus } from "../types";

const STATE_DIRECTORY = ".gittributor";
const STATE_FILENAME = "state.json";

const VALID_TRANSITIONS: Record<PipelineStatus, ReadonlySet<PipelineStatus>> = {
  idle: new Set(["discovered"]),
  discovered: new Set(["analyzed"]),
  analyzed: new Set(["fixed"]),
  fixed: new Set(["reviewed"]),
  reviewed: new Set(["submitted", "fixed"]),
  submitted: new Set([]),
};

interface PersistedPipelineState extends PipelineState {
  data: Record<string, unknown>;
}

let stateCache: PersistedPipelineState | null = null;
let cachedWorkspacePath: string | null = null;

export class InvalidTransitionError extends GittributorError {
  constructor(from: PipelineStatus, to: PipelineStatus) {
    super(`Invalid state transition from '${from}' to '${to}'`, "INVALID_TRANSITION");
    this.name = "InvalidTransitionError";
  }
}

const getWorkspacePath = (): string => {
  return process.cwd();
};

const isCacheForCurrentWorkspace = (): boolean => {
  return cachedWorkspacePath === getWorkspacePath();
};

const getCachedState = (): PersistedPipelineState | null => {
  if (!isCacheForCurrentWorkspace()) {
    return null;
  }

  return stateCache;
};

const updateCachedState = (state: PersistedPipelineState): PersistedPipelineState => {
  cachedWorkspacePath = getWorkspacePath();
  stateCache = state;
  return state;
};

const getStateDirectoryPath = (): string => {
  return join(process.cwd(), STATE_DIRECTORY);
};

const getStateFilePath = (): string => {
  return join(getStateDirectoryPath(), STATE_FILENAME);
};

const createDefaultState = (): PersistedPipelineState => {
  return {
    version: "1.0.0",
    status: "idle",
    repositories: [],
    issues: [],
    analyses: {},
    fixes: {},
    submissions: [],
    lastUpdated: new Date().toISOString(),
    data: {},
  };
};

const ensureStateDirectory = async (): Promise<void> => {
  await mkdir(getStateDirectoryPath(), { recursive: true });
};

const withFreshTimestamp = (state: PersistedPipelineState): PersistedPipelineState => {
  return {
    ...state,
    lastUpdated: new Date().toISOString(),
  };
};

const extractData = (state: PipelineState | PersistedPipelineState): Record<string, unknown> => {
  const candidate = state as Partial<PersistedPipelineState>;
  if (candidate.data && typeof candidate.data === "object") {
    return candidate.data;
  }

  const cachedState = getCachedState();
  if (cachedState?.data && typeof cachedState.data === "object") {
    return cachedState.data;
  }

  return {};
};

const parseState = (value: unknown): PersistedPipelineState => {
  const parsed = value as Partial<PersistedPipelineState>;

  return {
    version: typeof parsed.version === "string" ? parsed.version : "1.0.0",
    status: (parsed.status as PipelineStatus | undefined) ?? "idle",
    repositories: Array.isArray(parsed.repositories) ? parsed.repositories : [],
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    analyses: parsed.analyses && typeof parsed.analyses === "object" ? parsed.analyses : {},
    fixes: parsed.fixes && typeof parsed.fixes === "object" ? parsed.fixes : {},
    submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
    lastUpdated:
      typeof parsed.lastUpdated === "string" ? parsed.lastUpdated : new Date().toISOString(),
    data: parsed.data && typeof parsed.data === "object" ? parsed.data : {},
  };
};

export const loadState = async (): Promise<PersistedPipelineState> => {
  await ensureStateDirectory();

  const stateFile = Bun.file(getStateFilePath());
  if (!(await stateFile.exists())) {
    const initialState = createDefaultState();
    updateCachedState(initialState);
    debug("State file not found; returning default idle state.");
    return initialState;
  }

  const loaded = parseState(await stateFile.json());
  updateCachedState(loaded);
  debug(`State loaded from disk with status '${loaded.status}'.`);
  return loaded;
};

export const saveState = async (state: PipelineState): Promise<void> => {
  await ensureStateDirectory();

  const nextState: PersistedPipelineState = withFreshTimestamp({
    ...state,
    data: extractData(state),
  });

  await Bun.write(getStateFilePath(), JSON.stringify(nextState, null, 2));
  updateCachedState(nextState);
  info(`Pipeline state saved (${nextState.status}).`);
};

export const transition = (from: PipelineStatus, to: PipelineStatus): PipelineStatus => {
  if (to === "idle") {
    return "idle";
  }

  if (VALID_TRANSITIONS[from].has(to)) {
    return to;
  }

  throw new InvalidTransitionError(from, to);
};

export const getStateData = <T>(key: string): T | null => {
  const cachedState = getCachedState();

  if (!cachedState) {
    return null;
  }

  if (!(key in cachedState.data)) {
    return null;
  }

  return cachedState.data[key] as T;
};

export const setStateData = async (key: string, data: unknown): Promise<void> => {
  const currentState = getCachedState() ?? (await loadState());

  const nextState: PersistedPipelineState = {
    ...currentState,
    data: {
      ...currentState.data,
      [key]: data,
    },
  };

  await saveState(nextState);
  debug(`Persisted state data for key '${key}'.`);
};
