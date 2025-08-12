// js/clients.js
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');

    // 1) Nome + cargo no topo
    fetch('/api/auth/me', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(user => {
            const span = document.getElementById('user-info');
            span.textContent = user?.name && user?.role ? `${user.name} (${user.role})` : 'Usuário';
        })
        .catch(() => {
            const span = document.getElementById('user-info');
            if (span) span.textContent = 'Usuário';
        });

    // 2) DataTable básico
    const table = $('#clients-table').DataTable({
        language: { url: 'https://cdn.datatables.net/plug-ins/1.13.4/i18n/pt-BR.json' },
        columns: [
            { data: 'name' },
            { data: 'email' },
            { data: 'phone' },
            {
                data: 'created_at',
                render: dt => dt ? new Date(dt).toLocaleString('pt-BR') : '-'
            },
            {
                data: null,
                orderable: false,
                render: row => `
          <button class="btn btn-sm btn-primary me-1" onclick="editClient(${row.id})" title="Editar">
            <i class="bi bi-pencil-fill"></i>
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteClient(${row.id})" title="Excluir">
            <i class="bi bi-trash-fill"></i>
          </button>`
            }
        ],
        responsive: true
    });

    // 3) Mover "Exibir" e "Pesquisar" para a barra custom (#dt-left)
    const dtWrapper = $('#clients-table').closest('.dataTables_wrapper');
    const lengthNode = dtWrapper.find('.dataTables_length');
    const filterNode = dtWrapper.find('.dataTables_filter');
    $('#dt-left').append(lengthNode).append(filterNode);

    // 4) Carregar dados
    fetch('/api/clients', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => table.rows.add(data).draw())
        .catch(() => notify('error', 'Falha ao carregar clientes.'));

    // 5) Ações
    window.editClient = id => {
        window.location.href = `/dashboard/users/clients/edit.html?id=${id}`;
    };

    window.deleteClient = id => {
        if (!confirm('Deseja realmente excluir este cliente?')) return;
        fetch(`/api/clients/${id}`, {
            method: 'DELETE',
            headers: token ? { Authorization: 'Bearer ' + token } : {}
        })
            .then(res => {
                if (!res.ok) throw new Error();
                notify('success', 'Cliente excluído.');
                // remove linha correspondente
                const btn = document.querySelector(`[onclick="deleteClient(${id})"]`);
                if (btn) table.row($(btn).closest('tr')).remove().draw();
            })
            .catch(() => notify('error', 'Falha ao excluir cliente.'));
    };

    // 6) Logout
    const logout = document.getElementById('btn-logout');
    if (logout) {
        logout.addEventListener('click', () => {
            localStorage.removeItem('token');
            window.location.href = '/';
        });
    }
});
