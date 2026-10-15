/**
 * RFC 4180 CSV parsing: quoted fields, escaped quotes, commas and newlines
 * inside quotes, CRLF or LF. Small enough not to justify a dependency.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

export type CsvRecord = Record<string, string>;

/** Header row -> keyed records. A blank first header (pandas index) becomes "period". */
export function toRecords(text: string): { headers: string[]; records: CsvRecord[] } {
  const [head, ...body] = parseCsv(text);
  if (!head) return { headers: [], records: [] };
  const headers = head.map((h, i) => (h.trim() === "" && i === 0 ? "period" : h.trim()));
  const records = body.map((cells) => {
    const r: CsvRecord = {};
    headers.forEach((h, i) => (r[h] = (cells[i] ?? "").trim()));
    return r;
  });
  return { headers, records };
}

/** "1,234.56" / "$1234.5" / "" -> integer cents, or null when blank. */
export function cents(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.replace(/[$,\s]/g, "");
  if (t === "" || t.toLowerCase() === "nan") return null;
  const n = Number(t);
  // `|| 0` folds -0 (from "-0.0" in exports) into 0.
  return Number.isFinite(n) ? Math.round(n * 100) || 0 : null;
}

export function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.replace(/[,%\s]/g, "");
  if (t === "" || t.toLowerCase() === "nan") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function bool(v: string | undefined): boolean {
  return /^(true|yes|y|1)$/i.test((v ?? "").trim());
}

/** "2025-12" or "2025-12-01" -> UTC Date at the first of that month (or that day). */
export function date(v: string | undefined): Date | null {
  const t = (v ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}

/** First of the month after `period` (YYYY-MM) — the end of that period. */
export function periodEnd(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1));
}

export function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
}

export function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Last day of a YYYY-MM period, UTC midnight. Source invoices and bills are dated at month end. */
export function monthEnd(period: string | undefined): Date | null {
  const m = (period ?? "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2], 0));
}
