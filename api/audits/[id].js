const { applyCors } = require('../_cors');
const { getAuditRun } = require('../../supabaseClient');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  const result = await getAuditRun(req.query.id);
  if (result.error) return res.status(404).json({ error: result.error });
  res.status(200).json(result.row);
};
