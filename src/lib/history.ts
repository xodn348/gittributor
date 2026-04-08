import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { ContributionHistory, ContributionType } from "../types/index.js";

export interface HistoryStats {
  total: number;
  byType: Record<ContributionType, number>;
  byStatus: Record<ContributionHistory["status"], number>;
  mergeRate: number;
}

interface HistoryFile {
  contributions: ContributionHistory[];
}

export async function loadHistory(historyPath: string): Promise<ContributionHistory[]> {
  if (!existsSync(historyPath)) {
    return [];
  }
  const content = readFileSync(historyPath, "utf-8");
  const data: HistoryFile = JSON.parse(content);
  return data.contributions || [];
}

export async function saveContribution(
  contribution: Omit<ContributionHistory, "id" | "createdAt">,
  historyPath: string
): Promise<ContributionHistory> {
  const dir = dirname(historyPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let existing: ContributionHistory[] = [];
  if (existsSync(historyPath)) {
    const content = readFileSync(historyPath, "utf-8");
    const data: HistoryFile = JSON.parse(content);
    existing = data.contributions || [];
  }

  const now = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const newContribution: ContributionHistory = {
    ...contribution,
    id: `${now}-${randomSuffix}`,
    createdAt: new Date().toISOString(),
  };

  const newData: HistoryFile = {
    contributions: [...existing, newContribution],
  };
  writeFileSync(historyPath, JSON.stringify(newData, null, 2));

  return newContribution;
}

export async function updateContributionStatus(
  id: string,
  status: ContributionHistory["status"],
  updates: Partial<Pick<ContributionHistory, "prNumber" | "prUrl" | "submittedAt" | "mergedAt">>,
  historyPath: string
): Promise<void> {
  if (!existsSync(historyPath)) {
    return;
  }

  const content = readFileSync(historyPath, "utf-8");
  const data: HistoryFile = JSON.parse(content);
  const contributions = data.contributions || [];

  const index = contributions.findIndex((c) => c.id === id);
  if (index === -1) {
    return;
  }

  contributions[index] = {
    ...contributions[index],
    status,
    ...updates,
  };

  const newData: HistoryFile = { contributions };
  writeFileSync(historyPath, JSON.stringify(newData, null, 2));
}

export async function getHistoryStats(historyPath: string): Promise<HistoryStats> {
  const contributions = await loadHistory(historyPath);

  const byType: Record<string, number> = {
    fix: 0,
    improvement: 0,
    docs: 0,
    refactor: 0,
  };

  const byStatus: Record<string, number> = {
    pending: 0,
    submitted: 0,
    merged: 0,
    closed: 0,
    rejected: 0,
  };

  for (const contrib of contributions) {
    if (contrib.type && byType[contrib.type] !== undefined) {
      byType[contrib.type]++;
    }
    if (contrib.status && byStatus[contrib.status] !== undefined) {
      byStatus[contrib.status]++;
    }
  }

  const mergedCount = byStatus.merged || 0;
  const total = contributions.length;
  const mergeRate = total > 0 ? mergedCount / total : 0;

  return {
    total,
    byType: byType as Record<ContributionType, number>,
    byStatus: byStatus as Record<ContributionHistory["status"], number>,
    mergeRate,
  };
}

export async function getRepoHistory(repo: string, historyPath: string): Promise<ContributionHistory[]> {
  const contributions = await loadHistory(historyPath);
  return contributions.filter((c) => c.repo === repo);
}