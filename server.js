// server.js
require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const net = require('net');

const app = express();
const server = http.createServer(app);

// ==== Socket.IO (realtime) ====
const { Server } = require('socket.io');
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// ==== DB ====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// ==== Middlewares ====
app.use(cors());
app.use(express.json());

// ==== Email (SMTP Gmail) ====
const mailer = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.EMAIL_PORT || 587),
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: (process.env.EMAIL_PASS || '').replace(/\s+/g, '')
    }
});

// ==== Helpers ====
function genCode5() { return String(Math.floor(Math.random() * 100000)).padStart(5, '0'); }

async function sendCodeByEmail(to, code) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const minutes = Number(process.env.RESET_CODE_MINUTES || 15);
    const html = /* html */`
  <div style="background-color:#f4f6f8;padding:40px 0;font-family:Arial,Helvetica,sans-serif;color:#333;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);overflow:hidden">
      <div style="background-color:#2563eb;padding:16px;text-align:center;color:#fff;">
        <h1 style="margin:0;font-size:20px;">PyDen Track</h1>
        <p style="margin:4px 0 0;font-size:14px;">Segurança e rastreamento em tempo real</p>
      </div>
      <div style="padding:24px;">
        <h2 style="margin-top:0;font-size:18px;color:#111827;">Recuperação de senha</h2>
        <p style="margin:8px 0;font-size:15px;line-height:1.5;">Olá,<br>Use o código abaixo para continuar. Ele é válido por <strong>${minutes}</strong> minutos.</p>
        <div style="background-color:#f3f4f6;border:2px dashed #2563eb;border-radius:6px;padding:16px;margin:20px 0;text-align:center;">
          <span style="display:inline-block;font-size:32px;font-weight:bold;letter-spacing:8px;color:#2563eb;">${code}</span>
        </div>
        <p style="margin:8px 0;font-size:14px;color:#6b7280;">Se você não fez esta solicitação, ignore este e-mail.</p>
        <div style="text-align:center;margin-top:24px;">
          <a href="${baseUrl}" target="_blank" style="display:inline-block;padding:12px 24px;background-color:#2563eb;color:#fff;text-decoration:none;border-radius:4px;font-size:15px;">Acessar PyDen Track</a>
        </div>
      </div>
      <div style="background-color:#f9fafb;padding:12px;text-align:center;font-size:12px;color:#9ca3af;">© ${new Date().getFullYear()} PyDen Track. Todos os direitos reservados.</div>
    </div>
  </div>`;
    const text = `Recuperação de senha - PyDen Track

Código: ${code}

O código expira em ${minutes} minutos.
Se você não solicitou, ignore este e-mail.

${baseUrl}`;
    await mailer.sendMail({ from: `PyDen Track <${process.env.EMAIL_USER}>`, to, subject: 'Código de recuperação de senha - PyDen Track', text, html });
}

function requireAuth(req, res, next) {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!t) return res.status(401).json({ error: 'Unauthorized' });
    try { req.user = jwt.verify(t, JWT_SECRET); next(); } catch { return res.status(401).json({ error: 'Unauthorized' }); }
}
const isAdmin = (req) => (req.user?.role || '').toUpperCase() === 'ADMIN';

