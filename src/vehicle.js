import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/*
 * Chargement du VW Touran (converti depuis le mod GTA V « minivan.yft »
 * avec tools/yft2gltf, voir README).
 *
 * Repère du fichier : le nœud racine « vehicle » convertit Z-up en Y-up.
 * À l'intérieur, chaque pièce (door_dside_f, boot…) garde les axes RAGE :
 *   X = vers la droite (côté passager), Y = vers l'avant, Z = vers le haut.
 * Les portes pivotent donc autour de leur Z local, le hayon autour de son X.
 *
 * Après chargement, le véhicule est orienté avant vers +X, côté conducteur
 * vers -Z, et posé au sol (y = 0).
 */

// Importé par Vite : fichier séparé en build normal, intégré en data URL avec
// `npm run build:inline` (hébergements qui ne servent pas le .glb).
import MODEL_URL from './assets/touran.glb?url';

/** Ouvrants : nœud glTF, axe local et angle d'ouverture (rad). */
export const PART_NODES = {
  doorFL: { node: 'door_dside_f', axis: 'z', open: -1.15 },
  doorFR: { node: 'door_pside_f', axis: 'z', open: 1.15 },
  doorRL: { node: 'door_dside_r', axis: 'z', open: -1.25 },
  doorRR: { node: 'door_pside_r', axis: 'z', open: 1.25 },
  tailgate: { node: 'boot', axis: 'x', open: -1.45 },
  // Le capot n'existe pas comme pièce dans le mod : il est découpé du châssis
  // au chargement (voir extractBonnet) et pivote autour de son bord arrière.
  bonnet: { node: 'bonnet', axis: 'z', open: 0.85 },
};

/** Sous-maillages du châssis qui contiennent les sièges (identifiés par rendu isolé). */
const SEAT_MESHES = ['chassis_6', 'chassis_19'];
/** Les triangles dont le centre est derrière cette abscisse appartiennent aux sièges arrière. */
const REAR_SEAT_SPLIT_X = -0.35;
/** Avance des sièges avant en mode couchage (m). */
export const FRONT_SEAT_SLIDE = 0.2;

export const paintMaterial = new THREE.MeshPhysicalMaterial({
  color: '#2b5797',
  metalness: 0.6,
  roughness: 0.32,
  clearcoat: 1,
  clearcoatRoughness: 0.06,
});

const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: '#8fb8d8',
  metalness: 0.1,
  roughness: 0.05,
  transparent: true,
  opacity: 0.3,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const xrayMaterial = new THREE.MeshStandardMaterial({
  color: '#9fc5ff',
  transparent: true,
  opacity: 0.1,
  depthWrite: false,
  side: THREE.DoubleSide,
});

function upgradeMaterial(mesh) {
  const src = mesh.material;
  const shader = src.userData?.shader ?? '';
  const diffuse = src.userData?.diffuse ?? '';
  mesh.userData.shader = shader;
  mesh.userData.diffuse = diffuse;

  if (shader.startsWith('vehicle_paint')) {
    mesh.material = paintMaterial;
    return;
  }
  if (shader.includes('glass')) {
    if (diffuse === 'redglass' || diffuse === 'orange') {
      mesh.material = new THREE.MeshPhysicalMaterial({
        color: diffuse === 'redglass' ? '#b3111c' : '#e06a1a',
        transparent: true,
        opacity: 0.75,
        roughness: 0.15,
        emissive: diffuse === 'redglass' ? '#ff2a2a' : '#ff8a2a',
        emissiveIntensity: 0.15,
      });
    } else {
      mesh.material = glassMaterial;
    }
    mesh.renderOrder = 2;
    return;
  }
  const m = new THREE.MeshStandardMaterial({
    map: src.map ?? null,
    color: src.color ?? new THREE.Color('#ffffff'),
    roughness: 0.85,
    metalness: 0.05,
    transparent: src.transparent,
    alphaTest: src.alphaTest,
    side: src.side,
  });
  if (shader.includes('emissive') && src.map) {
    m.emissiveMap = src.map;
    m.emissive = new THREE.Color('#ffffff');
    m.emissiveIntensity = shader.includes('lights') ? 0.15 : 0.3;
  }
  if (shader.includes('tire')) m.roughness = 0.95;
  if (shader === 'vehicle_mesh' || diffuse === 'xromat') {
    m.metalness = 0.8;
    m.roughness = 0.3;
  }
  if (shader.startsWith('vehicle_interior')) {
    // Les textures intérieures du mod sont très sombres : on les éclaircit un peu.
    m.color = new THREE.Color('#c8c8c8');
  }
  mesh.material = m;
}

