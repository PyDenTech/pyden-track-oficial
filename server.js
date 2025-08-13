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
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// ==== Socket.IO (realtime) ====
const { Server } = require('socket.io');
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

const connStr = process.env.DATABASE_URL;

// Carrega o CA do RDS (arquivo que baixamos)
const rdsCa = fs.readFileSync(path.join(__dirname, 'rds-ca.pem')).toString();

const pool = new Pool({
    connectionString: connStr,
    ssl: {
        ca: rdsCa,
        rejectUnauthorized: true, // valida a cadeia usando o CA correto
    },
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
        <p style="margin:8px 0;font-size:15px;line-height:1.5;">
          Olá,<br>Use o código abaixo para continuar. Ele é válido por <strong>${minutes}</strong> minutos.
        </p>
        <div style="background-color:#f3f4f6;border:2px dashed #2563eb;border-radius:6px;padding:16px;margin:20px 0;text-align:center;">
          <span style="display:inline-block;font-size:32px;font-weight:bold;letter-spacing:8px;color:#2563eb;">
            ${code}
          </span>
        </div>
        <p style="margin:8px 0;font-size:14px;color:#6b7280;">Se você não fez esta solicitação, ignore este e-mail.</p>
        <div style="text-align:center;margin-top:24px;">
          <a href="${baseUrl}" target="_blank" style="display:inline-block;padding:12px 24px;background-color:#2563eb;color:#fff;text-decoration:none;border-radius:4px;font-size:15px;">
            Acessar PyDen Track
          </a>
        </div>
      </div>
      <div style="background-color:#f9fafb;padding:12px;text-align:center;font-size:12px;color:#9ca3af;">
        © ${new Date().getFullYear()} PyDen Track. Todos os direitos reservados.
      </div>
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
// login
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

// check-email
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

// verify-code
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

// reset-password
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

// opcional
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
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao listar posições.' }); }
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

/**
 * Salva posição + atualiza "devices.last_*" e emite socket.
 */
async function savePositionByImei(imei, pos) {
    // procura device
    const dres = await pool.query(`SELECT id FROM devices WHERE imei=$1 LIMIT 1`, [String(imei)]);
    if (!dres.rowCount) return false;
    const deviceId = dres.rows[0].id;

    // insere positions
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
        raw_payload: pos.raw_payload || null
    };

    await pool.query(`
    INSERT INTO positions (device_id, fix_time, lat, lng, speed_kmh, course_deg, altitude_m, satellites, hdop, ignition, battery_v, raw_payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [p.device_id, p.fix_time, p.lat, p.lng, p.speed_kmh, p.course_deg, p.altitude_m, p.satellites, p.hdop, p.ignition, p.battery_v, p.raw_payload]);

    // atualiza devices
    await pool.query(`
    UPDATE devices SET
      last_seen=now(),
      status='ONLINE',
      last_lat=$1, last_lng=$2, last_speed_kmh=$3, last_course_deg=$4, last_fix_time=$5,
      updated_at=now()
    WHERE id=$6
  `, [p.lat, p.lng, p.speed_kmh, p.course_deg, p.fix_time, deviceId]);

    // emite realtime
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

// ---- Parsers básicos (ASCII) ----

// TK103-like: "imei:123456789012345,tracker,123456789,GPRMC,...,lat,lon,..." (varia MUITO)
// Aqui pegamos o padrão comum: imei:<imei>,<type>,... ,latitude,longitude, velocidade(km/h) opcional
function tryParseTK103(line) {
    if (!/^imei:\d+/.test(line)) return null;
    const imei = (line.match(/^imei:(\d{10,20})/) || [])[1];
    // latitude/longitude no final: ",<lat>,<lng>,"
    const parts = line.split(',');
    // tenta achar lat/lon (alguns enviam ... , F, lat, lon, speed, course)
    let lat = null, lng = null, speed = null;
    for (let i = 0; i < parts.length - 1; i++) {
        const a = parseFloat(parts[i]), b = parseFloat(parts[i + 1]);
        if (isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) {
            lat = a; lng = b;
            // speed: próximo campo se existir (km/h)
            const sp = parseFloat(parts[i + 2]);
            if (isFinite(sp)) speed = sp;
            break;
        }
    }
    if (imei && lat != null && lng != null) {
        return { imei, lat, lng, speed_kmh: speed || 0 };
    }
    return { imei }; // ao menos volta o IMEI
}

// NMEA $GPRMC,hhmmss,A,lat,NS,lon,EW,speed(kn),course,date,...
function tryParseNmeaRmc(line) {
    if (!/^\$GPRMC,/.test(line)) return null;
    const p = line.trim().split(',');
    if (p.length < 12) return null;
    const status = p[2]; // A=ativo, V=void
    if (status !== 'A') return null;
    const latRaw = p[3], latHem = p[4];
    const lonRaw = p[5], lonHem = p[6];
    const spKn = parseFloat(p[7] || '0');
    const course = parseFloat(p[8] || '0');
    const dateStr = p[9]; const timeStr = p[1];

    function dmToDeg(dm) {
        // ddmm.mmmm -> dd + mm/60
        const v = parseFloat(dm);
        const deg = Math.floor(v / 100);
        const min = v - deg * 100;
        return deg + (min / 60);
    }
    let lat = dmToDeg(latRaw);
    let lon = dmToDeg(lonRaw);
    if (latHem === 'S') lat = -lat;
    if (lonHem === 'W') lon = -lon;

    // gera Date (UTC)
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

// ---- Servidores TCP ----
const PORT_GT06 = Number(process.env.LISTEN_GT06 || 7002);   // TK103/GT06 ASCII-like
const PORT_NMEA = Number(process.env.LISTEN_NMEA || 7010);   // NMEA (quando disponível)

function startTcpServer(port, onLine) {
    const srv = net.createServer((socket) => {
        socket.setEncoding('utf8');
        socket.on('data', async (chunk) => {
            const lines = String(chunk).replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
            for (const line of lines) {
                try { await onLine(line, socket); } catch (e) { console.warn('parser err:', e?.message || e); }
            }
        });
        socket.on('error', (e) => console.warn('TCP socket error', e.message));
    });
    srv.listen(port, () => console.log(`📡 TCP listening on ${port}`));
    return srv;
}

// GT06/TK103 ASCII-ish
startTcpServer(PORT_GT06, async (line, socket) => {
    // alguns modelos pedem ACK “ON” para login/sinal de vida:
    if (line.startsWith('##')) { socket.write('LOAD'); return; }

    // tenta TK103-like
    let parsed = tryParseTK103(line);
    if (parsed?.imei && parsed.lat != null) {
        await savePositionByImei(parsed.imei, {
            lat: parsed.lat, lng: parsed.lng,
            speed_kmh: parsed.speed_kmh ?? 0,
            raw_payload: Buffer.from(line)
        });
        return;
    }

    // tenta NMEA RMC embutido (alguns enviam "...,$GPRMC,...")
    const rmcIdx = line.indexOf('$GPRMC,');
    if (parsed?.imei && rmcIdx >= 0) {
        const rmc = tryParseNmeaRmc(line.slice(rmcIdx));
        if (rmc) {
            await savePositionByImei(parsed.imei, { ...rmc, raw_payload: Buffer.from(line) });
            return;
        }
    }

    // se não reconheceu mas tinha IMEI, ao menos mantém online
    if (parsed?.imei) {
        await savePositionByImei(parsed.imei, { lat: 0, lng: 0, speed_kmh: 0, raw_payload: Buffer.from(line) });
    }
});

// NMEA puro ($GPRMC...). Aqui precisamos do IMEI antes (alguns enviam numa primeira linha)
// Estratégia simples: se a conexão mandar "IMEI:xxxxxxxxxxxxxxx" antes do NMEA, guardamos.
startTcpServer(PORT_NMEA, (() => {
    const lastImeiBySocket = new WeakMap();
    return async (line, socket) => {
        const mImei = line.match(/^IMEI[:=](\d{10,20})$/i);
        if (mImei) { lastImeiBySocket.set(socket, mImei[1]); return; }

        const rmc = tryParseNmeaRmc(line);
        if (!rmc) return;
        const imei = lastImeiBySocket.get(socket);
        if (!imei) return; // precisamos do IMEI previamente
        await savePositionByImei(imei, { ...rmc, raw_payload: Buffer.from(line) });
    };
})());

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
io.use((socket, next) => {
    // você pode validar o token aqui se quiser bloquear
    // const token = socket.handshake.auth?.token;
    next();
});

io.on('connection', (socket) => {
    // console.log('socket connected', socket.id);
    socket.on('disconnect', () => { /* noop */ });
});


// ==== Start ====
server.listen(PORT, () => console.log(`🚀 Web server on http://localhost:${PORT}`));
