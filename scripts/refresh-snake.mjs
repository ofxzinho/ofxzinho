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
const visits = new Map();
for (let i = 0; i < turns.length - 1; i++) {
  const a = turns[i];
  const b = turns[i + 1];
  const steps = Math.hypot(b.x - a.x, b.y - a.y) / 16;
  if (!Number.isInteger(steps)) throw new Error('Unexpected original route');
  for (let step = 0; step <= steps; step++) {
    const ratio = steps ? step / steps : 0;
    const key = [a.x + (b.x - a.x) * ratio + 2, a.y + (b.y - a.y) * ratio + 2].join(',');
    if (!visits.has(key)) visits.set(key, a.time + (b.time - a.time) * ratio);
  }
}
const percent = time => time.toFixed(4) + '%';
const styles = [];
const eaten = Array.from({ length: 5 }, () => []);
const cellMarkup = cells.map(({ x, y, level }, i) => {
  const id = 'live' + i;
  const time = visits.get([x, y].join(','));
  if (level) {
    const fill = 'var(--c' + level + ')';
    styles.push('.c.' + id + '{fill:' + fill + (time === undefined ? '' : ';animation-name:' + id) + '}');
    if (time !== undefined) {
      styles.push('@keyframes ' + id + '{0%,' + percent(Math.max(0, time - 0.01)) + '{fill:' + fill +
        '}' + percent(Math.min(100, time + 0.01)) + ',100%{fill:var(--ce)}}');
      eaten[level].push(time);
    }
  }
  return '<rect class="c' + (level ? ' ' + id : '') + '" x="' + x + '" y="' + y + '" rx="2" ry="2"/>';
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
    '{transform:scale(' + i / times.length + ',1)}' + percent(time + 0.01) +
    '{transform:scale(' + (i + 1) / times.length + ',1)}').join('');
  styles.push('@keyframes ' + id + '{' + frames + '100%{transform:scale(1,1)}}');
  styles.push('.u.' + id + '{fill:var(--c' + level + ');animation-name:' + id + ';transform-origin:' + left + 'px 0}');
  bar.push('<rect class="u ' + id + '" x="' + left + '" y="144" width="' + width + '" height="12"/>');
  left += width;
}

let insertedGrid = false;
let insertedBar = false;
const output = template
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
