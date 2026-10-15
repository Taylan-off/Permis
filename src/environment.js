import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import grassUrl from './assets/grass.jpg';
import grassNormalUrl from './assets/grass-nm.jpg';

/*
 * Décor de montagne, entièrement procédural et léger :
 *  - ciel atmosphérique (addon Sky) qui sert aussi de carte d'environnement ;
 *  - un seul maillage de relief (bruit de Perlin simplex), prairie plate autour
 *    de la voiture, collines puis montagnes rocheuses et enneigées au loin ;
 *  - un disque d'herbe texturé sous la voiture, fondu sur ses bords ;
 *  - quelques centaines de sapins en basse définition, instanciés.
 */

const TERRAIN_SIZE = 1000;
const TERRAIN_SEGMENTS = 200;
const MEADOW_RADIUS = 70;
const TREE_COUNT = 900;

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

/** Altitude du terrain (m) en (x, z). Plat sous la voiture, montagnes au loin. */
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const hills = (fbm(x, z, 4, 1 / 170) + 0.25) * 40;
  const ridgeNoise = fbm(x + 500, z - 300, 3, 1 / 380);
  const ridge = Math.pow(Math.max(0, 1 - Math.abs(ridgeNoise)), 2.0) * 340;
  const hillMask = smoothstep(40, 200, r);
  const mountainMask = smoothstep(130, 380, r);
  const wall = smoothstep(220, 470, r) * 120; // la vallée est cernée de sommets
  let h = hills * hillMask + ridge * mountainMask + wall;
  const meadow = 1 - smoothstep(14, MEADOW_RADIUS, r);
  h = lerp(h, -0.3, meadow);
  return h;
}

const GRASS_A = new THREE.Color('#4e7d31');
const GRASS_B = new THREE.Color('#86a84d');
const ROCK_A = new THREE.Color('#7d776e');
const ROCK_B = new THREE.Color('#57524c');
const SNOW = new THREE.Color('#f1f5f8');

function colorAt(x, z, h, slope, out) {
  const n = fbm(x * 2.5, z * 2.5, 2, 1 / 35) * 0.5 + 0.5;
  out.copy(GRASS_A).lerp(GRASS_B, n);
  const rock = Math.max(smoothstep(0.3, 0.5, slope), smoothstep(85, 140, h + n * 40));
  const rockColor = ROCK_A.clone().lerp(ROCK_B, n);
  out.lerp(rockColor, rock);
  const snow = smoothstep(175, 230, h + n * 35) * (1 - smoothstep(0.6, 0.85, slope));
  out.lerp(SNOW, snow);
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
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
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
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
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
    normalScale: new THREE.Vector2(0.6, 0.6),
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

function conifer() {
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 1.2, 5);
  trunk.translate(0, 0.6, 0);
  const tiers = [
    [1.6, 2.6, 1.0],
    [1.25, 2.2, 2.4],
    [0.85, 1.9, 3.7],
  ];
  const parts = [trunk];
  const colorOf = (geo, color) => {
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  };
  colorOf(trunk, new THREE.Color('#5a3f28'));
  const green = new THREE.Color('#2f5a2a');
  for (const [r, h, y] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, 7);
    cone.translate(0, y + h / 2, 0);
    colorOf(cone, green);
    parts.push(cone);
  }
  return BufferGeometryUtils.mergeGeometries(parts, false);
}

function buildTrees() {
  const geo = conifer();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, TREE_COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let placed = 0;
  let tries = 0;
  while (placed < TREE_COUNT && tries < TREE_COUNT * 40) {
    tries++;
    const r = 38 + Math.pow(random(), 0.55) * 430;
    const a = random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h > 140) continue; // limite des arbres
    // Clairière autour de la voiture : rares bosquets avant 110 m.
    if (r < 110 && fbm(x - 700, z + 400, 2, 1 / 60) < 0.35) continue;
    const dx = heightAt(x + 2, z) - heightAt(x - 2, z);
    const dz = heightAt(x, z + 2) - heightAt(x, z - 2);
    if (Math.hypot(dx, dz) / 4 > 0.7) continue; // pentes trop raides
    // Bosquets : densité modulée par un bruit basse fréquence.
    if (fbm(x + 900, z + 900, 2, 1 / 90) < -0.1) continue;
    const scale = 0.6 + random() * 0.9;
    p.set(x, h - 0.1, z);
    q.setFromAxisAngle(up, random() * Math.PI * 2);
    s.set(scale, scale * (0.9 + random() * 0.3), scale);
    m.compose(p, q, s);
    mesh.setMatrixAt(placed, m);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = 'trees';
  return mesh;
}

/**
 * Installe le décor dans la scène et retourne quelques poignées.
 * `sun` est la lumière directionnelle principale : sa position est alignée sur le soleil du ciel.
 */
export function buildEnvironment({ scene, renderer, sun }) {
  const sky = new Sky();
  sky.scale.setScalar(6000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.5;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;

  const elevation = THREE.MathUtils.degToRad(38);
  const azimuth = THREE.MathUtils.degToRad(145);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
  u.sunPosition.value.copy(sunDir);
  sun.position.copy(sunDir).multiplyScalar(30);

  // Le ciel sert de carte d'environnement (reflets sur la carrosserie).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  skyScene.add(sky);
  scene.environment = pmrem.fromScene(skyScene).texture;
  scene.environmentIntensity = 0.9;
  scene.add(sky);

  scene.fog = new THREE.Fog('#c7d6e4', 90, 650);

  const terrain = buildTerrain();
  const meadow = buildMeadow();
  const trees = buildTrees();
  scene.add(terrain, meadow, trees);

  return { sky, terrain, meadow, trees, sunDir };
}
