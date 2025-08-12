const pool = require('../db');

/**
 * GET /api/device-groups
 * Retorna no formato esperado pelo frontend: [{ id, name, count }]
 */
async function listDeviceGroups(req, res, next) {
    try {
        const { rows } = await pool.query(`
      WITH g AS (
        SELECT
          COALESCE(NULLIF(TRIM(device_group), ''), 'Desagrupado') AS name,
          COUNT(*)::int AS count
        FROM devices
        GROUP BY 1
      )
      SELECT
        ROW_NUMBER() OVER (ORDER BY name)::int AS id,
        name,
        count
      FROM g
      ORDER BY name
    `);
        res.json(rows);
    } catch (err) { next(err); }
}

/**
 * GET /api/devices
 * Mantém compatibilidade com a grade do admin: device_group -> group
 */
async function listDevices(req, res, next) {
    try {
        const { rows } = await pool.query(`
      SELECT
        id,
        name,
        imei,
        protocol,
        device_group,
        msisdn,
        carrier,
        status,
        last_seen,
        created_at
      FROM devices
      ORDER BY id DESC
    `);

        const out = rows.map(r => ({ ...r, group: r.device_group }));
        out.forEach(r => delete r.device_group);
        res.json(out);
    } catch (err) { next(err); }
}

/**
 * POST /api/devices
 */
async function createDevice(req, res, next) {
    try {
        const {
            name, protocol, group, imei,
            msisdn, carrier, notes,
            apn, apn_user, apn_pass,
            server_type, server_host, server_port, tz,
            j16 = {}
        } = req.body;

        if (!name || !protocol || !imei)
            return res.status(400).json({ error: 'Campos obrigatórios: name, protocol, imei.' });

        if (!/^\d{15}$/.test(String(imei)))
            return res.status(400).json({ error: 'IMEI deve ter 15 dígitos numéricos.' });

        if (server_type && !['dns', 'ip'].includes(server_type))
            return res.status(400).json({ error: 'server_type deve ser "dns" ou "ip".' });

        const portNum = server_port ? Number(server_port) : null;
        if (portNum !== null && !(portNum > 0 && portNum < 65536))
            return res.status(400).json({ error: 'server_port inválida.' });

        const tzNum = (tz === 0 || tz) ? Number(tz) : null;
        if (tzNum !== null && !(tzNum >= -12 && tzNum <= 14))
            return res.status(400).json({ error: 'tz deve estar entre -12 e 14.' });

        const j16_timer_on = j16.timer_on != null ? Number(j16.timer_on) : null;
        const j16_timer_off = j16.timer_off != null ? Number(j16.timer_off) : null;
        const j16_angle = j16.angle != null ? Number(j16.angle) : null;
        const j16_acc_virtual = j16.acc_virtual != null ? String(j16.acc_virtual) : null;

        const params = [
            name, protocol, group || 'Desagrupado', imei,
            msisdn || null, carrier || null, null, null, // status, last_seen
            notes || null,
            apn || null, apn_user || null, apn_pass || null,
            server_type || null, server_host || null, portNum, tzNum,
            j16_timer_on, j16_timer_off, j16_angle, j16_acc_virtual
        ];

        const { rows } = await pool.query(
            `INSERT INTO devices (
         name, protocol, device_group, imei, msisdn, carrier, status, last_seen, notes,
         apn, apn_user, apn_pass,
         server_type, server_host, server_port, tz,
         j16_timer_on, j16_timer_off, j16_angle, j16_acc_virtual
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,
         $10,$11,$12,
         $13,$14,$15,$16,
         $17,$18,$19,$20
       ) RETURNING id`,
            params
        );

        res.status(201).json({ id: rows[0].id });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'IMEI já cadastrado.' });
        next(err);
    }
}

/**
 * DELETE /api/devices/:id
 */
async function deleteDevice(req, res, next) {
    try {
        const { id } = req.params;
        const r = await pool.query('DELETE FROM devices WHERE id = $1', [id]);
        if (!r.rowCount) return res.sendStatus(404);
        res.sendStatus(204);
    } catch (err) { next(err); }
}

/**
 * PUT /api/devices/:id
 */
async function updateDevice(req, res, next) {
    try {
        const { id } = req.params;
        const fields = [
            'name', 'protocol', 'device_group', 'msisdn', 'carrier', 'status', 'notes',
            'apn', 'apn_user', 'apn_pass', 'server_type', 'server_host', 'server_port', 'tz',
            'j16_timer_on', 'j16_timer_off', 'j16_angle', 'j16_acc_virtual'
        ];

        const set = [], vals = []; let i = 1;
        for (const f of fields) {
            if (f in req.body) { set.push(`${f}=$${i++}`); vals.push(req.body[f]); }
        }
        if (!set.length) return res.status(400).json({ error: 'Nada para atualizar.' });

        vals.push(id);
        const r = await pool.query(`UPDATE devices SET ${set.join(', ')} WHERE id=$${i}`, vals);
        if (!r.rowCount) return res.sendStatus(404);
        res.sendStatus(204);
    } catch (err) { next(err); }
}

module.exports = { listDeviceGroups, listDevices, createDevice, deleteDevice, updateDevice };
