import { ARENA, VEHICLES, VEHICLE_IDS, WEAPON_LABELS, WEAPON_ORDER } from './config';
import { cameraTarget, isPractice, outcomeFor, rocketTarget } from './simulation';
import type { LobbyState } from './net/protocol';
import type {
  GameEvent,
  GamePhase,
  MatchOutcome,
  Quality,
  VehicleId,
  WeaponId,
  World,
} from './types';
import { WeaponSwitchNotice, WEAPON_NOTICE_FADE_MS } from './weapon-notification';
import { buildScoreboard } from './scoreboard';

interface Actions {
  select: (id: VehicleId) => void;
  start: () => void;
  /** Results "run it back": same mode as the match that just ended. */
  replay: () => void;
  /** Offline free roam with no bots. */
  practice: () => void;
  pause: () => void;
  resume: () => void;
  garage: () => void;
  mute: () => void;
  quality: (q: Quality) => void;
  openOnline: () => void;
  createRoom: (name: string) => void;
  joinRoom: (code: string, name: string) => void;
  /** Leave the room, or cancel a connection attempt that is still in progress. */
  leaveRoom: () => void;
  copyCode: () => void;
  setBots: (count: number) => void;
}
const silhouettes: Record<VehicleId, string> = {
  viper:
    '<path d="m19 35 18-5 16-17h27l19 20 21 3v14H14V39zm29-6h35L73 18H58z"/><path d="M91 23h26v5H91z"/>',
  hellion:
    '<path d="m12 35 25-5 17-15h36l16 15 24 5v15H10zm36-7h44L84 19H59z"/><path d="M13 32h27v5H13z"/>',
  goliath:
    '<path d="M13 27h58V12h30l18 20h12v22H10zm68-8v14h28L98 19z"/><path d="M16 19h50v5H16z"/>',
};
const carSvg = (id: VehicleId) =>
  `<svg viewBox="0 0 144 68" aria-hidden="true">${silhouettes[id]}<circle cx="35" cy="50" r="12"/><circle cx="108" cy="50" r="12"/><circle class="hub" cx="35" cy="50" r="5"/><circle class="hub" cx="108" cy="50" r="5"/></svg>`;
// Garage stat bars are relative to the best vehicle in each category.
const statMax = (stat: 'health' | 'speed' | 'handling') =>
  Math.max(...VEHICLE_IDS.map(id => VEHICLES[id][stat]));
const STAT_MAX = {
  health: statMax('health'),
  speed: statMax('speed'),
  handling: statMax('handling'),
};
const timeText = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;

export class Interface {
  private root: HTMLElement;
  private phase?: GamePhase;
  private selected: VehicleId = 'hellion';
  private refs = new Map<string, HTMLElement>();
  private messages: { text: string; expires: number; player: boolean }[] = [];
  private radar: CanvasRenderingContext2D;
  private weaponNotice: WeaponSwitchNotice;
  private lobby: LobbyState | null = null;
  private online = false;
  private onlineAvailable = true;
  private menuOpen = false;

