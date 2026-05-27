const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const { env, sessionSecret } = require('./config/env');

function requireMemberPage(req, res, next) {
  const role = req.session?.user?.role;
  if (role === 'admin' || role === 'session') return next();
  return res.redirect('/');
}

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(morgan(env === 'production' ? 'combined' : 'dev'));
  app.use(cookieParser());
  // Legacy CSV import may exceed a few MB; keep a safe cap.
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  // Session (used later for admin; safe default for now).
  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        // 프론트(깃헙페이지) ↔ 백엔드(Render) 분리 시 cross-site 쿠키 전송을 위해 필요
        sameSite: env === 'production' ? 'none' : 'lax',
        secure: env === 'production'
      }
    })
  );

  // Static assets
  app.use('/public', express.static(path.join(__dirname, '..', 'public')));

  // Pages
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'musicbook', 'index.html'));
  });

  // Viewer is public (supports anonymous nickname). Member-only features are gated client/server-side.
  app.get('/viewer/:fileId', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'viewer', 'index.html'));
  });

  // Allow /viewer entry without fileId (personal mode: open via drive link).
  app.get('/viewer', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'viewer', 'index.html'));
  });

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
  });

  // Public request board (pop-out)
  app.get('/requests', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'requests', 'index.html'));
  });

  // API routes
  app.use(require('./routes'));

  // Global error handler — 반드시 JSON으로 응답 (HTML 에러 페이지 차단)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('[app] unhandled error:', {
      method: req.method,
      path: req.path,
      name: err?.name,
      message: err?.message,
      stack: String(err?.stack || '').split('\n').slice(0, 6).join('\n')
    });
    if (res.headersSent) return;
    res.status(err?.status || err?.statusCode || 500).json({
      ok: false,
      error: err?.code || err?.message || 'INTERNAL_SERVER_ERROR'
    });
  });

  return app;
}

module.exports = { createApp };
