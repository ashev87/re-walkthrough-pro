import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/server/session";
import { LogoutButton } from "@/components/LogoutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "Exposé-to-Reel DE",
  description:
    "Autorisierte Immobilien-Exposés in kinoreife Walkthrough-Videos verwandeln.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  return (
    <html lang="de">
      <body>
        {user && (
          <header className="site-header">
            <Link href="/" className="brand">
              Exposé-to-Reel <span>DE</span>
            </Link>
            <div className="user">
              <span>
                {user.name} · {user.organizationName}
              </span>
              <LogoutButton />
            </div>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
