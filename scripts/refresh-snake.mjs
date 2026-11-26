import { readFileSync, writeFileSync } from 'node:fs';

const [templateFile, gridFile, outputFile] = process.argv.slice(2);
const template = readFileSync(templateFile, 'utf8');
const grid = readFileSync(gridFile, 'utf8');
const cellPattern = /<rect class="c(?: (c[0-9a-z]+))?" x="(\d+)" y="(\d+)" rx="2" ry="2"\/>/g;
const levels = new Map([...grid.matchAll(/\.c\.(c[0-9a-z]+)\{fill:var\(--c([1-4])\)/g)]
  .map(([, id, level]) => [id, Number(level)]));
const cells = [...grid.matchAll(cellPattern)].map(([, id, x, y]) => {
  const level = id ? levels.get(id) : 0;
  if (level === undefined) throw new Error('Unknown contribution level: ' + id);
  return { x: Number(x), y: Number(y), level };
});

// Recover the exact original head route, including its compressed keyframe intervals.
const head = template.match(/@keyframes s0\{([\s\S]*?)\}\.s\.s0\{/);
if (!head || !cells.length) throw new Error('Missing original movement or contribution grid');
const turns = [...head[1].matchAll(/([\d.,%]+)\{transform:translate\((-?\d+)px,(-?\d+)px\)\}/g)]
  .flatMap(([, timings, x, y]) => timings.split(',').map(time => ({ time: Number.parseFloat(time), x: +x, y: +y })))
  .sort((a, b) => a.time - b.time);
const duration = Number(template.match(/animation:none (\d+)ms/)[1]);
const originalTicks = duration / 100;
const poseFrame = originalTicks - 1;
const pointKey = (x, y) => x + ',' + y;
const same = (a, b) => a.x === b.x && a.y === b.y;
const distance = (a, b) => (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / 16;
const route = [];
const visits = new Map();
for (let i = 0; i < turns.length - 1; i++) {
  const a = turns[i];
  const b = turns[i + 1];
  const steps = Math.hypot(b.x - a.x, b.y - a.y) / 16;
  if (!Number.isInteger(steps)) throw new Error('Unexpected original route');
  for (let step = 0; step <= steps; step++) {
    const ratio = steps ? step / steps : 0;
    const x = Math.round(a.x + (b.x - a.x) * ratio);
    const y = Math.round(a.y + (b.y - a.y) * ratio);
    const time = a.time + (b.time - a.time) * ratio;
    route[Math.round(time * originalTicks / 100)] = { x, y };
    const key = pointKey(x + 2, y + 2);
    if (!visits.has(key)) visits.set(key, time);
  }
}
const percent = time => time.toFixed(2) + '%';

// Find a short detour that rejoins the next original step and leaves enough
// space for the remaining three body segments to rejoin as well.
const directions = [[16, 0], [-16, 0], [0, 16], [0, -16]];
const bounds = {
  left: Math.min(...cells.map(cell => cell.x)) - 18,
  right: Math.max(...cells.map(cell => cell.x)) + 14,
  top: Math.min(...cells.map(cell => cell.y)) - 18,
  bottom: Math.max(...cells.map(cell => cell.y)) + 14,
};
function advance(body, next) {
  if (body.slice(0, 3).some(part => same(part, next))) return null;
  return [next, ...body.slice(0, 3)];
}
function findDetour(index, target, limit) {
  const goal = route[index + 1];
  const initialBody = Array.from({ length: 4 }, (_, part) =>
    route[index - part] ?? { x: (part - index) * 16, y: -16 });
  const queue = [{ body: initialBody, path: [], reached: false }];
  const seen = new Set();
  const suffix = route.slice(index + 2, index + 5);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { body, path, reached } = queue[cursor];
    const [head] = body;
    if (reached && same(head, goal)) {
      let mergedBody = body;
      for (const next of suffix) {
        mergedBody = advance(mergedBody, next);
        if (!mergedBody) break;
      }
      if (mergedBody) return path.slice(0, -1);
    }
    const remaining = reached ? distance(head, goal) : distance(head, target) + distance(target, goal);
    if (path.length + remaining > limit) continue;
    for (const [dx, dy] of directions) {
      const next = { x: head.x + dx, y: head.y + dy };
      if (next.x < bounds.left || next.x > bounds.right || next.y < bounds.top || next.y > bounds.bottom) continue;
      const nextBody = advance(body, next);
      if (!nextBody) continue;
      const nextReached = reached || same(next, target);
      const key = nextBody.map(part => pointKey(part.x, part.y)).join(';') + ':' + nextReached;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ body: nextBody, path: [...path, next], reached: nextReached });
    }
  }
  return null;
}

