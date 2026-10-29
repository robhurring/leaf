# Animations

Fenced ` ```three ` and ` ```canvas ` blocks run as live panes, for illustrating an idea while you present or share a document. Each pane runs sealed off from leaf: it can't reach your files, leaf itself, or the network. It plays while it's on screen and rests when it isn't.

Hover a pane for **pause**, **restart**, and **view code**. **Open zoomed view** in the block tools shows it large in the Stage, for presenting. Set a pane's height in the fence: ` ```three height=400 `.

## A shape to look around

A three block gets `THREE`, `OrbitControls`, and a ready `scene`, `camera`, and `renderer`; leaf draws the scene every frame. Drag to turn it, scroll to zoom.

```three height=400
const knot = new THREE.Mesh(
  new THREE.TorusKnotGeometry(1, 0.32, 220, 32),
  new THREE.MeshStandardMaterial({ color: 0x3e82f7, metalness: 0.35, roughness: 0.3 }),
);
scene.add(knot);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.2));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(3, 4, 5);
scene.add(key);
camera.position.set(0, 0, 6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

onFrame((t, dt) => {
  knot.rotation.x += dt * 0.0003;
  knot.rotation.y += dt * 0.0005;
  controls.update();
});
```

## Waves adding up

Two waves crossing a surface: one running along x, one along y. Where their crests meet the surface rises highest. The wireframe follows the page's light or dark appearance.

```three height=360
const geo = new THREE.PlaneGeometry(8, 8, 80, 80);
const surface = new THREE.Mesh(
  geo,
  new THREE.MeshStandardMaterial({ color: 0x30a46c, flatShading: true, side: THREE.DoubleSide }),
);
const lines = new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.1 });
surface.add(new THREE.Mesh(geo, lines));
surface.rotation.x = -Math.PI / 2.6;
scene.add(surface);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(2, 5, 3);
scene.add(sun);
camera.position.set(0, 0.6, 7);

const ink = () => lines.color.set(theme === 'dark' ? 0xffffff : 0x000000);
ink();
addEventListener('themechange', ink);

const pos = geo.attributes.position;
onFrame((t) => {
  const s = t / 1000;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, 0.35 * Math.sin(x * 1.3 + s * 1.6) + 0.25 * Math.cos(y * 1.7 - s * 1.1));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
});
```

## Where a sine wave comes from

A point going round a circle, seen from the side, moves up and down in a sine wave. A canvas block gets `canvas`, `ctx`, and its `width` and `height` in CSS pixels; `onFrame(fn)` calls `fn(t, dt)` every frame with the milliseconds since it started and since the last frame.

```canvas height=300
const blue = '#3e82f7';
const red = '#e5484d';
const ink = () => (theme === 'dark' ? '#e6edf3' : '#1f2328');
const faint = () => (theme === 'dark' ? 'rgba(230,237,243,0.2)' : 'rgba(31,35,40,0.16)');
const SPEED = 0.06; // pixels the wave moves right per millisecond
const samples = [];

const dot = (x, y, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
};

onFrame((t) => {
  const r = Math.min(70, height * 0.3);
  const cx = r + 40;
  const cy = height / 2;
  const angle = t / 900;
  const px = cx + r * Math.cos(angle);
  const py = cy - r * Math.sin(angle);
  const startX = cx + r + 40;

  samples.unshift({ t, y: py });
  while (samples.length && startX + (t - samples.at(-1).t) * SPEED > width) samples.pop();

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = faint();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(width, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = ink();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(px, py);
  ctx.stroke();

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = red;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(startX, py);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = blue;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  samples.forEach((s, i) => {
    const x = startX + (t - s.t) * SPEED;
    if (i === 0) ctx.moveTo(x, s.y);
    else ctx.lineTo(x, s.y);
  });
  ctx.stroke();

  dot(px, py, red);
  dot(startX, py, blue);
  ctx.fillStyle = ink();
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText('a point turning', cx - 44, cy + r + 26);
  ctx.fillText('its height over time: sin θ', startX + 8, 22);
});
```

## A flow field

Each particle follows the direction a smooth field points to where it stands; the field shifts slowly over time. Faded trails show the paths.

```canvas height=340
const N = 900;
const fresh = () => ({ x: Math.random() * width, y: Math.random() * height, age: 0 });
const particles = Array.from({ length: N }, () => ({ ...fresh(), age: Math.random() * 400 }));
const direction = (x, y, s) => Math.sin(x * 0.006 + s) * 2.2 + Math.cos(y * 0.008 - s * 0.7) * 2.2;
addEventListener('themechange', () => ctx.clearRect(0, 0, width, height));

onFrame((t, dt) => {
  const s = t / 4000;
  // Fade what's drawn toward transparent, leaving trails.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = 1.2;
  const light = theme === 'dark' ? 65 : 42;
  for (const p of particles) {
    const a = direction(p.x, p.y, s);
    const nx = p.x + Math.cos(a) * dt * 0.06;
    const ny = p.y + Math.sin(a) * dt * 0.06;
    ctx.strokeStyle = `hsla(${190 + Math.abs(a * 25) % 70}, 80%, ${light}%, 0.6)`;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    Object.assign(p, { x: nx, y: ny, age: p.age + 1 });
    if (p.x < 0 || p.x > width || p.y < 0 || p.y > height || p.age > 400) Object.assign(p, fresh());
  }
});
```

## Bubble sort, one comparison at a time

Each step compares two neighbours and swaps them if they're out of order; after each pass the largest remaining bar has bubbled to the end. Amber is a comparison, red a swap, green a bar in its final place.

```canvas height=260
const n = 24;
const STEP_MS = 120;
let bars, pass, j, done, last, wait, held;

function reset() {
  bars = Array.from({ length: n }, () => 0.1 + Math.random() * 0.9);
  pass = 0;
  j = 0;
  done = false;
  last = null;
  wait = 0;
  held = 0;
}

function step() {
  if (j >= n - 1 - pass) {
    j = 0;
    pass++;
    if (pass >= n - 1) {
      done = true;
      return;
    }
  }
  last = { at: j, swapped: bars[j] > bars[j + 1] };
  if (last.swapped) [bars[j], bars[j + 1]] = [bars[j + 1], bars[j]];
  j++;
}

function draw() {
  const dark = theme === 'dark';
  ctx.clearRect(0, 0, width, height);
  const gap = 4;
  const w = (width - 40 - gap * (n - 1)) / n;
  bars.forEach((v, k) => {
    const h = v * (height - 64);
    const placed = done || k >= n - pass;
    const active = !done && last && (k === last.at || k === last.at + 1);
    ctx.fillStyle = active
      ? last.swapped
        ? '#e5484d'
        : '#d29922'
      : placed
        ? '#30a46c'
        : dark
          ? '#6e7681'
          : '#afb8c1';
    ctx.fillRect(20 + k * (w + gap), height - 24 - h, w, h);
  });
  ctx.fillStyle = dark ? '#e6edf3' : '#1f2328';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(done ? 'sorted' : `pass ${pass + 1}`, 20, 22);
}

reset();
onFrame((t, dt) => {
  if (done) {
    held += dt;
    if (held > 1500) reset();
  } else {
    wait += dt;
    while (wait >= STEP_MS && !done) {
      wait -= STEP_MS;
      step();
    }
  }
  draw();
});
```

## When a block goes wrong

An error shows under the pane with the line it came from; the rest of the document carries on.

```canvas height=140
ctx.fillStyle = '#e5484d';
ctx.fillRect(16, 16, 40, 40);
undefinedThing();
```
