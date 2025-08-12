const pool = require('../db');
const bcrypt = require('bcrypt');
const { sendResetCode } = require('../utils/emailService');

// GET /api/clients
async function getClients(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT id,
              COALESCE(full_name, name) AS name,
              email,
              phone,
              created_at,
              active
         FROM users
        WHERE role = 'CLIENTE'
        ORDER BY created_at DESC`
        );
        res.json(rows);
    } catch (err) { next(err); }
}

// POST /api/clients
// Aceita ambos os formatos do frontend:
//  - { name, email, phone, role, active, vehicle_limit, expire_date, maps, document, company, notes, send_email, password, permissions, device_ids, group_ids }
//  - { full_name, email, phone, active, maps_allowed, vehicle_limit, expires_at, password_mode, manual_password, send_email }
async function createClient(req, res, next) {
    try {
        // normalização de campos
        const name = (req.body.full_name || req.body.name || '').trim();
        const email = (req.body.email || '').trim();
        const phone = (req.body.phone || '').trim();
        const active = typeof req.body.active === 'boolean'
            ? req.body.active
            : (req.body.active === 1 || req.body.active === '1');
        const vehicleLimit = Number(req.body.vehicle_limit || 0) || 0;

        const mapsAllowed = Array.isArray(req.body.maps_allowed) ? req.body.maps_allowed
            : Array.isArray(req.body.maps) ? req.body.maps
                : [];

        const expiresAt = req.body.expires_at || req.body.expire_date || null;

        // senha: usa `password` se veio; senão manual_password; senão gera
        let plain = (req.body.password || req.body.manual_password || '').trim();
        const passwordMode = req.body.password_mode || (plain ? 'manual' : 'auto');
        if (passwordMode === 'auto' || !plain) {
            plain = Math.random().toString(36).slice(-10);
        }
        const hash = await bcrypt.hash(plain, 10);

        const sendEmail = !!(req.body.send_email === true || req.body.send_email === '1' || req.body.send_email === 1);

        if (!name || !email) {
            return res.status(400).json({ error: 'Nome e email são obrigatórios' });
        }

        // já existe?
        const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
        if (exists.rowCount) {
            return res.status(409).json({ error: 'Email já cadastrado' });
        }

        // Observação de tipo:
        // - Se "maps_allowed" for JSONB na sua tabela, troque `mapsAllowed` por `JSON.stringify(mapsAllowed)`
        // - Se for text[] no Postgres, pode usar como está (node-postgres converte array JS -> text[]).
        const { rows } = await pool.query(
            `INSERT INTO users
         (full_name, email, phone, password, role, active, maps_allowed, vehicle_limit, expires_at, created_at)
       VALUES ($1,$2,$3,$4,'CLIENTE',$5,$6,$7,$8, now())
       RETURNING id, COALESCE(full_name, name) AS name, email, role`,
            [name, email, phone, hash, active, mapsAllowed, vehicleLimit, expiresAt]
        );
        const user = rows[0];

        // enviar email opcional
        if (sendEmail) {
            try {
                await sendResetCode(
                    email,
                    `Bem-vindo(a), ${name}!
Email: ${email}
Senha provisória: ${plain}
Acesse seu painel e altere a senha.`
                );
            } catch (e) {
                console.warn('Falha ao enviar email de boas-vindas:', e.message);
            }
        }

        // Opcional: aqui você pode processar permissions/device_ids/group_ids se já tiver tabelas de vínculo
        // const { permissions, device_ids = [], group_ids = [] } = req.body;

        res.status(201).json(user);
    } catch (err) { next(err); }
}

// DELETE /api/clients/:id (soft delete)
async function deleteClient(req, res, next) {
    try {
        const { id } = req.params;
        const { rowCount } = await pool.query(
            `UPDATE users
          SET active = false
        WHERE id = $1
          AND role = 'CLIENTE'`,
            [id]
        );
        if (!rowCount) return res.status(404).json({ error: 'Cliente não encontrado' });
        res.sendStatus(204);
    } catch (err) { next(err); }
}

module.exports = { getClients, createClient, deleteClient };
