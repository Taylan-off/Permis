import * as THREE from 'three';
import { materials as M } from './materials.js';
import { extrude, box, cylinderZ } from './geometry.js';

/*
 * Repère : X vers l'avant, Y vers le haut, Z vers la gauche (côté conducteur).
 * Unités en mètres. Cotes approchées d'un VW Touran II (2015+) :
 * longueur 4,53 m, largeur 1,83 m, hauteur 1,66 m, empattement 2,79 m.
 */
export const DIM = {
  wheelX: 1.395,
  wheelY: 0.33,
  wheelR: 0.33,
  archR: 0.41,
  sillY: 0.44,
  halfWidth: 0.915,
  panel: 0.06,
  floorY: 0.58,
  roofY: 1.57,
};

const HALF = DIM.halfWidth;
const INNER = HALF - DIM.panel; // 0.855

const archDx = Math.sqrt(DIM.archR ** 2 - (DIM.sillY - DIM.wheelY) ** 2);
const archA = Math.atan2(DIM.sillY - DIM.wheelY, archDx);

function wheelArch(cx) {
  return { arc: [cx, DIM.wheelY, DIM.archR, Math.PI - archA, archA, true] };
}

/** Contour latéral complet (profil vu de côté). */
const SIDE_OUTLINE = [
  [-2.26, DIM.sillY],
  [-DIM.wheelX - archDx, DIM.sillY],
  wheelArch(-DIM.wheelX),
  [DIM.wheelX - archDx, DIM.sillY],
  wheelArch(DIM.wheelX),
  [2.24, DIM.sillY],
  [2.24, 0.72],
  [2.2, 0.95],
  [1.35, 1.08],
  [0.5, 1.6],
  [-1.85, 1.64],
  [-2.22, 1.3],
  [-2.26, 0.62],
];

const FRONT_DOOR_HOLE = [
  [0.02, 0.52],
  [0.98, 0.52],
  [0.98, 1.02],
  [0.3, 1.57],
  [0.02, 1.57],
];

const REAR_DOOR_HOLE = [
  [-0.98, 0.52],
  [-0.02, 0.52],
  [-0.02, 1.57],
  [-0.93, 1.57],
  [-0.98, 1.1],
];

const QUARTER_WINDOW = [
  [-1.06, 1.08],
  [-1.06, 1.5],
  [-1.8, 1.5],
  [-1.97, 1.08],
];

/** Porte avant : panneau bas peint + vitre + encadrement, charnière à l'avant (x = 0.995). */
function buildFrontDoor() {
  const hinge = 0.995;
  const g = new THREE.Group();
  g.position.set(hinge, 0, 0);

  const lower = extrude(
    [[0.005, 0.505], [0.995, 0.505], [0.995, 1.02], [0.005, 1.02]],
    INNER - 0.005, HALF, M.paint,
  );
  const frame = extrude(
    [[0.005, 1.02], [0.995, 1.02], [0.31, 1.585], [0.005, 1.585]],
    INNER - 0.005, HALF, M.paint,
    [[[0.05, 1.06], [0.9, 1.06], [0.29, 1.54], [0.05, 1.54]]],
  );
  const glass = extrude(
    [[0.05, 1.06], [0.9, 1.06], [0.29, 1.54], [0.05, 1.54]],
    INNER + 0.02, INNER + 0.035, M.glass,
  );
  const card = box([0.03, 0.52, INNER - 0.03], [0.97, 1.0, INNER - 0.005], M.interiorLight);
  const handle = box([0.15, 0.9, HALF], [0.33, 0.94, HALF + 0.02], M.chrome);

  // Rétroviseur fixé sur la porte.
  const mirrorArm = box([0.86, 1.08, HALF], [0.92, 1.12, HALF + 0.08], M.trim);
  const mirror = box([0.78, 1.04, HALF + 0.07], [0.95, 1.18, HALF + 0.19], M.trim);
  const mirrorGlass = box([0.775, 1.06, HALF + 0.09], [0.78, 1.16, HALF + 0.17], M.chrome);

  for (const m of [lower, frame, glass, card, handle, mirrorArm, mirror, mirrorGlass]) {
    m.position.x -= hinge;
    g.add(m);
  }
  return g;
}

