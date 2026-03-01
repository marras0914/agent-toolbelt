import { z } from "zod";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const packageSchema = z.object({
  name: z.string().min(1).describe("Package name"),
  version: z.string().optional().describe("Specific version to check (e.g. '4.17.11'). Omit to check all known vulnerabilities."),
  ecosystem: z.enum(["npm", "pypi"]).describe("Package ecosystem"),
});

const inputSchema = z.object({
  packages: z
    .array(packageSchema)
    .min(1)
    .max(50)
    .optional()
    .describe("List of packages to audit"),
  manifest: z
    .string()
    .optional()
    .describe("Raw package.json or requirements.txt content. Parsed automatically."),
  manifestType: z
    .enum(["package.json", "requirements.txt", "auto"])
    .default("auto")
    .describe("Manifest format. 'auto' detects from content."),
  includeDevDependencies: z
    .boolean()
    .default(true)
    .describe("Include devDependencies when parsing package.json"),
  minSeverity: z
    .enum(["LOW", "MODERATE", "HIGH", "CRITICAL"])
    .default("LOW")
    .describe("Minimum severity to include in results"),
});

type Input = z.infer<typeof inputSchema>;
type PackageInput = z.infer<typeof packageSchema>;

// ----- OSV API -----
const OSV_API = "https://api.osv.dev/v1";

interface OsvVuln {
  id: string;
  summary?: string;
  aliases?: string[];
  published?: string;
  database_specific?: { severity?: string; cwe_ids?: string[] };
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{
    package: { name: string; ecosystem: string };
    ranges?: Array<{ type: string; events: Array<Record<string, string>> }>;
  }>;
  references?: Array<{ type: string; url: string }>;
}

