# Seedfall

A whole game in one ` ```canvas ` block. A cloud drifts along the top: move it with the mouse (or click the pane, then ← and →) and click or press space to drop a seed. The seed bounces down through the pebbles, lighting each one it touches, and lands in a pot. Every pebble lit on the way down adds to that drop's score, and the pots pay more toward the edges. Each pot grows a flower as seeds land in it. Ten seeds a round.

Open the zoomed view to play it big.

```canvas height=560
const SEEDS = 10;
const GRAVITY = 0.0012; // px per ms²
const BOUNCE = 0.62;
const POTS = [5, 2, 1, 3, 1, 2, 5]; // points per pot, left to right
const R = 6; // a seed's radius

let cloudX = width / 2;
let seed = null; // the falling seed: { x, y, vx, vy, lit }
let pebbles = [];
let left, score, best = 0, last = null, grown, sparks = [];

function layout() {
  pebbles = [];
  const rows = 9;
  const top = height * 0.2;
  // At most 60px apart: wider panes get more pebbles, not wider gaps.
  const across = Math.min(60, width / 11);
  const down = (height * 0.58) / rows;
  for (let r = 0; r < rows; r++) {
    // Three row positions, each a third of a gap along: every straight line down meets
    // a pebble, so no seed falls through untouched. Rows reach both walls.
    const shift = ((r % 3) * across) / 3;
    const row = [];
    for (let x = shift; x < width; x += across) if (x >= 10 && x <= width - 10) row.push(x);
    // And one by each wall where the row leaves a gap there.
    if (row[0] > 24) row.unshift(10);
    if (row.at(-1) < width - 24) row.push(width - 10);
    for (const x of row)
      // A little jitter, so no two runs fall the same.
      pebbles.push({ x: x + (Math.random() - 0.5) * 4, y: top + r * down, r: 7, lit: 0 });
  }
}

function newRound() {
  left = SEEDS;
  score = 0;
  grown = POTS.map(() => 0);
  layout();
}

const potWidth = () => width / POTS.length;
const potTop = () => height - 64;

function drop() {
  if (seed || left === 0) {
    if (left === 0 && !seed) newRound();
    return;
  }
  left--;
  seed = { x: cloudX, y: 52, vx: (Math.random() - 0.5) * 0.05, vy: 0, lit: 0 };
  for (const p of pebbles) p.lit = 0;
}

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  cloudX = Math.max(30, Math.min(width - 30, e.clientX - r.left));
});
canvas.addEventListener('pointerdown', () => {
  focus();
  drop();
});
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') cloudX = Math.max(30, cloudX - 24);
  else if (e.key === 'ArrowRight') cloudX = Math.min(width - 30, cloudX + 24);
  else if (e.key === ' ') drop();
  else return;
  e.preventDefault();
});

function step(dt) {
  if (!seed) return;
  seed.vy += GRAVITY * dt;
  seed.x += seed.vx * dt;
  seed.y += seed.vy * dt;
  if (seed.x < R) (seed.x = R), (seed.vx = Math.abs(seed.vx) * BOUNCE);
  if (seed.x > width - R) (seed.x = width - R), (seed.vx = -Math.abs(seed.vx) * BOUNCE);
  for (const p of pebbles) {
    const dx = seed.x - p.x;
    const dy = seed.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= R + p.r || dist === 0) continue;
    // Push out, then reflect the velocity off the pebble, losing some speed.
    const nx = dx / dist;
    const ny = dy / dist;
    seed.x = p.x + nx * (R + p.r);
    seed.y = p.y + ny * (R + p.r);
    const along = seed.vx * nx + seed.vy * ny;
    if (along < 0) {
      seed.vx -= (1 + BOUNCE) * along * nx;
      seed.vy -= (1 + BOUNCE) * along * ny;
      seed.vx += (Math.random() - 0.5) * 0.02;
    }
    if (!p.lit) {
      p.lit = 1;
      seed.lit++;
      sparks.push({ x: p.x, y: p.y, age: 0 });
    }
  }
  // Pot walls catch the seed.
  if (seed.y > potTop()) {
    const i = Math.max(0, Math.min(POTS.length - 1, Math.floor(seed.x / potWidth())));
    const points = POTS[i] * Math.max(1, seed.lit);
    score += points;
    best = Math.max(best, score);
    grown[i]++;
    last = { text: `+${points}`, x: (i + 0.5) * potWidth(), y: potTop() - 10, age: 0 };
    seed = null;
  }
}

