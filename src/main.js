import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildEnvironment, lightingForHour } from './environment.js';
import { createPostFX } from './postfx.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { loadVehicle, PART_NODES } from './vehicle.js';
import { buildInterior, layoutSpecs } from './interior.js';

// ---------- Scène ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.75;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 12000);
camera.position.set(5.6, 1.9, 2.9);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
// On peut regarder vers le plafond (garniture étoilée) ; la caméra reste au-dessus du sol (voir la boucle).
controls.maxPolarAngle = Math.PI - 0.08;
controls.minDistance = 0.2;
controls.maxDistance = 16;

// ---------- Lumières ----------
// `sun` sert de référence (position, couleur, intensité) au décor ; l'éclairage et
// les ombres réels viennent des cascades CSM ci-dessous (ombres nettes près de la
// voiture, étendues à toute la forêt : les arbres projettent sur la route).
const sun = new THREE.DirectionalLight('#fff4e0', 0);
sun.castShadow = false;
scene.add(sun);

const csm = new CSM({
  camera,
  parent: scene,
  cascades: 3,
  maxFar: 70,
  mode: 'practical',
  shadowMapSize: 2048,
  shadowBias: -0.00015,
  lightDirection: new THREE.Vector3(-0.5, -0.6, 0.4).normalize(),
  lightIntensity: 3,
  lightNear: 1,
  lightFar: 400,
  lightMargin: 120,
});
csm.fade = true;
for (const l of csm.lights) { l.shadow.normalBias = 0.03; l.shadow.radius = 3; }

/** Branche les matériaux d'un sous-arbre sur les cascades et active les ombres. */
const csmMaterials = new Set();
function registerShadows(root, { cast = true } = {}) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    o.receiveShadow = true;
    if (cast) o.castShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || csmMaterials.has(m) || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) continue;
      csm.setupMaterial(m);
      csmMaterials.add(m);
    }
  });
}

function syncSunToCsm() {
  const dir = sun.position.clone().negate().normalize();
  csm.lightDirection.copy(dir);
  for (const l of csm.lights) { l.color.copy(sun.color); l.intensity = sun.intensity; }
  csm.updateFrustums();
}
// Lumières d'habitacle pour lire l'aménagement (plafonnier avant et arrière).
const cabin = new THREE.PointLight('#fff1dc', 3, 4.5, 1.8);
cabin.position.set(-0.4, 1.4, 0);
scene.add(cabin);
const cabinRear = new THREE.PointLight('#fff1dc', 2, 4, 1.8);
cabinRear.position.set(-1.5, 1.3, 0);
scene.add(cabinRear);

// ---------- Décor : ciel, montagnes, prairie ----------
const env = buildEnvironment({ scene, renderer, sun, cabin });
const postfx = createPostFX(renderer, scene, camera);
for (const o of [env.terrain, env.meadow, env.conifers, env.broadleaves, env.rocks]) registerShadows(o);
registerShadows(env.grass, { cast: false });

// ---------- Aménagement ----------
const { root: interior, groups } = buildInterior();
scene.add(interior);
registerShadows(interior);

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

let forest = null;
const decorSelect = document.querySelector('[data-option="decor"]');

function applyDecor() {
  const name = decorSelect.value;
  env.setDecor(forest && name === 'forest' ? 'forest' : 'mountains');
  if (forest) forest.root.visible = name === 'forest';
  captureReflections();
}

(async () => {
  try {
    const v = await loadVehicle((e) => {
      if (e.total) loadingPct.textContent = `${Math.round((e.loaded / e.total) * 100)} %`;
    });
    vehicle = v;
    scene.add(v.group);
    registerShadows(v.group);
    for (const [id, node] of Object.entries(v.parts)) openables[id] = node;
    applyVisibility();
    applyExtension();
    v.setPaint(paintInput.value);
    loading.querySelector('p').firstChild.textContent = 'Chargement du décor… ';
    loadingPct.textContent = '';
    try {
      // Module séparé : le décor (10 Mo) est chargé après le véhicule, en chunk distinct.
      const { loadForest } = await import('./forest.js');
      forest = await loadForest((e) => {
        if (e.total) loadingPct.textContent = `${Math.round((e.loaded / e.total) * 100)} %`;
      });
      scene.add(forest.root);
      registerShadows(forest.root);
    } catch (err) {
      console.error('Décor forêt indisponible, repli sur les montagnes', err);
      decorSelect.value = 'mountains';
      decorSelect.disabled = true;
    }
    applyDecor();
    applyPreset();
    loading.classList.add('done');
  } catch (err) {
    loading.querySelector('p').textContent = `Impossible de charger le modèle : ${err.message}`;
    console.error(err);
  }
})();
decorSelect.addEventListener('change', applyDecor);

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

