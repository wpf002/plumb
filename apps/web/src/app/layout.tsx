import type { ReactNode } from "react";
import { Nav } from "./nav";

export const metadata = {
  title: "Plumb",
  description: "Financial command center for subcontractors",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          margin: 0,
          background: "#0b0d10",
          color: "#e7e9ec",
        }}
      >
        <Nav />
        {children}
      </body>
    </html>
  );
}
