import type { WeaponId } from './types';

export const WEAPON_NOTICE_DURATION_MS = 1500;
export const WEAPON_NOTICE_FADE_MS = 250;
export interface WeaponNoticeState {
  weapon: WeaponId;
  fading: boolean;
}

/** One replaceable notification; timers are cancelled on switches and screen changes. */
export class WeaponSwitchNotice {
  private fadeTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly notify: (state: WeaponNoticeState | null) => void) {}

  show(weapon: WeaponId): void {
    this.cancelTimers();
    this.notify({ weapon, fading: false });
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = undefined;
      this.notify({ weapon, fading: true });
    }, WEAPON_NOTICE_DURATION_MS - WEAPON_NOTICE_FADE_MS);
    this.hideTimer = setTimeout(() => this.clear(), WEAPON_NOTICE_DURATION_MS);
  }

  clear(): void {
    this.cancelTimers();
    this.notify(null);
  }

  private cancelTimers(): void {
    if (this.fadeTimer !== undefined) clearTimeout(this.fadeTimer);
    if (this.hideTimer !== undefined) clearTimeout(this.hideTimer);
    this.fadeTimer = undefined;
    this.hideTimer = undefined;
  }
}
