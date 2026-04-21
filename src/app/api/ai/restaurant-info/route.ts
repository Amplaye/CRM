import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';
import type { OpeningHours } from '@/lib/restaurant-rules';

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

    const supabase = createServiceRoleClient();

    // HOURS fast-path: always derive from settings.opening_hours so there is
    // ONE source of truth. The KB article may exist for legacy/display, but
    // the bot always gets the live structured schedule.
    const hoursTopics = new Set(['hours', 'schedule', 'horario', 'horarios']);
    if (hoursTopics.has(topicRaw)) {
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('settings')
        .eq('id', tenantId)
        .maybeSingle();
      const oh: OpeningHours = (tenantRow?.settings as any)?.opening_hours || {};
      const content = formatOpeningHours(oh);
      return NextResponse.json({
        success: true,
        topic: 'hours',
        found: true,
        source: 'settings.opening_hours',
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

    const all = data || [];
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
          articles: [],
        });
      }
    }

    return NextResponse.json({
      success: true,
      topic: topicRaw || 'all',
      found: true,
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
