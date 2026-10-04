import './style.css';
import './scoreboard.css';
import './online.css';
import { GameAudio } from './audio';
import { Keyboard } from './input';
import { serverUrl } from './net/endpoint';
import type { ErrorReason } from './net/protocol';
import { NetworkSession } from './net/session';
import { GameRenderer } from './rendering';
import { cameraTarget, createWorld, FixedStepper, stepWorld } from './simulation';
import { Interface, showFailure } from './ui';
import type { GameEvent, Quality, VehicleId, World } from './types';

const canvas = document.getElementById('game') as HTMLCanvasElement;
let selected: VehicleId = 'hellion';
let world = createWorld(selected);
/** Your car in `world`: seat 0 offline, the server-assigned seat online. */
let localId = 0;
const audio = new GameAudio();
const clock = new FixedStepper();
const endpoint = serverUrl();
let running = true;
let graphics: GameRenderer;
let ui: Interface;
let keyboard: Keyboard;
let last = performance.now();
let uiTimer = 0;
let statusTimer = 0;
/** Offline practice: you alone in the yard, no bots. Replays keep the mode. */
let practice = false;
/** Online only: the match keeps running behind this menu. */
let menuOpen = false;
let net: NetworkSession | null = null;
/** Bumped on every connect or leave so callbacks from an abandoned session are ignored. */
let attempt = 0;

const ERROR_TEXT: Record<ErrorReason, string> = {
  'bad-request': 'The server could not understand this client. Reload the page and try again.',
  version: 'This page is out of date for the server. Reload to get the latest version.',
  'room-not-found': 'No room has that code. Check it with the host.',
  'room-full': 'That room already has six drivers.',
  'match-in-progress': 'That room is mid-match. Join after the round ends.',
  'server-full': 'The server is at capacity. Try again in a few minutes.',
  'not-host': 'Only the host can start the match.',
  'rate-limit': 'Too many messages were sent too quickly, so the server disconnected you.',
  'server-restarting': 'The server is restarting. Your match ended; you are back in the garage.',
};

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

/** Switch to another world: an offline match, an online match or the garage backdrop. */
function show(next: World, id: number): void {
  world = next;
  localId = id;
  menuOpen = false;
  ui.setMenuOpen(false);
  keyboard.reset();
  clock.reset();
  graphics.reset(world, localId);
  ui.reset();
  ui.update(world, localId);
  last = performance.now();
}

