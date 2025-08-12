// src/controllers/objectController.js
const pool = require('../db');

/**
 * GET /api/objects
 * Retorna lista de veículos/objetos com { id, name, lat, lng }
 */
async function getObjects(req, res) {
    try {
        const result = await pool.query(
            `SELECT id, name, latitude AS lat, longitude AS lng
       FROM objects`
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar objetos.' });
    }
}

/**
 * GET /api/events
 * Retorna lista de eventos com { id, description, lat, lng, time }
 */
async function getEvents(req, res) {
    try {
        const result = await pool.query(
            `SELECT id, description, latitude AS lat, longitude AS lng, event_time AS time
       FROM events
       ORDER BY event_time DESC
       LIMIT 100`
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar eventos.' });
    }
}

/**
 * GET /api/history
 * Query params: vehicleId, start, end
 * Retorna [{ lat, lng }] ordenado por timestamp ASC
 */
async function getHistory(req, res) {
    const { vehicleId, start, end } = req.query;
    if (!vehicleId || !start || !end) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios: vehicleId, start, end' });
    }
    try {
        const result = await pool.query(
            `SELECT latitude AS lat, longitude AS lng
       FROM location_history
       WHERE vehicle_id = $1
         AND timestamp >= $2
         AND timestamp <= $3
       ORDER BY timestamp ASC`,
            [vehicleId, start, end]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar histórico.' });
    }
}

module.exports = { getObjects, getEvents, getHistory };
