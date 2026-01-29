// =============================================
// Animation d'invocation/arrivée des créatures
// =============================================

const flyingAnimationSpeed = 0.002;
const flyingAnimationAmplitude = 4;

/**
 * Démarre l'animation de vol pour une carte
 * @param {HTMLElement} cardEl - L'élément carte
 * @param {number} timeOffset - Offset de temps pour reprendre l'animation au même point (optionnel)
 */
function startFlyingAnimation(cardEl, timeOffset = 0) {
    cardEl.dataset.flyingAnimation = 'true';
    // Stocker le moment de démarrage pour pouvoir calculer la phase
    const startTime = performance.now() - timeOffset;
    cardEl.dataset.flyingStartTime = startTime;

    // IMPORTANT: Appliquer la position initiale IMMÉDIATEMENT pour éviter la saccade
    // Calculer où en est l'animation au moment du démarrage
    const initialElapsed = timeOffset;
    const initialTime = initialElapsed * flyingAnimationSpeed;
    const initialOffset = Math.sin(initialTime) * flyingAnimationAmplitude;
    cardEl.style.transform = `translateY(${initialOffset}px)`;

    function animate() {
        if (!cardEl.isConnected) return;

        if (cardEl.dataset.inCombat === 'true') {
            requestAnimationFrame(animate);
            return;
        }

        const elapsed = performance.now() - startTime;
        const time = elapsed * flyingAnimationSpeed;
        const offset = Math.sin(time) * flyingAnimationAmplitude;
        cardEl.style.transform = `translateY(${offset}px)`;

        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
}

/**
 * Récupère le temps écoulé depuis le début de l'animation de vol
 * @param {HTMLElement} cardEl - L'élément carte avec animation de vol
 * @returns {number} - Temps écoulé en ms, ou 0 si pas d'animation
 */
function getFlyingAnimationTime(cardEl) {
    if (!cardEl || !cardEl.dataset.flyingStartTime) return 0;
    return performance.now() - parseFloat(cardEl.dataset.flyingStartTime);
}

async function animateSummon(data) {
    // Pour nos propres cartes : ne PAS animer, elles sont déjà en place
    if (data.player === myNum && !data.animateForLocal) {
        return;
    }

    const owner = data.player === myNum ? 'me' : 'opp';
    const slotKey = `${owner}-${data.row}-${data.col}`;

    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${data.row}"][data-col="${data.col}"]`);
    if (!slot) return;

    // Précharger l'image avant de créer la carte (évite le flash blanc)
    if (data.card?.image && typeof preloadCardImage === 'function') {
        await preloadCardImage(data.card.image);
    }

    // Ne bloquer que les slots adverses
    if (owner === 'opp') {
        if (typeof window.blockSlot === 'function') {
            window.blockSlot(slotKey);
        }
    }

    const rect = slot.getBoundingClientRect();

    // Créer la carte overlay pour l'animation
    const cardEl = makeCard(data.card, false);
    cardEl.style.position = 'fixed';
    cardEl.style.left = rect.left + 'px';
    cardEl.style.width = rect.width + 'px';
    cardEl.style.height = rect.height + 'px';
    cardEl.style.zIndex = '2000';
    cardEl.style.pointerEvents = 'none';
    cardEl.style.top = '-150px';
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'scale(0.8) rotateX(30deg)';
    cardEl.classList.add('summon-drop');

    // Ajouter la bordure appropriée dès l'animation
    // Une créature qui vient d'être invoquée est "just-played" (sauf si elle a haste)
    const hasHaste = data.card.abilities?.includes('haste');
    if (hasHaste && data.card.canAttack) {
        cardEl.classList.add('can-attack');
    } else {
        cardEl.classList.add('just-played');
    }

    document.body.appendChild(cardEl);

    // Animation de chute (400ms au lieu de 500ms)
    requestAnimationFrame(() => {
        cardEl.style.transition = 'top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.15s ease-out, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        cardEl.style.top = rect.top + 'px';
        cardEl.style.opacity = '1';
        cardEl.style.transform = 'scale(1) rotateX(0deg)';
    });

    await new Promise(resolve => {
        setTimeout(() => {
            console.log(`[Summon] Animation done, placing ${data.card.name} (uid=${data.card.uid}) in ${slotKey}`);
            // Créer la carte finale AVANT de supprimer quoi que ce soit
            const cardInSlot = makeCard(data.card, false);

            // IMPORTANT: S'assurer que l'uid est défini sur la carte DOM
            // pour que renderField puisse détecter que c'est la même carte
            if (data.card.uid && !cardInSlot.dataset.cardUid) {
                cardInSlot.dataset.cardUid = data.card.uid;
                console.log(`[Summon] FIXED missing cardUid on DOM element: ${data.card.uid}`);
            }
            console.log(`[Summon] cardInSlot created - dataset.cardUid=${cardInSlot.dataset.cardUid}, card.uid=${data.card.uid}`);

            // Ajouter la bordure appropriée
            const hasHaste = data.card.abilities?.includes('haste');
            if (hasHaste && data.card.canAttack) {
                cardInSlot.classList.add('can-attack');
            } else {
                cardInSlot.classList.add('just-played');
            }

            if (data.card.type === 'creature' && data.card.abilities?.includes('fly')) {
                cardInSlot.classList.add('flying-creature');
                slot.classList.add('has-flying');
                startFlyingAnimation(cardInSlot);
            }

            // Ajouter le bouclier si la créature a Protection
            if (data.card.hasProtection && typeof addShieldToCard === 'function') {
                addShieldToCard(cardInSlot, false);
            }

            // IMPORTANT: Ajouter la nouvelle carte D'ABORD, puis nettoyer
            // Cela évite le flash blanc car il n'y a jamais de moment où le slot est vide
            slot.appendChild(cardInSlot);
            slot.classList.add('has-card');
            console.log(`[Summon] Card added to slot. slot.children=${slot.children.length}, slot.innerHTML.substr(0,150)=${slot.innerHTML.substring(0,150)}`);

            // Maintenant supprimer les anciens éléments (sauf la nouvelle carte)
            const children = Array.from(slot.children);
            children.forEach(child => {
                if (child !== cardInSlot && !child.classList.contains('slot-label')) {
                    child.remove();
                }
            });
            console.log(`[Summon] After cleanup. slot.children=${slot.children.length}, hasCard=${slot.querySelector('.card') !== null}`);

            // Supprimer l'overlay APRÈS que la carte soit dans le slot
            cardEl.remove();

            // NE PAS débloquer manuellement - le serveur envoie unblockSlots
            // après que tous les clients aient confirmé les animations.
            // Cela évite le flash où les cartes apparaissent aux mauvaises positions.
            console.log(`[Summon] Fin animation ${slotKey} (slot reste bloqué jusqu'à unblockSlots serveur)`);

            resolve();
        }, 420);
    });
}

// Exposer globalement pour ResolutionPlayer
window.animateSummon = animateSummon;
window.startFlyingAnimation = startFlyingAnimation;
window.getFlyingAnimationTime = getFlyingAnimationTime;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { animateSummon, startFlyingAnimation, getFlyingAnimationTime };
}