function pause(): void {
  if (net) {
    if (world.phase !== 'playing' || menuOpen) return;
    menuOpen = true;
    keyboard.clear();
    ui.setMenuOpen(true);
    return;
  }
  if (world.phase !== 'playing') return;
  world.phase = 'paused';
  keyboard.clear();
  clock.reset();
  audio.update(world.vehicles[localId], false);
  ui.update(world, localId);
}
function resume(): void {
  if (net) {
    if (!menuOpen) return;
    menuOpen = false;
    keyboard.clear();
    ui.setMenuOpen(false);
    void audio.unlock();
    return;
  }
  if (world.phase !== 'paused') return;
  world.phase = 'playing';
  keyboard.clear();
  clock.reset();
  last = performance.now();
  void audio.unlock();
  ui.update(world, localId);
}
/** Replay action: start offline again, start the room as host, or go back to the lobby. */
function launch(): void {
  void audio.unlock();
  if (net) {
    if (world.phase === 'over') garage();
    else if (world.phase === 'selection') net.start();
    return;
  }
  const next = createWorld(selected, undefined, practice ? 0 : undefined);
  next.phase = 'playing';
  show(next, 0);
}
function start(): void {
  practice = false;
  launch();
}
function startPractice(): void {
  practice = true;
  launch();
}
/** The garage; online it also shows your room's lobby. */
function garage(): void {
  show(createWorld(selected), 0);
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
function dispatch(event: GameEvent): void {
  graphics.event(event, world);
  audio.event(event, cameraTarget(world, localId));
  ui.event(event, localId);
}

function leaveOnline(): void {
  attempt++;
  net?.leave();
  net = null;
  ui.setLobby(null);
  ui.setOnline(false);
  ui.setNetStatus(null);
  ui.showOnline(false);
  if (world.phase !== 'selection') garage();
}

function connect(enter: (session: NetworkSession) => Promise<void>, name: string): void {
  if (!endpoint) return;
  saveSetting('callsign', name);
  net?.leave();
  const current = ++attempt;
  const live = () => current === attempt;
  const session = new NetworkSession(endpoint, {
    status: status => {
      if (!live()) return;
      if (status === 'connecting') ui.setOnlineMessage('Connecting…', true);
      if (status === 'waking')
        ui.setOnlineMessage('Waking the server… a sleeping host can take up to a minute.', true);
    },
    lobby: lobby => {
      if (!live()) return;
      ui.showOnline(false);
      ui.setLobby(lobby);
    },
    start: (next, id) => {
      if (live()) show(next, id);
    },
    event: dispatch,
    error: reason => {
      if (live() && ui.isOnlineOpen()) ui.setOnlineMessage(ERROR_TEXT[reason]);
    },
    disconnected: reason => {
      if (!live()) return;
      leaveOnline();
      ui.showNetError(
        reason === 'server-restarting' ? 'SERVER RESTARTING.' : 'CONNECTION LOST.',
        reason
          ? ERROR_TEXT[reason]
          : 'The connection to the game server dropped. Create or join a room to play again.',
      );
    },
  });
  net = session;
  ui.setOnline(true);
  enter(session).catch(() => {
    if (!live()) return;
    net = null;
    ui.setOnline(false);
    ui.setOnlineMessage('Could not reach the game server. Check your connection and try again.');
  });
}

try {
  graphics = new GameRenderer(canvas, world);
  ui = new Interface({
    select: id => {
      selected = id;
      net?.select(id);
    },
    start,
    replay: launch,
    practice: startPractice,
    pause,
    resume,
    // Online, leaving a match or the results screen also leaves the room.
    garage: () => (net && world.phase !== 'selection' ? leaveOnline() : garage()),
    mute,
    quality,
    openOnline: () => ui.showOnline(true, readSetting('callsign', '')),
    createRoom: name => connect(session => session.create(name, selected), name),
    joinRoom: (code, name) => connect(session => session.join(code, name, selected), name),
    leaveRoom: leaveOnline,
    setBots: count => net?.setBots(count),
    copyCode: () => {
      const code = net?.lobby?.code;
      if (code) void navigator.clipboard?.writeText(code).catch(() => {});
    },
  });
  ui.setOnlineAvailable(endpoint !== null);
  // Development builds expose live state for debugging netcode from the console.
  if (import.meta.env.DEV)
    Object.assign(window, {
      wreckyard: {
        get world() {
          return world;
        },
        get net() {
          return net;
        },
      },
    });
  keyboard = new Keyboard(
    () => (menuOpen ? 'paused' : world.phase),
    key => {
      if (key === 'Escape') {
        if (ui.closeManual() || ui.isOnlineOpen()) return;
        if (world.phase === 'paused' || menuOpen) resume();
        else pause();
      }
      if (ui.isManualOpen() && key !== 'KeyM') return;
      if (key === 'KeyR' && world.phase === 'over') launch();
      if (key === 'KeyM') mute();
    },
    pause,
    weapon => {
      // Selection metadata can update immediately without consuming held-fire input.
      world.vehicles[localId].control.selectedWeapon = weapon;
      ui.update(world, localId);
      ui.showWeaponSwitch(weapon);
    },
  );
  audio.setMuted(readSetting('muted', 'false') === 'true');
  ui.setMuted(audio.muted);
  quality(readSetting('quality', 'high') === 'low' ? 'low' : 'high');
  ui.update(world, localId);
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
    let alpha = 1;
    if (net && net.world === world) net.frame(dt, () => keyboard.read());
    else if (world.phase === 'playing')
      alpha = clock.advance(dt, () => {
        stepWorld(world, { [localId]: keyboard.read() });
        for (const event of world.events) dispatch(event);
      });
    if (oldPhase !== world.phase) {
      keyboard.clear();
      clock.reset();
      menuOpen = false;
      ui.setMenuOpen(false);
    }
    audio.update(world.vehicles[localId], world.phase === 'playing');
    graphics.render(world, alpha, dt, selected);
    uiTimer += dt;
    if (uiTimer >= 0.075 || oldPhase !== world.phase) {
      ui.update(world, localId);
      uiTimer = 0;
    }
    statusTimer += dt;
    if (net?.connected && statusTimer >= 0.5) {
      statusTimer = 0;
      const room = net.lobby ? ` · ROOM ${net.lobby.code}` : '';
      const ping = net.rtt ? ` · ${Math.round(net.rtt)} MS` : '';
      ui.setNetStatus(`ONLINE${room}${ping}`);
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