// ==== AUTH ====
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios.' });

        const r = await pool.query(
            `SELECT id, COALESCE(full_name, name) AS name, email, password, role, active
       FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]
        );
        if (!r.rowCount) return res.status(401).json({ error: 'Credenciais inválidas' });
        const u = r.rows[0];
        if (u.active === false) return res.status(403).json({ error: 'Usuário inativo' });

        const ok = await bcrypt.compare(password, u.password || '');
        if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

        const token = jwt.sign(
            { sub: u.id, email: u.email, name: u.name, role: u.role || 'USER' },
            JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
        );
        res.json({ token });
    } catch (err) {
        console.error('login:', err);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

app.post('/api/auth/check-email', async (req, res) => {
    try {
        const { email } = req.body || {};
        if (!email) return res.json({ exists: false });

        const r = await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]);
        if (!r.rowCount) return res.json({ exists: false });

        const code = genCode5();
        const expiresAt = new Date(Date.now() + (Number(process.env.RESET_CODE_MINUTES || 15) * 60_000));
        await pool.query(`UPDATE users SET reset_code = $1, reset_code_expires = $2 WHERE id = $3`,
            [code, expiresAt, r.rows[0].id]);

        try { await sendCodeByEmail(email, code); }
        catch (e) { console.warn('Falha ao enviar e-mail:', e?.message || e); }

        res.json({ exists: true });
    } catch (err) {
        console.error('check-email:', err);
        res.json({ exists: false });
    }
});

app.post('/api/auth/verify-code', async (req, res) => {
    try {
        const { email, code } = req.body || {};
        if (!email || !code) return res.json({ valid: false });

        const r = await pool.query(
            `SELECT reset_code, reset_code_expires FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]
        );
        if (!r.rowCount) return res.json({ valid: false });

        const { reset_code, reset_code_expires } = r.rows[0];
        const notExpired = reset_code_expires && new Date(reset_code_expires).getTime() > Date.now();
        const ok = reset_code && String(reset_code) === String(code) && notExpired;

        res.json({ valid: !!ok });
    } catch (err) {
        console.error('verify-code:', err);
        res.json({ valid: false });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'Email e nova senha são obrigatórios.' });

        const r = await pool.query(
            `SELECT id, reset_code_expires FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });

        const { id, reset_code_expires } = r.rows[0];
        const valid = reset_code_expires && new Date(reset_code_expires).getTime() > Date.now();
        if (!valid) return res.status(400).json({ error: 'Código expirado ou inexistente.' });

        const hash = await bcrypt.hash(String(password), 10);
        await pool.query(
            `UPDATE users SET password = $1, reset_code = NULL, reset_code_expires = NULL WHERE id = $2`,
            [hash, id]
        );
        res.sendStatus(204);
    } catch (err) {
        console.error('reset-password:', err);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const q = await pool.query(
            `SELECT id, COALESCE(full_name, name) AS name, email, role FROM users WHERE id = $1 LIMIT 1`,
            [req.user.sub]
        );
        if (!q.rowCount) return res.status(404).json({ error: 'Usuário não encontrado' });
        res.json(q.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Erro interno.' }); }
});

// ======== DASHBOARD ENDPOINTS (READ) ========
app.get('/api/device-groups', requireAuth, async (_req, res) => {
    try {
        const { rows } = await pool.query(`
      SELECT COALESCE(NULLIF(TRIM(device_group), ''), 'Desagrupado') AS name,
             COUNT(*)::int AS total
        FROM devices
    GROUP BY 1
    ORDER BY 1`);
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao listar grupos.' }); }
});

app.get('/api/devices', requireAuth, async (_req, res) => {
    try {
        const { rows } = await pool.query(`
      SELECT id, name, device_group, protocol, imei, msisdn, carrier,
             status, last_seen,
             last_lat, last_lng, last_speed_kmh, last_course_deg, last_fix_time,
             notes, server_type, server_host, server_port, tz
        FROM devices
    ORDER BY id DESC`);
        const out = rows.map(r => ({ ...r, group: r.device_group }));
        out.forEach(r => delete r.device_group);
        res.json(out);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao listar dispositivos.' }); }
});

app.get('/api/positions', requireAuth, async (req, res) => {
    try {
        const deviceId = Number(req.query.device_id);
        if (!Number.isFinite(deviceId)) return res.status(400).json({ error: 'device_id inválido' });

        const start = req.query.start ? new Date(req.query.start) : null;
        const end = req.query.end ? new Date(req.query.end) : null;

        const where = ['device_id = $1'];
        const vals = [deviceId];
        let i = 2;

        if (start) { where.push(`fix_time >= $${i++}`); vals.push(start); }
        if (end) { where.push(`fix_time <= $${i++}`); vals.push(end); }

        const sql = `
      SELECT fix_time, lat, lng, speed_kmh, course_deg, altitude_m, ignition, battery_v
        FROM positions
       WHERE ${where.join(' AND ')}
    ORDER BY fix_time ASC`;

        const { rows } = await pool.query(sql, vals);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao listar posições.' });
    }
});

// ======== CRUD DE DISPOSITIVOS ========
function validateDevicePayload(b) {
    const errors = [];
    if (!b || !b.name) errors.push('Nome é obrigatório');
    if (!b || !b.protocol) errors.push('Protocolo é obrigatório');
    if (!b || !b.imei || !/^\d{10,20}$/.test(String(b.imei))) errors.push('IMEI/ID inválido');
    if (errors.length) {
        const err = new Error(errors.join('; '));
        err.status = 400;
        throw err;
    }
}

app.post('/api/devices', requireAuth, async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Somente ADMIN' });
        validateDevicePayload(req.body);
        const b = req.body;

        const { rows } = await pool.query(`
      INSERT INTO devices
        (name, protocol, device_group, imei, msisdn, carrier, notes,
         apn, apn_user, apn_pass, server_type, server_host, server_port, tz,
         j16_timer_on, j16_timer_off, j16_angle, j16_acc_virtual, owner_id)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,
         $8,$9,$10,$11,$12,$13,$14,
         $15,$16,$17,$18,$19)
      RETURNING *
    `, [
            b.name, b.protocol, b.device_group || null, b.imei, b.msisdn || null, b.carrier || null, b.notes || null,
            b.apn || null, b.apn_user || null, b.apn_pass || null,
            b.server_type || 'dns', b.server_host || null, b.server_port || null, Number.isFinite(+b.tz) ? +b.tz : 0,
            b.j16_timer_on || null, b.j16_timer_off || null, b.j16_angle || null, b.j16_acc_virtual || null,
            req.user.sub
        ]);

        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('POST /api/devices', err);
        res.status(err.status || 500).json({ error: err.message || 'Erro ao criar' });
    }
});

app.put('/api/devices/:id', requireAuth, async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Somente ADMIN' });
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });
        validateDevicePayload(req.body);
        const b = req.body;

        const { rows } = await pool.query(`
      UPDATE devices SET
        name=$1, protocol=$2, device_group=$3, imei=$4, msisdn=$5, carrier=$6, notes=$7,
        apn=$8, apn_user=$9, apn_pass=$10, server_type=$11, server_host=$12, server_port=$13, tz=$14,
        j16_timer_on=$15, j16_timer_off=$16, j16_angle=$17, j16_acc_virtual=$18, updated_at=now()
      WHERE id=$19
      RETURNING *
    `, [
            b.name, b.protocol, b.device_group || null, b.imei, b.msisdn || null, b.carrier || null, b.notes || null,
            b.apn || null, b.apn_user || null, b.apn_pass || null,
            b.server_type || 'dns', b.server_host || null, b.server_port || null, Number.isFinite(+b.tz) ? +b.tz : 0,
            b.j16_timer_on || null, b.j16_timer_off || null, b.j16_angle || null, b.j16_acc_virtual || null,
            id
        ]);

        if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
        res.json(rows[0]);
    } catch (err) {
        console.error('PUT /api/devices/:id', err);
        res.status(err.status || 500).json({ error: err.message || 'Erro ao atualizar' });
    }
});

app.delete('/api/devices/:id', requireAuth, async (req, res) => {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: 'Somente ADMIN' });
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });
        const r = await pool.query(`DELETE FROM devices WHERE id=$1`, [id]);
        if (!r.rowCount) return res.status(404).json({ error: 'Não encontrado' });
        res.sendStatus(204);
    } catch (err) {
        console.error('DELETE /api/devices/:id', err);
        res.status(500).json({ error: 'Erro ao excluir' });
    }
});

// ======== STATIC ========
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));
app.use('/dashboard', express.static(path.join(publicPath, 'dashboard')));

// Páginas
app.get('/', (_req, res) => res.sendFile(path.join(publicPath, 'index.html')));
app.get('/recover', (_req, res) => res.sendFile(path.join(publicPath, 'recover.html')));

// ==== Error handler ====
app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Erro interno.' });
});

// ===================================================================
// ========================  TRACKING LISTENERS  =====================
// ===================================================================

/** Marca ONLINE sem inserir posição (login/heartbeat binário). */
async function markOnlineByImei(imei) {
    const dres = await pool.query(`SELECT id FROM devices WHERE imei=$1 LIMIT 1`, [String(imei)]);
    if (!dres.rowCount) return false;
    const deviceId = dres.rows[0].id;

    await pool.query(`
    UPDATE devices
       SET last_seen=now(), status='ONLINE', updated_at=now()
     WHERE id=$1
  `, [deviceId]);

    io.emit('device:update', { id: deviceId, status: 'ONLINE' });
    return true;
}

/** Salva posição + atualiza "devices.last_*" e emite socket.  (cap de payload) */
const RAW_MAX = Number(process.env.RAW_MAX || 1024);
async function savePositionByImei(imei, pos) {
    const dres = await pool.query(`SELECT id FROM devices WHERE imei=$1 LIMIT 1`, [String(imei)]);
    if (!dres.rowCount) return false;
    const deviceId = dres.rows[0].id;

    const raw = pos.raw_payload
        ? (Buffer.isBuffer(pos.raw_payload) ? pos.raw_payload : Buffer.from(String(pos.raw_payload)))
        : null;

    const p = {
        device_id: deviceId,
        fix_time: pos.fix_time || new Date(),
        lat: +pos.lat, lng: +pos.lng,
        speed_kmh: pos.speed_kmh ?? null,
        course_deg: pos.course_deg ?? null,
        altitude_m: pos.altitude_m ?? null,
        satellites: pos.satellites ?? null,
        hdop: pos.hdop ?? null,
        ignition: typeof pos.ignition === 'boolean' ? pos.ignition : null,
        battery_v: pos.battery_v ?? null,
        raw_payload: raw ? raw.subarray(0, RAW_MAX) : null
    };

    await pool.query(`
    INSERT INTO positions (device_id, fix_time, lat, lng, speed_kmh, course_deg, altitude_m, satellites, hdop, ignition, battery_v, raw_payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [p.device_id, p.fix_time, p.lat, p.lng, p.speed_kmh, p.course_deg, p.altitude_m, p.satellites, p.hdop, p.ignition, p.battery_v, p.raw_payload]);

    await pool.query(`
    UPDATE devices SET
      last_seen=now(),
      status='ONLINE',
      last_lat=$1, last_lng=$2, last_speed_kmh=$3, last_course_deg=$4, last_fix_time=$5,
      updated_at=now()
    WHERE id=$6
  `, [p.lat, p.lng, p.speed_kmh, p.course_deg, p.fix_time, deviceId]);

    io.emit('device:update', {
        id: deviceId,
        last_lat: p.lat, last_lng: p.lng,
        last_speed_kmh: p.speed_kmh,
        last_course_deg: p.course_deg,
        last_fix_time: p.fix_time,
        status: 'ONLINE'
    });

    return true;
}

