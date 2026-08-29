import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: 'Lattice — Paper Options Desk',
  description: 'An explainable, read-only workspace for Alpaca paper options trading.',
  openGraph: {
    title: 'Lattice — Paper Options Desk',
    description: 'An explainable, read-only workspace for Alpaca paper options trading.',
    images: [{ url: '/og.png', width: 1792, height: 921, alt: 'Lattice paper options desk' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lattice — Paper Options Desk',
    description: 'An explainable, read-only workspace for Alpaca paper options trading.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
