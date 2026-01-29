// =============================================
// Rendu du terrain de jeu
// =============================================
// Affichage des créatures et pièges

/**
 * Rendu du terrain de jeu
 * @param {string} owner - 'me' ou 'opp'
 * @param {Array} field - Tableau 4x2 du terrain
 */
function renderField(owner, field) {
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${r}"][data-col="${c}"]`);
            if (!slot) continue;

            // Slot en cours d'animation, ne pas toucher
            const slotKey = `${owner}-${r}-${c}`;
            if (animatingSlots.has(slotKey)) {
                continue;
            }

            const card = field[r][c];
            const existingCardEl = slot.querySelector('.card');

            // OPTIMISATION: Si la carte est la même (même uid), ne pas tout recréer
            // Cela évite de casser les animations en cours (bouclier, vol, etc.)
            // Cas spécial: carte temporaire (placée localement avant réponse serveur)
            const isTempCard = existingCardEl?.dataset.tempCard === 'true';
            const isSameCard = existingCardEl && card && existingCardEl.dataset.cardUid === card.uid;
            const isTempBeingReplaced = isTempCard && card && existingCardEl.dataset.cardId === card.id;

            // DEBUG: Log détaillé pour comprendre la saccade
            if (card || existingCardEl) {
                console.log(`[renderField] CHECK ${owner} [${r},${c}]: card=${card?.name || 'null'}, card.id=${card?.id}, card.uid=${card?.uid}, existingCardEl=${!!existingCardEl}, existingCardEl.cardId=${existingCardEl?.dataset?.cardId}, existingCardEl.cardUid=${existingCardEl?.dataset?.cardUid}, isTempCard=${isTempCard}, isSameCard=${isSameCard}, isTempBeingReplaced=${isTempBeingReplaced}`);
            }

            // Si c'est une carte temporaire qui correspond à la même carte (même id),
            // mettre à jour l'uid et continuer sans recréer
            if (isTempBeingReplaced) {
                console.log(`[renderField] TEMP CARD MATCHED - updating uid from ${existingCardEl.dataset.cardUid} to ${card.uid}`);
                existingCardEl.dataset.cardUid = card.uid;
                delete existingCardEl.dataset.tempCard;
                // Continuer pour mettre à jour les stats
            }

            if ((isSameCard || isTempBeingReplaced) && existingCardEl && card) {
                // Mettre à jour seulement les stats si nécessaires (plusieurs formats possibles)
                const hp = card.currentHp ?? card.hp;

                // DEBUG: Logger les mises à jour de HP
                console.log(`[renderField] UPDATE ${owner} [${r},${c}] ${card.name}: currentHp=${card.currentHp}, hp=${card.hp}, displayed=${hp}`);

                // Format arena-stats
                const arenaAtk = existingCardEl.querySelector('.arena-atk');
                const arenaHp = existingCardEl.querySelector('.arena-hp');
                if (arenaAtk) arenaAtk.textContent = card.atk;
                if (arenaHp) {
                    console.log(`[renderField] Setting arena-hp to ${hp} (was ${arenaHp.textContent})`);
                    arenaHp.textContent = hp;
                }

                // Format fullArt
                const faAtk = existingCardEl.querySelector('.fa-atk');
                const faHp = existingCardEl.querySelector('.fa-hp');
                if (faAtk) faAtk.textContent = card.atk;
                if (faHp) faHp.textContent = hp;

                // Format image card
                const imgAtk = existingCardEl.querySelector('.img-atk');
                const imgHp = existingCardEl.querySelector('.img-hp');
                if (imgAtk) imgAtk.textContent = card.atk;
                if (imgHp) imgHp.textContent = hp;

                // Format classic
                const statAtk = existingCardEl.querySelector('.stat-atk');
                const statHp = existingCardEl.querySelector('.stat-hp');
                if (statAtk) statAtk.textContent = card.atk;
                if (statHp) statHp.textContent = hp;

                // Mettre à jour les classes d'état (can-attack, just-played)
                // pour permettre les transitions CSS fluides
                // NOTE: On utilise canAttack comme source de vérité, pas turnsOnField
                // car turnsOnField peut être 0 après un déplacement (bug serveur)
                const canAttack = card.canAttack;

                // Une carte est "just-played" seulement si elle ne peut PAS attaquer
                // et qu'elle n'a pas haste (sinon elle aurait canAttack = true)
                const isJustPlayed = !canAttack && card.turnsOnField === 0;

                if (canAttack) {
                    existingCardEl.classList.remove('just-played');
                    existingCardEl.classList.add('can-attack');
                } else if (isJustPlayed) {
                    existingCardEl.classList.add('just-played');
                    existingCardEl.classList.remove('can-attack');
                } else {
                    // Ni can-attack ni just-played (cas rare)
                    existingCardEl.classList.remove('just-played');
                    existingCardEl.classList.remove('can-attack');
                }

                // Gérer le bouclier - ajouter si nécessaire, retirer si plus actif
                const hasShieldEl = existingCardEl.querySelector('.shield-container');
                if (card.hasProtection && !hasShieldEl) {
                    addStaticShield(existingCardEl, owner, r, c);
                } else if (!card.hasProtection && hasShieldEl) {
                    hasShieldEl.remove();
                }

                console.log(`[renderField] SKIP recreate - same card or temp matched`);
                continue; // Ne pas recréer la carte
            }

            // Sauvegarder le bouclier existant et le temps d'animation de vol avant de vider le slot
            const existingShield = existingCardEl?.querySelector('.shield-container');
            const existingFlyingTime = existingCardEl?.dataset.flyingStartTime
                ? performance.now() - parseFloat(existingCardEl.dataset.flyingStartTime)
                : 0;

            // LOG: On va recréer la carte - c'est ça qui cause la saccade
            if (card) {
                console.log(`[renderField] RECREATING card ${owner} [${r},${c}] ${card.name} - existingCardEl=${!!existingCardEl}, isTempCard=${isTempCard}`);
            }

            const label = slot.querySelector('.slot-label');
            slot.innerHTML = '';
            if (label) slot.appendChild(label.cloneNode(true));

            slot.classList.remove('has-card');
            slot.classList.remove('has-flying');

            if (card) {
                slot.classList.add('has-card');
                const cardEl = makeCard(card, false);
                // FORCER les dimensions du terrain AVANT insertion pour éviter le flash de redimensionnement
                cardEl.style.width = '105px';
                cardEl.style.height = '140px';
                cardEl.style.transition = 'none';
                // LOG: Taille de la carte créée
                console.log(`[renderField] CREATE CARD ${owner} [${r},${c}] ${card.name} - cardEl classes: ${cardEl.className}, forced size: 105x140`);

                // Lévitation pour les volants (préserver le temps d'animation si existant)
                if (card.type === 'creature' && card.abilities?.includes('fly')) {
                    cardEl.classList.add('flying-creature');
                    slot.classList.add('has-flying');
                    startFlyingAnimation(cardEl, existingFlyingTime);
                } else {
                    slot.classList.remove('has-flying');
                }

                // Bouclier Protection - réutiliser l'existant ou en créer un nouveau
                if (card.hasProtection) {
                    if (existingShield) {
                        // Réutiliser le bouclier existant (préserve l'animation)
                        cardEl.style.position = 'relative';
                        cardEl.style.overflow = 'visible';
                        cardEl.appendChild(existingShield);
                    } else {
                        addStaticShield(cardEl, owner, r, c);
                    }
                }

                // Hover preview
                cardEl.onmouseenter = (e) => showCardPreview(card, e);
                cardEl.onmouseleave = hideCardPreview;
                cardEl.onmousemove = (e) => moveCardPreview(e);

                // Drag & drop pour redéploiement
                const isImmovable = card.abilities?.includes('immovable');
                if (owner === 'me' && !state.me.inDeployPhase && !card.movedThisTurn && !isImmovable) {
                    cardEl.draggable = true;
                    cardEl.ondragstart = (e) => {
                        if (!canPlay()) { e.preventDefault(); return; }
                        draggedFromField = { row: r, col: c, card };
                        cardEl.classList.add('dragging');
                        hideCardPreview();
                        highlightMoveTargets(r, c, card);
                    };
                    cardEl.ondragend = () => {
                        cardEl.classList.remove('dragging');
                        draggedFromField = null;
                        clearHighlights();
                    };
                }

                // Clic = zoom
                cardEl.onclick = (e) => {
                    e.stopPropagation();
                    showCardZoom(card);
                };
                slot.appendChild(cardEl);
                // LOG: Taille finale après insertion dans le DOM
                requestAnimationFrame(() => {
                    const finalRect = cardEl.getBoundingClientRect();
                    const slotRect = slot.getBoundingClientRect();
                    console.log(`[renderField] INSERTED ${owner} [${r},${c}] ${card.name} - card: ${finalRect.width.toFixed(1)}x${finalRect.height.toFixed(1)}, slot: ${slotRect.width.toFixed(1)}x${slotRect.height.toFixed(1)}, transform: ${window.getComputedStyle(cardEl).transform}`);
                });
            }
        }
    }
}

