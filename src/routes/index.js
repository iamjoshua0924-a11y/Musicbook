const express = require('express');
const router = express.Router();

// NOTE: This router is intended to be mounted at '/api' in app.js.
router.use(require('./health'));
router.use(require('./drive'));
router.use(require('./songs'));
router.use(require('./requests'));
router.use(require('./admin'));
router.use(require('./mainPage'));
router.use(require('./privateArchive'));
router.use(require('./privateBook'));
router.use(require('./guestbook'));
router.use(require('./availability'));
router.use(require('./socketMeta'));
router.use(require('./proxyChord'));
router.use(require('./chordUpload'));
router.use(require('./chordDoc'));

module.exports = router;
