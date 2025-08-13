// js/main.js

document.addEventListener('DOMContentLoaded', () => {
    //
    // === Fundo animado cross-fade ===
    //
    const backgrounds = [
        'assets/background-1.mp4',
        'assets/background-2.mp4',
        'assets/background-3.mp4'
    ];
    let current = 0;
    const videoA = document.getElementById('bg-video-a');
    const videoB = document.getElementById('bg-video-b');
    let showingA = true;

    videoA.src = backgrounds[0];
    videoB.src = backgrounds[1];
    videoA.play(); videoB.play();
    videoA.classList.add('active');

    function changeBackground() {
        current = (current + 1) % backgrounds.length;
        if (showingA) {
            videoB.src = backgrounds[current];
            videoB.load(); videoB.play();
            videoA.classList.remove('active');
            videoB.classList.add('active');
        } else {
            videoA.src = backgrounds[current];
            videoA.load(); videoA.play();
            videoB.classList.remove('active');
            videoA.classList.add('active');
        }
        showingA = !showingA;
    }

    setInterval(changeBackground, 10000);

    //
    // === Helpers de loader ===
    //
    function showLoader(btn, text) {
        btn.disabled = true;
        btn._origHTML = btn.innerHTML;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${text}`;
    }
    function hideLoader(btn) {
        btn.innerHTML = btn._origHTML;
        btn.disabled = false;
    }

    //
    // === Handler de login ===
    //
    const form = document.getElementById('loginForm');
    const btn = document.getElementById('btn-login');

    function showLoader(btn, text) {
        btn.disabled = true;
        btn._origHTML = btn.innerHTML;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> ${text}`;
    }
    function hideLoader(btn) {
        btn.innerHTML = btn._origHTML;
        btn.disabled = false;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = e.target.email.value.trim();
        const password = e.target.senha.value;

        showLoader(btn, 'Entrando…');
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            if (!res.ok) {
                notify('error', 'Credenciais inválidas. Tente novamente.');
                return hideLoader(btn);
            }

            // Espera { token }
            const { token } = await res.json();
            if (!token) {
                notify('error', 'Falha ao autenticar. Tente novamente.');
                return hideLoader(btn);
            }

            // Salva o token
            localStorage.setItem('token', token);

            notify('success', 'Login realizado! Redirecionando…');
            setTimeout(() => {
                window.location.href = '/dashboard/objects.html';
            }, 800);
        } catch (err) {
            notify('error', 'Erro de rede. Tente novamente.');
            hideLoader(btn);
        }
    });
});
