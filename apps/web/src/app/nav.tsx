import Link from "next/link";
import { colors } from "./ui";

export function Nav() {
  return (
    <nav
      style={{
        borderBottom: `1px solid ${colors.line}`,
        padding: "14px 32px",
        display: "flex",
        alignItems: "center",
        gap: 24,
      }}
    >
      <span style={{ fontWeight: 700, letterSpacing: 0.3 }}>Plumb</span>
      <Link href="/" style={{ color: colors.muted, textDecoration: "none" }}>
        Dashboard
      </Link>
      <Link href="/bid" style={{ color: colors.muted, textDecoration: "none" }}>
        Bid decision
      </Link>
    </nav>
  );
}
