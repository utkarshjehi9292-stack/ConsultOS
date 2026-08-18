import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ConsultOS",
  description: "Defensible, source-cited strategic analysis for founders and operators.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
