const { applyCors } = require('../_cors');
const { listAuditRuns } = require('../../supabaseClient');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  const result = await listAuditRuns(Number(req.query.limit) || 20);
  if (result.error) return res.status(503).json({ error: result.error });
  res.status(200).json(result.rows);
};
