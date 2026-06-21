#!/usr/bin/env node

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ORG = "open-abap";
const DESTINATION = "repositories";
const README = "profile/README.md";

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

  console.log(`Clone ${repo.name}`);
  await run("git", ["clone", "--quiet", "--depth", "1", repo.cloneUrl, target]);

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
