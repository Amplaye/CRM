import type { ComponentType } from "react";
import type { SiteData } from "@/lib/site/types";
import type { SiteTemplateKey } from "@/lib/types/tenant-settings";
import SuerteTemplate from "./SuerteTemplate";
import DolceVitaTemplate from "./DolceVitaTemplate";
import ChampinoneriaTemplate from "./ChampinoneriaTemplate";
import PicnicTemplate from "./PicnicTemplate";
import PerezBeersTemplate from "./PerezBeersTemplate";
import VascoTemplate from "./VascoTemplate";
import MontesdeocaTemplate from "./MontesdeocaTemplate";
// Data comes from the pure module (NOT from the "use client" template files:
// a server component importing those would get opaque client-reference
// proxies whose spread is {} — see defaults.ts).
import {
  CHAMPINONERIA_DEFAULTS, CHAMPINONERIA_FONTS,
  DOLCEVITA_DEFAULTS, DOLCEVITA_FONTS,
  MONTESDEOCA_DEFAULTS, MONTESDEOCA_FONTS,
  PEREZBEERS_DEFAULTS, PEREZBEERS_FONTS,
  PICNIC_DEFAULTS, PICNIC_FONTS,
  SUERTE_DEFAULTS, SUERTE_FONTS,
  VASCO_DEFAULTS, VASCO_FONTS,
} from "./defaults";

// One entry per demo-site template ("classic" is NOT here — it's the original
// form-driven design rendered inline by /s/[slug]). `defaults` is the full
// editable-block copy; owner overrides live in settings.site_content[key].
// `swatches`/`fontLabel` feed the picker cards in the Website dashboard.

export type SiteTemplateDef = {
  component: ComponentType<{ data: SiteData }>;
  defaults: Record<string, string>;
  fontsHref: string;
  label: string;
  vibe: string;
  /** The template's "key" colours, in the order they cascade as `--c1`, `--c2`,
   * … `--cN`. These ARE the built-in palette (fallbacks) AND the default
   * swatches shown on the picker card. Each template's JSX reads the matching
   * colour via `var(--cN, <this hex>)`, so leaving the palette unset renders
   * byte-identical to before. The first three slots keep their historical
   * meaning so older 3-colour overrides still resolve; templates expose extra
   * slots (background/text/surfaces) so every section can be recoloured. */
  swatches: string[];
  /** Human labels (it) for the swatches, in c1..cN order — used by the editor's
   * colour panel so each picker says what it recolours in THIS template
   * (e.g. "Sfondo" / "Accento" / "Testo"). Same length as `swatches`. */
  paletteLabels: string[];
  /** Which swatch index (0-based) is the booking-widget accent, so the widget
   * follows a recoloured palette. */
  accentIndex: number;
  fontLabel: string;
  /** Brand accent for the floating booking widget (matches each template's
   * own CTA colour). */
  accent: string;
};

