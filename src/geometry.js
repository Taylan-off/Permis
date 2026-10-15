import * as THREE from 'three';

/**
 * Build a THREE.Shape from a list of segments.
 * A segment is either [x, y] (line to) or { arc: [cx, cy, r, start, end, clockwise] }.
 */
export function shapeFrom(segments, holes = []) {
  const shape = new THREE.Shape();
  applyPath(shape, segments);
  for (const h of holes) {
    const path = new THREE.Path();
    applyPath(path, h);
    shape.holes.push(path);
  }
  return shape;
}

function applyPath(path, segments) {
  let first = true;
  for (const s of segments) {
    if (Array.isArray(s)) {
      if (first) path.moveTo(s[0], s[1]);
      else path.lineTo(s[0], s[1]);
      first = false;
    } else if (s.arc) {
      const [cx, cy, r, a0, a1, cw] = s.arc;
      path.absarc(cx, cy, r, a0, a1, cw);
      first = false;
    }
  }
  path.closePath();
}

/** Extrude a 2D profile (in the X/Y plane) between z0 and z1. */
export function extrude(segments, z0, z1, material, holes = []) {
  const shape = shapeFrom(segments, holes);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: z1 - z0,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geo.translate(0, 0, z0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Axis-aligned box from min/max corners. */
export function box(min, max, material) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const geo = new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Cylinder along the Z axis (handy for wheels). */
export function cylinderZ(radius, length, material, segments = 40) {
  const geo = new THREE.CylinderGeometry(radius, radius, length, segments);
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
