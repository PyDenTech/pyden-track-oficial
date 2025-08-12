// src/routes/objectRoutes.js
const express = require('express');
const router = express.Router();
const {
    getObjects,
    getEvents,
    getHistory
} = require('../controllers/objectController');

router.get('/objects', getObjects);
router.get('/events', getEvents);
router.get('/history', getHistory);

module.exports = router;
