// Stub driver per RCH / Custom / altri RT (fase 2).
//
// Ogni marca ha un protocollo diverso (RCH = XML su TCP/IP, Custom = HTTP/JSON).
// Finché non è implementato, il driver risponde con un errore chiaro invece di
// fallire in modo oscuro, così il wizard mostra "marca non ancora supportata".

import type {
  CommercialDoc,
  DailyCloseResult,
  FiscalDeviceConfig,
  FiscalDriver,
  PrintDocResult,
  TestConnectionResult,
} from "../types";

const NOT_SUPPORTED =
  "Questa marca non è ancora supportata dal collegamento diretto. Usa Epson o Axon/Micrelec, oppure contattaci.";

export const genericXmlDriver: FiscalDriver = {
  async testConnection(_cfg: FiscalDeviceConfig): Promise<TestConnectionResult> {
    return { ok: false, error: NOT_SUPPORTED };
  },
  async printCommercialDocument(_cfg: FiscalDeviceConfig, _doc: CommercialDoc): Promise<PrintDocResult> {
    return { ok: false, error: NOT_SUPPORTED };
  },
  async dailyClose(_cfg: FiscalDeviceConfig): Promise<DailyCloseResult> {
    return { ok: false, error: NOT_SUPPORTED };
  },
};
