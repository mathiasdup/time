// =============================================
// Animations de bouclier (Protection)
// =============================================
// Déploiement et bris du bouclier Protection
// Utilise le nouveau système CSS héraldique flottant

// Set pour tracker les cartes dont l'animation de bouclier a été jouée
const shieldAnimationPlayed = new Set();

/**
 * Animation de déploiement du bouclier Protection
 */
async function animateShieldDeploy(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (!slot) return;

    const card = slot.querySelector('.card');
    if (!card) return;

    // Créer une clé unique basée sur l'uid de la carte (indépendant de la position)
    const cardUniqueId = card.dataset.cardUid || card.dataset.cardId || `${data.row}_${data.col}`;
    const shieldKey = `${owner}_${cardUniqueId}`;

    shieldAnimationPlayed.add(shieldKey);
    console.log('[animateShieldDeploy] Animation jouée pour:', shieldKey);

    // Supprimer l'ancien bouclier s'il existe
    const existingShield = card.querySelector('.shield-container');
    if (existingShield) existingShield.remove();

    // Utiliser le nouveau système CSS héraldique
    if (typeof addShieldToCard === 'function') {
        addShieldToCard(card, true); // true = avec animation
        await new Promise(r => setTimeout(r, 500));
    }
}

/**
 * Animation de bris du bouclier Protection
 */
async function animateShieldBreak(data) {
    const owner = data.player === myNum ? 'me' : 'opp';
    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (!slot) return;

    const card = slot.querySelector('.card');
    if (!card) return;

    console.log('[animateShieldBreak] appelé pour', owner, data.row, data.col);

    // Utiliser la même clé basée sur l'uid que animateShieldDeploy
    const cardUniqueId = card.dataset.cardUid || card.dataset.cardId || `${data.row}_${data.col}`;
    const shieldKey = `${owner}_${cardUniqueId}`;
    shieldAnimationPlayed.delete(shieldKey);

    // Utiliser le nouveau système CSS
    if (typeof ShieldEffect !== 'undefined') {
        const cardKey = `${owner}-${data.row}-${data.col}`;
        await ShieldEffect.breakShield(cardKey);
    } else {
        // Fallback direct
        const shield = card.querySelector('.shield-container');
        if (shield) {
            shield.classList.add('breaking');
            await new Promise(r => setTimeout(r, 500));
            shield.remove();
        }
    }
}
