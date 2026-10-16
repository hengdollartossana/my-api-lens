import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Lens",
  description: "Verify APIs against their Swagger/OpenAPI spec",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
