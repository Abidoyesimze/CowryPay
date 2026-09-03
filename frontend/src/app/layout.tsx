import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { InstallPrompt } from "@/components/InstallPrompt";

export const metadata: Metadata = {
  // Resolves the relative openGraph.images URL below into an absolute one
  // for social-preview cards — without this Next falls back to
  // http://localhost:3000, which is fine locally but wrong once deployed.
  // Set NEXT_PUBLIC_SITE_URL to the real deployed domain once it exists.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title:       "CowryPay — Talk. Send. Automate.",
  description: "AI-powered crypto payments on Celo. Send money as easily as sending a message.",
  // Not using the `manifest` shorthand here — Next 14's Metadata API
  // hardcodes crossOrigin="use-credentials" on the generated <link>, which
  // the manifest response (served with a wildcard Access-Control-Allow-
  // Origin) fails CORS for, so the browser silently refuses to load it.
  // Without a valid manifest, iOS can't recognize the site as installable
  // in standalone mode — "Add to Home Screen" just makes a bookmark that
  // opens inside Safari's chrome instead of fullscreen. Rendered as a
  // plain <link> below instead, which Next hoists into <head> without
  // adding crossOrigin.
  appleWebApp: {
    capable:       true,
    statusBarStyle: "black-translucent",
    title:         "CowryPay",
  },
  icons: {
    icon:     [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple:    [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title:       "CowryPay — Talk. Send. Automate.",
    description: "AI-powered conversational crypto payments on Celo.",
    images:      [{ url: "/icon-512.png" }],
  },
};

export const viewport: Viewport = {
  width:            "device-width",
  initialScale:     1,
  maximumScale:     1,
  userScalable:     false,   // prevent accidental pinch-zoom
  viewportFit:      "cover", // respect notch / safe-area on all phones
  themeColor:       "#0B0B0B",
  colorScheme:      "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <link rel="manifest" href="/manifest.json" />
      <body className="h-full overflow-hidden bg-cowry-dark font-sans antialiased">
        <ServiceWorkerRegister />
        {children}
        <InstallPrompt />
      </body>
    </html>
  );
}
