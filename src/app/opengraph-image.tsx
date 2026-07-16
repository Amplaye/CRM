import { ImageResponse } from "next/og";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

// Link-preview image (WhatsApp / social). Social clients don't run CSS, so the
// soft-faded edges from the login screen can't be applied at display time.
// We bake them into `public/logo-og-faded.png` ahead of time: the logo is
// centred on its text and its alpha fades smoothly to transparent on every
// side. Dropped onto the cream background here, the edges melt in with no
// visible borders — and Satori only has to place a centred image, so none of
// its mask quirks can creep back in.
export const alt = "BaliFlow CRM";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CREAM = "rgb(252,246,237)";

export default async function Image() {
  const logoData = await readFile(join(process.cwd(), "public/logo-og-faded.png"), "base64");
  const logoSrc = `data:image/png;base64,${logoData}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: CREAM,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt="BaliFlow" width={820} height={553} />
      </div>
    ),
    { ...size }
  );
}
