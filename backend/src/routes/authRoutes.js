// src/routes/authRoutes.js

const express = require('express');
const router = express.Router();

const {
    login,
    logout,
    me,
    checkEmail,
    verifyCode,
    resetPassword
} = require('../controllers/authController');

const authMiddleware = require('../middleware/authMiddleware');

// Login gera JWT e cria sessão
router.post('/login', login);

// Logout invalida a sessão atual
router.post('/logout', authMiddleware, logout);

// Retorna nome e cargo do usuário logado
router.get('/me', authMiddleware, me);

// Fluxo de recuperar senha
router.post('/check-email', checkEmail);
router.post('/verify-code', verifyCode);
router.post('/reset-password', resetPassword);

module.exports = router;
