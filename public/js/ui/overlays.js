// =============================================
// Interface: Overlays et Popups
// =============================================
// Gestion du cimetière, zoom de carte, log, settings

// ==================== CIMETIÈRE ====================

/**
 * Ouvre le popup du cimetière
 * @param {string} owner - 'me' ou 'opp'
 */
function openGraveyard(owner) {
    const popup = document.getElementById('graveyard-popup');
    const title = document.getElementById('graveyard-popup-title');
    const container = document.getElementById('graveyard-cards');

    const graveyard = owner === 'me' ? state.me.graveyard : state.opponent.graveyard;
    const playerName = owner === 'me' ? state.me.heroName : state.opponent.heroName;

    title.textContent = `Cimetière de ${playerName}`;
    container.innerHTML = '';

    if (!graveyard || graveyard.length === 0) {
        container.innerHTML = '<div class="graveyard-empty">Aucune carte au cimetière</div>';
    } else {
        graveyard.forEach(card => {
            const cardEl = makeCard(card, true);
            cardEl.onmouseenter = (e) => showCardPreview(card, e);
            cardEl.onmouseleave = hideCardPreview;
            cardEl.onclick = (e) => {
                e.stopPropagation();
                showCardZoom(card);
            };
            container.appendChild(cardEl);
        });
    }

    popup.classList.add('active');
}

/**
 * Ferme le popup du cimetière
 */
function closeGraveyard() {
    document.getElementById('graveyard-popup').classList.remove('active');
}

// ==================== ZOOM CARTE ====================

/**
 * Affiche une carte en grand
 * @param {Object} card - Données de la carte
 */
function showCardZoom(card) {
    const overlay = document.getElementById('card-zoom-overlay');
    const container = document.getElementById('card-zoom-container');

    container.innerHTML = '';
    const cardEl = makeCard(card, true);
    container.appendChild(cardEl);

    zoomCardData = card;
    overlay.classList.remove('hidden');
}

/**
 * Cache le zoom de carte
 */
function hideCardZoom() {
    const overlay = document.getElementById('card-zoom-overlay');
    overlay.classList.add('hidden');
    zoomCardData = null;
}

// ==================== LOG ====================

/**
 * Toggle l'affichage du journal de bataille
 */
function toggleLog() {
    document.getElementById('log-popup').classList.toggle('active');
}

/**
 * Ajoute un message au log
 * @param {string} msg - Message
 * @param {string} type - Type (action, phase, damage, heal, etc.)
 */
function log(msg, type = 'action') {
    const el = document.createElement('div');
    el.className = `log-entry log-${type}`;
    el.textContent = msg;
    const c = document.getElementById('log-content');
    c.appendChild(el);
    c.scrollTop = c.scrollHeight;
}

// ==================== SETTINGS ====================

/**
 * Toggle l'affichage des paramètres
 */
function toggleSettings() {
    document.getElementById('settings-popup').classList.toggle('active');
}

/**
 * Change le volume de la musique
 * @param {number} val - Volume (0-100)
 */
function setMusicVolume(val) {
    // TODO: Connecter à un système audio
    console.log('Music volume:', val);
}

/**
 * Change le volume des effets sonores
 * @param {number} val - Volume (0-100)
 */
function setSfxVolume(val) {
    // TODO: Connecter à un système audio
    console.log('SFX volume:', val);
}

/**
 * Abandon de la partie
 */
function surrender() {
    socket.emit('surrender');
}

// ==================== EVENT LISTENERS ====================

// Fermer le popup cimetière en cliquant ailleurs
document.addEventListener('click', (e) => {
    const popup = document.getElementById('graveyard-popup');
    if (popup.classList.contains('active')) {
        if (!popup.contains(e.target) && !e.target.closest('.grave-box')) {
            closeGraveyard();
        }
    }
});

// Fermer le zoom en cliquant sur l'overlay
document.addEventListener('DOMContentLoaded', () => {
    const zoomOverlay = document.getElementById('card-zoom-overlay');
    if (zoomOverlay) {
        zoomOverlay.addEventListener('click', hideCardZoom);
    }
});
