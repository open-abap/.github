import { writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif`;
const PREFIX = "open-abap-";

export async function writeDependencyGraph(filename, dependencies) {
  const boxHeight = 56;
  const boxGap = 14;
  const layerGap = 96;
  const margin = 32;
  const headerHeight = 84;
  const arrowSpacing = 10;
  // wide enough for the label and for the arrow tips of all dependents
  const boxWidth = (name, layer, dependents) =>
    Math.max(
      64,
      Math.ceil(label(name, layer).length * 11.8) + 28,
      label(name, layer) !== name ? Math.ceil(PREFIX.length * 5.6) + 28 : 0,
      dependents * arrowSpacing + 24,
    );
  const { nodes, edges } = graphLayout(dependencies, boxWidth, boxGap);
  const maxLayer = Math.max(...nodes.map((node) => node.layer), 0);
  const maxRight = Math.max(...nodes.map((node) => node.x + node.width), 0);
  const width = Math.max(margin * 2 + maxRight, 560);
  const height = headerHeight + maxLayer * (boxHeight + layerGap) + boxHeight + margin;
  const offset = (width - maxRight) / 2;

  const byName = new Map(nodes.map((node) => [node.name, node]));
  const left = (node) => offset + node.x;
  const top = (node) => headerHeight + node.layer * (boxHeight + layerGap);

  const center = (node) => left(node) + node.width / 2;

  // arrows go from the dependent up to the dependency, tips spread along its bottom edge
  const paths = [...byName.values()].flatMap((dependency) => {
    const dependents = edges
      .filter(({ from }) => from === dependency.name)
      .map(({ to }) => byName.get(to))
      .sort((a, b) => center(a) - center(b));

    return dependents.map((dependent, index) => {
      const x1 = center(dependent);
      const y1 = top(dependent);
      const x2 = center(dependency) + (index - (dependents.length - 1) / 2) * arrowSpacing;
      const y2 = top(dependency) + boxHeight + 6;
      const bend = (y1 - y2) / 2;
      return `    <path d="M ${x1} ${y1} C ${x1} ${y1 - bend}, ${x2} ${y2 + bend}, ${x2} ${y2}" />`;
    });
  });

  const boxes = nodes.map((node) => {
    const x = left(node);
    const y = top(node);
    const middle = x + node.width / 2;
    const name = label(node.name, node.layer);
    // shortened names get the prefix as a small line above
    const text =
      name === node.name
        ? [`      <text x="${middle}" y="${y + boxHeight / 2}">${escapeXml(name)}</text>`]
        : [
            `      <text class="prefix" x="${middle}" y="${y + 16}">${escapeXml(PREFIX)}</text>`,
            `      <text x="${middle}" y="${y + 37}">${escapeXml(name)}</text>`,
          ];
    return [
      `    <g class="node">`,
      `      <rect x="${x}" y="${y}" width="${node.width}" height="${boxHeight}" rx="8" />`,
      ...text,
      `    </g>`,
    ].join("\n");
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
    </marker>
    <filter id="shadow" x="-10%" y="-30%" width="120%" height="160%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#0f172a" flood-opacity="0.10" />
    </filter>
  </defs>
  <style>
    text { font-family: ${FONT}; dominant-baseline: central; }
    .title { font-size: 22px; font-weight: 600; fill: #0f172a; dominant-baseline: auto; }
    .edges path { fill: none; stroke: #94a3b8; stroke-width: 1.5; marker-end: url(#arrow); }
    .node rect { fill: #ffffff; stroke: #cbd5e1; stroke-width: 1; filter: url(#shadow); }
    .node text { font-size: 20px; font-weight: 600; fill: #0f172a; text-anchor: middle; }
    .node .prefix { font-size: 10px; font-weight: 400; fill: #94a3b8; }
  </style>
  <rect width="${width}" height="${height}" rx="12" fill="#f8fafc" />
  <text class="title" x="${margin}" y="46">open-abap dependency graph</text>
  <g class="edges">
${paths.join("\n")}
  </g>
${boxes.join("\n")}
</svg>
`;

  // render at 2x so the image stays sharp on high resolution screens
  const png = new Resvg(svg, {
    fitTo: { mode: "zoom", value: 2 },
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  }).render().asPng();
  await writeFile(filename, png);
}

