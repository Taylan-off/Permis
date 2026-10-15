import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { materials as M, setXray, setPaintColor } from './materials.js';
import { buildVan, OPENINGS } from './van.js';
import { buildInterior } from './interior.js';

// ---------- Scène ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0f1419');
scene.fog = new THREE.Fog('#0f1419', 18, 40);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(5.2, 2.2, 4.4);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.minDistance = 0.2;
controls.maxDistance = 16;

// ---------- Lumières ----------
scene.add(new THREE.HemisphereLight('#cfe3ff', '#2a333d', 0.6));
const sun = new THREE.DirectionalLight('#ffffff', 2.2);
sun.position.set(5, 8, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -6;
sun.shadow.camera.right = 6;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -6;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0005;
scene.add(sun);
const fill = new THREE.DirectionalLight('#9bb7ff', 0.5);
fill.position.set(-6, 4, -5);
scene.add(fill);

// ---------- Sol ----------
const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 64), M.ground);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(28, 28, '#2b3642', '#1f2832');
grid.position.y = 0.002;
scene.add(grid);

// ---------- Véhicule et aménagement ----------
const { van, parts } = buildVan();
scene.add(van);
const { root: interior, groups } = buildInterior();
scene.add(interior);

const openables = {
  doorFL: parts.doorFL,
  doorFR: parts.doorFR,
  doorRL: parts.doorRL,
  doorRR: parts.doorRR,
  tailgate: parts.tailgate,
  kitchenDrawer: groups.kitchenDrawer,
};

const state = {};
for (const id of Object.keys(openables)) {
  state[id] = { open: false, t: 0 };
  openables[id].traverse((o) => { o.userData.toggleId = id; });
}

const buttons = [...document.querySelectorAll('[data-toggle]')];
function refreshButtons() {
  for (const b of buttons) b.classList.toggle('active', state[b.dataset.toggle].open);
}

function setOpen(id, open) {
  state[id].open = open;
  // Le tiroir cuisine ne peut sortir que si le hayon est ouvert.
  if (id === 'kitchenDrawer' && open) state.tailgate.open = true;
  if (id === 'tailgate' && !open) state.kitchenDrawer.open = false;
  refreshButtons();
}

function toggle(id) { setOpen(id, !state[id].open); }

// ---------- Interface ----------
for (const b of buttons) b.addEventListener('click', () => toggle(b.dataset.toggle));

document.querySelector('[data-action="openAll"]').addEventListener('click', () => {
  for (const id of ['doorFL', 'doorFR', 'doorRL', 'doorRR', 'tailgate']) setOpen(id, true);
});
document.querySelector('[data-action="closeAll"]').addEventListener('click', () => {
  for (const id of Object.keys(state)) setOpen(id, false);
});

const showBoxes = [...document.querySelectorAll('[data-show]')];
function applyVisibility() {
  for (const cb of showBoxes) groups[cb.dataset.show].visible = cb.checked;
}
for (const cb of showBoxes) {
  cb.addEventListener('change', () => {
    // Les sièges d'origine et l'aménagement occupent le même espace.
    if (cb.dataset.show === 'rearSeats' && cb.checked) {
      for (const other of showBoxes) if (other !== cb) other.checked = false;
      setOpen('kitchenDrawer', false);
    } else if (cb.dataset.show !== 'rearSeats' && cb.checked) {
      showBoxes.find((c) => c.dataset.show === 'rearSeats').checked = false;
    }
    applyVisibility();
  });
}
applyVisibility();

document.querySelector('[data-option="xray"]').addEventListener('change', (e) => setXray(e.target.checked));
document.querySelector('[data-option="roof"]').addEventListener('change', (e) => { parts.roof.visible = !e.target.checked; });
document.querySelector('[data-option="paint"]').addEventListener('input', (e) => setPaintColor(e.target.value));

const panel = document.getElementById('panel');
document.getElementById('panel-toggle').addEventListener('click', () => panel.classList.toggle('hidden'));

// ---------- Vues prédéfinies ----------
const VIEWS = {
  front: { pos: [5.2, 2.2, 4.4], target: [0, 0.8, 0] },
  rear: { pos: [-5.4, 2.2, 4.2], target: [0, 0.8, 0] },
  side: { pos: [0.2, 1.4, 6.8], target: [0, 0.8, 0] },
  top: { pos: [0.01, 9, 0.01], target: [0, 0.5, 0] },
  inside: { pos: [0.22, 1.42, 0.0], target: [-2.3, 0.72, 0] },
};
let camAnim = null;
function goToView(name) {
  const v = VIEWS[name];
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
  const hits = raycaster.intersectObjects([van, interior], true);
  const hit = hits.find((h) => h.object.visible && h.object.userData.toggleId);
  if (hit) toggle(hit.object.userData.toggleId);
});

// ---------- Boucle ----------
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clock = new THREE.Clock();
const OPEN_DURATION = 0.8;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.25);

  // Chaque ouvrant met OPEN_DURATION secondes à s'ouvrir ou se fermer.
  for (const [id, obj] of Object.entries(openables)) {
    const s = state[id];
    const target = s.open ? 1 : 0;
    const step = dt / OPEN_DURATION;
    s.t = target > s.t ? Math.min(target, s.t + step) : Math.max(target, s.t - step);
    const o = OPENINGS[id];
    obj[o.axis][o.component] = easeInOut(s.t) * o.open;
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
