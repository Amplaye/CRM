// Pure decision logic for the two floor-screen feature flags (double_shift,
// multi_room). Extracted from floor/page.tsx so each flag's ON/OFF behaviour is
// unit-testable and the component stays a thin consumer. The guiding rule (see
// docs/PIANO_SAAS.md, Mossa 3): turning a flag OFF must never hide or strand
// data a tenant already created — it only removes options going forward.

/**
 * Which reservations the floor screen shows for the selected shift.
 *  - double_shift OFF → single service: ALL reservations together. A flag flip
 *    must never hide a reservation that already exists.
 *  - double_shift ON  → only the reservations of the chosen shift. A reservation's
 *    explicit `shift` wins; otherwise it's derived from its time via `shiftOf`.
 */
export function reservationsForShift<T extends { shift?: string | null; time?: string | null }>(
  reservations: T[],
  doubleShift: boolean,
  selectedShift: string,
  shiftOf: (time: string) => string,
): T[] {
  if (!doubleShift) return reservations;
  return reservations.filter((r) => (r.shift || shiftOf(r.time || "")) === selectedShift);
}

/**
 * Whether the owner may create NEW rooms/zones on the floor map.
 *  - multi_room ON  → yes.
 *  - multi_room OFF → no, ALWAYS — the "+ add zone" button is hidden even if the
 *    venue already has several zones. The flag is the single switch for "this
 *    venue has separate rooms"; off means off.
 *
 * This only gates CREATION. Zones a tenant already built stay fully visible and
 * deletable on the floor screen (that path doesn't go through here), so turning
 * the flag off never hides or strands existing data — it just stops new zones
 * until the owner turns multi_room back on.
 *
 * `zoneCount` is no longer used for the decision; it's kept in the signature so
 * call sites don't change and a future "soft" variant can reintroduce it.
 */
export function canAddZones(multiRoom: boolean, _zoneCount: number): boolean {
  return multiRoom;
}