// ---- Parsers ASCII (TK103-like / NMEA) ----
function tryParseTK103(line) {
    if (!/^imei:\d+/.test(line)) return null;
    const imei = (line.match(/^imei:(\d{10,20})/) || [])[1];
    const parts = line.split(',');
    let lat = null, lng = null, speed = null;
    for (let i = 0; i < parts.length - 1; i++) {
        const a = parseFloat(parts[i]), b = parseFloat(parts[i + 1]);
        if (isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) {
            lat = a; lng = b;
            const sp = parseFloat(parts[i + 2]);
            if (isFinite(sp)) speed = sp;
            break;
        }
    }
    if (imei && lat != null && lng != null) {
        return { imei, lat, lng, speed_kmh: speed || 0 };
    }
    return { imei };
}

function tryParseNmeaRmc(line) {
    if (!/^\$GPRMC,/.test(line)) return null;
    const p = line.trim().split(',');
    if (p.length < 12) return null;
    const status = p[2];
    if (status !== 'A') return null;
    const latRaw = p[3], latHem = p[4];
    const lonRaw = p[5], lonHem = p[6];
    const spKn = parseFloat(p[7] || '0');
    const course = parseFloat(p[8] || '0');
    const dateStr = p[9]; const timeStr = p[1];

    function dmToDeg(dm) {
        const v = parseFloat(dm);
        const deg = Math.floor(v / 100);
        const min = v - deg * 100;
        return deg + (min / 60);
    }
    let lat = dmToDeg(latRaw);
    let lon = dmToDeg(lonRaw);
    if (latHem === 'S') lat = -lat;
    if (lonHem === 'W') lon = -lon;

    let fix_time = new Date();
    if (/^\d{6}$/.test(dateStr) && /^\d{6}(\.\d+)?$/.test(timeStr)) {
        const dd = dateStr.slice(0, 2), mm = dateStr.slice(2, 4), yy = dateStr.slice(4, 6);
        const hh = timeStr.slice(0, 2), mi = timeStr.slice(2, 4), ss = timeStr.slice(4, 6);
        const iso = `20${yy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`;
        const d = new Date(iso);
        if (!isNaN(d)) fix_time = d;
    }
    return { lat, lng: lon, speed_kmh: (spKn || 0) * 1.852, course_deg: course || 0, fix_time };
}

