import { fileURLToPath } from "node:url";

// Next only reads .env from the app directory. Pull the monorepo-root .env into
// process.env so NEXT_PUBLIC_API_URL / NEXT_PUBLIC_COMPANY_ID resolve from the
// single shared file. Must run before Next inlines NEXT_PUBLIC_* at build.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // no .env — rely on the ambient environment
}

// In production the web is the only public service; it proxies /api to the
// private API service (INTERNAL_API_URL), keeping everything one origin so the
// session cookie works. Locally there's no proxy — the browser hits the API
// directly via NEXT_PUBLIC_API_URL.
const internalApi = process.env.INTERNAL_API_URL;

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  async rewrites() {
    return internalApi
      ? [{ source: "/api/:path*", destination: `${internalApi}/:path*` }]
      : [];
  },
};
