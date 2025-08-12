// js/clients-modal.js
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');

    // ====== Senha automática vs manual
    const autoRd = document.getElementById('autoPass');
    const manRd = document.getElementById('manualPass');
    const passWrap = document.getElementById('manual-password-wrap');
    const passInp = document.getElementById('inp-password');
    const btnToggle = document.getElementById('btn-toggle-pass');
    const btnGen = document.getElementById('btn-gen-pass');

    function setMode() {
        passWrap.style.display = manRd.checked ? 'block' : 'none';
        if (autoRd.checked) passInp.value = '';
    }
    autoRd.addEventListener('change', setMode);
    manRd.addEventListener('change', setMode);
    setMode();

    btnToggle.addEventListener('click', () => {
        if (!passInp.value) return;
        passInp.type = passInp.type === 'text' ? 'password' : 'text';
        btnToggle.innerHTML = passInp.type === 'text'
            ? '<i class="bi bi-eye-slash"></i>'
            : '<i class="bi bi-eye"></i>';
    });

    function genPass(len = 10) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
        let s = '';
        for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }
    btnGen.addEventListener('click', () => {
        passInp.value = genPass();
        passInp.type = 'text';
        btnToggle.innerHTML = '<i class="bi bi-eye-slash"></i>';
    });

    // ====== Permissões (apenas a grade)
    const perms = [
        'Veículos', 'Alertas', 'Cercas Virtuais', 'Rotas', 'Pontos de Interesse',
        'Relatórios', 'Motoristas', 'Eventos personalizados', 'Modelos GPRS do usuário',
        'Modelos de SMS do usuário', 'Gateway de SMS', 'Enviar comando', 'Histórico',
        'Manutenção', 'Câmera / mídia', 'Câmera do dispositivo', 'Tarefas',
        'Bate-papo', 'Partilha', 'Ativação do dispositivo GPS'
    ];
    const permBody = document.getElementById('perm-list');
    perms.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td>${p}</td>
      <td class="text-center"><input type="checkbox" data-perm="${p}" data-kind="view"></td>
      <td class="text-center"><input type="checkbox" data-perm="${p}" data-kind="edit"></td>
      <td class="text-center"><input type="checkbox" data-perm="${p}" data-kind="delete"></td>`;
        permBody.appendChild(tr);
    });

    // ====== Associação por Dispositivo
    let allDevices = [];
    const devList = document.getElementById('dev-list');
    const searchDev = document.getElementById('search-dev');

    function renderDevices(filter) {
        devList.innerHTML = '';
        allDevices
            .filter(d => d.name.toLowerCase().includes(filter))
            .forEach(d => {
                const col = document.createElement('div');
                col.className = 'col-6 col-md-4 col-lg-3';
                col.innerHTML = `
          <div class="form-check">
            <input class="form-check-input dev-chk" type="checkbox" id="dev-${d.id}" value="${d.id}">
            <label class="form-check-label" for="dev-${d.id}">${d.name}</label>
          </div>`;
                devList.appendChild(col);
            });
    }

    fetch('/api/objects', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(list => { allDevices = list || []; renderDevices(''); })
        .catch(() => { allDevices = []; renderDevices(''); });

    document.getElementById('sel-all-dev').addEventListener('click', () => {
        document.querySelectorAll('.dev-chk').forEach(chk => chk.checked = true);
    });
    document.getElementById('desel-all-dev').addEventListener('click', () => {
        document.querySelectorAll('.dev-chk').forEach(chk => chk.checked = false);
    });
    searchDev.addEventListener('input', e => {
        renderDevices(e.target.value.trim().toLowerCase());
    });

    // ====== Associação por Grupo
    let allGroups = [];
    const gpList = document.getElementById('gp-list');
    const searchGp = document.getElementById('search-gp');

    function renderGroups(filter) {
        gpList.innerHTML = '';
        allGroups
            .filter(g => g.name.toLowerCase().includes(filter))
            .forEach(g => {
                const col = document.createElement('div');
                col.className = 'col-12 col-md-6 col-lg-4';
                col.innerHTML = `
          <div class="form-check">
            <input class="form-check-input gp-chk" type="checkbox" id="gp-${g.id}" value="${g.id}">
            <label class="form-check-label" for="gp-${g.id}">
              ${g.name} <span class="text-muted">(${g.count ?? 0})</span>
            </label>
          </div>`;
                gpList.appendChild(col);
            });
    }

    fetch('/api/device-groups', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(list => {
            allGroups = (list && list.length) ? list : [{ id: 0, name: 'Desagrupado', count: 0 }];
            renderGroups('');
        })
        .catch(() => {
            allGroups = [{ id: 0, name: 'Desagrupado', count: 0 }];
            renderGroups('');
        });

    document.getElementById('sel-all-gp').addEventListener('click', () => {
        document.querySelectorAll('.gp-chk').forEach(chk => chk.checked = true);
    });
    document.getElementById('desel-all-gp').addEventListener('click', () => {
        document.querySelectorAll('.gp-chk').forEach(chk => chk.checked = false);
    });
    searchGp.addEventListener('input', e => {
        renderGroups(e.target.value.trim().toLowerCase());
    });

    // ====== Salvar Usuário
    document.getElementById('save-client').addEventListener('click', async () => {
        // principal
        const name = document.getElementById('inp-name').value.trim();
        const email = document.getElementById('inp-email').value.trim();
        const phone = document.getElementById('inp-phone').value.trim();
        const role = document.getElementById('inp-role').value;
        const active = document.getElementById('inp-active').value === '1';
        const vehicleLimit = +document.getElementById('inp-vehicle-limit').value || 0;
        const expireDate = document.getElementById('inp-expire-date').value || null;
        const maps = Array.from(document.getElementById('inp-maps').selectedOptions).map(o => o.value);
        const doc = document.getElementById('inp-doc').value.trim();
        const company = document.getElementById('inp-company').value.trim();
        const notes = document.getElementById('inp-notes').value.trim();
        const sendEmail = document.getElementById('inp-send-email').value === '1';

        // senha
        let password = '';
        if (document.getElementById('manualPass').checked) {
            password = passInp.value.trim();
            if (!password) return notify('warning', 'Informe a senha manual ou mude para automática.');
        } else {
            password = genPass();
        }

        if (!name || !email) {
            return notify('warning', 'Nome e Email são obrigatórios.');
        }

        // permissões
        const permsPayload = {};
        perms.forEach(p => {
            const view = document.querySelector(`[data-perm="${p}"][data-kind="view"]`).checked;
            const edit = document.querySelector(`[data-perm="${p}"][data-kind="edit"]`).checked;
            const del = document.querySelector(`[data-perm="${p}"][data-kind="delete"]`).checked;
            permsPayload[p] = { view, edit, delete: del };
        });

        // coletar vínculos
        const deviceIds = Array.from(document.querySelectorAll('.dev-chk:checked')).map(chk => +chk.value);
        const groupIds = Array.from(document.querySelectorAll('.gp-chk:checked')).map(chk => +chk.value);

        const payload = {
            name, email, phone, role, active,
            vehicle_limit: vehicleLimit,
            expire_date: expireDate,
            maps,
            document: doc,
            company,
            notes,
            send_email: sendEmail,
            password,
            permissions: permsPayload,
            device_ids: deviceIds,
            group_ids: groupIds
        };

        // envia para API
        const btn = document.getElementById('save-client');
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Salvando...`;

        try {
            const res = await fetch('/api/clients', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: 'Bearer ' + token } : {})
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error();

            notify('success', 'Usuário criado e vínculos salvos!');
            const modalEl = document.getElementById('addClientModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();

            setTimeout(() => window.location.reload(), 1200);
        } catch (e) {
            notify('error', 'Falha ao salvar usuário.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = orig;
        }
    });
});
