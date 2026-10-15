import * as THREE from 'three';
import { loadGlb } from './gltf.js';

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
/** Volume des sièges arrière (banquette rang 2) et des sièges avant, en espace monde. */
const isRearSeat = (x, y, z) => x < -0.35 && x > -1.3 && Math.abs(z) < 0.62 && y > 0.42 && y < 1.4;
const isFrontSeat = (x, y, z) => x >= -0.35 && x < 0.55 && Math.abs(z) < 0.56 && y > 0.42 && y < 1.4;
/** Avance des sièges avant en mode couchage (m). */
export const FRONT_SEAT_SLIDE = 0.2;

export const paintMaterial = new THREE.MeshPhysicalMaterial({
  color: '#2b5797',
  metalness: 0.55,
  roughness: 0.42,
  clearcoat: 0.9,
  clearcoatRoughness: 0.18,
});

/** Vitrage d'optique (phares, feux) : couvercle clair, presque invisible. */
const lampCoverMaterial = new THREE.MeshPhysicalMaterial({
  color: '#dfe8ef',
  metalness: 0,
  roughness: 0.04,
  transparent: true,
  opacity: 0.14,
  clearcoat: 1,
  depthWrite: false,
});

/** Vitre de compteur et autres verres intérieurs : quasi transparents, sans reflet marqué. */
const innerGlassMaterial = new THREE.MeshPhysicalMaterial({
  color: '#ffffff',
  metalness: 0,
  roughness: 0.3,
  transparent: true,
  opacity: 0.08,
  envMapIntensity: 0.15,
  depthWrite: false,
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
  opacity: 0.3,
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
      // Vitres de carrosserie, couvercles d'optiques ou verre intérieur ?
      const owner = mesh.parent?.name ?? '';
      const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      if (/^(headlight|taillight|extralight|indicator|brakelight|reversinglight|platelight)/.test(owner)) mesh.material = lampCoverMaterial;
      else if (Math.abs(c.z) < 0.62 && c.x > -0.4 && c.x < 1.1 && c.y < 1.26) mesh.material = innerGlassMaterial;
      else mesh.material = glassMaterial;
    }
    mesh.renderOrder = 2;
    return;
  }
  const m = new THREE.MeshStandardMaterial({
    map: src.map ?? null,
    color: src.color ?? new THREE.Color('#ffffff'),
    roughness: 0.8,
    metalness: 0.0,
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
    // Les textures intérieures du mod sont très sombres : on les éclaircit nettement.
    m.color = new THREE.Color('#f2f2f2');
    m.roughness = 0.8;
    m.envMapIntensity = 0.5;
  }
  mesh.material = m;
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
 * Charge le modèle. Résout avec :
 *  - group : à ajouter à la scène (avant vers +X, posé au sol) ;
 *  - parts : { doorFL, …, tailgate } prêts pour l'animation ;
 *  - rearSeats / frontSeats : groupes de maillages (sièges) ;
 *  - setXray(bool), setPaint(hex), setFrontSeatsForward(bool) ;
 *  - meshes : tous les maillages du véhicule (pour le raycast).
 */
export async function loadVehicle(onProgress) {
  const gltf = await loadGlb(MODEL_URL, onProgress);
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
    const parent = mesh.parent;
    let remaining = mesh;
    const rear = splitMeshByPredicate(remaining, isRearSeat);
    if (rear) {
      parent.remove(remaining);
      parent.add(rear.matched, rear.rest);
      rearSeats.children.push(rear.matched);
      remaining = rear.rest;
    }
    const front = splitMeshByPredicate(remaining, isFrontSeat);
    if (front) {
      parent.remove(remaining);
      parent.add(front.matched, front.rest);
      frontSeats.children.push(front.matched);
      remaining = front.rest;
    }
    nodes[name] = remaining;
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

  // Détails d'optiques et ciel étoilé de garniture.
  group.updateMatrixWorld(true);
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
  // Les maillages ajoutés (compartiment moteur, optiques) doivent aussi passer en rayons X.
  group.traverse((o) => { if (o.isMesh && !o.userData.baseMaterial && !o.isPoints) { o.userData.baseMaterial = o.material; meshes.push(o); } });

  const lights = new THREE.Group();
  lights.name = 'lights';
  group.add(lights);
  const worldCenter = (node) => new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
  const headPos = ['headlight_l', 'headlight_r'].map((n) => nodes[n] && worldCenter(nodes[n])).filter(Boolean);
  const tailPos = ['taillight_l', 'taillight_r'].map((n) => nodes[n] && worldCenter(nodes[n])).filter(Boolean);

  // Halo diffus autour de chaque phare (sprite additif), au lieu d'un faisceau visible.
  const haloTexture = (() => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,244,220,0.9)');
    g.addColorStop(0.25, 'rgba(255,240,210,0.35)');
    g.addColorStop(1, 'rgba(255,235,200,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const haloMat = new THREE.SpriteMaterial({ map: haloTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, fog: false });
  const spots = [];
  const beams = [];
  for (const hp of headPos) {
    const spot = new THREE.SpotLight('#fff1d2', 22, 34, 0.62, 0.95, 1.5);
    spot.position.copy(hp);
    spot.target.position.set(hp.x + 14, hp.y - 1.9, hp.z);
    lights.add(spot, spot.target);
    spots.push(spot);
    const halo = new THREE.Sprite(haloMat);
    halo.position.copy(hp).add(new THREE.Vector3(0.06, 0, 0));
    halo.scale.set(0.55, 0.4, 1);
    halo.renderOrder = 5;
    lights.add(halo);
    beams.push(halo);
  }
  const glows = [];
  for (const tp of tailPos) {
    const glow = new THREE.PointLight('#ff2a1a', 1.2, 3.0, 1.6);
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
      set(lightMeshes.head, '#fff6e2', 3.2);
      set(lightMeshes.fog, '#fff0cc', 1.8);
      set(lightMeshes.plate, '#ffffff', 1.6);
      set(lightMeshes.dash, '#ffffff', 1.0);
      for (const m of lightMeshes.tail) {
        const mat = m.material;
        if (!mat.emissive) continue;
        mat.emissive.set('#ff2020');
        mat.emissiveIntensity = on ? 2.4 : 0.15;
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
