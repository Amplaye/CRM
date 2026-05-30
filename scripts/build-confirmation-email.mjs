// Builds the multilingual account-confirmation email template for Supabase Auth
// and PATCHes it (+ subject) via the Management API.
//
// Design: ONE template, rendered in the user's own language. Supabase email
// templates run Go's text/template, so we branch on {{ .Data.locale }} (set at
// signup from the browser language: it/es/en/de, default it). Exactly one
// language block renders. The shared shell (logo, card, CTA button) is
// language-agnostic; only the copy + button label + the "valid 24h" line swap.
//
// Run: node scripts/build-confirmation-email.mjs
//
// Env it expects (already in credentials): the Supabase Management token.

const PROJECT = process.env.SUPABASE_PROJECT_REF || "azhlnybiqlkbhbboyvud";
// Supabase Management API token — NEVER hardcode it (GitHub push protection will
// block, and it's a real secret). Pass it in:
//   SUPABASE_MGMT_TOKEN=sbp_... node scripts/build-confirmation-email.mjs
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN;
if (!MGMT_TOKEN) {
  console.error("Missing SUPABASE_MGMT_TOKEN env var. Run:\n  SUPABASE_MGMT_TOKEN=sbp_... node scripts/build-confirmation-email.mjs");
  process.exit(1);
}

// Per-language copy. `valid` explicitly states the 24h lifetime + auto-resend
// promise (user's explicit request). Order of the if/else chain below is
// it → es → en → de → (fallback it).
const L = {
  it: {
    lang: "it",
    title: "Conferma il tuo account",
    preheader: "Conferma la tua email per attivare il tuo account Bali Flow.",
    h1: "Conferma il tuo account",
    body: "Benvenuto! Sei a un passo dall'attivare il tuo account. Premi il pulsante per confermare la tua email e iniziare.",
    button: "Conferma la mia email",
    valid: "Questo link è valido per 24 ore. Se scade, te ne invieremo automaticamente uno nuovo.",
    fallback: "Se il pulsante non funziona, copia e incolla questo link nel tuo browser:",
    ignore: "Se non hai creato alcun account, puoi ignorare questa email in tutta sicurezza.",
  },
  es: {
    lang: "es",
    title: "Confirma tu cuenta",
    preheader: "Confirma tu correo para activar tu cuenta de Bali Flow.",
    h1: "Confirma tu cuenta",
    body: "¡Bienvenido! Estás a un paso de activar tu cuenta. Pulsa el botón para confirmar tu correo y empezar.",
    button: "Confirmar mi correo",
    valid: "Este enlace es válido durante 24 horas. Si caduca, te enviaremos uno nuevo automáticamente.",
    fallback: "Si el botón no funciona, copia y pega este enlace en tu navegador:",
    ignore: "Si no has creado ninguna cuenta, puedes ignorar este correo de forma segura.",
  },
  en: {
    lang: "en",
    title: "Confirm your account",
    preheader: "Confirm your email to activate your Bali Flow account.",
    h1: "Confirm your account",
    body: "Welcome! You're one step away from activating your account. Tap the button to confirm your email and get started.",
    button: "Confirm my email",
    valid: "This link is valid for 24 hours. If it expires, we'll automatically send you a new one.",
    fallback: "If the button doesn't work, copy and paste this link into your browser:",
    ignore: "If you didn't create an account, you can safely ignore this email.",
  },
  de: {
    lang: "de",
    title: "Bestätige dein Konto",
    preheader: "Bestätige deine E-Mail, um dein Bali-Flow-Konto zu aktivieren.",
    h1: "Bestätige dein Konto",
    body: "Willkommen! Du bist nur einen Schritt von der Aktivierung deines Kontos entfernt. Tippe auf die Schaltfläche, um deine E-Mail zu bestätigen und loszulegen.",
    button: "Meine E-Mail bestätigen",
    valid: "Dieser Link ist 24 Stunden gültig. Falls er abläuft, senden wir dir automatisch einen neuen.",
    fallback: "Wenn die Schaltfläche nicht funktioniert, kopiere diesen Link und füge ihn in deinen Browser ein:",
    ignore: "Falls du kein Konto erstellt hast, kannst du diese E-Mail einfach ignorieren.",
  },
};