async function queryPackage(pkg: PackageInput): Promise<OsvVuln[]> {
  const ecosystem = pkg.ecosystem === "pypi" ? "PyPI" : "npm";
  const body: Record<string, unknown> = {
    package: { name: pkg.name, ecosystem },
  };
  if (pkg.version) body.version = pkg.version;

  const res = await fetch(`${OSV_API}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) return [];
  const data = await res.json() as { vulns?: OsvVuln[] };
  return data.vulns || [];
}

// ----- Manifest Parsers -----
function parsePackageJson(content: string, includeDev: boolean): PackageInput[] {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(content); } catch { return []; }

  const packages: PackageInput[] = [];
  const deps = (parsed.dependencies || {}) as Record<string, string>;
  const devDeps = includeDev ? (parsed.devDependencies || {}) as Record<string, string> : {};

  for (const [name, version] of Object.entries({ ...deps, ...devDeps })) {
    // Strip semver range operators: ^1.2.3 → 1.2.3
    const clean = String(version).replace(/^[\^~>=<]+/, "").split(" ")[0];
    packages.push({ name, version: clean || undefined, ecosystem: "npm" });
  }
  return packages;
}

function parseRequirementsTxt(content: string): PackageInput[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
    .map((line) => {
      // Handle: package==1.0, package>=1.0, package~=1.0, package
      const match = line.match(/^([A-Za-z0-9_.-]+)\s*(?:[=~!<>]+\s*([^\s,;]+))?/);
      if (!match) return null;
      const [, name, version] = match;
      const clean = version?.replace(/[,;].*$/, "").trim();
      return { name, version: clean || undefined, ecosystem: "pypi" as const };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null) as PackageInput[];
}

function detectAndParse(content: string, manifestType: string, includeDev: boolean): PackageInput[] {
  if (manifestType === "package.json") return parsePackageJson(content, includeDev);
  if (manifestType === "requirements.txt") return parseRequirementsTxt(content);

  // Auto-detect
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return parsePackageJson(trimmed, includeDev);
  return parseRequirementsTxt(trimmed);
}

// ----- Severity Helpers -----
const SEVERITY_ORDER = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

function getSeverity(vuln: OsvVuln): string {
  // Prefer database_specific severity (GHSA/GitHub advisory format)
  if (vuln.database_specific?.severity) {
    return vuln.database_specific.severity.toUpperCase();
  }
  // Fall back to CVSS score
  const cvss = vuln.severity?.find((s) => s.type.startsWith("CVSS"));
  if (cvss) {
    const scoreMatch = cvss.score.match(/\/S:[UC]\//);
    // Quick CVSS base score extraction: look for common patterns
    const parts = cvss.score.split("/");
    // AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H → CRITICAL
    const c = parts.find((p) => p.startsWith("C:"))?.slice(2);
    const i = parts.find((p) => p.startsWith("I:"))?.slice(2);
    const a = parts.find((p) => p.startsWith("A:"))?.slice(2);
    const highCount = [c, i, a].filter((v) => v === "H").length;
    if (highCount >= 2) return "CRITICAL";
    if (highCount >= 1) return "HIGH";
    return "MODERATE";
  }
  return "UNKNOWN";
}

function getFixedVersions(vuln: OsvVuln, ecosystem: string): string[] {
  const osvEco = ecosystem === "pypi" ? "PyPI" : "npm";
  const fixed: string[] = [];
  for (const affected of vuln.affected || []) {
    if (affected.package.ecosystem !== osvEco) continue;
    for (const range of affected.ranges || []) {
      for (const event of range.events) {
        if (event.fixed) fixed.push(event.fixed);
      }
    }
  }
  return [...new Set(fixed)];
}

function getAdvisoryUrl(vuln: OsvVuln): string {
  const advisory = vuln.references?.find((r) => r.type === "ADVISORY");
  if (advisory) return advisory.url;
  if (vuln.id.startsWith("GHSA-")) return `https://github.com/advisories/${vuln.id}`;
  return `https://osv.dev/vulnerability/${vuln.id}`;
}

function severityRank(s: string): number {
  return SEVERITY_ORDER.indexOf(s.toUpperCase());
}

function highestSeverity(severities: string[]): string {
  return severities.reduce((best, s) =>
    severityRank(s) > severityRank(best) ? s : best, "UNKNOWN");
}

// ----- Handler -----
async function handler(input: Input) {
  // Build package list
  let packages: PackageInput[] = input.packages || [];

  if (input.manifest) {
    const fromManifest = detectAndParse(input.manifest, input.manifestType, input.includeDevDependencies);
    packages = [...packages, ...fromManifest];
  }

  if (packages.length === 0) {
    return { error: "No packages provided. Supply 'packages' array or 'manifest' content." };
  }

  // Deduplicate
  const seen = new Set<string>();
  packages = packages.filter((p) => {
    const key = `${p.ecosystem}:${p.name}:${p.version || "*"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Query OSV for each package (sequential to be polite to the API)
  const results = await Promise.all(packages.map(async (pkg) => {
    const vulns = await queryPackage(pkg);
    return { pkg, vulns };
  }));

  const minSeverityRank = severityRank(input.minSeverity);

  const vulnerable: Array<{
    package: string;
    version?: string;
    ecosystem: string;
    vulnerabilities: Array<{
      id: string;
      cves: string[];
      summary: string;
      severity: string;
      fixedIn: string[];
      published?: string;
      url: string;
      cweIds?: string[];
    }>;
    highestSeverity: string;
  }> = [];
  const clean: string[] = [];
  const bySeverity: Record<string, number> = {};

  for (const { pkg, vulns } of results) {
    if (vulns.length === 0) {
      clean.push(`${pkg.name}${pkg.version ? `@${pkg.version}` : ""}`);
      continue;
    }

    const filtered = vulns
      .map((v) => ({
        id: v.id,
        cves: (v.aliases || []).filter((a) => a.startsWith("CVE-")),
        summary: v.summary || "No summary available",
        severity: getSeverity(v),
        fixedIn: getFixedVersions(v, pkg.ecosystem),
        published: v.published,
        url: getAdvisoryUrl(v),
        cweIds: v.database_specific?.cwe_ids,
      }))
      .filter((v) => severityRank(v.severity) >= minSeverityRank);

    if (filtered.length === 0) {
      clean.push(`${pkg.name}${pkg.version ? `@${pkg.version}` : ""}`);
      continue;
    }

    // Count by severity
    for (const v of filtered) {
      bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
    }

    vulnerable.push({
      package: pkg.name,
      version: pkg.version,
      ecosystem: pkg.ecosystem,
      vulnerabilities: filtered,
      highestSeverity: highestSeverity(filtered.map((v) => v.severity)),
    });
  }

  // Sort vulnerable packages by highest severity desc
  vulnerable.sort((a, b) => severityRank(b.highestSeverity) - severityRank(a.highestSeverity));

  const totalVulnerabilities = vulnerable.reduce((sum, p) => sum + p.vulnerabilities.length, 0);

  return {
    vulnerable,
    clean,
    summary: {
      totalPackages: packages.length,
      vulnerablePackages: vulnerable.length,
      cleanPackages: clean.length,
      totalVulnerabilities,
      bySeverity,
      riskLevel: vulnerable.some((p) => p.highestSeverity === "CRITICAL")
        ? "CRITICAL"
        : vulnerable.some((p) => p.highestSeverity === "HIGH")
        ? "HIGH"
        : vulnerable.length > 0
        ? "MODERATE"
        : "NONE",
    },
  };
}

// ----- Register -----
const dependencyAuditorTool: ToolDefinition<Input> = {
  name: "dependency-auditor",
  description:
    "Audit npm and PyPI packages for known security vulnerabilities using the OSV (Open Source Vulnerabilities) database. " +
    "Accepts a list of packages with versions, or paste raw package.json / requirements.txt content for automatic parsing. " +
    "Returns per-package vulnerability details: CVE IDs, severity (CRITICAL/HIGH/MODERATE/LOW), fixed versions, and advisory links. " +
    "Results are sorted by severity. Powered by osv.dev — the same database used by GitHub Dependabot.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["security", "vulnerabilities", "npm", "pypi", "cve", "dependencies", "devtools"],
    pricing: "$0.005 per call",
    exampleInput: {
      packages: [
        { name: "lodash", version: "4.17.11", ecosystem: "npm" },
        { name: "axios", version: "0.21.0", ecosystem: "npm" },
        { name: "express", version: "4.18.0", ecosystem: "npm" },
      ],
      minSeverity: "MODERATE",
      manifestType: "auto",
      includeDevDependencies: true,
    },
  },
};

registerTool(dependencyAuditorTool);
export default dependencyAuditorTool;
