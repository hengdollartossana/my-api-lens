import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Lens",
  description: "Verify APIs against their Swagger/OpenAPI spec",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint so there is no dark/light flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('apilens-theme')==='light')document.documentElement.classList.remove('dark')}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
