import type { ContributionOpportunity } from "../../types/index.js";

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function parsePackageJson(pkg: unknown): Record<string, string> {
  if (!pkg || typeof pkg !== "object") {
    return {};
  }

  const packageJson = pkg as PackageJson;
  const deps: Record<string, string> = {};

  if (packageJson.dependencies) {
    for (const [name, version] of Object.entries(packageJson.dependencies)) {
      if (typeof version === "string") {
        deps[name] = version;
      }
    }
  }

  if (packageJson.devDependencies) {
    for (const [name, version] of Object.entries(packageJson.devDependencies)) {
      if (typeof version === "string") {
        deps[name] = version;
      }
    }
  }

  return deps;
}

interface OutdatedDep {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
}

async function fetchNpmRegistry(packageName: string): Promise<string> {
  try {
    const response = await fetch("https://registry.npmjs.org/" + packageName, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    
    if (!response.ok) {
      return "";
    }
    
    const data = await response.json() as { "dist-tags"?: { latest: string } };
    return data["dist-tags"]?.latest ?? "";
  } catch {
    return "";
  }
}

export async function checkOutdatedDeps(
  deps: Record<string, string>,
): Promise<OutdatedDep[]> {
  const outdated: OutdatedDep[] = [];
  const commonPackages = ["express", "lodash", "axios", "react", "vue", "mongoose", "puppeteer", "typescript", "eslint", "jest", "webpack"];

  for (const [packageName, currentVersion] of Object.entries(deps)) {
    if (commonPackages.includes(packageName.toLowerCase())) {
      const latestVersion = await fetchNpmRegistry(packageName);
      
      if (latestVersion && latestVersion !== currentVersion.replace(/[\^~]/g, "")) {
        outdated.push({
          packageName,
          currentVersion,
          latestVersion,
        });
      }
    }
  }

  return outdated;
}

export function generateVersionBump(
  opportunity: ContributionOpportunity,
): { patch: string; description: string; confidence: number } {
  const packageName = opportunity.packageName ?? "package";
  const newVersion = opportunity.newVersion ?? "latest";
  const oldVersion = opportunity.oldVersion ?? "";

  const versionWithoutPrefix = newVersion.replace(/^[\^~]/, "");
  const cleanOldVersion = oldVersion.replace(/^[\^~]/, "");
  
  const patch = '"' + packageName + '": "' + versionWithoutPrefix + '"';

  return {
    patch: patch,
    description: "Updated " + packageName + " from " + cleanOldVersion + " to " + versionWithoutPrefix,
    confidence: 0.8,
  };
}