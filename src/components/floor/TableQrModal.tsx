"use client";

// Print sheet of per-table QR stickers for self-ordering. Each QR encodes
// /m/<slug>?table=<id> — permanent (survives menu edits and table renames,
// since the id is stable). Print layout: 2×2 cards per A4, cut lines included.

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer, X } from "lucide-react";

type QrTable = { id: string; name: string };

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
    const win = window.open("", "_blank", "width=840,height=1000");
    if (!win) return;
    const doc = win.document;
    doc.title = `QR — ${restaurantName}`;

    const style = doc.createElement("style");
    style.textContent = `
      @page { size: A4; margin: 10mm; }
      body { font-family: system-ui, -apple-system, sans-serif; color: #1c1917; margin: 0; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; }
      .card { border: 1px dashed #d6d3d1; text-align: center; padding: 10mm 6mm; page-break-inside: avoid; }
      .name { font-size: 12pt; font-weight: 800; margin: 0; }
      .table { font-size: 16pt; font-weight: 900; margin: 2mm 0 4mm; }
      .qr svg { width: 42mm; height: 42mm; }
      .hint { font-size: 8.5pt; color: #57534e; margin-top: 3mm; }
    `;
    doc.head.appendChild(style);

    const grid = doc.createElement("div");
    grid.className = "grid";
    for (const t of tables) {
      const svgEl = document.getElementById(`qr-table-${t.id}`);
      if (!svgEl) continue;
      const card = doc.createElement("div");
      card.className = "card";

      const name = doc.createElement("p");
      name.className = "name";
      name.textContent = restaurantName;
      card.appendChild(name);

      const tbl = doc.createElement("p");
      tbl.className = "table";
      tbl.textContent = `${labels.table} ${t.name}`;
      card.appendChild(tbl);

      const qr = doc.createElement("div");
      qr.className = "qr";
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(new XMLSerializer().serializeToString(svgEl), "image/svg+xml");
      qr.appendChild(doc.importNode(svgDoc.documentElement, true));
      card.appendChild(qr);

      const hint = doc.createElement("p");
      hint.className = "hint";
      hint.textContent = labels.scanHint;
      card.appendChild(hint);

      grid.appendChild(card);
    }
    doc.body.appendChild(grid);
    win.setTimeout(() => win.print(), 250);
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
