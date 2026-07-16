// Guard against the assistant falling behind the product: every tenant-facing
// dashboard section MUST be covered by at least one KB topic that links to it.
// Add a feature section without teaching the assistant → this test fails.
// (Convention in CLAUDE.md: new user-facing feature = new/updated kb.ts topic,
// all 4 languages.)

import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { KB, SUGGESTED_TOPIC_IDS, topicById, type AssistantLang } from "./kb";

const LANGS: AssistantLang[] = ["it", "en", "es", "de"];

// Sections that intentionally have no assistant topic.
const EXEMPT = new Set([
  "admin", // platform admin — not tenant-facing
]);

function dashboardSections(): string[] {
  const dir = join(process.cwd(), "src", "app", "(dashboard)");
  return readdirSync(dir).filter((name) => {
    try {
      return statSync(join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

describe("assistant KB coverage", () => {
  it("covers every tenant-facing dashboard section with a linked topic", () => {
    const linked = new Set(
      KB.flatMap((t) => (t.links || []).map((l) => l.href.split("/")[1])).filter(Boolean),
    );
    const missing = dashboardSections().filter(
      (section) => !EXEMPT.has(section) && !linked.has(section),
    );
    expect(
      missing,
      `Sections without an assistant topic: ${missing.join(", ")}. ` +
        "Add a KbTopic in src/lib/assistant/kb.ts (it/en/es/de) with a link to the section.",
    ).toEqual([]);
  });

  it("every topic is complete in all 4 languages", () => {
    for (const topic of KB) {
      expect(topic.keywords.length, `${topic.id}: no keywords`).toBeGreaterThan(0);
      for (const lang of LANGS) {
        expect(topic.title[lang]?.trim(), `${topic.id}: missing title[${lang}]`).toBeTruthy();
        expect(topic.answer[lang]?.trim(), `${topic.id}: missing answer[${lang}]`).toBeTruthy();
        for (const link of topic.links || []) {
          expect(link.label[lang]?.trim(), `${topic.id}: missing link label[${lang}]`).toBeTruthy();
        }
        for (const step of Object.values(topic.steps || {})) {
          expect(step.length, `${topic.id}: empty steps[]`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("related ids and suggested ids all resolve to real topics", () => {
    for (const topic of KB) {
      for (const rel of topic.related || []) {
        expect(topicById(rel), `${topic.id}: related "${rel}" does not exist`).toBeTruthy();
      }
    }
    for (const id of SUGGESTED_TOPIC_IDS) {
      expect(topicById(id), `suggested "${id}" does not exist`).toBeTruthy();
    }
  });

  it("topic ids are unique", () => {
    const ids = KB.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
