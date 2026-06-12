import { ImageResponse } from "next/og";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

// Link-preview image (WhatsApp / social). Social clients don't run CSS, so the
// soft-faded edges from the login screen can't be applied at display time — we
// bake them into the generated PNG here using the same radial mask as the login
// (`src/app/login/page.tsx`), so the logo blends into the card with no hard sides.
export const alt = "BaliFlow CRM";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CREAM = "rgb(252,246,237)";

export default async function Image() {
  const logoData = await readFile(join(process.cwd(), "public/logo-horizontal.png"), "base64");
  const logoSrc = `data:image/png;base64,${logoData}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: CREAM,
        }}
      >
        {/* Logo with faded edges — same radial mask as the login screen.
            Satori applies masks to a div's backgroundImage (not to <img>).
            The box is wider than the logo art so the fade lands on empty cream,
            never clipping the letters. */}
        <div
          style={{
            width: 980,
            height: 560,
            backgroundImage: `url(${logoSrc})`,
            backgroundSize: "760px auto",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            maskImage: "radial-gradient(67% 90% at 50% 50%, black 50%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(67% 90% at 50% 50%, black 50%, transparent 75%)",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
