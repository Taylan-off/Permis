import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materials as M } from './materials.js';
import { box, cylinderZ } from './geometry.js';

/*
 * Aménagement couchage, construit sur le gabarit relevé par lancer de rayons sur
 * le modèle 3D (banquette retirée). Repère : X avant, Y haut, Z côté passager.
 *
 *  Plancher plat          y = 0,475 m   de x = -1,85 à -0,55
 *  Puits à pieds (rang 2) y = 0,31 m    de x = -0,50 à -0,28, |z| ≥ 0,25 (tunnel au centre à 0,42)
 *  Passages de roue       |z| ≤ 0,49    de x = -1,85 à -1,10, jusqu'à y ≈ 0,85
 *  Largeur au-dessus      |z| ≤ 0,59 à x = -1,05, ≤ 0,63 au-delà (y 0,8 → 1,0)
 *  Zone arrière (custode) |z| ≤ 0,49 pour x ≤ -1,65 jusqu'à y = 1,0
 *  Dossiers avant         x = -0,15 (y 0,6) à -0,28 (y 1,0)
 *  Face interne du hayon  x = -1,94 ;  plafond 1,46 (arrière) → 1,62 m
 */
export const LAYOUT = {
  floor: 0.475,
  footwell: 0.31,
  platformTop: 0.86,
  plate: 0.018,
  mattress: 0.1,
  rearX: -1.9,
  archEndX: -1.1,
  frontX: -0.3,
  extensionX: 0.07,
  narrowHalf: 0.47,
  midHalf: 0.57,
  wideHalf: 0.6,
  roofMin: 1.46,
};

/** Plaque de contreplaqué : faces en placage, chants en plis. */
function plywood(min, max) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const geo = new THREE.BoxGeometry(...size);
  // Les 6 groupes de faces de BoxGeometry : +x, -x, +y, -y, +z, -z.
  const thin = size.indexOf(Math.min(...size));
  const mats = [0, 1, 2, 3, 4, 5].map((f) => (Math.floor(f / 2) === thin ? M.wood : M.woodEdge));
  const mesh = new THREE.Mesh(geo, mats);
  mesh.position.set(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function rounded(min, max, radius, material, segments = 3) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const geo = new RoundedBoxGeometry(size[0], size[1], size[2], segments, Math.min(radius, Math.min(...size) / 2));
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Poignée en arceau (inox). */
function handle(center, axis = 'x', length = 0.1) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, length, 10), M.steel);
  bar.rotation.z = axis === 'x' ? Math.PI / 2 : 0;
  bar.rotation.x = axis === 'z' ? Math.PI / 2 : bar.rotation.x;
  g.add(bar);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.025, 8), M.steel);
    if (axis === 'x') { leg.position.set(s * length / 2, 0, 0); leg.rotation.x = Math.PI / 2; leg.position.z = -0.012; }
    else { leg.position.set(0, 0, s * length / 2); leg.rotation.z = Math.PI / 2; leg.position.x = 0.012; }
    g.add(leg);
  }
  g.position.set(...center);
  return g;
}

/** Caisse de rangement plastique avec couvercle et poignées latérales. */
function crate(min, max, mat) {
  const g = new THREE.Group();
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const body = rounded(min, [max[0], max[1] - 0.025, max[2]], 0.012, mat, 2);
  g.add(body);
  g.add(rounded([min[0] - 0.006, max[1] - 0.028, min[2] - 0.006], [max[0] + 0.006, max[1], max[2] + 0.006], 0.01, M.crateLid, 2));
  // Nervures verticales.
  for (let i = 1; i < 4; i++) {
    const x = min[0] + (size[0] * i) / 4;
    g.add(box([x - 0.004, min[1] + 0.02, min[2] - 0.003], [x + 0.004, max[1] - 0.04, min[2]], mat));
    g.add(box([x - 0.004, min[1] + 0.02, max[2]], [x + 0.004, max[1] - 0.04, max[2] + 0.003], mat));
  }
  // Poignées en creux aux extrémités (bandeau sombre).
  for (const x of [min[0] - 0.001, max[0]]) g.add(box([x, max[1] - 0.09, min[2] + size[2] / 2 - 0.05], [x + 0.001, max[1] - 0.06, min[2] + size[2] / 2 + 0.05], M.crateLid));
  return g;
}

