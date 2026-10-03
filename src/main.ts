import './style.css';
import './scoreboard.css';
import { GameAudio } from './audio';
import { Keyboard } from './input';
import { GameRenderer } from './rendering';
import { createWorld, FixedStepper, stepWorld } from './simulation';
import { Interface, showFailure } from './ui';
import type { Quality, VehicleId } from './types';

const canvas = document.getElementById('game') as HTMLCanvasElement;
let selected: VehicleId = 'hellion';
let world = createWorld(selected);
const audio = new GameAudio();
const clock = new FixedStepper();
let running = true;
let graphics: GameRenderer;
let ui: Interface;
let keyboard: Keyboard;
let last = performance.now();
let uiTimer = 0;

function readSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`wreckyard:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveSetting(key: string, value: string): void {
  try {
    localStorage.setItem(`wreckyard:${key}`, value);
  } catch {
    /* Storage may be disabled. */
  }
}
function pause(): void {
  if (world.phase !== 'playing') return;
  world.phase = 'paused';
  keyboard.clear();
  clock.reset();
  audio.update(world.vehicles[0], false);
  ui.update(world);
}
function resume(): void {
  if (world.phase !== 'paused') return;
  world.phase = 'playing';
  keyboard.clear();
  clock.reset();
  last = performance.now();
  void audio.unlock();
  ui.update(world);
}
function start(): void {
  void audio.unlock();
  world = createWorld(selected);
  world.phase = 'playing';
  keyboard.reset();
  clock.reset();
  graphics.reset(world);
  ui.reset();
  ui.update(world);
  last = performance.now();
}
function garage(): void {
  world = createWorld(selected);
  keyboard.reset();
  clock.reset();
  graphics.reset(world);
  ui.reset();
  ui.update(world);
  audio.update(world.vehicles[0], false);
}
function mute(): void {
  audio.setMuted(!audio.muted);
  if (!audio.muted) void audio.unlock();
  ui.setMuted(audio.muted);
  saveSetting('muted', String(audio.muted));
}
function quality(q: Quality): void {
  graphics.setQuality(q);
  ui.setQuality(q);
  saveSetting('quality', q);
}

try {
  graphics = new GameRenderer(canvas, world);
  ui = new Interface({
    select: id => {
      selected = id;
    },
    start,
    pause,
    resume,
    garage,
    mute,
    quality,
  });
  keyboard = new Keyboard(
    () => world.phase,
    key => {
      if (key === 'Escape') {
        if (ui.closeManual()) return;
        if (world.phase === 'paused') resume();
        else pause();
      }
      if (ui.isManualOpen() && key !== 'KeyM') return;
      if (key === 'KeyR' && (world.phase === 'victory' || world.phase === 'defeat')) start();
      if (key === 'KeyM') mute();
    },
    pause,
    weapon => {
      // Selection metadata can update immediately without consuming held-fire input.
      world.vehicles[0].control.selectedWeapon = weapon;
      ui.update(world);
      ui.showWeaponSwitch(weapon);
    },
  );
  audio.setMuted(readSetting('muted', 'false') === 'true');
  ui.setMuted(audio.muted);
  quality(readSetting('quality', 'high') === 'low' ? 'low' : 'high');
  ui.update(world);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    pause();
    running = false;
    showFailure(
      'The graphics connection was interrupted. Close other graphics-heavy tabs, then retry. Your browser needs WebGL 2 and hardware acceleration.',
    );
  });
  function frame(now: number): void {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const oldPhase = world.phase;
    const alpha =
      world.phase === 'playing'
        ? clock.advance(dt, () => {
            stepWorld(world, keyboard.read());
            for (const event of world.events) {
              graphics.event(event, world);
              audio.event(event, world.vehicles[0]);
              ui.event(event);
            }
          })
        : 1;
    if (oldPhase !== world.phase) {
      keyboard.clear();
      clock.reset();
    }
    audio.update(world.vehicles[0], world.phase === 'playing');
    graphics.render(world, alpha, dt, selected);
    uiTimer += dt;
    if (uiTimer >= 0.075 || oldPhase !== world.phase) {
      ui.update(world);
      uiTimer = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
} catch (error) {
  running = false;
  console.error('Wreckyard initialization failed:', error);
  showFailure(
    'Wreckyard could not start its 3D engine. Use a current desktop Chrome or Edge browser with WebGL 2 and hardware acceleration enabled. If those are enabled, inspect the browser console for details.',
  );
}
