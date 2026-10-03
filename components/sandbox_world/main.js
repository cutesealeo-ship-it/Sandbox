import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const W = 48, D = 48, H = 40;          // world size in blocks
const SEA = 6;                          // cells below this height are underwater
const WATER_Y = SEA - 0.15;             // water surface height
const GRAVITY = 22;
const SAFE_IMPACT = 12;                 // landing speed (~3 blocks) that causes no damage
const FALL_DAMAGE_PER_SPEED = 7;
const HUMAN_HALF = 0.17, HUMAN_HEIGHT = 0.86;
const MAX_HUMANS = 60;
const ANCHOR = 0x80, MAT_MASK = 0x7f;   // voxel byte: low 7 bits = block id, high bit = anchored
const STEP = 1 / 60;

const BLOCKS = [
  { id: 1, name: 'Grass', top: 'grass_top', side: 'grass_side', bottom: 'dirt', rough: 0.95 },
  { id: 2, name: 'Dirt', all: 'dirt', rough: 1.0 },
  { id: 3, name: 'Stone', all: 'stone', rough: 0.85 },
  { id: 4, name: 'Sand', all: 'sand', rough: 0.95 },
  { id: 5, name: 'Snow', all: 'snow', rough: 0.6 },
  { id: 6, name: 'Log', top: 'log_top', side: 'bark', bottom: 'log_top', rough: 0.9 },
  { id: 7, name: 'Leaves', all: 'leaves', rough: 0.8, cutout: true, seeThrough: true },
  { id: 8, name: 'Planks', all: 'planks', rough: 0.75 },
  { id: 9, name: 'Brick', all: 'brick', rough: 0.9 },
  { id: 10, name: 'Glass', all: 'glass', rough: 0.05, glass: true, seeThrough: true },
  { id: 11, name: 'Metal', all: 'metal', rough: 0.35, metal: 0.85 },
];
const BLOCK_BY_ID = [];
BLOCKS.forEach(b => { BLOCK_BY_ID[b.id] = b; });
const BLOCK_ID = Object.fromEntries(BLOCKS.map(b => [b.name.toLowerCase(), b.id]));
const BUILD_MATERIALS = ['planks', 'brick', 'stone', 'log', 'glass', 'metal'];

const THEMES = {
  grasslands: { label: 'Grasslands', icon: '🌿', base: SEA + 4, amp: 6, fall: [0.55, 1.0], trees: 0.012,
    sky: 0x5c9fe0, horizon: 0xcfe4f2, water: 0x2b6f9e, sun: 0xfff1d6 },
  desert: { label: 'Desert', icon: '🏜️', base: SEA + 3, amp: 4, fall: [0.6, 1.0], trees: 0,
    sky: 0x6aa2d4, horizon: 0xf0dcb8, water: 0x2a8a9a, sun: 0xffe2b0 },
  snow: { label: 'Snowy Peaks', icon: '🏔️', base: SEA + 6, amp: 12, fall: [0.5, 1.0], trees: 0.012,
    sky: 0x86abd0, horizon: 0xe6eef6, water: 0x2f5f80, sun: 0xf3f6ff },
  islands: { label: 'Islands', icon: '🏝️', base: SEA, amp: 9, fall: [0.25, 0.95], trees: 0.015,
    sky: 0x3c90dc, horizon: 0xbfe7f7, water: 0x1f8fb0, sun: 0xfff4dc },
};

const STRUCTURES = {
  tower: { size: [1, 1], cells: () => [0, 1, 2, 3].map(y => [0, y, 0]) },
  wall: { size: [4, 1], cells: () => [0, 1].flatMap(y => [0, 1, 2, 3].map(x => [x, y, 0])) },
  hut: { size: [3, 3], cells: () => {
    const out = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
      const edge = x === 0 || x === 2 || z === 0 || z === 2;
      if (edge && !(x === 1 && z === 0)) out.push([x, y, z]);  // leave a door
    }
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) out.push([x, 2, z]);
    return out;
  } },
  pyramid: { size: [3, 3], cells: () => {
    const out = [];
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) out.push([x, 0, z]);
    out.push([1, 1, 1]);
    return out;
  } },
};

const NAMES = ['Ada', 'Bo', 'Cyd', 'Dot', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu', 'Max', 'Nia', 'Oz',
  'Pip', 'Quin', 'Rae', 'Sol', 'Tia', 'Uma', 'Vic', 'Wes', 'Xia', 'Yuri', 'Zed'];
const SHIRTS = [0xd64545, 0x3f7fd6, 0x3fae5a, 0xe0b23a, 0x8b5cc7, 0xe07a3a, 0x2fb5b0, 0xf2f2f2];
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const HAIRS = [0x2b1d14, 0x5a3825, 0xc9a35b, 0x1a1a1a, 0x8a3b1e, 0xdedede];

const rand = Math.random;
const pick = arr => arr[Math.floor(rand() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ============================================================================
// STREAMLIT BRIDGE
// ============================================================================

const pending = new Map();
let saves = [];

function postToStreamlit(type, data = {}) {
  window.parent.postMessage({ isStreamlitMessage: true, type, ...data }, '*');
}

function request(action, payload, onDone) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  pending.set(id, onDone);
  postToStreamlit('streamlit:setComponentValue', { value: { id, action, ...payload }, dataType: 'json' });
}

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'streamlit:render') return;
  const args = event.data.args || {};
  saves = args.saves || [];
  renderSaveList();
  const res = args.response;
  if (res && pending.has(res.id)) {
    const done = pending.get(res.id);
    pending.delete(res.id);
    done(res);
  }
});

// ============================================================================
// PROCEDURAL TEXTURES
// ============================================================================

const TEX = 64;
const texCanvas = {};

