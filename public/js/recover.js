// js/recover.js

document.addEventListener('DOMContentLoaded', () => {
    // Elementos de passo
    const steps = {
        1: document.querySelector('.step-1'),
        2: document.querySelector('.step-2'),
        3: document.querySelector('.step-3'),
    };
    function showStep(n) {
        Object.values(steps).forEach(s => s.classList.remove('active'));
        steps[n].classList.add('active');
    }

    // Guarda o email validado no passo 1
    let storedEmail = '';

    // Helpers de loader
    function showLoader(btn, text) {
        btn.disabled = true;
        btn._origHTML = btn.innerHTML;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${text}`;
    }
    function hideLoader(btn) {
        btn.innerHTML = btn._origHTML;
        btn.disabled = false;
    }

    // Passo 1: email
    const emailInput = document.getElementById('recover-email');
    const emailError = document.getElementById('email-error');
    const btn1 = document.getElementById('btn-step1');
    btn1.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        emailInput.classList.remove('invalid');
        emailError.textContent = '';

        if (!email) {
            emailInput.classList.add('invalid');
            emailError.textContent = 'Digite um email válido.';
            return;
        }

        showLoader(btn1, 'Enviando…');
        try {
            const res = await fetch('/api/auth/check-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (data.exists) {
                storedEmail = email;
                showStep(2);
                codeInputs[0].focus();
            } else {
                emailInput.classList.add('invalid');
                emailError.textContent = 'Email não encontrado.';
            }
        } catch {
            emailError.textContent = 'Erro de rede. Tente mais tarde.';
        } finally {
            hideLoader(btn1);
        }
    });

    // Passo 2: código
    const codeInputs = Array.from(document.querySelectorAll('.code-input'));
    const codeError = document.getElementById('code-error');
    const btn2 = document.getElementById('btn-step2');
    let attempts = 3;

    codeInputs.forEach((input, idx) => {
        // Apenas dígitos e avanço automático
        input.addEventListener('input', () => {
            input.value = input.value.replace(/\D/g, '');
            if (input.value && idx < codeInputs.length - 1) {
                codeInputs[idx + 1].focus();
            }
            btn2.disabled = !codeInputs.every(i => i.value);
        });
        // Colar os 5 dígitos de uma vez
        input.addEventListener('paste', e => {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 5);
            pasted.split('').forEach((d, i) => {
                if (codeInputs[i]) codeInputs[i].value = d;
            });
            const last = Math.min(pasted.length - 1, 4);
            codeInputs[last]?.focus();
            btn2.disabled = !codeInputs.every(i => i.value);
        });
    });

    btn2.addEventListener('click', async () => {
        const code = codeInputs.map(i => i.value).join('');
        codeInputs.forEach(i => i.classList.remove('invalid'));
        codeError.textContent = '';

        showLoader(btn2, 'Verificando…');
        try {
            const res = await fetch('/api/auth/verify-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: storedEmail, code })
            });
            const { valid } = await res.json();
            if (valid) {
                showStep(3);
                document.getElementById('new-password').focus();
            } else {
                attempts--;
                codeInputs.forEach(i => i.classList.add('invalid'));
                codeError.textContent = `Código incorreto. Restam ${attempts} tentativas.`;
                if (attempts <= 0) {
                    notify('error', 'Limite de tentativas excedido. Reiniciando…');
                    setTimeout(() => window.location.reload(), 2000);
                }
            }
        } catch {
            codeError.textContent = 'Erro de rede. Tente mais tarde.';
        } finally {
            hideLoader(btn2);
        }
    });

    // Passo 3: nova senha
    const newPass = document.getElementById('new-password');
    const confirmPass = document.getElementById('confirm-password');
    const passwordError = document.getElementById('password-error');
    const btn3 = document.getElementById('btn-step3');

    function validatePasswords() {
        passwordError.textContent = '';
        newPass.classList.remove('invalid');
        confirmPass.classList.remove('invalid');
        if (newPass.value && confirmPass.value) {
            if (newPass.value !== confirmPass.value) {
                confirmPass.classList.add('invalid');
                passwordError.textContent = 'Senhas não conferem.';
                btn3.disabled = true;
            } else {
                btn3.disabled = false;
            }
        } else {
            btn3.disabled = true;
        }
    }
    newPass.addEventListener('input', validatePasswords);
    confirmPass.addEventListener('input', validatePasswords);

    btn3.addEventListener('click', async () => {
        showLoader(btn3, 'Atualizando…');
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: storedEmail, password: newPass.value })
            });
            if (res.ok) {
                notify('success', 'Senha atualizada com sucesso! Redirecionando…');
                setTimeout(() => window.location.href = 'index.html', 3000);
            } else {
                passwordError.textContent = 'Falha ao atualizar senha. Tente novamente.';
            }
        } catch {
            passwordError.textContent = 'Erro de rede. Tente mais tarde.';
        } finally {
            hideLoader(btn3);
        }
    });
});
