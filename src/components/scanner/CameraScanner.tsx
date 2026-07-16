"use client";

// Phone-camera scanner — ONE component for both jobs:
//   • menu import: scan a restaurant's QR code → its URL goes straight into the
//     import field (today the owner has to open the QR by hand and paste the URL);
//   • inventory: scan a product's EAN/UPC barcode → its digits go into the
//     barcode field, so a delivery is put away by pointing the phone at the box.
//
// ZXing decodes both from the same video stream, so the only difference between
// the two uses is which symbologies we ask for and what we do with the result.
//
// The camera is a permission-gated device that can fail in ordinary ways (denied,
// busy, absent, insecure origin). Every one of those is surfaced as a readable
// line rather than a dead black rectangle — on a phone this is the whole feature.

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Camera, X, RefreshCw } from "lucide-react";

export type ScanMode = "qr" | "barcode";

const QR_FORMATS = [BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.AZTEC];
// The 1D symbologies actually printed on food/beverage packaging.
const BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
];

export interface ScannerStrings {
  title: string;
  hint: string;
  cancel: string;
  retry: string;
  errPermission: string;
  errNoCamera: string;
  errInsecure: string;
  errGeneric: string;
}

export function CameraScanner({
  mode,
  onResult,
  onClose,
  strings: ui,
}: {
  mode: ScanMode;
  /** Called once with the decoded text; the scanner stops itself first. */
  onResult: (text: string) => void;
  onClose: () => void;
  strings: ScannerStrings;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  // A decode fires repeatedly while the code stays in frame — latch so the
  // caller's onResult (which closes the modal) runs exactly once.
  const doneRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    doneRef.current = false;
    setError(null);

    // getUserMedia only exists on a secure origin (https / localhost). Saying so
    // beats a generic failure, because it's a deployment problem, not a user one.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext === false ? ui.errInsecure : ui.errNoCamera);
      return;
    }

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, mode === "qr" ? QR_FORMATS : BARCODE_FORMATS);
    // 1D barcodes on a curved package need the extra scan-line effort; a QR
    // doesn't, and asking for it there would only slow the loop down.
    if (mode === "barcode") hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);

    (async () => {
      try {
        const controls = await reader.decodeFromConstraints(
          // Rear camera on a phone; on a laptop this quietly falls back to the
          // only camera there is.
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current!,
          (result) => {
            if (!result || doneRef.current) return;
            doneRef.current = true;
            controls.stop();
            controlsRef.current = null;
            onResult(result.getText());
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string })?.name || "";
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? ui.errPermission
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? ui.errNoCamera
              : ui.errGeneric,
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
    // `attempt` re-runs the effect on Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, attempt, stop]);

  // Esc closes, like every other modal in the CRM.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl"
        style={{ border: "2px solid #c4956a" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-2 text-base font-bold text-black">
            <Camera className="h-5 w-5" /> {ui.title}
          </h3>
          <button onClick={onClose} className="cursor-pointer p-1 text-black" aria-label={ui.cancel}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm font-bold text-black">{error}</p>
            <button
              onClick={() => setAttempt((n) => n + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white cursor-pointer"
              style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}
            >
              <RefreshCw className="h-4 w-4" /> {ui.retry}
            </button>
          </div>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "4 / 3" }}>
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
              {/* Aiming frame — wide and short for a 1D barcode, square for a QR. */}
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg"
                style={{
                  width: mode === "qr" ? "62%" : "84%",
                  aspectRatio: mode === "qr" ? "1 / 1" : "5 / 2",
                  border: "3px solid rgba(255,255,255,0.9)",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.28)",
                }}
              />
            </div>
            <p className="mt-3 text-center text-xs text-black">{ui.hint}</p>
          </>
        )}
      </div>
    </div>
  );
}