/**
 * Ajoute un bouclier à une carte
 */
function addStaticShield(cardEl, owner, r, c) {
    // Utiliser la nouvelle fonction du système de bouclier CSS
    if (typeof addShieldToCard === 'function') {
        addShieldToCard(cardEl, false);
    }
}

/**
 * Rendu des pièges
 */
function renderTraps() {
    state.me.traps.forEach((trap, i) => {
        const slot = document.querySelector(`.trap-slot[data-owner="me"][data-row="${i}"]`);
        if (slot) {
            slot.classList.remove('has-trap', 'mine');
            slot.innerHTML = '';
            if (trap) {
                slot.classList.add('has-trap', 'mine');

                const trapCard = state.me.trapCards ? state.me.trapCards[i] : null;
                if (trapCard) {
                    slot.onmouseenter = (e) => showCardPreview(trapCard, e);
                    slot.onmouseleave = hideCardPreview;
                    slot.onmousemove = (e) => moveCardPreview(e);
                }
            } else {
                slot.onmouseenter = null;
                slot.onmouseleave = null;
                slot.onmousemove = null;
            }
        }
    });

    state.opponent.traps.forEach((trap, i) => {
        const slot = document.querySelector(`.trap-slot[data-owner="opp"][data-row="${i}"]`);
        if (slot) {
            slot.classList.remove('has-trap', 'mine');
            slot.innerHTML = '';
            if (trap) {
                slot.classList.add('has-trap');
            }
        }
    });
}

