/** Seeded generators so a preview looks the same every time for a company. */
export function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export const daysAgo = (n: number, from = new Date()) => new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - n));
export const cents = (dollars: number) => Math.round(dollars * 100);
export const period = (d: Date) => d.toISOString().slice(0, 7);
