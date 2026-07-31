import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgriSense AI — Agentic Agricultural Advisor",
  description: "Autonomous AI advisor that takes a Bangladeshi smallholder farmer from empty field to costed, weather-aware season plan. Built for Bdapps Agentic AI Hackathon, IUT 12th ICT Fest.",
  keywords: ["AgriSense", "AI", "agriculture", "Bangladesh", "agent", "RAG", "Open-Meteo", "BARC", "DAE"],
  authors: [{ name: "Team AgriSense" }],
  icons: {
    icon: "https://scontent.fdac174-1.fna.fbcdn.net/v/t39.30808-6/749652173_1721619442364288_6037650805412570207_n.jpg?stp=dst-jpg_tt6&cstp=mx233x194&ctp=s233x194&_nc_cat=106&ccb=1-7&_nc_sid=127cfc&_nc_eui2=AeEPKnxdXYdkPhbuxdTX0nOJS_P0UQSncMFL8_RRBKdwwYXjWtJdkbPR12DcJtWAkts00Bn831ciiTvUUF2kEMqN&_nc_ohc=mg7XSjCyX7YQ7kNvwEcdCv1&_nc_oc=AdrWUzpnjg1J9Gx4jSFufgise4EH2W7a9AaxJZnljasarElwGbjXfRJ4Txrg3HMgNbc&_nc_zt=23&_nc_ht=scontent.fdac174-1.fna&_nc_gid=LQMcZg2-FEoLEp-45hxjfw&_nc_ss=7b2a8&oh=00_AQCfsvS-9Hb5NzmmoVDv85zOZSkRaKM8ai0c66DpU1_Qtw&oe=6A69F8F9",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
