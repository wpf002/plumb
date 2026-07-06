// Prisma stores cents as BigInt. The engine works in `number` cents.
// Cents stay well within Number.MAX_SAFE_INTEGER, so this is lossless.
export const n = (b: bigint): number => Number(b);
