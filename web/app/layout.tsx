import "./globals.css";
import type { Metadata } from 'next';
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: 'Zartman.io',
  description: 'Manufacturing OS — quotes, messaging, suppliers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-page text-ink font-sans">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
