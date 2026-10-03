import { describe, expect, it } from 'vitest';
import { STEP } from '../src/config';
import { ControlState } from '../src/controls';
import { createWorld, stepWorld } from '../src/simulation';

describe('selected-weapon controls', () => {
  it('starts with machine guns and fires only while the primary button is held', () => {
    const state = new ControlState();
    expect(state.read()).toMatchObject({ selectedWeapon: 'bullet', gun: false, rocket: false });
    state.primary(true);
    expect(state.read()).toMatchObject({ gun: true, rocket: false });
    state.primary(false);
    expect(state.read()).toMatchObject({ gun: false, rocket: false });
  });

  it('cycles on fresh Tab presses, ignores auto-repeat, and wraps around', () => {
    const state = new ControlState();
    expect(state.press('Tab')).toBe(true);
    expect(state.read().selectedWeapon).toBe('rocket');
    state.press('Tab', true);
    expect(state.read().selectedWeapon).toBe('rocket');
    state.release('Tab');
    state.press('Tab');
    expect(state.read().selectedWeapon).toBe('bullet');
  });
  it('retains a quick click between simulation ticks for exactly one input sample', () => {
    const state = new ControlState();
    state.primary(true);
    state.primary(false);
    expect(state.read()).toMatchObject({ gun: true, rocket: false });
    expect(state.read()).toMatchObject({ gun: false, rocket: false });
  });

  it('selects directly using either number-row or numpad keys', () => {
    const state = new ControlState();
    for (const prefix of ['Digit', 'Numpad']) {
      state.press(`${prefix}2`);
      expect(state.read().selectedWeapon).toBe('rocket');
      state.press(`${prefix}1`);
      expect(state.read().selectedWeapon).toBe('bullet');
    }
  });

  it('leaves selection unchanged for unavailable weapon slots', () => {
    const state = new ControlState();
    state.press('Digit2');
    expect(state.press('Digit3')).toBe(false);
    expect(state.press('Numpad9')).toBe(false);
    expect(state.read().selectedWeapon).toBe('rocket');
  });

  it('routes an already-held mouse button to the newly selected weapon', () => {
    const state = new ControlState();
    state.primary(true);
    state.press('Tab');
    expect(state.read()).toMatchObject({ selectedWeapon: 'rocket', gun: false, rocket: true });
    state.press('Digit1');
    expect(state.read()).toMatchObject({ selectedWeapon: 'bullet', gun: true, rocket: false });
  });

  it('releases all held inputs on pause/focus loss while retaining selection', () => {
    const state = new ControlState();
    state.press('Digit2');
    state.primary(true);
    state.press('KeyW');
    state.press('KeyJ');
    state.press('ShiftLeft');
    state.clear();
    expect(state.read()).toMatchObject({
      selectedWeapon: 'rocket',
      throttle: 0,
      boost: false,
      gun: false,
      rocket: false,
    });
  });

  it('resets both selection and held buttons for a fresh match', () => {
    const state = new ControlState();
    state.press('Digit2');
    state.primary(true);
    state.press('KeyK');
    state.reset();
    expect(state.read()).toMatchObject({ selectedWeapon: 'bullet', gun: false, rocket: false });
  });

  it('retains independent J/K quick-fire shortcuts', () => {
    const state = new ControlState();
    state.press('Digit2');
    state.press('KeyJ');
    expect(state.read()).toMatchObject({ selectedWeapon: 'rocket', gun: true, rocket: false });
    state.release('KeyJ');
    state.press('Digit1');
    state.press('KeyK');
    expect(state.read()).toMatchObject({ selectedWeapon: 'bullet', gun: false, rocket: true });
  });

  it('preserves rocket cooldowns and ammunition when firing with the mouse', () => {
    const world = createWorld();
    world.phase = 'playing';
    const state = new ControlState();
    state.press('Digit2');
    state.primary(true);
    for (let i = 0; i < 10; i++) stepWorld(world, state.read(), STEP, false);
    expect(world.vehicles[0].control.selectedWeapon).toBe('rocket');
    expect(world.vehicles[0].rockets).toBe(3);
    expect(
      world.projectiles.filter(p => p.active && p.owner === 0 && p.kind === 'rocket'),
    ).toHaveLength(1);
    world.vehicles[0].rockets = 0;
    world.vehicles[0].rocketCooldown = 0;
    stepWorld(world, state.read(), STEP, false);
    expect(world.vehicles[0].rockets).toBe(0);
    expect(
      world.projectiles.filter(p => p.active && p.owner === 0 && p.kind === 'rocket'),
    ).toHaveLength(1);
  });
});