/**
 * Sépare un maillage en deux selon l'abscisse monde du centre de chaque triangle.
 * Retourne { behind, ahead } ; les attributs sont partagés, seuls les index diffèrent.
 */
function splitMeshByWorldX(mesh, threshold) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index ? geo.index.array : null;
  const count = index ? index.length : pos.count;
  const behind = [];
  const ahead = [];
  const v = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  for (let t = 0; t < count; t += 3) {
    let cx = 0;
    const ids = [0, 1, 2].map((k) => (index ? index[t + k] : t + k));
    for (const id of ids) {
      v.fromBufferAttribute(pos, id).applyMatrix4(mesh.matrixWorld);
      cx += v.x / 3;
    }
    (cx < threshold ? behind : ahead).push(...ids);
  }
  const make = (ids, name) => {
    const g = new THREE.BufferGeometry();
    for (const [key, attr] of Object.entries(geo.attributes)) g.setAttribute(key, attr);
    g.setIndex(ids);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mesh.material);
    m.name = name;
    m.userData = { ...mesh.userData };
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.copy(mesh.position);
    m.quaternion.copy(mesh.quaternion);
    m.scale.copy(mesh.scale);
    return m;
  };
  return { behind: make(behind, `${mesh.name}_rear`), ahead: make(ahead, `${mesh.name}_front`) };
}

/**
 * Sépare les triangles d'un maillage selon un prédicat évalué en espace monde
 * (centre du triangle et normale de face). Retourne { matched, rest }, deux
 * maillages partageant les attributs de l'original, ou null si rien ne correspond.
 */
function splitMeshByPredicate(mesh, predicate) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index ? geo.index.array : null;
  const count = index ? index.length : pos.count;
  const matched = [];
  const rest = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  for (let t = 0; t < count; t += 3) {
    const ids = [0, 1, 2].map((k) => (index ? index[t + k] : t + k));
    a.fromBufferAttribute(pos, ids[0]).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, ids[1]).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, ids[2]).applyMatrix4(mesh.matrixWorld);
    n.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    (predicate(cx, cy, cz, n) ? matched : rest).push(...ids);
  }
  if (!matched.length) return null;
  const make = (ids, name) => {
    const g = new THREE.BufferGeometry();
    for (const [key, attr] of Object.entries(geo.attributes)) g.setAttribute(key, attr);
    g.setIndex(ids);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mesh.material);
    m.name = name;
    m.userData = { ...mesh.userData };
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.copy(mesh.position);
    m.quaternion.copy(mesh.quaternion);
    m.scale.copy(mesh.scale);
    return m;
  };
  return { matched: make(matched, `${mesh.name}_split`), rest: make(rest, mesh.name) };
}

/** Zone du capot, mesurée sur le modèle : x 1,33 → 2,16 m, largeur ±0,80 m, face supérieure. */
function isBonnetTriangle(x, y, z, n) {
  if (x < 1.33 || x > 2.16 || Math.abs(z) > 0.8 || y < 0.74 || n.y < 0.2) return false;
  if (x > 1.62 && Math.abs(z) > 0.6 && y < 0.97) return false; // boîtiers de phares
  return true;
}

/**
 * Découpe le capot des maillages peints du châssis et le monte sur un pivot
 * (bord arrière, à la base du pare-brise). Ajoute un compartiment moteur simplifié.
 */
