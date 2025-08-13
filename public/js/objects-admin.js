// /public/js/objects-admin.js
(() => {
    const $ = window.jQuery;

    // ======= Helpers =======
    const token = localStorage.getItem('token');
    const authHeader = token ? { Authorization: 'Bearer ' + token } : {};
    const esc = (s = '') =>
        String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

    const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('pt-BR') : '—');
    const fmtStatus = (s) => {
        const on = (s || '').toUpperCase() === 'ONLINE';
        return `<span class="badge rounded-pill ${on ? 'text-bg-success' : 'text-bg-secondary'}">${on ? 'ONLINE' : 'OFFLINE'}</span>`;
    };

    const api = {
        async listDevices() {
            const r = await fetch('/api/devices', { headers: authHeader });
            if (!r.ok) throw new Error('Falha ao listar dispositivos');
            return r.json();
        },
        async listGroups() {
            const r = await fetch('/api/device-groups', { headers: authHeader });
            if (!r.ok) return [];
            return r.json(); // [{name,total}]
        },
        async createDevice(body) {
            const r = await fetch('/api/devices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha ao criar dispositivo');
            return r.json();
        },
        async updateDevice(id, body) {
            const r = await fetch(`/api/devices/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha ao atualizar dispositivo');
            return r.json();
        },
        async deleteDevice(id) {
            const r = await fetch(`/api/devices/${id}`, { method: 'DELETE', headers: authHeader });
            if (!r.ok) throw new Error('Falha ao excluir');
            return true;
        },
    };

    // ======= Estado do formulário / modal =======
    let editingId = null;
    const $modal = $('#addDeviceModal');

    const $name = $('#dev-name');
    const $protocol = $('#dev-protocol');
    const $group = $('#dev-group');
    const $imei = $('#dev-imei');
    const $msisdn = $('#dev-msisdn');
    const $carrier = $('#dev-carrier');
    const $notes = $('#dev-notes');

    const $apn = $('#apn-name');
    const $apnUser = $('#apn-user');
    const $apnPass = $('#apn-pass');
    const $srvType = $('#srv-type');
    const $srvHost = $('#srv-host');
    const $srvPort = $('#srv-port');
    const $tz = $('#tz-offset');

    // J16
    const $j16TimerOn = $('#j16-timer-on');
    const $j16TimerOff = $('#j16-timer-off');
    const $j16Angle = $('#j16-angle');
    const $j16Acc = $('#j16-acc-virtual');

    const $smsPreview = $('#sms-preview');
    const $smsHint = $('#sms-hint');

    // Mostrar/ocultar campos J16
    function toggleJ16Fields() {
        const isJ16 = $protocol.val() === 'J16';
        document.querySelectorAll('.j16-only').forEach((el) => (el.style.display = isJ16 ? '' : 'none'));
    }

    // Popular fusos (-12..+14)
    function fillTimezones() {
        if ($tz.children().length) return;
        for (let i = -12; i <= 14; i++) {
            const sign = i >= 0 ? '+' : '';
            const o = document.createElement('option');
            o.value = i;
            o.textContent = `UTC${sign}${i}`;
            $tz.append(o);
        }
        $tz.val('0');
    }

    // Popular grupos
    async function fillGroups() {
        $group.empty();
        $group.append(`<option value="">Desagrupado</option>`);
        try {
            const groups = await api.listGroups();
            groups
                .map((g) => g.name)
                .filter((n) => n && n.toLowerCase() !== 'desagrupado')
                .sort((a, b) => a.localeCompare(b))
                .forEach((name) => $group.append(`<option>${esc(name)}</option>`));
        } catch { }
    }

    // Gera comandos SMS (exemplos práticos — variam por fabricante/firmware)
    function buildSmsPreview() {
        const proto = $protocol.val();
        const apn = $apn.val()?.trim();
        const apnUser = $apnUser.val()?.trim();
        const apnPass = $apnPass.val()?.trim();
        const host = $srvHost.val()?.trim();
        const port = +$srvPort.val() || 0;
        const tz = +$tz.val() || 0;

        const blocks = [];
        if (!host || !port) {
            $smsHint.show();
            $smsPreview.empty();
            return;
        }
        $smsHint.hide();

        if (proto === 'GT06') {
            // Série TK/Concox: comandos típicos (podem variar)
            const apnCmd = apn
                ? apnUser || apnPass
                    ? `APN,${apn},${apnUser || 'user'},${apnPass || 'pass'}#`
                    : `APN,${apn}#`
                : null;
            // server: alguns usam "SERVER,1,dns,port#" ou "IP,ip,port#"
            const serverCmd = $srvType.val() === 'dns' ? `SERVER,1,${host},${port}#` : `SERVER,0,${host},${port}#`;
            const gprs = 'GPRS,1#';
            // timezone (ex.: GMT,E,3# ou GMT,W,3#) — aqui só sugerimos
            const tzCmd = tz >= 0 ? `GMT,E,${tz}#` : `GMT,W,${Math.abs(tz)}#`;
            // upload/report interval (exemplo)
            const report = 'UPLOAD,30#';

            blocks.push({
                title: 'GT06 (exemplo)',
                lines: [apnCmd, serverCmd, gprs, tzCmd, report].filter(Boolean),
            });
        } else if (proto === 'J16') {
            // Voxter/J16 (exemplo comum)
            const timerOn = +$j16TimerOn.val() || 60;
            const timerOff = +$j16TimerOff.val() || 3600;
            const angle = +$j16Angle.val() || 15;
            const acc = +$j16Acc.val() || 0;

            blocks.push({
                title: 'J16 (exemplo)',
                lines: [
                    apn ? `APN=${apn}` + (apnUser || apnPass ? `,${apnUser || 'user'},${apnPass || 'pass'}` : '') : null,
                    `SERVER=${host}`,
                    `PORT=${port}`,
                    `TIMER=${timerOn},${timerOff}`,
                    `ANGLE=${angle}`,
                    `ACCLINE=${acc}`,
                    `TIMEZONE=${tz}`,
                ].filter(Boolean),
            });
        } else {
            blocks.push({
                title: 'Genérico',
                lines: [
                    apn ? `APN ${apn} ${apnUser || ''} ${apnPass || ''}`.trim() : null,
                    `SERVER ${host} ${port}`,
                    `TIMEZONE ${tz}`,
                ].filter(Boolean),
            });
        }

        // Render
        $smsPreview.empty();
        blocks.forEach((b) => {
            const card = document.createElement('div');
            card.className = 'card mb-2';
            card.innerHTML = `
        <div class="card-body py-2">
          <div class="fw-semibold mb-1">${b.title}</div>
          <code class="d-block small">${b.lines.map(esc).join('<br>')}</code>
        </div>
      `;
            $smsPreview.append(card);
        });
    }

    function readForm() {
        return {
            name: $name.val()?.trim(),
            protocol: $protocol.val(),
            device_group: ($group.val() || '').trim() || null,
            imei: ($imei.val() || '').trim(),
            msisdn: ($msisdn.val() || '').trim() || null,
            carrier: ($carrier.val() || '').trim() || null,
            notes: ($notes.val() || '').trim() || null,

            apn: $apn.val()?.trim() || null,
            apn_user: $apnUser.val()?.trim() || null,
            apn_pass: $apnPass.val()?.trim() || null,
            server_type: $srvType.val(),
            server_host: $srvHost.val()?.trim() || null,
            server_port: +$srvPort.val() || null,
            tz: +$tz.val() || 0,

            j16_timer_on: +$j16TimerOn.val() || null,
            j16_timer_off: +$j16TimerOff.val() || null,
            j16_angle: +$j16Angle.val() || null,
            j16_acc_virtual: String($j16Acc.val()),
        };
    }

    function fillForm(d) {
        $name.val(d.name || '');
        $protocol.val(d.protocol || 'GENERIC');
        $group.val(d.device_group || '');
        $imei.val(d.imei || '');
        $msisdn.val(d.msisdn || '');
        $carrier.val(d.carrier || '');
        $notes.val(d.notes || '');

        $apn.val(d.apn || '');
        $apnUser.val(d.apn_user || '');
        $apnPass.val(d.apn_pass || '');
        $srvType.val(d.server_type || 'dns');
        $srvHost.val(d.server_host || '');
        $srvPort.val(d.server_port || 7002);
        $tz.val(Number.isFinite(+d.tz) ? d.tz : 0);

        $j16TimerOn.val(d.j16_timer_on || 60);
        $j16TimerOff.val(d.j16_timer_off || 3600);
        $j16Angle.val(d.j16_angle || 15);
        $j16Acc.val(d.j16_acc_virtual || '0');

        toggleJ16Fields();
        buildSmsPreview();
    }

    function clearForm() {
        editingId = null;
        $('#form-ident')[0].reset();
        $('#form-net')[0].reset();
        $carrier.val('');
        $group.val('');
        $srvType.val('dns');
        $srvPort.val('7002');
        $tz.val('0');
        $j16TimerOn.val('60');
        $j16TimerOff.val('3600');
        $j16Angle.val('15');
        $j16Acc.val('0');
        toggleJ16Fields();
        buildSmsPreview();
    }

    // ======= Tabela (DataTables) =======
    let dt = null;

    function buildActions(d) {
        return `
      <div class="btn-group btn-group-sm" role="group">
        <button class="btn btn-outline-primary" data-act="edit" data-id="${d.id}" title="Editar">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-outline-danger" data-act="del" data-id="${d.id}" title="Excluir">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `;
    }

    async function loadTable() {
        const rows = await api.listDevices();
        if (dt) {
            dt.clear().rows.add(rows).draw();
            return;
        }
        dt = $('#devices-table').DataTable({
            responsive: true,
            pageLength: 25,
            language: { url: 'https://cdn.datatables.net/plug-ins/1.13.4/i18n/pt-BR.json' },
            columns: [
                { data: 'name', render: (v) => esc(v || '—') },
                { data: 'imei', render: (v, _, row) => esc(v || row.id || '—') },
                { data: 'protocol', render: (v) => esc(v || '—') },
                { data: 'group', render: (v, _, row) => esc(row.device_group || v || '—') },
                { data: 'carrier', render: (v) => esc(v || '—') },
                { data: 'status', render: fmtStatus, orderable: false },
                { data: 'last_seen', render: (v) => fmtDateTime(v) },
                { data: null, render: (_, __, row) => buildActions(row), orderable: false },
            ],
            data: rows,
        });

        // Delegação de eventos dos botões
        $('#devices-table tbody').on('click', 'button[data-act]', async function () {
            const act = this.getAttribute('data-act');
            const id = +this.getAttribute('data-id');
            const data = dt.row($(this).closest('tr')).data();
            if (act === 'edit') {
                editingId = id;
                await fillGroups();
                fillForm(data || {});
                $modal.find('.modal-title').text('Editar dispositivo');
                $modal.modal('show');
            } else if (act === 'del') {
                if (!confirm(`Excluir "${data?.name || 'dispositivo'}"?`)) return;
                try {
                    await api.deleteDevice(id);
                    notify('success', 'Dispositivo excluído.');
                    await loadTable();
                } catch (e) {
                    notify('error', e.message || 'Falha ao excluir.');
                }
            }
        });
    }

    // ======= Eventos UI =======
    $protocol.on('change', () => {
        toggleJ16Fields();
        buildSmsPreview();
    });
    [$apn, $apnUser, $apnPass, $srvType, $srvHost, $srvPort, $tz, $j16TimerOn, $j16TimerOff, $j16Angle, $j16Acc].forEach(($el) =>
        $el.on('input change', buildSmsPreview)
    );

    $('#save-device').on('click', async () => {
        // valida IMEI simples (se informado)
        if ($imei.val() && !/^\d{15}$/.test($imei.val())) {
            notify('warning', 'IMEI deve ter 15 dígitos.');
            return;
        }
        const body = readForm();
        try {
            if (editingId) {
                await api.updateDevice(editingId, body);
                notify('success', 'Dispositivo atualizado.');
            } else {
                await api.createDevice(body);
                notify('success', 'Dispositivo criado.');
            }
            $modal.modal('hide');
            await loadTable();
        } catch (e) {
            notify('error', e.message || 'Falha ao salvar.');
        }
    });

    // “Novo Dispositivo”
    $modal.on('show.bs.modal', async (ev) => {
        if (!editingId) {
            await fillGroups();
            clearForm();
            $modal.find('.modal-title').text('Adicionar novo dispositivo');
        }
    });
    // Ao fechar, limpa o estado de edição
    $modal.on('hidden.bs.modal', () => {
        editingId = null;
        clearForm();
    });

    // Botão “Novo Dispositivo” também limpa
    document.querySelector('[data-bs-target="#addDeviceModal"]')?.addEventListener('click', () => {
        editingId = null;
        clearForm();
    });

    // Prepara fuso / grupos / inicializa tabela
    fillTimezones();
    toggleJ16Fields();
    buildSmsPreview();
    loadTable();
})();
