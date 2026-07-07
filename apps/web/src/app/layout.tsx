import type { ReactNode } from "react";
import "./globals.css";
import { Topbar } from "./nav";

export const metadata = {
  title: "Plumb — Financial command center for subcontractors",
  description: "Know your cash, margins, and workload before it becomes a problem.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Topbar />
        {children}
      </body>
    </html>
  );
}
