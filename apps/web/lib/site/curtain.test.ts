import { beforeEach, describe, expect, it, vi } from 'vitest';
import { curtainLifted, liftCurtain, onCurtainLifted, resetCurtainForTests } from './curtain';

describe('the load curtain signal', () => {
  beforeEach(() => resetCurtainForTests());

  it('tells a waiting listener when the curtain lifts, once', () => {
    const fn = vi.fn();
    onCurtainLifted(fn);
    expect(fn).not.toHaveBeenCalled();
    liftCurtain();
    liftCurtain();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(curtainLifted()).toBe(true);
  });

  it('runs a listener that arrives late immediately', () => {
    liftCurtain();
    const fn = vi.fn();
    onCurtainLifted(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('lets a listener leave before the lift', () => {
    const fn = vi.fn();
    const off = onCurtainLifted(fn);
    off();
    liftCurtain();
    expect(fn).not.toHaveBeenCalled();
  });
});
