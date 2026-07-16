import type { Metadata } from "next";
import Nav from "@/components/Nav";
import AuthGate from "@/components/AuthGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "AetherESports",
  description: "AetherESports — improve your VGC game.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthGate>
          <Nav />
          <main className="container">{children}</main>
        </AuthGate>
      </body>
    </html>
  );
}