// =================== GT06 MIXED SERVER (binário + ASCII) ===================
const PORT_GT06 = Number(process.env.LISTEN_GT06 || 7002);   // GT06 binário e TK103-like ASCII no mesmo porto
const PORT_NMEA = Number(process.env.LISTEN_NMEA || 7010);   // NMEA puro (quando disponível)

// Debug opcional
const DBG = process.env.DEBUG_GT06 === '1';
const dlog = (...a) => { if (DBG) console.log('[GT06]', ...a); };

// Converte IMEI BCD (8 bytes -> 15 dígitos)
function bcdToImei(b) {
    let s = '';
    for (const byte of b) {
        const hi = (byte >> 4) & 0x0f;
        const lo = byte & 0x0f;
        s += hi.toString(10) + lo.toString(10);
    }
    if (s.length >= 16) s = s.slice(1, 16); // descarta nibble de padding
    return s;
}

// CRC16/X25 (usado por GT06/Concox) – retorna [hi, lo]
function crc16X25_bytes(buf) {
    let crc = 0xFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) crc = (crc >>> 1) ^ 0x8408;
            else crc >>>= 1;
        }
    }
    crc = (~crc) & 0xFFFF;
    const hi = (crc >>> 8) & 0xFF, lo = crc & 0xFF;
    return Buffer.from([hi, lo]);
}

