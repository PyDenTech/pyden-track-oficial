// backend/src/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const pool = require('../db');

async function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autenticado' });
    const token = header.split(' ')[1];
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        // verifica sessão válida
        const result = await pool.query(
            'SELECT 1 FROM sessions WHERE user_id=$1 AND jti=$2 AND ip=$3',
            [payload.userId, payload.jti, req.ip]
        );
        if (result.rowCount === 0) throw new Error();
        req.user = { id: payload.userId };
        next();
    } catch {
        return res.status(401).json({ error: 'Sessão inválida' });
    }
}

module.exports = authMiddleware;