if (route.length !== poseFrame + 1 || Array.from(route).some(point => !point)) {
  throw new Error('The original animation could not be expanded into grid steps');
}
const board = new Set(route.map(point => pointKey(point.x + 2, point.y + 2)));
let addedSteps = 0;
for (const { x, y, level } of cells) {
  if (!level || board.has(pointKey(x, y))) continue;
  const target = { x: x - 2, y: y - 2 };
  const candidates = route.slice(0, -5).flatMap((point, index) => {
    if (distance(point, route[index + 1]) !== 1) return [];
    return [{ index, minimum: distance(point, target) + distance(target, route[index + 1]) }];
  }).sort((a, b) => a.minimum - b.minimum);
  let best;
  for (const { index, minimum } of candidates) {
    if (best && minimum >= best.path.length + 1) break;
    const limit = Math.min(minimum + 8, best?.path.length ?? Infinity);
    const path = findDetour(index, target, limit);
    if (path && (!best || path.length < best.path.length)) best = { index, path };
  }
  if (!best) throw new Error('No safe detour to contribution at ' + pointKey(x, y));
  route.splice(best.index + 1, 0, ...best.path);
  addedSteps += best.path.length;
  for (const point of best.path) board.add(pointKey(point.x + 2, point.y + 2));
}

const totalTicks = originalTicks + addedSteps;
let animation = template;
if (addedSteps) {
  visits.clear();
  route.forEach(({ x, y }, i) => {
    const key = pointKey(x + 2, y + 2);
    if (!visits.has(key)) visits.set(key, i / totalTicks * 100);
  });
  animation = animation.replaceAll(duration + 'ms', totalTicks * 100 + 'ms');
  for (let part = 0; part < 4; part++) {
    const points = route.map((_, i) => {
      if (i === route.length - 1 || i < part) return { x: (i === route.length - 1 ? part : part - i) * 16, y: -16 };
      return route[i - part];
    });
    const frames = points.flatMap((point, i) => {
      const a = points[i - 1];
      const b = points[i + 1];
      if (a && b && point.x * 2 === a.x + b.x && point.y * 2 === a.y + b.y) return [];
      return [percent(i / totalTicks * 100) + '{transform:translate(' + point.x + 'px,' + point.y + 'px)}'];
    });
    animation = animation.replace(
      new RegExp('@keyframes s' + part + '\\{(?:[^{}]*\\{[^{}]*\\})+\\}'),
      '@keyframes s' + part + '{' + frames.join('') + '}',
    );
  }
}

const styles = ['.c{animation-timing-function:steps(1)}'];
const eaten = Array.from({ length: 5 }, () => []);
const cellMarkup = cells.map(({ x, y, level }, i) => {
  const id = 'f' + i.toString(36);
  const time = visits.get([x, y].join(','));
  if (level) {
    const fill = 'var(--c' + level + ')';
    styles.push('.c.' + id + '{fill:' + fill + (time === undefined ? '' : ';animation-name:' + id) + '}');
    if (time !== undefined) {
      styles.push('@keyframes ' + id + '{' + percent(time) + ',100%{fill:var(--ce)}}');
      eaten[level].push(time);
    }
  }
  return '<rect class="c' + (level ? ' ' + id : '') + '" x="' + x + '" y="' + y + '" rx="2"/>';
});

const count = eaten.flat().length;
const bar = [];
let left = 0;
for (let level = 1; level < eaten.length; level++) {
  const times = eaten[level].sort((a, b) => a - b);
  if (!times.length) continue;
  const width = times.length / count * 848;
  const id = 'bar' + level;
  const frames = times.map((time, i) => percent(Math.max(0, time - 0.01)) +
    '{transform:scale(' + (i / times.length).toFixed(4) + ',1)}' + percent(time + 0.01) +
    '{transform:scale(' + ((i + 1) / times.length).toFixed(4) + ',1)}').join('');
  styles.push('@keyframes ' + id + '{' + frames + '100%{transform:scale(1,1)}}');
  styles.push('.u.' + id + '{fill:var(--c' + level + ');animation-name:' + id + ';transform-origin:' + left + 'px 0}');
  bar.push('<rect class="u ' + id + '" x="' + left + '" y="144" width="' + width + '" height="12"/>');
  left += width;
}

let insertedGrid = false;
let insertedBar = false;
const output = animation
  .replace(/@keyframes [cu][0-9a-z]+\{(?:[^{}]*\{[^{}]*\})+\}/g, '')
  .replace(/\.[cu]\.[cu][0-9a-z]+\{[^{}]*\}/g, '')
  .replace(cellPattern, () => {
    if (insertedGrid) return '';
    insertedGrid = true;
    return cellMarkup.join('');
  })
  .replace(/<rect class="u u[0-9a-z]+"[^>]*\/>/g, () => {
    if (insertedBar) return '';
    insertedBar = true;
    return bar.join('');
  })
  .replace('</style>', styles.join('') + '</style>');
if (!insertedGrid || !insertedBar) throw new Error('Original SVG format changed');
writeFileSync(outputFile, output.trimEnd() + '\n');
