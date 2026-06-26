import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';
import { assertActivePlan } from '@/lib/billing/guard';
import type { OpeningHours } from '@/lib/restaurant-rules';
import { restaurantFacts, getFeatures } from '@/lib/types/tenant-settings';

const DAY_NAMES_ES: Record<number, string> = {
  0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado',
};

function formatOpeningHours(oh: OpeningHours): string {
  const lines: string[] = [];
  for (let d = 0; d < 7; d++) {
    const slots = oh[String(d)] || [];
    if (slots.length === 0) {
      lines.push(`${DAY_NAMES_ES[d]}: CERRADO`);
      continue;
    }
    const parts = slots.map((s: any) => {
      const startHour = parseInt(s.open.split(':')[0]);
      const label = startHour < 17 ? 'almuerzo' : 'cena';
      return `${s.open}-${s.close} (${label})`;
    });
    lines.push(`${DAY_NAMES_ES[d]}: ${parts.join(' y ')}`);
  }
  return lines.join('\n');
}

// Topic → list of KB category or title keywords that match
const TOPIC_MAP: Record<string, { categories?: string[]; titleKeywords?: string[] }> = {
  hours: { titleKeywords: ['horario'] },
  schedule: { titleKeywords: ['horario'] },
  location: { titleKeywords: ['ubicación', 'ubicacion', 'contacto'] },
  contact: { titleKeywords: ['ubicación', 'ubicacion', 'contacto'] },
  services: { titleKeywords: ['servicios', 'familia', 'mascota', 'accesibilidad', 'takeaway', 'delivery'] },
  family: { titleKeywords: ['servicios', 'familia', 'mascota', 'accesibilidad'] },
  accessibility: { titleKeywords: ['accesibilidad', 'servicios'] },
  pets: { titleKeywords: ['mascota', 'servicios'] },
  takeaway: { titleKeywords: ['takeaway', 'delivery', 'servicios'] },
  delivery: { titleKeywords: ['takeaway', 'delivery', 'servicios'] },
  allergens: { titleKeywords: ['alérgeno', 'alergeno', 'intoleranc', 'gluten', 'celíac', 'celiac'] },
  // Commercial topics (price lists / set menus / buffets / cakes). These only ever
  // resolve when the tenant's `commercial_info_enabled` flag is ON — the gate below
  // strips every `commerciale` article from the candidate set when the flag is OFF,
  // so these keys simply find nothing then. Multilingual it/es/en/de keywords.
  commerciale: { categories: ['commerciale'] },
  commercial: { categories: ['commerciale'] },
  comercial: { categories: ['commerciale'] },
  torta: { categories: ['commerciale'], titleKeywords: ['torta', 'torte', 'cake', 'tarta', 'kuchen', 'torten'] },
  torte: { categories: ['commerciale'] },
  cake: { categories: ['commerciale'] },
  buffet: { categories: ['commerciale'], titleKeywords: ['buffet'] },
  banquet: { categories: ['commerciale'] },
  listino: { categories: ['commerciale'] },
  listini: { categories: ['commerciale'] },
  catering: { categories: ['commerciale'] },
  evento: { categories: ['commerciale'] },
  eventi: { categories: ['commerciale'] },
  event: { categories: ['commerciale'] },
  gruppi: { categories: ['commerciale'] },
  grupos: { categories: ['commerciale'] },
  groups: { categories: ['commerciale'] },
  policies: { categories: ['policies'] },
  menu: { categories: ['menu'] },
  carta: { categories: ['menu'] },
  pizza: { titleKeywords: ['pizza'] },
  pasta: { titleKeywords: ['pasta', 'gnocchi'] },
  dessert: { titleKeywords: ['postre', 'dulce'] },
  postres: { titleKeywords: ['postre', 'dulce'] },
  recommendations: { titleKeywords: ['recomendac', 'chef'] },
  recomendaciones: { titleKeywords: ['recomendac', 'chef'] },
  vegan: { titleKeywords: ['recomendac', 'pizza', 'pasta', 'gnocchi', 'alérgeno'] },
  vegetarian: { titleKeywords: ['recomendac', 'pizza', 'pasta', 'gnocchi'] },
};

