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
console.log(`Destination: ${DESTINATION}`);

for (const repo of repos) {
  const target = join(DESTINATION, repo.name);

  if (existsSync(target)) {
    console.log(`skip ${repo.name}: ${target} already exists`);
    continue;
  }

  console.log(`clone ${repo.name}`);
  await run("git", ["clone", "--quiet", "--depth", "1", repo.cloneUrl, target]);
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
