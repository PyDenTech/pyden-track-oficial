// js/devices.js
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');

    // Preenche nome/cargo no topo (dashboard.js já faz, mas garantimos fallback rápido)
    fetch('/api/auth/me', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(u => {
            const span = document.getElementById('user-info');
            if (span) span.textContent = `${u.name || 'Usuário'}${u.role ? ' (' + u.role + ')' : ''}`;
        })
        .catch(() => { });

    // DataTable
    const table = $('#devices-table').DataTable({
        language: { url: 'https://cdn.datatables.net/plug-ins/1.13.4/i18n/pt-BR.json' },
        columns: [
            { data: 'name' },
            { data: 'plate', defaultContent: '' },
            {
                data: 'imei',
                render: d => `<span class="font-mono">${d || ''}</span>`
            },
            { data: 'protocol', defaultContent: '' },
            { data: 'group_name', defaultContent: 'Desagrupado' },
            { data: 'owner_name', defaultContent: '' },
            {
                data: 'active',
                render: v => v ? '<span class="badge bg-success">Ativo</span>'
                    : '<span class="badge bg-secondary">Inativo</span>'
            },
            {
                data: 'updated_at',
                render: dt => dt ? new Date(dt).toLocaleString('pt-BR') : '—'
            },
            {
                data: null, orderable: false,
                render: row => `
          <button class="btn btn-sm btn-primary me-1" data-id="${row.id}" data-action="edit">
            <i class="bi bi-pencil-fill"></i>
          </button>
          <button class="btn btn-sm btn-danger" data-id="${row.id}" data-action="delete">
            <i class="bi bi-trash-fill"></i>
          </button>`
            }
        ],
        responsive: true
    });

    // Move length+filter para a esquerda (toolbar)
    const wrap = $('#devices-table').closest('.dataTables_wrapper');
    $('#dt-left').append(wrap.find('.dataTables_length')).append(wrap.find('.dataTables_filter'));

    // Carrega lista de dispositivos
    function loadDevices() {
        fetch('/api/objects', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(list => {
                table.clear().rows.add(list || []).draw();
            })
            .catch(() => notify('error', 'Falha ao carregar dispositivos.'));
    }
    loadDevices();

    // Carrega grupos no modal
    function loadGroups() {
        const sel = document.getElementById('dev-group');
        sel.innerHTML = '<option value="0">Desagrupado</option>';
        fetch('/api/device-groups', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(groups => {
                (groups || []).forEach(g => {
                    const opt = document.createElement('option');
                    opt.value = g.id; opt.textContent = g.name;
                    sel.appendChild(opt);
                });
            })
            .catch(() => {/* fica só Desagrupado */ });
    }

    // Carrega clientes no modal
    function loadOwners() {
        const sel = document.getElementById('dev-owner');
        sel.innerHTML = '<option value="">—</option>';
        fetch('/api/clients', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(clients => {
                (clients || []).forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id; opt.textContent = c.name;
                    sel.appendChild(opt);
                });
            })
            .catch(() => {/* sem dono */ });
    }

    // Abrir modal novo
    const deviceModalEl = document.getElementById('deviceModal');
    deviceModalEl.addEventListener('show.bs.modal', e => {
        // título padrão
        document.getElementById('deviceModalLabel').textContent = 'Adicionar dispositivo';
        deviceModalEl.dataset.editing = ''; // reset

        // limpa campos
        document.getElementById('device-form').reset();
        document.getElementById('dev-active').value = '1';

        loadGroups();
        loadOwners();
    });

    // Salvar dispositivo (criar/editar) – precisa de endpoint no backend
    document.getElementById('save-device').addEventListener('click', async () => {
        const payload = {
            name: document.getElementById('dev-name').value.trim(),
            plate: document.getElementById('dev-plate').value.trim(),
            imei: document.getElementById('dev-imei').value.trim(),
            active: document.getElementById('dev-active').value === '1',
            protocol: document.getElementById('dev-protocol').value,
            model: document.getElementById('dev-model').value.trim(),
            group_id: +document.getElementById('dev-group').value || 0,
            owner_id: document.getElementById('dev-owner').value || null,
            sim_number: document.getElementById('dev-sim').value.trim(),
            carrier: document.getElementById('dev-carrier').value,
            apn: document.getElementById('dev-apn').value.trim(),
            installed_at: document.getElementById('dev-installed-at').value || null,
            sim_activated_at: document.getElementById('dev-sim-activated-at').value || null,
            sim_expire_at: document.getElementById('dev-sim-expire-at').value || null,
            expire_at: document.getElementById('dev-expire-at').value || null,
            notes: document.getElementById('dev-notes').value.trim(),
            bearing: document.getElementById('dev-bearing').value ? +document.getElementById('dev-bearing').value : null,
            overspeed: document.getElementById('dev-overspeed').value ? +document.getElementById('dev-overspeed').value : null,
            odo_start: document.getElementById('dev-odo').value ? +document.getElementById('dev-odo').value : null,
            ign_inverted: document.getElementById('dev-ign-inverted').value === '1'
        };

        if (!payload.name || !payload.imei) {
            return notify('warning', 'Nome e IMEI são obrigatórios.');
        }

        const btn = document.getElementById('save-device');
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Salvando...`;

        try {
            // se tiver modo edição, PUT; caso contrário, POST
            const isEditing = !!deviceModalEl.dataset.editing;
            const url = isEditing ? `/api/objects/${deviceModalEl.dataset.editing}` : '/api/objects';
            const method = isEditing ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: 'Bearer ' + token } : {})
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error();
            notify('success', isEditing ? 'Dispositivo atualizado.' : 'Dispositivo criado.');
            bootstrap.Modal.getInstance(deviceModalEl).hide();
            loadDevices();
        } catch {
            notify('error', 'Endpoint de salvar dispositivo não está disponível.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = orig;
        }
    });

    // Ações Editar/Excluir na tabela
    $('#devices-table').on('click', 'button[data-action]', function () {
        const id = this.getAttribute('data-id');
        const action = this.getAttribute('data-action');
        const rowData = table.row($(this).parents('tr')).data();

        if (action === 'edit') {
            // Preenche modal com dados do dispositivo
            document.getElementById('deviceModalLabel').textContent = 'Editar dispositivo';
            deviceModalEl.dataset.editing = id;

            document.getElementById('dev-name').value = rowData.name || '';
            document.getElementById('dev-plate').value = rowData.plate || '';
            document.getElementById('dev-imei').value = rowData.imei || '';
            document.getElementById('dev-active').value = rowData.active ? '1' : '0';
            document.getElementById('dev-protocol').value = rowData.protocol || '';
            document.getElementById('dev-model').value = rowData.model || '';
            document.getElementById('dev-sim').value = rowData.sim_number || '';
            document.getElementById('dev-carrier').value = rowData.carrier || '';
            document.getElementById('dev-apn').value = rowData.apn || '';
            document.getElementById('dev-installed-at').value = rowData.installed_at?.slice(0, 10) || '';
            document.getElementById('dev-sim-activated-at').value = rowData.sim_activated_at?.slice(0, 10) || '';
            document.getElementById('dev-sim-expire-at').value = rowData.sim_expire_at?.slice(0, 10) || '';
            document.getElementById('dev-expire-at').value = rowData.expire_at?.slice(0, 10) || '';
            document.getElementById('dev-notes').value = rowData.notes || '';
            document.getElementById('dev-bearing').value = rowData.bearing ?? '';
            document.getElementById('dev-overspeed').value = rowData.overspeed ?? '';
            document.getElementById('dev-odo').value = rowData.odo_start ?? '';
            document.getElementById('dev-ign-inverted').value = rowData.ign_inverted ? '1' : '0';

            // carregar grupos e clientes antes de setar seleção
            Promise.all([loadGroups(), loadOwners()]).finally(() => {
                setTimeout(() => {
                    if (rowData.group_id != null) document.getElementById('dev-group').value = String(rowData.group_id);
                    if (rowData.owner_id != null) document.getElementById('dev-owner').value = String(rowData.owner_id);
                }, 150);
            });

            const modal = new bootstrap.Modal(deviceModalEl);
            modal.show();
        }

        if (action === 'delete') {
            if (!confirm('Deseja realmente excluir este dispositivo?')) return;
            fetch(`/api/objects/${id}`, {
                method: 'DELETE',
                headers: token ? { Authorization: 'Bearer ' + token } : {}
            })
                .then(r => {
                    if (!r.ok) throw new Error();
                    notify('success', 'Dispositivo excluído.');
                    loadDevices();
                })
                .catch(() => notify('error', 'Endpoint de exclusão não está disponível.'));
        }
    });

    // (Opcional) Gerenciar grupos – placeholder
    document.getElementById('btn-manage-groups').addEventListener('click', () => {
        notify('info', 'Tela de grupos ainda não implementada.');
    });
});
