# Sandbox WhatsApp router — testing many tenants on one number

> **TL;DR** While we share a single **Meta sandbox** number across internal
> test tenants, the `[Meta Router] WhatsApp` n8n workflow asks "which restaurant?"
> and forwards your messages to the right bot. A newly-provisioned CRM appears in
> that menu **automatically**. Real customers use their **own** WhatsApp number
> and never touch this router.

> **History:** this used to run on the Twilio sandbox via `[Router] WhatsApp`
> (`/webhook/whatsapp-router`, now disabled). It was replaced by the Meta Cloud
> API router during the May-2026 Twilio→Meta migration. The contract below is the
> **Meta** one.

## Why this exists

The Meta sandbox is **one** number (`+1 555 642-2317`, phone-id
`1095078260361095`) shared by every test tenant. Meta delivers that number's
inbound messages to exactly **one** webhook — so without a router, only one
tenant could receive WhatsApp at a time (Problem #3 in `docs/SAAS_ARCHITECTURE.md`).

The router sits on that single webhook (`/webhook/meta-whatsapp-router`) and
disambiguates **per sender phone**, then forwards the raw Meta body to the chosen
tenant's own chatbot webhook (`/webhook/<slug>-whatsapp`). Downstream the tenant
bot behaves exactly as if Meta had delivered straight to it.

## How a tester uses it

1. Send any first message (`ciao`, `hola`, `hi`, …) to the sandbox number.
   A number with no active session gets a numbered list of routable restaurants.
2. Reply with the **name** or the **number** (e.g. `picnic` or `1`).
   You're now connected to that bot; every following message goes to it.
3. Send `reset` at any time to clear the binding and re-open the list to switch
   tenant (replaces the old Twilio `hola`/`cambia` trigger).

Sessions are remembered per phone in the workflow's `staticData`
(`global.sessions`: `phone → { tenant_id, last_activity }`) with a **24h TTL**.
A `reset` (checked before the sticky session) always re-opens the menu.

## How a new CRM gets connected — automatically

The router reads its menu **live from the database** on every message:

```
GET /rest/v1/tenants?status=eq.active        (Supabase REST, service role)
  → keep rows where settings.provisioning.sandbox_routable === true
  → slug = settings.provisioning.slug  (fallback: slugify(name); Picnic = "picnic")
```

The onboarding orchestrator (`src/lib/onboarding/orchestrator.ts`) writes, on
completion of **either** path (admin wizard **and** self-serve — during the demo
phase every tenant we create must show up):

```jsonc
settings.provisioning = {
  whatsapp_attached: false,
  sandbox_routable: true,      // ← makes it show up in the router menu
  slug: "<name>-<id4>",        // matches the cloned chatbot path "<slug>-whatsapp"
  // self_serve + completed_at added only on the self-serve path
}
```

and flips the tenant to `status: active`. So the moment onboarding finishes, the
new restaurant is in the menu — **no edit to the router, no manual step.** (Note:
the router caches the tenant list in `staticData` for 5 min, so a brand-new tenant
can take up to 5 min to appear.)

> Two tenants predate this and were back-filled once by hand:
> Picnic `{ slug: "picnic", sandbox_routable: true }`, and
> BALI Rest `{ slug: "bali-rest-6978", sandbox_routable: true }` (2026-05-30).

## What about real customers? (the important distinction)

This router is a **test-bench tool for the shared sandbox only.** A real customer
gets their **own** WhatsApp Business number; Meta delivers that number's messages
straight to that tenant's webhook — routing is automatic *by the number itself*,
no menu involved. A real customer's tenant won't carry `sandbox_routable` (cleared
at number-attach time), so it never appears in the shared test menu. At that point
the router's hardcoded shared Meta creds must also be extended to look up each
tenant's own phone-id/token — see the "Router shared META creds" note in the
migration memory.

In other words: **one number = one tenant** is the product. The "which
restaurant?" menu only exists because, during internal testing, many tenants are
forced to share one sandbox number.

## Voice calls

Voice is a **separate channel** (Vapi), not WhatsApp — voice does **not** go
through this router. Test a tenant's voice agent via its web-call token / call
page, not via the sandbox number.

## Reverting / debugging

- The whole behavior lives in one node: `Route Message` (a Code node) inside the
  `[Meta Router] WhatsApp` workflow (n8n id `zuYx8raoBVz88Erj`). Edit or revert
  there; nothing else changes.
- The Meta phone points at `/webhook/meta-whatsapp-router` (phone-level webhook
  override) — adding a tenant never touches the Meta dashboard.
- Inspect routing decisions in n8n → Executions of `[Meta Router] WhatsApp`; each
  run returns `{ ok, routed_to, ... }` (or `{ menu_sent, tenants_offered }`) so you
  can see which tenant a message went to and why.