export const SITE_TEMPLATE_DEFS: Record<Exclude<SiteTemplateKey, "classic">, SiteTemplateDef> = {
  suerte: {
    component: SuerteTemplate,
    defaults: SUERTE_DEFAULTS,
    fontsHref: SUERTE_FONTS,
    label: "Trattoria",
    vibe: "Neobrutalist di quartiere — crema, pomodoro, ombre nette",
    swatches: ["#f4ecdd", "#c0432b", "#2f5a3a", "#2a2420", "#d69a3c", "#2e6e8e"],
    paletteLabels: ["Sfondo", "Accento", "Secondario", "Testo", "Dettagli", "Ombre"],
    accentIndex: 1,
    fontLabel: "Fraunces",
    accent: "#c0432b",
  },
  dolcevita: {
    component: DolceVitaTemplate,
    defaults: DOLCEVITA_DEFAULTS,
    fontsHref: DOLCEVITA_FONTS,
    label: "Romantico",
    vibe: "Invito a cena romantico — vino, crema, sigillo di ceralacca",
    swatches: ["#7c2230", "#f6eee0", "#c0392b", "#4a5226", "#e8b197", "#d9a441"],
    paletteLabels: ["Vino", "Sfondo", "Accento", "Verde", "Pesca", "Oro"],
    accentIndex: 2,
    fontLabel: "Fraunces",
    accent: "#c0392b",
  },
  champinoneria: {
    component: ChampinoneriaTemplate,
    defaults: CHAMPINONERIA_DEFAULTS,
    fontsHref: CHAMPINONERIA_FONTS,
    label: "Bistró",
    vibe: "Bistró editoriale caldo — carta crema, cacao scuro, corsivo",
    swatches: ["#f5eee0", "#2a1d12", "#a6724b", "#7a6a56", "#b08d57", "#ede4d3"],
    paletteLabels: ["Sfondo", "Testo scuro", "Accento", "Testo tenue", "Oro", "Superficie"],
    accentIndex: 2,
    fontLabel: "Cormorant",
    accent: "#a6724b",
  },
  picnic: {
    component: PicnicTemplate,
    defaults: PICNIC_DEFAULTS,
    fontsHref: PICNIC_FONTS,
    label: "Cinematico",
    vibe: "Napoletano notturno — nero, ruggine, serif corsivo",
    swatches: ["#000000", "#c94a1a", "#f7f3ed", "#0f0f0f", "#1a1a1a"],
    paletteLabels: ["Sfondo", "Accento", "Testo chiaro", "Riquadri", "Superficie"],
    accentIndex: 1,
    fontLabel: "Playfair",
    accent: "#c94a1a",
  },
  perezbeers: {
    component: PerezBeersTemplate,
    defaults: PEREZBEERS_DEFAULTS,
    fontsHref: PEREZBEERS_FONTS,
    label: "Birreria",
    vibe: "Beer-hall serale — basalto, oro candela, rosso mattone",
    swatches: ["#120D0A", "#DCA03C", "#C5392C", "#EDE6D8", "#F0CD82"],
    paletteLabels: ["Sfondo", "Oro", "Accento", "Testo chiaro", "Oro chiaro"],
    accentIndex: 2,
    fontLabel: "Poppins",
    accent: "#C5392C",
  },
  vasco: {
    component: VascoTemplate,
    defaults: VASCO_DEFAULTS,
    fontsHref: VASCO_FONTS,
    label: "Taverna",
    vibe: "Tasca basca editoriale — crema, rosso e verde, polaroid",
    swatches: ["#f5efe1", "#c82020", "#0d3a20", "#221c18", "#f4b400", "#e8dcc6"],
    paletteLabels: ["Sfondo", "Rosso", "Verde", "Testo", "Oro", "Superficie"],
    accentIndex: 1,
    fontLabel: "Fraunces",
    accent: "#c82020",
  },
  montesdeoca: {
    component: MontesdeocaTemplate,
    defaults: MONTESDEOCA_DEFAULTS,
    fontsHref: MONTESDEOCA_FONTS,
    label: "Elegante",
    vibe: "Palazzo a lume di candela — espresso, ottone, serif leggero",
    swatches: ["#1c1712", "#b08d4f", "#efe7d6", "#2e3d32", "#5a2a33", "#a8553a"],
    paletteLabels: ["Sfondo", "Ottone", "Carta", "Verde", "Vino", "Terracotta"],
    accentIndex: 1,
    fontLabel: "Cormorant",
    accent: "#b08d4f",
  },
};

export function isDemoTemplate(key: SiteTemplateKey | undefined): key is Exclude<SiteTemplateKey, "classic"> {
  return !!key && key !== "classic" && key in SITE_TEMPLATE_DEFS;
}

// ——— Palette (colour override) helpers ———
// The three key colours cascade onto the template wrapper as --c1/--c2/--c3.
// Each template's JSX reads `var(--cN, <builtin hex>)`, so an unset palette is
// identical to the built-in look. Overrides are stored per template in
// settings.site_palette[key] as [c1, c2, c3].

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** True for a well-formed 3- or 6-digit hex colour. Guards against malformed
 * stored data leaking a bad value into inline CSS. */
export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v.trim());
}

/** Resolve the effective palette for a template: the stored override where each
 * slot is a valid hex, otherwise the template's built-in swatch for that slot.
 * Returns one colour per registry swatch (length = swatches.length), so an
 * older, shorter override just leaves the extra slots at their defaults. */
export function resolvePalette(
  key: Exclude<SiteTemplateKey, "classic">,
  override?: readonly string[] | null,
): string[] {
  const base = SITE_TEMPLATE_DEFS[key].swatches;
  return base.map((swatch, i) => {
    const v = override?.[i];
    return isHexColor(v) ? v.trim() : swatch;
  });
}

/** CSS custom properties to spread on the template wrapper. Only sets a var
 * when the resolved colour DIFFERS from the built-in swatch, so untouched
 * templates emit no palette vars at all (byte-identical output + smaller DOM).
 * The template still renders correctly because its `var(--cN, hex)` fallbacks
 * equal the swatches. */
export function paletteVars(
  key: Exclude<SiteTemplateKey, "classic">,
  override?: readonly string[] | null,
): Record<string, string> {
  const resolved = resolvePalette(key, override);
  const base = SITE_TEMPLATE_DEFS[key].swatches;
  const vars: Record<string, string> = {};
  resolved.forEach((c, i) => {
    if (c.toLowerCase() !== base[i].toLowerCase()) vars[`--c${i + 1}`] = c;
  });
  return vars;
}

/** The booking-widget accent that follows a recoloured palette (the template's
 * accent swatch, overridden if the owner changed it). */
export function paletteAccent(
  key: Exclude<SiteTemplateKey, "classic">,
  override?: readonly string[] | null,
): string {
  return resolvePalette(key, override)[SITE_TEMPLATE_DEFS[key].accentIndex];
}
