import { WEAPON_ORDER, emptyInput } from './config';
import type { InputState, WeaponId } from './types';

const heldKeys = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'KeyJ',
  'KeyK',
]);

/** Input state independent of browser events, so held-button transitions are testable. */
export class ControlState {
  private held = new Set<string>();
  private primaryHeld = false;
  private pendingPrimary = false;
  selectedWeapon: WeaponId = 'bullet';

  constructor(private readonly onWeaponChange: (weapon: WeaponId) => void = () => {}) {}

  private selectWeapon(weapon: WeaponId): void {
    if (weapon === this.selectedWeapon) return;
    this.selectedWeapon = weapon;
    this.onWeaponChange(weapon);
  }

  press(code: string, repeat = false): boolean {
    if (code === 'Tab') {
      if (!repeat)
        this.selectWeapon(
          WEAPON_ORDER[(WEAPON_ORDER.indexOf(this.selectedWeapon) + 1) % WEAPON_ORDER.length],
        );
      return true;
    }
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (digit) {
      const weapon = WEAPON_ORDER[Number(digit[1]) - 1];
      if (!weapon) return false;
      this.selectWeapon(weapon);
      return true;
    }
    if (!heldKeys.has(code)) return false;
    this.held.add(code);
    return true;
  }

  release(code: string): void {
    this.held.delete(code);
  }
  primary(down: boolean): void {
    if (down && !this.primaryHeld) this.pendingPrimary = true;
    this.primaryHeld = down;
  }

  /** Pause/focus loss releases inputs without changing the selected weapon. */
  clear(): void {
    this.held.clear();
    this.primaryHeld = false;
    this.pendingPrimary = false;
  }

  /** A new match starts with machine guns selected and no held buttons. */
  reset(): void {
    this.clear();
    this.selectedWeapon = 'bullet';
  }

  read(): InputState {
    const any = (...codes: string[]) => codes.some(code => this.held.has(code));
    // Preserve a click that starts and ends between fixed simulation ticks.
    const primaryFire = this.primaryHeld || this.pendingPrimary;
    this.pendingPrimary = false;
    return {
      ...emptyInput(),
      selectedWeapon: this.selectedWeapon,
      throttle: Number(any('KeyW', 'ArrowUp')) - Number(any('KeyS', 'ArrowDown')),
      steer: Number(any('KeyD', 'ArrowRight')) - Number(any('KeyA', 'ArrowLeft')),
      brake: any('Space'),
      boost: any('ShiftLeft', 'ShiftRight'),
      gun: any('KeyJ') || (primaryFire && this.selectedWeapon === 'bullet'),
      rocket: any('KeyK') || (primaryFire && this.selectedWeapon === 'rocket'),
    };
  }
}
