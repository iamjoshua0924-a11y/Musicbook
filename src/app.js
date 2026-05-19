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
        sameSite: 'lax',
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

  app.get('/viewer/:fileId', requireMemberPage, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'viewer', 'index.html'));
  });

  // Allow /viewer entry without fileId (personal mode: open via drive link).
  app.get('/viewer', requireMemberPage, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'viewer', 'index.html'));
  });

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
  });

  // API routes
  app.use(require('./routes'));

  return app;
}

module.exports = { createApp };
