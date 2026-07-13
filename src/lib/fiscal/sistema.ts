// SistemaInformatico — the block that rides on EVERY record we file.
//
// It is the machine-readable echo of our *declaración responsable*: AEAT does not
// certify or homologate billing software, so the producer self-certifies and is
// audited after the fact. These fields are that self-certification, restated on
// each record — which is why the flags below are not decoration:
//
//   TipoUsoPosibleSoloVerifactu = "S"  → we declare the system can ONLY work in
//     VERI*FACTU mode (records go to AEAT in real time, never held offline). That
//     single declaration is what legally REMOVES from us: XAdES electronic
//     signatures, the event log, the 6-hourly summary records, tamper detection
//     and 4-year local secure retention. It is the highest-leverage architectural
//     choice in the whole system, and it is only true as long as we never ship an
//     offline mode. If we ever do, this flag — and the declaration — must change.
//
//   TipoUsoPosibleMultiOT / IndicadorMultiplesOT = "S" → the same installation
//     serves several obligados tributarios (we are multi-tenant), so it must
//     behave as N logically independent SIF. That is exactly what the per-NIF
//     chain in fiscal_obligados / fiscal_chain_heads implements.
//
// The producer NIF is BALI's own. It is read from the environment rather than
// hardcoded, because it identifies the company that is legally on the hook (up to
// €150.000/year per non-compliant product, art. 201 bis LGT) and a wrong value
// here files someone else as the producer.

export const SIF_NAME = "BaliFlow CRM — Cassa";
/** AEAT caps IdSistemaInformatico at 2 characters. */
export const SIF_ID = "BF";
/** Bump on any change to how records are generated; it is part of the declaration. */
export const SIF_VERSION = "1.0";

export interface SistemaInformatico {
  NombreRazon: string;
  NIF: string;
  NombreSistemaInformatico: string;
  IdSistemaInformatico: string;
  Version: string;
  NumeroInstalacion: string;
  TipoUsoPosibleSoloVerifactu: "S" | "N";
  TipoUsoPosibleMultiOT: "S" | "N";
  IndicadorMultiplesOT: "S" | "N";
}

/** The block for one tenant. `NumeroInstalacion` is the tenant id: it is what lets
 * AEAT tell two venues of the same chain apart in an audit. */
export function sistemaInformatico(tenantId: string): SistemaInformatico {
  return {
    NombreRazon: process.env.FISCAL_PRODUCER_NAME || "BALI FLOW AGENCY",
    NIF: process.env.FISCAL_PRODUCER_NIF || "",
    NombreSistemaInformatico: SIF_NAME,
    IdSistemaInformatico: SIF_ID,
    Version: SIF_VERSION,
    NumeroInstalacion: tenantId,
    TipoUsoPosibleSoloVerifactu: "S",
    TipoUsoPosibleMultiOT: "S",
    IndicadorMultiplesOT: "S",
  };
}
