#!/usr/bin/env node
// Create / list / delete WhatsApp message templates on the Meta WhatsApp
// Business Account (WABA) via the Graph API.
//
// WHY: Meta forbids free-text business-initiated messages outside the 24h
// customer-service window. Reminders (day-before), follow-ups (post-visit) and
// waitlist ("a table opened") almost always fall outside that window, so each
// needs a PRE-APPROVED template. This script registers them once; the app then
// sends them by name (see future sendWhatsAppTemplate()).
//
// Endpoint:  POST/GET/DELETE https://graph.facebook.com/{ver}/{WABA_ID}/message_templates
// Auth:      Bearer <META_ACCESS_TOKEN>  (system-user token, scope whatsapp_business_management)
//
// Usage (env loaded from .env.local — must contain META_WABA_ID):
//   node --env-file=.env.local scripts/meta-templates.mjs list
//   node --env-file=.env.local scripts/meta-templates.mjs create        # creates all defined templates
//   node --env-file=.env.local scripts/meta-templates.mjs create reminder   # only the 'reminder' family (all langs)
//   node --env-file=.env.local scripts/meta-templates.mjs delete <name>     # delete by name (all langs)
//   node --env-file=.env.local scripts/meta-templates.mjs preview           # print bodies, send nothing
//
// Notes on placeholders: Meta templates use positional {{1}}, {{2}}… variables.
// Each template below documents what each index maps to, and ships `example`
// values (Meta REQUIRES examples for body variables or approval is rejected).

const VER = process.env.META_GRAPH_VERSION || "v21.0";
const TOKEN = process.env.META_ACCESS_TOKEN;
const WABA_ID = process.env.META_WABA_ID;

const LANGS = ["es", "it", "en", "de"]; // languages the CRM supports (owner-locale.ts)

// ---------------------------------------------------------------------------
// Template definitions.
//
// One entry per family. `name` must be lowercase + underscores (Meta rule).
// `category` is UTILITY for transactional (reminder/waitlist) and MARKETING for
// the follow-up (review ask) — Meta classifies these differently and MARKETING
// is opt-out-able, which is correct for a review request.
//
// `bodies` holds the localized text. {{1}}.. are positional vars. `examples`
// gives Meta one sample per variable (same order). `buttons`, when present,
// are quick-reply buttons (no URL/phone needed for our flows).
// ---------------------------------------------------------------------------

