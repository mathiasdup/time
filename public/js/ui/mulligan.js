// =============================================
// Interface: Mulligan
// =============================================
// Gestion de l'écran de mulligan au début de partie

/**
 * Affiche l'écran de mulligan avec la main de départ
 */
function showMulligan() {
    const overlay = document.getElementById('mulligan-overlay');
    const handContainer = document.getElementById('mulligan-hand');

    overlay.classList.remove('hidden');
    handContainer.innerHTML = '';

    // Afficher les cartes de la main
    state.me.hand.forEach(card => {
        const cardEl = makeCard(card, true);
        handContainer.appendChild(cardEl);
    });

    // Démarrer le timer de 15 secondes
    startMulliganTimer();
}

/**
 * Démarre le timer de 15 secondes pour le mulligan
 */
function startMulliganTimer() {
    let timeLeft = 15;
    const timerEl = document.getElementById('mulligan-timer');
    timerEl.textContent = timeLeft;
    timerEl.classList.add('visible');

    mulliganTimer = setInterval(() => {
        timeLeft--;
        timerEl.textContent = timeLeft;
        timerEl.classList.toggle('urgent', timeLeft <= 5);

        if (timeLeft <= 0) {
            clearInterval(mulliganTimer);
            // Auto-keep si le temps est écoulé
            if (!mulliganDone) {
                keepHand();
            }
        }
    }, 1000);
}

/**
 * Démarre la partie après le mulligan
 */
function startGame() {
    // Arrêter le timer mulligan si actif
    if (mulliganTimer) {
        clearInterval(mulliganTimer);
        mulliganTimer = null;
    }

    document.getElementById('mulligan-overlay').classList.add('hidden');
    document.getElementById('game-container').classList.add('active');
    buildBattlefield();
    render();
    log('🎮 Tour 1 - Partie lancée !', 'phase');
}

/**
 * Vérifie si le joueur a des créatures sur le terrain
 * @returns {boolean}
 */
function hasCreaturesOnMyField() {
    if (!state || !state.me || !state.me.field) return false;
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            if (state.me.field[r][c]) return true;
        }
    }
    return false;
}

/**
 * Garde la main actuelle
 */
function keepHand() {
    if (mulliganDone) return;
    mulliganDone = true;

    document.getElementById('mulligan-buttons').classList.add('hidden');
    document.getElementById('mulligan-waiting').classList.remove('hidden');
    document.getElementById('mulligan-timer').classList.remove('visible');

    socket.emit('keepHand');
}

/**
 * Demande un mulligan (nouvelle main)
 */
function doMulligan() {
    if (mulliganDone) return;
    mulliganDone = true;

    document.getElementById('mulligan-buttons').classList.add('hidden');
    document.getElementById('mulligan-waiting').classList.remove('hidden');
    document.getElementById('mulligan-timer').classList.remove('visible');

    socket.emit('mulligan');
}
