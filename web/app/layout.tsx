import type { Metadata } from "next";
import "./globals.css";
import "./compact-copy.css";
import "./week-calendar-fix.css";

export const metadata: Metadata = {
  title: "Dayframe — dnešek má svůj plán",
  description: "Dnešní plán, soustředění a důležité termíny v jednom klidném pracovním prostoru.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="cs"><body>{children}</body></html>;
}
