import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node grow-snake.mjs input.svg output.svg');

const source = readFileSync(input, 'utf8');
// Read the contribution grid emitted by the pinned Platane/snk action.
const cells = [...source.matchAll(/<rect class="c(?: (c[0-9a-z]+))?" x="(\d+)" y="(\d+)"/g)]
  .map(([, id, x, y]) => ({ id, x: Number(x), y: Number(y) }));
if (!cells.length) throw new Error('Contribution grid is missing from the source SVG');

const palette = ['#262027', '#541623', '#88182c', '#c11f39', '#ef5267'];
const snakeColor = '#ff3d58';
const levels = new Map([...source.matchAll(/\.c\.(c[0-9a-z]+)\{fill:var\(--c([1-4])\)/g)]
  .map(([, id, level]) => [id, Number(level)]));
const step = 16;
const initialLength = 4;
const top = Math.min(...cells.map(cell => cell.y));
const left = Math.min(...cells.map(cell => cell.x));
const right = Math.max(...cells.map(cell => cell.x));
const bottom = Math.max(...cells.map(cell => cell.y));
const grid = new Map(cells.map(cell => [cell.x + ',' + cell.y, cell]));

// Sweep every column once, alternating direction, so a growing tail never intersects the head.
const route = Array.from({ length: initialLength - 1 }, (_, i) => [
  left - (initialLength - 1 - i) * step + 6, top + 6,
]);
const eatenAt = [];
for (let x = left; x <= right; x += step) {
  const down = ((x - left) / step) % 2 === 0;
  for (let offset = 0; offset <= bottom - top; offset += step) {
    const y = down ? top + offset : bottom - offset;
    const cell = grid.get(x + ',' + y);
    if (cell?.id) {
      cell.level = levels.get(cell.id);
      if (!cell.level) throw new Error('Missing contribution level for ' + cell.id);
      cell.eatenAt = route.length - initialLength + 1;
      eatenAt.push(cell.eatenAt);
    }
    route.push([x + 6, y + 6]);
  }
}
const moves = route.length - initialLength;
const ticks = moves + 36; // Hold the complete snake briefly before looping.
const duration = (ticks * 55) + 'ms';
const fraction = (num, denominator = ticks) => (num / denominator).toFixed(9);
const animate = (attributes) => '<animate ' + attributes + ' dur="' + duration + '" repeatCount="indefinite"/>';

const gridMarkup = cells.map(({ x, y, level, eatenAt: tick }) => {
  const color = palette[level ?? 0];
  const consumption = level ? animate(
    'attributeName="fill" calcMode="discrete" values="' + color + ';' + palette[0] + ';' + palette[0] +
    '" keyTimes="0;' + fraction(Math.max(0, tick - 0.01)) + ';1"',
  ) : '';
  return '<rect x="' + x + '" y="' + y + '" width="12" height="12" rx="2" fill="' + color + '">' + consumption + '</rect>';
});

const parts = [];
for (let segment = initialLength + eatenAt.length - 1; segment >= 0; segment--) {
  const index = initialLength - 1 - segment;
  const startMove = Math.max(0, -index);
  const endPoint = fraction(index + moves, route.length - 1);
  const startPoint = fraction(Math.max(0, index), route.length - 1);
  const times = startMove ? '0;' + fraction(startMove) + ';' : '0;';
  const points = startMove ? '0;0;' : startPoint + ';';
  const birth = eatenAt[segment - initialLength];
  const visibility = segment >= initialLength ? animate(
    'attributeName="opacity" calcMode="discrete" values="0;1;1" keyTimes="0;' + fraction(Math.max(0.001, birth)) + ';1"',
  ) : '';
  const radius = segment === 0 ? 8.8 : 8.1;
  parts.push('<rect x="' + -radius + '" y="' + -radius + '" width="' + radius * 2 + '" height="' + radius * 2 +
    '" rx="3" fill="' + snakeColor + '"' + (visibility ? ' opacity="0"' : '') + '>' + visibility +
    '<animateMotion calcMode="linear" dur="' + duration + '" repeatCount="indefinite" keyTimes="' +
    times + fraction(moves) + ';1" keyPoints="' + points + endPoint + ';' + endPoint +
    '"><mpath href="#route"/></animateMotion></rect>');
}

const minX = left - initialLength * step;
const width = right + step * 2 - minX;
const minY = top - step;
const height = bottom + step * 2 - minY;
const svg = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + [minX, minY, width, height].join(' ') + '" width="' + width + '" height="' + height + '">',
  '<title>Cobrinha vermelha crescendo no gráfico de contribuições</title>',
  '<desc>Dados de contribuições obtidos com Platane/snk. A cobrinha ganha um segmento a cada célula ativa.</desc>',
  '<defs><path id="route" d="M' + route.map(point => point.join(',')).join(' L') + '"/></defs>',
  ...gridMarkup,
  ...parts,
  '</svg>',
].join('\n');
writeFileSync(output, svg + '\n');
