#!/usr/bin/env node

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ORG = "open-abap";
const DESTINATION = "repositories";
const README = "profile/README.md";
const GITHUB_API = "https://api.github.com";
const LICENSE_CLA_CHECK_PATTERN = /\b(?:license|cla)\b/i;

await ensureGitIsAvailable();
await clearDestination(DESTINATION);
await mkdir(DESTINATION, { recursive: true });

const repos = await readRepositoriesFromReadme(README);
if (repos.length === 0) {
  throw new Error(`No ${ORG} repository links found in ${README}.`);
}

console.log(`Found ${repos.length} repositories in ${README}.`);

for (const repo of repos) {
  const target = join(DESTINATION, repo.name);
  const findings = [];

  console.log(`Clone ${repo.cloneUrl}`);
  await run("git", ["clone", "--quiet", "--depth", "1", repo.cloneUrl, target]);

  const pullRequestFeedback = await latestPullRequestLicenseClaFeedback(repo.name);
  findings.push(...pullRequestFeedback);

  if ((await countFiles(target, 2)) <= 2) {
    printFindings(repo.name, findings);
    continue;
  }

  if (!existsSync(join(target, ".npmrc"))) {
    findings.push("Missing .npmrc");
  }

  if (!existsSync(join(target, "package-lock.json"))) {
    findings.push("Missing package-lock.json");
  }

  if (!(await hasPrivatePackageJson(target))) {
    findings.push('Missing "private": true in package.json');
  }

  if (!existsSync(join(target, "abaplint.jsonc"))) {
    findings.push("Missing abaplint.jsonc");
  } else if (!(await hasErrorOnDuplicateFilenames(target))) {
    findings.push('Missing "errorOnDuplicateFilenames": true in abaplint.jsonc');
  }

  const workflowsMissingTimeouts = await workflowYmlFilesWithoutTimeout(target);
  for (const workflow of workflowsMissingTimeouts) {
    findings.push(`Missing timeout-minutes in .github/workflows/${workflow}`);
  }

  printFindings(repo.name, findings);
}

async function clearDestination(destination) {
  if (!existsSync(destination)) {
    return;
  }

  const entries = await readdir(destination);
  await Promise.all(
    entries.map((entry) =>
      rm(join(destination, entry), {
        force: true,
        recursive: true,
      }),
    ),
  );
}

async function readRepositoriesFromReadme(readme) {
  const content = await readFile(readme, "utf8");
  const matches = content.matchAll(
    new RegExp(`https://github\\.com/${ORG}/([A-Za-z0-9._-]+)`, "g"),
  );
  const repositories = new Map();

  for (const match of matches) {
    const name = match[1];
    repositories.set(name, {
      name,
      cloneUrl: `https://github.com/${ORG}/${name}`,
    });
  }

  return [...repositories.values()];
}

async function countFiles(directory, stopAfter) {
  let count = 0;
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      count += await countFiles(entryPath, stopAfter - count);
    } else if (entry.isFile()) {
      count += 1;
    }

    if (count > stopAfter) {
      break;
    }
  }

  return count;
}

async function hasPrivatePackageJson(repositoryPath) {
  const packageJsonPath = join(repositoryPath, "package.json");

  if (!existsSync(packageJsonPath)) {
    return false;
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  return packageJson.private === true;
}

async function hasErrorOnDuplicateFilenames(repositoryPath) {
  const abaplintPath = join(repositoryPath, "abaplint.jsonc");
  const abaplintJsonc = stripJsonComments(await readFile(abaplintPath, "utf8"));
  return /"errorOnDuplicateFilenames"\s*:\s*true\b/.test(abaplintJsonc);
}

async function workflowYmlFilesWithoutTimeout(repositoryPath) {
  const workflowsPath = join(repositoryPath, ".github", "workflows");

  if (!existsSync(workflowsPath)) {
    return [];
  }

  const entries = await readdir(workflowsPath, { withFileTypes: true });
  const missingTimeouts = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yml")) {
      continue;
    }

    const content = await readFile(join(workflowsPath, entry.name), "utf8");
    if (!content.includes("timeout-minutes")) {
      missingTimeouts.push(entry.name);
    }
  }

  return missingTimeouts;
}

async function latestPullRequestLicenseClaFeedback(repositoryName) {
  const pullRequest = await latestPullRequest(repositoryName);

  if (!pullRequest) {
    return [];
  }

  const statuses = await statusesForCommit(repositoryName, pullRequest.head.sha);
  const licenseClaStatuses = latestStatusesByContext(statuses).filter((status) =>
    LICENSE_CLA_CHECK_PATTERN.test(status.context),
  );

  if (licenseClaStatuses.length === 0) {
    return [`Latest PR #${pullRequest.number}: no license/CLA statuses found`];
  }

  return licenseClaStatuses
    .filter((status) => !isSignedClaStatus(status))
    .map((status) => {
      const feedback = status.description?.trim();
      const details = feedback ? `: ${feedback}` : ": no status feedback";
      return `Latest PR #${pullRequest.number}: status ${status.context} (${status.state})${details}`;
    });
}

async function latestPullRequest(repositoryName) {
  const pullRequests = await githubJson(
    `/repos/${ORG}/${repositoryName}/pulls?state=all&sort=created&direction=desc&per_page=1`,
  );
  return pullRequests[0];
}

async function statusesForCommit(repositoryName, commitSha) {
  return githubJson(`/repos/${ORG}/${repositoryName}/commits/${commitSha}/statuses?per_page=100`);
}

function latestStatusesByContext(statuses) {
  const latest = new Map();

  for (const status of statuses) {
    if (!latest.has(status.context)) {
      latest.set(status.context, status);
    }
  }

  return [...latest.values()];
}

function isSignedClaStatus(status) {
  return (
    LICENSE_CLA_CHECK_PATTERN.test(status.context) &&
    status.state === "success" &&
    status.description?.trim().toLowerCase() === "contributor license agreement is signed."
  );
}

async function githubJson(pathname) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "open-abap-check",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${GITHUB_API}${pathname}`, { headers });

  if (!response.ok) {
    const body = await response.text();
    const tokenHint =
      response.status === 403 && body.includes("rate limit")
        ? " Set GITHUB_TOKEN or GH_TOKEN for a higher API rate limit."
        : "";
    throw new Error(`GitHub API ${pathname} failed with ${response.status}: ${body}${tokenHint}`);
  }

  return response.json();
}

function printFindings(repositoryName, findings) {
  for (const finding of findings) {
    console.log(`  - ${finding}`);
  }
}

function stripJsonComments(content) {
  let result = "";
  let inString = false;
  let stringQuote = "";
  let escaped = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (inString) {
      result += char;

      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      result += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < content.length && content[i] !== "\n") {
        i += 1;
      }
      result += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
        i += 1;
      }
      i += 1;
      continue;
    }

    result += char;
  }

  return result;
}

async function ensureGitIsAvailable() {
  try {
    await run("git", ["--version"], { quiet: true });
  } catch (error) {
    throw new Error(`git is required to clone repositories: ${error.message}`);
  }
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      shell: false,
      stdio: options.quiet ? "pipe" : "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}`));
      }
    });
  });
}