function makeCanvas(size = TEX) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Tileable value noise in [0, 1]
function tileNoise(size, cells) {
  const g = Float32Array.from({ length: cells * cells }, rand);
  const at = (i, j) => g[((i % cells) + cells) % cells + (((j % cells) + cells) % cells) * cells];
  return (x, y) => {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    let tx = fx - x0, ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

function paintNoise(ctx, [r, g, b], coarse, fine) {
  const n1 = tileNoise(TEX, 4), n2 = tileNoise(TEX, 16);
  const img = ctx.createImageData(TEX, TEX);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    const k = (n1(x, y) - 0.5) * coarse + (n2(x, y) - 0.5) * fine + (rand() - 0.5) * fine * 0.6;
    const i = (y * TEX + x) * 4;
    img.data[i] = r + k; img.data[i + 1] = g + k; img.data[i + 2] = b + k; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function grain(ctx, amount) {
  const img = ctx.getImageData(0, 0, TEX, TEX);
  for (let i = 0; i < img.data.length; i += 4) {
    const k = (rand() - 0.5) * amount;
    img.data[i] += k; img.data[i + 1] += k; img.data[i + 2] += k;
  }
  ctx.putImageData(img, 0, 0);
}

function speckle(ctx, count, colors, minR, maxR) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = pick(colors);
    ctx.beginPath();
    ctx.arc(rand() * TEX, rand() * TEX, minR + rand() * (maxR - minR), 0, Math.PI * 2);
    ctx.fill();
  }
}

const PAINTERS = {
  dirt(ctx) {
    paintNoise(ctx, [116, 82, 56], 40, 30);
    speckle(ctx, 40, ['rgba(70,48,30,.8)', 'rgba(160,130,100,.6)', 'rgba(95,90,85,.7)'], 0.6, 1.8);
  },
  grass_top(ctx) {
    paintNoise(ctx, [84, 136, 50], 36, 30);
    ctx.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      const x = rand() * TEX, y = rand() * TEX;
      ctx.strokeStyle = pick(['rgba(40,90,25,.7)', 'rgba(130,180,80,.6)', 'rgba(60,110,35,.7)']);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 2, y - 2 - rand() * 3); ctx.stroke();
    }
  },
  grass_side(ctx) {
    PAINTERS.dirt(ctx);
    const top = makeCanvas();
    PAINTERS.grass_top(top.getContext('2d'));
    const n = tileNoise(TEX, 8);
    for (let x = 0; x < TEX; x++) {
      const h = Math.round(9 + n(x, 0) * 9);
      ctx.drawImage(top, x, 0, 1, h, x, 0, 1, h);
      ctx.fillStyle = 'rgba(30,50,20,.35)';
      ctx.fillRect(x, h, 1, 2);
    }
  },
  stone(ctx) {
    paintNoise(ctx, [122, 122, 124], 46, 26);
    ctx.strokeStyle = 'rgba(55,55,60,.55)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let x = rand() * TEX, y = rand() * TEX;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 5; s++) { x += (rand() - 0.5) * 12; y += (rand() - 0.5) * 12; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    speckle(ctx, 25, ['rgba(160,160,165,.5)', 'rgba(80,80,85,.5)'], 0.5, 1.5);
  },
  sand(ctx) {
    paintNoise(ctx, [216, 192, 140], 18, 26);
    speckle(ctx, 50, ['rgba(180,150,100,.5)', 'rgba(240,225,190,.6)'], 0.4, 1);
  },
  snow(ctx) {
    paintNoise(ctx, [234, 241, 250], 14, 12);
    speckle(ctx, 30, ['rgba(255,255,255,.9)', 'rgba(200,215,235,.6)'], 0.4, 1.2);
  },
  bark(ctx) {
    paintNoise(ctx, [96, 68, 44], 30, 22);
    for (let i = 0; i < 12; i++) {
      const x0 = rand() * TEX, phase = rand() * 6;
      ctx.fillStyle = pick(['rgba(45,30,18,.6)', 'rgba(130,100,70,.35)']);
      for (let y = 0; y < TEX; y++) ctx.fillRect(x0 + Math.sin(y * 0.2 + phase) * 1.2, y, 1.6, 1);
    }
  },
  log_top(ctx) {
    paintNoise(ctx, [168, 128, 84], 16, 14);
    ctx.lineWidth = 1.2;
    for (let r = 27; r > 1; r -= 3) {
      ctx.strokeStyle = `rgba(110,75,45,${0.3 + rand() * 0.3})`;
      ctx.beginPath(); ctx.arc(32 + rand(), 32 + rand(), r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.lineWidth = 5; ctx.strokeStyle = '#5a3d26';
    ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#5a3d26'; ctx.fillRect(0, 0, TEX, 2); ctx.fillRect(0, TEX - 2, TEX, 2);
    ctx.fillRect(0, 0, 2, TEX); ctx.fillRect(TEX - 2, 0, 2, TEX);
  },
  leaves(ctx) {
    paintNoise(ctx, [50, 102, 38], 50, 40);
    speckle(ctx, 60, ['rgba(110,160,70,.6)', 'rgba(30,70,25,.7)'], 1, 2.5);
    const holes = tileNoise(TEX, 10), fine = tileNoise(TEX, 24);
    const img = ctx.getImageData(0, 0, TEX, TEX);
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
      if (holes(x, y) * 0.6 + fine(x, y) * 0.4 < 0.3) img.data[(y * TEX + x) * 4 + 3] = 0;
    }
    ctx.putImageData(img, 0, 0);
  },
  planks(ctx) {
    paintNoise(ctx, [160, 118, 74], 14, 12);
    for (let p = 0; p < 4; p++) {
      const y0 = p * 16;
      ctx.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${rand() * 0.14})` : `rgba(255,220,180,${rand() * 0.12})`;
      ctx.fillRect(0, y0, TEX, 16);
      ctx.strokeStyle = 'rgba(95,62,35,.35)'; ctx.lineWidth = 1;
      for (let g = 0; g < 6; g++) {
        const gy = y0 + 2 + rand() * 12, ph = rand() * 6, amp = 0.5 + rand();
        ctx.beginPath();
        for (let x = 0; x <= TEX; x += 4) ctx.lineTo(x, gy + Math.sin(x * 0.12 + ph) * amp);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(50,32,20,.85)';
      ctx.fillRect(0, y0, TEX, 1);
      const jx = Math.floor(rand() * TEX);
      ctx.fillRect(jx, y0, 1, 16);
      ctx.fillStyle = 'rgba(40,40,40,.8)';
      ctx.fillRect((jx + 4) % TEX, y0 + 7, 1.5, 1.5);
      ctx.fillRect((jx + TEX - 5) % TEX, y0 + 7, 1.5, 1.5);
    }
  },
  brick(ctx) {
    paintNoise(ctx, [180, 172, 160], 10, 14);
    for (let r = 0; r < 8; r++) {
      const off = (r % 2) * 8;
      for (let c = -1; c < 5; c++) {
        const x = c * 16 + off;
        const shade = (rand() - 0.5) * 34;
        ctx.fillStyle = `rgb(${148 + shade},${62 + shade * 0.4 + rand() * 10},${46 + shade * 0.3})`;
        ctx.fillRect(x + 1, r * 8 + 1, 14, 6);
        ctx.fillStyle = 'rgba(0,0,0,.12)';
        ctx.fillRect(x + 1, r * 8 + 6, 14, 1);
        ctx.fillStyle = 'rgba(255,220,200,.1)';
        ctx.fillRect(x + 1, r * 8 + 1, 14, 1);
      }
    }
    grain(ctx, 22);
  },
  glass(ctx) {
    ctx.clearRect(0, 0, TEX, TEX);
    ctx.fillStyle = 'rgba(190,225,245,0.16)';
    ctx.fillRect(0, 0, TEX, TEX);
    ctx.strokeStyle = 'rgba(235,248,255,0.85)'; ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, TEX - 3, TEX - 3);
    ctx.strokeStyle = 'rgba(150,190,210,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(4.5, 4.5, TEX - 9, TEX - 9);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(12, 52); ctx.lineTo(28, 36); ctx.moveTo(18, 54); ctx.lineTo(36, 36); ctx.stroke();
  },
  metal(ctx) {
    paintNoise(ctx, [150, 156, 164], 16, 8);
    for (let y = 0; y < TEX; y++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)';
      ctx.fillRect(0, y, TEX, 1);
    }
    ctx.strokeStyle = 'rgba(60,64,70,.75)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, TEX - 2, TEX - 2);
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(3, TEX - 3); ctx.lineTo(3, 3); ctx.lineTo(TEX - 3, 3); ctx.stroke();
    for (const [x, y] of [[7, 7], [57, 7], [7, 57], [57, 57]]) {
      ctx.fillStyle = 'rgba(70,74,80,.9)'; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(230,235,240,.8)'; ctx.beginPath(); ctx.arc(x - 0.6, y - 0.6, 1, 0, Math.PI * 2); ctx.fill();
    }
  },
};

// Bump detail: derive a tangent-space normal map from the texture's brightness
function normalMapFrom(src, strength = 2.5) {
  const s = src.width;
  const data = src.getContext('2d').getImageData(0, 0, s, s).data;
  const lum = new Float32Array(s * s);
  for (let i = 0; i < s * s; i++) lum[i] = (0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2]) / 255;
  const out = makeCanvas(s);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(s, s);
  const L = (x, y) => lum[((y + s) % s) * s + ((x + s) % s)];
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = (L(x + 1, y) - L(x - 1, y)) * strength;
    const dy = (L(x, y + 1) - L(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    const i = (y * s + x) * 4;
    img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
    img.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

// ============================================================================
// RENDERER, SCENE, CAMERA
// ============================================================================

const stage = document.getElementById('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.body.insertAdjacentHTML('beforeend', '<div id="error">WebGL is not available in this browser, so the 3D world cannot be shown.</div>');
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(W / 2 + 20, SEA + 20, D / 2 + 26);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(W / 2, SEA + 2, D / 2);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 4;
controls.maxDistance = 140;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.keyPanSpeed = 20;
controls.listenToKeyEvents(window);

function canvasTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

// ---------- Block materials ----------
const materialCache = {};
function faceMaterial(key, b) {
  if (materialCache[key]) return materialCache[key];
  const c = makeCanvas();
  PAINTERS[key](c.getContext('2d'));
  texCanvas[key] = c;
  const m = new THREE.MeshStandardMaterial({ map: canvasTexture(c), roughness: b.rough, metalness: b.metal || 0 });
  if (b.glass) {
    m.transparent = true;
    m.depthWrite = false;
    m.envMapIntensity = 1.6;
  } else {
    m.normalMap = canvasTexture(normalMapFrom(c), false);
    m.normalScale.set(0.9, 0.9);
  }
  if (b.cutout) { m.alphaTest = 0.5; m.side = THREE.DoubleSide; }
  materialCache[key] = m;
  return m;
}
for (const b of BLOCKS) {
  if (b.all) {
    b.material = faceMaterial(b.all, b);
    b.icon = { top: b.all, side: b.all };
  } else {
    const side = faceMaterial(b.side, b);
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z
    b.material = [side, side, faceMaterial(b.top, b), faceMaterial(b.bottom, b), side, side];
    b.icon = { top: b.top, side: b.side };
  }
  b.solidMaterial = Array.isArray(b.material) ? b.material[0] : b.material;
}

// ---------- Sky, lights, water ----------
const skyUniforms = {
  top: { value: new THREE.Color() },
  horizon: { value: new THREE.Color() },
  sunDir: { value: new THREE.Vector3(0.45, 0.65, 0.35).normalize() },
};
const skyMaterial = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir;
    varying vec3 vDir;
    void main() {
      vec3 dir = normalize(vDir);
      float h = max(dir.y, 0.0);
      vec3 col = mix(horizon, top, pow(h, 0.55));
      col = mix(col, horizon * 0.85, smoothstep(0.0, -0.25, dir.y));
      float s = max(dot(dir, sunDir), 0.0);
      col += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 6.0 + pow(s, 12.0) * 0.25);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMaterial);
sky.position.set(W / 2, 0, D / 2);
scene.add(sky);

const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial));
let envTarget = null;

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a4a36, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.8);
sun.position.set(W / 2 + 45, 65, D / 2 + 35);
sun.target.position.set(W / 2, 0, D / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
scene.environmentIntensity = 0.55;

const blastLight = new THREE.PointLight(0xffa040, 0, 30, 2);
scene.add(blastLight);

const waterTexCanvas = makeCanvas(128);
{
  const ctx = waterTexCanvas.getContext('2d');
  const n1 = tileNoise(128, 6), n2 = tileNoise(128, 18);
  const img = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = (n1(x, y) * 0.6 + n2(x, y) * 0.4) * 255;
    const i = (y * 128 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
const waterNormal = canvasTexture(normalMapFrom(waterTexCanvas, 4), false);
waterNormal.wrapS = waterNormal.wrapT = THREE.RepeatWrapping;
waterNormal.repeat.set(60, 60);
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(800, 800),
  new THREE.MeshStandardMaterial({ color: 0x2b6f9e, transparent: true, opacity: 0.8, roughness: 0.06, metalness: 0.1,
    normalMap: waterNormal, normalScale: new THREE.Vector2(0.35, 0.35), depthWrite: false }),
);
water.rotation.x = -Math.PI / 2;
water.position.set(W / 2, WATER_Y, D / 2);
water.receiveShadow = true;
water.renderOrder = 2;
scene.add(water);

const seabed = new THREE.Mesh(
  new THREE.PlaneGeometry(800, 800),
  new THREE.MeshStandardMaterial({ map: canvasTexture(texCanvas.sand), roughness: 1 }),
);
const sandFloorMap = seabed.material.map;
sandFloorMap.wrapS = sandFloorMap.wrapT = THREE.RepeatWrapping;
sandFloorMap.repeat.set(800, 800);
seabed.rotation.x = -Math.PI / 2;
seabed.position.set(W / 2, -0.01, D / 2);
seabed.receiveShadow = true;
scene.add(seabed);

// Faint grid that marks the buildable area once the sea is gone
const buildGrid = new THREE.GridHelper(W, W, 0xffffff, 0xffffff);
buildGrid.material.transparent = true;
buildGrid.material.opacity = 0.35;
buildGrid.position.set(W / 2, 0.01, D / 2);
buildGrid.visible = false;
scene.add(buildGrid);

let waterOn = true;
function setWater(on) {
  waterOn = on;
  water.visible = on;
  buildGrid.visible = !on;
  seabed.material.map = on ? sandFloorMap : null;
  seabed.material.color.set(on ? 0xffffff : 0xaab4bf);
  seabed.material.needsUpdate = true;
}
// Is a surface at this height dry land?
const isDry = top => (waterOn ? top > SEA : true);

function applyTheme(key) {
  const t = THEMES[key];
  skyUniforms.top.value.set(t.sky);
  skyUniforms.horizon.value.set(t.horizon);
  scene.fog = new THREE.Fog(t.horizon, 90, 330);
  sun.color.set(t.sun);
  hemi.color.set(t.horizon);
  water.material.color.set(t.water);
  if (envTarget) envTarget.dispose();
  envTarget = pmrem.fromScene(envScene, 0.04);
  scene.environment = envTarget.texture;
}

// ============================================================================
// WORLD (voxel grid)
// ============================================================================

const world = new Uint8Array(W * H * D);
const loose = new Set();     // indices of unanchored blocks (can fall)
const idx = (x, y, z) => x + W * (z + D * y);
const inBounds = (x, y, z) => x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D;
const cellOf = i => [i % W, Math.floor(i / (W * D)), Math.floor(i / W) % D];
const getCell = (x, y, z) => (inBounds(x, y, z) ? world[idx(x, y, z)] : 0);

function setCell(x, y, z, v) {
  const i = idx(x, y, z);
  world[i] = v;
  if (v && !(v & ANCHOR)) loose.add(i); else loose.delete(i);
  meshesDirty = true;
}

// Solid for collisions: the floor below y=0 and invisible walls at the world edge
function solidAt(x, y, z) {
  if (y < 0) return true;
  if (x < 0 || x >= W || z < 0 || z >= D) return true;
  if (y >= H) return false;
  return world[idx(x, y, z)] !== 0;
}

function groundTop(x, z, fromY = H - 1) {
  if (x < 0 || x >= W || z < 0 || z >= D) return 0;
  for (let y = Math.min(H - 1, Math.floor(fromY)); y >= 0; y--) if (world[idx(x, y, z)]) return y + 1;
  return 0;
}

function rebuildLooseSet() {
  loose.clear();
  for (let i = 0; i < world.length; i++) if (world[i] && !(world[i] & ANCHOR)) loose.add(i);
}

function valueNoise2D(cell) {
  const gw = Math.ceil(W / cell) + 2;
  const g = Float32Array.from({ length: gw * (Math.ceil(D / cell) + 2) }, rand);
  return (x, z) => {
    const fx = x / cell, fz = z / cell;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const tx = smoothstep(0, 1, fx - x0), tz = smoothstep(0, 1, fz - z0);
    const a = g[x0 + z0 * gw], b = g[x0 + 1 + z0 * gw], c = g[x0 + (z0 + 1) * gw], d = g[x0 + 1 + (z0 + 1) * gw];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };
}

function generateTerrain(themeKey) {
  const T = THEMES[themeKey];
  world.fill(0);
  const n1 = valueNoise2D(16), n2 = valueNoise2D(8), n3 = valueNoise2D(4);
  const heights = new Int32Array(W * D);
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const n = 0.55 * n1(x, z) + 0.3 * n2(x, z) + 0.15 * n3(x, z);
    const dx = (x + 0.5 - W / 2) / (W / 2), dz = (z + 0.5 - D / 2) / (D / 2);
    const fall = 1 - smoothstep(T.fall[0], T.fall[1], Math.hypot(dx, dz));
    let h = T.base + (n - 0.5) * 2 * T.amp;
    h = (SEA - 3) + (h - (SEA - 3)) * fall;
    heights[x + z * W] = clamp(Math.round(h), 1, H - 14);
  }
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const h = heights[x + z * W];
    const steep = Math.max(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ox, oz]) =>
      Math.abs(h - (heights[clamp(x + ox, 0, W - 1) + clamp(z + oz, 0, D - 1) * W]))));
    const beach = h <= SEA + 1;
    for (let y = 0; y < h; y++) {
      const depth = h - 1 - y;
      let id;
      if (themeKey === 'desert') {
        id = depth < 4 ? (depth === 0 && n3(x, z) > 0.78 ? BLOCK_ID.stone : BLOCK_ID.sand) : BLOCK_ID.stone;
      } else if (themeKey === 'snow') {
        if (depth === 0) id = beach ? BLOCK_ID.sand : steep > 2 ? BLOCK_ID.stone : BLOCK_ID.snow;
        else id = depth < 3 && steep <= 2 ? BLOCK_ID.dirt : BLOCK_ID.stone;
      } else {
        if (depth === 0) id = beach ? BLOCK_ID.sand : BLOCK_ID.grass;
        else id = depth < 3 ? (beach ? BLOCK_ID.sand : BLOCK_ID.dirt) : BLOCK_ID.stone;
      }
      world[idx(x, y, z)] = id | ANCHOR;
    }
  }
  // Trees
  if (T.trees) {
    for (let z = 3; z < D - 3; z++) for (let x = 3; x < W - 3; x++) {
      if (rand() > T.trees) continue;
      const h = heights[x + z * W];
      const top = world[idx(x, h - 1, z)] & MAT_MASK;
      if (top !== BLOCK_ID.grass && top !== BLOCK_ID.snow) continue;
      plantTree(x, h, z, themeKey === 'snow');
    }
  }
  rebuildLooseSet();
  meshesDirty = true;
}

function plantTree(x, y, z, conifer) {
  const trunk = 4 + Math.floor(rand() * 2);
  if (y + trunk + 2 >= H) return;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    if ((getCell(x + dx, y, z + dz) & MAT_MASK) === BLOCK_ID.log) return;  // too close to another tree
  }
  const radii = conifer ? [2, 2, 1, 1, 0] : [2, 2, 1, 1];
  const start = y + trunk - (conifer ? 3 : 2);
  radii.forEach((r, layer) => {
    const ly = start + layer;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (r > 1 && Math.abs(dx) === r && Math.abs(dz) === r && rand() < 0.7) continue;
      if (inBounds(x + dx, ly, z + dz) && !getCell(x + dx, ly, z + dz)) world[idx(x + dx, ly, z + dz)] = BLOCK_ID.leaves | ANCHOR;
    }
  });
  for (let t = 0; t < trunk; t++) world[idx(x, y + t, z)] = BLOCK_ID.log | ANCHOR;
  if (inBounds(x, y + trunk, z) && !getCell(x, y + trunk, z)) world[idx(x, y + trunk, z)] = BLOCK_ID.leaves | ANCHOR;
}

// ============================================================================
// BLOCK RENDERING (one instanced mesh per block type, exposed faces only)
// ============================================================================

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const blockMeshes = [];
const _m4 = new THREE.Matrix4();
const _col = new THREE.Color();
let meshesDirty = true;
const stats = { blocks: 0, loose: 0, deaths: 0, built: 0, counts: {} };

const seeThrough = id => !!BLOCK_BY_ID[id]?.seeThrough;
function hidesNeighbor(x, y, z) {
  if (y < 0) return true;
  if (!inBounds(x, y, z)) return false;
  const v = world[idx(x, y, z)];
  return v !== 0 && !seeThrough(v & MAT_MASK);
}
const hash01 = (x, y, z) => ((((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 1000) / 1000;

function ensureMesh(id, n) {
  let mesh = blockMeshes[id];
  if (mesh && mesh.userData.cap >= n) return mesh;
  if (mesh) { scene.remove(mesh); mesh.dispose(); }
  const cap = Math.max(64, Math.ceil(n * 1.5));
  const b = BLOCK_BY_ID[id];
  mesh = new THREE.InstancedMesh(boxGeo, b.material, cap);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  mesh.userData.cap = cap;
  mesh.frustumCulled = false;
  mesh.castShadow = !b.glass;
  mesh.receiveShadow = true;
  if (b.glass) mesh.renderOrder = 3;
  scene.add(mesh);
  blockMeshes[id] = mesh;
  return mesh;
}

function rebuildBlocks() {
  meshesDirty = false;
  const lists = BLOCKS.map(() => []);
  const counts = {};
  let total = 0, looseCount = 0;
  const showLoose = state.tool.type === 'anchor';
  for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const v = world[idx(x, y, z)];
    if (!v) continue;
    const id = v & MAT_MASK;
    total++;
    counts[id] = (counts[id] || 0) + 1;
    if (!(v & ANCHOR)) looseCount++;
    if (hidesNeighbor(x + 1, y, z) && hidesNeighbor(x - 1, y, z) && hidesNeighbor(x, y + 1, z) &&
        hidesNeighbor(x, y - 1, z) && hidesNeighbor(x, y, z + 1) && hidesNeighbor(x, y, z - 1)) continue;
    lists[id - 1].push(x, y, z, v);
  }
  BLOCKS.forEach((b, k) => {
    const list = lists[k];
    const n = list.length / 4;
    const mesh = ensureMesh(b.id, n);
    for (let j = 0; j < n; j++) {
      const x = list[j * 4], y = list[j * 4 + 1], z = list[j * 4 + 2], v = list[j * 4 + 3];
      _m4.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
      mesh.setMatrixAt(j, _m4);
      const tint = 0.88 + hash01(x, y, z) * 0.16;
      if (showLoose && !(v & ANCHOR)) _col.setRGB(1.25 * tint, 0.55 * tint, 0.22 * tint);
      else _col.setRGB(tint, tint, tint);
      mesh.setColorAt(j, _col);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  });
  stats.blocks = total;
  stats.loose = looseCount;
  stats.counts = counts;
  updateStats(fps);
}

// ============================================================================
// FALLING BLOCKS (gravity for unanchored blocks)
// ============================================================================

const falling = [];

function startFalling(i) {
  const v = world[i];
  const [x, y, z] = cellOf(i);
  setCell(x, y, z, 0);
  const mesh = new THREE.Mesh(boxGeo, BLOCK_BY_ID[v & MAT_MASK].material);
  mesh.castShadow = true;
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  scene.add(mesh);
  falling.push({ x, z, y, vy: 0, v, mesh, hit: new Set() });
}

function updateBlockGravity(dt) {
  if (settings.gravity) {
    for (const i of [...loose]) {
      const [x, y, z] = cellOf(i);
      if (y > 0 && !world[idx(x, y - 1, z)]) startFalling(i);
    }
  }
  for (let k = falling.length - 1; k >= 0; k--) {
    const f = falling[k];
    f.vy = Math.max(f.vy - GRAVITY * dt, -40);
    const newY = f.y + f.vy * dt;
    const rest = groundTop(f.x, f.z, Math.ceil(f.y) - 1);
    // Crush anyone in the way
    for (const h of humans) {
      if (h.dead || f.hit.has(h) || f.vy > -3) continue;
      if (Math.abs(h.pos.x - (f.x + 0.5)) < 0.5 + HUMAN_HALF && Math.abs(h.pos.z - (f.z + 0.5)) < 0.5 + HUMAN_HALF &&
          newY < h.pos.y + HUMAN_HEIGHT && newY + 1 > h.pos.y) {
        f.hit.add(h);
        damageHuman(h, Math.round(-f.vy * 6), 'a falling block');
        h.vel.set((rand() - 0.5) * 6, 3, (rand() - 0.5) * 6);
        h.onGround = false;
      }
    }
    if (newY <= rest) {
      let ly = rest;
      while (ly < H && world[idx(f.x, ly, f.z)]) ly++;
      if (ly < H) setCell(f.x, ly, f.z, f.v);
      scene.remove(f.mesh);
      falling.splice(k, 1);
      if (-f.vy > 6) { Sound.thud(); dustPuff(new THREE.Vector3(f.x + 0.5, ly, f.z + 0.5), 4); }
      markDirty();
    } else {
      f.y = newY;
      f.mesh.position.y = newY + 0.5;
    }
  }
}

// ============================================================================
// HUMANS
// ============================================================================

const humans = [];
let nextHumanId = 1;
const labels = document.getElementById('labels');

function makeHumanMesh(look) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: look.shirt, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2e3a59, roughness: 0.85 });
  const hair = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.9 });
  const add = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const limb = (w, h, d, mat, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(0, -h / 2, 0);
    add(geo, mat, 0, 0, 0, pivot);
    g.add(pivot);
    return pivot;
  };
  const legL = limb(0.085, 0.34, 0.09, pants, -0.055, 0.34);
  const legR = limb(0.085, 0.34, 0.09, pants, 0.055, 0.34);
  const torso = add(new THREE.BoxGeometry(0.24, 0.3, 0.14), shirt, 0, 0.49, 0);
  const armL = limb(0.065, 0.28, 0.07, shirt, -0.155, 0.62);
  const armR = limb(0.065, 0.28, 0.07, shirt, 0.155, 0.62);
  add(new THREE.SphereGeometry(0.1, 16, 12), skin, 0, 0.75, 0);
  add(new THREE.SphereGeometry(0.106, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 0.765, -0.006);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  add(new THREE.SphereGeometry(0.014, 6, 6), eyeMat, -0.035, 0.76, 0.092);
  add(new THREE.SphereGeometry(0.014, 6, 6), eyeMat, 0.035, 0.76, 0.092);
  g.userData = { legL, legR, armL, armR, torso, shirt };
  return g;
}

function spawnHuman(x, y, z, opts = {}) {
  if (humans.filter(h => !h.dead).length >= MAX_HUMANS) {
    log(`👥 That's the limit of ${MAX_HUMANS} humans`);
    return null;
  }
  const look = opts.look || { shirt: pick(SHIRTS), skin: pick(SKINS), hair: pick(HAIRS) };
  const mesh = makeHumanMesh(look);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const el = document.createElement('div');
  el.className = 'hp';
  el.innerHTML = '<div class="nm"></div><div class="bar"><div class="fill"></div></div>';
  labels.appendChild(el);
  const h = {
    id: nextHumanId++, name: opts.name || pick(NAMES), look, mesh, el,
    pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), health: opts.health ?? 100,
    task: 'idle', timer: 0.5 + rand() * 2, target: null, plan: null, stuck: 0,
    onGround: false, fallFrom: y, stun: 0, phase: 0, facing: rand() * Math.PI * 2, flash: 0,
    dead: false, deathT: 0,
  };
  el.querySelector('.nm').textContent = h.name;
  humans.push(h);
  return h;
}

