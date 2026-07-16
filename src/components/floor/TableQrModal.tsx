"use client";

// Print sheet of per-table QR stickers for self-ordering. Each QR encodes
// /m/<slug>?table=<id> — permanent (survives menu edits and table renames,
// since the id is stable). Print layout: 2×2 cards per A4, cut lines included.

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer, X } from "lucide-react";

type QrTable = { id: string; name: string };

// Escape user-controlled text (restaurant + table names) before it goes into the
// print-sheet HTML string, so a stray < or & can't break the markup.
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function TableQrModal({
  restaurantName,
  slug,
  tables,
  labels,
  onClose,
}: {
  restaurantName: string;
  slug: string;
  tables: QrTable[];
  labels: { title: string; desc: string; print: string; scanHint: string; table: string };
  onClose: () => void;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const urlFor = (t: QrTable) => `${origin || ""}/m/${slug}?table=${t.id}`;

  const handlePrint = () => {
    // Print via a hidden same-document iframe, NOT window.open: Brave (and Safari's
    // popup blocker) silently kill a programmatic window.open("", "_blank"), which
    // left the "Print" button doing nothing. An iframe isn't a popup, so it always
    // works. We build the sheet as a full HTML document and print its contentWindow.
    const cards = tables
      .map((t) => {
        const svgEl = document.getElementById(`qr-table-${t.id}`);
        if (!svgEl) return "";
        const svg = new XMLSerializer().serializeToString(svgEl);
        return `<div class="card">
          <p class="name">${esc(restaurantName)}</p>
          <p class="table">${esc(labels.table)} ${esc(t.name)}</p>
          <div class="qr">${svg}</div>
          <p class="hint">${esc(labels.scanHint)}</p>
        </div>`;
      })
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8">
      <title>QR — ${esc(restaurantName)}</title>
      <style>
        @page { size: A4; margin: 10mm; }
        body { font-family: system-ui, -apple-system, sans-serif; color: #1c1917; margin: 0; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; }
        .card { border: 1px dashed #d6d3d1; text-align: center; padding: 10mm 6mm; page-break-inside: avoid; }
        .name { font-size: 12pt; font-weight: 800; margin: 0; }
        .table { font-size: 16pt; font-weight: 900; margin: 2mm 0 4mm; }
        .qr svg { width: 42mm; height: 42mm; }
        .hint { font-size: 8.5pt; color: #57534e; margin-top: 3mm; }
      </style></head>
      <body><div class="grid">${cards}</div></body></html>`;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    iframe.srcdoc = html;
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) { iframe.remove(); return; }
      // Give the browser a tick to lay out the SVGs before invoking print.
      win.setTimeout(() => {
        win.focus();
        win.print();
        // Remove after the print dialog settles (it blocks synchronously in most
        // browsers; the timeout covers the async ones).
        setTimeout(() => iframe.remove(), 1000);
      }, 250);
    };
    document.body.appendChild(iframe);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "#eaddcb" }}>
          <div>
            <h3 className="text-lg font-bold text-black">{labels.title}</h3>
            <p className="text-xs text-black mt-0.5">{labels.desc}</p>
          </div>
          <button onClick={onClose} aria-label="close" className="text-black/50 hover:text-black cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {tables.map((t) => (
            <div key={t.id} className="rounded-xl border p-3 text-center" style={{ borderColor: "#eaddcb" }}>
              <p className="text-sm font-bold text-black mb-2 truncate">{labels.table} {t.name}</p>
              {origin ? (
                <QRCodeSVG id={`qr-table-${t.id}`} value={urlFor(t)} size={104} level="M" includeMargin className="mx-auto" />
              ) : null}
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t" style={{ borderColor: "#eaddcb" }}>
          <button
            onClick={handlePrint}
            className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-white font-bold cursor-pointer"
            style={{ background: "linear-gradient(135deg, #c4956a 0%, #b8845c 100%)" }}
          >
            <Printer className="w-4 h-4" /> {labels.print}
          </button>
        </div>
      </div>
    </div>
  );
}