// ---------- Heure, feux, performance ----------
const hourInput = document.querySelector('[data-option="hour"]');
const hourValue = document.getElementById('hour-value');
const lightsBox = document.querySelector('[data-option="lights"]');
const starlightBox = document.querySelector('[data-option="starlight"]');
const qualitySelect = document.querySelector('[data-option="quality"]');

const formatHour = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** Reflets : le décor est capturé sans la voiture ni l'aménagement. */
function captureReflections() {
  const hidden = [interior];
  if (vehicle) hidden.push(vehicle.group);
  env.captureEnvironment(hidden);
}

let captureTimer = null;
function applyHour(hour, { immediateCapture = false } = {}) {
  const p = env.setHour(hour);
  cabinRear.intensity = p.cabin * 0.7;
  syncSunToCsm();
  hourInput.value = hour;
  hourValue.textContent = formatHour(hour);
  lightsBox.checked = p.lightsAuto;
  vehicle?.setLights(lightsBox.checked);
  clearTimeout(captureTimer);
  if (immediateCapture) captureReflections();
  else captureTimer = setTimeout(captureReflections, 250);
}

function applyPreset() {
  applyHour(Number(hourInput.value), { immediateCapture: true });
  vehicle?.setStarlight(starlightBox.checked);
}

hourInput.addEventListener('input', () => applyHour(Number(hourInput.value)));
for (const b of document.querySelectorAll('[data-hour]')) {
  b.addEventListener('click', () => applyHour(Number(b.dataset.hour), { immediateCapture: true }));
}
lightsBox.addEventListener('change', () => vehicle?.setLights(lightsBox.checked));
starlightBox.addEventListener('change', () => vehicle?.setStarlight(starlightBox.checked));

const GTAO_PARAMS = {
  eco: null,
  standard: { radius: 0.5, distanceExponent: 1, thickness: 1, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false },
  ultra: { radius: 0.55, distanceExponent: 1, thickness: 1, scale: 1.2, samples: 24, distanceFallOff: 1, screenSpaceRadius: false },
  photo: { radius: 0.55, distanceExponent: 1, thickness: 1, scale: 1.25, samples: 40, distanceFallOff: 1, screenSpaceRadius: false },
};

function applyQuality(level) {
  const dpr = window.devicePixelRatio || 1;
  const pr = level === 'eco' ? 1 : level === 'ultra' ? Math.min(dpr, 2) : Math.min(dpr, 1.25);
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
  postfx.setQuality(level);
  if (GTAO_PARAMS[level]) postfx.gtao.updateGtaoMaterial(GTAO_PARAMS[level]);
  renderer.shadowMap.type = level === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const shadowSize = level === 'ultra' ? 4096 : level === 'eco' ? 1024 : 2048;
  for (const l of csm.lights) {
    if (l.shadow.mapSize.x !== shadowSize) {
      l.shadow.mapSize.set(shadowSize, shadowSize);
      if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    }
  }
  env.setQuality(level);
}
qualitySelect.addEventListener('change', () => applyQuality(qualitySelect.value));
applyQuality(qualitySelect.value);

// ---------- Mode photo ----------
const photoModal = document.getElementById('photo');
const photoHour = document.getElementById('photo-hour');
const photoHourValue = document.getElementById('photo-hour-value');
const photoRes = document.getElementById('photo-res');
const photoGo = document.getElementById('photo-go');
const photoResult = document.getElementById('photo-result');
const photoImg = document.getElementById('photo-img');
const photoSave = document.getElementById('photo-save');

document.querySelector('[data-action="photo"]').addEventListener('click', () => {
  photoHour.value = hourInput.value;
  photoHourValue.textContent = formatHour(Number(photoHour.value));
  photoResult.classList.add('hidden');
  photoModal.classList.remove('hidden');
});
document.getElementById('photo-close').addEventListener('click', () => photoModal.classList.add('hidden'));
photoHour.addEventListener('input', () => { photoHourValue.textContent = formatHour(Number(photoHour.value)); });
for (const b of document.querySelectorAll('[data-photo-hour]')) {
  b.addEventListener('click', () => { photoHour.value = b.dataset.photoHour; photoHourValue.textContent = formatHour(Number(photoHour.value)); });
}

