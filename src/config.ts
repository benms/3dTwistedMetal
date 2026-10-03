import type { InputState, Obstacle, VehicleDefinition, VehicleId, WeaponId } from './types';

export const STEP = 1 / 60;
export const ARENA = 76;
export const MAX_ROCKETS = 8;
export const VEHICLES: Record<VehicleId, VehicleDefinition> = {
  viper: {
    id: 'viper',
    name: 'VIPER',
    role: 'INTERCEPTOR',
    description: 'Light on armor. Heavy on attitude. Hit fast, disappear faster.',
    color: 0x8ba792,
    health: 85,
    speed: 33,
    acceleration: 35,
    handling: 2.6,
    mass: 0.85,
    radius: 1.8,
    width: 2.65,
    length: 4.2,
  },
  hellion: {
    id: 'hellion',
    name: 'HELLION',
    role: 'STREET BRAWLER',
    description: 'American muscle. Salvaged steel. Built to settle things the hard way.',
    color: 0xbd653a,
    health: 120,
    speed: 28,
    acceleration: 28,
    handling: 2.15,
    mass: 1.2,
    radius: 2.05,
    width: 2.9,
    length: 4.9,
  },
  goliath: {
    id: 'goliath',
    name: 'GOLIATH',
    role: 'HEAVY ENFORCER',
    description: 'A moving fortress with one rule: everything else moves first.',
    color: 0xc3a566,
    health: 175,
    speed: 23,
    acceleration: 22,
    handling: 1.65,
    mass: 1.85,
    radius: 2.5,
    width: 3.3,
    length: 5.8,
  },
};
export const VEHICLE_IDS: VehicleId[] = ['viper', 'hellion', 'goliath'];
export const WEAPON_ORDER: readonly WeaponId[] = ['bullet', 'rocket'];
export const WEAPON_LABELS: Record<WeaponId, string> = {
  bullet: 'MACHINE GUN',
  rocket: 'HOMING ROCKET',
};
export const emptyInput = (): InputState => ({
  selectedWeapon: 'bullet',
  throttle: 0,
  steer: 0,
  brake: false,
  boost: false,
  gun: false,
  rocket: false,
});
export const WEAPONS = {
  bullet: { speed: 145, damage: 5, cooldown: 0.12, life: 0.8, radius: 0.18 },
  rocket: {
    speed: 52,
    damage: 43,
    cooldown: 0.85,
    life: 3.2,
    radius: 0.45,
    blast: 9,
    turn: 1.65,
    lockRange: 75,
    lockCone: 0.42,
  },
};
/** Seconds after a rival's last hit during which a wreck still counts as their kill. */
export const KILL_CREDIT_WINDOW = 5;
export const OBSTACLES: Obstacle[] = [
  { x: -48, z: -42, w: 24, d: 20, h: 12, kind: 'warehouse', color: 0x45534c },
  { x: 48, z: 42, w: 22, d: 20, h: 10, kind: 'warehouse', color: 0x66594b },
  { x: -25, z: -12, w: 7, d: 23, h: 5.5, kind: 'container', color: 0x9a583c },
  { x: 25, z: 12, w: 7, d: 23, h: 5.5, kind: 'container', color: 0x566e64 },
  { x: 16, z: -38, w: 23, d: 7, h: 5.5, kind: 'container', color: 0x70614b },
  { x: -16, z: 38, w: 23, d: 7, h: 5.5, kind: 'container', color: 0x635d48 },
  { x: -53, z: 16, w: 9, d: 18, h: 3.5, kind: 'container', color: 0x56665e },
  { x: 53, z: -16, w: 9, d: 18, h: 3.5, kind: 'container', color: 0x9a583c },
];
export const SPAWNS = [
  { x: 0, z: 60, heading: Math.PI },
  { x: -60, z: 51, heading: 2.3 },
  { x: -64, z: -64, heading: 0.7 },
  { x: 0, z: -64, heading: 0 },
  { x: 62, z: -53, heading: -0.7 },
  { x: 63, z: 64, heading: -2.5 },
];