const TEMPLATES = [
  {
    name: "booking_reminder",
    category: "UTILITY",
    // vars: 1=guest name, 2=date, 3=time, 4=party size, 5=restaurant name
    bodies: {
      es: "Hola {{1}} 👋 Te recordamos tu reserva en {{5}}:\n📅 {{2}} a las {{3}}\n👥 {{4}} personas\n\n¿Nos vemos? Responde *SÍ* para confirmar o *NO* si no puedes venir.",
      it: "Ciao {{1}} 👋 Ti ricordiamo la tua prenotazione da {{5}}:\n📅 {{2}} alle {{3}}\n👥 {{4}} persone\n\nCi vediamo? Rispondi *SÌ* per confermare o *NO* se non puoi venire.",
      en: "Hi {{1}} 👋 A quick reminder of your booking at {{5}}:\n📅 {{2}} at {{3}}\n👥 {{4}} people\n\nSee you there? Reply *YES* to confirm or *NO* if you can't make it.",
      de: "Hallo {{1}} 👋 Wir erinnern dich an deine Reservierung bei {{5}}:\n📅 {{2}} um {{3}}\n👥 {{4}} Personen\n\nSehen wir uns? Antworte *JA* zum Bestätigen oder *NEIN*, falls du nicht kommen kannst.",
    },
    examples: ["María", "sábado 6 de junio de 2026", "21:00", "4", "Picnic"],
    buttons: {
      es: ["SÍ", "NO"],
      it: ["SÌ", "NO"],
      en: ["YES", "NO"],
      de: ["JA", "NEIN"],
    },
  },
  {
    // The post-booking SUMMARY for VOICE auto-confirmed bookings: a voice-only
    // caller has no open 24h WhatsApp window, so the summary must go out as an
    // approved template. SAME var mapping as booking_reminder so the n8n send
    // only swaps the template name. NO buttons — it's a confirmation, not a
    // reminder, and the *MODIFICA*/*ANNULLA* keywords match the chat bot's.
    name: "booking_confirmation",
    category: "UTILITY",
    // vars: 1=guest name, 2=date, 3=time, 4=party size, 5=restaurant name
    bodies: {
      es: "✅ ¡Reserva confirmada en {{5}}!\n📅 {{2}} a las {{3}}\n👥 {{4}} personas\n📝 A nombre de {{1}}\n\nPara modificar responde *MODIFICAR*, para cancelar responde *CANCELAR*.",
      it: "✅ Prenotazione confermata da {{5}}!\n📅 {{2}} alle {{3}}\n👥 {{4}} persone\n📝 A nome di {{1}}\n\nPer modificare rispondi *MODIFICA*, per annullare rispondi *ANNULLA*.",
      en: "✅ Booking confirmed at {{5}}!\n📅 {{2}} at {{3}}\n👥 {{4}} people\n📝 Under {{1}}\n\nTo modify reply *MODIFY*, to cancel reply *CANCEL*.",
      de: "✅ Reservierung bei {{5}} bestätigt!\n📅 {{2}} um {{3}}\n👥 {{4}} Personen\n📝 Auf den Namen {{1}}\n\nZum Ändern antworte *ÄNDERN*, zum Stornieren antworte *STORNIEREN*.",
    },
    examples: ["María", "sábado 6 de junio de 2026", "21:00", "4", "Picnic"],
    // No buttons — modify/cancel are keyword replies, not buttons.
  },
  {
    name: "post_visit_followup",
    category: "MARKETING",
    // vars: 1=guest name, 2=restaurant name
    bodies: {
      es: "Hola {{1}} 😊 ¡Gracias por visitar {{2}}! Esperamos que lo hayas disfrutado. ¿Nos dejarías una reseña? Tu opinión nos ayuda muchísimo. ¡Hasta pronto! 🙌",
      it: "Ciao {{1}} 😊 Grazie per essere venuto da {{2}}! Speriamo ti sia trovato bene. Ci lasceresti una recensione? La tua opinione ci aiuta tantissimo. A presto! 🙌",
      en: "Hi {{1}} 😊 Thanks for visiting {{2}}! We hope you enjoyed it. Would you leave us a review? Your feedback means a lot. See you soon! 🙌",
      de: "Hallo {{1}} 😊 Danke für deinen Besuch bei {{2}}! Wir hoffen, es hat dir gefallen. Würdest du uns eine Bewertung hinterlassen? Dein Feedback hilft uns sehr. Bis bald! 🙌",
    },
    examples: ["María", "Picnic"],
    // No buttons: a review CTA is usually a URL button added per-tenant later.
  },
  {
    // Follow-up WITH the certified-review link (Fase 2). Same copy as
    // post_visit_followup plus a dynamic-URL button whose {{1}} suffix is the
    // signed review token (/rv/<token>). The cron sends THIS template when the
    // tenant has reviews_enabled, the plain one otherwise.
    name: "post_visit_review",
    category: "MARKETING",
    // vars: 1=guest name, 2=restaurant name
    bodies: {
      es: "Hola {{1}} 😊 ¡Gracias por visitar {{2}}! Esperamos que lo hayas disfrutado. ¿Nos dejarías una reseña? Solo te llevará un momento y nos ayuda muchísimo. ¡Hasta pronto! 🙌",
      it: "Ciao {{1}} 😊 Grazie per essere venuto da {{2}}! Speriamo ti sia trovato bene. Ci lasceresti una recensione? Ci vuole un attimo e ci aiuta tantissimo. A presto! 🙌",
      en: "Hi {{1}} 😊 Thanks for visiting {{2}}! We hope you enjoyed it. Would you leave us a review? It only takes a moment and helps us a lot. See you soon! 🙌",
      de: "Hallo {{1}} 😊 Danke für deinen Besuch bei {{2}}! Wir hoffen, es hat dir gefallen. Würdest du uns eine Bewertung hinterlassen? Es dauert nur einen Moment und hilft uns sehr. Bis bald! 🙌",
    },
    examples: ["María", "Picnic"],
    urlButton: {
      texts: { es: "Dejar reseña", it: "Lascia recensione", en: "Leave a review", de: "Bewertung abgeben" },
      url: "https://crm.baliflowagency.com/rv/{{1}}",
      example: "eyJzIjoicGljbmljIiwiciI6ImFiYyJ9.c2lnbmF0dXJl",
    },
  },
  {
    // Campaign carrier (Fase 3 — marketing suite). {{2}} is the owner-written
    // campaign text; {{1}} personalizes with the guest's name. MARKETING
    // category → opt-out-able, correct for promos. Meta may reject overly
    // generic bodies — if so, tighten the copy around the variable.
    name: "marketing_campaign",
    category: "MARKETING",
    // vars: 1=guest name, 2=campaign message
    bodies: {
      es: "Hola {{1}} 👋\n\n{{2}}\n\n¡Te esperamos!",
      it: "Ciao {{1}} 👋\n\n{{2}}\n\nTi aspettiamo!",
      en: "Hi {{1}} 👋\n\n{{2}}\n\nSee you soon!",
      de: "Hallo {{1}} 👋\n\n{{2}}\n\nWir freuen uns auf dich!",
    },
    examples: ["María", "Este viernes menú degustación a 35€ — reserva tu mesa"],
  },
  {
    name: "waitlist_table_available",
    category: "UTILITY",
    // vars: 1=guest name, 2=restaurant name, 3=date, 4=time, 5=party size
    bodies: {
      es: "¡Buenas noticias, {{1}}! 🎉 Se ha liberado una mesa en {{2}}:\n📅 {{3}} a las {{4}}\n👥 {{5}} personas\n\n¿La quieres? Responde *SÍ* en los próximos 15 min y es tuya. 😊",
      it: "Buone notizie, {{1}}! 🎉 Si è liberato un tavolo da {{2}}:\n📅 {{3}} alle {{4}}\n👥 {{5}} persone\n\nLo vuoi? Rispondi *SÌ* nei prossimi 15 min ed è tuo. 😊",
      en: "Good news, {{1}}! 🎉 A table just opened up at {{2}}:\n📅 {{3}} at {{4}}\n👥 {{5}} people\n\nWant it? Reply *YES* within the next 15 min and it's yours. 😊",
      de: "Gute Nachrichten, {{1}}! 🎉 Bei {{2}} ist ein Tisch frei geworden:\n📅 {{3}} um {{4}}\n👥 {{5}} Personen\n\nMöchtest du ihn? Antworte in den nächsten 15 Min mit *JA* und er gehört dir. 😊",
    },
    examples: ["María", "Picnic", "sábado 6 de junio de 2026", "21:00", "4"],
    buttons: {
      es: ["SÍ"],
      it: ["SÌ"],
      en: ["YES"],
      de: ["JA"],
    },
  },
  {
    // Sent right after the voice "segreteria" (voicemail) answers a call: the
    // caller has no open 24h WhatsApp window (they CALLED, they didn't message),
    // so the follow-up that the voicemail script promises ("we've just sent you
    // a WhatsApp, continue there") MUST be a pre-approved template. Replying to
    // it opens the 24h window and the normal WhatsApp agent takes over.
    //
    // NAME HISTORY: started as "call_followup" (mistakenly submitted MARKETING).
    // Meta locks a deleted template name to its old category for ~28 days, so we
    // couldn't recreate that name as UTILITY. Renamed to "missed_call_followup",
    // but Meta's CONTENT classifier reclassified the promotional-sounding copy
    // back to MARKETING during review (then that name got locked too after a
    // delete). Final: "missed_call_notice" with sober, transactional copy that
    // reads as UTILITY (the user placed the call — this is a service notice).
    name: "missed_call_notice",
    category: "UTILITY",
    // vars: 1=restaurant name
    // WORDING IS LOAD-BEARING: Meta's classifier reclassifies a template to
    // MARKETING (overriding the requested UTILITY) when the copy reads as
    // promotional — waving-hand/smiley emojis, an exclamatory greeting, and
    // "feel free to message us / if you'd like to book" invitation phrasing all
    // tripped it (it/en/es got bumped to MARKETING; only the soberer de stayed
    // UTILITY). A missed-call notice IS genuinely transactional, so keep the
    // copy factual: state that the call couldn't be answered and that they can
    // reply here to continue. No emojis, no exclamation, no invitation framing.
    bodies: {
      es: "Has llamado a {{1}} y no hemos podido atender tu llamada. Puedes responder a este mensaje para continuar por aquí.",
      it: "Hai chiamato {{1}} e non siamo riusciti a rispondere alla tua chiamata. Puoi rispondere a questo messaggio per continuare da qui.",
      en: "You called {{1}} and we couldn't answer your call. You can reply to this message to continue here.",
      de: "Du hast {{1}} angerufen und wir konnten deinen Anruf nicht entgegennehmen. Du kannst auf diese Nachricht antworten, um hier fortzufahren.",
    },
    examples: ["BALI Rest"],
    // No buttons — a free reply opens the conversation with the WhatsApp agent.
  },
];

