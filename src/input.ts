import { ControlState } from './controls';
import type { GamePhase, InputState, WeaponId } from './types';

export class Keyboard {
  private state: ControlState;
  private capturedPointer: { canvas: HTMLCanvasElement; id: number } | undefined;
  constructor(
    phase: () => GamePhase,
    action: (key: string) => void,
    focusLost: () => void,
    onWeaponChange: (weapon: WeaponId) => void = () => {},
  ) {
    this.state = new ControlState(onWeaponChange);
    window.addEventListener('keydown', e => {
      if (
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
      if (phase() === 'playing' && this.state.press(e.code, e.repeat)) e.preventDefault();
      if (
        !e.repeat &&
        ['Escape', 'KeyR', 'KeyM'].includes(e.code) &&
        !(e.target instanceof HTMLSelectElement)
      )
        action(e.code);
    });
    window.addEventListener('keyup', e => this.state.release(e.code));
    window.addEventListener('pointerdown', e => {
      // Only clicks on the arena fire; menu, pause, and settings clicks remain UI actions.
      if (
        phase() !== 'playing' ||
        e.button !== 0 ||
        e.pointerType !== 'mouse' ||
        !(e.target instanceof HTMLCanvasElement) ||
        e.target.id !== 'game'
      )
        return;
      e.preventDefault();
      this.state.primary(true);
      try {
        e.target.setPointerCapture(e.pointerId);
        this.capturedPointer = { canvas: e.target, id: e.pointerId };
      } catch {
        /* Window pointer-up/focus handlers still release the input. */
      }
    });
    window.addEventListener('pointerup', e => {
      if (e.button === 0) this.releasePointer();
    });
    window.addEventListener('pointercancel', () => this.clear());
    window.addEventListener('lostpointercapture', () => this.releasePointer());
    window.addEventListener('blur', () => {
      this.clear();
      focusLost();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.clear();
        focusLost();
      }
    });
  }
  private releasePointer(): void {
    this.state.primary(false);
    const capture = this.capturedPointer;
    this.capturedPointer = undefined;
    if (capture) {
      try {
        if (capture.canvas.hasPointerCapture(capture.id))
          capture.canvas.releasePointerCapture(capture.id);
      } catch {
        /* The browser may already have released it. */
      }
    }
  }
  clear(): void {
    this.state.clear();
    this.releasePointer();
  }
  reset(): void {
    this.clear();
    this.state.reset();
  }
  read(): InputState {
    return this.state.read();
  }
}
