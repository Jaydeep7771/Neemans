/**
 * Shared CORS + preflight handling for the serverless routes.
 *
 * When the frontend is served from the same Vercel project these headers are
 * redundant, but they cost nothing and they keep the API usable if the UI is
 * ever hosted separately.
 */
function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { applyCors };