function removeHuman(h) {
  scene.remove(h.mesh);
  h.mesh.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  h.el.remove();
  const i = humans.indexOf(h);
  if (i >= 0) humans.splice(i, 1);
}

function damageHuman(h, amount, cause) {
  if (h.dead || amount <= 0) return;
  h.health -= amount;
  h.flash = 0.3;
  popup(h.pos.clone().setY(h.pos.y + 1.1), `-${amount}`);
  Sound.hurt();
  if (h.health <= 0) {
    h.health = 0;
    h.dead = true;
    h.plan = null;
    stats.deaths++;
    log(`☠️ ${h.name} died from ${cause}`);
    Sound.die();
  } else if (amount >= 15) {
    log(`🤕 ${h.name} took ${amount} damage from ${cause}`);
  }
  markDirty();
}

const humanCollides = (x, y, z) => {
  const x0 = Math.floor(x - HUMAN_HALF), x1 = Math.floor(x + HUMAN_HALF);
  const z0 = Math.floor(z - HUMAN_HALF), z1 = Math.floor(z + HUMAN_HALF);
  const y0 = Math.floor(y + 0.001), y1 = Math.floor(y + HUMAN_HEIGHT);
  for (let cy = y0; cy <= y1; cy++) for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    if (solidAt(cx, cy, cz)) return true;
  }
  return false;
};

