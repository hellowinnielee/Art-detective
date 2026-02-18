import type { Metadata } from "next";
import { Geist, Geist_Mono, Courier_Prime, Inter, Special_Elite, Stardos_Stencil } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const courierPrime = Courier_Prime({
  weight: "400",
  variable: "--font-courier-prime",
  subsets: ["latin"],
});

const stardosStencil = Stardos_Stencil({
  weight: ["400", "700"],
  variable: "--font-stardos-stencil",
  subsets: ["latin"],
});

const specialElite = Inter({
  variable: "--font-special-elite",
  subsets: ["latin"],
});

const specialEliteDisplay = Special_Elite({
  weight: "400",
  variable: "--font-special-elite-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Art Detective",
  description: "Art Detective migrated to Next.js",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${courierPrime.variable} ${stardosStencil.variable} ${specialElite.variable} ${specialEliteDisplay.variable}`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}

