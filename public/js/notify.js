// js/notify.js

/**
 * Mostra uma notificação no topo da tela.
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {string} message
 * @param {number} [durationMs=3000] — tempo em milissegundos antes de sumir
 */
function notify(type, message, durationMs = 3000) {
    const icons = {
        success: 'bi-check-circle-fill',
        error: 'bi-x-circle-fill',
        info: 'bi-info-circle-fill',
        warning: 'bi-exclamation-triangle-fill'
    };

    const container = document.getElementById('notification-container');
    if (!container) return;

    const notif = document.createElement('div');
    notif.className = `notification notification-${type}`;
    notif.innerHTML = `
    <i class="icon bi ${icons[type]}"></i>
    <div class="message">${message}</div>
  `;

    container.appendChild(notif);

    // força reflow para animar
    requestAnimationFrame(() => notif.classList.add('show'));

    // some após duração
    setTimeout(() => {
        notif.classList.remove('show');
        notif.addEventListener('transitionend', () => notif.remove());
    }, durationMs);
}
