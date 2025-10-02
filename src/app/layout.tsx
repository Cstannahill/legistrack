import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LegisTracker - Track U.S. Legislation in Plain English",
  description:
    "Stay informed about federal bills, executive orders, and government actions with AI-powered summaries that anyone can understand.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const date = new Date();
  const year = date.getFullYear();
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex min-h-screen flex-col bg-background`}
      >
        <Header />
        <main className="flex-1">{children}</main>
        <footer className="border-t py-6 md:py-0">
          <div className="container flex h-16 items-center justify-between text-sm text-muted-foreground">
            <p>© {year} LegisTracker. All rights reserved.</p>
            <p>Data from Congress.gov and Federal Register</p>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