export function buildInterior() {
  const L = LAYOUT;
  const root = new THREE.Group();
  const groups = {};
  const top = L.platformTop;
  const under = top - L.plate;

  // ── Structure ────────────────────────────────────────────────────────────
  groups.bed = new THREE.Group();
  const bed = groups.bed;
  // Plateaux (trois largeurs pour épouser les passages de roue et la custode).
  bed.add(plywood([L.rearX, under, -L.narrowHalf], [L.archEndX, top, L.narrowHalf]));
  bed.add(plywood([L.archEndX, under, -L.midHalf], [-0.95, top, L.midHalf]));
  bed.add(plywood([-0.95, under, -L.wideHalf], [L.frontX, top, L.wideHalf]));
  // Trappes : rainures (fines bandes sombres) sur le plateau avant.
  for (const x of [-0.78, -0.34]) bed.add(box([x - 0.002, top, -0.56], [x + 0.002, top + 0.0005, 0.56], M.trim));
  for (const z of [-0.03, 0.03]) bed.add(box([-0.78, top, z - 0.002], [-0.34, top + 0.0005, z + 0.002], M.trim));
  // Longerons sur le plancher plat (en dedans des passages de roue), de l'arrière au puits.
  for (const z of [-0.45, 0.43]) bed.add(plywood([L.rearX + 0.02, L.floor, z], [-0.52, under, z + 0.018]));
  // Pieds avant dans le puits à pieds (de part et d'autre du tunnel).
  for (const z of [-0.5, 0.38]) bed.add(plywood([-0.36, L.footwell, z], [-0.34, under, z + 0.12]));
  // Traverse avant au-dessus du puits, et traverse sur le changement de largeur.
  bed.add(plywood([L.frontX - 0.02, under - 0.08, -0.58], [L.frontX, under, 0.58]));
  bed.add(plywood([L.archEndX - 0.018, L.floor, -0.45], [L.archEndX, under, 0.45]));
  // Cloison centrale arrière (cuisine / rangements).
  bed.add(plywood([L.rearX + 0.02, L.floor, -0.009], [L.archEndX, under, 0.009]));
  // Tasseaux de renfort sous les plateaux.
  for (const x of [-1.7, -1.4, -0.7, -0.45]) bed.add(box([x - 0.015, under - 0.03, -0.43], [x + 0.015, under, 0.41], M.woodDark));
  root.add(bed);

  // Rallonge rabattable (sièges avant avancés).
  groups.extension = new THREE.Group();
  groups.extension.add(plywood([L.frontX, under, -0.55], [L.extensionX, top, 0.55]));
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.08, 12), M.steel);
  hinge.rotation.x = Math.PI / 2;
  hinge.position.set(L.frontX, top - 0.002, 0);
  groups.extension.add(hinge);
  groups.extension.visible = false;
  root.add(groups.extension);

  // ── Couchage ─────────────────────────────────────────────────────────────
  groups.mattress = new THREE.Group();
  const mt = top + L.mattress;
  groups.mattress.add(rounded([L.rearX + 0.03, top, -L.narrowHalf + 0.02], [L.archEndX + 0.01, mt, L.narrowHalf - 0.02], 0.035, M.mattress));
  groups.mattress.add(rounded([L.archEndX, top, -L.midHalf + 0.02], [-0.95 + 0.01, mt, L.midHalf - 0.02], 0.035, M.mattress));
  groups.mattress.add(rounded([-0.95, top, -L.wideHalf + 0.02], [L.frontX - 0.02, mt, L.wideHalf - 0.02], 0.035, M.mattress));
  // Couette repliée sur les deux tiers arrière, bord roulé.
  groups.mattress.add(rounded([L.rearX + 0.08, mt - 0.01, -0.42], [-0.8, mt + 0.045, 0.42], 0.02, M.blanket));
  groups.mattress.add(rounded([-0.86, mt - 0.005, -0.42], [-0.74, mt + 0.07, 0.42], 0.03, M.blanket));
  // Oreillers.
  groups.mattress.add(rounded([-0.72, mt, 0.05], [-0.32, mt + 0.1, 0.56], 0.045, M.pillow));
  groups.mattress.add(rounded([-0.72, mt, -0.56], [-0.32, mt + 0.1, -0.05], 0.045, M.pillow));
  root.add(groups.mattress);

  groups.mattressExtension = new THREE.Group();
  groups.mattressExtension.add(rounded([L.frontX - 0.02, top, -0.53], [L.extensionX - 0.02, mt, 0.53], 0.035, M.mattress));
  groups.mattressExtension.visible = false;
  root.add(groups.mattressExtension);

  // ── Module cuisine coulissant (côté passager, sort par le hayon) ─────────
  groups.kitchen = new THREE.Group();
  const drawer = new THREE.Group();
  const kx0 = L.rearX + 0.03;
  const kx1 = L.archEndX - 0.03;
  const kz0 = 0.03;
  const kz1 = 0.42;
  const ky0 = L.floor + 0.012;
  const ky1 = under - 0.012;
  drawer.add(plywood([kx0, ky0, kz0], [kx1, ky0 + 0.012, kz1])); // fond
  drawer.add(plywood([kx0, ky0, kz0], [kx1, ky1, kz0 + 0.012])); // joue
  drawer.add(plywood([kx0, ky0, kz1 - 0.012], [kx1, ky1, kz1])); // joue
  drawer.add(plywood([kx1 - 0.012, ky0, kz0], [kx1, ky1, kz1])); // dos
  drawer.add(plywood([kx0, ky0, kz0], [kx0 + 0.018, ky1, kz1])); // façade
  drawer.add(handle([kx0 - 0.013, ky0 + 0.2, (kz0 + kz1) / 2], 'z', 0.12));
  // Glissières inox sous le tiroir.
  for (const z of [kz0 + 0.03, kz1 - 0.03]) drawer.add(box([kx0, L.floor + 0.002, z - 0.006], [kx1, ky0, z + 0.006], M.steel));
  // Réchaud à cartouche : corps, grille, bouton.
  const stove = new THREE.Group();
  stove.position.set(kx0 + 0.2, ky0 + 0.012, (kz0 + kz1) / 2);
  stove.add(rounded([-0.17, 0, -0.14], [0.17, 0.05, 0.14], 0.01, M.steel, 2));
  const burner = cylinderZ(0.05, 0.012, M.trim, 24);
  burner.rotation.x = Math.PI / 2;
  burner.position.y = 0.055;
  stove.add(burner);
  for (let i = 0; i < 4; i++) {
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, 0.006), M.trim);
    rod.position.y = 0.065;
    rod.rotation.y = (i * Math.PI) / 4;
    stove.add(rod);
  }
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 12), M.trim);
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.17, 0.025, 0.08);
  stove.add(knob);
  const cartridge = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 16), M.chrome);
  cartridge.rotation.z = Math.PI / 2;
  cartridge.position.set(0.05, 0.03, -0.1);
  stove.add(cartridge);
  drawer.add(stove);
  // Jerrican d'eau 10 L avec bouchon et robinet.
  drawer.add(rounded([kx0 + 0.44, ky0 + 0.012, kz0 + 0.05], [kx0 + 0.66, ky0 + 0.21, kz1 - 0.05], 0.015, M.jerrycan, 2));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 16), M.trim);
  cap.position.set(kx0 + 0.6, ky0 + 0.225, (kz0 + kz1) / 2);
  drawer.add(cap);
  // Planche à découper et boîte à couverts.
  drawer.add(plywood([kx0 + 0.44, ky0 + 0.21, kz0 + 0.06], [kx0 + 0.66, ky0 + 0.22, kz1 - 0.06]));
  drawer.add(crate([kx0 + 0.52, ky0 + 0.012, kz0 + 0.0], [kx1 - 0.03, ky0 + 0.14, kz1 - 0.012], M.crate2));
  groups.kitchen.add(drawer);
  groups.kitchenDrawer = drawer;
  root.add(groups.kitchen);

  // ── Rangements ───────────────────────────────────────────────────────────
  groups.storage = new THREE.Group();
  // Caisses empilées côté conducteur, zone coffre (entre longeron et cloison).
  groups.storage.add(crate([L.rearX + 0.05, L.floor + 0.005, -0.42], [-1.5, L.floor + 0.17, -0.03], M.crate));
  groups.storage.add(crate([L.rearX + 0.05, L.floor + 0.175, -0.42], [-1.5, L.floor + 0.34, -0.03], M.crate2));
  groups.storage.add(crate([-1.47, L.floor + 0.005, -0.42], [L.archEndX - 0.03, L.floor + 0.3, -0.03], M.crate));
  // Deux tiroirs plats sous le plateau avant, accessibles par les portes arrière.
  const makeSideDrawer = (sign) => {
    const d = new THREE.Group();
    const zIn = sign * 0.03;
    const zOut = sign * 0.55;
    const z0 = Math.min(zIn, zOut);
    const z1 = Math.max(zIn, zOut);
    const x0 = -0.78;
    const x1 = -0.36;
    const y0 = L.floor + 0.012;
    const y1 = under - 0.012;
    d.add(plywood([x0, y0, z0], [x1, y0 + 0.012, z1]));
    d.add(plywood([x0, y0, z0], [x0 + 0.012, y1 - 0.08, z1]));
    d.add(plywood([x1 - 0.012, y0, z0], [x1, y1 - 0.08, z1]));
    const faceZ = sign > 0 ? [z1 - 0.018, z1] : [z0, z0 + 0.018];
    d.add(plywood([x0, y0, faceZ[0]], [x1, y1, faceZ[1]]));
    const backZ = sign > 0 ? [z0, z0 + 0.012] : [z1 - 0.012, z1];
    d.add(plywood([x0, y0, backZ[0]], [x1, y1 - 0.08, backZ[1]]));
    d.add(handle([(x0 + x1) / 2, y0 + 0.2, sign > 0 ? z1 + 0.013 : z0 - 0.013], 'x', 0.12));
    for (const x of [x0 + 0.03, x1 - 0.03]) d.add(box([x - 0.006, L.floor + 0.002, z0], [x + 0.006, y0, z1], M.steel));
    return d;
  };
  groups.drawerL = makeSideDrawer(-1);
  groups.drawerR = makeSideDrawer(1);
  groups.storage.add(groups.drawerL, groups.drawerR);
  root.add(groups.storage);

  return { root, groups };
}

/** Cotes utiles de l'aménagement, pour le panneau d'information. */
export function layoutSpecs() {
  const L = LAYOUT;
  const f = (v) => v.toFixed(2).replace('.', ',');
  return [
    ['Longueur couchage', `${f(L.frontX - L.rearX)} m`],
    ['… avec rallonge, sièges avancés', `${f(L.extensionX - L.rearX)} m`],
    ['Largeur à la tête / aux pieds', `${f(2 * L.wideHalf)} / ${f(2 * L.narrowHalf)} m`],
    ['Hauteur du plateau', `${f(L.platformTop)} m`],
    ['Hauteur libre sur matelas', `${f(L.roofMin - L.platformTop - L.mattress)} à ${f(1.62 - L.platformTop - L.mattress)} m`],
    ['Hauteur de rangement sous plateau', `${f(L.platformTop - L.plate - L.floor)} m`],
  ];
}
