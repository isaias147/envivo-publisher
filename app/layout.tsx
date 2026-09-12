import type { Metadata, Viewport } from "next";
import { Archivo, Instrument_Sans } from "next/font/google";
import "./globals.css";

// Archivo: títulos, horas y botones principales (700/800)
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
});

// Instrument Sans: cuerpo y datos
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "EnVivo Publisher",
  description: "Registro de publicadores de EnVivo.",
};

export const viewport: Viewport = {
  themeColor: "#161A3D",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${archivo.variable} ${instrumentSans.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
