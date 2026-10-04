export type GamePhase = 'selection' | 'playing' | 'paused' | 'over';
export type MatchOutcome = 'victory' | 'defeat';
export type VehicleId = 'viper' | 'hellion' | 'goliath';
export type WeaponId = 'bullet' | 'rocket';
export type Quality = 'high' | 'low';
export interface Vec2 {
  x: number;
  z: number;
}
export interface InputState {
  selectedWeapon: WeaponId;
  throttle: number;
  steer: number;
  brake: boolean;
  boost: boolean;
  gun: boolean;
  rocket: boolean;
}
export interface VehicleDefinition {
  id: VehicleId;
  name: string;
  role: string;
  description: string;
  color: number;
  health: number;
  speed: number;
  acceleration: number;
  handling: number;
  mass: number;
  radius: number;
  width: number;
  length: number;
}
/** One car's seat in a match, in spawn order. */
export interface DriverSpec {
  name: string;
  vehicle: VehicleId;
  human: boolean;
}
export interface Obstacle extends Vec2 {
  w: number;
  d: number;
  h: number;
  kind: 'warehouse' | 'container' | 'wall';
  color: number;
}
export interface BotState {
  target: number;
  path: number[];
  repath: number;
  stuck: number;
  reverse: number;
  lastX: number;
  lastZ: number;
  dodge: number;
}
export interface Vehicle extends Vec2 {
  id: number;
  name: string;
  /** Human cars take their controls from player input; the rest are driven by bots. */
  human: boolean;
  def: VehicleDefinition;
  heading: number;
  prevX: number;
  prevZ: number;
  prevHeading: number;
  vx: number;
  vz: number;
  hp: number;
  boost: number;
  rockets: number;
  gunCooldown: number;
  rocketCooldown: number;
  impactCooldown: number;
  kills: number;
  dead: boolean;
  eliminatedAt: number | null;
  lastAttacker: number;
  lastAttackedAt: number;
  lastHit: number;
  control: InputState;
  bot: BotState;
}
export interface Projectile extends Vec2 {
  active: boolean;
  kind: 'bullet' | 'rocket';
  owner: number;
  heading: number;
  target: number;
  life: number;
  prevX: number;
  prevZ: number;
}
export interface Pickup extends Vec2 {
  kind: 'repair' | 'ammo';
  cooldown: number;
}
export interface Barrel extends Vec2 {
  alive: boolean;
}
export interface GameEvent extends Vec2 {
  type: 'gun' | 'rocket' | 'hit' | 'explosion' | 'pickup' | 'kill';
  power: number;
  owner?: number;
  text?: string;
}
export interface Waypoint extends Vec2 {
  links: number[];
}
export interface World {
  phase: GamePhase;
  /** The sole survivor once the match is over, or null when nobody outlasted the rest. */
  winner: number | null;
  time: number;
  seed: number;
  vehicles: Vehicle[];
  projectiles: Projectile[];
  pickups: Pickup[];
  barrels: Barrel[];
  obstacles: Obstacle[];
  nodes: Waypoint[];
  events: GameEvent[];
}
