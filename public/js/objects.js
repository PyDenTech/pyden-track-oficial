// /public/js/objects.js
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const authHeader = token ? { Authorization: 'Bearer ' + token } : {};
    if (!token) {
        notify('warning', 'Sessão expirada. Faça login novamente.');
        setTimeout(() => (window.location.href = '/'), 800);
        return;
    }

    // ===== Mapa =====
    const map = L.map('map', { zoomControl: true }).setView([-14.2, -51.9], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    // markers[id] -> { m: LeafletMarker, visible: bool, data: lastDeviceObj }
    const markers = {};
    let trackLayer = null;

    // ===== UI refs =====
    const vehicleList = document.getElementById('vehicle-list');
    const histSelect = document.getElementById('history-vehicle');
    const histStart = document.getElementById('history-start');
    const histEnd = document.getElementById('history-end');
    const btnHistory = document.getElementById('btn-history');

    // index DOM p/ updates
    const deviceDom = new Map(); // id -> { li,nameEl,statusEl,pillIgn,pillGps,cb,groupName }
    const groupDom = new Map(); // groupName -> { wrap, header, body, cb }

    // ===== Helpers =====
    const esc = (s = '') =>
        String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

    const fmtSpeed = v => Number.isFinite(+v) ? `${(+v).toFixed(0)} km/h` : '—';
    const fmtCourse = v => Number.isFinite(+v) ? `${(+v).toFixed(0)}°` : '—';

    // estilos do popup (injetar 1x)
    (function injectPopupStylesOnce() {
        if (document.getElementById('device-popup-style')) return;
        const css = `
      .leaflet-popup-content { margin: 0; }
      .device-pop .leaflet-popup-content-wrapper {
        background:#1f2429; color:#f2f4f6; border-radius:12px; box-shadow:0 10px 24px rgba(0,0,0,.25);
        border:1px solid rgba(255,255,255,.06);
      }
      .device-pop .leaflet-popup-tip { background:#1f2429; }
      .popup-wrap { min-width:260px; overflow:hidden; }
      .popup-actions { display:flex; gap:6px; padding:8px; background:#2a2f35; border-bottom:1px solid rgba(255,255,255,.06); }
      .popup-btn {
        flex:1; display:flex; align-items:center; justify-content:center; gap:6px;
        background:#343a40; border:1px solid rgba(255,255,255,.08); color:#fff;
        padding:8px 10px; font-size:12px; border-radius:10px; cursor:pointer;
      }
      .popup-btn:hover { background:#3e454d; }
      .popup-info { padding:10px 12px 12px; }
      .popup-title { font-weight:700; font-size:15px; line-height:1.2; }
      .popup-sub { font-size:12px; color:#b7c0c8; margin-top:2px; }
      .popup-sep { height:1px; border:0; background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent); margin:8px 0; }
      .popup-grid { display:grid; grid-template-columns:110px 1fr; row-gap:4px; column-gap:10px; font-size:13px; }
      .popup-k { color:#cdd6de; font-weight:600; text-align:right; }
      .popup-v { color:#ffffff; }
      .devtip { background:#111; color:#fff; border:0; padding:2px 6px; border-radius:4px; }
    `;
        const style = document.createElement('style');
        style.id = 'device-popup-style';
        style.textContent = css;
        document.head.appendChild(style);
    })();

    const markerTooltip = d =>
        `${esc(d.name)}${Number.isFinite(+d.last_speed_kmh) ? ` (${fmtSpeed(d.last_speed_kmh)})` : ''}`;

    function buildPopupHTML(d) {
        const dt = d.last_fix_time ? new Date(d.last_fix_time) : null;
        const dtStr = dt ? dt.toLocaleString('pt-BR') : '—';
        const ign = d.ignition === true ? 'Ligada' : d.ignition === false ? 'Desligada' : '—';
        const gpsV = d.gps_signal === true ? 'OK' : d.gps_signal === false ? 'Fraco/ausente' : '—';

        return `
      <div class="popup-wrap">
        <div class="popup-actions">
          <button class="popup-btn" data-act="center" data-id="${d.id}">
            <i class="bi bi-crosshair"></i><span>Centralizar</span>
          </button>
          <button class="popup-btn" data-act="today" data-id="${d.id}">
            <i class="bi bi-clock-history"></i><span>Trajeto (hoje)</span>
          </button>
          <button class="popup-btn" data-act="details" data-id="${d.id}">
            <i class="bi bi-info-circle"></i><span>Detalhes</span>
          </button>
        </div>

        <div class="popup-info">
          <div class="popup-title">${esc(d.name)}</div>
          <div class="popup-sub">${esc(d.group || 'Desagrupado')}</div>
          <hr class="popup-sep"/>
          <div class="popup-grid">
            <div class="popup-k">Status:</div><div class="popup-v">${esc(d.status || '—')}</div>
            <div class="popup-k">Velocidade:</div><div class="popup-v">${fmtSpeed(d.last_speed_kmh)}</div>
            <div class="popup-k">Curso:</div><div class="popup-v">${fmtCourse(d.last_course_deg)}</div>
            <div class="popup-k">Ignição:</div><div class="popup-v">${ign}</div>
            <div class="popup-k">Sinal GPS:</div><div class="popup-v">${gpsV}</div>
            <div class="popup-k">Último registro:</div><div class="popup-v">${dtStr}</div>
          </div>
        </div>
      </div>`;
    }

    function bindPopupActions(popEl, d) {
        if (!popEl) return;
        popEl.querySelectorAll('[data-act]').forEach(btn => {
            const act = btn.getAttribute('data-act');
            btn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                if (act === 'center') {
                    locateDevice(d);
                } else if (act === 'today') {
                    const now = new Date(); const start = new Date(now); start.setHours(0, 0, 0, 0);
                    await drawHistory(d.id, start.toISOString(), now.toISOString());
                } else if (act === 'details') {
                    notify('info', `Dispositivo #${d.id}: ${d.name}`);
                }
            });
        });
    }

    function ensureMarker(d) {
        const lat = Number(d.last_lat ?? d.lat);
        const lng = Number(d.last_lng ?? d.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        if (!markers[d.id]) {
            const m = L.marker([lat, lng], { riseOnHover: true });
            m.bindTooltip(markerTooltip(d), { direction: 'top', offset: [0, -8], className: 'devtip' });
            m.bindPopup(buildPopupHTML(d), { className: 'device-pop' });
            m.on('popupopen', (e) => bindPopupActions(e.popup.getElement(), d));
            m.addTo(map);
            markers[d.id] = { m, visible: true, data: d };
        } else {
            const rec = markers[d.id];
            rec.data = { ...rec.data, ...d };
            rec.m.setLatLng([lat, lng]);
            rec.m.setTooltipContent(markerTooltip(rec.data));
            rec.m.setPopupContent(buildPopupHTML(rec.data));
            rec.m.off('popupopen');
            rec.m.on('popupopen', (e) => bindPopupActions(e.popup.getElement(), rec.data));
        }
        return markers[d.id];
    }

    function setDeviceVisible(id, visible) {
        const rec = markers[id]; if (!rec) return;
        rec.visible = !!visible;
        if (visible) { if (!map.hasLayer(rec.m)) rec.m.addTo(map); }
        else { if (map.hasLayer(rec.m)) map.removeLayer(rec.m); }
    }

    function refreshGroupCheckbox(groupName) {
        const g = groupDom.get(groupName); if (!g) return;
        const cbs = Array.from(g.body.querySelectorAll('input.device-check'));
        if (!cbs.length) { g.cb.indeterminate = false; g.cb.checked = false; return; }
        const checked = cbs.filter(cb => cb.checked).length;
        g.cb.indeterminate = checked > 0 && checked < cbs.length;
        g.cb.checked = checked === cbs.length;
    }

    function fitToVisibleMarkers() {
        const layers = Object.values(markers).filter(r => r.visible && map.hasLayer(r.m)).map(r => r.m);
        if (!layers.length) return;
        const fg = L.featureGroup(layers);
        map.fitBounds(fg.getBounds().pad(0.2));
    }

    function locateDevice(d) {
        const rec = markers[d.id];
        if (rec) {
            setDeviceVisible(d.id, true);
            map.setView(rec.m.getLatLng(), 14);
            rec.m.openPopup();
        } else {
            notify('info', 'Sem posição recente para este dispositivo.');
        }
        histSelect.value = String(d.id);
    }

    function openHistoryFor(d) {
        new bootstrap.Tab(document.querySelector('#history-tab')).show();
        histSelect.value = String(d.id);
        document.getElementById('history-start').focus();
    }

    // ===== Dropdown (3 pontos) =====
    let openDropdown = null;
    function showDropdown(btnEl, d) {
        hideDropdown();
        const wrap = document.createElement('div');
        wrap.className = 'sidebar-dropdown';
        wrap.innerHTML = `
      <div class="item" data-act="details"><i class="bi bi-info-circle me-2"></i>Detalhes</div>
      <div class="item" data-act="route-today"><i class="bi bi-clock-history me-2"></i>Trajeto (hoje)</div>
      <div class="item" data-act="center"><i class="bi bi-crosshair me-2"></i>Centralizar no mapa</div>
    `;
        const r = btnEl.getBoundingClientRect();
        wrap.style.top = `${Math.round(r.top)}px`;
        wrap.style.left = `${Math.round(r.right + 8)}px`;
        document.body.appendChild(wrap);
        requestAnimationFrame(() => wrap.classList.add('show'));
        openDropdown = wrap;

        wrap.addEventListener('click', async (e) => {
            const act = e.target.closest('.item')?.dataset.act;
            if (act === 'details') {
                notify('info', `Dispositivo #${d.id}: ${d.name}`);
            } else if (act === 'route-today') {
                const now = new Date(); const start = new Date(now); start.setHours(0, 0, 0, 0);
                await drawHistory(d.id, start.toISOString(), now.toISOString());
            } else if (act === 'center') {
                locateDevice(d);
            }
            hideDropdown();
        });

        setTimeout(() => document.addEventListener('click', clickAway, { once: true }), 0);
        function clickAway(ev) { if (!wrap.contains(ev.target) && ev.target !== btnEl) hideDropdown(); }
    }
    function hideDropdown() {
        if (openDropdown && openDropdown.parentElement) {
            openDropdown.classList.remove('show');
            openDropdown.addEventListener('transitionend', () => {
                openDropdown?.parentElement?.removeChild(openDropdown);
                openDropdown = null;
            }, { once: true });
        } else openDropdown = null;
    }

    // ===== Linha do dispositivo (checkbox) =====
    function renderDeviceLine(d, groupName) {
        const online = (d.status || '').toUpperCase() === 'ONLINE';
        const li = document.createElement('li');
        li.className = 'device-item';

        const pillIgn = (d.ignition === true || d.ignition === false)
            ? `<span class="pill pill-ign ${d.ignition ? 'on' : 'off'}" title="Ignição">
           <i class="bi ${d.ignition ? 'bi-lightning-charge-fill' : 'bi-lightning-charge'}"></i>
         </span>` : '';

        const pillGps = (d.gps_signal === true || d.gps_signal === false)
            ? `<span class="pill pill-gps ${d.gps_signal ? 'ok' : 'bad'}" title="Sinal GPS">
           <i class="bi bi-broadcast-pin"></i>
         </span>` : '';

        li.innerHTML = `
      <div class="device-left">
        <input class="form-check-input device-check me-2" type="checkbox" checked aria-label="Mostrar no mapa">
        <i class="bi bi-hdd-stack"></i>
        <div class="device-name">${esc(d.name)}</div>
        <span class="device-status ${online ? 'online' : 'offline'}">${online ? 'ONLINE' : 'OFFLINE'}</span>
        ${pillIgn}${pillGps}
      </div>
      <div class="device-actions">
        <button class="action-btn" title="Centralizar" data-act="locate"><i class="bi bi-crosshair"></i></button>
        <button class="action-btn" title="Histórico" data-act="history"><i class="bi bi-clock-history"></i></button>
        <button class="action-btn" title="Mais" data-act="more"><i class="bi bi-three-dots"></i></button>
      </div>
    `;

        // eventos
        const cb = li.querySelector('.device-check');
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', () => {
            setDeviceVisible(d.id, cb.checked);
            refreshGroupCheckbox(groupName);
        });

        li.querySelector('[data-act="locate"]').addEventListener('click', (e) => { e.stopPropagation(); locateDevice(d); });
        li.querySelector('[data-act="history"]').addEventListener('click', (e) => { e.stopPropagation(); openHistoryFor(d); });
        li.querySelector('[data-act="more"]').addEventListener('click', (e) => { e.stopPropagation(); showDropdown(e.currentTarget, d); });
        li.addEventListener('click', () => locateDevice(d));

        deviceDom.set(d.id, {
            li,
            nameEl: li.querySelector('.device-name'),
            statusEl: li.querySelector('.device-status'),
            pillIgn: li.querySelector('.pill-ign') || null,
            pillGps: li.querySelector('.pill-gps') || null,
            cb,
            groupName
        });

        const rec = ensureMarker(d);
        if (rec) setDeviceVisible(d.id, cb.checked);

        return li;
    }

    // ===== Grupo (accordion + checkbox) =====
    function renderGroup(name, devices) {
        const g = document.createElement('div'); g.className = 'group';
        g.innerHTML = `
      <div class="group-header">
        <div class="title">
          <input class="form-check-input group-check me-2" type="checkbox" checked aria-label="Mostrar grupo no mapa">
          <i class="bi bi-folder2"></i> <span>${esc(name)}</span>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="badge bg-light text-dark">${devices.length}</span>
          <i class="bi bi-chevron-down chev"></i>
        </div>
      </div>
      <div class="group-body"></div>
    `;
        const body = g.querySelector('.group-body');
        const header = g.querySelector('.group-header');
        const cb = g.querySelector('.group-check');

        devices.forEach(d => body.appendChild(renderDeviceLine(d, name)));

        header.addEventListener('click', (ev) => {
            if (ev.target === cb) return;
            g.classList.toggle('collapsed');
        });

        cb.addEventListener('change', () => {
            const devCbs = body.querySelectorAll('input.device-check');
            devCbs.forEach(c => { c.checked = cb.checked; c.dispatchEvent(new Event('change')); });
            cb.indeterminate = false;
            fitToVisibleMarkers();
        });

        groupDom.set(name, { wrap: g, header, body, cb });
        return g;
    }

    // ===== Carregar dispositivos =====
    async function loadAll() {
        vehicleList.innerHTML = '';
        histSelect.innerHTML = '<option value="">Selecione…</option>';

        // limpar camadas
        Object.values(markers).forEach(r => { if (map.hasLayer(r.m)) map.removeLayer(r.m); });
        for (const k in markers) delete markers[k];
        if (trackLayer) { map.removeLayer(trackLayer); trackLayer = null; }

        deviceDom.clear(); groupDom.clear();

        const devices = await fetch('/api/devices', { headers: authHeader }).then(r => r.ok ? r.json() : []);

        const grouped = {};
        devices.forEach(d => {
            const gname = d.group && String(d.group).trim() ? d.group : 'Desagrupado';
            (grouped[gname] ||= []).push(d);
            const opt = document.createElement('option'); opt.value = d.id; opt.textContent = d.name; histSelect.appendChild(opt);
        });

        Object.keys(grouped).sort().forEach(gname => vehicleList.appendChild(renderGroup(gname, grouped[gname])));
        fitToVisibleMarkers();

        // busca rápida
        const search = document.getElementById('vehicle-search');
        if (search) {
            search.addEventListener('input', () => {
                const q = search.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                vehicleList.querySelectorAll('.group').forEach(group => {
                    const matches = Array.from(group.querySelectorAll('.device-item')).filter(li => {
                        const txt = li.querySelector('.device-name').textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        const ok = txt.includes(q);
                        li.style.display = ok ? '' : 'none';
                        return ok;
                    }).length;
                    group.style.display = (q && !matches) ? 'none' : '';
                    if (q && matches) group.classList.remove('collapsed');
                });
            });
        }
    }

    // ===== Histórico =====
    async function drawHistory(id, startISO, endISO) {
        const url = new URL('/api/positions', window.location.origin);
        url.searchParams.set('device_id', id);
        if (startISO) url.searchParams.set('start', startISO);
        if (endISO) url.searchParams.set('end', endISO);

        const r = await fetch(url, { headers: authHeader });
        if (!r.ok) throw new Error('positions');
        const pts = await r.json();

        if (!Array.isArray(pts) || !pts.length) {
            notify('info', 'Sem pontos neste período.');
            if (trackLayer) { map.removeLayer(trackLayer); trackLayer = null; }
            return;
        }
        const latlngs = pts.map(p => [p.lat, p.lng]);
        if (trackLayer) map.removeLayer(trackLayer);
        trackLayer = L.polyline(latlngs, { weight: 4, opacity: .9 }).addTo(map);
        map.fitBounds(trackLayer.getBounds().pad(0.2));
    }

    btnHistory.addEventListener('click', async () => {
        const id = Number(histSelect.value);
        if (!Number.isFinite(id)) return notify('warning', 'Selecione um veículo.');
        const s = histStart.value ? new Date(histStart.value).toISOString() : '';
        const e = histEnd.value ? new Date(histEnd.value).toISOString() : '';
        try { await drawHistory(id, s, e); } catch { notify('error', 'Falha ao carregar histórico.'); }
    });

    // ===== Realtime =====
    function applyDeviceUpdate(u) {
        if (u.last_lat != null && u.last_lng != null) {
            ensureMarker(u);
            const rec = markers[u.id];
            if (rec && rec.visible === false && map.hasLayer(rec.m)) map.removeLayer(rec.m);
        }
        const el = deviceDom.get(u.id);
        if (el) {
            if (u.name) el.nameEl.textContent = u.name;
            if (u.status) {
                const on = (u.status || '').toUpperCase() === 'ONLINE';
                el.statusEl.textContent = on ? 'ONLINE' : 'OFFLINE';
                el.statusEl.classList.toggle('online', on);
                el.statusEl.classList.toggle('offline', !on);
            }
            if (el.pillIgn && 'ignition' in u) {
                el.pillIgn.classList.toggle('on', !!u.ignition);
                el.pillIgn.classList.toggle('off', !u.ignition);
            }
            if (el.pillGps && 'gps_signal' in u) {
                el.pillGps.classList.toggle('ok', !!u.gps_signal);
                el.pillGps.classList.toggle('bad', !u.gps_signal);
            }
        }
    }

    async function initRealtime() {
        try {
            if (window.io) {
                const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
                socket.on('device:update', applyDeviceUpdate);
                return;
            }
            throw new Error('no socket.io');
        } catch {
            setInterval(async () => {
                try {
                    const r = await fetch('/api/devices', { headers: authHeader });
                    if (!r.ok) return;
                    (await r.json()).forEach(applyDeviceUpdate);
                } catch { }
            }, 10000);
        }
    }

    (async () => { await loadAll(); initRealtime(); })();
});
