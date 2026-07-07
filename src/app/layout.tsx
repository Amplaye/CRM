import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { LanguageProvider } from "@/lib/contexts/LanguageContext";
import { SandEffectWrapper } from "@/components/SandEffectWrapper";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://crm.baliflowagency.com"),
  title: "BaliFlow CRM",
  description: "BaliFlow CRM - Business Operations Dashboard",
  applicationName: "BaliFlow CRM",
  // iOS has no manifest-based install: these meta tags are what make
  // "Add to Home Screen" open the CRM full-screen like an app on iPad/iPhone.
  appleWebApp: {
    capable: true,
    title: "BaliFlow CRM",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "BaliFlow CRM",
    description: "BaliFlow CRM - Business Operations Dashboard",
    siteName: "BaliFlow CRM",
    type: "website",
  },
};

// Do NOT disable zoom. Owners (often non-technical) fill this on their phone
// and must be able to pinch-zoom the dense onboarding form; blocking it is also
// a WCAG failure. Auto-zoom-on-input-focus is already prevented by the
// `font-size:16px` rule in globals.css, so capping the scale is unnecessary.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  // Paint behind the iOS notch/home bar in standalone (installed) mode and
  // tint the browser UI to the app's cream background.
  viewportFit: "cover" as const,
  themeColor: "#FCF6ED",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LanguageProvider>
          <Providers>
            <SandEffectWrapper />
            {children}
          </Providers>
        </LanguageProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