/** Rend la vue actuelle à la résolution demandée, en qualité maximale, et retourne un PNG. */
async function renderPhoto(width, height, hour) {
  const prevHour = Number(hourInput.value);
  const prevQuality = qualitySelect.value;
  const prevPR = renderer.getPixelRatio();
  const prevAspect = camera.aspect;
  try {
    applyHour(hour, { immediateCapture: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    postfx.setSize(width, height);
    postfx.setQuality('photo');
    postfx.gtao.updateGtaoMaterial(GTAO_PARAMS.photo);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    postfx.render();
    const blob = await new Promise((resolve) => renderer.domElement.toBlob(resolve, 'image/png'));
    return blob;
  } finally {
    renderer.setPixelRatio(prevPR);
    renderer.setSize(window.innerWidth, window.innerHeight);
    postfx.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    applyQuality(prevQuality);
    applyHour(prevHour, { immediateCapture: true });
  }
}

// Dans le visualiseur claude.ai, les téléchargements passent par la capacité « downloads » ;
// ailleurs (site auto-hébergé), le lien de téléchargement classique suffit.
const downloadsPromise = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
let photoBlob = null;
photoSave.addEventListener('click', async (e) => {
  const downloads = await downloadsPromise;
  if (!downloads || !photoBlob) return; // lien classique
  e.preventDefault();
  try {
    await downloads.save({ filename: photoSave.download, data: photoBlob });
  } catch (err) {
    if (err?.code !== 'declined') alert(`Enregistrement impossible : ${err?.message ?? err}`);
  }
});

photoGo.addEventListener('click', async () => {
  const [w, h] = photoRes.value.split('x').map(Number);
  photoGo.classList.add('busy');
  photoGo.textContent = 'Rendu en cours…';
  try {
    const blob = await renderPhoto(w, h, Number(photoHour.value));
    photoBlob = blob;
    if (photoImg.src) URL.revokeObjectURL(photoImg.src);
    const url = URL.createObjectURL(blob);
    photoImg.src = url;
    photoSave.href = url;
    photoSave.download = `touran-camper-${w}x${h}.png`;
    photoResult.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    alert(`La photo n'a pas pu être générée : ${err.message}`);
  } finally {
    photoGo.classList.remove('busy');
    photoGo.textContent = 'Générer la photo';
  }
});

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
// Vues choisies dans les directions dégagées de la forêt (côté passager, axe de la route).
const VIEWS = {
  front: { pos: [5.6, 1.9, 2.9], target: [0, 0.8, 0] },
  rear: { pos: [-5.6, 2.0, 3.2], target: [0, 0.8, 0] },
  side: { pos: [0.3, 1.4, 4.6], target: [0, 0.8, 0] },
  top: { pos: [0.01, 9, 0.01], target: [0, 0.5, 0] },
  tailgate: { pos: [-3.6, 1.45, 0.3], target: [-0.6, 0.8, 0], open: 'tailgate' },
  inside: { pos: [-0.5, 1.3, 0], target: [-3.5, 0.8, 0], open: 'tailgate', firstPerson: true },
  starlight: { pos: [-0.35, 1.05, 0.08], target: [-1.1, 2.4, -0.05], firstPerson: true },
};
let camAnim = null;
let firstPerson = false;

/**
 * Mode « première personne » (allongé dans le lit, ciel étoilé) : on tourne la
 * tête sans déplacer le point de vue. OrbitControls garde une cible à 5 cm devant
 * la caméra ; le glissement est inversé pour sentir « je regarde vers ».
 */
function setFirstPerson(on) {
  firstPerson = on;
  controls.enablePan = !on;
  controls.enableZoom = !on;
  controls.rotateSpeed = on ? -0.35 : 1;
  controls.minDistance = on ? 0.01 : 0.2;
  controls.maxPolarAngle = on ? Math.PI - 0.02 : Math.PI - 0.08;
  if (on) {
    const dir = controls.target.clone().sub(camera.position).normalize();
    controls.target.copy(camera.position).addScaledVector(dir, 0.05);
  }
}

function goToView(name) {
  const v = VIEWS[name];
  if (v.open) setOpen(v.open, true);
  if (firstPerson && !v.firstPerson) setFirstPerson(false);
  camAnim = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: new THREE.Vector3(...v.pos),
    toTarget: new THREE.Vector3(...v.target),
    firstPerson: !!v.firstPerson,
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
    if (camAnim.t >= 1) {
      const fp = camAnim.firstPerson;
      camAnim = null;
      if (fp) setFirstPerson(true);
    }
  }

  env.update(dt);
  vehicle?.update(dt);
  controls.update();
  csm.update();
  if (camera.position.y < 0.12) camera.position.y = 0.12; // jamais sous le sol
  postfx.render();
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

// Accès de débogage (page measure.html et tests).
window.__app = { THREE, scene, renderer, camera, controls, groups, env, postfx, csm, get vehicle() { return vehicle; }, get forest() { return forest; }, setOpen, goToView, applyPreset, applyHour, applyQuality, applyDecor, renderPhoto, lightingForHour };
