const express = require('express');
const router = express.Router();
const {
    listDeviceGroups, listDevices, createDevice, deleteDevice, updateDevice
} = require('../controllers/deviceController');

// const auth = require('../middleware/authMiddleware');
// router.use(auth);

router.get('/device-groups', listDeviceGroups);
router.get('/devices', listDevices);
router.post('/devices', createDevice);
router.put('/devices/:id', updateDevice);
router.delete('/devices/:id', deleteDevice);

module.exports = router;