function humanInCell(x, y, z) {
  return humans.some(h => !h.dead &&
    h.pos.x + HUMAN_HALF > x && h.pos.x - HUMAN_HALF < x + 1 &&
    h.pos.z + HUMAN_HALF > z && h.pos.z - HUMAN_HALF < z + 1 &&
    h.pos.y + HUMAN_HEIGHT > y && h.pos.y < y + 1);
}

const inWater = h => waterOn && h.pos.y + 0.35 < WATER_Y;

function pickWanderTarget(h) {
  for (let tries = 0; tries < 10; tries++) {
    const x = clamp(Math.floor(h.pos.x + (rand() - 0.5) * 12), 1, W - 2);
    const z = clamp(Math.floor(h.pos.z + (rand() - 0.5) * 12), 1, D - 2);
    if (isDry(groundTop(x, z) + 1)) return { x: x + 0.5, z: z + 0.5 };
  }
  return null;
}

// Don't walk off cliffs taller than 3 blocks or into the sea
function safeAhead(h, dir) {
  const ax = Math.floor(h.pos.x + dir.x * 0.5), az = Math.floor(h.pos.z + dir.z * 0.5);
  const top = groundTop(ax, az, h.pos.y + 1.2);
  if (h.pos.y - top > 3.2) return false;
  if (!inWater(h) && !isDry(top + 1)) return false;
  return true;
}

function startPlan(h, structure, matName) {
  const S = STRUCTURES[structure];
  const id = BLOCK_ID[matName];
  if (!S || !id) return false;
  const [sx, sz] = S.size;
  const px = Math.floor(h.pos.x), pz = Math.floor(h.pos.z);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => rand() - 0.5);
  for (const [dx, dz] of dirs) {
    const ox = dx > 0 ? px + 2 : dx < 0 ? px - 1 - sx : px - Math.floor(sx / 2);
    const oz = dz > 0 ? pz + 2 : dz < 0 ? pz - 1 - sz : pz - Math.floor(sz / 2);
    if (ox < 1 || oz < 1 || ox + sx > W - 1 || oz + sz > D - 1) continue;
    const base = groundTop(ox, oz);
    if (!isDry(base + 1) || base + 4 >= H) continue;
    const cells = S.cells().map(([cx, cy, cz]) => [ox + cx, base + cy, oz + cz]).sort((a, b) => a[1] - b[1]);
    h.plan = { structure, mat: matName, id, cells, i: 0, stall: 0 };
    h.task = 'build';
    h.timer = 0.3;
    return true;
  }
  return false;
}

