// Branded HTML email layout — plain template-string rendering, NO react-email
// dependency (simplicity: emails are static enough that string templates are
// the whole job, and they unit-test as pure functions). Every product email
// (deposit link, gift card, review ask, campaigns) wraps its body in
// renderEmailLayout() so branding stays in ONE place; per-tenant colours/logo
// come from tenants.settings (menu_branding/site_branding), never hardcoded.

export interface EmailBranding {
  /** Restaurant display name, used in header + footer. */
  name: string;
  /** Accent hex like "#7c3aed". Unset → neutral dark. */
  brand_color?: string;
  /** Public logo URL (branding bucket). Unset → text wordmark. */
  logo_url?: string;
}

/** Escape user-provided text before interpolating into HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailLayoutParams {
  branding: EmailBranding;
  /** Preheader — the inbox preview line (hidden in the body). */
  preheader?: string;
  /** Main content HTML (already escaped where user-provided). */
  bodyHtml: string;
  /** Optional single CTA button. */
  cta?: { label: string; url: string };
  /** Footer line, e.g. unsubscribe link for marketing (compliance: REQUIRED
   * on campaign emails — the campaigns sender always passes it). */
  footerHtml?: string;
}

/** Wrap content in the shared table-based layout (email clients need tables +
 * inline styles; flex/grid and <style> blocks are unreliable in Outlook/Gmail). */
export function renderEmailLayout(p: EmailLayoutParams): string {
  const accent = p.branding.brand_color || "#111827";
  const name = escapeHtml(p.branding.name);
  const header = p.branding.logo_url
    ? `<img src="${p.branding.logo_url}" alt="${name}" height="40" style="max-height:40px;border:0;display:block;margin:0 auto;" />`
    : `<div style="font-size:20px;font-weight:700;color:#111827;text-align:center;">${name}</div>`;
  const cta = p.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 0;"><tr><td style="border-radius:10px;background:${accent};">
         <a href="${p.cta.url}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(p.cta.label)}</a>
       </td></tr></table>`
    : "";
  const preheader = p.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(p.preheader)}</div>`
    : "";
  const footer = p.footerHtml
    ? `<tr><td style="padding:20px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#111827;text-align:center;">${p.footerHtml}</td></tr>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td style="padding:28px 32px 0;">${header}</td></tr>
  <tr><td style="padding:24px 32px 32px;font-size:15px;line-height:1.6;color:#111827;">
    ${p.bodyHtml}
    ${cta}
  </td></tr>
  ${footer}
</table>
<div style="padding:16px;font-size:11px;color:#111827;text-align:center;">${name}</div>
</td></tr>
</table>
</body></html>`;
}
