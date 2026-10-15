import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildEnvironment } from './environment.js';
import { loadVehicle, PART_NODES } from './vehicle.js';
import { buildInterior, layoutSpecs } from './interior.js';

// ---------- Scène ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.75;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 12000);
camera.position.set(5.2, 2.2, -4.4);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.minDistance = 0.2;
controls.maxDistance = 16;

// ---------- Lumières ----------
scene.add(new THREE.HemisphereLight('#bcd7ff', '#4a5a35', 0.55));
const sun = new THREE.DirectionalLight('#fff4e0', 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -6;
sun.shadow.camera.right = 6;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -6;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight('#9bb7ff', 0.5);
fill.position.set(-6, 4, 5);
scene.add(fill);
// Lumière d'habitacle pour lire l'aménagement.
const cabin = new THREE.PointLight('#ffe9c4', 6, 4, 2);
cabin.position.set(-0.8, 1.35, 0);
scene.add(cabin);

// ---------- Décor : ciel, montagnes, prairie ----------
buildEnvironment({ scene, renderer, sun });

// ---------- Aménagement ----------
const { root: interior, groups } = buildInterior();
scene.add(interior);

const specsTable = document.getElementById('specs-layout');
for (const [k, v] of layoutSpecs()) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
  specsTable.appendChild(tr);
}

// ---------- Ouvrants (véhicule + tiroirs) ----------
const OPENINGS = {
  ...PART_NODES,
  kitchenDrawer: { axis: 'x', open: -0.78, kind: 'position' },
  drawerL: { axis: 'z', open: -0.42, kind: 'position' },
  drawerR: { axis: 'z', open: 0.42, kind: 'position' },
};
const openables = {
  kitchenDrawer: groups.kitchenDrawer,
  drawerL: groups.drawerL,
  drawerR: groups.drawerR,
};
for (const [id, obj] of Object.entries(openables)) obj.traverse((o) => { o.userData.toggleId = id; });

const state = {};
for (const id of Object.keys(OPENINGS)) state[id] = { open: false, t: 0 };

const buttons = [...document.querySelectorAll('[data-toggle]')];
function refreshButtons() {
  for (const b of buttons) b.classList.toggle('active', state[b.dataset.toggle].open);
}

/** Dépendances : un tiroir ne sort que si l'ouvrant qui lui fait face est ouvert. */
const REQUIRES = { kitchenDrawer: 'tailgate', drawerL: 'doorRL', drawerR: 'doorRR' };

function setOpen(id, open) {
  if (!state[id]) return;
  state[id].open = open;
  if (open && REQUIRES[id]) state[REQUIRES[id]].open = true;
  if (!open) for (const [child, parent] of Object.entries(REQUIRES)) if (parent === id) state[child].open = false;
  refreshButtons();
}
const toggle = (id) => setOpen(id, !state[id].open);

for (const b of buttons) b.addEventListener('click', () => toggle(b.dataset.toggle));
document.querySelector('[data-action="openAll"]').addEventListener('click', () => {
  for (const id of Object.keys(PART_NODES)) setOpen(id, true);
});
document.querySelector('[data-action="closeAll"]').addEventListener('click', () => {
  for (const id of Object.keys(state)) setOpen(id, false);
});

// ---------- Véhicule ----------
let vehicle = null;
const loading = document.getElementById('loading');
const loadingPct = document.getElementById('loading-pct');

loadVehicle((e) => {
  if (e.total) loadingPct.textContent = `${Math.round((e.loaded / e.total) * 100)} %`;
}).then((v) => {
  vehicle = v;
  scene.add(v.group);
  for (const [id, node] of Object.entries(v.parts)) openables[id] = node;
  applyVisibility();
  applyExtension();
  v.setPaint(paintInput.value);
  loading.classList.add('done');
}).catch((err) => {
  loading.querySelector('p').textContent = `Impossible de charger le modèle : ${err.message}`;
  console.error(err);
});

// ---------- Aménagement : visibilité ----------
const showBoxes = [...document.querySelectorAll('[data-show]')];
const extensionBox = document.querySelector('[data-option="extension"]');

function applyVisibility() {
  for (const cb of showBoxes) {
    if (cb.dataset.show === 'rearSeats') vehicle?.setRearSeats(cb.checked);
    else groups[cb.dataset.show].visible = cb.checked;
  }
  applyExtension();
}