// ===== Respostas =====
function sendGt06Response(socket, use79, proto, serial /*Buffer[2]*/, content /*Buffer|undefined*/) {
    const hdr = use79 ? Buffer.from([0x79, 0x79]) : Buffer.from([0x78, 0x78]);
    const contentBuf = content ? Buffer.from(content) : Buffer.alloc(0);
    // comprimento = 1(protocol) + content + 2(serial)
    const lenVal = 1 + contentBuf.length + 2;
    const len = use79 ? Buffer.from([(lenVal >>> 8) & 0xFF, lenVal & 0xFF]) : Buffer.from([lenVal & 0xFF]);
    const payload = Buffer.concat([Buffer.from([proto]), contentBuf, serial]);
    const crc = crc16X25_bytes(Buffer.concat([len, payload]));
    const tail = Buffer.from([0x0D, 0x0A]);
    const msg = Buffer.concat([hdr, len, payload, crc, tail]);
    try { socket.write(msg); dlog('RESP sent', `proto=0x${proto.toString(16)}`, `serial=${serial.toString('hex')}`, `use79=${use79}`); } catch { }
}

// ACK simplificado (sem content)
function sendGt06Ack(socket, use79, proto, serial) {
    sendGt06Response(socket, use79, proto, serial);
}

// ==== Framing (com verificação de CRC) ====
function extractGt06Frames(buf) {
    const out = [];
    let i = 0;
    while (i + 5 <= buf.length) {
        const h1 = buf[i], h2 = buf[i + 1];
        const is78 = (h1 === 0x78 && h2 === 0x78);
        const is79 = (h1 === 0x79 && h2 === 0x79);
        if (!(is78 || is79)) { i++; continue; }

        let len, hdr, need;
        if (is78) {
            if (i + 3 > buf.length) break;
            len = buf[i + 2];              // 1 byte
            hdr = 3;
            need = hdr + len + 2 /*CRC*/ + 2 /*0D0A*/;
        } else {
            if (i + 4 > buf.length) break;
            len = buf.readUInt16BE(i + 2); // 2 bytes
            hdr = 4;
            need = hdr + len + 2 /*CRC*/ + 2 /*0D0A*/;
        }
        if (i + need > buf.length) break;

        // Verifica CRC
        const frame = buf.subarray(i, i + need);
        const crcSeen = frame.subarray(i + need - 4, i + need - 2);
        const crcCalc = crc16X25_bytes(frame.subarray(2, need - 2)); // do LEN até antes do CRC
        if (crcSeen[0] === crcCalc[0] && crcSeen[1] === crcCalc[1]) {
            out.push({ frame, is79 });
        } else {
            console.warn('[GT06] CRC inválido, descartando frame');
        }

        i += need;
    }
    return { frames: out, rest: buf.subarray(i) };
}

