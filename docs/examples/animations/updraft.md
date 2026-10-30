# Updraft

A whole game in one ` ```canvas ` block. You're a leaf on the wind: tap the pane (or click it, then press space or ↑) to catch a gust, and drift through the gaps between the branches. Stop tapping and you sink. After a few points the wind starts to shift and the gaps drift with it, and it all speeds up as you go.

Open the zoomed view to play it big.

```canvas height=460
const R = 13; // the leaf's size, for hitting things
const GRAVITY = 0.0016; // how fast you sink, px per ms²
const GUST = -0.5; // a tap's lift, px per ms
const THICK = 46; // a branch's thickness
const SPACING = 270; // between branches
const X = () => width * 0.26;
const gap = () => Math.max(124, 176 - score * 2);

let state = 'ready';
let score = 0;
let best = 0;
let y, vy, branches, speed, drift, overFor;
const motes = Array.from({ length: 46 }, () => ({
  x: Math.random() * width,
  y: Math.random() * height,
  s: 0.3 + Math.random() * 0.7,
}));

function reset() {
  y = height * 0.45;
  vy = 0;
  score = 0;
  speed = 0.17;
  drift = 0;
  branches = [];
  for (let i = 0; i < 5; i++) addBranch(width + 140 + i * SPACING);
}

function addBranch(x) {
  branches.push({
    x,
    base: height * (0.28 + Math.random() * 0.44),
    phase: Math.random() * Math.PI * 2,
    passed: false,
  });
}

// Where a branch's gap is now: still at first, swaying with the wind once you score.
const gapY = (b) => b.base + Math.sin(drift / 850 + b.phase) * Math.min(46, score * 4);

function gust() {
  if (state === 'over' && overFor < 450) return; // a beat before trying again
  if (state !== 'playing') {
    reset();
    state = 'playing';
  }
  vy = GUST;
}

function crash() {
  state = 'over';
  overFor = 0;
  best = Math.max(best, score);
}

canvas.addEventListener('pointerdown', () => {
  focus(); // so space and ↑ come here next
  gust();
});
addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'ArrowUp') {
    e.preventDefault();
    gust();
  }
});

function drawBranch(b, colors) {
  const g = gapY(b);
  const half = gap() / 2;
  ctx.fillStyle = colors.bark;
  ctx.beginPath();
  ctx.roundRect(b.x, -20, THICK, g - half + 20, 12);
  ctx.roundRect(b.x, g + half, THICK, height - g - half + 20, 12);
  ctx.fill();
  // A twig and a few leaves where each branch ends.
  ctx.fillStyle = colors.foliage;
  for (const [tipY, dir] of [
    [g - half, -1],
    [g + half, 1],
  ]) {
    for (const dx of [6, THICK / 2, THICK - 6]) {
      ctx.beginPath();
      ctx.ellipse(b.x + dx, tipY + dir * 6, 9, 5, dx / 20, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLeaf(colors, t) {
  ctx.save();
  ctx.translate(X(), y);
  const tilt = state === 'ready' ? Math.sin(t / 500) * 0.2 : Math.max(-0.7, Math.min(1.1, vy * 1.6));
  ctx.rotate(tilt);
  ctx.fillStyle = colors.leaf;
  ctx.beginPath();
  ctx.moveTo(-R - 6, 0);
  ctx.quadraticCurveTo(-2, -R - 2, R + 8, 0);
  ctx.quadraticCurveTo(-2, R + 2, -R - 6, 0);
  ctx.fill();
  ctx.strokeStyle = colors.vein;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-R - 10, 0);
  ctx.lineTo(R + 4, 0);
  ctx.stroke();
  ctx.restore();
}

function text(str, x, y, size, color, weight = 600) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(str, x, y);
}

reset();
onFrame((t, frameDt) => {
  const dt = Math.min(frameDt, 40);
  const dark = theme === 'dark';
  const colors = {
    bark: dark ? '#8a6a4f' : '#7a5838',
    foliage: dark ? '#3f9a68' : '#2f8f5b',
    leaf: '#30a46c',
    vein: dark ? '#0d1117' : '#ffffff',
    mote: dark ? 'rgba(230,237,243,0.25)' : 'rgba(31,35,40,0.18)',
    ink: dark ? '#e6edf3' : '#1f2328',
    muted: dark ? '#9198a1' : '#59636e',
  };

  if (state === 'playing') {
    vy += GRAVITY * dt;
    y += vy * dt;
    drift += dt;
    speed = 0.17 + score * 0.004;
    for (const b of branches) {
      b.x -= speed * dt;
      if (!b.passed && b.x + THICK < X() - R) {
        b.passed = true;
        score++;
      }
    }
    if (branches[0].x < -THICK) {
      branches.shift();
      addBranch(branches.at(-1).x + SPACING);
    }
    if (y + R > height || y - R < 0) crash();
    for (const b of branches) {
      if (X() + R < b.x || X() - R > b.x + THICK) continue;
      const g = gapY(b);
      if (y - R < g - gap() / 2 || y + R > g + gap() / 2) crash();
    }
  } else if (state === 'over') {
    overFor += dt;
  } else {
    y = height * 0.45 + Math.sin(t / 420) * 10;
  }

  ctx.clearRect(0, 0, width, height);
  // The wind, as motes streaming past.
  ctx.strokeStyle = colors.mote;
  ctx.lineWidth = 1.5;
  for (const m of motes) {
    if (state !== 'over') m.x -= (0.08 + speed * 0.9) * m.s * dt;
    if (m.x < -20) Object.assign(m, { x: width + 20, y: Math.random() * height });
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x + 14 * m.s, m.y);
    ctx.stroke();
  }
  if (state !== 'ready') for (const b of branches) drawBranch(b, colors);
  drawLeaf(colors, t);

  if (state === 'playing') text(String(score), width / 2, 54, 40, colors.ink, 700);
  if (state === 'ready') {
    text('Updraft', width / 2, height * 0.28, 34, colors.ink, 700);
    text('tap, or click then press space, to catch the wind', width / 2, height * 0.28 + 30, 15, colors.muted, 500);
  }
  if (state === 'over') {
    text(`${score}`, width / 2, height * 0.3, 44, colors.ink, 700);
    text(score >= best && score > 0 ? 'a new best' : `best ${best}`, width / 2, height * 0.3 + 28, 15, colors.muted, 500);
    if (overFor > 450) text('tap to fly again', width / 2, height * 0.3 + 54, 15, colors.muted, 500);
  }
});
```
