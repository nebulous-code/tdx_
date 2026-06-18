// clock.ts — freeze the system clock for deterministic parity tests, mirroring
// test/support/clock.cjs from Phase 0. Only no-arg `new Date()` / `Date.now()`
// are pinned (to 2026-06-18, the goldens' baseline); explicit-arg construction is
// left untouched. Pins TZ=UTC so date math/formatting matches the goldens.

process.env.TZ = 'UTC';

const RealDate = Date;
export const FIXED_ISO = '2026-06-18';
const FIXED_MS = new RealDate(`${FIXED_ISO}T00:00:00.000Z`).getTime();

export function freezeClock(): void {
  class FrozenDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(FIXED_MS);
      // runtime spreads the real args; the `[]` cast just satisfies the Date overloads
      else super(...(args as []));
    }
    static now(): number {
      return FIXED_MS;
    }
  }
  (globalThis as { Date: DateConstructor }).Date = FrozenDate as unknown as DateConstructor;
}
