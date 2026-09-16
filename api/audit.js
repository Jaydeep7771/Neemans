const { applyCors } = require('./_cors');
const { runAudit } = require('../server');

const DEFAULT_TARGET_URL =
  process.env.DEFAULT_TARGET_URL || 'https://neemans.com/products/the-luxe-loafers-tan';

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const targetUrl = (body.url || DEFAULT_TARGET_URL).trim();
  const interactions = body.interactions !== false;

  try {
    const parsed = new URL(targetUrl);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('protocol');
  } catch (_) {
    return res.status(400).json({ error: 'Provide a valid http(s) URL.' });
  }

  try {
    const report = await runAudit(targetUrl, { interactions });
    return res.status(200).json(report);
  } catch (err) {
    console.error('[audit] failed', err);
    return res.status(500).json({ error: 'Audit failed', detail: String(err).slice(0, 500) });
  }
};
