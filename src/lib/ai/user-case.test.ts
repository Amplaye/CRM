import { describe, it, expect } from 'vitest';
import { isUserFlowRejection } from './user-case';

describe('isUserFlowRejection', () => {
  it('marca como user-case "no reservation found" (modify)', () => {
    expect(isUserFlowRejection('no active reservation found', 'modify.failed')).toBe(true);
  });

  it('marca cancel.not_found como user-case por el step (antes era high)', () => {
    // El bot le dice al cliente que no tiene reserva que cancelar: no es un fallo.
    expect(isUserFlowRejection('', 'cancel.not_found')).toBe(true);
  });

  it('marca passthrough con motivo zona-alternativa como user-case', () => {
    expect(isUserFlowRejection('zone_alternative_available', 'book.passthrough')).toBe(true);
  });

  it('marca passthrough con motivo posible-duplicado como user-case', () => {
    expect(isUserFlowRejection('possible_duplicate', 'book.passthrough')).toBe(true);
  });

  it('marca rechazos de horario como user-case', () => {
    expect(isUserFlowRejection('before_opening', 'book.rejected_closing_time')).toBe(true);
    expect(isUserFlowRejection('outside_hours', 'modify.rejected_closing_time')).toBe(true);
  });

  it('NO marca un passthrough sin motivo (flujo cortado de verdad sigue siendo high)', () => {
    expect(isUserFlowRejection('', 'book.passthrough')).toBe(false);
  });

  it('NO marca una excepción real de sistema (book.exception / 500)', () => {
    expect(isUserFlowRejection('request failed with status code 500', 'book.exception')).toBe(false);
  });
});
