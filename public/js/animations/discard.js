// =============================================
// Animations de défausse et burn
// =============================================
// Défausse de main et burn (pioche vers cimetière)

/**
 * Animation de défausse depuis la main (main pleine)
 * Utilise PixiJS pour une animation professionnelle style Magic Arena
 */
async function animateDiscard(data) {
    console.log('[Discard] START - data:', JSON.stringify(data));
    const owner = data.player === myNum ? 'me' : 'opp';
    const handEl = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
    if (!handEl) {
        console.log('[Discard] END - No hand element found');
        return;
    }

    const cards = handEl.querySelectorAll(owner === 'me' ? '.card' : '.opp-card-back');
    const cardEl = cards[data.handIndex];
    if (!cardEl) {
        console.log('[Discard] END - No card at index', data.handIndex);
        return;
    }

    // Note: pendingGraveyard est incrémenté dans handleAnimation() dès réception

    const cardRect = cardEl.getBoundingClientRect();
    const handRect = handEl.getBoundingClientRect();
    const graveyardEl = document.getElementById(owner === 'me' ? 'me-grave-box' : 'opp-grave-box');
    const graveyardRect = graveyardEl ? graveyardEl.getBoundingClientRect() : {
        left: window.innerWidth / 2 - 40,
        top: owner === 'me' ? window.innerHeight - 100 : 100,
        width: 80,
        height: 100
    };

    // Cacher la carte originale
    cardEl.style.visibility = 'hidden';

    let timeoutId;
    try {
        // Utiliser l'animation PixiJS si disponible (pour main pleine)
        if (window.discardVFX && data.reason === 'handFull') {
            console.log('[Discard] Using PixiJS VFX animation (hand full)');
            await Promise.race([
                window.discardVFX.animateFullHandDiscard(cardRect, handRect, graveyardRect, owner, data.card),
                new Promise(resolve => {
                    timeoutId = setTimeout(() => {
                        console.log('[Discard] TIMEOUT reached after 3s');
                        resolve();
                    }, 3000);
                })
            ]);
        } else {
            // Animation classique de désintégration
            console.log('[Discard] Using classic disintegration animation');
            const clone = cardEl.cloneNode(true);
            clone.style.cssText = `
                position: fixed;
                left: ${cardRect.left}px;
                top: ${cardRect.top}px;
                width: ${cardRect.width}px;
                height: ${cardRect.height}px;
                z-index: 10000;
                pointer-events: none;
                margin: 0;
                transform: none;
            `;
            document.body.appendChild(clone);

            await Promise.race([
                animateDisintegration(clone, owner),
                new Promise(resolve => {
                    timeoutId = setTimeout(() => {
                        console.log('[Discard] TIMEOUT reached after 1.5s');
                        resolve();
                    }, 1500);
                })
            ]);

            if (clone.parentNode) {
                clone.remove();
            }
        }
    } catch (e) {
        console.error('[Discard] Animation error:', e);
    } finally {
        clearTimeout(timeoutId);
        // Décrémenter et rafraîchir le cimetière après l'animation
        if (typeof pendingGraveyard !== 'undefined') {
            pendingGraveyard[owner].count--;
            if (typeof refreshGraveyardDisplay === 'function') {
                refreshGraveyardDisplay(owner);
            }
        }
    }
    console.log('[Discard] END');
}

/**
 * Animation de burn (main pleine lors de la pioche)
 * Utilise PixiJS pour une animation professionnelle style Magic Arena
 * La carte tente d'aller vers la main, est rejetée, puis va au cimetière
 */
