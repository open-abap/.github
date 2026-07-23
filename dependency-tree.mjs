import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const FONT = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

export async function writeDependencyTree(filename, dependencies) {
  const rows = treeRows(dependencies);
  const scale = 2;
  const rowHeight = 38;
  const indent = 34;
  const margin = 24;
  const headerHeight = 78;
  const longestLabel = Math.max(...rows.map((row) => row.name.length), 1);
  const boxWidth = Math.max(190, longestLabel * 12 + 20);
  const maxDepth = Math.max(...rows.map((row) => row.depth), 0);
  const width = margin * 2 + maxDepth * indent + boxWidth;
  const height = headerHeight + margin + rows.length * rowHeight;
  const canvas = createCanvas(width, height, [248, 250, 252, 255]);

  drawText(canvas, 24, 18, "DEPENDENCY TREE", 3, [15, 23, 42, 255]);
  drawText(canvas, 24, 50, "DEPENDENCY TO DEPENDENTS", 1, [71, 85, 105, 255]);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const x = margin + row.depth * indent;
    const y = headerHeight + index * rowHeight;

    if (row.parent !== undefined) {
      const parent = rows[row.parent];
      const parentX = margin + parent.depth * indent;
      const parentY = headerHeight + row.parent * rowHeight;
      const joinX = parentX + 12;

      drawLine(canvas, joinX, parentY + 29, joinX, y + 15, [100, 116, 139, 255]);
      drawLine(canvas, joinX, y + 15, x, y + 15, [100, 116, 139, 255]);
    }

    fillRect(canvas, x, y, boxWidth, 30, row.depth === 0 ? [219, 234, 254, 255] : [255, 255, 255, 255]);
    strokeRect(canvas, x, y, boxWidth, 30, [51, 65, 85, 255]);
    drawText(canvas, x + 10, y + 8, row.name, scale, [15, 23, 42, 255]);
  }

  await writeFile(filename, encodePng(canvas));
}

function treeRows(dependencies) {
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

  const depths = new Map();

  function depth(name, path = new Set()) {
    if (depths.has(name)) {
      return depths.get(name);
    }
    if (path.has(name)) {
      return 1;
    }

    const dependenciesForNode = parents.get(name) ?? [];
    const result =
      dependenciesForNode.length === 0
        ? 1
        : Math.max(
            ...dependenciesForNode.map((dependency) =>
              depth(dependency, new Set([...path, name])),
            ),
          ) + 1;
    depths.set(name, result);
    return result;
  }

  for (const node of nodes) {
    depth(node);
  }

  const children = new Map();
  for (const [child, dependenciesForNode] of parents) {
    const deepestParent = dependenciesForNode.reduce((deepest, candidate) =>
      depths.get(candidate) > depths.get(deepest) ? candidate : deepest,
    );
    const entries = children.get(deepestParent) ?? [];
    entries.push(child);
    children.set(deepestParent, entries);
  }

  for (const entries of children.values()) {
    entries.sort(compareNames);
  }

  const roots = [...nodes].filter((node) => !parents.has(node)).sort(compareNames);
  const rows = [{ name: "open-abap repositories", depth: 0, parent: undefined }];
  const visited = new Set();

  function visit(name, depth, parent, path) {
    if (visited.has(name)) {
      return;
    }
    visited.add(name);
    const rowIndex = rows.push({ name, depth, parent }) - 1;

    for (const child of children.get(name) ?? []) {
      if (!path.has(child)) {
        visit(child, depth + 1, rowIndex, new Set([...path, child]));
      }
    }
  }

  for (const root of roots) {
    visit(root, 1, 0, new Set([root]));
  }

  for (const node of nodes) {
    if (!visited.has(node)) {
      visit(node, 1, 0, new Set([node]));
    }
  }

  return rows;
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createCanvas(width, height, background) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set(background, offset);
  }
  return { width, height, pixels };
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  canvas.pixels.set(color, (y * canvas.width + x) * 4);
}

function fillRect(canvas, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setPixel(canvas, column, row, color);
    }
  }
}

function strokeRect(canvas, x, y, width, height, color) {
  drawLine(canvas, x, y, x + width - 1, y, color);
  drawLine(canvas, x, y + height - 1, x + width - 1, y + height - 1, color);
  drawLine(canvas, x, y, x, y + height - 1, color);
  drawLine(canvas, x + width - 1, y, x + width - 1, y + height - 1, color);
}

function drawLine(canvas, x1, y1, x2, y2, color) {
  const dx = Math.abs(x2 - x1);
  const sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1);
  const sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;

  while (true) {
    setPixel(canvas, x1, y1, color);
    if (x1 === x2 && y1 === y2) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x1 += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y1 += sy;
    }
  }
}

function drawText(canvas, x, y, text, scale, color) {
  for (const character of text.toUpperCase()) {
    const glyph = FONT[character] ?? FONT[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") {
          fillRect(canvas, x + column * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    x += 6 * scale;
  }
}

function encodePng(canvas) {
  const scanlines = Buffer.alloc((canvas.width * 4 + 1) * canvas.height);
  for (let row = 0; row < canvas.height; row += 1) {
    const target = row * (canvas.width * 4 + 1);
    scanlines[target] = 0;
    canvas.pixels.copy(scanlines, target + 1, row * canvas.width * 4, (row + 1) * canvas.width * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header.set([8, 6, 0, 0, 0], 8);

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), data.length + 8);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