export async function GET(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenant_id');
    const topicRaw = (searchParams.get('topic') || '').toLowerCase().trim();
    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'Missing tenant_id' }, { status: 400 });
    }

    const noPlan = await assertActivePlan(tenantId);
    if (noPlan) return noPlan;

    const supabase = createServiceRoleClient();

    // Read the tenant's settings once. Two uses: the structured opening hours
    // (below) and the venue `facts` derived from feature flags (terrace, pets,
    // events, languages) — config the assistant reads instead of per-tenant
    // hand-written KB text. `facts` rides on every response so the bot always
    // knows them. See docs/PIANO_SAAS.md (Mossa 3) and restaurantFacts().
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle();
    // Commercial module gate (per-tenant, free self-serve flag). When ON, the bot
    // may answer commercial questions (price lists / set menus / buffets / cakes)
    // from `commerciale` KB articles AND proactively offer them; the engine reads
    // `commercial_offers` (titles → tappable button labels) and `facts.commercial_info`
    // (whether to show the welcome hint). When OFF, no `commerciale` article is ever
    // exposed (filtered out below) and offers stay empty — the bot stays silent on
    // commercial topics. Generic: a second tenant flips the flag + writes its own
    // articles → its own answers and buttons, zero code change.
    const commercialOn = getFeatures(tenantRow?.settings).commercial_info_enabled;
    let commercialOffers: { title: string }[] = [];
    if (commercialOn) {
      const { data: cArts } = await supabase
        .from('knowledge_articles')
        .select('title')
        .eq('tenant_id', tenantId)
        .eq('status', 'published')
        .eq('category', 'commerciale')
        .order('display_order', { ascending: true });
      commercialOffers = (cArts || []).map((a: any) => ({ title: a.title }));
    }
    const facts = { ...restaurantFacts(tenantRow?.settings), commercial_info: commercialOffers.length > 0 };

    // HOURS fast-path: always derive from settings.opening_hours so there is
    // ONE source of truth. The KB article may exist for legacy/display, but
    // the bot always gets the live structured schedule.
    const hoursTopics = new Set(['hours', 'schedule', 'horario', 'horarios']);
    if (hoursTopics.has(topicRaw)) {
      const oh: OpeningHours = (tenantRow?.settings as any)?.opening_hours || {};
      const content = formatOpeningHours(oh);
      return NextResponse.json({
        success: true,
        topic: 'hours',
        found: true,
        source: 'settings.opening_hours',
        facts,
        commercial_offers: commercialOffers,
        articles: [{
          title: 'Horario del restaurante',
          category: 'general',
          content,
        }],
      });
    }

    let query = supabase
      .from('knowledge_articles')
      .select('title, category, content, display_order')
      .eq('tenant_id', tenantId)
      .eq('status', 'published')
      .order('display_order', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    // Gate: when the commercial module is OFF for this tenant, drop every
    // `commerciale` article from the candidate set BEFORE any topic match, so the
    // bot can never surface price lists/menus/buffets the owner hasn't enabled.
    const all = (data || []).filter((a: any) => a.category !== 'commerciale' || commercialOn);
    let filtered = all;

    if (topicRaw) {
      const mapEntry = TOPIC_MAP[topicRaw];
      if (mapEntry) {
        filtered = all.filter((a: any) => {
          const title = (a.title || '').toLowerCase();
          if (mapEntry.categories && mapEntry.categories.includes(a.category)) return true;
          if (mapEntry.titleKeywords && mapEntry.titleKeywords.some((k) => title.includes(k))) return true;
          return false;
        });
      } else {
        // Free-text fallback: match the topic against title/content/category
        const t = topicRaw;
        filtered = all.filter((a: any) =>
          (a.title || '').toLowerCase().includes(t) ||
          (a.category || '').toLowerCase().includes(t) ||
          (a.content || '').toLowerCase().includes(t)
        );
      }

      if (filtered.length === 0) {
        return NextResponse.json({
          success: true,
          topic: topicRaw,
          found: false,
          message: 'No tengo esa información específica registrada. ¿Quieres que te pase con el responsable?',
          facts,
          commercial_offers: commercialOffers,
          articles: [],
        });
      }
    }

    return NextResponse.json({
      success: true,
      topic: topicRaw || 'all',
      found: true,
      facts,
      commercial_offers: commercialOffers,
      articles: filtered.map((a: any) => ({
        title: a.title,
        category: a.category,
        content: a.content,
      })),
    });
  } catch (err: any) {
    console.error('restaurant-info error:', err);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
