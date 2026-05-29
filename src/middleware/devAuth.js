function requireDev(req, res, next) {
  if (req.session?.devAuthed) return next();
  return res.status(401).json({ ok: false, error: 'DEV_UNAUTHORIZED' });
}

module.exports = { requireDev };