// ==== Parser de posição GT06 (tolerante) ====
function parseGt06Position(data) {
    if (data.length < 18) return null;

    const yy = 2000 + data[0], mo = data[1], dd = data[2], hh = data[3], mi = data[4], ss = data[5];
    const fix_time = new Date(Date.UTC(yy, mo - 1, dd, hh, mi, ss));

    const latRaw = data.readUInt32BE(7);
    const lonRaw = data.readUInt32BE(11);
    // Conversão equivalente ao Traccar: /60/30000 = /1_800_000
    let latDeg = latRaw / 1800000;
    let lonDeg = lonRaw / 1800000;

    // A) speed depois de flags? ou B) speed antes? (tentar os dois)
    // Caminho A (clássico): speed(1) [15], flags(2) [16..17]
    let speedA = data[15];
    let flagsA = data.readUInt16BE(16);
    // Caminho B (swapFlags): flags(2) [15..16], speed(1) [17]
    let flagsB = data.readUInt16BE(15);
    let speedB = data[17];

    function applyFlags(lat, lon, flags) {
        const course = (flags & 0x03FF);
        const valid = (flags & (1 << 12)) !== 0;
        const south = ((flags & (1 << 10)) === 0); // bit10 “not set” => sul (comportamento dos firmwares GT06)
        const west = ((flags & (1 << 11)) !== 0);
        let la = lat, lo = lon;
        if (south) la = -la;
        if (west) lo = -lo;
        return { la, lo, course, valid };
    }

    const A = applyFlags(latDeg, lonDeg, flagsA);
    const B = applyFlags(latDeg, lonDeg, flagsB);

    function ok(p) {
        return Number.isFinite(p.la) && Number.isFinite(p.lo)
            && Math.abs(p.la) <= 90 && Math.abs(p.lo) <= 180
            && (p.valid || (p.la !== 0 || p.lo !== 0));
    }

    if (ok(A)) return { fix_time, lat: A.la, lng: A.lo, speed_kmh: Number.isFinite(speedA) ? speedA : null, course_deg: A.course, valid: A.valid };
    if (ok(B)) return { fix_time, lat: B.la, lng: B.lo, speed_kmh: Number.isFinite(speedB) ? speedB : null, course_deg: B.course, valid: B.valid };

    return null;
}

