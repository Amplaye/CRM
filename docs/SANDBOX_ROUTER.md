# Sandbox WhatsApp router — testing many tenants on one number

> **TL;DR** While we share the single Twilio **sandbox** number across internal
> test tenants, the `[Router] WhatsApp` n8n workflow asks "which restaurant?"
> and forwards your messages to the right bot. A newly-onboarded CRM appears in
> that menu **automatically**. Real customers use their **own** WhatsApp number
> and never touch this router.

## Why this exists

The Twilio sandbox is **one** number (`whatsapp:+14155238886`) shared by every
test tenant. Twilio can point that number's "when a message comes in" webhook at
exactly **one** URL — so without a router, only one tenant could receive
WhatsApp at a time (this was Problem #3 in `docs/SAAS_ARCHITECTURE.md`).

The router sits on that single webhook (`/webhook/whatsapp-router`) and
disambiguates **per sender phone**, then forwards the raw Twilio body to the
chosen tenant's own chatbot webhook (`/webhook/<slug>-whatsapp`). Downstream the
tenant bot behaves exactly as if Twilio had delivered straight to it.

## How a tester uses it

1. Send any greeting (`hola`, `ciao`, `hi`, …) or `menu` to the sandbox number.
   The router replies with a numbered list of routable restaurants.
2. Reply with the **name** or the **number** (e.g. `picnic` or `1`).
   You're now connected to that bot; every following message goes to it.
3. Send `cambia` (or any greeting / `menu`) at any time to re-open the list and
   switch tenant.

Sessions are remembered per phone in the workflow's `staticData`
(`global.sessions`: `phone → slug`). A greeting/`menu`/`cambia` always re-opens
the menu (so the first "hola" of a session never gets eaten by an old binding).

## How a new CRM gets connected — automatically

The router reads its menu **live from the database** on every message:

```
GET /rest/v1/tenants?status=eq.active        (Supabase REST, service role)
  → keep rows where settings.provisioning.sandbox_routable === true
  → slug = settings.provisioning.slug  (fallback: slugify(name); Picnic = "picnic")
```

The self-serve onboarding orchestrator
(`src/lib/onboarding/orchestrator.ts`) writes, on completion:

```jsonc
settings.provisioning = {
  self_serve: true,
  whatsapp_attached: false,
  sandbox_routable: true,      // ← makes it show up in the router menu
  slug: "<name>-<id4>"
}
```

and flips the tenant to `status: active`. So the moment onboarding finishes, the
new restaurant is in the menu — **no edit to the router, no manual step.**

> Picnic predates the orchestrator and had no `provisioning` block, so it was
> back-filled once with `{ slug: "picnic", sandbox_routable: true }`.

## What about real customers? (the important distinction)

This router is a **test-bench tool for the shared sandbox only.** A real customer
gets their **own** WhatsApp Business number; Twilio delivers that number's
messages straight to that tenant's webhook — routing is automatic *by the number
itself*, no menu involved. A real customer's tenant simply won't carry
`sandbox_routable`, so it never appears in the shared test menu.

In other words: **one number = one tenant** is the product. The "which
restaurant?" menu only exists because, during internal testing, many tenants are
forced to share one sandbox number.

## Voice calls

Voice is a **separate channel** (Vapi), not WhatsApp — voice does **not** go
through this router. Test a tenant's voice agent via its web-call token / call
page, not via the sandbox number.

## Reverting / debugging

- The whole behavior lives in one node: `Route Message` (a Code node) inside the
  `[Router] WhatsApp` workflow. Edit or revert there; nothing else changes.
- The webhook in Twilio already points at `/webhook/whatsapp-router` — adding a
  tenant never touches Twilio.
- Inspect routing decisions in n8n → Executions of `[Router] WhatsApp`; each run
  returns `{ routed, via }` so you can see which tenant a message went to and why
  (`session` / `choice` / `direct` / menu).
