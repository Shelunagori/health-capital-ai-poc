import type { ReactNode } from 'react';
import { SessionProvider } from '@/lib/session';
import { SyntheticBanner } from '@/components/synthetic-banner';
import './globals.css';

export const metadata = {
  title: 'Health Capital',
  description: 'Check whether your health capital can pay for a healthcare expense.',
};

/** Without this the page renders at desktop width on a phone and every layout rule is moot. */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>
        <SyntheticBanner />
        <SessionProvider>
          <main className="shell">{children}</main>
        </SessionProvider>
        <footer className="footer">
          Independent synthetic-data proof of concept. Not based on or connected to any private
          company systems, data, APIs, or proprietary architecture. No compliance claim is made.
        </footer>
      </body>
    </html>
  );
}