// top level repositories keep their full name
function label(name, layer) {
  return layer > 0 && name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
}

function graphLayout(dependencies, boxWidth, gap) {
  const parents = new Map();
  const nodes = new Set();

  for (const { from, to } of dependencies) {
    nodes.add(from);
    nodes.add(to);
    const entries = parents.get(from) ?? [];
    if (!entries.includes(to)) {
      entries.push(to);
    }
    parents.set(from, entries);
  }

  function reaches(from, target, seen = new Set()) {
    if (from === target) {
      return true;
    }
    if (seen.has(from)) {
      return false;
    }
    seen.add(from);
    return (parents.get(from) ?? []).some((dependency) => reaches(dependency, target, seen));
  }

  // skip dependencies already implied through another direct dependency
  const directParents = new Map();
  for (const [child, dependenciesForNode] of parents) {
    const direct = dependenciesForNode.filter(
      (candidate) =>
        !dependenciesForNode.some((other) => other !== candidate && reaches(other, candidate)),
    );
    directParents.set(child, direct.length > 0 ? direct : dependenciesForNode);
  }

  const dependentCounts = new Map();
  for (const direct of directParents.values()) {
    for (const parent of direct) {
      dependentCounts.set(parent, (dependentCounts.get(parent) ?? 0) + 1);
    }
  }
  const layers = new Map();

  function layer(name, path = new Set()) {
    if (layers.has(name)) {
      return layers.get(name);
    }
    if (path.has(name)) {
      return 0;
    }

    const dependenciesForNode = parents.get(name) ?? [];
    const result =
      dependenciesForNode.length === 0
        ? 0
        : Math.max(
            ...dependenciesForNode.map((dependency) =>
              layer(dependency, new Set([...path, name])),
            ),
          ) + 1;
    layers.set(name, result);
    return result;
  }

  for (const node of nodes) {
    layer(node);
  }

  const widths = new Map(
    [...nodes].map((name) => [
      name,
      boxWidth(name, layers.get(name), dependentCounts.get(name) ?? 0),
    ]),
  );
  const size = (name) => widths.get(name);

  // place each layer close to the average position of its parents, without overlaps
  const positions = new Map();
  const maxLayer = Math.max(...layers.values(), 0);

  for (let current = 0; current <= maxLayer; current += 1) {
    const entries = [...nodes]
      .filter((node) => layers.get(node) === current)
      .map((name) => {
        const placed = (directParents.get(name) ?? []).filter((parent) => positions.has(parent));
        const desired =
          placed.length === 0
            ? undefined
            : placed.reduce((sum, parent) => sum + positions.get(parent), 0) / placed.length;
        return { name, desired };
      })
      .sort(
        (left, right) =>
          (left.desired ?? Infinity) - (right.desired ?? Infinity) ||
          compareNames(left.name, right.name),
      );

    let previous;
    for (const entry of entries) {
      entry.center =
        previous === undefined
          ? entry.desired ?? 0
          : Math.max(
              entry.desired ?? -Infinity,
              previous.center + (size(previous.name) + size(entry.name)) / 2 + gap,
            );
      previous = entry;
    }

    const anchored = entries.filter((entry) => entry.desired !== undefined);
    const shift =
      anchored.length === 0
        ? 0
        : anchored.reduce((sum, entry) => sum + entry.desired - entry.center, 0) / anchored.length;

    for (const entry of entries) {
      positions.set(entry.name, entry.center + shift);
    }
  }

  const start = (name) => positions.get(name) - size(name) / 2;
  const minStart = Math.min(...[...nodes].map(start));
  const layoutNodes = [...nodes].map((name) => ({
    name,
    layer: layers.get(name),
    x: Math.round(start(name) - minStart),
    width: size(name),
  }));
  const edges = [...directParents].flatMap(([child, direct]) =>
    direct.map((parent) => ({ from: parent, to: child })),
  );

  return { nodes: layoutNodes, edges };
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeXml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
