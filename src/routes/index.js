const express = require('express');
const router = express.Router();

router.use(require('./health'));
router.use('/api', require('./health'));
router.use('/api', require('./drive'));
router.use('/api', require('./songs'));
router.use('/api', require('./requests'));
router.use('/api', require('./admin'));

module.exports = router;