function applyExtension() {
  const on = extensionBox.checked;
  vehicle?.setFrontSeatsForward(on);
  groups.extension.visible = on && groups.bed.visible;
  groups.mattressExtension.visible = on && groups.mattress.visible;
}

for (const cb of showBoxes) {
  cb.addEventListener('change', () => {
    // Les sièges d'origine et l'aménagement occupent le même espace.
    if (cb.dataset.show === 'rearSeats' && cb.checked) {
      for (const other of showBoxes) if (other !== cb) other.checked = false;
      extensionBox.checked = false;
      for (const id of ['kitchenDrawer', 'drawerL', 'drawerR']) setOpen(id, false);
    } else if (cb.dataset.show !== 'rearSeats' && cb.checked) {
      showBoxes.find((c) => c.dataset.show === 'rearSeats').checked = false;
    }
    applyVisibility();
  });
}
extensionBox.addEventListener('change', () => {
  if (extensionBox.checked) {
    showBoxes.find((c) => c.dataset.show === 'rearSeats').checked = false;
    applyVisibility();
  } else applyExtension();
});

// ---------- Options de vue ----------
const paintInput = document.querySelector('[data-option="paint"]');
paintInput.addEventListener('input', (e) => vehicle?.setPaint(e.target.value));
document.querySelector('[data-option="xray"]').addEventListener('change', (e) => vehicle?.setXray(e.target.checked));

const cutInput = document.querySelector('[data-option="cut"]');
const cutValue = document.getElementById('cut-value');
const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
function applyCut() {
  const h = Number(cutInput.value) / 100;
  if (h <= 0) {
    renderer.clippingPlanes = [];
    cutValue.textContent = 'off';
  } else {
    cutPlane.constant = h;
    renderer.clippingPlanes = [cutPlane];
    cutValue.textContent = `${h.toFixed(2).replace('.', ',')} m`;
  }
}
cutInput.addEventListener('input', applyCut);

const panel = document.getElementById('panel');
document.getElementById('panel-toggle').addEventListener('click', () => panel.classList.toggle('hidden'));

// ---------- Vues prédéfinies ----------
const VIEWS = {
  front: { pos: [5.2, 2.2, -4.4], target: [0, 0.8, 0] },
  rear: { pos: [-5.4, 2.3, -4.2], target: [0, 0.8, 0] },
  side: { pos: [0.2, 1.4, -6.8], target: [0, 0.8, 0] },
  top: { pos: [0.01, 9, 0.01], target: [0, 0.5, 0] },
  tailgate: { pos: [-3.6, 1.45, 0.3], target: [-0.6, 0.8, 0], open: 'tailgate' },
  inside: { pos: [-0.5, 1.3, 0], target: [-3.5, 0.8, 0], open: 'tailgate' },
};
let camAnim = null;
function goToView(name) {
  const v = VIEWS[name];
  if (v.open) setOpen(v.open, true);
  camAnim = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: new THREE.Vector3(...v.pos),
    toTarget: new THREE.Vector3(...v.target),
  };
}
for (const b of document.querySelectorAll('[data-view]')) {
  b.addEventListener('click', () => goToView(b.dataset.view));
}

// ---------- Clic sur un ouvrant ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
canvas.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (moved > 6) return;
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const targets = [interior];
  if (vehicle) targets.push(vehicle.group);
  const hits = raycaster.intersectObjects(targets, true);
  const hit = hits.find((h) => h.object.visible && h.object.userData.toggleId);
  if (hit) toggle(hit.object.userData.toggleId);
});

// ---------- Boucle ----------
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clock = new THREE.Clock();
const OPEN_DURATION = 0.8;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.25);

  for (const [id, obj] of Object.entries(openables)) {
    const s = state[id];
    const o = OPENINGS[id];
    if (!s || !o) continue;
    const target = s.open ? 1 : 0;
    const step = dt / OPEN_DURATION;
    s.t = target > s.t ? Math.min(target, s.t + step) : Math.max(target, s.t - step);
    const value = easeInOut(s.t) * o.open;
    if (o.kind === 'position') obj.position[o.axis] = value;
    else obj.rotation[o.axis] = value;
  }

  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + dt / 0.9);
    const k = easeInOut(camAnim.t);
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k);
    controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, k);
    if (camAnim.t >= 1) camAnim = null;
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Accès de débogage (page measure.html et tests).
window.__app = { THREE, scene, renderer, camera, controls, groups, get vehicle() { return vehicle; }, setOpen, goToView };