/** Porte arrière, charnière sur le pied milieu (x = -0.005). */
function buildRearDoor() {
  const hinge = -0.005;
  const g = new THREE.Group();
  g.position.set(hinge, 0, 0);

  const lower = extrude(
    [[-0.995, 0.505], [-0.005, 0.505], [-0.005, 1.02], [-0.995, 1.02]],
    INNER - 0.005, HALF, M.paint,
  );
  const frame = extrude(
    [[-0.995, 1.02], [-0.005, 1.02], [-0.005, 1.585], [-0.935, 1.585], [-0.995, 1.11]],
    INNER - 0.005, HALF, M.paint,
    [[[-0.95, 1.06], [-0.05, 1.06], [-0.05, 1.54], [-0.9, 1.54], [-0.95, 1.14]]],
  );
  const glass = extrude(
    [[-0.95, 1.06], [-0.05, 1.06], [-0.05, 1.54], [-0.9, 1.54], [-0.95, 1.14]],
    INNER + 0.02, INNER + 0.035, M.glass,
  );
  const card = box([-0.97, 0.52, INNER - 0.03], [-0.03, 1.0, INNER - 0.005], M.interiorLight);
  const handle = box([-0.85, 0.9, HALF], [-0.67, 0.94, HALF + 0.02], M.chrome);

  for (const m of [lower, frame, glass, card, handle]) {
    m.position.x -= hinge;
    g.add(m);
  }
  return g;
}

/** Un côté complet (gauche). Le côté droit est obtenu par symétrie. */
function buildSide() {
  const g = new THREE.Group();

  const panel = extrude(SIDE_OUTLINE, INNER, HALF, M.paint, [
    FRONT_DOOR_HOLE,
    REAR_DOOR_HOLE,
    QUARTER_WINDOW,
  ]);
  g.add(panel);

  const quarterGlass = extrude(QUARTER_WINDOW, INNER + 0.02, INNER + 0.035, M.glass);
  g.add(quarterGlass);

  // Passages de roue intérieurs.
  for (const sx of [-1, 1]) {
    const cx = sx * DIM.wheelX;
    g.add(box([cx - 0.45, 0.5, 0.58], [cx + 0.45, 0.86, INNER], M.interior));
  }

  // Roues.
  for (const sx of [-1, 1]) {
    const wheel = new THREE.Group();
    wheel.position.set(sx * DIM.wheelX, DIM.wheelY, 0.78);
    wheel.add(cylinderZ(DIM.wheelR, 0.22, M.tyre));
    const rim = cylinderZ(0.21, 0.23, M.rim, 24);
    wheel.add(rim);
    const hub = cylinderZ(0.06, 0.24, M.chrome, 16);
    wheel.add(hub);
    for (let i = 0; i < 5; i++) {
      const geo = new THREE.BoxGeometry(0.07, 0.13, 0.03);
      geo.translate(0, 0.135, 0.11);
      geo.rotateZ((i / 5) * Math.PI * 2);
      const spoke = new THREE.Mesh(geo, M.trim);
      spoke.castShadow = true;
      wheel.add(spoke);
    }
    g.add(wheel);
  }

  // Feux.
  g.add(box([2.2, 0.78, 0.45], [2.265, 0.95, INNER + 0.03], M.headlight));
  g.add(box([-2.275, 0.95, 0.66], [-2.2, 1.22, HALF + 0.005], M.taillight));

  // Barre de toit.
  g.add(box([-1.8, 1.64, 0.72], [0.4, 1.7, 0.78], M.trim));

  const doorFront = buildFrontDoor();
  const doorRear = buildRearDoor();
  g.add(doorFront, doorRear);

  return { group: g, doorFront, doorRear };
}

/** Hayon, charnière en haut (x = -1.85, y = 1.64), ouverture vers le haut. */
function buildTailgate() {
  const hx = -1.85;
  const hy = 1.64;
  const g = new THREE.Group();
  g.position.set(hx, hy, 0);

  const lower = extrude(
    [[-2.26, 0.62], [-2.2, 0.62], [-2.172, 1.1], [-2.232, 1.1]],
    -0.84, 0.84, M.paint,
  );
  const upper = [[-2.232, 1.1], [-2.172, 1.1], [-2.16, 1.3], [-1.84, 1.59], [-1.86, 1.64], [-2.22, 1.3]];
  const frameL = extrude(upper, 0.7, 0.84, M.paint);
  const frameR = extrude(upper, -0.84, -0.7, M.paint);
  const glass = extrude(upper, -0.7, 0.7, M.glass);
  const plate = box([-2.275, 0.72, -0.26], [-2.26, 0.83, 0.26], M.chrome);
  const handle = box([-2.26, 0.95, -0.12], [-2.235, 0.98, 0.12], M.chrome);
  const inner = box([-2.2, 0.64, -0.8], [-2.185, 1.06, 0.8], M.interiorLight);

  for (const m of [lower, frameL, frameR, glass, plate, handle, inner]) {
    m.position.x -= hx;
    m.position.y -= hy;
    g.add(m);
  }
  return g;
}

