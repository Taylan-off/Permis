import * as THREE from 'three';
import { materials as M } from './materials.js';
import { box, cylinderZ } from './geometry.js';
import { DIM } from './van.js';

const FLOOR = DIM.floorY;

/** Siège individuel (origine au sol, centré, dossier vers -X). */
function makeSeat(scale = 1) {
  const g = new THREE.Group();
  g.add(box([-0.15, 0, -0.18], [0.15, 0.26, 0.18], M.trim));
  g.add(box([-0.26, 0.26, -0.26], [0.26, 0.38, 0.26], M.seat));
  const back = box([-0.06, 0, -0.25], [0.06, 0.62, 0.25], M.seat);
  back.position.set(-0.24, 0.38, 0);
  back.rotation.z = 0.22;
  g.add(back);
  const head = box([-0.05, 0, -0.12], [0.05, 0.12, 0.12], M.seat);
  head.position.set(-0.36, 1.0, 0);
  head.rotation.z = 0.22;
  g.add(head);
  g.scale.setScalar(scale);
  return g;
}

export function buildInterior() {
  const root = new THREE.Group();
  const groups = {};

  // Sièges avant (toujours présents).
  const front = new THREE.Group();
  for (const z of [0.42, -0.42]) {
    const s = makeSeat();
    s.position.set(0.3, FLOOR, z);
    front.add(s);
  }
  root.add(front);

  // Banquette arrière d'origine (3 sièges individuels), masquée par défaut.
  groups.rearSeats = new THREE.Group();
  for (const z of [0.55, 0, -0.55]) {
    const s = makeSeat(0.92);
    s.position.set(-0.6, FLOOR, z);
    groups.rearSeats.add(s);
  }
  groups.rearSeats.visible = false;
  root.add(groups.rearSeats);

  // Plateforme de lit : plateau contreplaqué + cloisons longitudinales.
  groups.bed = new THREE.Group();
  const top = 0.88;
  groups.bed.add(box([-2.14, top, -0.76], [-0.14, top + 0.04, 0.76], M.wood));
  for (const z of [-0.58, -0.02, 0.54]) {
    groups.bed.add(box([-2.14, FLOOR, z], [-0.14, top, z + 0.04], M.woodDark));
  }
  groups.bed.add(box([-0.18, FLOOR, -0.58], [-0.14, top, 0.58], M.woodDark));
  groups.bed.add(box([-2.14, FLOOR, -0.02], [-1.26, top, 0.02], M.woodDark));
  // Trappe de visite côté gauche (coffre sous le lit).
  groups.bed.add(box([-1.3, top + 0.04, 0.1], [-0.5, top + 0.045, 0.5], M.woodDark));
  root.add(groups.bed);

  // Matelas, couette, oreillers.
  groups.mattress = new THREE.Group();
  groups.mattress.add(box([-2.12, top + 0.04, -0.74], [-0.16, top + 0.14, 0.74], M.mattress));
  groups.mattress.add(box([-2.08, top + 0.14, -0.7], [-0.75, top + 0.19, 0.7], M.blanket));
  groups.mattress.add(box([-0.62, top + 0.14, 0.06], [-0.2, top + 0.23, 0.68], M.pillow));
  groups.mattress.add(box([-0.62, top + 0.14, -0.68], [-0.2, top + 0.23, -0.06], M.pillow));
  root.add(groups.mattress);

  // Module cuisine coulissant (côté droit, sort par le hayon).
  groups.kitchen = new THREE.Group();
  const drawer = new THREE.Group();
  const z0 = -0.54;
  const z1 = -0.06;
  const x0 = -2.12;
  const x1 = -1.3;
  const y0 = FLOOR + 0.01;
  const y1 = top - 0.02;
  drawer.add(box([x0, y0, z0], [x1, y0 + 0.03, z1], M.woodDark)); // fond
  drawer.add(box([x0, y0, z0], [x1, y1, z0 + 0.02], M.woodDark)); // paroi
  drawer.add(box([x0, y0, z1 - 0.02], [x1, y1, z1], M.woodDark)); // paroi
  drawer.add(box([x0, y0, z0], [x0 + 0.03, y1, z1], M.wood)); // façade
  drawer.add(box([x1 - 0.02, y0, z0], [x1, y1, z1], M.woodDark)); // fond du tiroir
  drawer.add(box([x0 - 0.02, y0 + 0.12, -0.36], [x0, y0 + 0.15, -0.24], M.chrome)); // poignée
  // Réchaud gaz une feu.
  drawer.add(box([x0 + 0.08, y0 + 0.03, z0 + 0.06], [x0 + 0.4, y0 + 0.08, z1 - 0.06], M.steel));
  const burner = cylinderZ(0.07, 0.02, M.trim, 24);
  burner.rotation.x = Math.PI / 2;
  burner.position.set(x0 + 0.24, y0 + 0.09, (z0 + z1) / 2);
  drawer.add(burner);
  // Jerrican d'eau.
  drawer.add(box([x0 + 0.48, y0 + 0.03, z0 + 0.08], [x0 + 0.66, y0 + 0.24, z1 - 0.08], M.jerrycan));
  drawer.add(box([x0 + 0.53, y0 + 0.24, -0.33], [x0 + 0.61, y0 + 0.27, -0.27], M.trim));
  // Boîte de couverts.
  drawer.add(box([x0 + 0.7, y0 + 0.03, z0 + 0.08], [x0 + 0.8, y0 + 0.12, z1 - 0.08], M.crate2));
  groups.kitchen.add(drawer);
  groups.kitchenDrawer = drawer;
  root.add(groups.kitchen);

  // Rangements : caisses côté gauche, tiroir fixe côté droit.
  groups.storage = new THREE.Group();
  groups.storage.add(box([-2.08, FLOOR + 0.01, 0.06], [-1.5, FLOOR + 0.26, 0.5], M.crate));
  groups.storage.add(box([-1.42, FLOOR + 0.01, 0.06], [-0.84, FLOOR + 0.26, 0.5], M.crate2));
  groups.storage.add(box([-0.76, FLOOR + 0.01, 0.06], [-0.22, FLOOR + 0.26, 0.5], M.crate));
  groups.storage.add(box([-2.08, FLOOR + 0.28, 0.06], [-1.5, FLOOR + 0.5, 0.5], M.crate2));
  // Tiroir fixe à l'avant du module cuisine.
  groups.storage.add(box([-1.22, FLOOR + 0.01, -0.54], [-0.22, top - 0.02, -0.06], M.woodDark));
  groups.storage.add(box([-1.22, FLOOR + 0.01, -0.54], [-1.19, top - 0.02, -0.06], M.wood));
  root.add(groups.storage);

  return { root, groups };
}
