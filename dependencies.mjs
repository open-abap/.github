#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { writeDependencyTree } from "./dependency-tree.mjs";

const ORG = "open-abap";
const README = "profile/README.md";
const GITHUB_RAW = "https://raw.githubusercontent.com";
const DEPENDENCY_TREE = "dependencies.png";

const repositories = await readRepositoriesFromReadme(README);

if (repositories.length === 0) {
  throw new Error(`No ${ORG} repository links found in ${README}.`);
}

const dependencies = [];

for (const repository of repositories) {
  const libraries = await readRepositoryDependencies(repository);

  for (const library of libraries) {
    if (typeof library.url !== "string") {
      continue;
    }

    dependencies.push({
      from: repository.name,
      to: dependencyName(library.url),
    });
  }
}

console.log("Repositories checked:");
for (const repository of repositories) {
  console.log(`- ${repository.name}`);
}

console.log("\nDependencies:");
for (const dependency of dependencies) {
  console.log(`- ${dependency.from} -> ${dependency.to}`);
}

await writeDependencyTree(DEPENDENCY_TREE, dependencies);
console.log(`\nDependency tree written to ${DEPENDENCY_TREE}`);

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
      transpileUrl: `${GITHUB_RAW}/${ORG}/${name}/HEAD/abap_transpile.json`,
      abaplintUrl: `${GITHUB_RAW}/${ORG}/${name}/HEAD/abaplint.jsonc`,
    });
  }

  return [...repositories.values()];
}

async function readRepositoryDependencies(repository) {
  const transpileResponse = await fetch(repository.transpileUrl);

  if (transpileResponse.ok) {
    const configuration = JSON.parse(await transpileResponse.text());
    return configuration.libs ?? [];
  }

  if (transpileResponse.status !== 404) {
    throw new Error(
      `Fetching ${repository.transpileUrl} failed with ${transpileResponse.status}: ${await transpileResponse.text()}`,
    );
  }

  const abaplintResponse = await fetch(repository.abaplintUrl);

  if (abaplintResponse.status === 404) {
    return [];
  }

  if (!abaplintResponse.ok) {
    throw new Error(
      `Fetching ${repository.abaplintUrl} failed with ${abaplintResponse.status}: ${await abaplintResponse.text()}`,
    );
  }

  const configuration = JSON.parse(stripJsonComments(await abaplintResponse.text()));
  return configuration.dependencies ?? [];
}

function dependencyName(url) {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?\/?$/i);

  if (!match) {
    return url;
  }

  return match[1].toLowerCase() === ORG ? match[2] : `${match[1]}/${match[2]}`;
}

function stripJsonComments(content) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];

    if (inString) {
      result += character;

      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === "/" && next === "/") {
      while (index < content.length && content[index] !== "\n") {
        index += 1;
      }
      result += "\n";
      continue;
    }

    if (character === "/" && next === "*") {
      index += 2;
      while (
        index < content.length &&
        !(content[index] === "*" && content[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 1;
      continue;
    }

    result += character;
  }

  return result;
}