/**
 * Rendu de la main du joueur
 */
function renderHand(hand, energy) {
    const panel = document.getElementById('my-hand');
    panel.innerHTML = '';

    const isHyrule = state.me.hero && state.me.hero.id === 'hyrule';
    const spellsCast = state.me.spellsCastThisTurn || 0;
    const hasHyruleDiscount = isHyrule && spellsCast === 1;

    hand.forEach((card, i) => {
        let effectiveCost = card.cost;
        let hasDiscount = false;
        if (hasHyruleDiscount && card.type === 'spell') {
            effectiveCost = Math.max(0, card.cost - 1);
            hasDiscount = true;
        }

        const el = makeCard(card, true, hasDiscount ? effectiveCost : null);
        el.dataset.idx = i;
        el.dataset.cost = effectiveCost;

        if (effectiveCost <= energy) {
            el.classList.add('playable');
        }

        el.style.zIndex = i + 1;

        if (typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('me', i)) {
            el.style.visibility = 'hidden';
        }

        el.draggable = true;

        el.onmouseenter = (e) => showCardPreview(card, e);
        el.onmouseleave = hideCardPreview;

        el.onclick = (e) => {
            e.stopPropagation();
            showCardZoom(card);
        };

        el.ondragstart = (e) => {
            if (!canPlay()) { e.preventDefault(); return; }
            const tooExpensive = effectiveCost > energy;
            dragged = { ...card, idx: i, tooExpensive, effectiveCost };
            draggedFromField = null;
            el.classList.add('dragging');
            hideCardPreview();
            highlightValidSlots(card);
        };

        el.ondragend = (e) => {
            el.classList.remove('dragging');
            if (dragged && dragged.tooExpensive && dragged.triedToDrop) {
                el.classList.add('shake');
                setTimeout(() => el.classList.remove('shake'), 400);
            }
            dragged = null;
            clearHighlights();
        };

        panel.appendChild(el);
    });
}

/**
 * Rendu de la main adverse
 */
function renderOppHand(count) {
    const panel = document.getElementById('opp-hand');
    panel.innerHTML = '';
    for (let i = 0; i < Math.min(count, 12); i++) {
        const el = document.createElement('div');
        el.className = 'opp-card-back';
        el.style.zIndex = i + 1;

        if (typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('opp', i)) {
            el.style.visibility = 'hidden';
        }

        el.onmouseenter = () => showCardBackPreview();
        el.onmouseleave = hideCardPreview;

        panel.appendChild(el);
    }
}
