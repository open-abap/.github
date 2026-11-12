import { writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif`;
const PREFIX = "open-abap-";
// leaves sharing a single dependency are drawn as one grid once there are this many
const GROUP_MIN_SIZE = 4;
const GROUP_PADDING = 16;
const GROUP_HEADER = 36;
// column counts tried for grouped leaves, the most square image wins
const GROUP_COLUMNS = [3];

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
  const top = (node) => headerHeight + node.layer * (boxHeight + layerGap);

  let best;
  for (const columns of GROUP_COLUMNS) {
    const layout = graphLayout(dependencies, { boxWidth, boxHeight, gap: boxGap, columns });
    const maxRight = Math.max(...layout.nodes.map((node) => node.x + node.width), 0);
    const width = Math.max(margin * 2 + maxRight, 560);
    const height = Math.max(...layout.nodes.map((node) => top(node) + node.height), 0) + margin;
    const score = Math.abs(Math.log(width / height));
    if (best === undefined || score < best.score) {
      best = { ...layout, maxRight, width, height, score };
    }
  }
  const { nodes, edges, maxRight, width, height } = best;
  const offset = (width - maxRight) / 2;

  const byName = new Map(nodes.map((node) => [node.name, node]));
  const left = (node) => offset + node.x;
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
      const y2 = top(dependency) + dependency.height + 6;
      const bend = (y1 - y2) / 2;
      return `    <path d="M ${x1} ${y1} C ${x1} ${y1 - bend}, ${x2} ${y2 + bend}, ${x2} ${y2}" />`;
    });
  });

  const box = (name, layer, x, y, boxWidth) => {
    const middle = x + boxWidth / 2;
    const text = label(name, layer);
    // shortened names get the prefix as a small line above
    const lines =
      text === name
        ? [`      <text x="${middle}" y="${y + boxHeight / 2}">${escapeXml(text)}</text>`]
        : [
            `      <text class="prefix" x="${middle}" y="${y + 16}">${escapeXml(PREFIX)}</text>`,
            `      <text x="${middle}" y="${y + 37}">${escapeXml(text)}</text>`,
          ];
    return [
      `    <g class="node">`,
      `      <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="8" />`,
      ...lines,
      `    </g>`,
    ].join("\n");
  };

  const boxes = nodes.map((node) => {
    const x = left(node);
    const y = top(node);
    if (node.group === undefined) {
      return box(node.name, node.layer, x, y, node.width);
    }
    return [
      `    <g class="group">`,
      `      <rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="12" />`,
      `      <text x="${x + GROUP_PADDING}" y="${y + 23}">depends only on ${escapeXml(node.group.parent)}</text>`,
      `    </g>`,
      ...node.group.members.map((member) =>
        box(member.name, node.layer, x + member.x, y + member.y, member.width),
      ),
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
    .group rect { fill: #eef2f7; stroke: #cbd5e1; stroke-width: 1; stroke-dasharray: 5 4; }
    .group text { font-size: 13px; fill: #64748b; }
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

function graphLayout(dependencies, { boxWidth, boxHeight, gap, columns }) {
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

  // leaves with a single direct dependency, collected per dependency
  const hasDependents = new Set([...directParents.values()].flat());
  const leavesByParent = new Map();
  for (const name of nodes) {
    const direct = directParents.get(name) ?? [];
    if (direct.length === 1 && !hasDependents.has(name)) {
      leavesByParent.set(direct[0], [...(leavesByParent.get(direct[0]) ?? []), name]);
    }
  }

  // units are what the layout places: single nodes, or a group of leaves drawn as a grid
  const groups = new Map();
  const unitOf = new Map([...nodes].map((name) => [name, name]));
  for (const [parent, members] of leavesByParent) {
    if (members.length < GROUP_MIN_SIZE) {
      continue;
    }
    const name = `group:${parent}`;
    groups.set(name, { parent, members: members.sort(compareNames) });
    for (const member of members) {
      unitOf.set(member, name);
    }
  }
  const units = [...new Set(unitOf.values())];
  const unitParents = new Map(
    units.map((unit) => [
      unit,
      groups.has(unit) ? [groups.get(unit).parent] : directParents.get(unit) ?? [],
    ]),
  );
  const unitLayers = new Map(
    units.map((unit) => [
      unit,
      groups.has(unit) ? layers.get(groups.get(unit).members[0]) : layers.get(unit),
    ]),
  );

  const dependentCounts = new Map();
  for (const direct of unitParents.values()) {
    for (const parent of direct) {
      dependentCounts.set(parent, (dependentCounts.get(parent) ?? 0) + 1);
    }
  }

  const sizes = new Map(
    units.map((unit) => {
      const unitLayer = unitLayers.get(unit);
      if (!groups.has(unit)) {
        return [
          unit,
          { width: boxWidth(unit, unitLayer, dependentCounts.get(unit) ?? 0), height: boxHeight },
        ];
      }
      const { members } = groups.get(unit);
      const cellWidth = Math.max(...members.map((member) => boxWidth(member, unitLayer, 0)));
      const columnCount = Math.min(columns, members.length);
      const rowCount = Math.ceil(members.length / columnCount);
      return [
        unit,
        {
          width: columnCount * cellWidth + (columnCount - 1) * gap + GROUP_PADDING * 2,
          height: GROUP_HEADER + rowCount * boxHeight + (rowCount - 1) * gap + GROUP_PADDING,
          members: members.map((member, index) => ({
            name: member,
            x: GROUP_PADDING + (index % columnCount) * (cellWidth + gap),
            y: GROUP_HEADER + Math.floor(index / columnCount) * (boxHeight + gap),
            width: cellWidth,
          })),
        },
      ];
    }),
  );
  const size = (name) => sizes.get(name).width;

  // place each layer close to the average position of its parents, without overlaps
  const positions = new Map();
  const maxLayer = Math.max(...unitLayers.values(), 0);

  for (let current = 0; current <= maxLayer; current += 1) {
    const entries = units
      .filter((unit) => unitLayers.get(unit) === current)
      .map((name) => {
        const placed = unitParents.get(name).filter((parent) => positions.has(parent));
        const desired =
          placed.length === 0
            ? undefined
            : placed.reduce((sum, parent) => sum + positions.get(parent), 0) / placed.length;
        return { name, desired };
      })
      .sort(
        (left, right) =>
          (left.desired ?? Infinity) - (right.desired ?? Infinity) ||
          Number(groups.has(left.name)) - Number(groups.has(right.name)) ||
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

  // a node alone in its layer is centered over the full span of its dependents
  for (let current = maxLayer - 1; current >= 0; current -= 1) {
    const inLayer = units.filter((unit) => unitLayers.get(unit) === current);
    if (inLayer.length !== 1) {
      continue;
    }
    const dependents = units.filter((unit) => unitParents.get(unit).includes(inLayer[0]));
    if (dependents.length === 0) {
      continue;
    }
    const spanLeft = Math.min(...dependents.map(start));
    const spanRight = Math.max(...dependents.map((unit) => start(unit) + size(unit)));
    positions.set(inLayer[0], (spanLeft + spanRight) / 2);
  }

  const minStart = Math.min(...units.map(start));
  const layoutNodes = units.map((name) => ({
    name,
    layer: unitLayers.get(name),
    x: Math.round(start(name) - minStart),
    width: size(name),
    height: sizes.get(name).height,
    group: groups.has(name)
      ? { parent: groups.get(name).parent, members: sizes.get(name).members }
      : undefined,
  }));
  const edges = [...unitParents].flatMap(([child, direct]) =>
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