async function handleGt06Frame(frame, is79, state, socket) {
    const is78 = !is79;
    let len, hdr;
    if (is78) { len = frame[2]; hdr = 3; } else { len = frame.readUInt16BE(2); hdr = 4; }

    const proto = frame[hdr];
    const contentEnd = hdr + 1 + (len - 3);            // len: protocol(1) + info + serial(2)
    const data = frame.subarray(hdr + 1, contentEnd);  // apenas "information content"
    const serial = frame.subarray(contentEnd, contentEnd + 2);

    console.log('[GT06] FRAME', `proto=0x${proto.toString(16)}`, `len=${len}`, `is79=${is79}`, `imei=${state.lastImei || 'n/a'}`);
    if (DBG) console.log('[GT06] DATAHEX proto=0x' + proto.toString(16), data.toString('hex'));

    // LOGIN (0x01)
    if (proto === 0x01) {
        if (data.length >= 8) {
            const imei = bcdToImei(data.subarray(0, 8));
            if (imei) {
                state.lastImei = imei;
                dlog('LOGIN', imei);
                await markOnlineByImei(imei);
                sendGt06Ack(socket, is79, 0x01, serial);
            }
        }
        return;
    }

    // HEARTBEAT: 0x13 (clássico) e 0x23 (alguns modelos)
    if (proto === 0x13 || proto === 0x23) {
        if (state.lastImei) {
            dlog('HB', state.lastImei);
            await markOnlineByImei(state.lastImei);
            sendGt06Ack(socket, is79, proto, serial);
        }
        return;
    }

    // REQUEST DE HORA (0x8A) – responde com UTC YY MM DD hh mm ss
    if (proto === 0x8A) {
        const now = new Date();
        const buf = Buffer.from([
            (now.getUTCFullYear() - 2000) & 0xFF,
            now.getUTCMonth() + 1,
            now.getUTCDate(),
            now.getUTCHours(),
            now.getUTCMinutes(),
            now.getUTCSeconds()
        ]);
        sendGt06Response(socket, is79, 0x8A, serial, buf);
        if (state.lastImei) await markOnlineByImei(state.lastImei);
        return;
    }

    // ADDRESS REQUEST (0x2A) – responde “NA&&NA&&0##” no 0x97 (conforme alguns firmwares)
    if (proto === 0x2A) {
        const payload = Buffer.from('NA&&NA&&0##', 'ascii');
        const respContent = Buffer.concat([Buffer.from([payload.length]), Buffer.from([0, 0, 0, 0]), payload]);
        // Em alguns modelos a resposta é cabeçalho extendido; aqui usamos use79=true para ser o mais aceito
        sendGt06Response(socket, true, 0x97, serial, respContent);
        if (state.lastImei) await markOnlineByImei(state.lastImei);
        return;
    }

    // TIPOS COM GPS (lista ampliada inspirada no Traccar)
    const gpsTypes = new Set([0x10, 0x11, 0x12, 0x16, 0x22, 0x31, 0x32, 0x37, 0x2D, 0x38, 0xA0]);
    if (gpsTypes.has(proto)) {
        if (!state.lastImei) return;

        const pos = parseGt06Position(data);
        if (pos) {
            dlog('POS', state.lastImei, pos.valid ? 'FIX' : 'NOFIX',
                pos.lat.toFixed(6), pos.lng.toFixed(6), 'spd', pos.speed_kmh ?? '-', 'crs', pos.course_deg ?? '-');

            await savePositionByImei(state.lastImei, {
                ...pos,
                raw_payload: frame
            }).catch(e => console.warn('savePosition error:', e?.message || e));
            return;
        }
        // Sem posição “aceitável” → manter online
        await markOnlineByImei(state.lastImei);
        return;
    }

    // STRING/INFO (0x15/0x94 etc.) – apenas manter sessão viva
    if (state.lastImei) await markOnlineByImei(state.lastImei);
}