function extractBonnet(group, nodes) {
  const pivot = new THREE.Group();
  pivot.name = 'bonnet';
  pivot.position.set(1.33, 1.06, 0);
  group.add(pivot);
  const paintDouble = paintMaterial.clone();
  paintDouble.side = THREE.DoubleSide;
  for (const name of ['bodyshell_2', 'bodyshell_3']) {
    const mesh = nodes[name];
    if (!mesh?.isMesh) continue;
    const split = splitMeshByPredicate(mesh, isBonnetTriangle);
    if (!split) continue;
    const parent = mesh.parent;
    parent.remove(mesh);
    parent.add(split.rest);
    nodes[name] = split.rest;
    parent.add(split.matched);
    split.matched.material = paintDouble;
    split.matched.userData.paintDouble = true;
    group.updateMatrixWorld(true);
    pivot.attach(split.matched);
  }
  // Compartiment moteur (le mod n'en a pas) : bac sombre, bloc moteur, batterie, boîte à air.
  const bay = new THREE.Group();
  bay.name = 'engineBay';
  const dark = new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.9 });
  const plastic = new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.7 });
  const alu = new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.7, roughness: 0.45 });
  const addBox = (min, max, mat) => {
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    m.position.set(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    bay.add(m);
  };
  addBox([1.38, 0.5, -0.66], [2.04, 0.55, 0.66], dark); // fond
  addBox([1.38, 0.5, -0.68], [2.04, 0.82, -0.64], dark); // flancs
  addBox([1.38, 0.5, 0.64], [2.04, 0.82, 0.68], dark);
  addBox([1.36, 0.5, -0.66], [1.4, 0.98, 0.66], dark); // tablier
  addBox([2.0, 0.5, -0.66], [2.04, 0.74, 0.66], dark); // traverse avant
  addBox([1.5, 0.55, -0.34], [1.94, 0.84, 0.28], plastic); // bloc moteur
  addBox([1.56, 0.84, -0.28], [1.9, 0.88, 0.2], alu); // cache culasse
  addBox([1.44, 0.55, 0.36], [1.7, 0.78, 0.6], plastic); // batterie
  addBox([1.74, 0.56, 0.34], [1.96, 0.78, 0.6], plastic); // boîte à air
  addBox([1.46, 0.55, -0.6], [1.86, 0.74, -0.4], plastic); // boîte fusibles / lave-glace
  group.add(bay);
  return pivot;
}

/** Projecteurs et barres LED modelés dans les optiques (le mod n'en a pas le détail). */
function buildLightDetails(group, nodes) {
  const chrome = new THREE.MeshPhysicalMaterial({ color: '#eef1f4', metalness: 1, roughness: 0.08, clearcoat: 1 });
  const lensOn = () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', emissive: '#fff6e2', emissiveIntensity: 0.2, roughness: 0.2, transmission: 0, clearcoat: 1 });
  const ledOn = (color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, roughness: 0.4 });
  const head = [];
  const tail = [];
  const center = (n) => new THREE.Box3().setFromObject(nodes[n]).getCenter(new THREE.Vector3());

  for (const name of ['headlight_l', 'headlight_r']) {
    if (!nodes[name]) continue;
    const c = center(name);
    const side = Math.sign(c.z);
    const g = new THREE.Group();
    g.name = `${name}_detail`;
    g.position.copy(c);
    for (const [dx, dy, dz, r] of [[0, 0.0, -side * 0.025, 0.036], [-0.01, 0.012, side * 0.045, 0.028]]) {
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2), chrome);
      bowl.rotation.z = -Math.PI / 2; // ouverture vers +x
      bowl.position.set(dx - r * 0.35, dy, dz);
      bowl.material.side = THREE.BackSide;
      g.add(bowl);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.012, 24), lensOn());
      lens.rotation.z = Math.PI / 2;
      lens.position.set(dx + r * 0.45, dy, dz);
      g.add(lens);
      head.push(lens);
    }
    // Barre LED de jour, sous les projecteurs.
    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.007, 0.12), ledOn('#f4f8ff'));
    drl.position.set(0.02, -0.055, 0);
    g.add(drl);
    head.push(drl);
    group.add(g);
  }
  for (const name of ['taillight_l', 'taillight_r']) {
    if (!nodes[name]) continue;
    const c = center(name);
    const g = new THREE.Group();
    g.name = `${name}_detail`;
    g.position.copy(c);
    for (const dy of [-0.025, 0.02]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.13), ledOn('#ff2a2a'));
      bar.position.set(0.02, dy, 0);
      g.add(bar);
      tail.push(bar);
    }
    group.add(g);
  }
  return { head, tail };
}