// Decide where to walk this tick. Returns a unit direction or null to stand still.
function think(h, dt) {
  if (h.task === 'idle') {
    h.timer -= dt;
    if (h.timer > 0) return null;
    if (settings.autoBuild && rand() < 0.12 && startPlan(h, pick(Object.keys(STRUCTURES)), pick(BUILD_MATERIALS))) {
      log(`🏗️ ${h.name} started building a ${h.plan.mat} ${h.plan.structure}`);
      return null;
    }
    const t = pickWanderTarget(h);
    if (t) { h.target = t; h.task = 'walk'; h.stuck = 0; } else h.timer = 1;
    return null;
  }
  if (h.task === 'walk') {
    const dx = h.target.x - h.pos.x, dz = h.target.z - h.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 0.3 || h.stuck > 2.5) { h.task = 'idle'; h.timer = 1 + rand() * 3; return null; }
    const dir = { x: dx / dist, z: dz / dist };
    if (!safeAhead(h, dir)) { h.task = 'idle'; h.timer = 0.4; return null; }
    return dir;
  }
  if (h.task === 'build') {
    const plan = h.plan;
    while (plan && plan.i < plan.cells.length && getCell(...plan.cells[plan.i])) plan.i++;
    if (!plan || plan.i >= plan.cells.length) {
      if (plan) { log(`🏠 ${h.name} finished a ${plan.mat} ${plan.structure}`); stats.built++; }
      h.plan = null; h.task = 'idle'; h.timer = 2;
      return null;
    }
    const [cx, cy, cz] = plan.cells[plan.i];
    const dx = cx + 0.5 - h.pos.x, dz = cz + 0.5 - h.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 2.2 && Math.abs(cy - h.pos.y) < 4) {
      h.facing = Math.atan2(dx, dz);
      h.timer -= dt;
      if (h.timer <= 0) {
        h.timer = 0.45;
        if (!humanInCell(cx, cy, cz)) {
          setCell(cx, cy, cz, plan.id | ANCHOR);
          Sound.place(0.35);
          plan.i++;
          plan.stall = 0;
          markDirty();
        } else if (++plan.stall > 6) plan.i++;
      }
      return null;
    }
    if (h.stuck > 3) { plan.i++; h.stuck = 0; return null; }
    const dir = { x: dx / dist, z: dz / dist };
    if (!safeAhead(h, dir)) { plan.i++; return null; }
    return dir;
  }
  return null;
}

function updateHuman(h, dt) {
  if (h.dead) { h.deathT += dt; return; }
  const wet = inWater(h);
  let want = null;
  if (h.stun > 0) h.stun -= dt;
  else if (h.onGround || wet) want = think(h, dt);

  if (want) {
    const speed = wet ? 1.0 : 1.7;
    h.vel.x = want.x * speed;
    h.vel.z = want.z * speed;
    h.facing = Math.atan2(want.x, want.z);
  } else if (h.onGround) {
    const f = Math.max(0, 1 - 10 * dt);
    h.vel.x *= f; h.vel.z *= f;
  } else {
    h.vel.x *= 1 - 0.3 * dt; h.vel.z *= 1 - 0.3 * dt;
  }

  if (wet) {
    // Float with the head above water; water also soaks up fall speed
    const floatY = WATER_Y - 0.6;
    h.vel.y += ((floatY - h.pos.y) * 3 - h.vel.y) * Math.min(1, 4 * dt);
    h.vel.x *= 1 - 1.5 * dt; h.vel.z *= 1 - 1.5 * dt;
  } else {
    h.vel.y = Math.max(h.vel.y - GRAVITY * dt, -45);
  }

  // Move axis by axis with sub-steps so fast falls don't tunnel
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(h.vel.x), Math.abs(h.vel.y), Math.abs(h.vel.z)) * dt / 0.3));
  const sdt = dt / steps;
  let impact = 0, blocked = false;
  for (let s = 0; s < steps; s++) {
    const ny = h.pos.y + h.vel.y * sdt;
    if (humanCollides(h.pos.x, ny, h.pos.z)) {
      if (h.vel.y < 0) {
        impact = Math.max(impact, -h.vel.y);
        const snapped = Math.floor(ny) + 1;
        if (!humanCollides(h.pos.x, snapped, h.pos.z)) h.pos.y = snapped;
      }
      h.vel.y = 0;
    } else h.pos.y = ny;
    const nx = h.pos.x + h.vel.x * sdt;
    if (humanCollides(nx, h.pos.y, h.pos.z)) { blocked = true; h.vel.x = h.onGround ? 0 : -h.vel.x * 0.2; } else h.pos.x = nx;
    const nz = h.pos.z + h.vel.z * sdt;
    if (humanCollides(h.pos.x, h.pos.y, nz)) { blocked = true; h.vel.z = h.onGround ? 0 : -h.vel.z * 0.2; } else h.pos.z = nz;
  }

  h.onGround = h.vel.y <= 0 && humanCollides(h.pos.x, h.pos.y - 0.03, h.pos.z);

  // Fall damage
  if (impact > 0 && !wet) {
    const fell = Math.max(0, h.fallFrom - h.pos.y);
    if (impact > SAFE_IMPACT) {
      damageHuman(h, Math.round((impact - SAFE_IMPACT) * FALL_DAMAGE_PER_SPEED), `a ${Math.round(fell)}-block fall`);
      h.stun = 0.7;
      Sound.thud();
      dustPuff(h.pos.clone(), 5);
    }
  }
  if (h.onGround || wet) h.fallFrom = h.pos.y;
  else h.fallFrom = Math.max(h.fallFrom, h.pos.y);

  // Hop up one-block steps, otherwise count as stuck
  if (want && blocked && h.onGround) {
    if (!humanCollides(h.pos.x + want.x * 0.3, h.pos.y + 1.05, h.pos.z + want.z * 0.3)) h.vel.y = 7.4;
    else h.stuck += dt;
  }
  h.walking = !!want && h.onGround;
}

function animateHuman(h, dt) {
  const g = h.mesh, p = g.userData;
  g.position.copy(h.pos);
  if (h.dead) {
    g.rotation.x = Math.max(-Math.PI / 2, -h.deathT * 5);
    if (h.deathT > 2) g.scale.setScalar(Math.max(0.001, 1 - (h.deathT - 2) * 2));
    return;
  }
  let dr = h.facing - g.rotation.y;
  dr = Math.atan2(Math.sin(dr), Math.cos(dr));
  g.rotation.y += dr * Math.min(1, dt * 12);
  if (h.walking) h.phase += dt * 11;
  const swing = h.walking ? Math.sin(h.phase) * 0.7 : 0;
  p.legL.rotation.x = swing;
  p.legR.rotation.x = -swing;
  if (!h.onGround && !inWater(h)) {
    const flail = Math.sin(performance.now() / 50) * 0.4;
    p.armL.rotation.set(0, 0, -2.4 + flail);
    p.armR.rotation.set(0, 0, 2.4 - flail);
  } else if (h.task === 'build' && !h.walking) {
    p.armL.rotation.set(0, 0, 0);
    p.armR.rotation.set(-1.4 + Math.sin(performance.now() / 90) * 0.5, 0, 0);
  } else {
    p.armL.rotation.set(-swing, 0, 0);
    p.armR.rotation.set(swing, 0, 0);
  }
  h.flash = Math.max(0, h.flash - dt);
  p.shirt.emissive.setRGB(h.flash > 0 ? 0.7 : 0, 0, 0);
}

// ============================================================================
// EFFECTS & SOUND
// ============================================================================

const effects = [];
const sphereGeo = new THREE.SphereGeometry(1, 24, 16);
const debrisGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const softTexture = (() => {
  const c = makeCanvas(64);
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return canvasTexture(c);
})();
let shake = 0;

function addEffect(obj, life, update, ownsMaterial = true) {
  scene.add(obj);
  effects.push({ obj, life, t: 0, update, ownsMaterial });
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    if (e.t >= e.life) {
      scene.remove(e.obj);
      if (e.ownsMaterial) e.obj.material?.dispose();
      effects.splice(i, 1);
      continue;
    }
    e.update(e.obj, e.t / e.life, dt);
  }
}

const randomDir = () => new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();

function smoke(p, count, color, spread, speed, size, life) {
  for (let i = 0; i < count; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture, color, transparent: true, depthWrite: false, opacity: 0 }));
    const dir = randomDir();
    dir.y = Math.abs(dir.y);
    s.position.copy(p).addScaledVector(dir, spread * rand());
    const vel = dir.multiplyScalar(speed * (0.5 + rand()));
    const sz = size * (0.7 + rand() * 0.6), lf = life * (0.7 + rand() * 0.6);
    addEffect(s, lf, (o, k, dt) => {
      o.position.addScaledVector(vel, dt);
      vel.multiplyScalar(1 - 1.8 * dt);
      o.position.y += dt * 0.6;
      o.scale.setScalar(sz * (1 + k * 2.2));
      o.material.opacity = 0.55 * Math.min(1, k * 6) * (1 - k);
    });
  }
}

function dustPuff(p, count = 5) { smoke(p, count, 0xd8cbb5, 0.3, 1.2, 0.5, 0.8); }

function debris(x, y, z, id) {
  const mat = BLOCK_BY_ID[id].solidMaterial;
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(debrisGeo, mat);
    m.castShadow = true;
    m.position.set(x + 0.2 + rand() * 0.6, y + 0.2 + rand() * 0.6, z + 0.2 + rand() * 0.6);
    const vel = randomDir().multiplyScalar(2 + rand() * 3);
    vel.y = Math.abs(vel.y) + 2;
    const spin = randomDir().multiplyScalar(10);
    addEffect(m, 0.9, (o, k, dt) => {
      vel.y -= GRAVITY * dt;
      o.position.addScaledVector(vel, dt);
      o.rotation.x += spin.x * dt; o.rotation.y += spin.y * dt;
      o.scale.setScalar(1 - k);
    }, false);
  }
  dustPuff(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), 4);
}