  constructor(actions: Actions) {
    this.root = document.getElementById('app')!;
    this.root.innerHTML = `
      <div class="vignette" aria-hidden="true"></div>
      <header class="topbar">
        <a class="brand" href="#" id="brand" aria-label="Wreckyard — open pause menu during battle"><span class="brand-mark">W</span><span>WRECKYARD<small>VEHICULAR WARFARE</small></span></a>
        <div class="top-actions"><span id="net-status" class="offline"><i></i> LOCAL // OFFLINE</span><button id="help-button" class="text-button">FIELD MANUAL <span>↗</span></button><button id="mute" class="icon-button" aria-label="Mute sound" title="Toggle sound (M)">SOUND ON</button><label class="quality-label">FX <select id="quality" aria-label="Graphics quality"><option value="high">HIGH</option><option value="low">LOW</option></select></label></div>
      </header>
      <main id="selection" class="garage">
        <section class="hero-copy"><div class="eyebrow"><span class="live-dot"></span> THE ARENA IS OPEN <span class="line"></span> VOL. 01</div>
          <h1>LAST CAR.<br><span>STILL STANDING.</span></h1>
          <p>Six drivers. One scrapyard.<br>Leave your conscience at the gate.</p>
          <div class="match-tags"><span>01 ARENA</span><b>×</b><span>05 RIVALS</span><b>×</b><span>NO RESPAWNS</span></div>
        </section>
        <section id="lobby" class="lobby-panel" hidden aria-labelledby="lobby-code-label">
          <div class="eyebrow"><span class="live-dot"></span> <span id="lobby-code-label">ONLINE ROOM / SHARE THIS CODE</span></div>
          <div class="lobby-code-row"><strong id="lobby-code">----</strong><button id="copy-code" class="text-button">COPY CODE</button></div>
          <p>Up to six cars. The host chooses how many bots join, then starts the match.</p>
          <ol id="lobby-players" class="lobby-players" aria-label="Drivers in this room"></ol>
          <div id="bot-controls" class="bot-controls"><span>BOTS <strong id="bot-count">5</strong></span><button id="remove-bot" class="text-button" aria-label="Remove a bot">− REMOVE BOT</button><button id="add-bot" class="text-button" aria-label="Add a bot">+ ADD BOT</button></div>
        </section>
        <aside class="vehicle-caption"><span class="eyebrow">YOUR INSTRUMENT OF DESTRUCTION</span><div><span id="preview-name">HELLION</span><small id="preview-role">STREET BRAWLER</small></div><p id="preview-description"></p></aside>
        <section class="loadout"><div class="section-label"><span><b>01</b> CHOOSE YOUR MACHINE</span><span class="desktop-tag">KEYBOARD REQUIRED</span></div>
          <div class="loadout-row"><div class="vehicle-cards">${VEHICLE_IDS.map((id, i) => {
            const car = VEHICLES[id];
            return `<button class="vehicle-card ${id === 'hellion' ? 'selected' : ''}" data-vehicle="${id}" aria-pressed="${id === 'hellion'}"><div class="card-top"><span>0${i + 1} / ${car.role}</span><i class="selection-dot"></i></div><div class="card-name">${car.name}${carSvg(id)}</div><div class="card-stats"><label>ARMOR <span><i style="width:${(car.health / STAT_MAX.health) * 100}%"></i></span></label><label>SPEED <span><i style="width:${(car.speed / STAT_MAX.speed) * 100}%"></i></span></label><label>HANDLING <span><i style="width:${(car.handling / STAT_MAX.handling) * 100}%"></i></span></label></div></button>`;
          }).join('')}</div>
          <div class="launch-card"><div><span class="eyebrow">NEXT STOP</span><h2>THE SCRAPYARD</h2><p id="launch-detail">Industrial district · Last car standing</p></div><button id="start" class="primary">ENTER THE YARD <span>↗</span></button><button id="online-button" class="secondary online-button">PLAY ONLINE</button><button id="practice-button" class="text-button practice-button" title="Drive the yard alone: no bots, no time limit">PRACTICE · NO BOTS</button><small id="launch-note">GUNS LOADED. NO SECOND CHANCES.</small></div></div>
        </section>
        <footer class="garage-footer"><span>BUILT FROM SCRAP. DRIVEN BY SPITE.</span><span>WASD TO DRIVE <b>·</b> LEFT CLICK TO FIRE <b>·</b> TAB TO SWITCH</span><span>34° 06′ N / YARD 06</span></footer>
      </main>
      <section id="hud" class="hud" hidden aria-label="Battle status">
        <div class="zone-label"><span id="zone-mode" class="eyebrow">DEATHMATCH / ZONE 06</span><strong>THE SCRAPYARD</strong><span id="match-time">00:00</span></div>
        <div class="survivors"><span class="eyebrow">STILL STANDING</span><strong id="remaining">06</strong><div id="driver-dots"></div></div>
        <div class="radar-wrap"><div class="radar-heading">PROXIMITY SCAN <span>N ↑</span></div><canvas id="radar" width="180" height="180" aria-label="Arena radar: green is you, orange marks enemies"></canvas><div class="radar-legend"><span>● YOU</span><span>● HOSTILE</span></div></div>
        <div id="feed" class="kill-feed" aria-live="polite"></div>
        <div id="spectate" class="spectate-label" role="status" hidden></div><div class="reticle" aria-hidden="true"><span></span><i></i><b></b></div><div id="lock-label" class="lock-label"></div>
        <div id="weapon-switch" class="weapon-switch" role="status" aria-live="polite" aria-atomic="true" hidden></div>
        <div class="status-panel"><div class="status-name"><span id="hud-car">HELLION</span><span id="kills">0 WRECKS</span></div><div class="armor-line"><span>ARMOR INTEGRITY</span><strong id="hp-number">120</strong></div><div id="hp-meter" class="meter health" role="progressbar" aria-label="Armor" aria-valuemin="0" aria-valuemax="100"><i id="hp-fill"></i></div><div class="boost-line"><span>BOOST <kbd>SHIFT</kbd></span><div id="boost-meter" class="meter boost" role="progressbar" aria-label="Boost" aria-valuemin="0" aria-valuemax="100"><i id="boost-fill"></i></div></div><div class="speed"><strong id="speed">000</strong><span>KM/H</span><small id="drive-status">IDLE</small></div></div>
        <div class="weapons-panel"><div id="weapon-bullet" class="weapon is-selected" role="group" aria-label="Machine gun selected; press 1"><kbd>1</kbd><span>MACHINE GUN<small>LMB / J · HOLD TO FIRE</small></span><strong>∞</strong></div><div id="weapon-rocket" class="weapon rocket" role="group" aria-label="Homing rocket; press 2"><kbd>2</kbd><span>HOMING ROCKET<small id="rocket-status">LMB / K · FIRE</small></span><strong id="rockets">04</strong></div></div>
        <div class="bottom-controls"><span><kbd>W A S D</kbd> DRIVE</span><span><kbd>SPACE</kbd> DRIFT</span><span><kbd>LMB</kbd> FIRE</span><span><kbd>TAB</kbd> WEAPON</span><button id="pause-button"><kbd>ESC</kbd> PAUSE</button></div><div id="damage-flash" class="damage-flash"></div>
      </section>
      <section id="pause" class="modal-backdrop" hidden><div class="modal"><div id="pause-eyebrow" class="eyebrow">TAKE A BREATH</div><h2 id="pause-title">ENGINE IDLE.</h2><p id="pause-text">The yard can wait. Your rivals are paused too.</p><button id="resume" class="primary">BACK TO THE FIGHT <span>↗</span></button><button id="pause-garage" class="secondary">RETURN TO GARAGE</button></div></section>
      <section id="online" class="modal-backdrop" hidden><div class="modal online-modal" role="dialog" aria-modal="true" aria-labelledby="online-title"><div class="eyebrow">WRECKYARD / ONLINE</div><h2 id="online-title">FIND A YARD.</h2><p>Create a room and share its four-letter code, or join a friend's room. Bots fill any empty seats.</p>
        <label class="field" for="callsign">CALLSIGN</label><input id="callsign" class="text-field" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="DRIVER">
        <button id="create-room" class="primary">CREATE ROOM <span>↗</span></button>
        <div class="join-row"><div><label class="field" for="room-code">ROOM CODE</label><input id="room-code" class="text-field code-field" maxlength="4" autocomplete="off" spellcheck="false" placeholder="ABCD"></div><button id="join-room" class="secondary">JOIN ROOM</button></div>
        <p id="online-message" class="online-message" role="status" aria-live="polite"></p>
        <button id="online-close" class="secondary">BACK TO GARAGE</button></div></section>
      <section id="net-error" class="modal-backdrop" hidden><div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="net-error-title" aria-describedby="net-error-text"><div class="eyebrow">WRECKYARD / CONNECTION</div><h2 id="net-error-title">CONNECTION LOST.</h2><p id="net-error-text"></p><button id="net-error-close" class="primary">BACK TO GARAGE <span>↗</span></button></div></section>
      <section id="results" class="modal-backdrop" hidden><div class="modal results-modal"><div id="result-eyebrow" class="eyebrow">MATCH COMPLETE</div><h2 id="result-title">YARD KING.</h2><p id="result-description"></p><div class="result-stats"><div><strong id="result-kills">0</strong><span>WRECKS</span></div><div><strong id="result-time">00:00</strong><span>SURVIVED</span></div><div><strong id="result-car">HELLION</strong><span>YOUR MACHINE</span></div></div>
        <section class="scoreboard" aria-labelledby="scoreboard-heading"><div class="scoreboard-heading"><h3 id="scoreboard-heading">MATCH SCOREBOARD</h3><span id="scoreboard-count">06 DRIVERS</span></div><div class="scoreboard-scroll"><table class="scoreboard-table" aria-labelledby="scoreboard-heading" aria-describedby="scoreboard-note"><thead><tr><th scope="col">#</th><th scope="col">DRIVER / MACHINE</th><th scope="col">WRECKS</th><th scope="col">SURVIVED</th><th scope="col">STATUS</th></tr></thead><tbody id="scoreboard-body"></tbody></table></div><p id="scoreboard-note" class="scoreboard-note">Snapshot at match end. Survivors first, then wrecks and survival time.</p></section>
        <button id="replay" class="primary">RUN IT BACK <span>R ↗</span></button><button id="results-garage" class="secondary">CHOOSE ANOTHER MACHINE</button></div></section>
      <dialog id="manual" class="manual"><button id="close-help" class="close-help" aria-label="Close field manual">×</button><span class="eyebrow">WRECKYARD / FIELD MANUAL</span><h2>SURVIVE THE SIX.</h2><p>Destroy the other five cars. There are no respawns. Bots fight each other too, so pick your battles.</p><div class="manual-controls"><div><kbd>W / S</kbd><span>Accelerate / reverse</span></div><div><kbd>A / D</kbd><span>Steer · Arrow keys also work</span></div><div><kbd>SPACE</kbd><span>Handbrake and drift</span></div><div><kbd>SHIFT</kbd><span>Boost · recharges when released</span></div><div><kbd>LMB</kbd><span>Hold left mouse button to fire the selected weapon</span></div><div><kbd>TAB</kbd><span>Cycle weapons · highlighted in the HUD</span></div><div><kbd>1 / 2</kbd><span>Select machine gun / homing rockets · numpad also works</span></div><div><kbd>J</kbd><span>Quick-fire machine guns · unlimited ammo</span></div><div><kbd>K</kbd><span>Quick-fire homing rockets · limited ammo</span></div><div><kbd>ESC</kbd><span>Pause or resume</span></div><div><kbd>M</kbd><span>Toggle sound</span></div></div><p class="manual-tip">Weapons fire forward. Point your car at an enemy to acquire a rocket lock. Holding fire repeats shots at the weapon's firing rate; rockets consume ammunition. Cover blocks shots. Green crosses repair armor; amber shells restock rockets. Red barrels explode.</p></dialog>
    `;
    this.root.querySelectorAll<HTMLElement>('[id]').forEach(el => this.refs.set(el.id, el));
    const weaponPopup = this.el('weapon-switch');
    weaponPopup.style.setProperty('--weapon-notice-fade', `${WEAPON_NOTICE_FADE_MS}ms`);
    this.weaponNotice = new WeaponSwitchNotice(state => {
      weaponPopup.hidden = state === null;
      weaponPopup.classList.toggle('is-fading', state?.fading ?? false);
      weaponPopup.textContent = state
        ? `${WEAPON_ORDER.indexOf(state.weapon) + 1} · ${WEAPON_LABELS[state.weapon]}`
        : '';
    });
    this.radar = (this.el('radar') as HTMLCanvasElement).getContext('2d')!;
    const click = (id: string, fn: () => void) => this.el(id).addEventListener('click', fn);
    click('start', actions.start);
    click('replay', actions.replay);
    click('practice-button', actions.practice);
    click('resume', actions.resume);
    click('pause-button', actions.pause);
    click('pause-garage', actions.garage);
    click('results-garage', actions.garage);
    this.el('brand').addEventListener('click', e => {
      e.preventDefault();
      if (this.phase === 'selection') return;
      actions.pause();
    });
    click('mute', actions.mute);
    click('help-button', () => {
      actions.pause();
      (this.el('manual') as HTMLDialogElement).showModal();
    });
    click('close-help', () => this.closeManual());
    click('online-button', () => (this.lobby ? actions.leaveRoom() : actions.openOnline()));
    click('online-close', actions.leaveRoom);
    click('create-room', () => actions.createRoom(this.callsign()));
    const join = () => {
      const code = this.roomCode();
      if (code.length === 4) actions.joinRoom(code, this.callsign());
      else {
        this.setOnlineMessage('Enter the four-letter room code.');
        this.el('room-code').focus();
      }
    };
    click('join-room', join);
    click('copy-code', actions.copyCode);
    click('add-bot', () => this.lobby && actions.setBots(this.lobby.bots + 1));
    click('remove-bot', () => this.lobby && actions.setBots(this.lobby.bots - 1));
    click('net-error-close', () => (this.el('net-error').hidden = true));
    const codeInput = this.el('room-code') as HTMLInputElement;
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    });
    codeInput.addEventListener('keydown', e => e.key === 'Enter' && join());
    this.el('callsign').addEventListener(
      'keydown',
      e => e.key === 'Enter' && actions.createRoom(this.callsign()),
    );
    this.el('online').addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      actions.leaveRoom();
    });
    this.el('quality').addEventListener('change', e =>
      actions.quality((e.target as HTMLSelectElement).value as Quality),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-vehicle]').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.vehicle as VehicleId;
        this.select(id);
        actions.select(id);
      });
    });
    this.select('hellion');
  }

  private el(id: string): HTMLElement {
    return this.refs.get(id)!;
  }
  private text(id: string, value: string): void {
    const el = this.el(id);
    if (el.textContent !== value) el.textContent = value;
  }
  select(id: VehicleId): void {
    this.selected = id;
    const def = VEHICLES[id];
    this.root.querySelectorAll<HTMLButtonElement>('[data-vehicle]').forEach(el => {
      const selected = el.dataset.vehicle === id;
      el.classList.toggle('selected', selected);
      el.setAttribute('aria-pressed', String(selected));
    });
    this.text('preview-name', def.name);
    this.text('preview-role', def.role);
    this.text('preview-description', def.description);
  }
  setMuted(muted: boolean): void {
    this.text('mute', muted ? 'SOUND OFF' : 'SOUND ON');
    this.el('mute').setAttribute('aria-label', muted ? 'Enable sound' : 'Mute sound');
    this.el('mute').setAttribute('aria-pressed', String(muted));
  }
  setQuality(q: Quality): void {
    (this.el('quality') as HTMLSelectElement).value = q;
  }
  callsign(): string {
    return (this.el('callsign') as HTMLInputElement).value;
  }
  private roomCode(): string {
    return (this.el('room-code') as HTMLInputElement).value;
  }

  /** Disable online play when this build has no server configured. */
  setOnlineAvailable(available: boolean): void {
    this.onlineAvailable = available;
    this.renderLaunch();
  }
  showOnline(open: boolean, callsign = ''): void {
    this.el('online').hidden = !open;
    if (!open) return;
    const input = this.el('callsign') as HTMLInputElement;
    if (!input.value) input.value = callsign;
    this.setOnlineMessage('');
    input.focus();
    input.select();
  }
  isOnlineOpen(): boolean {
    return !this.el('online').hidden;
  }
  /** Status line in the online dialog; `busy` blocks double submissions while connecting. */
  setOnlineMessage(text: string, busy = false): void {
    this.text('online-message', text);
    for (const id of ['create-room', 'join-room'])
      (this.el(id) as HTMLButtonElement).disabled = busy;
  }
  setNetStatus(text: string | null): void {
    const status = this.el('net-status');
    const label = text ?? 'LOCAL // OFFLINE';
    if (status.textContent?.trim() === label) return;
    status.replaceChildren(document.createElement('i'), ` ${label}`);
    status.classList.toggle('is-online', text !== null);
  }
  /** Switch result and pause wording between the offline and online rules. */
  setOnline(online: boolean): void {
    this.online = online;
    this.text('pause-eyebrow', online ? 'MENU / MATCH STILL RUNNING' : 'TAKE A BREATH');
    this.text('pause-title', online ? 'EYES OFF THE ROAD.' : 'ENGINE IDLE.');
    this.text(
      'pause-text',
      online
        ? 'The match keeps running while this menu is open. Your car coasts with no input.'
        : 'The yard can wait. Your rivals are paused too.',
    );
    this.text('pause-garage', online ? 'LEAVE ROOM' : 'RETURN TO GARAGE');
    this.label('replay', online ? 'BACK TO LOBBY' : 'RUN IT BACK', 'R ↗');
    this.text('results-garage', online ? 'LEAVE ROOM' : 'CHOOSE ANOTHER MACHINE');
    this.renderLaunch();
  }
  setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    this.el('pause').hidden = !open && this.phase !== 'paused';
    if (open) this.el('resume').focus({ preventScroll: true });
  }
  setLobby(lobby: LobbyState | null): void {
    this.lobby = lobby;
    this.el('lobby').hidden = !lobby;
    this.el('selection').classList.toggle('in-lobby', !!lobby);
    if (lobby) {
      this.text('lobby-code', lobby.code);
      const rows = lobby.players.map(player => {
        const li = document.createElement('li');
        li.classList.toggle('is-you', player.id === lobby.you);
        const name = document.createElement('span');
        name.className = 'lobby-name';
        name.textContent = player.name;
        const car = document.createElement('small');
        car.textContent = VEHICLES[player.vehicle].name;
        const tags = document.createElement('b');
        tags.textContent = [player.host ? 'HOST' : '', player.id === lobby.you ? 'YOU' : '']
          .filter(Boolean)
          .join(' · ');
        li.append(name, car, tags);
        return li;
      });
      for (let seat = lobby.players.length; seat < 6; seat++) {
        const li = document.createElement('li');
        const bot = seat < lobby.players.length + lobby.bots;
        li.className = bot ? 'is-bot' : 'is-open';
        li.textContent = bot ? 'BOT' : 'OPEN SEAT';
        rows.push(li);
      }
      this.el('lobby-players').replaceChildren(...rows);
      const host = lobby.players.find(p => p.id === lobby.you)?.host ?? false;
      const free = 6 - lobby.players.length;
      this.text('bot-count', String(lobby.bots));
      this.el('bot-controls').classList.toggle('is-host', host);
      (this.el('add-bot') as HTMLButtonElement).disabled = !host || lobby.bots >= free;
      (this.el('remove-bot') as HTMLButtonElement).disabled = !host || lobby.bots <= 0;
      this.el('add-bot').hidden = !host;
      this.el('remove-bot').hidden = !host;
    }
    this.renderLaunch();
  }
  showNetError(title: string, text: string): void {
    this.text('net-error-title', title);
    this.text('net-error-text', text);
    this.el('net-error').hidden = false;
    this.el('net-error-close').focus({ preventScroll: true });
  }

  private label(id: string, text: string, hint: string): void {
    const hintEl = document.createElement('span');
    hintEl.textContent = hint;
    this.el(id).replaceChildren(`${text} `, hintEl);
  }
  /** The garage launch card doubles as the lobby's start control. */
  private renderLaunch(): void {
    const start = this.el('start') as HTMLButtonElement;
    const onlineButton = this.el('online-button') as HTMLButtonElement;
    const lobby = this.lobby;
    if (lobby) {
      const host = lobby.players.find(p => p.id === lobby.you)?.host ?? false;
      const humans = lobby.players.length;
      const bots = lobby.bots;
      const solo = humans + bots === 1;
      this.label(
        'start',
        !host ? 'WAITING FOR HOST' : solo ? 'START PRACTICE' : 'START MATCH',
        host ? '↗' : '…',
      );
      start.disabled = !host;
      this.text(
        'launch-detail',
        solo
          ? 'Practice · No opponents · Free roam'
          : `${humans} driver${humans === 1 ? '' : 's'} · ${bots ? `${bots} bot${bots === 1 ? '' : 's'}` : 'No bots'} · Last car standing`,
      );
      this.text('launch-note', `ROOM ${lobby.code} · SHARE THE CODE`);
      onlineButton.textContent = 'LEAVE ROOM';
      onlineButton.disabled = false;
      this.el('practice-button').hidden = true;
    } else {
      this.el('practice-button').hidden = false;
      this.label('start', 'ENTER THE YARD', '↗');
      start.disabled = false;
      this.text('launch-detail', 'Industrial district · Last car standing');
      this.text('launch-note', 'GUNS LOADED. NO SECOND CHANCES.');
      onlineButton.textContent = this.onlineAvailable
        ? 'PLAY ONLINE'
        : 'ONLINE PLAY NOT CONFIGURED';
      onlineButton.disabled = !this.onlineAvailable;
    }
  }
  isManualOpen(): boolean {
    return (this.el('manual') as HTMLDialogElement).open;
  }
  closeManual(): boolean {
    const d = this.el('manual') as HTMLDialogElement;
    if (!d.open) return false;
    d.close();
    return true;
  }
  showWeaponSwitch(weapon: WeaponId): void {
    if (this.phase === 'playing') this.weaponNotice.show(weapon);
  }
  reset(): void {
    this.weaponNotice.clear();
    this.messages = [];
    this.el('feed').replaceChildren();
    this.el('scoreboard-body').replaceChildren();
  }
  event(e: GameEvent, localId = 0): void {
    if (e.type === 'kill' || (e.type === 'pickup' && e.owner === localId)) {
      this.messages.unshift({
        text: e.text ?? '',
        expires: performance.now() + 5000,
        player: e.owner === localId,
      });
      this.messages = this.messages.slice(0, 4);
    }
  }
  update(world: World, localId = 0): void {
    const player = world.vehicles[localId];
    if (this.phase !== world.phase) {
      this.weaponNotice.clear();
      this.phase = world.phase;
      this.el('selection').hidden = world.phase !== 'selection';
      this.el('hud').hidden = world.phase === 'selection';
      this.el('pause').hidden =
        world.phase !== 'paused' && !(this.menuOpen && world.phase === 'playing');
      this.el('results').hidden = world.phase !== 'over';
      document.body.dataset.phase = world.phase;
      const practice = isPractice(world);
      this.text('zone-mode', practice ? 'PRACTICE / ZONE 06' : 'DEATHMATCH / ZONE 06');
      const outcome = outcomeFor(world, localId);
      if (outcome) {
        if (practice) this.describePractice();
        else this.describeResult(world, outcome);
        this.text('result-kills', String(player.kills));
        this.text('result-time', timeText(world.time));
        this.text('result-car', player.def.name);
        this.renderScoreboard(world, localId);
        this.el('results').querySelector<HTMLElement>('.results-modal')!.scrollTop = 0;
        this.el('replay').focus({ preventScroll: true });
      } else if (world.phase === 'paused') this.el('resume').focus({ preventScroll: true });
      else if (world.phase === 'playing' && document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    }
    if (world.phase === 'selection') return;
    const alive = world.vehicles.filter(v => !v.dead).length;
    this.text('remaining', String(alive).padStart(2, '0'));
    this.text('match-time', timeText(world.time));
    const dots = world.vehicles
      .map(v => `<i class="${v.dead ? 'dead' : v.id === localId ? 'you' : ''}"></i>`)
      .join('');
    if (this.el('driver-dots').innerHTML !== dots) this.el('driver-dots').innerHTML = dots;
    this.text('hud-car', player.def.name);
    this.text('kills', `${player.kills} WRECK${player.kills === 1 ? '' : 'S'}`);
    const hp = (player.hp / player.def.health) * 100;
    this.el('hp-fill').style.width = `${hp}%`;
    this.el('hp-meter').setAttribute('aria-valuenow', String(Math.round(hp)));
    this.el('hp-meter').classList.toggle('critical', hp < 30);
    this.text('hp-number', `${Math.ceil(player.hp)} / ${player.def.health}`);
    this.el('boost-fill').style.width = `${player.boost}%`;
    this.el('boost-meter').setAttribute('aria-valuenow', String(Math.round(player.boost)));
    const speed = Math.hypot(player.vx, player.vz);
    this.text('speed', String(Math.round(speed * 3.6)).padStart(3, '0'));
    this.text(
      'drive-status',
      player.control.boost && player.boost > 0 && player.control.throttle > 0
        ? 'BOOSTING'
        : player.control.brake
          ? 'DRIFT'
          : speed < 1
            ? 'IDLE'
            : 'IN MOTION',
    );
    this.text('rockets', String(player.rockets).padStart(2, '0'));
    const locked = rocketTarget(world, player) !== undefined;
    const rocketSelected = player.control.selectedWeapon === 'rocket';
    this.el('weapon-bullet').classList.toggle('is-selected', !rocketSelected);
    this.el('weapon-rocket').classList.toggle('is-selected', rocketSelected);
    this.el('weapon-bullet').setAttribute(
      'aria-label',
      `Machine gun${rocketSelected ? '' : ' selected'}; press 1`,
    );
    this.el('weapon-rocket').setAttribute(
      'aria-label',
      `Homing rocket${rocketSelected ? ' selected' : ''}; press 2`,
    );
    this.text(
      'rocket-status',
      player.rockets === 0
        ? 'FIND AMMO PICKUP'
        : player.rocketCooldown > 0
          ? 'RELOADING'
          : locked
            ? 'LMB / K · TARGET LOCKED'
            : 'LMB / K · FIRE',
    );
    this.text(
      'lock-label',
      rocketSelected && locked && player.rockets > 0 && !player.dead ? '◇ ROCKET LOCK' : '',
    );
    const spectating = player.dead && world.phase === 'playing';
    this.el('spectate').hidden = !spectating;
    if (spectating) {
      const followed = cameraTarget(world, localId);
      this.text(
        'spectate',
        followed.id === localId ? 'WRECKED · SPECTATING' : `WRECKED · WATCHING ${followed.name}`,
      );
    }
    this.el('damage-flash').style.opacity = world.time - player.lastHit < 0.18 ? '0.5' : '0';
    this.messages = this.messages.filter(m => m.expires > performance.now());
    const feed = this.el('feed');
    if (feed.textContent !== this.messages.map(m => m.text).join('')) {
      feed.replaceChildren(
        ...this.messages.map(m => {
          const p = document.createElement('p');
          p.textContent = m.text;
          p.className = m.player ? 'player-event' : '';
          return p;
        }),
      );
    }
    this.drawRadar(world, localId);
  }

  private describePractice(): void {
    this.text('result-title', 'PRACTICE OVER.');
    this.text('result-eyebrow', 'PRACTICE / NO OPPONENTS');
    this.text(
      'result-description',
      'The yard got you this time: walls, barrels and your own rockets all bite.',
    );
  }
  private describeResult(world: World, outcome: MatchOutcome): void {
    const won = outcome === 'victory';
    this.text('result-title', won ? 'YARD KING.' : 'TOTALLED.');
    this.text('result-eyebrow', won ? 'VICTORY / LAST CAR STANDING' : 'DEFEAT / END OF THE ROAD');
    const winner = world.winner === null ? undefined : world.vehicles[world.winner];
    this.text(
      'result-description',
      won
        ? this.online
          ? 'Every rival entered your rearview. None made it out.'
          : 'Five rivals entered your rearview. None made it out.'
        : this.online
          ? winner
            ? `${winner.name} drives out of the yard. You get another shot.`
            : 'Nobody drove out. The yard keeps the wreckage.'
          : 'The yard keeps the wreckage. You get another shot.',
    );
  }

  private renderScoreboard(world: World, localId: number): void {
    const standings = buildScoreboard(world, localId);
    this.text('scoreboard-count', `${String(standings.length).padStart(2, '0')} DRIVERS`);
    const fragment = document.createDocumentFragment();
    for (const entry of standings) {
      const row = document.createElement('tr');
      row.classList.toggle('is-player', entry.isPlayer);
      const rank = document.createElement('td');
      rank.className = 'scoreboard-rank';
      rank.textContent = String(entry.rank).padStart(2, '0');
      const driver = document.createElement('th');
      driver.scope = 'row';
      driver.className = 'scoreboard-driver';
      const name = document.createElement('span');
      name.textContent = entry.driverName;
      const vehicle = document.createElement('small');
      vehicle.textContent = entry.vehicleName;
      driver.append(name, vehicle);
      const kills = document.createElement('td');
      kills.className = 'scoreboard-number';
      kills.textContent = String(entry.kills);
      const survival = document.createElement('td');
      survival.className = 'scoreboard-number';
      survival.textContent = timeText(entry.survivalSeconds);
      const status = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `scoreboard-status ${entry.alive ? 'survived' : 'wrecked'}`;
      badge.textContent = entry.alive ? 'SURVIVED' : 'WRECKED';
      status.append(badge);
      row.append(rank, driver, kills, survival, status);
      fragment.append(row);
    }
    this.el('scoreboard-body').replaceChildren(fragment);
  }

  private drawRadar(world: World, localId: number): void {
    const ctx = this.radar,
      scale = 170 / (ARENA * 2),
      pos = (n: number) => 90 + n * scale;
    ctx.clearRect(0, 0, 180, 180);
    ctx.fillStyle = '#121e19e6';
    ctx.fillRect(0, 0, 180, 180);
    ctx.strokeStyle = '#324437';
    ctx.lineWidth = 1;
    for (let i = 5; i < 180; i += 34) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 180);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(180, i);
      ctx.stroke();
    }
    ctx.strokeStyle = '#6b766055';
    ctx.strokeRect(5, 5, 170, 170);
    ctx.fillStyle = '#667460';
    for (const o of world.obstacles)
      ctx.fillRect(pos(o.x - o.w / 2), pos(o.z - o.d / 2), o.w * scale, o.d * scale);
    for (const p of world.pickups)
      if (p.cooldown <= 0) {
        ctx.fillStyle = p.kind === 'repair' ? '#8ed6ae' : '#f3c065';
        ctx.fillRect(pos(p.x) - 1.5, pos(p.z) - 1.5, 3, 3);
      }
    for (const car of world.vehicles) {
      if (car.dead) {
        ctx.fillStyle = '#655f50';
        ctx.fillRect(pos(car.x) - 1, pos(car.z) - 1, 2, 2);
        continue;
      }
      ctx.save();
      ctx.translate(pos(car.x), pos(car.z));
      ctx.rotate(Math.PI - car.heading);
      ctx.fillStyle = car.id === localId ? '#b7e2be' : '#ee9c5c';
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(-3.5, 4);
      ctx.lineTo(0, 2);
      ctx.lineTo(3.5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

export function showFailure(message: string): void {
  const app = document.getElementById('app')!;
  app.replaceChildren();
  const panel = document.createElement('section');
  panel.className = 'failure';
  const label = document.createElement('span');
  label.className = 'eyebrow';
  label.textContent = 'WRECKYARD / ENGINE CHECK';
  const title = document.createElement('h1');
  title.textContent = 'ENGINE OFFLINE.';
  const text = document.createElement('p');
  text.textContent = message;
  const button = document.createElement('button');
  button.className = 'primary';
  button.textContent = 'RETRY ENGINE ↗';
  button.onclick = () => window.location.reload();
  panel.append(label, title, text, button);
  app.append(panel);
}
