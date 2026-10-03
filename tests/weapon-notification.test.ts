import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlState } from '../src/controls';
import { WeaponSwitchNotice } from '../src/weapon-notification';

describe('weapon-switch notification', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each(['Tab', 'Digit2', 'Numpad2'])(
    'announces a switch immediately from %s without polling input',
    key => {
      const render = vi.fn();
      const notice = new WeaponSwitchNotice(render);
      const controls = new ControlState(weapon => notice.show(weapon));
      controls.press(key);
      expect(render).toHaveBeenCalledExactlyOnceWith({ weapon: 'rocket', fading: false });
    },
  );

  it('stays opaque for 1250 ms, fades for the final 250 ms, and clears at 1500 ms', () => {
    const render = vi.fn(),
      notice = new WeaponSwitchNotice(render);
    notice.show('rocket');
    vi.advanceTimersByTime(1249);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenLastCalledWith({ weapon: 'rocket', fading: false });
    vi.advanceTimersByTime(1);
    expect(render).toHaveBeenLastCalledWith({ weapon: 'rocket', fading: true });
    vi.advanceTimersByTime(249);
    expect(render).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(render).toHaveBeenLastCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replaces the current notification and cancels its original expiry', () => {
    const render = vi.fn(),
      notice = new WeaponSwitchNotice(render);
    notice.show('rocket');
    vi.advanceTimersByTime(1000);
    notice.show('bullet');
    vi.advanceTimersByTime(500);
    expect(render).toHaveBeenLastCalledWith({ weapon: 'bullet', fading: false });
    expect(render).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(750);
    expect(render).toHaveBeenLastCalledWith({ weapon: 'bullet', fading: true });
    vi.advanceTimersByTime(250);
    expect(render).toHaveBeenLastCalledWith(null);
  });

  it('restores full visibility when another switch happens during the fade', () => {
    const render = vi.fn(),
      notice = new WeaponSwitchNotice(render);
    notice.show('rocket');
    vi.advanceTimersByTime(1300);
    expect(render).toHaveBeenLastCalledWith({ weapon: 'rocket', fading: true });
    notice.show('bullet');
    expect(render).toHaveBeenLastCalledWith({ weapon: 'bullet', fading: false });
    vi.advanceTimersByTime(200);
    expect(render).toHaveBeenLastCalledWith({ weapon: 'bullet', fading: false });
    vi.advanceTimersByTime(1050);
    expect(render).toHaveBeenLastCalledWith({ weapon: 'bullet', fading: true });
    vi.advanceTimersByTime(250);
    expect(render).toHaveBeenLastCalledWith(null);
  });

  it.each([0, 1300])('clears all pending updates when a screen changes after %i ms', elapsed => {
    const render = vi.fn(),
      notice = new WeaponSwitchNotice(render);
    notice.show('rocket');
    vi.advanceTimersByTime(elapsed);
    notice.clear();
    expect(render).toHaveBeenLastCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
    render.mockClear();
    vi.advanceTimersByTime(3000);
    expect(render).not.toHaveBeenCalled();
  });

  it('does not announce repeated selections, Tab auto-repeat, or J/K quick firing', () => {
    const changed = vi.fn(),
      controls = new ControlState(changed);
    controls.press('Digit1');
    controls.press('Numpad1');
    controls.press('KeyJ');
    controls.press('KeyK');
    expect(changed).not.toHaveBeenCalled();
    controls.press('Tab');
    expect(changed).toHaveBeenCalledExactlyOnceWith('rocket');
    controls.press('Tab', true);
    controls.press('Digit2');
    controls.press('Numpad2');
    controls.clear();
    controls.reset();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('preserves a queued mouse click while notifying about a weapon switch', () => {
    const changed = vi.fn(),
      controls = new ControlState(changed);
    controls.primary(true);
    controls.primary(false);
    controls.press('Digit2');
    expect(changed).toHaveBeenCalledExactlyOnceWith('rocket');
    expect(controls.read()).toMatchObject({ gun: false, rocket: true });
    expect(controls.read()).toMatchObject({ gun: false, rocket: false });
  });
});
