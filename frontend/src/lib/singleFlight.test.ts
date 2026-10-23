import { describe, expect, it } from 'vitest';
import { enter, leave, type FlightState } from './singleFlight';

describe('singleFlight', () => {
  it('hanya pemanggil pertama yang masuk sampai selesai', () => {
    const s: FlightState = { busy: false };
    expect(enter(s)).toBe(true);
    expect(enter(s)).toBe(false);
    expect(enter(s)).toBe(false);
    leave(s);
    expect(enter(s)).toBe(true);
  });
});