// Meta language codes differ from our 2-letter codes for some locales.
const META_LANG = { es: "es", it: "it", en: "en", de: "de" };

// ---------------------------------------------------------------------------

function preflight() {
  const missing = [];
  if (!TOKEN) missing.push("META_ACCESS_TOKEN");
  if (!WABA_ID) missing.push("META_WABA_ID");
  if (missing.length) {
    console.error(`❌ Missing env: ${missing.join(", ")}`);
    console.error("   Add them to .env.local and run with: node --env-file=.env.local scripts/meta-templates.mjs <cmd>");
    process.exit(1);
  }
}

const BASE = () => `https://graph.facebook.com/${VER}/${WABA_ID}/message_templates`;

// Build the Meta `components` array for one language of a template.
function buildComponents(tpl, lang) {
  const components = [
    {
      type: "BODY",
      text: tpl.bodies[lang],
      example: { body_text: [tpl.examples] }, // one example set covering all {{n}}
    },
  ];
  const btns = tpl.buttons?.[lang];
  if (btns?.length) {
    components.push({
      type: "BUTTONS",
      buttons: btns.map((t) => ({ type: "QUICK_REPLY", text: t })),
    });
  }
  // Dynamic-URL button: url ends in {{1}}, sender passes the suffix at send
  // time (sendWhatsAppTemplate's urlButtonParam). Meta wants a full example.
  if (tpl.urlButton) {
    components.push({
      type: "BUTTONS",
      buttons: [
        {
          type: "URL",
          text: tpl.urlButton.texts[lang],
          url: tpl.urlButton.url,
          example: [tpl.urlButton.url.replace("{{1}}", tpl.urlButton.example)],
        },
      ],
    });
  }
  return components;
}

