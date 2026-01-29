// =============================================
// Système de file d'attente d'animations
// =============================================
// Gère la séquence des animations de combat

const animationQueue = [];
let isAnimating = false;
let currentProcessorId = 0;

// Système de HP différés pour zdejebel
let pendingHpUpdate = null;
let zdejebelAnimationInProgress = false;

const ANIMATION_DELAYS = {
    attack: 600,
    damage: 500,
    death: 200,
    heroHit: 200,
    discard: 800,
    burn: 1000,
    move: 100,
    summon: 100,
    default: 300
};

/**
 * Ajoute une animation à la file d'attente
 * @param {string} type - Type d'animation
 * @param {Object} data - Données de l'animation
 */
function queueAnimation(type, data) {
    console.log('[Queue] Adding:', type, 'isAnimating:', isAnimating, 'queueLength:', animationQueue.length);

    // Pour zdejebel, capturer les HP actuels AVANT que render() ne les mette à jour
    if (type === 'zdejebel' && state) {
        const target = data.targetPlayer === myNum ? 'me' : 'opp';
        const currentDisplayedHp = target === 'me' ? state.me?.hp : state.opponent?.hp;
        data._displayHpBefore = currentDisplayedHp;
        console.log('[Queue] Zdejebel: captured HP before =', currentDisplayedHp, 'for', target);
    }

    // Pour burn et death, bloquer le render du cimetière IMMÉDIATEMENT (avant que render() ne l'affiche)
    if ((type === 'burn' || type === 'death') && typeof graveRenderBlocked !== 'undefined') {
        const owner = data.player === myNum ? 'me' : 'opp';
        graveRenderBlocked.add(owner);
        console.log('[Queue] Blocked graveyard render for', owner, '(type:', type + ')');
    }

    animationQueue.push({ type, data });
    if (!isAnimating) {
        console.log('[Queue] Starting queue processing for:', type);
        processAnimationQueue();
    }
}

/**
 * Traite la file d'attente d'animations
 * @param {number|null} processorId - ID du processeur actuel
 */
