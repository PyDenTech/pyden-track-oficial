// js/objects-admin.js
document.addEventListener('DOMContentLoaded', () => {
    // ativa ícone da página
    const currentPath = location.pathname.replace(/\/$/, '');
    document.querySelectorAll('.navbar .nav-link').forEach(a => {
        const href = (a.getAttribute('href') || '').replace(/\/$/, '');
        if (href && href === currentPath) a.classList.add('active');
    });

    // injeta nome(cargo)
    const token = localStorage.getItem('token');
    if (token && document.getElementById('user-info')) {
        fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(u => { document.getElementById('user-info').textContent = `${u.name} (${u.role})`; })
            .catch(() => { document.getElementById('user-info').textContent = 'Usuário'; });
    }

    // popula select de fuso horário (-12..+14)
    const tzSel = document.getElementById('tz-offset');
    for (let h = -12; h <= 14; h++) {
        const lab = h === 0 ? 'UTC±00:00' : `UTC${h > 0 ? '+' : ''}${String(h).padStart(2, '0')}:00`;
        const opt = document.createElement('option');
        opt.value = h; opt.textContent = lab;
        if (h === -3) opt.selected = true; // BR padrão
        tzSel.appendChild(opt);
    }

    // DataTable de dispositivos
    const table = $('#devices-table').DataTable({
        language: { url: 'https://cdn.datatables.net/plug-ins/1.13.4/i18n/pt-BR.json' },
        columns: [
            { data: 'name' },
            { data: 'imei' },
            { data: 'protocol' },
            { data: 'group' },
            { data: 'carrier' },
            { data: 'status', render: s => s || '—' },
            { data: 'last_seen', render: d => d ? new Date(d).toLocaleString('pt-BR') : '—' },
            {
                data: null, orderable: false,
                render: row => `
          <button class="btn btn-sm btn-primary me-1" onclick="editDevice(${row.id})"><i class="bi bi-pencil-fill"></i></button>
          <button class="btn btn-sm btn-danger" onclick="deleteDevice(${row.id})"><i class="bi bi-trash-fill"></i></button>`
            }
        ],
        responsive: true
    });

    // carrega lista (AJUSTE o endpoint conforme seu backend)
    fetch('/api/devices', { headers: { Authorization: 'Bearer ' + token } })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => table.rows.add(data).draw())
        .catch(() => notify('error', 'Falha ao carregar dispositivos.'));

    // ====== PROTOCOLOS (extensível) ======
    const protocols = {
        J16: {
            idLabel: 'IMEI (15 dígitos)',
            explain: 'Comandos SMS conforme manual J16.',
            visibleClasses: ['j16-only'],
            sms: (ctx) => {
                const parts = [];
                // SERVER: DNS=1 / IP=0
                if (ctx.host && ctx.port) {
                    if (ctx.srvType === 'dns') parts.push(`SERVER,1,${ctx.host},${ctx.port},0#`);
                    else parts.push(`SERVER,0,${ctx.host},${ctx.port},0#`);
                }
                // APN
                if (ctx.apn) parts.push(`APN,${ctx.apn},${ctx.apnUser || ''},${ctx.apnPass || ''}#`);
                // TIMER (on/off)
                if (ctx.timerOn && ctx.timerOff) parts.push(`TIMER,${ctx.timerOn},${ctx.timerOff}#`);
                // Timezone (E/W,hh,mm)
                const east = ctx.tz >= 0, hh = Math.abs(ctx.tz), mm = 0;
                parts.push(`GMT,${east ? 'E' : 'W'},${hh},${mm}#`);
                // Heartbeat (mantém mesmos tempos do TIMER)
                if (ctx.timerOn && ctx.timerOff) parts.push(`HBT,${ctx.timerOn},${ctx.timerOff}#`);
                // Ângulo/Intervalo
                if (ctx.timerOn && ctx.angle) parts.push(`SZCS#ANGLEVALUE=${ctx.timerOn}-${String(ctx.angle).padStart(3, '0')}`);
                // IGN virtual
                if (ctx.accVirt !== undefined) parts.push(`SZCS#ACCLINE=${ctx.accVirt}`);
                return parts;
            }
        },
        GT06: {
            idLabel: 'IMEI (15 dígitos)',
            explain: 'GT06 usa o IMEI como Terminal ID. SMS varia por fabricante/modelo; use o manual do modelo.',
            visibleClasses: [],
            sms: () => [
                '— O protocolo GT06 não padroniza SMS neste documento.',
                '— Garanta APN e SERVER corretos no aparelho conforme o manual do fabricante.'
            ]
        },
        GENERIC: {
            idLabel: 'ID / IMEI',
            explain: 'Campos genéricos para outros protocolos.',
            visibleClasses: [],
            sms: (ctx) => {
                const parts = [];
                if (ctx.apn) parts.push(`APN=${ctx.apn} USER=${ctx.apnUser || ''} PASS=${ctx.apnPass || ''}`);
                if (ctx.host && ctx.port) parts.push(`SERVER=${ctx.host}:${ctx.port}`);
                return parts.length ? parts : ['— Sem template definido.'];
            }
        }
    };

    // alterna campos conforme protocolo e atualiza preview
    const protoSel = document.getElementById('dev-protocol');
    function toggleProtocolFields() {
        document.querySelectorAll('.j16-only').forEach(el => el.style.display = 'none');
        const p = protocols[protoSel.value];
        (p.visibleClasses || []).forEach(cls => {
            document.querySelectorAll('.' + cls).forEach(el => el.style.display = '');
        });
        document.querySelector('label[for="dev-imei"]')?.setAttribute('for', 'dev-imei'); // só pra evitar warnings
        document.querySelector('#tab-sms #sms-hint').textContent = p.explain;
        buildSmsPreview();
    }
    protoSel.addEventListener('change', toggleProtocolFields);
    toggleProtocolFields();

    // constrói os comandos
    function ctx() {
        return {
            srvType: document.getElementById('srv-type').value,
            host: document.getElementById('srv-host').value.trim(),
            port: document.getElementById('srv-port').value.trim(),
            apn: document.getElementById('apn-name').value.trim(),
            apnUser: document.getElementById('apn-user').value.trim(),
            apnPass: document.getElementById('apn-pass').value.trim(),
            tz: parseInt(document.getElementById('tz-offset').value, 10),
            timerOn: document.getElementById('j16-timer-on')?.value,
            timerOff: document.getElementById('j16-timer-off')?.value,
            angle: document.getElementById('j16-angle')?.value,
            accVirt: document.getElementById('j16-acc-virtual') ? document.getElementById('j16-acc-virtual').value : undefined
        };
    }
    function buildSmsPreview() {
        const p = protocols[protoSel.value];
        const list = p.sms(ctx());
        const cont = document.getElementById('sms-preview');
        cont.innerHTML = '';
        list.forEach(line => {
            const row = document.createElement('div');
            row.className = 'cmd-line';
            row.innerHTML = `<code>${line}</code>
        <button type="button" class="btn btn-sm btn-outline-secondary">Copiar</button>`;
            row.querySelector('button').onclick = () => navigator.clipboard.writeText(line);
            cont.appendChild(row);
        });
    }
    document.querySelectorAll('#form-net input, #form-net select').forEach(el => {
        el.addEventListener('input', buildSmsPreview);
        el.addEventListener('change', buildSmsPreview);
    });

    // salvar dispositivo (AJUSTE endpoint/back-end conforme sua API)
    document.getElementById('save-device').addEventListener('click', async () => {
        const payload = {
            name: document.getElementById('dev-name').value.trim(),
            protocol: protoSel.value,
            group: document.getElementById('dev-group').value,
            imei: document.getElementById('dev-imei').value.trim(),
            msisdn: document.getElementById('dev-msisdn').value.trim(),
            carrier: document.getElementById('dev-carrier').value,
            notes: document.getElementById('dev-notes').value.trim(),
            apn: document.getElementById('apn-name').value.trim(),
            apn_user: document.getElementById('apn-user').value.trim(),
            apn_pass: document.getElementById('apn-pass').value.trim(),
            server_type: document.getElementById('srv-type').value,
            server_host: document.getElementById('srv-host').value.trim(),
            server_port: parseInt(document.getElementById('srv-port').value, 10),
            tz: parseInt(document.getElementById('tz-offset').value, 10),
            j16: {
                timer_on: parseInt(document.getElementById('j16-timer-on')?.value || 0, 10),
                timer_off: parseInt(document.getElementById('j16-timer-off')?.value || 0, 10),
                angle: parseInt(document.getElementById('j16-angle')?.value || 0, 10),
                acc_virtual: document.getElementById('j16-acc-virtual')?.value
            }
        };

        if (!payload.name || !/^\d{15}$/.test(payload.imei)) {
            notify('warning', 'Informe nome e IMEI válido (15 dígitos).');
            return;
        }

        try {
            const res = await fetch('/api/devices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw 0;
            notify('success', 'Dispositivo cadastrado com sucesso.');
            document.querySelector('#addDeviceModal .btn-close').click();
            // recarrega tabela
            const fresh = await fetch('/api/devices', { headers: { Authorization: 'Bearer ' + (token || '') } }).then(r => r.json());
            table.clear().rows.add(fresh).draw();
        } catch {
            notify('error', 'Falha ao salvar dispositivo.');
        }
    });

    // ações da tabela (edite conforme back-end)
    window.editDevice = (id) => location.href = `/dashboard/users/objects/edit.html?id=${id}`;
    window.deleteDevice = async (id) => {
        if (!confirm('Excluir este dispositivo?')) return;
        try {
            const ok = await fetch(`/api/devices/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + (token || '') } })
                .then(r => r.ok);
            if (!ok) throw 0;
            notify('success', 'Dispositivo removido.');
            table.row($(`[onclick="deleteDevice(${id})"]`).parents('tr')).remove().draw();
        } catch {
            notify('error', 'Não foi possível remover.');
        }
    };
});