function explosionFx(p, R) {
  const fire = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  fire.position.copy(p);
  addEffect(fire, 0.55, (o, k) => {
    o.scale.setScalar(0.3 + R * 0.75 * (1 - (1 - k) ** 3));
    o.material.opacity = (1 - k) ** 1.5;
    o.material.color.setHSL(0.09 - 0.07 * k, 1, 0.62 - 0.3 * k);
  });
  const core = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  core.position.copy(p);
  addEffect(core, 0.25, (o, k) => { o.scale.setScalar(0.2 + R * 0.4 * k); o.material.opacity = 1 - k; });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(p).setY(p.y + 0.05);
  addEffect(ring, 0.6, (o, k) => { o.scale.setScalar(0.5 + R * 1.8 * k); o.material.opacity = 0.85 * (1 - k); });
  smoke(p, 18, 0x5d5a57, R * 0.35, 3, 1.2, 2.6);
  for (let i = 0; i < 30; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture, color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(p);
    s.scale.setScalar(0.25);
    const vel = randomDir().multiplyScalar(6 + rand() * 9);
    vel.y = Math.abs(vel.y) + 3;
    addEffect(s, 0.6 + rand() * 0.6, (o, k, dt) => {
      vel.y -= GRAVITY * 0.5 * dt;
      o.position.addScaledVector(vel, dt);
      o.material.opacity = 1 - k;
    });
  }
  blastLight.position.copy(p).setY(p.y + 1);
  blastLight.distance = R * 7;
  blastLight.userData.t = 0;
  shake = Math.min(1.2, shake + 0.4 + R * 0.08);
}

function popup(worldPos, text) {
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = text;
  labels.appendChild(el);
  popups.push({ el, pos: worldPos, t: 0 });
}
const popups = [];

const Sound = {
  ctx: null,
  ready() {
    if (!settings.sound) return false;
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  },
  out(vol, dur) {
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.ctx.destination);
    return g;
  },
  tone(type, f0, f1, dur, vol) {
    if (!this.ready()) return;
    const o = this.ctx.createOscillator(), t = this.ctx.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(this.out(vol, dur));
    o.start(t); o.stop(t + dur);
  },
  noise(dur, vol, type, f0, f1) {
    if (!this.ready()) return;
    const c = this.ctx, t = c.currentTime;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(f); f.connect(this.out(vol, dur));
    src.start(t);
  },
  place(vol = 1) { this.tone('sine', 190, 70, 0.09, 0.35 * vol); this.noise(0.05, 0.12 * vol, 'lowpass', 2500, 400); },
  remove() { this.noise(0.2, 0.35, 'bandpass', 1800, 400); },
  boom() { this.noise(1.6, 0.9, 'lowpass', 1000, 50); this.tone('sine', 75, 26, 0.9, 0.8); },
  hurt() { this.tone('square', 540, 260, 0.12, 0.06); },
  die() { this.tone('sawtooth', 340, 70, 0.45, 0.1); },
  pop() { this.tone('sine', 520, 950, 0.08, 0.2); },
  thud() { this.tone('sine', 120, 45, 0.15, 0.35); },
  whoosh() { this.noise(1.3, 0.5, 'highpass', 150, 7000); this.tone('sine', 300, 30, 1.2, 0.3); },
};

// ============================================================================
// TOOLS & INTERACTION
// ============================================================================

const settings = { gravity: true, anchorNew: true, autoBuild: true, sound: true, blastRadius: 4 };
const state = { playing: true, tool: null };
const mapState = { name: '', theme: 'grasslands', saveNo: null, savedAt: null, dirty: false };

const SLOTS = [
  ...BLOCKS.map(b => ({ type: 'block', id: b.id, name: b.name, hint: `${b.name} — click any surface to place it` })),
  'sep',
  { type: 'human', name: 'Human', emoji: '🧍', hint: 'Spawn Human — click a surface to drop one in' },
  'sep',
  { type: 'anchor', name: 'Anchor', emoji: '⚓', hint: 'Anchor / Unanchor — loose blocks glow orange and fall with gravity' },
  { type: 'delete', name: 'Delete', emoji: '🗑️', hint: 'Delete — click a block or a human to remove it' },
  { type: 'blast', name: 'Blow Up', emoji: '💥', hint: 'Blow Up — launches humans, never damages blocks' },
  { type: 'eradicate', name: 'Eradicate', emoji: '☢️', hint: 'Eradicate — wipe everything off the map', action: true },
];
state.tool = SLOTS[0];

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _box = new THREE.Box3();
const _hitPoint = new THREE.Vector3();

// Grid traversal (Amanatides & Woo); also hits the floor at y = 0
function raycastVoxels(origin, dir, maxDist = 400) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const tdx = sx ? Math.abs(1 / dir.x) : Infinity, tdy = sy ? Math.abs(1 / dir.y) : Infinity, tdz = sz ? Math.abs(1 / dir.z) : Infinity;
  let tx = sx > 0 ? (x + 1 - origin.x) * tdx : sx < 0 ? (origin.x - x) * tdx : Infinity;
  let ty = sy > 0 ? (y + 1 - origin.y) * tdy : sy < 0 ? (origin.y - y) * tdy : Infinity;
  let tz = sz > 0 ? (z + 1 - origin.z) * tdz : sz < 0 ? (origin.z - z) * tdz : Infinity;
  let normal = [0, 0, 0], t = 0;
  while (t <= maxDist) {
    const inXZ = x >= 0 && x < W && z >= 0 && z < D;
    if (inXZ && y < 0) return { cell: [x, y, z], normal, t, floor: true };
    if (inXZ && y < H && world[idx(x, y, z)]) return { cell: [x, y, z], normal, t, floor: false };
    if (y < 0 && sy <= 0) return null;
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; normal = [-sx, 0, 0]; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; normal = [0, -sy, 0]; }
    else { z += sz; t = tz; tz += tdz; normal = [0, 0, -sz]; }
  }
  return null;
}

function pickAt(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const { origin, direction } = raycaster.ray;
  const vox = raycastVoxels(origin, direction);
  let human = null, humanDist = Infinity;
  for (const h of humans) {
    if (h.dead) continue;
    _box.min.set(h.pos.x - 0.22, h.pos.y, h.pos.z - 0.22);
    _box.max.set(h.pos.x + 0.22, h.pos.y + HUMAN_HEIGHT + 0.05, h.pos.z + 0.22);
    if (raycaster.ray.intersectBox(_box, _hitPoint)) {
      const d = _hitPoint.distanceTo(origin);
      if (d < humanDist) { humanDist = d; human = h; }
    }
  }
  if (human && vox && vox.t < humanDist) human = null;
  const point = vox ? origin.clone().addScaledVector(direction, vox.t) : null;
  return { vox, human, point };
}

function placeCell(vox) {
  if (!vox) return null;
  const c = [vox.cell[0] + vox.normal[0], vox.cell[1] + vox.normal[1], vox.cell[2] + vox.normal[2]];
  return inBounds(...c) && !world[idx(...c)] ? c : null;
}

function useTool(p) {
  const tool = state.tool;
  if (tool.type === 'block') {
    const c = placeCell(p.vox);
    if (!c) return;
    if (humanInCell(...c)) { log('🚫 Someone is standing there'); return; }
    setCell(...c, tool.id | (settings.anchorNew ? ANCHOR : 0));
    Sound.place();
    dustPuff(new THREE.Vector3(c[0] + 0.5, c[1], c[2] + 0.5), 3);
    markDirty();
  } else if (tool.type === 'human') {
    const c = placeCell(p.vox);
    if (!c) return;
    const h = spawnHuman(c[0] + 0.5, c[1], c[2] + 0.5);
    if (h) { Sound.pop(); log(`👤 ${h.name} joined the world`); markDirty(); }
  } else if (tool.type === 'delete') {
    if (p.human) {
      log(`🗑️ Removed ${p.human.name}`);
      smoke(p.human.pos.clone().setY(p.human.pos.y + 0.4), 6, 0xffffff, 0.2, 1, 0.5, 0.7);
      removeHuman(p.human);
      Sound.remove();
      markDirty();
    } else if (p.vox && !p.vox.floor) {
      const [x, y, z] = p.vox.cell;
      const id = world[idx(x, y, z)] & MAT_MASK;
      setCell(x, y, z, 0);
      debris(x, y, z, id);
      Sound.remove();
      markDirty();
    }
  } else if (tool.type === 'anchor') {
    if (!p.vox || p.vox.floor) return;
    const [x, y, z] = p.vox.cell;
    const v = world[idx(x, y, z)];
    setCell(x, y, z, v ^ ANCHOR);
    log(v & ANCHOR ? `🔓 ${BLOCK_BY_ID[v & MAT_MASK].name} at (${x}, ${y}, ${z}) is loose` : `⚓ ${BLOCK_BY_ID[v & MAT_MASK].name} at (${x}, ${y}, ${z}) anchored`);
    Sound.pop();
    markDirty();
  } else if (tool.type === 'blast') {
    const point = p.human ? p.human.pos.clone().setY(p.human.pos.y + 0.3) : p.point;
    if (point) explode(point, settings.blastRadius);
  }
}

