import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineState } from "../src/types";
import {
  InvalidTransitionError,
  getStateData,
  loadState,
  saveState,
  setStateData,
  transition,
} from "../src/lib/state";

describe("state persistence manager", () => {
  let tempDir: string;
  let previousCwd: string;

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempDir = await mkdtemp(join(tmpdir(), "gittributor-state-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  test("loadState returns idle when state file does not exist", async () => {
    const state = await loadState();
    const directoryStats = await stat(join(tempDir, ".gittributor"));

    expect(directoryStats.isDirectory()).toBe(true);
    expect(state.status).toBe("idle");
    expect(state.repositories).toEqual([]);
    expect(state.issues).toEqual([]);
  });

  test("loadState returns persisted state from file", async () => {
    const persisted: PipelineState & { data: Record<string, unknown> } = {
      version: "1.0.0",
      status: "reviewed",
      repositories: [],
      issues: [],
      analyses: {},
      fixes: {},
      submissions: [],
      lastUpdated: "2026-01-01T00:00:00.000Z",
      data: { prCount: 2 },
    };

    await loadState();
    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(persisted, null, 2),
    );
    const loaded = await loadState();

    expect(loaded).toEqual(persisted);
  });

  test("transition allows valid forward states", () => {
    const next = transition("idle", "discovered");
    expect(next).toBe("discovered");
  });

  test("transition throws InvalidTransitionError for invalid move", () => {
    expect(() => transition("idle", "fixed")).toThrow(InvalidTransitionError);
  });

  test("saveState writes json with an ISO lastUpdated timestamp", async () => {
    const staleState: PipelineState = {
      version: "1.0.0",
      status: "discovered",
      repositories: [],
      issues: [],
      analyses: {},
      fixes: {},
      submissions: [],
      lastUpdated: "2020-01-01T00:00:00.000Z",
    };

    await saveState(staleState);
    const content = await Bun.file(join(tempDir, ".gittributor", "state.json")).json();

    expect(content).toHaveProperty("lastUpdated");
    expect(new Date(content.lastUpdated as string).toISOString()).toBe(content.lastUpdated);
    expect(content.lastUpdated).not.toBe("2020-01-01T00:00:00.000Z");
  });

  test("setStateData persists associated data and getStateData reads it", async () => {
    await loadState();
    await setStateData("analysisSummary", { ready: true, count: 3 });

    const analysisSummary = getStateData<{ ready: boolean; count: number }>("analysisSummary");
    const loaded = await loadState();

    expect(analysisSummary).toEqual({ ready: true, count: 3 });
    expect((loaded as unknown as { data?: Record<string, unknown> }).data).toEqual({
      analysisSummary: { ready: true, count: 3 },
    });
  });
});