async function animateBurn(data) {
    console.log('[Burn] START - data:', JSON.stringify(data));
    const owner = data.player === myNum ? 'me' : 'opp';
    const card = data.card;

    const deckEl = document.getElementById(owner === 'me' ? 'me-deck-stack' : 'opp-deck-stack');
    if (!deckEl) {
        console.log('[Burn] END - No deck element found');
        return;
    }

    // Note: pendingGraveyard est incrémenté dans handleAnimation() dès réception

    const deckRect = deckEl.getBoundingClientRect();
    const handEl = document.getElementById(owner === 'me' ? 'my-hand' : 'opp-hand');
    const handRect = handEl ? handEl.getBoundingClientRect() : {
        left: window.innerWidth / 2 - 200,
        top: owner === 'me' ? window.innerHeight - 150 : 50,
        width: 400,
        height: 120
    };
    const graveyardEl = document.getElementById(owner === 'me' ? 'me-grave-box' : 'opp-grave-box');
    const graveyardRect = graveyardEl ? graveyardEl.getBoundingClientRect() : {
        left: window.innerWidth / 2 - 40,
        top: owner === 'me' ? window.innerHeight - 100 : 100,
        width: 80,
        height: 100
    };

    let timeoutId;
    try {
        // Utiliser l'animation PixiJS professionnelle
        if (window.discardVFX) {
            console.log('[Burn] Using PixiJS VFX animation (hand full)');
            await Promise.race([
                window.discardVFX.animateBurnFromDeck(deckRect, handRect, graveyardRect, owner, card),
                new Promise(resolve => {
                    timeoutId = setTimeout(() => {
                        console.log('[Burn] TIMEOUT reached after 4s');
                        resolve();
                    }, 4000);
                })
            ]);
        } else {
            // Fallback: animation classique
            console.log('[Burn] Using classic animation (fallback)');
            const cardEl = createCardElementForAnimation(card);
            const cardWidth = 90;
            const cardHeight = 130;

            cardEl.style.cssText = `
                position: fixed;
                left: ${deckRect.left + deckRect.width / 2 - cardWidth / 2}px;
                top: ${deckRect.top + deckRect.height / 2 - cardHeight / 2}px;
                width: ${cardWidth}px;
                height: ${cardHeight}px;
                z-index: 10000;
                pointer-events: none;
                opacity: 0;
                transform: scale(0.8);
                transition: all 0.4s ease-out;
            `;
            document.body.appendChild(cardEl);

            await new Promise(resolve => setTimeout(resolve, 50));

            const centerX = window.innerWidth / 2 - cardWidth / 2;
            const centerY = window.innerHeight / 2 - cardHeight / 2;

            cardEl.style.left = centerX + 'px';
            cardEl.style.top = centerY + 'px';
            cardEl.style.opacity = '1';
            cardEl.style.transform = 'scale(1.2)';

            await new Promise(resolve => setTimeout(resolve, 500));

            await Promise.race([
                animateDisintegration(cardEl, owner),
                new Promise(resolve => {
                    timeoutId = setTimeout(() => {
                        console.log('[Burn] Timeout reached');
                        resolve();
                    }, 1500);
                })
            ]);

            if (cardEl.parentNode) {
                cardEl.remove();
            }
        }
    } catch (e) {
        console.error('[Burn] Animation error:', e);
    } finally {
        clearTimeout(timeoutId);
        // Décrémenter et rafraîchir le cimetière après l'animation
        if (typeof pendingGraveyard !== 'undefined') {
            pendingGraveyard[owner].count--;
            if (typeof refreshGraveyardDisplay === 'function') {
                refreshGraveyardDisplay(owner);
            }
        }
    }
    console.log('[Burn] END');
}

/**
 * Animation de désintégration avec particules vers le cimetière
 */
