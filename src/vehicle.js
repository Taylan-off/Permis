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
    m.emissiveIntensity = shader.includes('lights') ? 0.8 : 0.35;
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
  const rimMaterial = new THREE.MeshStandardMaterial({ color: '#c9ced4', metalness: 0.85, roughness: 0.3 });
  for (const [name, node] of Object.entries(nodes)) {
    if (!name.startsWith('part_wheel')) continue;
    const parts = node.children.filter((c) => c.isMesh);
    for (const m of parts) m.geometry.computeBoundingSphere();
    const tyre = parts.reduce((a, b) => (b.geometry.boundingSphere.radius > a.geometry.boundingSphere.radius ? b : a), parts[0]);
    for (const m of parts) m.material = m === tyre ? tyreMaterial : rimMaterial;
  }

  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) m.userData.baseMaterial = m.material;

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
      for (const m of meshes) m.material = enabled ? xrayMaterial : m.userData.baseMaterial;
    },

    setPaint(hex) {
      paintMaterial.color.set(hex);
    },
  };
  return api;
}