function flower(x, base, size, dark) {
  if (!size) return;
  const h = Math.min(56, 14 + size * 10);
  ctx.strokeStyle = '#30a46c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.quadraticCurveTo(x - 6, base - h / 2, x, base - h);
  ctx.stroke();
  const petals = Math.min(8, 3 + size);
  for (let k = 0; k < petals; k++) {
    const a = (k / petals) * Math.PI * 2;
    ctx.fillStyle = ['#e54666', '#d29922', '#8e4ec6', '#3e82f7'][size % 4];
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * 7, base - h + Math.sin(a) * 7, 5, 3, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = dark ? '#f5d76e' : '#f0b429';
  ctx.beginPath();
  ctx.arc(x, base - h, 4, 0, Math.PI * 2);
  ctx.fill();
}

newRound();
onFrame((t, frameDt) => {
  const dark = theme === 'dark';
  const ink = dark ? '#e6edf3' : '#1f2328';
  const muted = dark ? '#9198a1' : '#59636e';
  // Small steps, so a fast seed never skips through a pebble.
  let dt = Math.min(frameDt, 40);
  while (dt > 0) {
    const s = Math.min(dt, 4);
    step(s);
    dt -= s;
  }

  ctx.clearRect(0, 0, width, height);

  // The cloud, and the seed waiting under it.
  ctx.fillStyle = dark ? 'rgba(230,237,243,0.85)' : 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  for (const [dx, dy, r] of [[-16, 4, 13], [0, -4, 17], [17, 4, 12], [8, 8, 11], [-6, 8, 11]])
    ctx.moveTo(cloudX + dx + r, 30 + dy), ctx.arc(cloudX + dx, 30 + dy, r, 0, Math.PI * 2);
  ctx.fill();
  if (!seed && left > 0) {
    ctx.fillStyle = '#8b5e34';
    ctx.beginPath();
    ctx.ellipse(cloudX, 52, R, R * 0.75, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pebbles, glowing once a seed has touched them on this drop.
  for (const p of pebbles) {
    ctx.fillStyle = p.lit ? '#d29922' : dark ? '#3d444d' : '#c7ced6';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    if (p.lit) {
      ctx.strokeStyle = 'rgba(210,153,34,0.35)';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }
  sparks = sparks.filter((s) => (s.age += frameDt) < 400);
  for (const s of sparks) {
    ctx.strokeStyle = `rgba(210,153,34,${1 - s.age / 400})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7 + s.age / 25, 0, Math.PI * 2);
    ctx.stroke();
  }

  // The falling seed.
  if (seed) {
    ctx.fillStyle = '#8b5e34';
    ctx.beginPath();
    ctx.ellipse(seed.x, seed.y, R, R * 0.75, Math.atan2(seed.vy, seed.vx), 0, Math.PI * 2);
    ctx.fill();
  }

  // Pots, with their points and what's grown in them.
  const w = potWidth();
  POTS.forEach((points, i) => {
    const x = i * w;
    ctx.fillStyle = dark ? '#5c3d2e' : '#b4693a';
    ctx.beginPath();
    ctx.moveTo(x + 6, potTop());
    ctx.lineTo(x + w - 6, potTop());
    ctx.lineTo(x + w - 14, height - 6);
    ctx.lineTo(x + 14, height - 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`×${points}`, x + w / 2, potTop() + 34);
    flower(x + w / 2, potTop(), grown[i], dark);
  });

  if (last && (last.age += frameDt) < 900) {
    ctx.fillStyle = ink;
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(last.text, last.x, last.y - last.age / 30);
  }

  // Score and seeds left.
  ctx.textAlign = 'left';
  ctx.fillStyle = ink;
  ctx.font = '700 18px system-ui, sans-serif';
  ctx.fillText(`${score}`, 14, 26);
  ctx.fillStyle = muted;
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(`best ${best}`, 14, 44);
  ctx.fillText(left || seed ? `${left} seeds left` : 'click for a new round', 14, 62);
});
```
