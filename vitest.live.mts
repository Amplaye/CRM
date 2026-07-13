// Config for the LIVE round-trip tests (*.manual.test.ts): they hit the real
// Supabase project + Resend, so they're kept OUT of the default suite.
//   npx vitest run --config vitest.live.mts
import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

// .env.local → process.env (this vitest build exposes no loadEnv helper).
const env: Record<string, string> = {};
for (const line of fs.readFileSync(path.resolve(__dirname, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.manual.test.ts"],
    globals: false,
    env,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