async function listTemplates() {
  const res = await fetch(`${BASE()}?fields=name,status,category,language&limit=200&access_token=${TOKEN}`);
  const data = await res.json();
  if (!res.ok) {
    console.error("❌ list failed:", JSON.stringify(data, null, 2));
    process.exit(1);
  }
  const rows = data.data || [];
  if (!rows.length) {
    console.log("(no templates on this WABA yet)");
    return;
  }
  console.log(`\n${rows.length} template(s) on WABA ${WABA_ID}:\n`);
  for (const t of rows) {
    const icon = t.status === "APPROVED" ? "✅" : t.status === "REJECTED" ? "❌" : "⏳";
    console.log(`  ${icon} ${t.name.padEnd(28)} ${String(t.language).padEnd(6)} ${t.category.padEnd(10)} ${t.status}`);
  }
  console.log();
}

async function createOne(tpl, lang) {
  const payload = {
    name: tpl.name,
    language: META_LANG[lang],
    category: tpl.category,
    components: buildComponents(tpl, lang),
  };
  const res = await fetch(`${BASE()}?access_token=${TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.error_user_msg || data?.error?.message || `HTTP ${res.status}`;
    console.log(`  ❌ ${tpl.name} [${lang}] → ${msg}`);
    return false;
  }
  console.log(`  ✅ ${tpl.name} [${lang}] → submitted (id ${data.id}, status ${data.status})`);
  return true;
}

async function createTemplates(familyFilter) {
  const families = familyFilter
    ? TEMPLATES.filter((t) => t.name === familyFilter)
    : TEMPLATES;
  if (familyFilter && !families.length) {
    console.error(`❌ No template family named "${familyFilter}". Known: ${TEMPLATES.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`\nSubmitting ${families.length} family × ${LANGS.length} langs = ${families.length * LANGS.length} templates to Meta…\n`);
  let ok = 0, fail = 0;
  for (const tpl of families) {
    for (const lang of LANGS) {
      // Sequential on purpose — stays well under Meta's create rate limit and
      // keeps the output readable.
      // eslint-disable-next-line no-await-in-loop
      const success = await createOne(tpl, lang);
      success ? ok++ : fail++;
    }
  }
  console.log(`\nDone: ${ok} submitted, ${fail} failed. Run \`list\` to watch approval status (Meta usually reviews within minutes to a few hours).\n`);
  if (fail) process.exit(1);
}

async function deleteTemplate(name) {
  if (!name) {
    console.error("❌ delete needs a template name. Usage: delete <name>");
    process.exit(1);
  }
  const res = await fetch(`${BASE()}?name=${encodeURIComponent(name)}&access_token=${TOKEN}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`❌ delete "${name}" failed:`, JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log(`🗑️  Deleted "${name}" (all languages).`);
}

function preview() {
  console.log(`\n=== Template preview (${TEMPLATES.length} families × ${LANGS.length} langs) ===\n`);
  for (const tpl of TEMPLATES) {
    console.log(`■ ${tpl.name}  [${tpl.category}]`);
    for (const lang of LANGS) {
      console.log(`  ── ${lang} ──`);
      console.log(tpl.bodies[lang].split("\n").map((l) => "     " + l).join("\n"));
      if (tpl.buttons?.[lang]) console.log("     [buttons] " + tpl.buttons[lang].join(" | "));
      console.log();
    }
  }
  console.log("Variables map (positional):");
  console.log("  booking_reminder        {{1}}=name {{2}}=date {{3}}=time {{4}}=party {{5}}=restaurant");
  console.log("  post_visit_followup     {{1}}=name {{2}}=restaurant");
  console.log("  waitlist_table_available {{1}}=name {{2}}=restaurant {{3}}=date {{4}}=time {{5}}=party");
  console.log();
}

// ---------------------------------------------------------------------------

const [cmd, arg] = process.argv.slice(2);

switch (cmd) {
  case "preview":
    preview();
    break;
  case "list":
    preflight();
    await listTemplates();
    break;
  case "create":
    preflight();
    await createTemplates(arg);
    break;
  case "delete":
    preflight();
    await deleteTemplate(arg);
    break;
  default:
    console.log("Usage: node --env-file=.env.local scripts/meta-templates.mjs <preview|list|create [family]|delete <name>>");
    process.exit(cmd ? 1 : 0);
}
