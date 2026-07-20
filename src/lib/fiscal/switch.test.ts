import { describe, it, expect } from "vitest";
import { planFiscalSwitch, type FiscalContext } from "./server";
import { REGIMES, vatConfigOf } from "./regions";
import { sistemaInformatico } from "./sistema";

// Switching a tenant from an external POS to the built-in cassa is not only a
// connection change: under VeriFactu it also moves WHO ISSUES the invoices.
// fiscal_obligados.sif_mode is a separate axis from pos_connections.active, and
// the bug these tests exist to prevent is moving one without the other — which
// hands the owner a till that returns 403 on every payment.

const ctx = (over: Partial<FiscalContext>): FiscalContext => ({
  register: false,
  mode: "off",
  obligadoId: null,
  nif: null,
  regime: REGIMES.iva_italia,
  vat: vatConfigOf(REGIMES.iva_italia),
  serie: "",
  timezone: "Europe/Rome",
  sistema: sistemaInformatico("t1"),
  ...over,
});

describe("planFiscalSwitch", () => {
  it("hands issuance to our cassa for a Spanish tenant leaving an external POS", () => {
    // The exact BALI Rest case: Loyverse was the compliant SIF (sif_mode
    // 'external'), so the built-in cassa was forbidden to emit. Taking over the
    // till has to take over issuance too, or the cassa is dead on arrival.
    const plan = planFiscalSwitch(
      ctx({ regime: REGIMES.iva_peninsular, mode: "external", obligadoId: "ob-1", nif: "B12345678" }),
    );
    expect(plan).toEqual({ becomesIssuer: true, blocked: false });
  });

  it("refuses the switch when nobody is fiscally identified", () => {
    // Under the duty but no NIF: moving them would produce a till that cannot
    // legally take money. Refusing is the honest outcome.
    const plan = planFiscalSwitch(ctx({ regime: REGIMES.iva_peninsular, mode: "none", obligadoId: null }));
    expect(plan).toEqual({ becomesIssuer: true, blocked: true });
  });

  it("never claims issuance for a tenant outside VeriFactu", () => {
    // Italy has no RT implementation here. Writing sif_mode='native' would
    // assert a compliance we do not provide, so the flag must stay untouched.
    const plan = planFiscalSwitch(ctx({ regime: REGIMES.iva_italia, mode: "off" }));
    expect(plan).toEqual({ becomesIssuer: false, blocked: false });
  });

  it("is a no-op for a Spanish tenant already issuing natively", () => {
    const plan = planFiscalSwitch(
      ctx({ regime: REGIMES.iva_peninsular, mode: "native", obligadoId: "ob-1", register: true }),
    );
    expect(plan.blocked).toBe(false);
  });

  it("treats Canarias like the mainland — the duty follows the regime, not the rate table", () => {
    const plan = planFiscalSwitch(
      ctx({ regime: REGIMES.igic_canarias, mode: "external", obligadoId: "ob-2" }),
    );
    expect(plan.becomesIssuer).toBe(true);
  });
});