// Shockwave that throws humans around. Blocks are never touched.
function explode(point, R) {
  let launched = 0;
  for (const h of humans) {
    if (h.dead) continue;
    const c = h.pos.clone().setY(h.pos.y + 0.4);
    const d = c.distanceTo(point);
    if (d > R) continue;
    const s = 1 - d / R;
    const dir = d > 0.05 ? c.sub(point).normalize() : randomDir();
    dir.y = Math.max(dir.y, 0) + 0.7;
    dir.normalize();
    h.vel.addScaledVector(dir, 6 + 15 * s);
    h.onGround = false;
    h.stun = 1.2;
    if (h.task === 'walk') h.task = 'idle';
    damageHuman(h, Math.round(18 * s), 'the blast');
    launched++;
  }
  explosionFx(point, R);
  Sound.boom();
  log(`💥 Boom! ${launched} human${launched === 1 ? '' : 's'} launched (blocks untouched)`);
}

function eradicate() {
  world.fill(0);
  setWater(false);
  loose.clear();
  meshesDirty = true;
  [...humans].forEach(removeHuman);
  falling.forEach(f => scene.remove(f.mesh));
  falling.length = 0;
  const flash = document.getElementById('flash');
  flash.style.transition = 'none';
  flash.style.opacity = '1';
  requestAnimationFrame(() => { flash.style.transition = ''; flash.style.opacity = '0'; });
  shake = 1;
  Sound.whoosh();
  log('☢️ Everything was eradicated');
  markDirty();
}

// Pointer: a click (not a drag) uses the tool
let pointerDown = null, hoverPos = null;
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button === 0) pointerDown = { x: e.clientX, y: e.clientY };
  closeMenu();
});
renderer.domElement.addEventListener('pointerup', e => {
  if (e.button === 0 && pointerDown && Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) < 6) {
    Sound.ready();
    useTool(pickAt(e.clientX, e.clientY));
  }
  pointerDown = null;
});
renderer.domElement.addEventListener('pointermove', e => { hoverPos = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerleave', () => { hoverPos = null; });
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

const hoverBox = new THREE.Mesh(
  new THREE.BoxGeometry(1.02, 1.02, 1.02),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }),
);
const hoverEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.03, 1.03, 1.03)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
);
hoverBox.add(hoverEdges);
hoverBox.renderOrder = 5;
const blastPreview = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.13, depthWrite: false }));
scene.add(hoverBox, blastPreview);
let hoveredHuman = null;

function showHoverBox(x, y, z, color) {
  hoverBox.position.set(x + 0.5, y + 0.5, z + 0.5);
  hoverBox.material.color.set(color);
  hoverEdges.material.color.set(color);
  hoverBox.visible = true;
}

function updateHover() {
  hoverBox.visible = false;
  blastPreview.visible = false;
  hoveredHuman = null;
  if (!hoverPos || pointerDown) return;
  const p = pickAt(hoverPos.x, hoverPos.y);
  hoveredHuman = p.human;
  const type = state.tool.type;
  if (type === 'block' || type === 'human') {
    const c = placeCell(p.vox);
    if (c) showHoverBox(...c, type === 'human' ? 0x7cc7ff : 0xffffff);
  } else if (type === 'delete' || type === 'anchor') {
    if (type === 'delete' && p.human) return;
    if (p.vox && !p.vox.floor) {
      const loose = !(world[idx(...p.vox.cell)] & ANCHOR);
      showHoverBox(...p.vox.cell, type === 'delete' ? 0xff4d4d : loose ? 0xff9a3c : 0xffd84a);
    }
  } else if (type === 'blast') {
    const pt = p.human ? p.human.pos : p.point;
    if (pt) {
      blastPreview.position.copy(pt);
      blastPreview.scale.setScalar(settings.blastRadius);
      blastPreview.visible = true;
    }
  }
}

// ============================================================================
// HUD
// ============================================================================

const $ = id => document.getElementById(id);
const hotbar = $('hotbar');
const slotEls = [];

function drawBlockIcon(cnv, b) {
  const s = 80;
  cnv.width = cnv.height = s;
  const ctx = cnv.getContext('2d');
  const e = 36;
  const X = [e * Math.cos(Math.PI / 6), e * 0.5], Z = [-e * Math.cos(Math.PI / 6), e * 0.5];
  const T = [s / 2, 4];
  const top = texCanvas[b.icon.top], side = texCanvas[b.icon.side];
  const face = (img, a, bb, c, d, ex, fy, shadeAlpha) => {
    ctx.save();
    ctx.setTransform(a / TEX, bb / TEX, c / TEX, d / TEX, ex, fy);
    ctx.drawImage(img, 0, 0);
    if (shadeAlpha) { ctx.fillStyle = `rgba(0,0,0,${shadeAlpha})`; ctx.fillRect(0, 0, TEX, TEX); }
    ctx.restore();
  };
  face(top, X[0], X[1], Z[0], Z[1], T[0], T[1], 0);
  const L = [T[0] + Z[0], T[1] + Z[1]], F = [T[0] + X[0] + Z[0], T[1] + X[1] + Z[1]];
  face(side, X[0], X[1], 0, e, L[0], L[1], 0.28);
  face(side, -Z[0], -Z[1], 0, e, F[0], F[1], 0.12);
}

function buildHotbar() {
  let key = 1;
  for (const slot of SLOTS) {
    if (slot === 'sep') { hotbar.insertAdjacentHTML('beforeend', '<div class="sep"></div>'); continue; }
    const el = document.createElement('button');
    el.className = 'slot';
    el.title = slot.hint;
    if (slot.type === 'block') {
      const c = document.createElement('canvas');
      drawBlockIcon(c, BLOCK_BY_ID[slot.id]);
      el.appendChild(c);
      if (key <= 10) { el.insertAdjacentHTML('beforeend', `<span class="key">${key % 10}</span>`); slot.key = String(key % 10); key++; }
    } else {
      el.insertAdjacentHTML('beforeend', `<span class="emoji">${slot.emoji}</span>`);
    }
    el.insertAdjacentHTML('beforeend', `<span class="name">${slot.name}</span>`);
    el.addEventListener('click', () => { Sound.ready(); selectSlot(slot, el); });
    hotbar.appendChild(el);
    slot.el = el;
    slotEls.push(el);
  }
  selectSlot(SLOTS[0], SLOTS[0].el);
}

let eradicateTimer = null;
function selectSlot(slot, el) {
  if (slot.type === 'eradicate') {
    if (el.classList.contains('armed')) {
      clearTimeout(eradicateTimer);
      el.classList.remove('armed');
      eradicate();
      $('slotLabel').textContent = state.tool.hint;
    } else {
      el.classList.add('armed');
      $('slotLabel').textContent = '☢️ Click Eradicate again to wipe out everything';
      eradicateTimer = setTimeout(() => { el.classList.remove('armed'); $('slotLabel').textContent = state.tool.hint; }, 3000);
    }
    return;
  }
  const wasAnchor = state.tool.type === 'anchor';
  state.tool = slot;
  slotEls.forEach(s => s.classList.toggle('selected', s === el));
  $('slotLabel').textContent = slot.hint;
  if (wasAnchor !== (slot.type === 'anchor')) meshesDirty = true;
}

const feed = $('feed');
function log(text) {
  const el = document.createElement('div');
  el.className = 'feed-item';
  el.textContent = text;
  feed.appendChild(el);
  while (feed.children.length > 6) feed.firstChild.remove();
  setTimeout(() => { el.style.opacity = '0'; }, 6000);
  setTimeout(() => el.remove(), 7000);
}

function updateStats(fps) {
  const alive = humans.filter(h => !h.dead).length;
  const items = [
    ['Blocks', stats.blocks], ['Humans', alive], ['Deaths', stats.deaths],
    ['Loose', stats.loose], ['Falling', falling.length], ['FPS', fps],
  ];
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
}

function setPlaying(on) {
  state.playing = on;
  $('playBtn').textContent = on ? '⏸' : '▶';
  $('playBtn').classList.toggle('paused', !on);
  $('pausedBadge').classList.toggle('hidden', on);
}

function markDirty() {
  if (!mapState.dirty) { mapState.dirty = true; updateMapCard(); }
}

function updateMapCard() {
  $('mapNameText').textContent = `${THEMES[mapState.theme].icon} ${mapState.name}`;
  const saveText = mapState.saveNo ? `Save #${mapState.saveNo}` : 'Not saved yet';
  const when = mapState.savedAt ? ` · ${formatTime(mapState.savedAt)}` : '';
  $('mapSave').innerHTML = `${saveText}${when}${mapState.dirty ? ' <span class="dirty">● unsaved changes</span>' : ''}`;
  $('saveBtn').textContent = `💾 Save as save #${nextSaveNo()}`;
  if (document.activeElement !== $('mapNameInput')) $('mapNameInput').value = mapState.name;
}

