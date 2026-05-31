const express = require('express');
const { createSocketMetaToken } = require('../services/socketMeta');

const router = express.Router();

// No-auth endpoint: returns viewer meta if not logged in.
router.get('/socket/meta', async (req, res) => {
  const u = req.session?.user;
  const meta = u
    ? {
        role: u.role,
        displayName: u.displayName || u.userId,
        userId: u.userId,
        isPrivate: Boolean(u.isPrivate),
        ts: Date.now()
      }
    : { role: 'viewer', displayName: '방문자', userId: '', ts: Date.now() };

  const token = createSocketMetaToken(meta);
  res.json({ ok: true, meta, token });
});

module.exports = router;
