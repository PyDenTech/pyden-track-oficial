// src/controllers/authController.js

const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { sendResetCode } = require('../utils/emailService');

const CODE_EXPIRATION_MINUTES = 15;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

//
// Passo 1: verifica email e envia código
//
async function checkEmail(req, res, next) {
    const { email } = req.body;
    try {
        const userRes = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );
        if (userRes.rowCount === 0) {
            return res.json({ exists: false });
        }

        // gera código de 5 dígitos
        const code = Math.floor(10000 + Math.random() * 90000).toString();
        const expiresAt = new Date(Date.now() + CODE_EXPIRATION_MINUTES * 60000);

        // salva no banco
        await pool.query(
            `INSERT INTO password_resets(email, code, expires_at)
         VALUES ($1, $2, $3)`,
            [email, code, expiresAt]
        );

        // tenta enviar o email (não trava se falhar)
        try {
            await sendResetCode(email, code);
        } catch (err) {
            console.error('Erro ao enviar reset code:', err);
        }

        res.json({ exists: true });
    } catch (err) {
        next(err);
    }
}

//
// Passo 2: verifica código
//
async function verifyCode(req, res, next) {
    const { email, code } = req.body;
    try {
        const resetRes = await pool.query(
            `SELECT id
         FROM password_resets
        WHERE email = $1
          AND code = $2
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1`,
            [email, code]
        );
        res.json({ valid: resetRes.rowCount === 1 });
    } catch (err) {
        next(err);
    }
}

//
// Passo 3: atualiza senha
//
async function resetPassword(req, res, next) {
    const { email, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            'UPDATE users SET password = $1 WHERE email = $2',
            [hash, email]
        );
        // limpa todos os códigos antigos
        await pool.query(
            'DELETE FROM password_resets WHERE email = $1',
            [email]
        );
        res.sendStatus(200);
    } catch (err) {
        next(err);
    }
}

//
// Login com JWT e sessão única por IP
//
async function login(req, res, next) {
    const { email, password } = req.body;
    try {
        // agora seleciona name e role
        const userRes = await pool.query(
            'SELECT id, name, password, role FROM users WHERE email = $1',
            [email]
        );
        if (userRes.rowCount === 0) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        const user = userRes.rows[0];

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        // gera identificador de sessão (jti)
        const jti = uuidv4();
        const ip = req.ip;

        // remove sessões anteriores deste usuário
        await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);

        // grava nova sessão
        await pool.query(
            'INSERT INTO sessions(user_id, jti, ip) VALUES($1, $2, $3)',
            [user.id, jti, ip]
        );

        // gera o token
        const token = jwt.sign(
            { userId: user.id, jti },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({ token });
    } catch (err) {
        next(err);
    }
}

//
// GET /api/auth/me — retorna nome e cargo do usuário logado
//
async function me(req, res, next) {
    try {
        const userId = req.user.id;
        const userRes = await pool.query(
            'SELECT name, role FROM users WHERE id = $1',
            [userId]
        );
        if (userRes.rowCount === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        res.json(userRes.rows[0]); // { name, role }
    } catch (err) {
        next(err);
    }
}

//
// Logout — invalida a sessão atual
//
async function logout(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        // remove sessão do banco
        await pool.query('DELETE FROM sessions WHERE jti = $1', [payload.jti]);
        res.sendStatus(200);
    } catch (err) {
        next(err);
    }
}

module.exports = {
    checkEmail,
    verifyCode,
    resetPassword,
    login,
    me,
    logout
};
