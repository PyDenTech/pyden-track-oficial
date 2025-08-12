const express = require('express');
const router = express.Router();
const { getClients, createClient, deleteClient } = require('../controllers/clientController');

// const auth = require('../middleware/authMiddleware');
// router.use(auth);

router.get('/clients', getClients);
router.post('/clients', createClient);     // <— garante o POST
router.delete('/clients/:id', deleteClient);

module.exports = router;
