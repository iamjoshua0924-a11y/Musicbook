const express = require('express');
const router = express.Router();

router.use(require('./health'));
router.use('/api', require('./health'));
router.use('/api', require('./drive'));

module.exports = router;

