// js/objects.js

document.addEventListener('DOMContentLoaded', () => {
    // 0) Verifica token
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/';
        return;
    }
    const authHeader = { 'Authorization': 'Bearer ' + token };

    // Inicializa o mapa
    const map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 300);

    let vehicleMarkers = {};
    let eventMarkers = [];
    let historyLine = null;

    // 1) Carrega veículos
    async function loadVehicles() {
        try {
            const res = await fetch('/api/objects', { headers: authHeader });
            if (res.status === 401) throw new Error('Não autorizado');
            const vehicles = await res.json();
            const list = document.getElementById('vehicle-list');
            const select = document.getElementById('history-vehicle');
            list.innerHTML = '';
            select.innerHTML = '<option value="">Selecione...</option>';

            vehicles.forEach(v => {
                // lista
                const li = document.createElement('li');
                li.className = 'list-group-item';
                li.textContent = v.name;
                li.onclick = () => {
                    map.setView([v.lat, v.lng], 12);
                    vehicleMarkers[v.id].openPopup();
                };
                list.appendChild(li);

                // select histórico
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.textContent = v.name;
                select.appendChild(opt);

                // marcador
                if (vehicleMarkers[v.id]) map.removeLayer(vehicleMarkers[v.id]);
                const m = L.marker([v.lat, v.lng])
                    .bindPopup(`<b>${v.name}</b>`)
                    .addTo(map);
                vehicleMarkers[v.id] = m;
            });

            if (Object.keys(vehicleMarkers).length) {
                const group = L.featureGroup(Object.values(vehicleMarkers));
                map.fitBounds(group.getBounds().pad(0.2));
            }
            map.invalidateSize();
        } catch (err) {
            if (err.message === 'Não autorizado') {
                localStorage.removeItem('token');
                window.location.href = '/';
            } else {
                notify('error', 'Falha ao carregar veículos.');
            }
        }
    }

    // 2) Carrega eventos
    async function loadEvents() {
        try {
            const res = await fetch('/api/events', { headers: authHeader });
            if (res.status === 401) throw new Error('Não autorizado');
            const events = await res.json();
            const list = document.getElementById('event-list');
            list.innerHTML = '';
            eventMarkers.forEach(m => map.removeLayer(m));
            eventMarkers = [];

            events.forEach(ev => {
                const li = document.createElement('li');
                li.className = 'list-group-item';
                li.textContent = `${new Date(ev.time).toLocaleString()} – ${ev.description}`;
                li.onclick = () => map.setView([ev.lat, ev.lng], 14);
                list.appendChild(li);

                const c = L.circle([ev.lat, ev.lng], {
                    radius: 100,
                    color: 'red'
                })
                    .bindPopup(ev.description)
                    .addTo(map);
                eventMarkers.push(c);
            });
            map.invalidateSize();
        } catch (err) {
            if (err.message === 'Não autorizado') {
                localStorage.removeItem('token');
                window.location.href = '/';
            } else {
                notify('error', 'Falha ao carregar eventos.');
            }
        }
    }

    // 3) Mostrar histórico
    document.getElementById('btn-history').addEventListener('click', async () => {
        const vid = document.getElementById('history-vehicle').value;
        const start = document.getElementById('history-start').value;
        const end = document.getElementById('history-end').value;
        if (!vid || !start || !end) {
            notify('warning', 'Selecione veículo, início e fim.');
            return;
        }
        try {
            const url = `/api/history?vehicleId=${vid}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
            const res = await fetch(url, { headers: authHeader });
            if (res.status === 401) throw new Error('Não autorizado');
            const coords = await res.json();
            if (historyLine) map.removeLayer(historyLine);
            historyLine = L.polyline(coords.map(c => [c.lat, c.lng]), {
                color: 'blue'
            }).addTo(map);
            map.fitBounds(historyLine.getBounds().pad(0.2));
            map.invalidateSize();
        } catch (err) {
            if (err.message === 'Não autorizado') {
                localStorage.removeItem('token');
                window.location.href = '/';
            } else {
                notify('error', 'Falha ao carregar histórico.');
            }
        }
    });

    // 4) Eventos de aba
    document.getElementById('vehicles-tab').addEventListener('shown.bs.tab', loadVehicles);
    document.getElementById('events-tab').addEventListener('shown.bs.tab', loadEvents);

    // 5) Carrega inicialmente veículos
    loadVehicles();
});
