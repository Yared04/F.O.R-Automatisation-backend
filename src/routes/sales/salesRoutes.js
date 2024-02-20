const express = require('express');
const salesController = require('../../controllers/sales/salesController');

const router = express.Router();

router.get('/sales', salesController.getSales);
router.post('/sales', salesController.createSale);

module.exports = router;