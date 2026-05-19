const express = require('express');
const router = express.Router();

router.use(require('./health'));
router.use('/api', require('./health'));
router.use('/api', require('./drive'));
router.use('/api', require('./songs'));
router.use('/api', require('./requests'));
router.use('/api', require('./admin'));
router.use('/api', require('./mainPage'));
router.use('/api', require('./availability'));
router.use('/api', require('./socketMeta'));

module.exports = router;