/**
 * Ciel étoilé de garniture de toit (façon Rolls-Royce Starlight) : des centaines
 * de points lumineux fixés 4 mm sous la garniture, scintillement lent.
 */
function buildStarlight(group, liner) {
  if (!liner) return null;
  const ray = new THREE.Raycaster();
  const positions = [];
  const sizes = [];
  const phases = [];
  const rnd = (() => { let s = 1234567; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  for (let x = -1.72; x <= 0.42; x += 0.055) {
    for (let z = -0.62; z <= 0.62; z += 0.055) {
      if (rnd() > 0.5) continue;
      const px = x + (rnd() - 0.5) * 0.04;
      const pz = z + (rnd() - 0.5) * 0.04;
      ray.set(new THREE.Vector3(px, 1.12, pz), new THREE.Vector3(0, 1, 0));
      const hit = ray.intersectObject(liner, false)[0];
      if (!hit || hit.distance > 0.6) continue;
      positions.push(hit.point.x, hit.point.y - 0.004, hit.point.z);
      sizes.push(0.006 + Math.pow(rnd(), 2) * 0.012);
      phases.push(rnd() * Math.PI * 2);
    }
  }
  if (!positions.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#fff1d2') }, uOpacity: { value: 0.75 }, uScale: { value: 600 } },
    vertexShader: `
      attribute float aSize; attribute float aPhase; uniform float uTime; uniform float uScale; varying float vTwinkle;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vTwinkle = 0.7 + 0.3 * sin(uTime * 1.3 + aPhase);
        gl_PointSize = aSize * uScale * vTwinkle / max(-mv.z, 0.05);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity; varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.08, d) * uOpacity * vTwinkle;
        gl_FragColor = vec4(uColor * (1.0 + 2.0 * smoothstep(0.3, 0.0, d)), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'starlight';
  points.frustumCulled = false;
  group.add(points);
  return points;
}

/**
 * Décodage des textures WebP sans fetch ni URL blob : Safari refuse le fetch
 * d'un gros data: URL (« Load failed ») et certains hébergements interdisent
 * les blob:. On lit les octets du bufferView et on crée l'image directement.
 * Remplace l'extension EXT_texture_webp intégrée (même nom → priorité).
 */
const WEBGL_FILTERS = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter,
  9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter,
  9987: THREE.LinearMipmapLinearFilter,
};
const WEBGL_WRAPPINGS = {
  33071: THREE.ClampToEdgeWrapping,
  33648: THREE.MirroredRepeatWrapping,
  10497: THREE.RepeatWrapping,
};

async function imageFromBytes(bytes, mimeType) {
  const blob = new Blob([bytes], { type: mimeType });
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch (e) {
      console.warn('createImageBitmap a échoué, repli sur <img>', e);
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  const img = new Image();
  img.src = `data:${mimeType};base64,${btoa(binary)}`;
  await img.decode();
  return img;
}

class EmbeddedTexturePlugin {
  constructor(parser) {
    this.parser = parser;
    this.name = 'EXT_texture_webp';
    this.cache = new Map();
  }

  loadTexture(textureIndex) {
    const { parser, name } = this;
    const json = parser.json;
    const textureDef = json.textures[textureIndex];
    const ext = textureDef.extensions?.[name];
    if (!ext) return null;
    const source = json.images[ext.source];
    if (source.bufferView === undefined) return null; // image externe : chemin standard

    if (!this.cache.has(ext.source)) {
      this.cache.set(ext.source, parser.getDependency('bufferView', source.bufferView)
        .then((bufferView) => imageFromBytes(new Uint8Array(bufferView), source.mimeType || 'image/webp')));
    }
    return this.cache.get(ext.source).then((image) => {
      const texture = new THREE.Texture(image);
      texture.needsUpdate = true;
      texture.flipY = false;
      texture.name = textureDef.name || source.name || '';
      const sampler = (json.samplers || [])[textureDef.sampler] || {};
      texture.magFilter = WEBGL_FILTERS[sampler.magFilter] || THREE.LinearFilter;
      texture.minFilter = WEBGL_FILTERS[sampler.minFilter] || THREE.LinearMipmapLinearFilter;
      texture.wrapS = WEBGL_WRAPPINGS[sampler.wrapS] || THREE.RepeatWrapping;
      texture.wrapT = WEBGL_WRAPPINGS[sampler.wrapT] || THREE.RepeatWrapping;
      texture.generateMipmaps = texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter;
      parser.associations.set(texture, { textures: textureIndex });
      return texture;
    });
  }
}

/** Lit le modèle : data: URL décodé en mémoire, sinon fetch classique. */
async function fetchModel(url, onProgress) {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const header = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    if (!header.includes('base64')) return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    onProgress?.({ loaded: 1, total: 1 });
    return bytes.buffer;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total });
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

/**
 * Charge le modèle. Résout avec :
 *  - group : à ajouter à la scène (avant vers +X, posé au sol) ;
 *  - parts : { doorFL, …, tailgate } prêts pour l'animation ;
 *  - rearSeats / frontSeats : groupes de maillages (sièges) ;
 *  - setXray(bool), setPaint(hex), setFrontSeatsForward(bool) ;
 *  - meshes : tous les maillages du véhicule (pour le raycast).
 */
export async function loadVehicle(onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register((parser) => new EmbeddedTexturePlugin(parser));
  const buffer = await fetchModel(MODEL_URL, onProgress);
  const gltf = await loader.parseAsync(buffer, '');
  const root = gltf.scene;

  const nodes = {};
  root.traverse((o) => {
    if (o.name) nodes[o.name] = o;
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      upgradeMaterial(o);
    }
  });

  // Mise au sol : le bas des roues définit y = 0.
  root.updateMatrixWorld(true);
  const wheelBox = new THREE.Box3();
  for (const [name, node] of Object.entries(nodes)) {
    if (name.startsWith('part_wheel')) wheelBox.expandByObject(node);
  }
  const groundY = Number.isFinite(wheelBox.min.y) ? wheelBox.min.y : new THREE.Box3().setFromObject(root).min.y;

  const group = new THREE.Group();
  group.name = 'touran';
  root.rotation.y = -Math.PI / 2; // avant du fichier = -Z → +X
  root.position.y = -groundY;
  group.add(root);
  group.updateMatrixWorld(true);

  // Sièges : séparation avant / arrière.
  const rearSeats = new THREE.Group();
  rearSeats.name = 'rearSeats';
  const frontSeats = new THREE.Group();
  frontSeats.name = 'frontSeats';
  for (const name of SEAT_MESHES) {
    const mesh = nodes[name];
    if (!mesh?.isMesh) continue;
    const { behind, ahead } = splitMeshByWorldX(mesh, REAR_SEAT_SPLIT_X);
    const parent = mesh.parent;
    parent.remove(mesh);
    parent.add(behind, ahead);
    rearSeats.children.push(behind);
    frontSeats.children.push(ahead);
  }
  group.updateMatrixWorld(true);

  const parts = {};
  for (const [id, def] of Object.entries(PART_NODES)) {
    const node = nodes[def.node];
    if (!node) continue;
    parts[id] = node;
    node.traverse((o) => { o.userData.toggleId = id; });
  }

  // Roues : le shader des pneus n'est pas résolu dans le mod (rendu blanc).
  // Le plus grand sous-maillage de chaque roue est le pneu, les autres la jante.
  const tyreMaterial = new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.95 });
  const rimMaterial = new THREE.MeshPhysicalMaterial({ color: '#dfe3e7', metalness: 0.95, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.1 });
  const hubMaterial = new THREE.MeshStandardMaterial({ color: '#4a4d52', metalness: 0.8, roughness: 0.45 });
  for (const [name, node] of Object.entries(nodes)) {
    if (!name.startsWith('part_wheel')) continue;
    const parts = node.children.filter((c) => c.isMesh);
    if (!parts.length) continue; // sous-maillages eux-mêmes nommés part_wheel_*
    for (const m of parts) m.geometry.computeBoundingSphere();
    const sorted = [...parts].sort((a, b) => b.geometry.boundingSphere.radius - a.geometry.boundingSphere.radius);
    // Le plus grand sous-maillage contient pneu ET jante : on les sépare par
    // distance à l'axe de la roue (jante de 17" : rayon ≈ 0,22 m, flanc du pneu au-delà).
    const whole = sorted[0];
    const center = new THREE.Vector3();
    node.getWorldPosition(center);
    const split = splitMeshByPredicate(whole, (x, y) => Math.hypot(x - center.x, y - center.y) > 0.245);
    if (split) {
      whole.parent.remove(whole);
      node.add(split.matched, split.rest);
      split.matched.material = tyreMaterial;
      split.rest.material = rimMaterial;
    } else {
      whole.material = tyreMaterial;
    }
    sorted.slice(1).forEach((m) => { m.material = hubMaterial; });
  }

  // Capot ouvrable, détails d'optiques et ciel étoilé de garniture.
  nodes.bonnet = extractBonnet(group, nodes);
  parts.bonnet = nodes.bonnet;
  nodes.bonnet.traverse((o) => { o.userData.toggleId = 'bonnet'; });
  group.updateMatrixWorld(true);
  const lightDetails = buildLightDetails(group, nodes);
  const starlight = buildStarlight(group, nodes.chassis_17);

  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) m.userData.baseMaterial = m.material;

  // ── Feux ────────────────────────────────────────────────────────────────
  // Classement des maillages émissifs d'après le nœud (os) qui les porte.
  const lightMeshes = { head: [], tail: [], plate: [], fog: [], dash: [] };
  for (const m of meshes) {
    const shader = m.userData.shader ?? '';
    if (!shader.includes('emissive') && !(shader.includes('glass') && m.userData.diffuse === 'redglass')) continue;
    const owner = m.parent?.name ?? '';
    if (owner.startsWith('headlight')) lightMeshes.head.push(m);
    else if (owner.startsWith('taillight') || owner.startsWith('brakelight')) lightMeshes.tail.push(m);
    else if (owner.startsWith('platelight')) lightMeshes.plate.push(m);
    else if (owner.startsWith('extralight')) lightMeshes.fog.push(m);
    else if (owner === 'dials' || m.userData.shader.includes('dash')) lightMeshes.dash.push(m);
  }
  for (const list of Object.values(lightMeshes)) {
    for (const m of list) if (m.material.userData.shared !== false) { m.material = m.material.clone(); m.material.userData.shared = false; m.userData.baseMaterial = m.material; }
  }
  lightMeshes.head.push(...lightDetails.head);
  lightMeshes.tail.push(...lightDetails.tail);
  for (const m of [...lightDetails.head, ...lightDetails.tail]) { m.material.userData.shared = false; m.userData.baseMaterial = m.material; meshes.push(m); }
  // Les maillages ajoutés (compartiment moteur, optiques) doivent aussi passer en rayons X.
  group.traverse((o) => { if (o.isMesh && !o.userData.baseMaterial && !o.isPoints) { o.userData.baseMaterial = o.material; meshes.push(o); } });

  const lights = new THREE.Group();
  lights.name = 'lights';
  group.add(lights);
  const worldCenter = (node) => new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
  const headPos = ['headlight_l', 'headlight_r'].map((n) => nodes[n] && worldCenter(nodes[n])).filter(Boolean);
  const tailPos = ['taillight_l', 'taillight_r'].map((n) => nodes[n] && worldCenter(nodes[n])).filter(Boolean);

  // Faisceau lumineux visible : cône additif dégradé (alpha par sommet).
  const beamGeo = new THREE.ConeGeometry(1.7, 10, 28, 1, true);
  beamGeo.translate(0, -5, 0);
  beamGeo.rotateZ(Math.PI / 2);
  {
    const pos = beamGeo.attributes.position;
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getX(i) / 10));
      const a = 0.11 * Math.pow(1 - t, 2.6);
      col.set([1, 0.93, 0.75, a], i * 4);
    }
    beamGeo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  }
  const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });

  const spots = [];
  const beams = [];
  for (const hp of headPos) {
    const spot = new THREE.SpotLight('#fff1d2', 90, 48, 0.52, 0.55, 1.3);
    spot.position.copy(hp);
    spot.target.position.set(hp.x + 16, hp.y - 1.6, hp.z);
    lights.add(spot, spot.target);
    spots.push(spot);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.copy(hp);
    beam.rotation.z = -0.07;
    beam.renderOrder = 5;
    lights.add(beam);
    beams.push(beam);
  }
  const glows = [];
  for (const tp of tailPos) {
    const glow = new THREE.PointLight('#ff2a1a', 2.5, 3.5, 1.5);
    glow.position.copy(tp).add(new THREE.Vector3(-0.15, 0, 0));
    lights.add(glow);
    glows.push(glow);
  }
  let lightsOn = false;

  const api = {
    group,
    root,
    parts,
    nodes,
    meshes,
    rearSeats,
    frontSeats,
    bounds: new THREE.Box3().setFromObject(group),

    setRearSeats(visible) {
      for (const m of rearSeats.children) m.visible = visible;
    },

    /** Avance les sièges avant (translation locale : l'axe Y RAGE est l'avant). */
    setFrontSeatsForward(forward) {
      for (const m of frontSeats.children) {
        const base = m.userData.basePosY ?? (m.userData.basePosY = m.position.y);
        m.position.y = base + (forward ? FRONT_SEAT_SLIDE / m.parent.getWorldScale(new THREE.Vector3()).y : 0);
      }
    },

    setXray(enabled) {
      for (const m of meshes) if (m.isMesh) m.material = enabled ? xrayMaterial : m.userData.baseMaterial;
    },

    /** Allume ou éteint phares, feux arrière, plaque, antibrouillards et tableau de bord. */
    setLights(on, { beams: showBeams = true } = {}) {
      lightsOn = on;
      const set = (list, color, intensity) => {
        for (const m of list) {
          const mat = m.material;
          if (!mat.emissive) continue;
          mat.emissive.set(on ? color : '#ffffff');
          mat.emissiveIntensity = on ? intensity : 0.12;
        }
      };
      set(lightMeshes.head, '#fff6e2', 9);
      set(lightMeshes.fog, '#fff0cc', 4);
      set(lightMeshes.plate, '#ffffff', 2.5);
      set(lightMeshes.dash, '#ffffff', 1.2);
      for (const m of lightMeshes.tail) {
        const mat = m.material;
        if (!mat.emissive) continue;
        mat.emissive.set('#ff2020');
        mat.emissiveIntensity = on ? 4.5 : 0.15;
      }
      for (const sp of spots) sp.visible = on;
      for (const g of glows) g.visible = on;
      for (const b of beams) b.visible = on && showBeams;
    },

    get lightsOn() { return lightsOn; },

    starlight,
    setStarlight(on) { if (starlight) starlight.visible = on; },
    update(dt) { if (starlight) starlight.material.uniforms.uTime.value += dt; },

    setPaint(hex) {
      paintMaterial.color.set(hex);
    },
  };
  return api;
}
