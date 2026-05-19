function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
}

function requireSessionOrAdmin(req, res, next) {
  const role = req.session?.user?.role;
  if (role === 'admin' || role === 'session') return next();
  return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
}

module.exports = { requireLogin, requireAdmin, requireSessionOrAdmin };

