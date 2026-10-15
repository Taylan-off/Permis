import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import grassUrl from './assets/grass.jpg';
import grassNormalUrl from './assets/grass-nm.jpg';
import waterNormalsUrl from './assets/waternormals.jpg';

/*
 * Décor de montagne, entièrement procédural et léger :
 *  - ciel atmosphérique (addon Sky) ;
 *  - un maillage de relief (bruit simplex) : prairie plate autour de la
 *    voiture, collines, montagnes rocheuses et enneigées, un lac ;
 *  - disque d'herbe texturé + touffes d'herbe instanciées autour de la voiture ;
 *  - sapins, feuillus et rochers instanciés ; étoiles la nuit ;
 *  - trois ambiances (journée, fin de journée, nuit) ;
 *  - capture cubique du décor → carte d'environnement : la carrosserie
 *    reflète réellement les montagnes, les arbres et le ciel.
 */

const TERRAIN_SIZE = 1000;
const TERRAIN_SEGMENTS = 260;
const MEADOW_RADIUS = 70;
const TREE_COUNT = 1100;
const GRASS_COUNT = 16000;
const ROCK_COUNT = 220;
const LAKE = { x: -95, z: 118, rx: 62, rz: 44, depth: -4.5, level: -1.0 };

// Générateur pseudo-aléatoire déterministe : le décor est identique à chaque visite.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20241015);
const simplex = new SimplexNoise({ random });

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function fbm(x, z, octaves, frequency, lacunarity = 2.1, gain = 0.5) {
  let amp = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * simplex.noise(x * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm; // ≈ [-1, 1]
}

function lakeDistance(x, z) {
  return Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
}

/** Altitude du terrain (m) en (x, z). Plat sous la voiture, montagnes au loin, lac creusé. */
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const hills = (fbm(x, z, 5, 1 / 170) + 0.25) * 40;
  const ridgeNoise = fbm(x + 500, z - 300, 4, 1 / 380);
  const ridge = Math.pow(Math.max(0, 1 - Math.abs(ridgeNoise)), 2.0) * 340;
  const hillMask = smoothstep(40, 200, r);
  const mountainMask = smoothstep(130, 380, r);
  const wall = smoothstep(220, 470, r) * 120;
  let h = hills * hillMask + ridge * mountainMask * (1 - 0.3 * smoothstep(0.9, 1.4, lakeDistance(x, z)) * 0) + wall;
  const meadow = 1 - smoothstep(14, MEADOW_RADIUS, r);
  h = lerp(h, -0.3, meadow);
  const d = lakeDistance(x, z);
  if (d < 1.4) {
    const basin = lerp(LAKE.depth + fbm(x, z, 2, 1 / 20) * 0.6, h, smoothstep(0.6, 1.4, d));
    h = Math.min(h, basin);
  }
  return h;
}

const GRASS_A = new THREE.Color('#4a7a30');
const GRASS_B = new THREE.Color('#8aab4e');
const GRASS_DRY = new THREE.Color('#9c9a52');
const ROCK_A = new THREE.Color('#847d73');
const ROCK_B = new THREE.Color('#524d47');
const SNOW = new THREE.Color('#f3f6f9');
const SAND = new THREE.Color('#9a8c6a');

function colorAt(x, z, h, slope, out) {
  const n = fbm(x * 2.5, z * 2.5, 2, 1 / 35) * 0.5 + 0.5;
  const n2 = fbm(x - 300, z + 800, 2, 1 / 90) * 0.5 + 0.5;
  out.copy(GRASS_A).lerp(GRASS_B, n).lerp(GRASS_DRY, smoothstep(0.55, 0.9, n2) * 0.5);
  const rock = Math.max(smoothstep(0.28, 0.5, slope), smoothstep(85, 140, h + n * 40));
  const rockColor = ROCK_A.clone().lerp(ROCK_B, n);
  out.lerp(rockColor, rock);
  const snow = smoothstep(175, 230, h + n * 35) * (1 - smoothstep(0.6, 0.85, slope));
  out.lerp(SNOW, snow);
  // Rive du lac.
  const shore = 1 - smoothstep(LAKE.level + 0.1, LAKE.level + 1.8, h);
  if (lakeDistance(x, z) < 1.5) out.lerp(SAND, shore * 0.8);
  return out;
}