function nextSaveNo() {
  const nums = saves.filter(s => s.map === mapState.name).map(s => s.save_no);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderSaveList() {
  const list = $('saveList');
  if (!list) return;
  if (!saves.length) { list.innerHTML = '<div class="empty">No saves yet</div>'; updateMapCard(); return; }
  list.innerHTML = '';
  for (const s of saves) {
    const row = document.createElement('div');
    row.className = 'saveRow';
    const icon = THEMES[s.theme]?.icon || '🗺️';
    row.innerHTML = `<span>${icon} <b></b> · Save #${s.save_no}</span><span class="when">${formatTime(s.timestamp)}</span>`;
    row.querySelector('b').textContent = s.map;
    row.addEventListener('click', () => loadSave(s));
    list.appendChild(row);
  }
  updateMapCard();
}

function openMenu() { $('menu').classList.remove('hidden'); }
function closeMenu() { $('menu').classList.add('hidden'); }

function bindHud() {
  $('playBtn').addEventListener('click', () => setPlaying(!state.playing));
  $('mapCard').addEventListener('click', () => $('menu').classList.toggle('hidden'));
  $('mapNameInput').addEventListener('input', e => {
    mapState.name = e.target.value.trim() || 'Untitled';
    mapState.saveNo = null;
    mapState.savedAt = null;
    mapState.dirty = true;
    updateMapCard();
  });
  $('saveBtn').addEventListener('click', saveGame);
  $('aiBtn').addEventListener('click', askClaude);
  for (const [key, t] of Object.entries(THEMES)) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = `${t.icon} ${t.label}`;
    b.addEventListener('click', () => { newMap(key); closeMenu(); });
    $('themeButtons').appendChild(b);
  }
  const bindToggle = (id, key, after) => {
    $(id).checked = settings[key];
    $(id).addEventListener('change', e => { settings[key] = e.target.checked; after?.(); });
  };
  bindToggle('setGravity', 'gravity', () => log(settings.gravity ? '🌍 Gravity on: loose blocks fall' : '🌍 Gravity off'));
  bindToggle('setAnchorNew', 'anchorNew');
  bindToggle('setAutoBuild', 'autoBuild');
  bindToggle('setSound', 'sound');
  $('setBlast').value = settings.blastRadius;
  $('blastVal').textContent = settings.blastRadius;
  $('setBlast').addEventListener('input', e => { settings.blastRadius = Number(e.target.value); $('blastVal').textContent = e.target.value; });

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); return; }
    if (e.key === 'Escape') { closeMenu(); return; }
    const slot = SLOTS.find(s => s !== 'sep' && s.key === e.key);
    if (slot) selectSlot(slot, slot.el);
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ============================================================================
// MAPS, SAVE / LOAD, CLAUDE
// ============================================================================

function clearEntities() {
  [...humans].forEach(removeHuman);
  falling.forEach(f => scene.remove(f.mesh));
  falling.length = 0;
}

function randomLandSpot() {
  for (let tries = 0; tries < 80; tries++) {
    const x = Math.floor(W * 0.25 + rand() * W * 0.5), z = Math.floor(D * 0.25 + rand() * D * 0.5);
    const top = groundTop(x, z);
    if (isDry(top) && (getCell(x, top - 1, z) & MAT_MASK) !== BLOCK_ID.leaves) return [x + 0.5, top, z + 0.5];
  }
  return [W / 2, groundTop(W / 2, D / 2), D / 2];
}

function newMap(themeKey) {
  clearEntities();
  mapState.theme = themeKey;
  mapState.name = `${THEMES[themeKey].label} ${100 + Math.floor(rand() * 900)}`;
  mapState.saveNo = null;
  mapState.savedAt = null;
  mapState.dirty = false;
  stats.deaths = 0;
  applyTheme(themeKey);
  setWater(true);
  generateTerrain(themeKey);
  for (let i = 0; i < 4; i++) spawnHuman(...randomLandSpot());
  updateMapCard();
  log(`🗺️ New map: ${mapState.name}`);
}

function encodeWorld() {
  let s = '';
  for (let i = 0; i < world.length; i += 0x8000) s += String.fromCharCode.apply(null, world.subarray(i, i + 0x8000));
  return btoa(s);
}

function serialize() {
  return {
    version: 2,
    theme: mapState.theme,
    size: [W, H, D],
    voxels: encodeWorld(),
    humans: humans.filter(h => !h.dead).map(h => ({
      name: h.name, look: h.look, health: h.health,
      x: +h.pos.x.toFixed(3), y: +h.pos.y.toFixed(3), z: +h.pos.z.toFixed(3),
    })),
    deaths: stats.deaths,
    water: waterOn,
  };
}

function applyWorld(data) {
  clearEntities();
  const bin = atob(data.voxels);
  world.fill(0);
  for (let i = 0; i < Math.min(bin.length, world.length); i++) world[i] = bin.charCodeAt(i);
  rebuildLooseSet();
  meshesDirty = true;
  mapState.theme = THEMES[data.theme] ? data.theme : 'grasslands';
  applyTheme(mapState.theme);
  setWater(data.water !== false);
  stats.deaths = data.deaths || 0;
  for (const h of data.humans || []) spawnHuman(h.x, h.y, h.z, { name: h.name, look: h.look, health: h.health });
}

function saveGame() {
  const btn = $('saveBtn');
  btn.disabled = true;
  btn.textContent = '💾 Saving…';
  request('save', { map_name: mapState.name, world: serialize() }, res => {
    btn.disabled = false;
    if (res.error) { log(`⚠️ Save failed: ${res.error}`); updateMapCard(); return; }
    mapState.saveNo = res.save_no;
    mapState.savedAt = res.timestamp;
    mapState.dirty = false;
    updateMapCard();
    log(`💾 Saved ${mapState.name} as save #${res.save_no}`);
  });
}

function loadSave(s) {
  log(`📂 Loading ${s.map} save #${s.save_no}…`);
  closeMenu();
  request('load', { file: s.file }, res => {
    if (res.error) { log(`⚠️ Load failed: ${res.error}`); return; }
    applyWorld(res.world);
    mapState.name = res.map;
    mapState.saveNo = res.save_no;
    mapState.savedAt = res.timestamp;
    mapState.dirty = false;
    updateMapCard();
    log(`📂 Loaded ${res.map} save #${res.save_no}`);
  });
}

function askClaude() {
  const alive = humans.filter(h => !h.dead);
  if (!alive.length) { log('🤖 Spawn some humans first'); return; }
  const btn = $('aiBtn');
  btn.disabled = true;
  btn.textContent = '🤖 Claude is thinking…';
  const counts = Object.fromEntries(Object.entries(stats.counts).map(([id, n]) => [BLOCK_BY_ID[id].name.toLowerCase(), n]));
  const summary = { map: THEMES[mapState.theme].label, humans: alive.length, deaths: stats.deaths, structures_built: stats.built, block_counts: counts };
  request('ai', { summary, materials: BUILD_MATERIALS, structures: Object.keys(STRUCTURES) }, res => {
    btn.disabled = false;
    btn.textContent = '🤖 Ask Claude what to build';
    if (res.error) { log(`🤖 Claude couldn't answer: ${res.error}`); return; }
    const { material, structure, reason } = res.plan;
    const builders = alive.sort(() => rand() - 0.5).slice(0, 4).filter(h => startPlan(h, structure, material));
    log(`🤖 Claude: build a ${material} ${structure}${reason ? ` — ${reason}` : ''}`);
    if (!builders.length) log('🤖 Nobody found room to build that');
    if (!state.playing) log('▶ Press play so they can start building');
  });
}

// ============================================================================
// MAIN LOOP
// ============================================================================

const _screen = new THREE.Vector3();
function toScreen(v) {
  _screen.copy(v).project(camera);
  if (_screen.z > 1) return null;
  return [(_screen.x * 0.5 + 0.5) * window.innerWidth, (-_screen.y * 0.5 + 0.5) * window.innerHeight];
}

function updateLabels(dt) {
  for (const h of humans) {
    const show = !h.dead && (h.health < 100 || h === hoveredHuman);
    const s = show && toScreen(_screen.set(h.pos.x, h.pos.y + 1.05, h.pos.z));
    if (!s) { h.el.style.display = 'none'; continue; }
    h.el.style.display = '';
    h.el.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%, -100%)`;
    const fill = h.el.querySelector('.fill');
    fill.style.width = `${h.health}%`;
    fill.style.background = h.health > 60 ? '#5ee05e' : h.health > 30 ? '#f2c94c' : '#ff5a5a';
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.t += dt;
    const s = toScreen(p.pos);
    if (p.t > 1 || !s) { p.el.remove(); popups.splice(i, 1); continue; }
    p.el.style.transform = `translate(${s[0]}px, ${s[1] - p.t * 40}px) translate(-50%, -100%)`;
    p.el.style.opacity = String(1 - p.t);
  }
}

function step(dt) {
  updateBlockGravity(dt);
  for (const h of humans) updateHuman(h, dt);
  for (const h of [...humans]) if (h.dead && h.deathT > 2.6) removeHuman(h);
}

let last = performance.now(), acc = 0, fpsFrames = 0, fpsTime = 0, fps = 60;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.playing) {
    acc += dt;
    while (acc >= STEP) { step(STEP); acc -= STEP; }
  } else acc = 0;
  for (const h of humans) animateHuman(h, dt);
  updateEffects(dt);
  if (blastLight.userData.t !== undefined) {
    blastLight.userData.t += dt;
    blastLight.intensity = 900 * Math.max(0, 1 - blastLight.userData.t / 0.6) ** 2;
  }
  waterNormal.offset.x += dt * 0.004;
  waterNormal.offset.y += dt * 0.002;
  if (meshesDirty) rebuildBlocks();
  controls.update();
  updateHover();
  updateLabels(dt);

  const shakeOffset = new THREE.Vector3();
  if (shake > 0) {
    shakeOffset.set((rand() - 0.5) * shake, (rand() - 0.5) * shake, (rand() - 0.5) * shake).multiplyScalar(0.6);
    camera.position.add(shakeOffset);
    shake = Math.max(0, shake - dt * 2.5);
  }
  renderer.render(scene, camera);
  camera.position.sub(shakeOffset);

  fpsFrames++; fpsTime += dt;
  if (fpsTime > 0.5) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; updateStats(fps); }
}

buildHotbar();
bindHud();
newMap('grasslands');
mapState.dirty = false;
updateMapCard();
setPlaying(true);
updateStats(60);
requestAnimationFrame(frame);
postToStreamlit('streamlit:componentReady', { apiVersion: 1 });
postToStreamlit('streamlit:setFrameHeight', { height: window.innerHeight });
