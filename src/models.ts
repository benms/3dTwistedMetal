import * as THREE from 'three';
import type { VehicleDefinition } from './types';

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 12);
const flashGeometry = new THREE.OctahedronGeometry(0.45);
const flameGeometry = new THREE.ConeGeometry(0.18, 1.3, 7);
const basicMaterials = new Map<number, THREE.MeshBasicMaterial>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
function basic(color: number): THREE.MeshBasicMaterial {
  if (!basicMaterials.has(color)) basicMaterials.set(color, new THREE.MeshBasicMaterial({ color }));
  return basicMaterials.get(color)!;
}

/** Batch static meshes by geometry/material; preserve explicitly animated subtrees. */
export function batchStatic(root: THREE.Object3D, excluded = new Set<THREE.Object3D>()): void {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse(object => {
    if (
      !(object instanceof THREE.Mesh) ||
      object instanceof THREE.InstancedMesh ||
      Array.isArray(object.material)
    )
      return;
    for (
      let parent: THREE.Object3D | null = object;
      parent && parent !== root;
      parent = parent.parent
    )
      if (excluded.has(parent)) return;
    const key = `${object.geometry.uuid}:${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(object);
  });
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0],
      batch = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    meshes.forEach((mesh, i) => {
      batch.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
      mesh.removeFromParent();
    });
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingSphere();
    root.add(batch);
  }
}
export function material(
  color: number,
  metalness = 0.35,
  roughness = 0.8,
): THREE.MeshStandardMaterial {
  const key = `${color}:${metalness}:${roughness}`;
  if (!materials.has(key))
    materials.set(key, new THREE.MeshStandardMaterial({ color, metalness, roughness }));
  return materials.get(key)!;
}
export function box(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: number,
  metalness = 0.35,
): THREE.Mesh {
  const mesh = new THREE.Mesh(boxGeometry, material(color, metalness));
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function cylinder(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  color: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(cylinderGeometry, material(color));
  mesh.position.set(x, y, z);
  mesh.scale.set(radius, height, radius);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function rod(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  width: number,
  color: number,
): void {
  const direction = b.clone().sub(a);
  const mesh = box(parent, 0, 0, 0, width, direction.length(), width, color);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}
export interface CarModel {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Group[];
  flames: THREE.Mesh[];
  flash: THREE.Mesh;
  health: THREE.Mesh;
}

export function buildCar(def: VehicleDefinition, color = def.color): CarModel {
  const root = new THREE.Group(),
    body = new THREE.Group();
  root.add(body);
  const w = def.width,
    l = def.length,
    armor = 0x323b37,
    dark = 0x141d1d,
    metal = 0x798178;
  const wheels: THREE.Group[] = [],
    flames: THREE.Mesh[] = [];
  const heavy = def.id === 'goliath',
    buggy = def.id === 'viper';
  box(body, 0, 0.72, 0, w * 0.75, 0.28, l * 0.9, dark);
  box(body, 0, 1.12, 0, w * 0.87, heavy ? 0.7 : 0.55, l * 0.91, color);
  if (heavy) {
    box(body, 0, 1.88, 0.75, w * 0.83, 1.05, l * 0.35, color);
    box(body, 0, 2.46, 0.72, w * 0.9, 0.16, l * 0.4, armor);
    box(body, 0, 2.05, 1.83, w * 0.68, 0.44, 0.06, dark);
    box(body, 0, 1.75, -1.45, w * 0.88, 0.6, l * 0.36, armor);
    for (const side of [-1, 1]) cylinder(body, side * w * 0.36, 2.16, -0.45, 0.12, 1.9, metal);
  } else if (buggy) {
    box(body, 0, 1.25, -0.3, w * 0.56, 0.32, l * 0.42, dark);
    box(body, 0, 1.8, -0.5, w * 0.7, 0.12, l * 0.3, armor);
    for (const side of [-1, 1]) {
      rod(
        body,
        new THREE.Vector3(side * w * 0.32, 1.16, 0.8),
        new THREE.Vector3(side * w * 0.3, 1.82, -0.1),
        0.1,
        metal,
      );
      rod(
        body,
        new THREE.Vector3(side * w * 0.3, 1.82, -0.9),
        new THREE.Vector3(side * w * 0.4, 1.1, -1.5),
        0.1,
        metal,
      );
    }
    box(body, 0, 1.8, -l * 0.47, w * 1.07, 0.13, 0.44, color);
  } else {
    const cabin = box(body, 0, 1.69, -0.27, w * 0.71, 0.6, l * 0.42, dark);
    cabin.rotation.x = -0.035;
    box(body, 0, 2.02, -0.4, w * 0.72, 0.13, l * 0.32, color);
    box(body, 0, 1.77, 0.81, w * 0.73, 0.08, 0.09, metal);
    for (const side of [-1, 1]) {
      const sidePlate = box(body, side * w * 0.44, 1.28, -0.25, 0.09, 0.45, 1.25, armor);
      sidePlate.rotation.z = side * 0.12;
      rod(
        body,
        new THREE.Vector3(side * w * 0.37, 1.48, 0.78),
        new THREE.Vector3(side * w * 0.34, 2.01, 0.35),
        0.12,
        color,
      );
    }
    box(body, 0, 1.58, 1.1, 0.65, 0.21, 0.8, armor);
    for (let i = -1; i <= 1; i++) box(body, i * 0.18, 1.7, 1.1, 0.07, 0.03, 0.53, metal);
  }
  // Salvaged bumper, radiator, and paired roof-mounted machine guns.
  box(body, 0, 0.98, l * 0.49, w * 1.05, 0.38, 0.27, armor);
  box(body, 0, 1.18, l * 0.46, w * 0.55, 0.24, 0.09, dark);
  for (let i = -3; i <= 3; i++) box(body, i * w * 0.067, 1.18, l * 0.475, 0.04, 0.23, 0.035, metal);
  const gunY = heavy ? 2.6 : buggy ? 1.97 : 2.15;
  for (const side of [-1, 1]) {
    box(body, side * 0.5, gunY, 0.1, 0.22, 0.24, 0.6, armor);
    box(body, side * 0.5, gunY, 0.75, 0.12, 0.12, 1.1, dark);
    const headlight = box(body, side * w * 0.32, 1.3, l * 0.472, 0.38, 0.19, 0.035, 0xf5dbaa);
    headlight.material = basic(0xffe1a0);
    const tail = box(body, side * w * 0.32, 1.25, -l * 0.462, 0.3, 0.15, 0.035, 0xb34427);
    tail.material = basic(0xce4526);
    const exhaust = cylinder(body, side * w * 0.25, 0.85, -l * 0.5, 0.14, 0.5, armor);
    exhaust.rotation.x = Math.PI / 2;
    const flame = new THREE.Mesh(flameGeometry, basic(0x84d7ff));
    flame.position.set(side * w * 0.25, 0.85, -l * 0.65);
    flame.rotation.x = -Math.PI / 2;
    flame.visible = false;
    body.add(flame);
    flames.push(flame);
  }
  const axleZ = heavy ? [-l * 0.34, -l * 0.08, l * 0.33] : [-l * 0.31, l * 0.31];
  for (const side of [-1, 1])
    for (const z of axleZ) {
      const wheel = new THREE.Group();
      wheel.position.set(side * w * 0.48, 0.65, z);
      const tire = cylinder(wheel, 0, 0, 0, heavy ? 0.73 : 0.63, 0.44, 0x111514);
      tire.rotation.z = Math.PI / 2;
      const hub = cylinder(wheel, side * 0.24, 0, 0, 0.3, 0.04, metal);
      hub.rotation.z = Math.PI / 2;
      for (let i = 0; i < 6; i++) {
        const tread = box(
          wheel,
          0,
          Math.sin((i * Math.PI) / 3) * 0.57,
          Math.cos((i * Math.PI) / 3) * 0.57,
          0.47,
          0.11,
          0.18,
          0x242a25,
        );
        tread.rotation.x = (-i * Math.PI) / 3;
      }
      batchStatic(wheel);
      root.add(wheel);
      wheels.push(wheel);
    }
  const flash = new THREE.Mesh(flashGeometry, basic(0xffd578));
  flash.position.set(0, gunY, 1.6);
  flash.scale.set(1.5, 0.5, 2);
  flash.visible = false;
  body.add(flash);
  const health = new THREE.Mesh(
    boxGeometry,
    new THREE.MeshBasicMaterial({ color: 0xe98458, transparent: true, opacity: 0.85 }),
  );
  health.position.set(0, heavy ? 3.7 : 3, 0);
  health.scale.set(2.5, 0.09, 0.08);
  root.add(health);
  batchStatic(body, new Set<THREE.Object3D>([flash, ...flames]));
  return { root, body, wheels, flames, flash, health };
}

export function makeSign(
  text: string,
  width: number,
  height: number,
  color = '#e7d6b7',
  background = '#24342e',
): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.strokeRect(12, 12, 1000, 232);
  ctx.fillStyle = color;
  ctx.font = 'bold 130px Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 140, 960);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, side: THREE.DoubleSide }),
  );
}