async function processAnimationQueue(processorId = null) {
    if (processorId === null) {
        currentProcessorId++;
        processorId = currentProcessorId;
    }

    try {
        if (processorId !== currentProcessorId) {
            console.log('[Queue] Processor', processorId, 'stopping - newer processor active');
            return;
        }

        if (animationQueue.length === 0) {
            console.log('[Queue] Empty, stopping.');
            isAnimating = false;
            return;
        }

        isAnimating = true;
        console.log('[Queue] Processing, queueLength:', animationQueue.length);

        // Regrouper les animations de mort consécutives (jouées en parallèle)
        if (animationQueue[0].type === 'death') {
            const deathBatch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'death') {
                deathBatch.push(animationQueue.shift().data);
            }
            const deathPromises = deathBatch.map(data => animateDeathToGraveyard(data));
            await Promise.all(deathPromises);
            await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.death));
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations de burn consécutives (jouées en parallèle)
        if (animationQueue[0].type === 'burn') {
            const burnBatch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'burn') {
                burnBatch.push(animationQueue.shift().data);
            }
            const burnPromises = burnBatch.map(data => animateBurn(data));
            await Promise.all(burnPromises);
            processAnimationQueue(processorId);
            return;
        }

        // Regrouper les animations de dégâts de sort
        if (animationQueue[0].type === 'spellDamage') {
            const spellDamageBatch = [];
            while (animationQueue.length > 0 && animationQueue[0].type === 'spellDamage') {
                spellDamageBatch.push(animationQueue.shift().data);
            }
            const promises = spellDamageBatch.map(data => {
                const owner = data.player === myNum ? 'me' : 'opp';
                if (combatAnimReady && CombatAnimations) {
                    return CombatAnimations.animateSpellDamage({
                        owner: owner,
                        row: data.row,
                        col: data.col,
                        amount: data.amount
                    });
                } else {
                    animateDamageFallback(data);
                    return Promise.resolve();
                }
            });
            await Promise.all(promises);
            await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.damage));
            processAnimationQueue(processorId);
            return;
        }

        const { type, data } = animationQueue.shift();
        const delay = ANIMATION_DELAYS[type] || ANIMATION_DELAYS.default;

        // Exécuter l'animation avec timeout de sécurité
        try {
            const animationPromise = executeAnimationAsync(type, data);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Animation timeout: ${type}`)), 5000)
            );
            await Promise.race([animationPromise, timeoutPromise]);
        } catch (e) {
            console.error('[Queue] Animation error:', type, e);
        }

        if (processorId !== currentProcessorId) return;

        await new Promise(resolve => setTimeout(resolve, delay));
        processAnimationQueue(processorId);
    } catch (globalError) {
        console.error('[Queue] GLOBAL ERROR:', globalError);
        isAnimating = false;
        if (animationQueue.length > 0) {
            setTimeout(() => processAnimationQueue(), 100);
        }
    }
}

/**
 * Exécute une animation de manière asynchrone
 * @param {string} type - Type d'animation
 * @param {Object} data - Données de l'animation
 */
async function executeAnimationAsync(type, data) {
    console.log('[executeAnimationAsync] type:', type);

    if (combatAnimReady && CombatAnimations) {
        switch(type) {
            case 'attack': await handlePixiAttack(data); return;
            case 'damage': await handlePixiDamage(data); return;
            case 'spellDamage': await handlePixiSpellDamage(data); return;
            case 'heroHit': await handlePixiHeroHit(data); return;
            case 'onDeathDamage': await handleOnDeathDamage(data); return;
            case 'zdejebel': await animateZdejebelDamage(data); return;
            case 'death': await animateDeathToGraveyard(data); return;
            case 'discard': await animateDiscard(data); return;
            case 'burn': await animateBurn(data); return;
            case 'deathTransform': await animateDeathTransform(data); return;
            case 'reveal':
            case 'boneRevive': await animateBoneRevive(data); return;
            case 'radiantDragonDraw': await animateRadiantDragonDraw(data); return;
            case 'shieldDeploy': await animateShieldDeploy(data); return;
            case 'shieldBreak': await animateShieldBreak(data); return;
            case 'move': await animateMove(data); return;
            case 'summon': await animateSummon(data); return;
        }
    }

    // Fallback
    switch(type) {
        case 'attack': animateAttackFallback(data); break;
        case 'damage': animateDamageFallback(data); break;
        case 'spellDamage': animateDamageFallback(data); break;
        case 'death': await animateDeathToGraveyard(data); break;
        case 'heroHit': animateHeroHitFallback(data); break;
        case 'zdejebel': await animateZdejebelDamage(data); break;
        case 'discard': await animateDiscard(data); break;
        case 'burn': await animateBurn(data); break;
        case 'deathTransform': await animateDeathTransform(data); break;
        case 'reveal':
        case 'boneRevive': await animateBoneRevive(data); break;
        case 'radiantDragonDraw': await animateRadiantDragonDraw(data); break;
        case 'shieldDeploy': await animateShieldDeploy(data); break;
        case 'shieldBreak': await animateShieldBreak(data); break;
    }
}

// Slots en cours d'animation
let animatingSlots = new Set();
let moveAnimationSnapshot = new Map();

// NOTE: blockOppFieldRender, hiddenCards, pendingMoveAnimations et moveBlockTimeout ont été supprimés
// Le nouveau système filtre les cartes adverses côté serveur pendant le planning

/**
 * Réinitialise tous les états d'animation
 */
function resetAnimationStates() {
    animatingSlots.clear();
    console.log('[Reset] Animation states reset, queue preserved:', animationQueue.length, 'items');

    if (typeof GameAnimations !== 'undefined') {
        GameAnimations.clear();
    }

    document.querySelectorAll('.card[data-in-combat="true"]').forEach(card => {
        card.dataset.inCombat = 'false';
    });

    document.querySelectorAll('.card.dying, .card.taking-damage, .card.healing').forEach(card => {
        card.classList.remove('dying', 'taking-damage', 'healing');
    });

    document.querySelectorAll('.damage-number, .buff-indicator, .spell-effect, .spell-miss').forEach(el => {
        el.remove();
    });
}