export function buildVan() {
  const van = new THREE.Group();
  const parts = {};

  const left = buildSide();
  const right = buildSide();
  right.group.scale.z = -1;
  van.add(left.group, right.group);

  parts.doorFL = left.doorFront;
  parts.doorRL = left.doorRear;
  parts.doorFR = right.doorFront;
  parts.doorRR = right.doorRear;

  // Avant : capot, calandre, pare-chocs, pare-brise.
  van.add(extrude(
    [[0.99, DIM.sillY], [2.24, DIM.sillY], [2.24, 0.72], [2.2, 0.95], [1.35, 1.08], [0.99, 1.08]],
    -INNER, INNER, M.paint,
  ));
  van.add(extrude(
    [[1.35, 1.08], [1.37, 1.1], [0.52, 1.62], [0.5, 1.6]],
    -INNER, INNER, M.glass,
  ));
  van.add(box([2.235, 0.8, -0.38], [2.255, 0.93, 0.38], M.trim));
  van.add(box([2.235, 0.5, -0.5], [2.255, 0.68, 0.5], M.trim));
  van.add(box([2.18, 0.36, -HALF - 0.01], [2.3, 0.6, HALF + 0.01], M.trim));
  const logo = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 8, 32), M.chrome);
  logo.rotation.y = Math.PI / 2;
  logo.position.set(2.262, 0.865, 0);
  van.add(logo);

  // Arrière : panneau bas, pare-chocs, hayon.
  van.add(box([-2.26, DIM.sillY, -INNER], [-2.18, 0.62, INNER], M.paint));
  van.add(box([-2.3, 0.36, -HALF - 0.01], [-2.18, 0.62, HALF + 0.01], M.trim));
  parts.tailgate = buildTailgate();
  van.add(parts.tailgate);

  // Toit.
  parts.roof = new THREE.Group();
  parts.roof.add(box([-1.88, DIM.roofY, -INNER], [0.5, 1.64, INNER], M.paint));
  parts.roof.add(box([-1.86, DIM.roofY - 0.012, -INNER + 0.01], [0.48, DIM.roofY, INNER - 0.01], M.interiorLight));
  van.add(parts.roof);

  // Plancher et soubassement.
  van.add(box([-2.2, DIM.floorY - 0.02, -INNER], [1.0, DIM.floorY, INNER], M.interior));
  van.add(box([-2.1, 0.3, -0.62], [2.1, DIM.floorY - 0.02, 0.62], M.trim));
  van.add(box([-2.26, DIM.sillY, -INNER], [1.0, DIM.floorY - 0.02, -INNER + 0.001], M.paint));

  // Tableau de bord, sièges avant, volant.
  van.add(box([0.72, DIM.floorY, -INNER], [0.99, 1.02, INNER], M.interior));
  van.add(box([0.72, 1.0, -INNER], [1.3, 1.08, INNER], M.interior));
  van.add(box([0.6, DIM.floorY, -0.12], [0.9, 0.85, 0.12], M.interior));

  const colBox = box([-0.03, -0.02, -0.03], [0.14, 0.02, 0.03], M.trim);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 10, 36), M.trim);
  wheel.rotation.y = Math.PI / 2;
  const steering = new THREE.Group();
  steering.add(wheel, colBox);
  steering.position.set(0.58, 0.98, 0.42);
  steering.rotation.z = 0.45;
  van.add(steering);

  return { van, parts };
}

/** Ouvertures : angle/translation cible pour chaque ouvrant. */
export const OPENINGS = {
  doorFL: { axis: 'rotation', component: 'y', open: 1.15 },
  doorRL: { axis: 'rotation', component: 'y', open: 1.2 },
  doorFR: { axis: 'rotation', component: 'y', open: 1.15 },
  doorRR: { axis: 'rotation', component: 'y', open: 1.2 },
  tailgate: { axis: 'rotation', component: 'z', open: -1.5 },
  kitchenDrawer: { axis: 'position', component: 'x', open: -0.85 },
};