// `&email={{ .Email }}` lets the interstitial page auto-resend a fresh link if
// this one is already expired/used, with no typing from the user.
const LINK = "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding&email={{ .Email }}&lang=";

// One self-contained, email-client-safe block for a given language.
// Tables + inline styles only (Outlook/Gmail safe). Mirrors the existing
// Bali Flow brand: sand gradient, white card, terracotta heading, orange CTA.
function block(c) {
  const link = LINK + c.lang;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7EEE0; background-image:linear-gradient(to bottom, #FCF6ED, #F4E4CD);">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px; width:100%; background-color:#ffffff; border-radius:18px; overflow:hidden; box-shadow:0 8px 28px rgba(122,34,17,0.08);">
          <tr>
            <td align="center" style="padding:44px 40px 8px 40px; background-color:#ffffff;">
              <img src="https://crm.baliflowagency.com/logo-email.png" width="200" alt="Bali Flow" style="display:block; width:180px; max-width:78%; height:auto; border:0;">
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 40px 0 40px;">
              <h1 style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:24px; line-height:1.3; font-weight:700; color:#7a2211;">
                ${c.h1}
              </h1>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:14px 40px 0 40px;">
              <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; color:#49563d;">
                ${c.body}
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:30px 40px 8px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px; background-color:#f45517; background-image:linear-gradient(135deg,#fb7740,#e53f0c);">
                    <a href="${link}" target="_blank" style="display:inline-block; padding:15px 38px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:12px;">
                      ${c.button}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 40px 0 40px;">
              <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:1.6; color:#7a8a66; font-weight:600;">
                ${c.valid}
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:14px 40px 36px 40px;">
              <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.6; color:#95a881;">
                ${c.fallback}<br>
                <a href="${link}" target="_blank" style="color:#be2e0b; word-break:break-all; text-decoration:underline;">${link}</a>
              </p>
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px; width:100%;">
          <tr>
            <td align="center" style="padding:24px 40px 0 40px;">
              <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.6; color:#b8c6a9;">
                ${c.ignore}
              </p>
              <p style="margin:10px 0 0 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; color:#b8c6a9;">
                &copy; Bali Flow
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

// The <head> preheader uses the user's language too; default it.
const html = `<!DOCTYPE html>
<html lang="{{ if eq .Data.locale "es" }}es{{ else if eq .Data.locale "en" }}en{{ else if eq .Data.locale "de" }}de{{ else }}it{{ end }}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>{{ if eq .Data.locale "es" }}${L.es.title}{{ else if eq .Data.locale "en" }}${L.en.title}{{ else if eq .Data.locale "de" }}${L.de.title}{{ else }}${L.it.title}{{ end }}</title>
</head>
<body style="margin:0; padding:0; background-color:#F7EEE0; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
    {{ if eq .Data.locale "es" }}${L.es.preheader}{{ else if eq .Data.locale "en" }}${L.en.preheader}{{ else if eq .Data.locale "de" }}${L.de.preheader}{{ else }}${L.it.preheader}{{ end }}
  </div>
{{ if eq .Data.locale "es" }}${block(L.es)}{{ else if eq .Data.locale "en" }}${block(L.en)}{{ else if eq .Data.locale "de" }}${block(L.de)}{{ else }}${block(L.it)}{{ end }}
</body>
</html>`;

// Subject must also localize. Go-template works in the subject field too.
const subject =
  `{{ if eq .Data.locale "es" }}${L.es.title} · Bali Flow{{ else if eq .Data.locale "en" }}${L.en.title} · Bali Flow{{ else if eq .Data.locale "de" }}${L.de.title} · Bali Flow{{ else }}${L.it.title} · Bali Flow{{ end }}`;

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${MGMT_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    mailer_subjects_confirmation: subject,
    mailer_templates_confirmation_content: html,
  }),
});

const out = await res.json();
console.log("HTTP", res.status);
console.log("subject set to:", out.mailer_subjects_confirmation);
console.log("template length:", (out.mailer_templates_confirmation_content || "").length);
