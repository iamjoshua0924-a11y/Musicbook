const { nanoid } = require('nanoid');

const COOKIE_NAME = 'mb_rs';

function ensureRequesterSession(req, res, next) {
  let sid = req.cookies?.[COOKIE_NAME];
  if (!sid) {
    sid = nanoid(24);
    res.cookie(COOKIE_NAME, sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
  }
  req.requesterSessionId = sid;
  next();
}

module.exports = { ensureRequesterSession, COOKIE_NAME };

