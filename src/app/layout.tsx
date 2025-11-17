import "./globals.css";
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Zartman.io',
  description: 'Manufacturing OS — quotes, messaging, suppliers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