function buildTerrain() {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  const normal = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const slope = 1 - normal.getY(i);
    colorAt(pos.getX(i), pos.getZ(i), pos.getY(i), slope, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

function radialAlphaTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.72, '#fff');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function buildMeadow() {
  const loader = new THREE.TextureLoader();
  const map = loader.load(grassUrl);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(40, 40);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const normalMap = loader.load(grassNormalUrl);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(40, 40);
  normalMap.anisotropy = 8;

  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    color: '#8aa058',
    roughness: 1,
    metalness: 0,
    transparent: true,
    alphaMap: radialAlphaTexture(),
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(MEADOW_RADIUS, 96), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = 'meadow';
  return mesh;
}

/** Texture de brins d'herbe dessinée au canvas (fond transparent). */
function grassBladeTexture() {
  const w = 128;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const rnd = mulberry32(7);
  for (let i = 0; i < 9; i++) {
    const x0 = 12 + rnd() * (w - 24);
    const lean = (rnd() - 0.5) * 40;
    const top = 6 + rnd() * 30;
    const width = 3 + rnd() * 3;
    const g = ctx.createLinearGradient(0, h, 0, top);
    g.addColorStop(0, '#5f8a38');
    g.addColorStop(1, '#a9c86a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - width, h);
    ctx.quadraticCurveTo(x0 + lean * 0.3, h * 0.55, x0 + lean, top);
    ctx.quadraticCurveTo(x0 + lean * 0.3 + width * 0.6, h * 0.55, x0 + width, h);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildGrassTufts() {
  const plane = new THREE.PlaneGeometry(0.55, 0.38);
  plane.translate(0, 0.19, 0);
  const cross = plane.clone().rotateY(Math.PI / 2);
  const geo = BufferGeometryUtils.mergeGeometries([plane, cross], false);
  const mat = new THREE.MeshStandardMaterial({
    map: grassBladeTexture(),
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, GRASS_COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  let placed = 0;
  let tries = 0;
  while (placed < GRASS_COUNT && tries < GRASS_COUNT * 10) {
    tries++;
    const r = 3.2 + Math.pow(random(), 0.6) * 42;
    const a = random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // Pas sous la voiture ni dans sa trace d'ouverture des portes.
    if (Math.abs(x) < 2.6 && Math.abs(z) < 2.2) continue;
    const scale = 0.7 + random() * 0.8;
    p.set(x, Math.max(heightAt(x, z), -0.05) + 0.0, z);
    q.setFromAxisAngle(up, random() * Math.PI);
    s.set(scale, scale * (0.8 + random() * 0.5), scale);
    m.compose(p, q, s);
    mesh.setMatrixAt(placed, m);
    color.setHSL(0.26 + random() * 0.05, 0.45 + random() * 0.2, 0.42 + random() * 0.2);
    mesh.setColorAt(placed, color);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.name = 'grass';
  return mesh;
}

function colorGeometry(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function conifer() {
  const trunk = colorGeometry(new THREE.CylinderGeometry(0.12, 0.2, 1.2, 5).translate(0, 0.6, 0), new THREE.Color('#5a3f28'));
  const parts = [trunk];
  const green = new THREE.Color('#2f5a2a');
  for (const [r, h, y] of [[1.6, 2.6, 1.0], [1.25, 2.2, 2.4], [0.85, 1.9, 3.7]]) {
    parts.push(colorGeometry(new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2, 0), green));
  }
  return BufferGeometryUtils.mergeGeometries(parts, false);
}

function broadleaf() {
  const trunk = colorGeometry(new THREE.CylinderGeometry(0.16, 0.24, 2.2, 6).translate(0, 1.1, 0), new THREE.Color('#6b4a2e'));
  const parts = [trunk];
  const greens = ['#4f8a34', '#5f9a3a', '#3f7a2c'].map((c) => new THREE.Color(c));
  const blobs = [[0, 3.2, 0, 1.9], [0.9, 2.7, 0.5, 1.3], [-0.8, 2.9, -0.4, 1.2], [0.2, 4.1, -0.6, 1.1]];
  blobs.forEach(([x, y, z, r], i) => {
    parts.push(colorGeometry(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), greens[i % 3]));
  });
  // L'icosaèdre n'est pas indexé : on uniformise avant de fusionner.
  return BufferGeometryUtils.mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
}

function scatter(geo, count, pick) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let placed = 0;
  let tries = 0;
  while (placed < count && tries < count * 60) {
    tries++;
    const t = pick();
    if (!t) continue;
    p.set(t.x, t.y, t.z);
    q.setFromEuler(new THREE.Euler(t.tiltX || 0, t.rotY, t.tiltZ || 0));
    s.set(t.sx, t.sy, t.sz);
    m.compose(p, q, s);
    mesh.setMatrixAt(placed, m);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function treeSpot() {
  const r = 38 + Math.pow(random(), 0.55) * 430;
  const a = random() * Math.PI * 2;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  const h = heightAt(x, z);
  if (h > 140 || h < LAKE.level + 0.6) return null;
  const dx = heightAt(x + 2, z) - heightAt(x - 2, z);
  const dz = heightAt(x, z + 2) - heightAt(x, z - 2);
  if (Math.hypot(dx, dz) / 4 > 0.7) return null;
  if (r < 110 && fbm(x - 700, z + 400, 2, 1 / 60) < 0.35) return null; // clairière
  if (fbm(x + 900, z + 900, 2, 1 / 90) < -0.1) return null; // bosquets
  return { x, z, h, r };
}

function buildTrees() {
  const conifers = scatter(conifer(), Math.round(TREE_COUNT * 0.7), () => {
    const t = treeSpot();
    if (!t) return null;
    const scale = 0.6 + random() * 0.9;
    return { x: t.x, y: t.h - 0.1, z: t.z, rotY: random() * Math.PI * 2, sx: scale, sy: scale * (0.9 + random() * 0.3), sz: scale };
  });
  conifers.name = 'conifers';
  const leafy = scatter(broadleaf(), Math.round(TREE_COUNT * 0.3), () => {
    const t = treeSpot();
    if (!t || t.h > 60) return null; // feuillus en fond de vallée
    const scale = 0.7 + random() * 0.9;
    return { x: t.x, y: t.h - 0.1, z: t.z, rotY: random() * Math.PI * 2, sx: scale, sy: scale * (0.9 + random() * 0.25), sz: scale };
  });
  leafy.name = 'broadleaves';
  return [conifers, leafy];
}

function buildRocks() {
  const geo = colorGeometry(new THREE.DodecahedronGeometry(1, 0), new THREE.Color('#7a746b'));
  const rocks = scatter(geo, ROCK_COUNT, () => {
    const r = 26 + Math.pow(random(), 0.8) * 380;
    const a = random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < LAKE.level + 0.3) return null;
    const scale = 0.35 + Math.pow(random(), 2) * 3.2;
    return { x, y: h - scale * 0.35, z, rotY: random() * Math.PI, tiltX: (random() - 0.5) * 0.6, tiltZ: (random() - 0.5) * 0.6, sx: scale * (0.8 + random() * 0.6), sy: scale * (0.6 + random() * 0.5), sz: scale };
  });
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.name = 'rocks';
  return rocks;
}

function buildWater(sunDir) {
  const normals = new THREE.TextureLoader().load(waterNormalsUrl, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
  const water = new Water(new THREE.PlaneGeometry(LAKE.rx * 2.2, LAKE.rz * 2.2), {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: normals,
    sunDirection: sunDir.clone(),
    sunColor: 0xffffff,
    waterColor: 0x1f4f5e,
    distortionScale: 2.2,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, LAKE.level, LAKE.z);
  water.name = 'lake';
  return water;
}

function buildStars() {
  const n = 2200;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const u = random();
    const v = random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(1 - v) * 0.52; // au-dessus de l'horizon
    const R = 2800;
    pos[i * 3] = R * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = R * Math.cos(phi);
    pos[i * 3 + 2] = R * Math.sin(phi) * Math.sin(theta);
    const b = 0.35 + Math.pow(random(), 3) * 0.65;
    c.setHSL(0.58 + random() * 0.08, 0.3, 0.6 + b * 0.4);
    col[i * 3] = c.r * b;
    col[i * 3 + 1] = c.g * b;
    col[i * 3 + 2] = c.b * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const stars = new THREE.Points(geo, mat);
  stars.name = 'stars';
  stars.visible = false;
  return stars;
}

/** Ambiances : position du soleil, lumières, brume, exposition, ciel. */
export const PRESETS = {
  day: {
    label: 'Journée',
    elevation: 38, azimuth: 145,
    sun: { color: '#fff4e0', intensity: 3.0 },
    hemi: { sky: '#bcd7ff', ground: '#4a5a35', intensity: 0.5 },
    fog: { color: '#c7d6e4', near: 90, far: 650 },
    sky: { turbidity: 3.5, rayleigh: 1.6, mie: 0.004, mieG: 0.82 },
    exposure: 0.8, envIntensity: 0.9, stars: 0, water: '#1f4f5e', cabin: 1.5,
  },
  evening: {
    label: 'Fin de journée',
    elevation: 9, azimuth: 232,
    sun: { color: '#ffb46a', intensity: 3.0 },
    hemi: { sky: '#8c9fd0', ground: '#4a3c2a', intensity: 0.45 },
    fog: { color: '#d6b08a', near: 60, far: 520 },
    sky: { turbidity: 9, rayleigh: 3.2, mie: 0.02, mieG: 0.86 },
    exposure: 0.95, envIntensity: 0.85, stars: 0.25, water: '#2a4a5a', cabin: 2.5,
  },
  night: {
    label: 'Nuit',
    elevation: -14, azimuth: 60,
    sun: { color: '#9fb4ff', intensity: 0.35 },
    hemi: { sky: '#1b2644', ground: '#0a0c10', intensity: 0.12 },
    fog: { color: '#0b1020', near: 40, far: 420 },
    sky: { turbidity: 2, rayleigh: 0.6, mie: 0.002, mieG: 0.7 },
    exposure: 1.15, envIntensity: 0.6, stars: 1, water: '#0a1a28', cabin: 4,
  },
};

/**
 * Installe le décor. `sun` est la lumière directionnelle principale,
 * `cabin` la lumière d'habitacle (modulée selon l'ambiance).
 */
export function buildEnvironment({ scene, renderer, sun, cabin }) {
  const sky = new Sky();
  sky.scale.setScalar(6000);
  scene.add(sky);

  const hemi = new THREE.HemisphereLight('#bcd7ff', '#4a5a35', 0.5);
  scene.add(hemi);

  const moonSun = sun; // la même lumière sert de lune la nuit
  const sunDir = new THREE.Vector3(0, 1, 0);

  scene.fog = new THREE.Fog('#c7d6e4', 90, 650);

  const terrain = buildTerrain();
  const meadow = buildMeadow();
  const grass = buildGrassTufts();
  const [conifers, broadleaves] = buildTrees();
  const rocks = buildRocks();
  const water = buildWater(sunDir);
  const stars = buildStars();
  scene.add(terrain, meadow, grass, conifers, broadleaves, rocks, water, stars);

  const pmrem = new THREE.PMREMGenerator(renderer);
  // 8 bits sRGB volontairement : le disque solaire du shader Sky dépasse la
  // plage des demi-flottants (→ Inf, puis NaN après le flou PMREM, et tout
  // le décor devient noir). En 8 bits il sature proprement.
  const cubeTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, generateMipmaps: false });
  const cubeCamera = new THREE.CubeCamera(0.5, 4000, cubeTarget);
  cubeCamera.position.set(0, 1.3, 0);
  let envTexture = null;

  const env = {
    sky, terrain, meadow, grass, conifers, broadleaves, rocks, water, stars, hemi, sunDir,
    preset: 'evening',

    /** Reflets : capture du décor sans la voiture ni l'aménagement. */
    captureEnvironment(hidden = []) {
      const states = hidden.map((o) => [o, o.visible]);
      for (const o of hidden) o.visible = false;
      const waterVisible = water.visible;
      water.visible = false;
      const clipping = renderer.clippingPlanes;
      renderer.clippingPlanes = [];
      cubeCamera.update(renderer, scene);
      renderer.clippingPlanes = clipping;
      water.visible = waterVisible;
      for (const [o, v] of states) o.visible = v;
      if (envTexture) envTexture.dispose();
      envTexture = pmrem.fromCubemap(cubeTarget.texture).texture;
      scene.environment = envTexture;
    },

    setPreset(name) {
      const p = PRESETS[name] || PRESETS.evening;
      env.preset = name;
      const u = sky.material.uniforms;
      u.turbidity.value = p.sky.turbidity;
      u.rayleigh.value = p.sky.rayleigh;
      u.mieCoefficient.value = p.sky.mie;
      u.mieDirectionalG.value = p.sky.mieG;
      sunDir.setFromSphericalCoords(1, Math.PI / 2 - THREE.MathUtils.degToRad(p.elevation), THREE.MathUtils.degToRad(p.azimuth));
      u.sunPosition.value.copy(sunDir);
      moonSun.position.copy(sunDir).multiplyScalar(30);
      if (p.elevation < 0) {
        // Lune : haute, opposée au soleil couché.
        moonSun.position.setFromSphericalCoords(30, Math.PI / 2 - THREE.MathUtils.degToRad(42), THREE.MathUtils.degToRad(p.azimuth + 150));
      }
      moonSun.color.set(p.sun.color);
      moonSun.intensity = p.sun.intensity;
      hemi.color.set(p.hemi.sky);
      hemi.groundColor.set(p.hemi.ground);
      hemi.intensity = p.hemi.intensity;
      scene.fog.color.set(p.fog.color);
      scene.fog.near = p.fog.near;
      scene.fog.far = p.fog.far;
      renderer.toneMappingExposure = p.exposure;
      scene.environmentIntensity = p.envIntensity;
      stars.visible = p.stars > 0;
      stars.material.opacity = p.stars;
      water.material.uniforms.sunDirection.value.copy(moonSun.position).normalize();
      water.material.uniforms.sunColor.value.set(p.sun.color);
      water.material.uniforms.waterColor.value.set(p.water);
      if (cabin) cabin.intensity = p.cabin;
    },

    update(dt) {
      water.material.uniforms.time.value += dt * 0.6;
    },
  };

  env.setPreset('evening');
  return env;
}
