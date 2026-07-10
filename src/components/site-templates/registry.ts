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
  swatches: [string, string, string];
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
    swatches: ["#f4ecdd", "#c0432b", "#2f5a3a"],
    fontLabel: "Fraunces",
    accent: "#c0432b",
  },
  dolcevita: {
    component: DolceVitaTemplate,
    defaults: DOLCEVITA_DEFAULTS,
    fontsHref: DOLCEVITA_FONTS,
    label: "Romantico",
    vibe: "Invito a cena romantico — vino, crema, sigillo di ceralacca",
    swatches: ["#7c2230", "#f6eee0", "#c0392b"],
    fontLabel: "Fraunces",
    accent: "#c0392b",
  },
  champinoneria: {
    component: ChampinoneriaTemplate,
    defaults: CHAMPINONERIA_DEFAULTS,
    fontsHref: CHAMPINONERIA_FONTS,
    label: "Bistró",
    vibe: "Bistró editoriale caldo — carta crema, cacao scuro, corsivo",
    swatches: ["#f5eee0", "#2a1d12", "#a6724b"],
    fontLabel: "Cormorant",
    accent: "#a6724b",
  },
  picnic: {
    component: PicnicTemplate,
    defaults: PICNIC_DEFAULTS,
    fontsHref: PICNIC_FONTS,
    label: "Cinematico",
    vibe: "Napoletano notturno — nero, ruggine, serif corsivo",
    swatches: ["#000000", "#c94a1a", "#f7f3ed"],
    fontLabel: "Playfair",
    accent: "#c94a1a",
  },
  perezbeers: {
    component: PerezBeersTemplate,
    defaults: PEREZBEERS_DEFAULTS,
    fontsHref: PEREZBEERS_FONTS,
    label: "Birreria",
    vibe: "Beer-hall serale — basalto, oro candela, rosso mattone",
    swatches: ["#120D0A", "#DCA03C", "#C5392C"],
    fontLabel: "Poppins",
    accent: "#C5392C",
  },
  vasco: {
    component: VascoTemplate,
    defaults: VASCO_DEFAULTS,
    fontsHref: VASCO_FONTS,
    label: "Taverna",
    vibe: "Tasca basca editoriale — crema, rosso e verde, polaroid",
    swatches: ["#f5efe1", "#c82020", "#0d3a20"],
    fontLabel: "Fraunces",
    accent: "#c82020",
  },
  montesdeoca: {
    component: MontesdeocaTemplate,
    defaults: MONTESDEOCA_DEFAULTS,
    fontsHref: MONTESDEOCA_FONTS,
    label: "Elegante",
    vibe: "Palazzo a lume di candela — espresso, ottone, serif leggero",
    swatches: ["#1c1712", "#b08d4f", "#efe7d6"],
    fontLabel: "Cormorant",
    accent: "#b08d4f",
  },
};

export function isDemoTemplate(key: SiteTemplateKey | undefined): key is Exclude<SiteTemplateKey, "classic"> {
  return !!key && key !== "classic" && key in SITE_TEMPLATE_DEFS;
}
