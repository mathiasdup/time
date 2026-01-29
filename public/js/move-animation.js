// =============================================
// Animation de déplacement des cartes
// =============================================
// Ce fichier contient la logique d'animation pour les déplacements
// des créatures sur le terrain (mouvements ligne avant/arrière)

/**
 * Anime le déplacement d'une carte d'un slot à un autre
 * N'anime que les déplacements de l'adversaire (nos cartes sont déjà à leur nouvelle position)
 */
async function animateMove(data) {
    console.log(`[animateMove] Called: player=${data.player}, myNum=${window.myNum}, card=${data.card?.name}`);

    // N'animer que les déplacements de l'adversaire
    if (data.player === window.myNum) {
        console.log(`[animateMove] SKIPPING - our own move`);
        return;
    }

    const owner = 'opp';
    const fromKey = `${owner}-${data.fromRow}-${data.fromCol}`;
    const toKey = `${owner}-${data.toRow}-${data.toCol}`;

    const fromSlot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.fromRow}"][data-col="${data.fromCol}"]`);
    const toSlot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.toRow}"][data-col="${data.toCol}"]`);

    if (!fromSlot || !toSlot) return;

    // IMPORTANT: Bloquer les slots AVANT l'animation pour éviter que renderField ne les touche
    if (typeof blockSlot === 'function') {
        blockSlot(fromKey);
        blockSlot(toKey);
    } else if (typeof animatingSlots !== 'undefined') {
        animatingSlots.add(fromKey);
        animatingSlots.add(toKey);
    }

    console.log(`[animateMove] Animation ${data.card.name}: row ${data.fromRow} -> row ${data.toRow}`);

    // Récupérer la carte source existante
    let cardEl = fromSlot.querySelector('.card');
    const existingToCard = toSlot.querySelector('.card');

    // Sauvegarder l'état de bordure avant toute modification
    // Une carte qui se déplace garde son état (généralement can-attack)
    const hadCanAttack = cardEl?.classList.contains('can-attack') || data.card.canAttack;

    // Sauvegarder le temps d'animation de vol si la carte volait
    const existingFlyingTime = cardEl?.dataset.flyingStartTime
        ? performance.now() - parseFloat(cardEl.dataset.flyingStartTime)
        : 0;

    // Si pas de carte source, en créer une
    if (!cardEl) {
        console.log(`[animateMove] Carte source absente, création`);
        cardEl = makeCard(data.card, false);

        // IMPORTANT: Une carte qui se déplace n'est PAS "just-played"
        // Forcer le retrait de la classe même si makeCard l'a ajoutée
        cardEl.classList.remove('just-played');
        if (hadCanAttack) {
            cardEl.classList.add('can-attack');
        }

        // Ajouter le bouclier si nécessaire
        if (data.card.hasProtection && typeof addShieldToCard === 'function') {
            addShieldToCard(cardEl, false);
        }

        fromSlot.appendChild(cardEl);
        fromSlot.classList.add('has-card');
    }

    // S'assurer que la carte garde la bonne bordure pendant toute l'animation
    // Important: retirer just-played et ajouter can-attack pour éviter les Zzz
    cardEl.classList.remove('just-played');
    if (hadCanAttack) {
        cardEl.classList.add('can-attack');
    }

    // Cacher la carte destination si elle existe
    if (existingToCard) {
        existingToCard.style.visibility = 'hidden';
    }

    // Mesurer les positions
    const fromRect = cardEl.getBoundingClientRect();
    const toRect = toSlot.getBoundingClientRect();

    // Passer la carte en position fixed pour l'animation
    cardEl.style.position = 'fixed';
    cardEl.style.left = fromRect.left + 'px';
    cardEl.style.top = fromRect.top + 'px';
    cardEl.style.width = fromRect.width + 'px';
    cardEl.style.height = fromRect.height + 'px';
    cardEl.style.zIndex = '3000';
    cardEl.style.margin = '0';
    cardEl.classList.add('card-moving');

    // Déplacer dans le body pour l'animation
    document.body.appendChild(cardEl);
    fromSlot.classList.remove('has-card');

    // Forcer le rendu
    void cardEl.offsetHeight;

    // Animer vers la destination
    cardEl.style.transition = 'left 0.5s ease-in-out, top 0.5s ease-in-out';
    cardEl.style.left = toRect.left + 'px';
    cardEl.style.top = toRect.top + 'px';

    // Attendre la fin de l'animation
    await new Promise(resolve => setTimeout(resolve, 500));

    // Nettoyer le slot destination
    const labelTo = toSlot.querySelector('.slot-label');
    toSlot.innerHTML = '';
    if (labelTo) toSlot.appendChild(labelTo.cloneNode(true));

    // Réinitialiser les styles de la carte
    cardEl.style.position = '';
    cardEl.style.left = '';
    cardEl.style.top = '';
    cardEl.style.width = '';
    cardEl.style.height = '';
    cardEl.style.zIndex = '';
    cardEl.style.margin = '';
    cardEl.style.transition = '';
    cardEl.classList.remove('card-moving');

    // Remettre la carte dans le slot destination
    toSlot.appendChild(cardEl);
    toSlot.classList.add('has-card');

    // Nettoyer le slot source
    const labelFrom = fromSlot.querySelector('.slot-label');
    fromSlot.innerHTML = '';
    if (labelFrom) fromSlot.appendChild(labelFrom.cloneNode(true));
    fromSlot.classList.remove('has-card');

    // Gérer les volants (préserver le temps d'animation)
    if (data.card.type === 'creature' && data.card.abilities?.includes('fly')) {
        cardEl.classList.add('flying-creature');
        toSlot.classList.add('has-flying');
        if (typeof startFlyingAnimation === 'function') {
            startFlyingAnimation(cardEl, existingFlyingTime);
        }
    }

    // S'assurer que la carte garde sa bordure can-attack après le déplacement
    // Réappliquer l'état sauvegardé au début de l'animation
    cardEl.classList.remove('just-played');
    if (hadCanAttack) {
        cardEl.classList.add('can-attack');
    }

    // NE PAS débloquer manuellement - le serveur envoie unblockSlots
    // après que tous les clients aient confirmé les animations.
    // Débloquer ici causerait un flash car un render avec l'ancien état
    // pourrait s'exécuter avant que le nouvel état n'arrive.

    console.log(`[animateMove] Fin ${data.card.name} (slots restent bloqués jusqu'à unblockSlots serveur)`);
}

// Exposer globalement
window.animateMove = animateMove;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { animateMove };
}
