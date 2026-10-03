import * as THREE from 'three';
import { ARENA, VEHICLES } from './config';
import { angleDelta, clamp, distance, lerp, segmentBox } from './math';
import { batchStatic, box, buildCar, cylinder, makeSign, material } from './models';
import type { CarModel } from './models';
import type { GameEvent, Quality, VehicleId, World } from './types';

const EMBER = new THREE.Color(0xa24828);

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  smoke: boolean;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(52, 1, 0.1, 600);
  private sun = new THREE.DirectionalLight(0xffdab2, 3.3);
  private cars: CarModel[] = [];
  private carIds: VehicleId[] = [];
  private carCache = new Map<string, CarModel>();
  private showroom = new THREE.Group();
  private previews = new Map<VehicleId, CarModel>();
  private pickupModels: THREE.Group[] = [];
  private barrelModels: THREE.Group[] = [];
  private projectiles: THREE.InstancedMesh;
  private particleMesh: THREE.InstancedMesh;
  private particles: Particle[] = Array.from({ length: 340 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    max: 1,
    size: 1,
    smoke: false,
  }));
  private particleCursor = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private look = new THREE.Vector3();
  // Scratch vectors reused by the chase camera every frame.
  private focus = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  private cameraReady = false;
  private shake = 0;
  private smokeTimer = 0;
  private quality: Quality = 'high';
  private flashUntil = new Map<number, number>();
  private elapsed = 0;
  private burnt = material(0x252821);
  private ambientDust: THREE.Points;

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x3f4c43);
    this.scene.fog = new THREE.FogExp2(0x48564a, 0.007);
    this.scene.add(new THREE.HemisphereLight(0xb9c9bd, 0x514133, 2.15));
    this.sun.position.set(-45, 65, -30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -85,
      right: 85,
      top: 85,
      bottom: -85,
      near: 1,
      far: 190,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.bias = -0.0002;
    this.scene.add(this.sun, this.sun.target);
    this.buildArena(world);
    batchStatic(this.scene, new Set<THREE.Object3D>([...this.pickupModels, ...this.barrelModels]));
    this.scene.add(this.showroom);
    for (const id of Object.keys(VEHICLES) as VehicleId[]) {
      const model = buildCar(VEHICLES[id]);
      model.root.scale.setScalar(1.6);
      model.health.visible = false;
      this.showroom.add(model.root);
      this.previews.set(id, model);
    }
    const platform = cylinder(this.showroom, 0, -0.08, 0, 6.4, 0.16, 0x333d35);
    platform.receiveShadow = true;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6.1, 6.16, 80),
      new THREE.MeshBasicMaterial({ color: 0xb39864, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.showroom.add(ring);
    this.projectiles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      world.projectiles.length,
    );
    this.projectiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.projectiles.frustumCulled = false;
    this.scene.add(this.projectiles);
    this.particleMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
      this.particles.length,
    );
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);
    const dustGeometry = new THREE.BufferGeometry(),
      positions = new Float32Array(300 * 3);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = Math.random() * 180 - 90;
      positions[i + 1] = Math.random() * 20 + 1;
      positions[i + 2] = Math.random() * 180 - 90;
    }
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.ambientDust = new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        color: 0xe8d8b4,
        size: 0.07,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    this.scene.add(this.ambientDust);
    this.reset(world);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildArena(world: World): void {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#555749';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8500; i++) {
      const value = 52 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgba(${value},${value + 3},${value - 4},.4)`;
      ctx.fillRect(
        Math.random() * 256,
        Math.random() * 256,
        1 + Math.random() * 3,
        1 + Math.random() * 3,
      );
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(22, 22);
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const wasteland = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), material(0x655e47));
    wasteland.rotation.x = -Math.PI / 2;
    wasteland.position.y = -0.05;
    this.scene.add(wasteland);
    for (const side of [-1, 1]) {
      box(this.scene, side * (ARENA + 1), 2, 0, 2, 4, 156, 0x65675a);
      box(this.scene, 0, 2, side * (ARENA + 1), 156, 4, 2, 0x65675a);
      for (let p = -72; p <= 72; p += 12) {
        box(this.scene, side * 76, 4.3, p, 0.18, 4.4, 0.18, 0x323d35);
        box(this.scene, p, 4.3, side * 76, 0.18, 4.4, 0.18, 0x323d35);
        box(this.scene, side * 74.9, 1.7, p, 0.07, 0.3, 4, 0xbe964e);
        box(this.scene, p, 1.7, side * 74.9, 4, 0.3, 0.07, 0xbe964e);
      }
      for (const y of [3.5, 5, 6.3]) {
        box(this.scene, side * 76, y, 0, 0.035, 0.035, 152, 0x43483c).castShadow = false;
        box(this.scene, 0, y, side * 76, 152, 0.035, 0.035, 0x43483c).castShadow = false;
      }
    }
    for (let p = -65; p < 70; p += 9)
      for (const side of [-1, 1]) {
        box(this.scene, side * 7, 0.015, p, 0.16, 0.02, 3.7, 0xa89769).castShadow = false;
        box(this.scene, p, 0.015, side * 7, 3.7, 0.02, 0.16, 0xa89769).castShadow = false;
      }
    const arenaCircle = new THREE.Mesh(
      new THREE.RingGeometry(12.8, 13.05, 80),
      new THREE.MeshBasicMaterial({ color: 0xaaa081, side: THREE.DoubleSide }),
    );
    arenaCircle.rotation.x = -Math.PI / 2;
    arenaCircle.position.y = 0.018;
    this.scene.add(arenaCircle);
    for (const obstacle of world.obstacles) {
      const g = new THREE.Group();
      g.position.set(obstacle.x, 0, obstacle.z);
      this.scene.add(g);
      const { w, d, h, color } = obstacle;
      box(g, 0, h / 2, 0, w, h, d, color);
      box(g, 0, h + 0.08, 0, w + 0.25, 0.18, d + 0.25, 0x424c43);
      if (obstacle.kind === 'warehouse') {
        box(g, 0, h * 0.32, d / 2 + 0.06, w * 0.62, h * 0.6, 0.1, 0x333e36);
        for (let y = 1; y < h * 0.6; y += 0.6)
          box(g, 0, y, d / 2 + 0.14, w * 0.62, 0.04, 0.07, 0x626959).castShadow = false;
        for (const x of [-w * 0.36, w * 0.36])
          box(g, x, h * 0.8, d / 2 + 0.09, w * 0.2, 1.2, 0.05, 0x8f9d86);
        const sign = makeSign('SALVAGE / 06', w * 0.65, 2);
        sign.position.set(0, h - 0.8, d / 2 + 0.2);
        g.add(sign);
        for (const x of [-w * 0.27, w * 0.27]) cylinder(g, x, h + 1.3, 0, 1, 2.5, 0x535e50);
      } else {
        for (let z = -d / 2 + 0.5; z < d / 2; z += 1.1)
          for (const side of [-1, 1])
            box(g, side * (w / 2 + 0.03), h / 2, z, 0.1, h * 0.88, 0.1, color).castShadow = false;
        for (let x = -w / 2 + 0.5; x < w / 2; x += 1.1)
          for (const side of [-1, 1])
            box(g, x, h / 2, side * (d / 2 + 0.03), 0.1, h * 0.88, 0.1, color).castShadow = false;
        const sign = makeSign('WY // 018', Math.min(w * 0.8, 5), 1.1, '#cbbfa1', '#364039');
        sign.position.set(0, h * 0.68, d / 2 + 0.12);
        g.add(sign);
      }
    }
    const entrance = makeSign('WELCOME TO THE YARD', 27, 5);
    entrance.position.set(0, 10, -75);
    this.scene.add(entrance);
    for (const x of [-15, 15]) box(this.scene, x, 7, -75, 0.45, 14, 0.45, 0x393f33);
    // Beyond the collision boundary: factory silhouettes, chimneys and salvage cranes.
    for (let i = 0; i < 14; i++) {
      const theta = (i * Math.PI * 2) / 14,
        r = 108 + (i % 3) * 12;
      const x = Math.sin(theta) * r,
        z = Math.cos(theta) * r;
      box(this.scene, x, 8 + (i % 4) * 3, z, 16 + (i % 3) * 7, 16 + (i % 4) * 6, 22, 0x465047);
      if (i % 3 === 0) cylinder(this.scene, x + 5, 24, z, 1.7, 48, 0x535b50);
    }
    for (const side of [-1, 1]) {
      const crane = new THREE.Group();
      crane.position.set(side * 90, 0, -65);
      this.scene.add(crane);
      box(crane, 0, 18, 0, 1.4, 36, 1.4, 0x938365);
      const boom = box(crane, side * -10, 33, 0, 29, 0.8, 1.2, 0x938365);
      boom.rotation.z = side * 0.12;
      box(crane, side * -20, 24, 0, 0.09, 18, 0.09, 0x313b34);
      box(crane, side * -20, 15, 0, 3, 0.6, 2, 0x333d36);
    }
    for (const p of world.pickups) {
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      const c = p.kind === 'repair' ? 0x8ed6ae : 0xf4ba60;
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(1.5, 1.67, 36),
        new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.07;
      g.add(halo);
      const icon = new THREE.Group();
      icon.position.y = 1.5;
      g.add(icon);
      if (p.kind === 'repair') {
        box(icon, 0, 0, 0, 1.2, 0.35, 0.35, c);
        box(icon, 0, 0, 0, 0.35, 1.2, 0.35, c);
      } else {
        const shell = cylinder(icon, 0, 0, 0, 0.26, 1.25, c);
        shell.rotation.z = -0.35;
        box(icon, 0, -0.6, 0, 0.8, 0.15, 0.5, c);
      }
      this.scene.add(g);
      this.pickupModels.push(g);
    }
    for (const b of world.barrels) {
      const g = new THREE.Group();
      g.position.set(b.x, 0, b.z);
      cylinder(g, 0, 0.95, 0, 0.7, 1.9, 0x9c5536);
      for (const y of [0.2, 1, 1.7]) cylinder(g, 0, y, 0, 0.73, 0.1, 0x3d4034);
      box(g, 0, 1.15, 0.71, 0.5, 0.45, 0.035, 0xe1bc68);
      this.scene.add(g);
      this.barrelModels.push(g);
    }
  }

  reset(world: World): void {
    world.vehicles.forEach((car, i) => {
      if (!this.cars[i] || this.carIds[i] !== car.def.id) {
        if (this.cars[i]) this.scene.remove(this.cars[i].root);
        const key = `${i}:${car.def.id}`;
        if (!this.carCache.has(key))
          this.carCache.set(
            key,
            buildCar(
              car.def,
              i === 0 ? car.def.color : [0x799080, 0xa78b62, 0x8a5545, 0x737e83, 0x615d48][i - 1],
            ),
          );
        this.cars[i] = this.carCache.get(key)!;
        this.carIds[i] = car.def.id;
        this.scene.add(this.cars[i].root);
      }
      this.cars[i].root.traverse(object => {
        if (object instanceof THREE.Mesh && object.userData.originalMaterial)
          object.material = object.userData.originalMaterial;
      });
      this.cars[i].root.userData.dead = false;
      this.cars[i].body.rotation.set(0, 0, 0);
      this.cars[i].wheels.forEach(wheel => wheel.rotation.set(0, 0, 0));
      this.cars[i].flames.forEach(flame => (flame.visible = false));
      this.cars[i].flash.visible = false;
    });
    for (const p of this.particles) p.life = 0;
    this.flashUntil.clear();
    this.shake = 0;
    this.smokeTimer = 0;
    this.cameraReady = false;
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(m => (m.needsUpdate = true));
      }
    });
    this.ambientDust.visible = quality === 'high';
    this.resize();
  }

  private resize(): void {
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.quality === 'high' ? 1.5 : 1),
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private particle(x: number, y: number, z: number, power: number, smoke: boolean): void {
    const limit = this.quality === 'high' ? this.particles.length : 110;
    const p = this.particles[this.particleCursor++ % limit];
    const max = smoke ? 1.3 + Math.random() * 0.7 : 0.25 + Math.random() * 0.55;
    Object.assign(p, {
      x,
      y,
      z,
      vx: (Math.random() - 0.5) * power * (smoke ? 1.4 : 14),
      vy: (smoke ? 2 : 3 + Math.random() * 7) * power,
      vz: (Math.random() - 0.5) * power * (smoke ? 1.4 : 14),
      life: max,
      max,
      size: (smoke ? 0.55 : 0.1) * power,
      smoke,
    });
  }

  event(e: GameEvent, world: World): void {
    if (e.type === 'gun') this.flashUntil.set(e.owner ?? -1, this.elapsed + 0.055);
    if (e.type === 'explosion' || e.type === 'hit') {
      const amount = e.type === 'explosion' ? 28 : 5;
      for (let i = 0; i < amount; i++)
        this.particle(e.x, 1.1, e.z, e.power, e.type === 'explosion' && i % 3 === 0);
      this.shake = Math.max(
        this.shake,
        e.power * 0.3 * clamp(1 - distance(e, world.vehicles[0]) / 40, 0, 1),
      );
    }
  }

  render(world: World, alpha: number, dt: number, selected: VehicleId): void {
    this.elapsed += dt;
    const selecting = world.phase === 'selection';
    this.showroom.visible = selecting;
    this.previews.forEach((car, id) => {
      car.root.visible = selected === id;
      car.root.rotation.y = -0.4 + Math.sin(this.elapsed * 0.14) * 0.3;
    });
    this.cars.forEach((model, i) => {
      const car = world.vehicles[i];
      model.root.visible = !selecting;
      const t = world.phase === 'playing' ? alpha : 1;
      model.root.position.set(lerp(car.prevX, car.x, t), 0, lerp(car.prevZ, car.z, t));
      model.root.rotation.y = car.prevHeading + angleDelta(car.prevHeading, car.heading) * t;
      const speed = Math.hypot(car.vx, car.vz);
      model.body.rotation.z = car.dead ? 0.13 : car.control.steer * clamp(speed / 190, 0, 0.1);
      model.body.rotation.x = car.dead ? 0.04 : car.control.throttle * -0.018;
      const signedSpeed = car.vx * Math.sin(car.heading) + car.vz * Math.cos(car.heading);
      if (world.phase === 'playing')
        for (const wheel of model.wheels) wheel.rotation.x += (signedSpeed * dt) / 0.63;
      model.flames.forEach(f => {
        f.visible =
          world.phase === 'playing' &&
          car.control.boost &&
          car.boost > 0 &&
          car.control.throttle > 0 &&
          !car.dead;
        f.scale.y = 0.8 + Math.random() * 0.6;
      });
      model.flash.visible = !car.dead && (this.flashUntil.get(car.id) ?? 0) > this.elapsed;
      model.health.visible = !car.dead && i !== 0;
      model.health.scale.x = (2.5 * car.hp) / car.def.health;
      if (car.dead && !model.root.userData.dead) {
        model.root.userData.dead = true;
        model.root.traverse(object => {
          if (object instanceof THREE.Mesh) {
            object.userData.originalMaterial ??= object.material;
            object.material = this.burnt;
          }
        });
      }
    });
    this.pickupModels.forEach((g, i) => {
      g.visible = !selecting && world.pickups[i].cooldown <= 0;
      g.children[1].rotation.y = this.elapsed * 1.5;
      g.children[1].position.y = 1.5 + Math.sin(this.elapsed * 2 + i) * 0.2;
    });
    this.barrelModels.forEach((g, i) => (g.visible = !selecting && world.barrels[i].alive));
    world.projectiles.forEach((p, i) => {
      this.dummy.position.set(lerp(p.prevX, p.x, alpha), 1.6, lerp(p.prevZ, p.z, alpha));
      this.dummy.rotation.set(0, p.heading, 0);
      this.dummy.scale.setScalar(0);
      if (p.active && !selecting)
        this.dummy.scale.set(
          p.kind === 'rocket' ? 0.22 : 0.07,
          p.kind === 'rocket' ? 0.22 : 0.07,
          p.kind === 'rocket' ? 1.1 : 1.6,
        );
      this.dummy.updateMatrix();
      this.projectiles.setMatrixAt(i, this.dummy.matrix);
      this.projectiles.setColorAt(i, this.color.setHex(p.kind === 'rocket' ? 0xffac59 : 0xffe4a5));
    });
    this.projectiles.instanceMatrix.needsUpdate = true;
    if (this.projectiles.instanceColor) this.projectiles.instanceColor.needsUpdate = true;
    const effectsDt = world.phase === 'paused' ? 0 : dt;
    this.smokeTimer += effectsDt;
    if (this.smokeTimer > 0.08 && !selecting) {
      this.smokeTimer = 0;
      for (const car of world.vehicles)
        if (car.dead || car.hp / car.def.health < 0.4)
          this.particle(car.x, 1.6, car.z, car.dead ? 1.8 : 0.8, true);
      for (const p of world.projectiles)
        if (p.active && p.kind === 'rocket') this.particle(p.x, 1.6, p.z, 0.4, true);
    }
    this.particles.forEach((p, i) => {
      p.life = Math.max(0, p.life - effectsDt);
      this.dummy.rotation.set(0, 0, 0);
      if (p.life > 0) {
        p.x += p.vx * effectsDt;
        p.y += p.vy * effectsDt;
        p.z += p.vz * effectsDt;
        p.vy -= (p.smoke ? -0.5 : 14) * effectsDt;
        const t = 1 - p.life / p.max;
        this.dummy.position.set(p.x, Math.max(0.1, p.y), p.z);
        this.dummy.scale.setScalar(
          p.smoke ? p.size * (1 + t * 2.5) * Math.min(1, p.life * 3) : p.size * (1 - t),
        );
        this.color.setHex(p.smoke ? 0x474b42 : 0xffbd5d);
        if (!p.smoke) this.color.lerp(EMBER, t);
      } else {
        this.dummy.scale.setScalar(0);
        this.color.setHex(0);
      }
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummy.matrix);
      this.particleMesh.setColorAt(i, this.color);
    });
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    this.ambientDust.rotation.y = this.elapsed * 0.002;
    if (selecting) {
      this.camera.position.set(12.5, 7.4, 18);
      this.camera.lookAt(-3.6, 1.5, 0);
      this.camera.fov = window.innerWidth < 900 ? 65 : 48;
      this.cameraReady = false;
    } else {
      const car = world.vehicles[0],
        model = this.cars[0].root;
      const heading = model.rotation.y,
        speed = Math.hypot(car.vx, car.vz);
      const behind = 11.5 + speed * 0.06;
      const focus = this.focus.set(model.position.x, 1.8, model.position.z);
      const desired = this.desired.set(
        focus.x - Math.sin(heading) * behind,
        7 + speed * 0.03,
        focus.z - Math.cos(heading) * behind,
      );
      let fraction = 1;
      for (const obstacle of world.obstacles) {
        const hit = segmentBox(focus, desired, obstacle, 0.7);
        if (hit !== null) fraction = Math.min(fraction, Math.max(0.16, hit - 0.08));
      }
      desired.x = lerp(focus.x, desired.x, fraction);
      desired.z = lerp(focus.z, desired.z, fraction);
      desired.y = fraction < 1 ? Math.max(5, desired.y) : desired.y;
      const lookTarget = this.lookTarget.set(
        focus.x + Math.sin(heading) * 3,
        focus.y,
        focus.z + Math.cos(heading) * 3,
      );
      if (!this.cameraReady) {
        this.camera.position.copy(desired);
        this.look.copy(lookTarget);
        this.cameraReady = true;
      } else {
        this.camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
        this.look.lerp(lookTarget, 1 - Math.exp(-8 * dt));
      }
      // Resolve the smoothed camera as well as its destination, especially at corners.
      for (const obstacle of world.obstacles) {
        const hit = segmentBox(focus, this.camera.position, obstacle, 0.6);
        if (hit !== null) {
          const safe = Math.max(0.05, hit - 0.06);
          this.camera.position.x = lerp(focus.x, this.camera.position.x, safe);
          this.camera.position.z = lerp(focus.z, this.camera.position.z, safe);
        }
      }
      this.shake *= Math.exp(-8 * dt);
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.lookAt(this.look);
      this.camera.fov = lerp(
        this.camera.fov,
        car.control.boost && car.boost > 0 ? 64 : 56,
        1 - Math.exp(-3 * dt),
      );
    }
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
}
