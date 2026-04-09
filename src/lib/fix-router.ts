import type { ContributionOpportunity } from "../types/index";
import { callModel } from "./ai.js";
import { createTypoFix } from "./detectors/typo-detector.js";
import { generateDocsSection } from "./detectors/docs-detector.js";
import { generateVersionBump } from "./detectors/deps-detector.js";

export interface FixResultRouter {
  patch: string;
  description: string;
  confidence: number;
}

const ROUTING_SYSTEM_PROMPT = "You are a code fix generator. Generate a patch for the issue. Return JSON with patch (string), description (string), and confidence (0-1).";

const TEST_SYSTEM_PROMPT = "You are a test generator. Generate a test file skeleton. Return JSON with patch (string), description (string), and confidence (0-1).";

async function routeTypo(opportunity: ContributionOpportunity): Promise<FixResultRouter> {
  return createTypoFix(opportunity);
}

async function routeDocs(opportunity: ContributionOpportunity): Promise<FixResultRouter> {
  return generateDocsSection(opportunity);
}

async function routeDeps(opportunity: ContributionOpportunity): Promise<FixResultRouter> {
  return generateVersionBump(opportunity);
}

async function routeTest(opportunity: ContributionOpportunity): Promise<FixResultRouter> {
  const prompt = "Generate a test skeleton for: " + opportunity.description + "\nFile: " + opportunity.filePath;
  
  const modelResponse = await callModel({
    system: TEST_SYSTEM_PROMPT,
    prompt: prompt,
    maxTokens: 1024,
  });

  try {
    const parsed = JSON.parse(modelResponse);
    return {
      patch: parsed.patch ?? "",
      description: parsed.description ?? "Generated test",
      confidence: parsed.confidence ?? 0.5,
    };
  } catch {
    return {
      patch: "",
      description: "Failed to generate test",
      confidence: 0,
    };
  }
}

async function routeCode(opportunity: ContributionOpportunity): Promise<FixResultRouter> {
  const prompt = "Generate a fix for: " + opportunity.description + "\nFile: " + opportunity.filePath;
  
  const modelResponse = await callModel({
    system: ROUTING_SYSTEM_PROMPT,
    prompt: prompt,
    maxTokens: 1024,
  });

  try {
    const parsed = JSON.parse(modelResponse);
    return {
      patch: parsed.patch ?? "",
      description: parsed.description ?? "Generated fix",
      confidence: parsed.confidence ?? 0.5,
    };
  } catch {
    return {
      patch: "",
      description: "Failed to generate code fix",
      confidence: 0,
    };
  }
}

export async function routeContribution(
  opportunity: ContributionOpportunity,
): Promise<FixResultRouter> {
  const type = opportunity.type;

  switch (type) {
    case "typo":
      return routeTypo(opportunity);
    case "docs":
      return routeDocs(opportunity);
    case "deps":
      return routeDeps(opportunity);
    case "test":
      return routeTest(opportunity);
    case "code":
      return routeCode(opportunity);
    default:
      throw new Error("Unknown contribution type: " + type);
  }
}