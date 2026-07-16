// Verifica che il bottone "Contattaci" del box pagina web costruisca un link
// WhatsApp col messaggio NELLA LINGUA DEL CRM (non sempre italiano).
//
// La lingua del CRM è fissa per tenant (settings.crm_locale, applicata da
// Providers.tsx) — non si cambia da localStorage su un tenant a locale fisso,
// quindi non ha senso testarla via browser cambiando lingua a mano. Il punto da
// proteggere è che l'href usi il messaggio TRADOTTO: lo verifichiamo dai
// dizionari reali + la stessa funzione (contactWhatsappUrl) usata dalla UI.
import { contactWhatsappUrl } from "../src/lib/billing/catalog.ts";
import { it } from "../src/lib/i18n/dictionaries/it.ts";
import { en } from "../src/lib/i18n/dictionaries/en.ts";
import { es } from "../src/lib/i18n/dictionaries/es.ts";
import { de } from "../src/lib/i18n/dictionaries/de.ts";

const dicts = { it, en, es, de };
let fails = 0;
for (const [lng, d] of Object.entries(dicts)) {
  const msg = d.settings_payments_contact_us_message;
  const url = new URL(contactWhatsappUrl(msg));
  const num = url.pathname.replace("/", "");
  const text = decodeURIComponent(url.searchParams.get("text") || "");
  const okNum = num === "34684109244";
  const okMsg = !!msg && msg.length > 5 && text === msg;
  console.log(`   ${okNum && okMsg ? "✓" : "✗"} [${lng}] wa.me/${num} · "${text}"`);
  if (!okNum || !okMsg) fails++;
}
console.log(fails === 0 ? "\n✅ CONTACT i18n: 4/4 href localizzati corretti" : `\n❌ ${fails} problemi`);
process.exit(fails ? 1 : 0);
