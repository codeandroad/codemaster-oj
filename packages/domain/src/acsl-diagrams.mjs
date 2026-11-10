const colors = new Set(['ink', 'muted', 'accent', 'surface', 'none', 'red', 'green', 'blue', 'yellow', 'orange', 'cyan', 'magenta', 'white', 'black']);
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const coordinate = value => finite(value, -16384, 16384);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');

function path(value) {
  if (!boundedText(value, 128000)) return false;
  const token = /[MmLlCcQqZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  const tokens = [...value.matchAll(token)];
  if (!tokens.length || !/^[Mm]$/.test(tokens[0][0])) return false;
  let end = 0;
  for (const match of tokens) {
    if (!/^[\s,]*$/.test(value.slice(end, match.index))) return false;
    end = match.index + match[0].length;
  }
  if (!/^[\s,]*$/.test(value.slice(end))) return false;
  const arities = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++][0].toUpperCase();
    if (!Object.hasOwn(arities, command)) return false;
    let count = 0;
    while (i < tokens.length && !/^[MmLlCcQqZz]$/.test(tokens[i][0])) {
      if (!coordinate(Number(tokens[i++][0]))) return false;
      count++;
    }
    if (arities[command] === 0 ? count !== 0 : count === 0 || count % arities[command] !== 0) return false;
  }
  return true;
}

function element(value) {
  const shared = ['type', 'stroke', 'fill', 'strokeWidth'];
  if (!plain(value) || value.stroke !== undefined && !colors.has(value.stroke) ||
      value.fill !== undefined && !colors.has(value.fill) ||
      value.strokeWidth !== undefined && !finite(value.strokeWidth, 0, 32)) return false;
  const keys = names => only(value, [...shared, ...names]);
  switch (value.type) {
    case 'path': return keys(['d']) && path(value.d);
    case 'line': return keys(['x1', 'y1', 'x2', 'y2']) && [value.x1, value.y1, value.x2, value.y2].every(coordinate);
    case 'polyline': return keys(['points']) && Array.isArray(value.points) && value.points.length >= 2 && value.points.length <= 2000 &&
      value.points.every(point => Array.isArray(point) && point.length === 2 && point.every(coordinate));
    case 'circle': return keys(['cx', 'cy', 'r']) && [value.cx, value.cy].every(coordinate) && finite(value.r, 0.01, 4096);
    case 'ellipse': return keys(['cx', 'cy', 'rx', 'ry']) && [value.cx, value.cy].every(coordinate) && [value.rx, value.ry].every(v => finite(v, 0.01, 4096));
    case 'rect': return keys(['x', 'y', 'width', 'height', 'rx']) && [value.x, value.y].every(coordinate) &&
      [value.width, value.height].every(v => finite(v, 0.01, 4096)) && (value.rx === undefined || finite(value.rx, 0, 2048));
    case 'text': return keys(['x', 'y', 'text', 'fontSize', 'anchor', 'font', 'weight']) && [value.x, value.y].every(coordinate) &&
      boundedText(value.text, 1000) && (value.fontSize === undefined || finite(value.fontSize, 1, 256)) &&
      (value.anchor === undefined || ['start', 'middle', 'end'].includes(value.anchor)) &&
      (value.font === undefined || ['sans', 'serif', 'mono'].includes(value.font)) &&
      (value.weight === undefined || ['normal', 'bold'].includes(value.weight));
    default: return false;
  }
}

export function validateAcslDiagrams(value) {
  if (value === undefined) return;
  if (!only(value, ['en', 'zh'])) throw new Error('Invalid localized ACSL diagrams.');
  for (const language of ['en', 'zh']) {
    const diagrams = value[language];
    if (!Array.isArray(diagrams) || diagrams.length > 20) throw new Error('Invalid ACSL diagram list.');
    const ids = new Set();
    for (const diagram of diagrams) {
      if (!only(diagram, ['id', 'width', 'height', 'alt', 'elements']) || !/^[A-Za-z0-9-]{1,100}$/.test(diagram.id ?? '') || ids.has(diagram.id) ||
          !finite(diagram.width, 1, 4096) || !finite(diagram.height, 1, 4096) || !only(diagram.alt, ['en', 'zh']) ||
          !boundedText(diagram.alt.en, 1000) || !boundedText(diagram.alt.zh, 1000) ||
          !Array.isArray(diagram.elements) || !diagram.elements.length || diagram.elements.length > 1000 ||
          !diagram.elements.every(element)) throw new Error('Invalid safe ACSL diagram.');
      ids.add(diagram.id);
    }
  }
}
