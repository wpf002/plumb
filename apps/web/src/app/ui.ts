import type { CSSProperties } from "react";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4300";
export const COMPANY = process.env.NEXT_PUBLIC_COMPANY_ID ?? "";

export const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const colors = {
  bg: "#0b0d10",
  text: "#e7e9ec",
  muted: "#8b93a1",
  faint: "#6b7280",
  line: "#1c2128",
  panel: "#12151a",
  good: "#30a46c",
  warn: "#f0b429",
  bad: "#e5484d",
  accent: "#4c8dff",
};

export const card: CSSProperties = {
  background: colors.panel,
  border: `1px solid ${colors.line}`,
  borderRadius: 12,
  padding: 20,
  marginTop: 16,
};
export const chip: CSSProperties = {
  background: colors.bg,
  border: `1px solid ${colors.line}`,
  borderRadius: 8,
  padding: "8px 12px",
  minWidth: 120,
};
export const h2: CSSProperties = { fontSize: 15, marginTop: 0, marginBottom: 12 };
export const th: CSSProperties = { padding: "6px 8px", fontWeight: 500 };
export const td: CSSProperties = { padding: "8px" };
