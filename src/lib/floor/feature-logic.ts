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
 *  - multi_room ON                  → yes.
 *  - multi_room OFF, single zone     → no (single-room venue).
 *  - multi_room OFF, zones already exist → still yes: rooms a tenant already
 *    built stay visible and editable, so nothing can disappear by turning the
 *    flag off.
 */
export function canAddZones(multiRoom: boolean, zoneCount: number): boolean {
  return multiRoom || zoneCount > 1;
}
