import { fileURLToPath } from "node:url";

// Next only reads .env from the app directory. Pull the monorepo-root .env into
// process.env so NEXT_PUBLIC_API_URL / NEXT_PUBLIC_COMPANY_ID resolve from the
// single shared file. Must run before Next inlines NEXT_PUBLIC_* at build.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // no .env — rely on the ambient environment
}

/** @type {import('next').NextConfig} */
export default { reactStrictMode: true };
