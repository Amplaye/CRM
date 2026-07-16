// Distingue un RECHAZO DE FLUJO (el bot trabajando bien: "no tienes reserva",
// "fuera de horario", "pregunta al cliente por otra zona") de un FALLO DE
// SISTEMA real (excepción 500, flujo cortado sin motivo).
//
// Los rechazos de flujo se registran en system_logs a baja severidad para que
// el workflow de alertas no despierte al dueño de la agencia por algo que es
// comportamiento correcto. Los fallos reales quedan en alta severidad.
//
// Pura por diseño: la ruta /api/ai/log-event extrae los textos y delega aquí,
// así el comportamiento queda bloqueado por test (la ruta no es importable en
// vitest por sus imports de next/server).
const USER_CASE_PATTERNS = [
  'no active reservation found',
  'no se ha encontrado',
  'no encontrada',
  'no guest found',
  'no upcoming reservation',
  'already cancelled',
  'ya cancelad',
  'ya cancelada',
  'in the past',
  'fecha pasada',
  'past_date',
  'past_time',
  'no_tables',
  'outside_hours',
  'closed_day',
  'closing_time',
  'before_opening',
  'ambiguous',
  'ambiguous_reservation',
  // "Cancelar pero no hay reserva" es el bot trabajando bien (le dice al
  // cliente que no tiene reserva), igual que modify "no reservation found".
  'cancel.not_found',
  // book.passthrough con estos motivos NO es un fallo: el bot debe PREGUNTAR
  // al cliente (¿otra zona? / ¿modificar la reserva que ya tiene?).
  // Un passthrough SIN motivo (flujo cortado de verdad) sigue siendo high.
  'zone_alternative_available',
  'possible_duplicate',
] as const;

/**
 * @param errMsg   error || context.error || context.reason, ya en minúsculas
 * @param stepLower  el `step` en minúsculas (ej. "cancel.not_found")
 */
export function isUserFlowRejection(errMsg: string, stepLower: string): boolean {
  return USER_CASE_PATTERNS.some(
    (m) => errMsg.includes(m) || stepLower.includes(m)
  );
}