function startGt06MixedServer(port) {
    const srv = net.createServer((socket) => {
        let binBuf = Buffer.alloc(0);
        let asciiBuf = '';
        const state = { lastImei: null };

        try { socket.setKeepAlive(true, 30_000); } catch { }

        socket.on('data', async (chunk) => {
            if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk, 'binary');

            // 1) Frames binários GT06 (com CRC)
            binBuf = Buffer.concat([binBuf, chunk]);
            while (true) {
                const { frames, rest } = extractGt06Frames(binBuf);
                if (!frames.length) break;
                for (const fr of frames) {
                    try { await handleGt06Frame(fr.frame, fr.is79, state, socket); }
                    catch (e) { console.warn('handleGt06Frame error:', e?.message || e); }
                }
                binBuf = rest;
            }

            // 2) ASCII (TK103-like / NMEA) tolerante
            asciiBuf += chunk.toString('utf8');
            let nl;
            while ((nl = asciiBuf.indexOf('\n')) >= 0) {
                const line = asciiBuf.slice(0, nl).replace(/\r/g, '').trim();
                asciiBuf = asciiBuf.slice(nl + 1);
                if (!line) continue;

                if (line.startsWith('##')) { try { socket.write('LOAD'); } catch { } continue; }

                const tk = tryParseTK103(line);
                if (tk?.imei && tk.lat != null) {
                    await savePositionByImei(tk.imei, { lat: tk.lat, lng: tk.lng, speed_kmh: tk.speed_kmh ?? 0, raw_payload: Buffer.from(line) })
                        .catch(e => console.warn('save TK103 pos error:', e?.message || e));
                    state.lastImei = tk.imei;
                    continue;
                }
                if (tk?.imei && tk.lat == null) {
                    await markOnlineByImei(tk.imei).catch(() => { });
                    state.lastImei = tk.imei;
                }

                const rmcIdx = line.indexOf('$GPRMC,');
                if (rmcIdx >= 0 && (state.lastImei || tk?.imei)) {
                    const rmc = tryParseNmeaRmc(line.slice(rmcIdx));
                    const imei = state.lastImei || tk?.imei;
                    if (rmc && imei) {
                        await savePositionByImei(imei, { ...rmc, raw_payload: Buffer.from(line) })
                            .catch(e => console.warn('save NMEA pos error:', e?.message || e));
                        state.lastImei = imei;
                    }
                }
            }
        });

        socket.on('error', (e) => console.warn('TCP socket error', e.message));
    });
    srv.listen(port, () => console.log(`📡 GT06/TK103 mixed TCP listening on ${port}`));
    return srv;
}

// NMEA puro ($GPRMC...) – IMEI deve vir em linha anterior "IMEI:XXXXXXXXXXXXXXX"
function startNmeaServer(port) {
    const lastImeiBySocket = new WeakMap();
    const srv = net.createServer((socket) => {
        socket.setEncoding('utf8');
        try { socket.setKeepAlive(true, 30_000); } catch { }

        socket.on('data', async (chunk) => {
            const lines = String(chunk).replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
            for (const line of lines) {
                const mImei = line.match(/^IMEI[:=](\d{10,20})$/i);
                if (mImei) { lastImeiBySocket.set(socket, mImei[1]); continue; }
                const rmc = tryParseNmeaRmc(line);
                if (!rmc) continue;
                const imei = lastImeiBySocket.get(socket);
                if (!imei) continue;
                await savePositionByImei(imei, { ...rmc, raw_payload: Buffer.from(line) })
                    .catch(e => console.warn('save NMEA pos error:', e?.message || e));
            }
        });
        socket.on('error', (e) => console.warn('TCP socket error', e.message));
    });
    srv.listen(port, () => console.log(`📡 NMEA TCP listening on ${port}`));
    return srv;
}

// Start servers
startGt06MixedServer(PORT_GT06);
startNmeaServer(PORT_NMEA);

// Sinaliza OFFLINE se não recebe nada há X minutos (cron simples)
const OFFLINE_MINUTES = Number(process.env.OFFLINE_MINUTES || 10);
setInterval(async () => {
    try {
        await pool.query(`
      UPDATE devices
         SET status='OFFLINE'
       WHERE (last_seen IS NULL OR last_seen < now() - interval '${OFFLINE_MINUTES} minutes')
         AND (status IS DISTINCT FROM 'OFFLINE')
    `);
    } catch (e) { console.warn('offline cron', e.message); }
}, 60_000);

// ==== Socket.IO auth opcional (somente log) ====
io.use((socket, next) => { next(); });
io.on('connection', (socket) => { socket.on('disconnect', () => { }); });

// ==== Start ====
server.listen(PORT, () => console.log(`🚀 Web server on http://localhost:${PORT}`));
