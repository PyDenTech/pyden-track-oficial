// js/dashboard.js

document.addEventListener('DOMContentLoaded', () => {
    // 0) Verifica token e redireciona se não estiver logado
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/'; // volta para login
        return;
    }

    // 1) Destaca o link ativo na navbar
    const currentPath = window.location.pathname.replace(/\/$/, '');
    document.querySelectorAll('.navbar-nav .nav-link').forEach(link => {
        link.classList.remove('active');
        const href = link.getAttribute('href')?.replace(/\/$/, '') || '';
        if (href === currentPath) {
            link.classList.add('active');
        }
    });

    // 2) Busca e exibe o nome completo e cargo do usuário logado
    const userSpan = document.getElementById('user-info');
    if (userSpan) {
        fetch('/api/auth/me', {
            headers: { 'Authorization': 'Bearer ' + token }
        })
            .then(res => {
                if (!res.ok) throw new Error('Não autenticado');
                return res.json();
            })
            .then(user => {
                const name = user.name || 'Usuário';
                const role = user.role ? ` (${user.role})` : '';
                userSpan.textContent = name + role;
            })
            .catch(() => {
                // se token inválido, força logout
                localStorage.removeItem('token');
                window.location.href = '/';
            });
    }
});
