/**
 * api.js -- where the backend lives.
 *
 * Same-origin by default, which covers local dev (Vite proxies /api to :8787)
 * and a single Vercel project where the functions sit beside the static build.
 * Set VITE_API_URL at build time when the API is deployed somewhere else, e.g.
 * a container on Render while the UI stays on Vercel.
 */
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const apiUrl = (path) => `${BASE}${path}`;
