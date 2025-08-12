require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const objectRoutes = require('./routes/objectRoutes');
const clientRoutes = require('./routes/clientRoutes');
const deviceRoutes = require('./routes/deviceRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API
app.use('/api/auth', authRoutes);
app.use('/api', objectRoutes);
app.use('/api', clientRoutes);   // garante /api/clients (GET/POST/DELETE)
app.use('/api', deviceRoutes);   // /api/devices e /api/device-groups

// Frontend estático
const frontendPath = path.join(__dirname, '../..', 'frontend');
app.use(express.static(frontendPath));
app.use('/dashboard', express.static(path.join(frontendPath, 'dashboard')));

// Páginas
app.get('/', (_, res) => res.sendFile(path.join(frontendPath, 'index.html')));
app.get('/recover', (_, res) => res.sendFile(path.join(frontendPath, 'recover.html')));
app.get('/dashboard/objects.html', (_, res) =>
    res.sendFile(path.join(frontendPath, 'dashboard', 'objects.html')));
app.get('/dashboard/users/clients.html', (_, res) =>
    res.sendFile(path.join(frontendPath, 'dashboard', 'users', 'clients.html')));

// Erros
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
});

app.listen(PORT, () => console.log(`🚀 Backend rodando na porta ${PORT}`));