async function animateDisintegration(cardEl, owner) {
    const rect = cardEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const graveyardEl = document.getElementById(owner === 'me' ? 'me-grave-box' : 'opp-grave-box');
    let graveyardX = window.innerWidth / 2;
    let graveyardY = owner === 'me' ? window.innerHeight - 50 : 50;

    if (graveyardEl) {
        const gRect = graveyardEl.getBoundingClientRect();
        graveyardX = gRect.left + gRect.width / 2;
        graveyardY = gRect.top + gRect.height / 2;
    }

    const particleCount = 20;
    const particles = [];

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        const size = 4 + Math.random() * 8;
        const startOffsetX = (Math.random() - 0.5) * rect.width;
        const startOffsetY = (Math.random() - 0.5) * rect.height;

        particle.style.cssText = `
            position: fixed;
            left: ${centerX + startOffsetX}px;
            top: ${centerY + startOffsetY}px;
            width: ${size}px;
            height: ${size}px;
            background: linear-gradient(135deg, #ff6b6b, #ffd93d, #6bcb77);
            border-radius: 50%;
            pointer-events: none;
            z-index: 10001;
            box-shadow: 0 0 ${size}px rgba(255, 107, 107, 0.8);
            opacity: 1;
        `;
        document.body.appendChild(particle);
        particles.push({
            el: particle,
            startX: centerX + startOffsetX,
            startY: centerY + startOffsetY,
            delay: Math.random() * 200
        });
    }

    cardEl.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'scale(0.5)';

    const duration = 600;
    const maxDuration = 1000;

    await new Promise(resolve => {
        const startTime = performance.now();
        let cancelled = false;

        const safetyTimeout = setTimeout(() => {
            cancelled = true;
            cleanup();
            resolve();
        }, maxDuration);

        function cleanup() {
            for (const p of particles) {
                if (p.el.parentNode) p.el.remove();
            }
            if (cardEl.parentNode) cardEl.remove();
        }

        function animate() {
            if (cancelled) return;

            const elapsed = performance.now() - startTime;
            let allDone = true;

            for (const p of particles) {
                const particleElapsed = Math.max(0, elapsed - p.delay);
                const progress = Math.min(particleElapsed / duration, 1);

                if (progress < 1) {
                    allDone = false;
                    const eased = 1 - Math.pow(1 - progress, 3);

                    const controlX = (p.startX + graveyardX) / 2 + (Math.random() - 0.5) * 100;
                    const controlY = Math.min(p.startY, graveyardY) - 50;

                    const t = eased;
                    const x = (1 - t) * (1 - t) * p.startX + 2 * (1 - t) * t * controlX + t * t * graveyardX;
                    const y = (1 - t) * (1 - t) * p.startY + 2 * (1 - t) * t * controlY + t * t * graveyardY;

                    p.el.style.left = x + 'px';
                    p.el.style.top = y + 'px';
                    p.el.style.opacity = (1 - progress * 0.5).toString();
                    p.el.style.transform = `scale(${1 - progress * 0.5})`;
                } else {
                    p.el.style.opacity = '0';
                }
            }

            if (!allDone) {
                requestAnimationFrame(animate);
            } else {
                clearTimeout(safetyTimeout);
                cleanup();
                resolve();
            }
        }

        requestAnimationFrame(animate);
    });
}

/**
 * Crée un élément carte pour l'animation
 */
function createCardElementForAnimation(card) {
    // Utiliser makeCard pour les cartes arenaStyle (sorts, créatures...)
    if (card.arenaStyle && card.image && typeof makeCard === 'function') {
        return makeCard(card, true);
    }

    const el = document.createElement('div');
    el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type}`;
    const hp = card.currentHp ?? card.hp;

    if (card.image) {
        el.classList.add('has-image');
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        const abilityNames = {
            fly: 'Vol', shooter: 'Tireur', haste: 'Célérité', intangible: 'Intangible',
            trample: 'Piétinement', power: 'Puissance'
        };
        const abilitiesText = (card.abilities || []).map(a => {
            if (a === 'cleave') return `Clivant ${card.cleaveX || ''}`.trim();
            return abilityNames[a] || a;
        }).join(', ');

        let combatTypeText = 'Mêlée';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        el.innerHTML = `
            <div class="img-cost">${card.cost}</div>
            <div class="img-subtype">${card.subtype || ''}</div>
            <div class="img-name">${card.name}</div>
            <div class="img-type-line">Créature - ${combatTypeText}</div>
            <div class="img-abilities">${abilitiesText}</div>
            <div class="img-atk">${card.atk}</div>
            <div class="img-hp">${hp}</div>`;
        return el;
    }

    const icons = {
        fly: '🦅', shooter: '🎯', haste: '⚡', intangible: '👻',
        trample: '🦏', power: '💪', cleave: '⛏️'
    };
    const abilities = (card.abilities || []).map(a => icons[a] || '').join(' ');

    let typeIcon = '';
    if (card.type === 'spell') typeIcon = `<div class="card-type-icon spell-icon">✨</div>`;
    else if (card.type === 'trap') typeIcon = `<div class="card-type-icon trap-icon">🪤</div>`;

    el.innerHTML = `
        <div class="card-cost">${card.cost}</div>
        ${typeIcon}
        <div class="card-art">${card.icon || '❓'}</div>
        <div class="card-body">
            <div class="card-name">${card.name}</div>
            <div class="card-abilities">${abilities || (card.type === 'spell' ? (card.offensive ? '⚔️' : '💚') : '')}</div>
            <div class="card-stats">
                ${card.atk !== undefined ? `<span class="stat stat-atk">${card.atk}</span>` : ''}
                ${card.damage ? `<span class="stat stat-atk">${card.damage}</span>` : ''}
                ${card.heal ? `<span class="stat stat-hp">${card.heal}</span>` : ''}
                ${card.type === 'creature' ? `<span class="stat stat-hp">${hp}</span>` : ''}
            </div>
        </div>`;

    return el;
}
