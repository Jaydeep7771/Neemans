const { applyCors } = require('./_cors');

module.exports = (req, res) => {
  if (applyCors(req, res)) return;
  res.status(200).json({
    ok: true,
    runtime: 'vercel',
    defaultTargetUrl:
      process.env.DEFAULT_TARGET_URL || 'https://neemans.com/products/the-luxe-loafers-tan',
    gemini: !!process.env.GEMINI_API_KEY,
    supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
};
