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
