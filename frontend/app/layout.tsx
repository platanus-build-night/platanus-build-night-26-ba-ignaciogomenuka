import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BairesRadar — Fleet Ops',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-gray-950 text-gray-100 antialiased">{children}</body>
    </html>
  );
}
