// ==================== RENDU DU JEU ====================
// Render principal, champ de bataille, main, cartes, preview, cimetiÃ¨re

// Safety cleanup : retirer les wrappers d'animation DIV orphelins (> 10s)
// Exclure les CANVAS (PixiJS CombatVFX permanent) qui ont aussi fixed+z-index Ã©levÃ©
setInterval(() => {
    const now = Date.now();
    for (const child of Array.from(document.body.children)) {
        if (child.tagName === 'CANVAS') continue;
        if (child.style.position === 'fixed' && parseInt(child.style.zIndex) >= 9000) {
            const born = parseInt(child.dataset.animBorn) || 0;
            if (!born) {
                child.dataset.animBorn = now;
            } else if (now - born > 10000) {
                child.remove();
            }
        }
    }
}, 5000);

// Slots dont le slow path (makeCard) a Ã©tÃ© diffÃ©rÃ© pendant les animations de combat
var deferredSlots = new Set();

// Cache des Ã©lÃ©ments DOM statiques (initialisÃ© au premier render)
let _cachedDomEls = null;
function _getDomEls() {
    if (!_cachedDomEls) {
        _cachedDomEls = {
            meHpNum: document.querySelector('#me-hp .hero-hp-number'),
            oppHpNum: document.querySelector('#opp-hp .hero-hp-number'),
            meManaNum: document.querySelector('#me-energy .hero-mana-number'),
            oppManaNum: document.querySelector('#opp-energy .hero-mana-number'),
            meDeckTooltip: document.getElementById('me-deck-tooltip'),
            oppDeckTooltip: document.getElementById('opp-deck-tooltip'),
            meGraveTooltip: document.getElementById('me-grave-tooltip'),
            oppGraveTooltip: document.getElementById('opp-grave-tooltip'),
            endTurnBtn: document.getElementById('end-turn-btn'),
        };
    }
    return _cachedDomEls;
}

function render() {
    if (!state) return;
    const __perfRenderStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (typeof CardGlow !== 'undefined') CardGlow.markDirty();
    const me = state.me, opp = state.opponent;
    const dom = _getDomEls();
    if (typeof window.visTrace === 'function') {
        window.visTrace('render:start', {
            state: typeof window.visBuildStateSig === 'function' ? window.visBuildStateSig(state) : null,
            dom: typeof window.visBuildDomSig === 'function' ? window.visBuildDomSig() : null,
        });
    }

    // Ne pas mettre Ã  jour les HP si une animation zdejebel/trample est en cours ou en attente
    const mePlayerNum = Number(myNum || state?.myPlayer || 1);
    const oppPlayerNum = mePlayerNum === 1 ? 2 : 1;
    const hpBlockedByQueueHead = { me: false, opp: false };
    const hpBlockedByActiveAnim = { me: false, opp: false };
    const _markHeroHpBlock = (t, d, out) => {
        if (!t || !out) return;
        const data = d || {};
        if (t === 'heroHit' || t === 'trampleHeroHit') {
            if (data.defender === mePlayerNum) out.me = true;
            if (data.defender === oppPlayerNum) out.opp = true;
            return;
        }
        if (t === 'zdejebel') {
            if (data.targetPlayer === mePlayerNum) out.me = true;
            if (data.targetPlayer === oppPlayerNum) out.opp = true;
            return;
        }
        if (t === 'heroHeal') {
            if (data.player === mePlayerNum) out.me = true;
            if (data.player === oppPlayerNum) out.opp = true;
            return;
        }
        if (t === 'onDeathDamage' && data.targetRow === undefined) {
            if (data.targetPlayer === mePlayerNum) out.me = true;
            if (data.targetPlayer === oppPlayerNum) out.opp = true;
        }
    };
    // Ne bloquer sur la queue que pour les prochains items immediats.
    // Evite un freeze long des HP quand un heroHit est enfoui loin dans la queue.
    const queueHead = (Array.isArray(animationQueue) ? animationQueue : []).slice(0, 2);
    for (const item of queueHead) {
        _markHeroHpBlock(item?.type, item?.data, hpBlockedByQueueHead);
    }
    _markHeroHpBlock(window.__activeAnimType, window.__activeAnimData, hpBlockedByActiveAnim);
    const hpBlockedGlobal = !!(lifestealHeroHealInProgress || zdejebelAnimationInProgress);
    const hpBlockedMe = hpBlockedGlobal || hpBlockedByQueueHead.me || hpBlockedByActiveAnim.me;
    const hpBlockedOpp = hpBlockedGlobal || hpBlockedByQueueHead.opp || hpBlockedByActiveAnim.opp;
    const hasHpAnimPending = hpBlockedMe || hpBlockedOpp;
    if (!hpBlockedMe) {
        if (dom.meHpNum) dom.meHpNum.textContent = me.hp;
    }
    if (!hpBlockedOpp) {
        if (dom.oppHpNum) dom.oppHpNum.textContent = opp.hp;
    }
    if (dom.meManaNum) {
        dom.meManaNum.textContent = `${me.energy}/${me.maxEnergy}`;
        dom.meManaNum.style.fontSize = (me.energy >= 10 || me.maxEnergy >= 10) ? '1em' : '';
    }
    if (dom.oppManaNum) {
        dom.oppManaNum.textContent = `${opp.energy}/${opp.maxEnergy}`;
        dom.oppManaNum.style.fontSize = (opp.energy >= 10 || opp.maxEnergy >= 10) ? '1em' : '';
    }
    // Mettre Ã  jour les tooltips du deck
    if (dom.meDeckTooltip) dom.meDeckTooltip.textContent = me.deckCount + (me.deckCount > 1 ? ' cartes' : ' carte');
    if (dom.oppDeckTooltip) dom.oppDeckTooltip.textContent = opp.deckCount + (opp.deckCount > 1 ? ' cartes' : ' carte');
    // Mettre Ã  jour les tooltips du cimetiÃ¨re
    const meGraveCount = me.graveyardCount || 0;
    const oppGraveCount = opp.graveyardCount || 0;
    if (dom.meGraveTooltip) dom.meGraveTooltip.textContent = meGraveCount + (meGraveCount > 1 ? ' cartes' : ' carte');
    if (dom.oppGraveTooltip) dom.oppGraveTooltip.textContent = oppGraveCount + (oppGraveCount > 1 ? ' cartes' : ' carte');
    
    // Afficher/cacher le contenu du deck selon le nombre de cartes
    updateDeckDisplay('me', me.deckCount);
    updateDeckDisplay('opp', opp.deckCount);
    
    // Afficher la derniÃ¨re carte du cimetiÃ¨re
    updateGraveTopCard('me', me.graveyard);
    updateGraveTopCard('opp', opp.graveyard);
    
    // Mettre Ã  jour l'affichage de la pile du cimetiÃ¨re
    updateGraveDisplay('me', me.graveyard);
    updateGraveDisplay('opp', opp.graveyard);
    
    const activeShieldKeys = new Set();
    const activeCamoKeys = new Set();
    renderField('me', me.field, activeShieldKeys, activeCamoKeys);
    renderField('opp', opp.field, activeShieldKeys, activeCamoKeys);
    CombatVFX.syncShields(activeShieldKeys);
    CombatVFX.syncCamouflages(activeCamoKeys);
    renderTraps();
    renderHand(me.hand, me.energy);

    renderOppHand(opp.handCount, opp.oppHand);

    // Lancer les animations de pioche aprÃ¨s les renders
    if (typeof GameAnimations !== 'undefined') {
        GameAnimations.startPendingDrawAnimations();
    }
    
    if (me.ready && state.phase === 'planning' && dom.endTurnBtn) {
        dom.endTurnBtn.classList.add('waiting');
    }
    if (typeof window.visTrace === 'function') {
        const __renderEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        window.visTrace('render:end', {
            durationMs: Math.round((__renderEnd - __perfRenderStart) * 100) / 100,
            hpBlocked: !!hasHpAnimPending,
            hpBlockedMe: !!hpBlockedMe,
            hpBlockedOpp: !!hpBlockedOpp,
            state: typeof window.visBuildStateSig === 'function' ? window.visBuildStateSig(state) : null,
            dom: typeof window.visBuildDomSig === 'function' ? window.visBuildDomSig() : null,
        });
    }
    if (window.PerfMon) {
        const __perfNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        window.PerfMon.recordRender(
            __perfNow - __perfRenderStart,
            (typeof animationQueue !== 'undefined' && animationQueue) ? animationQueue.length : 0
        );
    }
}

// _monitorBattlefield supprimÃ©  boucle RAF inutile (branches vides) qui forÃ§ait getBoundingClientRect Ã  60fps

function updateDeckDisplay(owner, deckCount) {
    const stack = document.getElementById(`${owner}-deck-stack`);
    if (!stack) return;
    
    // GÃ©rer l'Ã©tat vide
    if (deckCount <= 0) {
        stack.classList.add('empty');
    } else {
        stack.classList.remove('empty');
    }
    
    // Ajuster le nombre de couches visibles selon le nombre de cartes
    // CSS inversÃ© : nth-child(1) = fond (dÃ©calÃ©), nth-child(5) = dessus (pas de dÃ©calage)
    // Quand le deck diminue, on masque les couches du DESSUS (index Ã©levÃ©s dans le DOM)
    const layers = stack.querySelectorAll('.deck-card-layer');
    const totalLayers = layers.length;
    const visibleLayers = Math.min(totalLayers, Math.ceil(deckCount / 8)); // 1 couche par 8 cartes

    // Variable CSS pour l'ombre proportionnelle au nombre de couches
    stack.style.setProperty('--stack-layers', visibleLayers);

    // Garder les premiÃ¨res couches (fond), masquer les derniÃ¨res (dessus)
    layers.forEach((layer, i) => {
        if (i < visibleLayers) {
            layer.style.display = 'block';
        } else {
            layer.style.display = 'none';
        }
    });
}

// Bloquer le render du cimetiÃ¨re pendant les animations (compteur pour supporter plusieurs animations simultanÃ©es)
const _graveBlockCount = { me: 0, opp: 0 };
const graveRenderBlocked = {
    add(owner) { _graveBlockCount[owner] = (_graveBlockCount[owner] || 0) + 1; },
    delete(owner) { _graveBlockCount[owner] = Math.max(0, (_graveBlockCount[owner] || 0) - 1); },
    has(owner) { return (_graveBlockCount[owner] || 0) > 0; },
    clear() { _graveBlockCount.me = 0; _graveBlockCount.opp = 0; }
};
const pendingSpellReturns = new Map(); // spellId   { handIndex, player } pour sorts qui retournent en main

function updateGraveDisplay(owner, graveyard) {
    if (graveRenderBlocked.has(owner)) return;
    const stack = document.getElementById(`${owner}-grave-stack`);
    if (!stack) return;

    const count = graveyard ? graveyard.length : 0;

    stack.classList.toggle('has-cards', count > 0);

    // Nombre de couches visibles proportionnel au nombre de cartes (comme le deck)
    // 1 carte = 0 couches (juste la top card), puis 1 couche par ~6 cartes, max 3
    const layers = stack.querySelectorAll('.grave-card-layer');
    const visibleLayers = count <= 1 ? 0 : Math.min(layers.length, Math.ceil(count / 6));

    // Variable CSS pour l'ombre proportionnelle au nombre de couches
    stack.style.setProperty('--stack-layers', visibleLayers);

    // Remplir les layers avec de vraies cartes, afficher/masquer selon le count
    // Les derniÃ¨res couches (proches du dessus) sont affichÃ©es en premier
    layers.forEach((layer, i) => {
        const show = i >= layers.length - visibleLayers;
        layer.style.display = show ? 'block' : 'none';

        // Layer 0 (nth-child(1), bottom, most offset): graveyard[count-4]
        // Layer 1 (nth-child(2), middle):              graveyard[count-3]
        // Layer 2 (nth-child(3), top layer):           graveyard[count-2]
        const cardIndex = count - (3 - i) - 1;
        const card = (cardIndex >= 0 && graveyard) ? graveyard[cardIndex] : null;
        const cardId = card ? (card.uid || card.id) : '';

        // Cache: ne re-render que si la carte a changÃ©
        if (layer.dataset.cardUid === cardId) return;
        layer.dataset.cardUid = cardId;
        layer.innerHTML = '';

        if (card) {
            const cardEl = makeCard(card, false);
            cardEl.classList.add('grave-card', 'in-graveyard');
            layer.appendChild(cardEl);
        }
    });
}

function updateGraveTopCard(owner, graveyard) {
    if (graveRenderBlocked.has(owner)) {
        return;
    }
    const container = document.getElementById(`${owner}-grave-top`);
    if (!container) return;

    if (graveyard && graveyard.length > 0) {
        const topCard = graveyard[graveyard.length - 1];
        const topId = topCard.uid || topCard.id;
        if (container.dataset.topCardUid === topId) return;
        container.dataset.topCardUid = topId;
        container.classList.remove('empty');
        container.innerHTML = '';
        const cardEl = makeCard(topCard, false);
        cardEl.classList.remove('just-played', 'can-attack');
        cardEl.classList.add('grave-card', 'in-graveyard');
        container.appendChild(cardEl);
    } else {
        if (container.classList.contains('empty') && container.children.length === 0) return;
        delete container.dataset.topCardUid;
        container.classList.add('empty');
        container.innerHTML = '';
    }
}

function renderField(owner, field, activeShieldKeys, activeCamoKeys) {
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
            const slot = getSlot(owner, r, c);
            if (!slot) continue;

            // Si ce slot est en cours d'animation, ne pas y toucher
            const slotKey = `${owner}-${r}-${c}`;
            if (animatingSlots.has(slotKey)) {
                continue;
            }
            const card = field[r][c];
            // Purge des overrides poison stale quand le contenu du slot change.
            if (typeof poisonHpOverrides !== 'undefined') {
                const poisonOvPre = poisonHpOverrides.get(slotKey);
                if (poisonOvPre) {
                    const cardUid = card?.uid || null;
                    const ovAge = typeof poisonOvPre.updatedAt === 'number' ? (Date.now() - poisonOvPre.updatedAt) : 0;
                    const staleByUid = !!(poisonOvPre.uid && cardUid && poisonOvPre.uid !== cardUid);
                    const staleByMissingCard = !card;
                    const staleByTimeout = ovAge > 6000;
                    if (staleByUid || staleByMissingCard || staleByTimeout) {
                        poisonHpOverrides.delete(slotKey);
                    }
                }
            }
            const existingCardEl = slot.querySelector('.card');
            const existingUid = existingCardEl?.dataset?.uid;
            const existingName = existingCardEl?.querySelector('.arena-name')?.textContent || existingCardEl?.querySelector('.img-name')?.textContent || '?';

            // Fast path : mÃªme carte (uid identique), mettre Ã  jour seulement les stats et Ã©tats
            if (card && existingCardEl && existingUid && existingUid === card.uid) {
                const isRadjawak = typeof card.name === 'string' && card.name.toLowerCase().includes('radjawak');

                // Debug: log pour Vampire sordide

                // Mettre Ã  jour HP
                let hpVal = card.currentHp ?? card.hp;
                const hpEl = existingCardEl.querySelector('.arena-armor') || existingCardEl.querySelector('.arena-hp') || existingCardEl.querySelector('.img-hp');
                // Skip si poisonDamage anime ce slot (geler le HP prÃ©-poison)
                const poisonOv = typeof poisonHpOverrides !== 'undefined' && poisonHpOverrides.get(slotKey);
                if (poisonOv) {
                    const ovUidMismatch = !!(poisonOv.uid && card.uid && poisonOv.uid !== card.uid);
                    const ovAge = typeof poisonOv.updatedAt === 'number' ? (Date.now() - poisonOv.updatedAt) : 0;
                    const staleConsumed = poisonOv.consumed && ovAge > 2600;
                    if (ovUidMismatch || (poisonOv.consumed && hpVal <= poisonOv.hp) || staleConsumed) {
                        poisonHpOverrides.delete(slotKey);
                    } else {
                        hpVal = poisonOv.hp;
                    }
                }
                if (hpEl) {
                    // Avoid showing "0 HP" on-board just before a queued death/deathTransform animation.
                    if (state?.phase === 'resolution' && hpVal <= 0) {
                        const domHpPrev = parseInt(hpEl.textContent || '', 10);
                        hpVal = (Number.isFinite(domHpPrev) && domHpPrev > 0) ? domHpPrev : 1;
                    }
                    const hpStr = String(hpVal);
                    existingCardEl.dataset.stateHp = hpStr;
                    existingCardEl.dataset.stateHpSyncAt = String(Date.now());
                    const domHpNow = parseInt(hpEl.textContent || '', 10);
                    if (Number.isFinite(domHpNow) && domHpNow <= 0 && hpVal > 0) {
                        if (window.DEBUG_LOGS) console.log(`[HP-VIS-DBG] render-dom-zero uid=${card.uid || '-'} card=${card.name || '?'} slot=${slotKey} domHp=${domHpNow} stateHp=${hpVal} visualDmgHp=${existingCardEl.dataset.visualDmgHp ?? 'none'}`);
                    }
                    // Anti-flicker : si _applyVisualDamage a posÃ© un marqueur, ne pas Ã©craser
                    // avec un state stale (HP plus Ã©levÃ© = dÃ©gÃ¢ts pas encore dans le state)
                    const visualDmgHp = existingCardEl.dataset.visualDmgHp;
                    const visualDmgSetAt = parseInt(existingCardEl.dataset.visualDmgSetAt || '0', 10);
                    const visualDmgExpired = visualDmgHp !== undefined && visualDmgSetAt > 0 && (Date.now() - visualDmgSetAt > 1800);
                    if (visualDmgHp !== undefined && hpVal > parseInt(visualDmgHp) && !visualDmgExpired) {
                        // State stale  garder le visual damage
                        if (parseInt(visualDmgHp, 10) <= 0 && hpVal > 0) {
                            if (window.DEBUG_LOGS) console.log(`[HP-VIS-DBG] render-stale-keep uid=${card.uid || '-'} card=${card.name || '?'} slot=${slotKey} stateHp=${hpVal} visualDmgHp=${visualDmgHp} domHp=${hpEl.textContent}`);
                        }
                        if (isRadjawak) {
                            if (window.DEBUG_LOGS) console.log(`[RADJ-DBG] render-skip-stale card=${card.name} uid=${card.uid} slot=${slotKey} stateHp=${hpVal} visualDmgHp=${visualDmgHp} domHp=${hpEl.textContent}`);
                        }
                    } else {
                        // State a rattrapÃ© le visual damage (ou pas de marqueur)  appliquer
                        if (visualDmgHp !== undefined) delete existingCardEl.dataset.visualDmgHp;
                        if (existingCardEl.dataset.visualDmgSetAt !== undefined) delete existingCardEl.dataset.visualDmgSetAt;
                        if (isRadjawak) {
                            if (window.DEBUG_LOGS) console.log(`[RADJ-DBG] render-apply-hp card=${card.name} uid=${card.uid} slot=${slotKey} stateHp=${hpVal} visualDmgHp=${visualDmgHp ?? 'none'} domHpBefore=${hpEl.textContent} expired=${visualDmgExpired}`);
                        }
                        if (hpEl.textContent !== hpStr) {
                            hpEl.textContent = hpStr;
                        }
                        // Classes boosted/reduced (mÃªme noms que makeCard)  pas pour les bÃ¢timents
                        if (!card.isBuilding) {
                            const baseHp = card.baseHp ?? card.hp;
                            hpEl.classList.toggle('boosted', hpVal > baseHp);
                            hpEl.classList.toggle('reduced', hpVal < baseHp);
                        }
                    }
                }
                // Mettre Ã  jour ATK (pas pour les bÃ¢timents)
                // Skip si powerBuff anime ce slot (mise Ã  jour graduelle en cours)
                if (!card.isBuilding && !(typeof powerBuffAtkOverrides !== 'undefined' && powerBuffAtkOverrides.has(slotKey))) {
                    const atkEl = existingCardEl.querySelector('.arena-atk') || existingCardEl.querySelector('.img-atk');
                    if (atkEl) {
                        const atkStr = String(card.atk);
                        if (atkEl.textContent !== atkStr) atkEl.textContent = atkStr;
                        const baseAtk = card.baseAtk ?? card.atk;
                        atkEl.classList.toggle('boosted', card.atk > baseAtk);
                        atkEl.classList.toggle('reduced', card.atk < baseAtk);
                    }
                }
                // Mettre Ã  jour le texte Poison dynamique (poisonPerGraveyard)
                if (card.poisonPerGraveyard) {
                    const abilitiesEl = existingCardEl.querySelector('.arena-abilities');
                    if (abilitiesEl) {
                        const effectivePoison = card.poisonX || 1;
                        const basePoison = card.basePoisonX ?? 1;
                        const poisonClass = effectivePoison > basePoison ? ' class="boosted"' : '';
                        abilitiesEl.innerHTML = abilitiesEl.innerHTML.replace(
                            /Poison\s*(<span[^>]*>)?\d+(<\/span>)?/,
                            `Poison <span${poisonClass}>${effectivePoison}</span>`
                        );
                    }
                }
                // Rebind hover/click avec les donnÃ©es fraÃ®ches de la carte
                existingCardEl.onmouseenter = (e) => showCardPreview(card, e);
                existingCardEl.onclick = (e) => { e.stopPropagation(); showCardZoom(card); };
                // Mettre Ã  jour les classes d'Ã©tat sur la carte
                const isJustPlayed = card.turnsOnField === 0 && !card.canAttack;
                existingCardEl.classList.toggle('just-played', isJustPlayed);
                existingCardEl.classList.toggle('can-attack', !!card.canAttack);
                existingCardEl.classList.toggle('petrified', !!card.petrified);
                existingCardEl.classList.toggle('melody-locked', !!card.melodyLocked);
                // Gaze marker (Medusa)  propriÃ©tÃ© serveur : medusaGazeMarker
                const gazeCount = card.medusaGazeMarker || 0;
                let gazeMarker = existingCardEl.querySelector('.gaze-marker');
                if (gazeCount > 0 && !gazeMarker) {
                    gazeMarker = document.createElement('div');
                    gazeMarker.className = 'gaze-marker marker-pop';
                    gazeMarker.innerHTML = `<div class="gaze-border"></div><span class="gaze-count">${gazeCount}</span>`;
                    existingCardEl.appendChild(gazeMarker);
                } else if (gazeCount > 0 && gazeMarker) {
                    const countEl = gazeMarker.querySelector('.gaze-count');
                    if (countEl && countEl.textContent !== String(gazeCount)) {
                        countEl.textContent = gazeCount;
                        countEl.classList.remove('marker-bump');
                        void countEl.offsetWidth;
                        countEl.classList.add('marker-bump');
                    }
                } else if (gazeCount === 0 && gazeMarker) {
                    gazeMarker.remove();
                }
                // Poison marker  propriÃ©tÃ© serveur : poisonCounters
                const poisonCount = card.poisonCounters || 0;
                let poisonMarker = existingCardEl.querySelector('.poison-marker');
                if (poisonCount > 0 && !poisonMarker) {
                    poisonMarker = document.createElement('div');
                    poisonMarker.className = 'poison-marker marker-pop';
                    poisonMarker.innerHTML = `<div class="poison-border"></div><span class="poison-count">${poisonCount}</span>`;
                    existingCardEl.appendChild(poisonMarker);
                } else if (poisonCount > 0 && poisonMarker) {
                    const countEl = poisonMarker.querySelector('.poison-count');
                    if (countEl && countEl.textContent !== String(poisonCount)) {
                        countEl.textContent = poisonCount;
                        countEl.classList.remove('marker-bump');
                        void countEl.offsetWidth;
                        countEl.classList.add('marker-bump');
                    }
                } else if (poisonCount === 0 && poisonMarker) {
                    poisonMarker.remove();
                }
                // Entrave marker  propriÃ©tÃ© serveur : entraveCounters
                const entraveCount = card.entraveCounters || 0;
                let entraveMarker = existingCardEl.querySelector('.entrave-marker');
                if (entraveCount > 0 && !entraveMarker) {
                    entraveMarker = document.createElement('div');
                    entraveMarker.className = 'entrave-marker marker-pop';
                    entraveMarker.innerHTML = `<div class="entrave-border"></div><span class="entrave-count">${entraveCount}</span>`;
                    existingCardEl.appendChild(entraveMarker);
                } else if (entraveCount > 0 && entraveMarker) {
                    const countEl = entraveMarker.querySelector('.entrave-count');
                    if (countEl && countEl.textContent !== String(entraveCount)) {
                        countEl.textContent = entraveCount;
                        countEl.classList.remove('marker-bump');
                        void countEl.offsetWidth;
                        countEl.classList.add('marker-bump');
                    }
                } else if (entraveCount === 0 && entraveMarker) {
                    entraveMarker.remove();
                }
                // Buff marker (+1/+1)  propriÃ©tÃ© serveur : buffCounters
                const buffCount = card.buffCounters || 0;
                let buffMarker = existingCardEl.querySelector('.buff-marker');
                if (buffCount > 0 && !buffMarker) {
                    buffMarker = document.createElement('div');
                    buffMarker.className = 'buff-marker marker-pop';
                    buffMarker.innerHTML = `<span class="buff-count">${buffCount}</span>`;
                    existingCardEl.appendChild(buffMarker);
                } else if (buffCount > 0 && buffMarker) {
                    const countEl = buffMarker.querySelector('.buff-count');
                    if (countEl && countEl.textContent !== String(buffCount)) {
                        countEl.textContent = buffCount;
                        countEl.classList.remove('marker-bump');
                        void countEl.offsetWidth;
                        countEl.classList.add('marker-bump');
                    }
                } else if (buffCount === 0 && buffMarker) {
                    buffMarker.remove();
                }
                // Positionner les marqueurs verticalement (empilÃ©s sur le cÃ´tÃ© droit)
                const markerBase = card.isBuilding ? 40 : 2;
                let markerIdx = 0;
                if (gazeMarker && gazeCount > 0) gazeMarker.style.top = `${markerBase + markerIdx++ * 28}px`;
                if (poisonMarker && poisonCount > 0) poisonMarker.style.top = `${markerBase + markerIdx++ * 28}px`;
                if (entraveMarker && entraveCount > 0) entraveMarker.style.top = `${markerBase + markerIdx++ * 28}px`;
                if (buffMarker && buffCount > 0) buffMarker.style.top = `${markerBase + markerIdx++ * 28}px`;
                // Flying animation (sÃ©curitÃ©)
                if (card.type === 'creature' && card.abilities?.includes('fly')) {
                    if (!existingCardEl.classList.contains('flying-creature')) {
                        existingCardEl.classList.add('flying-creature');
                        slot.classList.add('has-flying');
                        startFlyingAnimation(existingCardEl);
                    }
                }
                // Protection / Camouflage VFX
                if (card.hasProtection) {
                    CombatVFX.registerShield(slotKey, existingCardEl);
                    if (activeShieldKeys) activeShieldKeys.add(slotKey);
                }
                if (card.hasCamouflage) {
                    CombatVFX.registerCamouflage(slotKey, existingCardEl);
                    if (activeCamoKeys) activeCamoKeys.add(slotKey);
                }
                // Custom drag pour redÃ©ploiement (fast path  rÃ©attacher si conditions remplies)
                if (owner === 'me' && !state.me.inDeployPhase && !card.isBuilding && !card.movedThisTurn && !card.melodyLocked && !card.petrified) {
                    if (!existingCardEl.dataset.draggable) {
                        existingCardEl.dataset.draggable = '1';
                        CustomDrag.makeDraggable(existingCardEl, {
                            source: 'field',
                            card: card,
                            row: r,
                            col: c,
                            owner: owner
                        });
                    }
                } else {
                    delete existingCardEl.dataset.draggable;
                }
                continue;
            }

            // Slow path : carte diffÃ©rente ou nouveau slot   recrÃ©er
            // DiffÃ©rer si la queue d'animation combat est active (makeCard DOM + PIXI GPU = lag)
            if (typeof isAnimating !== 'undefined' && isAnimating) {
                deferredSlots.add(slotKey);
                continue;
            }
            deferredSlots.delete(slotKey);
            const label = slot.querySelector('.slot-label');
            slot.innerHTML = '';
            if (label) slot.appendChild(label.cloneNode(true));

            slot.classList.remove('has-card');
            slot.classList.remove('has-flying');

            if (card) {
                slot.classList.add('has-card');
                const cardEl = makeCard(card, false);
                // Stocker le uid pour le fast path
                cardEl.dataset.uid = card.uid || '';

                // Ajouter l'effet de lÃ©vitation pour les crÃ©atures volantes
                if (card.type === 'creature' && card.abilities?.includes('fly')) {
                    cardEl.classList.add('flying-creature');
                    slot.classList.add('has-flying');
                    startFlyingAnimation(cardEl);
                } else {
                    slot.classList.remove('has-flying');
                }

                // Indicateur de bouclier (Protection)  PixiJS honeycomb
                if (card.hasProtection) {
                    CombatVFX.registerShield(slotKey, cardEl);
                    if (activeShieldKeys) activeShieldKeys.add(slotKey);
                }

                // Effet de camouflage (fumÃ©e PixiJS)  mÃªme z-index que Protection
                if (card.hasCamouflage) {
                    CombatVFX.registerCamouflage(slotKey, cardEl);
                    if (activeCamoKeys) activeCamoKeys.add(slotKey);
                }

                // Hover preview pour voir la carte en grand
                cardEl.onmouseenter = (e) => showCardPreview(card, e);
                cardEl.onmouseleave = hideCardPreview;
                cardEl.onmousemove = (e) => moveCardPreview(e);

                // Custom drag pour redÃ©ploiement (seulement mes cartes)
                if (owner === 'me' && !state.me.inDeployPhase && !card.isBuilding && !card.movedThisTurn && !card.melodyLocked && !card.petrified) {
                    CustomDrag.makeDraggable(cardEl, {
                        source: 'field',
                        card: card,
                        row: r,
                        col: c,
                        owner: owner
                    });
                }

                // Clic gauche = zoom sur la carte (pour toutes les cartes)
                cardEl.onclick = (e) => {
                    e.stopPropagation();
                    showCardZoom(card);
                };
                slot.appendChild(cardEl);
            }
        }
    }
}

// Auto-fit : rÃ©duit le font-size d'un .arena-name jusqu'Ã  ce que le texte tienne
function fitArenaName(el, _retries) {
    const parent = el.parentElement; // .arena-title
    if (!parent) return;
    const maxW = parent.clientWidth - 4; // marge pour -webkit-text-stroke 2px
    if (maxW <= 0) {
        // Parent pas encore layoutÃ© (ex: display:none)   rÃ©essayer (max 5 tentatives)
        const retryCount = (_retries || 0) + 1;
        if (retryCount > 5 || !el.isConnected) return;
        requestAnimationFrame(() => fitArenaName(el, retryCount));
        return;
    }
    // Si le nom a dÃ©jÃ  un inline fontSize (prÃ©-calculÃ©), ne pas toucher
    if (el.style.fontSize) return;
    // Mesurer la largeur naturelle
    el.style.overflow = 'visible';
    el.style.width = 'max-content';
    const textW = el.offsetWidth;
    el.style.overflow = '';
    el.style.width = '';
    if (textW <= maxW) return;
    // Calculer le ratio puis ajuster en une passe + vÃ©rification
    const originalSize = parseFloat(getComputedStyle(el).fontSize);
    const ratio = maxW / textW;
    let size = Math.floor(originalSize * ratio * 10) / 10;
    const minSize = originalSize * 0.35;
    if (size < minSize) size = minSize;
    el.style.fontSize = size + 'px';
    el.style.overflow = 'visible';
    el.style.width = 'max-content';
    while (el.offsetWidth > maxW && size > minSize) {
        size -= 0.3;
        el.style.fontSize = size + 'px';
    }
    el.style.overflow = '';
    el.style.width = '';
}

// Auto-fit : planifie un fitArenaName sur le nom d'un Ã©lÃ©ment carte
// Utilise requestAnimationFrame pour que Ã§a marche mÃªme si l'Ã©lÃ©ment n'est pas encore dans le DOM
function autoFitCardName(el) {
    requestAnimationFrame(() => {
        const nameEl = el.querySelector('.arena-name') || el.querySelector('.fa-name') || el.querySelector('.img-name') || el.querySelector('.card-name');
        if (nameEl) fitArenaName(nameEl);
    });
}

//  PrÃ©-calcul des tailles de nom de carte (Canvas 2D) 
// Mesure le texte via Canvas, indÃ©pendant du DOM/layout. Cache le rÃ©sultat.
const _nameFitCache = new Map();
let _measureCtx = null;

function getNameFitSize(name, hasFaction) {
    const key = hasFaction ? `F|${name}` : `N|${name}`;
    if (_nameFitCache.has(key)) return _nameFitCache.get(key);

    // VÃ©rifier que Bree Serif est chargÃ©e (sinon la mesure serait fausse)
    if (!document.fonts.check('9.6px "Bree Serif"')) return null;

    if (!_measureCtx) {
        _measureCtx = document.createElement('canvas').getContext('2d');
    }

    // Taille de base : 0.6em  16px (hÃ©ritÃ© body) = 9.6px
    const baseSize = 9.6;
    // Largeur dispo dans arena-title pour le texte :
    // Card: var(--card-w) = 144px, arena-title: left:2+right:2   140px
    // Faction : border 2px   136px inner, padding 6px2   124px texte
    // Sans faction : 140px, pas de padding
    // Marge pour -webkit-text-stroke 2px (dÃ©borde ~1px de chaque cÃ´tÃ©)
    const maxW = (hasFaction ? 124 : 140) - 4;

    _measureCtx.font = `${baseSize}px "Bree Serif", serif`;
    // letter-spacing: 0.2px n'est pas capturÃ© par Canvas   l'ajouter manuellement
    const textW = _measureCtx.measureText(name).width + (name.length - 1) * 0.2;

    if (textW <= maxW) {
        _nameFitCache.set(key, null);
        return null;
    }

    // RÃ©duire proportionnellement
    const ratio = maxW / textW;
    let size = Math.floor(baseSize * ratio * 10) / 10;
    const minSize = baseSize * 0.35;
    if (size < minSize) size = minSize;

    // VÃ©rifier avec la taille rÃ©duite (le ratio n'est pas parfaitement linÃ©aire)
    _measureCtx.font = `${size}px "Bree Serif", serif`;
    while (_measureCtx.measureText(name).width + (name.length - 1) * 0.2 > maxW && size > minSize) {
        size -= 0.3;
        _measureCtx.font = `${size}px "Bree Serif", serif`;
    }

    const result = size + 'px';
    _nameFitCache.set(key, result);
    return result;
}

// Preview flottante d'une carte
let previewEl = null;
// Descriptions des capacitÃ©s
const ABILITY_DESCRIPTIONS = {
    fly: { name: 'Vol', desc: 'Cette crÃ©ature peut attaquer n\'importe quel emplacement adverse, pas seulement celui en face.' },
    shooter: { name: 'Tireur', desc: 'Cette crÃ©ature peut attaquer Ã  distance sans recevoir de riposte.' },
    haste: { name: 'CÃ©lÃ©ritÃ©', desc: 'Cette crÃ©ature peut attaquer dÃ¨s le tour oÃ¹ elle est invoquÃ©e.' },
    superhaste: { name: 'SupercÃ©lÃ©ritÃ©', desc: 'Cette crÃ©ature peut attaquer dÃ¨s le tour oÃ¹ elle est invoquÃ©e et peut se dÃ©placer et attaquer dans le mÃªme tour.' },
    intangible: { name: 'Intangible', desc: 'Cette crÃ©ature ne peut pas Ãªtre ciblÃ©e par les sorts ou les piÃ¨ges.' },
    trample: { name: 'PiÃ©tinement', desc: 'Les dÃ©gÃ¢ts excÃ©dentaires sont infligÃ©s au hÃ©ros adverse.' },

    power: { name: 'Puissance', desc: 'Quand cette crÃ©ature subit des dÃ©gÃ¢ts sans mourir, elle gagne +X ATK (X = valeur de Puissance).' },
    cleave: { name: 'Clivant', desc: 'Quand cette crÃ©ature attaque, elle inflige X dÃ©gÃ¢ts aux crÃ©atures sur les lignes adjacentes. Ces crÃ©atures ne ripostent pas.' },
    immovable: { name: 'Immobile', desc: 'Cette crÃ©ature ne peut pas se dÃ©placer.' },
    provocation: { name: 'Provocation', desc: 'Tant qu\'une crÃ©ature adverse avec Provocation est en jeu, vos crÃ©atures mÃªlÃ©e et tireur doivent Ãªtre posÃ©es en prioritÃ© en face d\'elle.' },
    wall: { name: 'Mur', desc: 'Cette crÃ©ature ne peut pas attaquer.' },
    regeneration: { name: 'RÃ©gÃ©nÃ©ration', desc: 'En fin de tour, cette crÃ©ature rÃ©cupÃ¨re X PV (sans dÃ©passer ses PV max).' },
    protection: { name: 'Protection', desc: 'Cette crÃ©ature est protÃ©gÃ©e contre la prochaine source de dÃ©gÃ¢ts qu\'elle subirait. Le bouclier est consommÃ© aprÃ¨s avoir bloquÃ© une source.' },
    spellBoost: { name: 'Sort renforcÃ©', desc: 'Tant que cette crÃ©ature est en jeu, vos sorts infligent +X dÃ©gÃ¢ts supplÃ©mentaires.' },
    enhance: { name: 'AmÃ©lioration', desc: 'Les crÃ©atures adjacentes (haut, bas, cÃ´tÃ©) gagnent +X en attaque tant que cette crÃ©ature est en jeu.' },
    bloodthirst: { name: 'Soif de sang', desc: 'Chaque fois qu\'une crÃ©ature ennemie meurt, cette crÃ©ature gagne +X ATK de faÃ§on permanente.' },
    melody: { name: 'MÃ©lodie', desc: 'La premiÃ¨re crÃ©ature ennemie en face ne peut ni attaquer ni se dÃ©placer. AprÃ¨s 2 tours, elle se transforme en pierre.' },
    sacrifice: { name: 'Sacrifice', desc: 'Ã€ l\'invocation, sacrifie une crÃ©ature adjacente pouvant attaquer.' },
    camouflage: { name: 'Camouflage', desc: 'Cette crÃ©ature ne peut pas Ãªtre ciblÃ©e par les attaques ni les sorts. Les attaquants l\'ignorent et frappent derriÃ¨re. Se dissipe au dÃ©but du prochain tour.' },
    lethal: { name: 'Toucher mortel', desc: 'Si cette crÃ©ature inflige des dÃ©gÃ¢ts Ã  une crÃ©ature, elle la tue instantanÃ©ment.' },
    entrave: { name: 'Entrave', desc: 'Quand cette crÃ©ature inflige des blessures de combat, elle met X marqueur(s) Entrave sur la cible. -1 ATK par marqueur (plancher 0).' },
    lifelink: { name: 'Lien vital', desc: 'Quand cette crÃ©ature inflige des blessures de combat, votre hÃ©ros se soigne de X PV (plafonnÃ© Ã  20 PV).' },
    lifedrain: { name: 'Drain de vie', desc: 'Quand cette crÃ©ature inflige des blessures de combat, elle se soigne de X PV (plafonnÃ© aux PV max).' },
    antitoxin: { name: 'Antitoxine', desc: 'Cette crÃ©ature ne subit pas de dÃ©gÃ¢ts de poison.' },
    unsacrificable: { name: 'Non sacrifiable', desc: 'Cette crÃ©ature ne peut pas Ãªtre sacrifiÃ©e.' }
};

function showCardPreview(card, e) {
    hideCardPreview();
    
    // CrÃ©er le container
    previewEl = document.createElement('div');
    previewEl.className = 'preview-container card-preview';
    
    // Ajouter la carte (version complÃ¨te avec tous les dÃ©tails)
    const cardEl = makeCard(card, true);
    cardEl.classList.add('preview-card');
    previewEl.appendChild(cardEl);

    // Container pour capacitÃ©s + effets
    const infoContainer = document.createElement('div');
    infoContainer.className = 'preview-info-container';
    
    // Ajouter les capacitÃ©s si c'est une crÃ©ature avec des abilities ou sacrifice
    const hasAbilities = card.type === 'creature' && ((card.abilities && card.abilities.length > 0) || card.sacrifice);
    if (hasAbilities) {
        const abilitiesContainer = document.createElement('div');
        abilitiesContainer.className = 'preview-abilities';

        (card.abilities || []).forEach(ability => {
            const abilityInfo = ABILITY_DESCRIPTIONS[ability];
            if (abilityInfo) {
                const abilityEl = document.createElement('div');
                abilityEl.className = 'preview-ability';
                // Type de combat (shooter/fly) en blanc, capacitÃ©s communes en jaune
                const isTypeAbility = ability === 'shooter' || ability === 'fly';
                abilityEl.innerHTML = `
                    <div class="ability-name ${isTypeAbility ? 'type-ability' : ''}">${abilityInfo.name}</div>
                    <div class="ability-desc">${abilityInfo.desc}</div>
                `;
                abilitiesContainer.appendChild(abilityEl);
            }
        });

        if (card.sacrifice) {
            const abilityInfo = ABILITY_DESCRIPTIONS.sacrifice;
            const abilityEl = document.createElement('div');
            abilityEl.className = 'preview-ability';
            abilityEl.innerHTML = `
                <div class="ability-name">${abilityInfo.name} ${card.sacrifice}</div>
                <div class="ability-desc">${abilityInfo.desc}</div>
            `;
            abilitiesContainer.appendChild(abilityEl);
        }

        infoContainer.appendChild(abilitiesContainer);
    }
    
    // Ajouter les effets appliquÃ©s (sorts) si prÃ©sents
    if (card.appliedEffects && card.appliedEffects.length > 0) {
        const effectsContainer = document.createElement('div');
        effectsContainer.className = 'preview-effects';
        
        card.appliedEffects.forEach(effect => {
            const effectEl = document.createElement('div');
            effectEl.className = 'preview-effect';
            effectEl.innerHTML = `
                <div class="effect-name">${effect.name}</div>
                <div class="effect-desc">${effect.description}</div>
            `;
            effectsContainer.appendChild(effectEl);
        });
        
        infoContainer.appendChild(effectsContainer);
    }
    
    if (infoContainer.children.length > 0) {
        previewEl.appendChild(infoContainer);
    }

    document.body.appendChild(previewEl);

    // Auto-fit du nom (aprÃ¨s insertion dans le DOM pour mesurer)
    const previewNameEl = cardEl.querySelector('.arena-name');
    if (previewNameEl) fitArenaName(previewNameEl);

    const el = previewEl; // Garder une rÃ©fÃ©rence locale
    requestAnimationFrame(() => {
        if (el && el.parentNode) el.classList.add('visible');
    });
}

function showCardBackPreview() {
    hideCardPreview();
    previewEl = document.createElement('div');
    previewEl.className = 'card-back-preview card-preview';
    document.body.appendChild(previewEl);
    const el = previewEl; // Garder une rÃ©fÃ©rence locale
    requestAnimationFrame(() => {
        if (el && el.parentNode) el.classList.add('visible');
    });
}

function makeHeroCard(hero, hp) {
    const faction = hero.faction || 'neutral';
    const rarityMap = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'mythic', 5: 'platinum' };
    const rarityClass = rarityMap[hero.edition] || 'common';
    const rarityDiamond = `<div class="arena-edition"><div class="rarity-icon ${rarityClass}"><div class="inner-shape"></div></div></div>`;
    const el = document.createElement('div');
    el.className = `card creature arena-style faction-${faction}`;
    el.style.backgroundImage = `url('/cards/${hero.image}')`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';

    el.innerHTML = `
        <div class="arena-title"><div class="arena-name">${hero.name}</div></div>
        <div class="arena-hero-hp">
            <div class="arena-hero-hp-border">
                <div class="arena-hero-hp-inner">
                    <span class="arena-hero-hp-number">${hp}</span>
                </div>
            </div>
        </div>
        <div class="arena-text-zone">
            <div class="arena-type">HÃ©ros</div>
            <div class="arena-special">${hero.ability}</div>
        </div>
        ${rarityDiamond}`;

    autoFitCardName(el);
    return el;
}

function showHeroPreview(hero, hp) {
    if (!hero) {
        hero = window.heroData?.me || window.heroData?.opp;
    }
    if (!hp) {
        hp = state?.me?.hp || state?.opponent?.hp || 20;
    }

    hideCardPreview();
    previewEl = document.createElement('div');
    previewEl.className = 'hero-preview';

    if (hero && hero.image) {
        const cardEl = makeHeroCard(hero, hp);
        previewEl.appendChild(cardEl);
    } else {
        previewEl.innerHTML = `<div class="hero-preview-name">${hero ? hero.name : 'HÃ©ros'}</div>`;
    }
    document.body.appendChild(previewEl);
    const el = previewEl;
    requestAnimationFrame(() => {
        if (el && el.parentNode) {
            el.classList.add('visible');
        }
    });
}

function showHeroDetail(hero, hp) {
    if (!hero) {
        hero = window.heroData?.me || window.heroData?.opp;
        if (!hero) return;
    }
    if (!hp) {
        hp = state?.me?.hp || state?.opponent?.hp || 20;
    }

    const overlay = document.getElementById('card-zoom-overlay');
    const container = document.getElementById('card-zoom-container');

    container.innerHTML = '';
    const cardEl = makeHeroCard(hero, hp);
    container.appendChild(cardEl);

    // Bouton oeil pour toggle art-only (comme les crÃ©atures)
    if (hero.image) {
        const eyeBtn = document.createElement('div');
        eyeBtn.className = 'zoom-art-toggle';
        eyeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        eyeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cardEl.classList.toggle('art-only');
            eyeBtn.classList.toggle('active');
        });
        container.appendChild(eyeBtn);
    }

    zoomCardData = hero;
    overlay.classList.remove('hidden');

    // Auto-fit du nom
    const zoomNameEl = cardEl.querySelector('.arena-name');
    if (zoomNameEl) fitArenaName(zoomNameEl);
}

function moveCardPreview(e) {
    // Plus besoin de suivre la souris - position fixe
}
function hideCardPreview() {
    if (previewEl) {
        previewEl.remove();
        previewEl = null;
    }
}

function renderTraps() {
    state.me.traps.forEach((trap, i) => {
        const slot = getTrapSlot('me', i);
        if (slot) {
            const trapKey = `me-${i}`;
            const isProtected = animatingTrapSlots.has(trapKey);
            if (isProtected) {
                if (!trap) {
                    animatingTrapSlots.delete(trapKey);
                } else {
                    return;
                }
            }
            // Fast path : si l'Ã©tat du trap n'a pas changÃ©, ne rien faire
            const hadTrap = slot.dataset.trapState === '1';
            const hasTrap = !!trap;
            if (hadTrap === hasTrap) return;

            slot.classList.remove('has-trap', 'mine', 'triggered');
            if (trap) {
                slot.dataset.trapState = '1';
                slot.classList.add('has-trap', 'mine');
                slot.innerHTML = '<img class="trap-icon-img mine" src="/battlefield_elements/beartraparmed.png" alt="trap">';
                const trapCard = state.me.trapCards ? state.me.trapCards[i] : null;
                if (trapCard) {
                    slot.onmouseenter = (e) => showCardPreview(trapCard, e);
                    slot.onmouseleave = hideCardPreview;
                    slot.onmousemove = (e) => moveCardPreview(e);
                }
            } else {
                delete slot.dataset.trapState;
                slot.innerHTML = '';
                slot.onmouseenter = null;
                slot.onmouseleave = null;
                slot.onmousemove = null;
            }
        }
    });

    state.opponent.traps.forEach((trap, i) => {
        const slot = getTrapSlot('opp', i);
        if (slot) {
            const trapKey = `opp-${i}`;
            const isProtected = animatingTrapSlots.has(trapKey);
            if (isProtected) {
                if (!trap) {
                    animatingTrapSlots.delete(trapKey);
                } else {
                    return;
                }
            }
            // Fast path : si l'Ã©tat du trap n'a pas changÃ©, ne rien faire
            const hadTrap = slot.dataset.trapState === '1';
            const hasTrap = !!trap;
            if (hadTrap === hasTrap) return;

            slot.classList.remove('has-trap', 'mine', 'triggered');
            if (trap) {
                slot.dataset.trapState = '1';
                slot.classList.add('has-trap');
                slot.innerHTML = '<img class="trap-icon-img enemy" src="/battlefield_elements/beartraparmed.png" alt="trap">';
            } else {
                delete slot.dataset.trapState;
                slot.innerHTML = '';
            }
        }
    });
}

// Signature de la derniÃ¨re main rendue (pour le fast path)
let _lastHandSig = '';
let _lastCommittedSig = '';
let _lastHandPhase = '';

function _computeHandSig(hand) {
    return hand.map(c => c.uid || c.id).join(',');
}
function _computeCommittedSig() {
    return committedSpells.map(cs => cs.commitId).join(',');
}

// Fast path : met Ã  jour les classes playable/coÃ»t sur les cartes existantes sans recrÃ©er le DOM
function _updateHandInPlace(panel, hand, energy) {
    const isHyrule = state.me.hero && state.me.hero.id === 'hyrule';
    const spellsCast = state.me.spellsCastThisTurn || 0;
    const hasHyruleDiscount = isHyrule && spellsCast === 1 && state.phase === 'planning';
    const totalPoisonCounters = state.me.totalPoisonCounters || 0;
    const canPlayNow = canPlay();
    const existingCards = panel.querySelectorAll('.card:not(.committed-spell)');

    for (let i = 0; i < hand.length && i < existingCards.length; i++) {
        const card = hand[i];
        const el = existingCards[i];

        // Recalculer le coÃ»t effectif
        let effectiveCost = card.cost;
        if (hasHyruleDiscount && card.type === 'spell') {
            effectiveCost = Math.max(0, card.cost - 1);
        }
        if (card.poisonCostReduction && totalPoisonCounters > 0) {
            effectiveCost = Math.max(0, effectiveCost - totalPoisonCounters);
        }

        // Mettre Ã  jour le coÃ»t affichÃ© et la classe discounted
        const isDiscounted = effectiveCost < card.cost;
        const costEl = el.querySelector('.arena-mana') || el.querySelector('.img-cost');
        if (costEl) {
            if (parseInt(el.dataset.cost) !== effectiveCost) costEl.textContent = effectiveCost;
            costEl.classList.toggle('discounted', isDiscounted);
        }
        el.dataset.cost = effectiveCost;

        // DÃ©terminer playable
        let playable = effectiveCost <= energy && canPlayNow;
        if (playable && (card.type === 'creature' || card.type === 'trap') && getValidSlots(card).length === 0) {
            playable = false;
        }
        if (playable && card.requiresGraveyardCreatures) {
            const graveyardCreatures = (state.me.graveyard || []).filter(c => c.type === 'creature').length;
            if (graveyardCreatures < card.requiresGraveyardCreatures) playable = false;
        }
        if (playable && card.requiresGraveyardCreature) {
            const availableCreatures = (state.me.graveyard || []).filter(c =>
                c.type === 'creature' && !committedGraveyardUids.includes(c.uid || c.id)
            );
            if (availableCreatures.length === 0) playable = false;
        }
        if (playable && card.sacrifice && getValidSlots(card).length === 0) playable = false;
        if (playable && card.targetSelfCreature) {
            const hasCreature = state.me.field.some(row => row.some(c => c !== null));
            if (!hasCreature) playable = false;
        }

        el.classList.toggle('playable', playable);

        // Mettre Ã  jour les donnÃ©es de drag (tooExpensive / effectiveCost)
        if (el._dragData) {
            el._dragData.tooExpensive = !playable;
            el._dragData.effectiveCost = effectiveCost;
        }

        // Mettre Ã  jour le texte Poison dynamique (poisonPerGraveyard)
        if (card.poisonPerGraveyard) {
            const abilitiesEl = el.querySelector('.arena-abilities');
            if (abilitiesEl) {
                const effectivePoison = card.poisonX || 1;
                const basePoison = card.basePoisonX ?? 1;
                const poisonClass = effectivePoison > basePoison ? ' class="boosted"' : '';
                abilitiesEl.innerHTML = abilitiesEl.innerHTML.replace(
                    /Poison\s*(<span[^>]*>)?\d+(<\/span>)?/,
                    `Poison <span${poisonClass}>${effectivePoison}</span>`
                );
            }
        }

        // Visibility pour animations de pioche (fallback UID si index dÃ©calÃ©)
        const shouldHideByIndex = typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('me', i);
        const shouldHideByUid = typeof GameAnimations !== 'undefined'
            && typeof GameAnimations.shouldHideCardByUid === 'function'
            && GameAnimations.shouldHideCardByUid('me', card.uid || card.id);
        if (shouldHideByIndex || shouldHideByUid) {
            el.style.visibility = 'hidden';
        } else {
            el.style.visibility = '';
        }

        // Rebind hover/click avec les donnÃ©es fraÃ®ches
        el.onmouseenter = (e) => showCardPreview(card, e);
        el.onclick = (e) => { e.stopPropagation(); showCardZoom(card); };
    }
}

function renderHand(hand, energy) {
    const panel = document.getElementById('my-hand');

    //  Fast path : mÃªme main, mÃªmes committed spells, mÃªme phase   mise Ã  jour in-place 
    const handSig = _computeHandSig(hand);
    const committedSig = _computeCommittedSig();
    const currentPhase = state?.phase || '';
    if (handSig === _lastHandSig && committedSig === _lastCommittedSig && currentPhase === _lastHandPhase && handCardRemovedIndex < 0) {
        _updateHandInPlace(panel, hand, energy);
        return;
    }
    _lastHandSig = handSig;
    _lastCommittedSig = committedSig;
    _lastHandPhase = currentPhase;

    //  Slow path : rÃ©conciliation (rÃ©utilise les Ã©lÃ©ments existants pour prÃ©server les glow) 

    // FLIP step 1 : snapshot des positions par UID avant de modifier le DOM
    // Fonctionne pour les retraits joueur (drag) ET serveur (rÃ©solution de sorts)
    const oldPosByUid = {};
    const oldCommittedPositions = {};
    const oldCards = panel.querySelectorAll('.card:not(.committed-spell)');
    oldCards.forEach(card => {
        const uid = card.dataset.uid;
        if (uid) {
            oldPosByUid[uid] = card.getBoundingClientRect().left;
        }
    });
    const oldCommitted = panel.querySelectorAll('.committed-spell');
    oldCommitted.forEach(card => {
        const commitId = card.dataset.commitId;
        oldCommittedPositions[commitId] = card.getBoundingClientRect().left;
    });
    // Reset le flag de retrait (utilisÃ© uniquement pour le tracking, pas pour le FLIP)
    if (handCardRemovedIndex >= 0) handCardRemovedIndex = -1;

    // Indexer les Ã©lÃ©ments existants par UID pour rÃ©utilisation
    const existingByUid = new Map();
    oldCards.forEach(el => {
        const uid = el.dataset.uid;
        if (uid) existingByUid.set(uid, el);
    });

    // Retirer les committed spells (seront re-insÃ©rÃ©s aprÃ¨s)
    oldCommitted.forEach(el => el.remove());

    // VÃ©rifier si Hyrule peut rÃ©duire le coÃ»t du 2Ã¨me sort (uniquement en phase planning)
    const isHyrule = state.me.hero && state.me.hero.id === 'hyrule';
    const spellsCast = state.me.spellsCastThisTurn || 0;
    const hasHyruleDiscount = isHyrule && spellsCast === 1 && state.phase === 'planning';

    // Compter les marqueurs poison en jeu pour la rÃ©duction de coÃ»t (Reine toxique)
    const totalPoisonCounters = state.me.totalPoisonCounters || 0;

    // UIDs qu'on va garder (pour savoir quoi supprimer aprÃ¨s)
    const keptUids = new Set();

    hand.forEach((card, i) => {
        // Calculer le coÃ»t effectif pour les sorts avec Hyrule
        let effectiveCost = card.cost;
        let hasDiscount = false;
        if (hasHyruleDiscount && card.type === 'spell') {
            effectiveCost = Math.max(0, card.cost - 1);
            hasDiscount = true;
        }
        // RÃ©duction de coÃ»t par marqueurs poison (Reine toxique)
        if (card.poisonCostReduction && totalPoisonCounters > 0) {
            effectiveCost = Math.max(0, effectiveCost - totalPoisonCounters);
            hasDiscount = true;
        }

        const uid = card.uid || card.id || '';
        let el = existingByUid.get(uid);
        let isNew = false;

        if (el) {
            // RÃ©utiliser l'Ã©lÃ©ment existant (prÃ©serve le glow canvas)
            keptUids.add(uid);
            // Mettre Ã  jour le coÃ»t affichÃ© et la classe discounted
            const isDiscounted = effectiveCost < card.cost;
            const costEl = el.querySelector('.arena-mana') || el.querySelector('.img-cost');
            if (costEl) {
                costEl.textContent = effectiveCost;
                costEl.classList.toggle('discounted', isDiscounted);
            }
        } else {
            // Nouvelle carte : crÃ©er depuis zÃ©ro
            el = makeCard(card, true, effectiveCost < card.cost ? effectiveCost : null);
            isNew = true;
        }

        el.dataset.idx = i;
        el.dataset.uid = uid;
        el.dataset.cost = effectiveCost;

        // Marquer comme jouable si : assez de mana + phase planning + pas encore validÃ© le tour
        el.classList.remove('playable');
        if (effectiveCost <= energy && canPlay()) {
            el.classList.add('playable');
        }

        // Retirer playable si aucun slot libre sur le board (crÃ©atures et piÃ¨ges)
        if ((card.type === 'creature' || card.type === 'trap') && getValidSlots(card).length === 0) {
            el.classList.remove('playable');
        }

        // Z-index incrÃ©mental pour Ã©viter les saccades au hover
        el.style.zIndex = i + 1;

        // Cacher si animation de pioche en attente (index/uid) OU pendingBounce sur la derniÃ¨re carte
        const isPBTarget = pendingBounce && pendingBounce.owner === 'me' && i === hand.length - 1;
        const shouldHideByIndex = typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('me', i);
        const shouldHideByUid = typeof GameAnimations !== 'undefined'
            && typeof GameAnimations.shouldHideCardByUid === 'function'
            && GameAnimations.shouldHideCardByUid('me', uid);
        if (shouldHideByIndex || shouldHideByUid || isPBTarget) {
            el.style.visibility = 'hidden';
        } else {
            el.style.visibility = '';
        }

        // VÃ©rifier les conditions d'invocation spÃ©ciales (ex: Kraken Colossal)
        let cantSummon = false;
        if (card.requiresGraveyardCreatures) {
            const graveyardCreatures = (state.me.graveyard || []).filter(c => c.type === 'creature').length;
            if (graveyardCreatures < card.requiresGraveyardCreatures) {
                cantSummon = true;
                el.classList.remove('playable');
            }
        }
        // RÃ©animation : nÃ©cessite au moins 1 crÃ©ature non-engagÃ©e au cimetiÃ¨re
        if (card.requiresGraveyardCreature) {
            const availableCreatures = (state.me.graveyard || []).filter(c =>
                c.type === 'creature' && !committedGraveyardUids.includes(c.uid || c.id)
            );
            if (availableCreatures.length === 0) {
                cantSummon = true;
                el.classList.remove('playable');
            }
        }
        // Sacrifice : nÃ©cessite au moins 1 slot vide adjacent Ã  une crÃ©ature sacrifiable
        if (card.sacrifice) {
            const validSlots = getValidSlots(card);
            if (validSlots.length === 0) {
                cantSummon = true;
                el.classList.remove('playable');
            }
        }
        // Sort ciblant une crÃ©ature alliÃ©e : nÃ©cessite au moins 1 crÃ©ature sur le terrain
        if (card.targetSelfCreature) {
            const hasCreature = state.me.field.some(row => row.some(c => c !== null));
            if (!hasCreature) {
                cantSummon = true;
                el.classList.remove('playable');
            }
        }

        // Custom drag
        const tooExpensive = effectiveCost > energy || cantSummon;
        CustomDrag.makeDraggable(el, {
            source: 'hand',
            card: card,
            idx: i,
            effectiveCost: effectiveCost,
            tooExpensive: tooExpensive
        });

        // Preview au survol
        el.onmouseenter = (e) => showCardPreview(card, e);
        el.onmouseleave = hideCardPreview;

        // Clic gauche = zoom sur la carte
        el.onclick = (e) => {
            e.stopPropagation();
            showCardZoom(card);
        };

        // appendChild dÃ©place un Ã©lÃ©ment existant ou ajoute un nouveau
        panel.appendChild(el);

    });

    // Supprimer les cartes qui ne sont plus dans la main
    existingByUid.forEach((el, uid) => {
        if (!keptUids.has(uid)) {
            el.remove();
        }
    });

    // Sorts engagÃ©s : toujours afficher Ã  leur position d'origine dans la main.
    // animateSpell les retire un par un du DOM quand ils sont jouÃ©s.
    // L'insertion par insertBefore garantit qu'ils restent en place mÃªme quand des tokens arrivent.
    if (committedSpells.length > 0) {
        // Calculer les indices d'origine (les sorts sont retirÃ©s de la main un par un,
        // donc chaque handIndex est relatif Ã  la main rÃ©duite  on reconstruit la position absolue)
        const origIndices = [];
        for (let i = 0; i < committedSpells.length; i++) {
            let origIdx = committedSpells[i].handIndex;
            if (origIdx < 0) { origIdx = hand.length + i; } // fallback : fin de main
            // Trier les positions absolues prÃ©cÃ©dentes en ordre croissant
            // pour que chaque incrÃ©ment soit vÃ©rifiÃ© contre les suivants
            const sorted = origIndices.slice().sort((a, b) => a - b);
            for (const prev of sorted) {
                if (prev <= origIdx) origIdx++;
                else break;
            }
            origIndices.push(origIdx);
        }

        // Trier par position d'origine pour insÃ©rer dans l'ordre
        const indexed = committedSpells.map((cs, i) => ({ cs, csIdx: i, origIdx: origIndices[i] }));
        indexed.sort((a, b) => a.origIdx - b.origIdx);

        for (const { cs, csIdx, origIdx } of indexed) {
            const el = makeCard(cs.card, false);
            el.classList.add('committed-spell');
            el.dataset.commitId = cs.commitId;
            el.dataset.cardId = cs.card.id;
            el.dataset.order = cs.order;

            el.onmouseenter = (e) => {
                showCardPreview(cs.card, e);
                highlightCommittedSpellTargets(cs);
            };
            el.onmouseleave = () => {
                hideCardPreview();
                clearCommittedSpellHighlights();
            };
            el.onclick = (e) => {
                e.stopPropagation();
                showCardZoom(cs.card);
            };

            // InsÃ©rer Ã  la position d'origine (pas Ã  la fin)
            const children = panel.children;
            if (origIdx < children.length) {
                panel.insertBefore(el, children[origIdx]);
            } else {
                panel.appendChild(el);
            }
        }
    }

    // RÃ©indexer toute la main aprÃ¨s insertion des committed spells.
    // Sans Ã§a, les committed gardent un z-index bas et passent derriÃ¨re les cartes voisines.
    const handChildren = panel.querySelectorAll('.card');
    handChildren.forEach((el, i) => {
        el.style.zIndex = i + 1;
    });

    // Bounce : cacher la derniÃ¨re carte si un bounce est en attente
    if (pendingBounce && pendingBounce.owner === 'me') {
        if (pendingBounce.completed) {
            // Animation terminÃ©e  rÃ©vÃ©ler la derniÃ¨re carte et cleanup
            const allCards = panel.querySelectorAll('.card:not(.committed-spell)');
            const last = allCards[allCards.length - 1];
            if (last) {
                last.style.visibility = '';
                last.style.transition = 'none';
            }
            const wrapper = pendingBounce.wrapper;
            pendingBounce = null;
            revealBounceTargetWithBridge(panel, '.card:not(.committed-spell)', wrapper);
        } else {
            const allCards = panel.querySelectorAll('.card:not(.committed-spell)');
            checkPendingBounce('me', allCards);
        }
    }

    // FLIP step 2 : animer les cartes restantes de l'ancienne position vers la nouvelle
    const hasOldPositions = Object.keys(oldPosByUid).length > 0 || Object.keys(oldCommittedPositions).length > 0;
    if (hasOldPositions) {
        const newCards = panel.querySelectorAll('.card:not(.committed-spell)');
        const newCommitted = panel.querySelectorAll('.committed-spell');
        const toAnimate = [];
        // Batch : poser tous les transforms d'un coup (sans transition)
        // Cartes normales  matching par UID
        newCards.forEach(card => {
            const uid = card.dataset.uid;
            if (uid && oldPosByUid[uid] !== undefined) {
                const dx = oldPosByUid[uid] - card.getBoundingClientRect().left;
                if (Math.abs(dx) > 1) {
                    card.style.transition = 'none';
                    card.style.transform = `translateX(${dx}px)`;
                    toAnimate.push(card);
                }
            }
        });
        // Sorts engagÃ©s (par commitId)
        newCommitted.forEach(card => {
            const commitId = card.dataset.commitId;
            if (oldCommittedPositions[commitId] !== undefined) {
                const dx = oldCommittedPositions[commitId] - card.getBoundingClientRect().left;
                if (Math.abs(dx) > 1) {
                    card.style.transition = 'none';
                    card.style.transform = `translateX(${dx}px)`;
                    toAnimate.push(card);
                }
            }
        });

        if (toAnimate.length > 0) {
            // Un seul reflow pour tout le batch
            panel.getBoundingClientRect();
            // Double rAF : garantit que le navigateur peint l'ancienne position
            // avant de lancer la transition vers la nouvelle
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    toAnimate.forEach(card => {
                        card.style.transition = 'transform 0.35s ease-out';
                        card.style.transform = '';
                    });
                    setTimeout(() => {
                        toAnimate.forEach(card => { card.style.transition = ''; });
                    }, 380);
                });
            });
        }
    }
}

function highlightCommittedSpellTargets(cs) {
    clearCommittedSpellHighlights();
    if (cs.targetType === 'hero') {
        const heroOwner = cs.targetPlayer === myNum ? 'me' : 'opp';
        const heroEl = document.getElementById(`hero-${heroOwner}`);
        if (heroEl) heroEl.classList.add('committed-target-highlight');
    } else if (cs.targetType === 'global') {
        const targetSide = cs.card.pattern === 'all' ? null : 'opp';
        document.querySelectorAll('.card-slot').forEach(slot => {
            if (!targetSide || slot.dataset.owner === targetSide) {
                slot.classList.add('cross-target');
                const card = slot.querySelector('.card');
                if (card) card.classList.add('spell-hover-target');
            }
        });
    } else if (cs.targetType === 'field') {
        const owner = cs.targetPlayer === myNum ? 'me' : 'opp';
        if (cs.card.pattern === 'cross') {
            previewCrossTargets(owner, cs.row, cs.col);
        } else {
            const slot = getSlot(owner, cs.row, cs.col);
            if (slot) {
                slot.classList.add('cross-target');
                const card = slot.querySelector('.card');
                if (card) card.classList.add('spell-hover-target');
            }
        }
    }
}

function clearCommittedSpellHighlights() {
    document.querySelectorAll('.committed-target-highlight').forEach(el => {
        el.classList.remove('committed-target-highlight');
    });
    document.querySelectorAll('.card-slot.cross-target').forEach(s => {
        s.classList.remove('cross-target');
        const card = s.querySelector('.card');
        if (card) card.classList.remove('spell-hover-target');
    });
}

function createOppHandCard(revealedCard) {
    if (revealedCard) {
        // Carte rÃ©vÃ©lÃ©e : utiliser makeCard pour le design complet
        const el = makeCard(revealedCard, true);
        el.classList.add('opp-card-back', 'opp-revealed');
        if (revealedCard.uid) el.dataset.uid = revealedCard.uid;
        el.onmouseenter = (e) => showCardPreview(revealedCard, e);
        el.onmouseleave = hideCardPreview;
        el.onclick = (e) => { e.stopPropagation(); showCardZoom(revealedCard); };
        return el;
    } else {
        // Carte cachÃ©e : dos de carte standard
        const el = document.createElement('div');
        el.className = 'opp-card-back';
        el.onmouseenter = () => showCardBackPreview();
        el.onmouseleave = hideCardPreview;
        return el;
    }
}

function revealBounceTargetWithBridge(panel, selector, wrapper) {
    if (!panel) {
        if (wrapper && wrapper.isConnected) wrapper.remove();
        return;
    }

    const cards = panel.querySelectorAll(selector);
    const last = cards[cards.length - 1];
    let cover = null;

    if (last) {
        const rect = last.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            cover = last.cloneNode(true);
            cover.style.position = 'fixed';
            cover.style.left = rect.left + 'px';
            cover.style.top = rect.top + 'px';
            cover.style.width = rect.width + 'px';
            cover.style.height = rect.height + 'px';
            cover.style.margin = '0';
            cover.style.pointerEvents = 'none';
            cover.style.zIndex = '10001';
            cover.style.transition = 'none';
            cover.style.transform = 'none';
            cover.style.visibility = 'visible';
            document.body.appendChild(cover);
        }
        last.style.visibility = '';
        last.style.transition = 'none';
    }

    requestAnimationFrame(() => {
        if (wrapper && wrapper.isConnected) wrapper.remove();
        requestAnimationFrame(() => {
            if (cover && cover.isConnected) cover.remove();
        });
    });
}

function renderOppHand(count, oppHand) {
    const panel = document.getElementById('opp-hand');

    // Purger les cartes collapsed Ã  width:0 (jouÃ©es pendant la rÃ©solution)
    // Pendant pendingBounce, on garde UNIQUEMENT le tout premier stale slot (index 0)
    // pour Ã©viter le flash historique de la carte la plus Ã  gauche.
    // Les stale slots non-premiers sont purgÃ©s immÃ©diatement pour stabiliser la gÃ©omÃ©trie
    // de la main avant la fin du fly (Ã©vite "arrive sur une carte puis dÃ©cale aprÃ¨s").
    const hasPendingBounce = pendingBounce && pendingBounce.owner === 'opp';
    let purgedCount = 0;
    {
        const staleCards = panel.querySelectorAll('.opp-card-back');
        for (let i = staleCards.length - 1; i >= 0; i--) {
            if (staleCards[i].style.width !== '0px') continue;
            if (hasPendingBounce && i === 0) continue;
            staleCards[i].remove();
            purgedCount++;
        }
        // RÃ©assigner les z-index sÃ©quentiels aprÃ¨s purge (les anciens z-index sont dÃ©sordonnÃ©s)
        if (purgedCount > 0) {
            const remaining = panel.querySelectorAll('.opp-card-back');
            for (let i = 0; i < remaining.length; i++) {
                remaining[i].style.zIndex = i + 1;
            }
        }
    }

    const oldCards = panel.querySelectorAll('.opp-card-back');
    const oldCount = oldCards.length;
    const drawActive = typeof GameAnimations !== 'undefined' && GameAnimations.hasActiveDrawAnimation('opp');

    const cacheSize = typeof savedRevealedCardRects !== 'undefined' ? savedRevealedCardRects.size : 0;
    if (typeof window.visTrace === 'function') {
        window.visTrace('oppHand:render:start', {
            statePhase: state?.phase || '?',
            count,
            oldCount,
            drawActive,
            cacheSize,
            purgedCount,
            pendingBounce: !!hasPendingBounce,
            pendingBounceResolved: !!(pendingBounce && pendingBounce.resolved),
            pendingBounceCompleted: !!(pendingBounce && pendingBounce.completed),
        });
    }

    // --- Mode freeze : ne PAS toucher au DOM pendant la transition de rÃ©vÃ©lation ---
    // Tant que des cartes revealed sont en attente d'animation et que le count n'a pas changÃ©,
    // on garde la main telle quelle (la carte revealed reste Ã  sa place visuelle)
    // Ne pas freezer pendant un pendingBounce adverse (graveyardReturn/bounce),
    // sinon la carte revealed peut ne jamais Ãªtre injectÃ©e au bon index et
    // checkPendingBounce ne trouve pas sa cible (timeout -> animation cassÃ©e).
    if (cacheSize > 0 && count === oldCount && !(pendingBounce && pendingBounce.owner === 'opp')) {
        if (typeof window.visTrace === 'function') {
            window.visTrace('oppHand:render:skip-freeze-reveal', {
                count,
                oldCount,
                cacheSize,
            });
        }
        return;
    }

    // --- Mode incrÃ©mental : ne PAS dÃ©truire le DOM pendant une animation de pioche ---
    if (drawActive && count >= oldCount) {
        if (count > oldCount) {
            GameAnimations.remapOppDrawIndices(oldCount);
        }

        // FLIP : sauvegarder les positions des cartes existantes avant d'ajouter les nouvelles
        const oldPositions = count > oldCount
            ? Array.from(oldCards).map(c => c.getBoundingClientRect().left) : null;

        for (let i = 0; i < oldCount; i++) {
            // Si une carte anciennement cachÃ©e est maintenant revealed, la remplacer
            const revealedCard = oppHand && oppHand[i];
            const isRevealedEl = oldCards[i].classList.contains('opp-revealed');
            const elUid = oldCards[i].dataset?.uid || '';
            const shouldBeRevealed = !!revealedCard;
            const wrongRevealedUid = shouldBeRevealed && isRevealedEl && revealedCard.uid && elUid !== revealedCard.uid;
            const shouldReplace =
                (shouldBeRevealed && !isRevealedEl) ||
                (!shouldBeRevealed && isRevealedEl) ||
                wrongRevealedUid;

            if (shouldReplace) {
                const newEl = createOppHandCard(revealedCard);
                newEl.style.zIndex = i + 1;
                const shouldHide = GameAnimations.shouldHideCard('opp', i);
                if (shouldHide) newEl.style.visibility = 'hidden';
                oldCards[i].replaceWith(newEl);
            } else if (count === oldCount) {
                const shouldHide = GameAnimations.shouldHideCard('opp', i);
                const isCollapsed = oldCards[i].style.width === '0px';
                oldCards[i].style.visibility = (shouldHide || isCollapsed) ? 'hidden' : '';
            } else {
                const isCollapsed = oldCards[i].style.width === '0px';
                oldCards[i].style.visibility = isCollapsed ? 'hidden' : '';
            }
        }
        for (let i = oldCount; i < Math.min(count, 12); i++) {
            const revealedCard = oppHand && oppHand[i];
            const el = createOppHandCard(revealedCard);
            el.style.zIndex = i + 1;
            const shouldHide = GameAnimations.shouldHideCard('opp', i);
            if (shouldHide) {
                el.style.visibility = 'hidden';
            }
            panel.appendChild(el);
        }

        const completedOppBounce = pendingBounce && pendingBounce.owner === 'opp' && pendingBounce.completed;

        // FLIP : animer le glissement des cartes existantes vers leurs nouvelles positions.
        // Si graveyardReturn vient de finir, on skip ce FLIP pour Ã©viter un effet de dÃ©doublement
        // (overlay volant + carte rÃ©elle visibles pendant le slide).
        if (oldPositions && !completedOppBounce) {
            const currentCards = panel.querySelectorAll('.opp-card-back');
            const toAnimate = [];
            for (let i = 0; i < oldPositions.length; i++) {
                if (i >= currentCards.length || !currentCards[i].isConnected) continue;
                const newLeft = currentCards[i].getBoundingClientRect().left;
                const dx = oldPositions[i] - newLeft;
                if (Math.abs(dx) > 1) {
                    currentCards[i].style.transition = 'none';
                    currentCards[i].style.transform = `translateX(${dx}px)`;
                    toAnimate.push(currentCards[i]);
                }
            }
            if (toAnimate.length > 0) {
                panel.getBoundingClientRect(); // force reflow
                requestAnimationFrame(() => {
                    for (const card of toAnimate) {
                        card.style.transition = 'transform 0.3s ease-out';
                        card.style.transform = '';
                    }
                    setTimeout(() => {
                        for (const card of toAnimate) { card.style.transition = ''; }
                    }, 350);
                });
            }
        }

        if (pendingBounce && pendingBounce.owner === 'opp') {
            if (pendingBounce.completed) {
                // Animation terminÃ©e  rÃ©vÃ©ler la derniÃ¨re carte et cleanup
                const wrapper = pendingBounce.wrapper;
                pendingBounce = null;
                revealBounceTargetWithBridge(panel, '.opp-card-back', wrapper);
            } else {
                const allCards = panel.querySelectorAll('.opp-card-back');
                checkPendingBounce('opp', allCards);
            }
        }
        if (typeof window.visTrace === 'function') {
            window.visTrace('oppHand:render:end-draw-mode', {
                count,
                oldCount,
                domCount: panel.querySelectorAll('.opp-card-back').length,
                hidden: Array.from(panel.querySelectorAll('.opp-card-back')).filter((el) => el.style.visibility === 'hidden').length,
                revealed: panel.querySelectorAll('.opp-revealed').length,
            });
        }
        return;
    }

    // --- Mode freeze rÃ©solution : pendant la rÃ©solution, NE JAMAIS rÃ©duire la main opp ---
    // Les animations (summon, spell, trap) retirent elles-mÃªmes les dos de cartes du DOM.
    // blockSlots peut arriver APRS emitStateToBoth (io.to vs socket.emit = pas d'ordre garanti),
    // donc on ne peut pas se fier Ã  animatingSlots ici.
    if (count < oldCount && state?.phase === 'resolution') {
        if (!savedOppHandRects) {
            savedOppHandRects = Array.from(oldCards).map(c => c.getBoundingClientRect());
        }
        for (let i = oldCount - 1; i >= count; i--) {
            const stale = oldCards[i];
            if (!stale) continue;
            stale.style.visibility = 'hidden';
            if (stale.style.width !== '0px') smoothCloseOppHandGap(stale);
        }
        if (typeof window.visTrace === 'function') {
            window.visTrace('oppHand:render:skip-resolution-shrink', {
                count,
                oldCount,
                savedRectCount: savedOppHandRects ? savedOppHandRects.length : 0,
            });
        }
        return;
    }

    const target = Math.min(count, 12);
    const oldDomCount = panel.children.length;
    const preservedCount = Math.min(oldDomCount, target);

    // FLIP step 1 : snapshot positions avant modification du DOM
    // Animer Ã  la fois les retraits et les ajouts (bounce -> +1 carte).
    let oldPositions = null;
    if (target !== oldDomCount && preservedCount > 0) {
        oldPositions = Array.from(panel.children)
            .slice(0, preservedCount)
            .map(c => c.getBoundingClientRect().left);
    }

    // Supprimer les Ã©lÃ©ments en trop
    while (panel.children.length > target) {
        panel.lastElementChild.remove();
    }

    // Mettre Ã  jour ou ajouter les Ã©lÃ©ments manquants
    for (let i = 0; i < target; i++) {
        const revealedCard = oppHand && oppHand[i];
        let el = panel.children[i];

        if (!el) {
            // Ajouter un nouvel Ã©lÃ©ment
            el = createOppHandCard(revealedCard);
            el.style.zIndex = i + 1;
            panel.appendChild(el);
        } else {
            const isRevealedEl = el.classList.contains('opp-revealed');
            const elUid = el.dataset?.uid || '';
            const shouldBeRevealed = !!revealedCard;
            const wrongRevealedUid = shouldBeRevealed && isRevealedEl && revealedCard.uid && elUid !== revealedCard.uid;
            const shouldReplace =
                (shouldBeRevealed && !isRevealedEl) ||
                (!shouldBeRevealed && isRevealedEl) ||
                wrongRevealedUid;

            if (!shouldReplace) {
                // rien Ã  faire
            } else {
                // Remplacer carte cachÃ©e/revealed selon l'Ã©tat attendu
                const newEl = createOppHandCard(revealedCard);
                newEl.style.zIndex = i + 1;
                el.replaceWith(newEl);
            }
        }

        const shouldHide = typeof GameAnimations !== 'undefined' && GameAnimations.shouldHideCard('opp', i);
        if (panel.children[i]) {
            const isCollapsed = panel.children[i].style.width === '0px';
            panel.children[i].style.visibility = (shouldHide || isCollapsed) ? 'hidden' : '';
        }
    }

    const completedOppBounce = pendingBounce && pendingBounce.owner === 'opp' && pendingBounce.completed;

    // FLIP step 2 : animer le glissement des cartes restantes vers leurs nouvelles positions.
    // Si graveyardReturn vient de finir, on skip ce FLIP pour Ã©viter le dÃ©doublement.
    if (oldPositions && !completedOppBounce) {
        const currentCards = panel.querySelectorAll('.opp-card-back');
        const toAnimate = [];
        for (let i = 0; i < oldPositions.length && i < currentCards.length; i++) {
            const newLeft = currentCards[i].getBoundingClientRect().left;
            const dx = oldPositions[i] - newLeft;
            if (Math.abs(dx) > 1) {
                currentCards[i].style.transition = 'none';
                currentCards[i].style.transform = `translateX(${dx}px)`;
                toAnimate.push(currentCards[i]);
            }
        }
        if (toAnimate.length > 0) {
            panel.getBoundingClientRect(); // force reflow
            requestAnimationFrame(() => {
                for (const card of toAnimate) {
                    card.style.transition = 'transform 0.3s ease-out';
                    card.style.transform = '';
                }
                setTimeout(() => {
                    for (const card of toAnimate) { card.style.transition = ''; }
                }, 350);
            });
        }
    }

    // Bounce : cacher la derniÃ¨re carte si un bounce est en attente
    if (pendingBounce && pendingBounce.owner === 'opp') {
        if (pendingBounce.completed) {
            // Animation terminÃ©e  rÃ©vÃ©ler la derniÃ¨re carte et cleanup
            const wrapper = pendingBounce.wrapper;
                pendingBounce = null;
                revealBounceTargetWithBridge(panel, '.opp-card-back', wrapper);
        } else {
            const allCards = panel.querySelectorAll('.opp-card-back');
            checkPendingBounce('opp', allCards);
        }
    }
    if (typeof window.visTrace === 'function') {
        window.visTrace('oppHand:render:end', {
            count,
            oldCount,
            domCount: panel.querySelectorAll('.opp-card-back').length,
            hidden: Array.from(panel.querySelectorAll('.opp-card-back')).filter((el) => el.style.visibility === 'hidden').length,
            revealed: panel.querySelectorAll('.opp-revealed').length,
        });
    }
}

function makeCard(card, inHand, discountedCost = null) {
    const el = document.createElement('div');
    el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type}`;
    // Synchroniser l'animation de bordure rotative (Ã©vite le redÃ©marrage au re-render)
    el.style.setProperty('--anim-offset', `${(performance.now() / 1000) % 6}s`);

    if (!inHand && card.type === 'creature') {
        if (card.turnsOnField === 0 && !card.canAttack) el.classList.add('just-played');
        if (card.canAttack) el.classList.add('can-attack');
        if (card.melodyLocked) {
            el.classList.add('melody-locked');
        }
        if (card.petrified) {
            el.classList.add('petrified');
        }
    }

    const hp = card.currentHp ?? card.hp;

    // CoÃ»t affichÃ© (rÃ©duit si Hyrule actif)
    const displayCost = discountedCost !== null ? discountedCost : card.cost;
    const costClass = discountedCost !== null ? 'discounted' : '';

    // Classes pour les stats (comparaison avec les stats de BASE)
    // boosted = supÃ©rieur Ã  la base (vert), reduced = infÃ©rieur Ã  la base (rouge)
    let hpClass = '';
    let atkClass = '';
    if (card.type === 'creature') {
        const baseHp = card.baseHp ?? card.hp;
        if (hp > baseHp) {
            hpClass = 'boosted';
        } else if (hp < baseHp) {
            hpClass = 'reduced';
        }

        // ATK: comparer atk avec baseAtk (pas pour les bÃ¢timents)
        if (!card.isBuilding) {
            const baseAtk = card.baseAtk ?? card.atk;
            if (card.atk > baseAtk) {
                atkClass = 'boosted';
            } else if (card.atk < baseAtk) {
                atkClass = 'reduced';
            }
        }
    }

    // Carte style Arena (Magic Arena) : pilule stats en bas Ã  droite, mana en rond bleu
    if (card.arenaStyle && card.image) {
        el.classList.add('arena-style');
        if (card.faction) {
            el.classList.add(`faction-${card.faction}`);
        }
        el.style.backgroundImage = `url('/cards/${card.image}')`;

        // Taille de nom prÃ©-calculÃ©e (Ã©vite le recalcul runtime)
        const fitSize = getNameFitSize(card.name, !!card.faction);
        const nameStyle = fitSize ? ` style="font-size:${fitSize}"` : '';

        // CapacitÃ©s communes (sans shooter/fly car dÃ©jÃ  dans le type)
        const commonAbilityNames = {
            haste: 'CÃ©lÃ©ritÃ©', superhaste: 'SupercÃ©lÃ©ritÃ©', intangible: 'Intangible',
            trample: 'PiÃ©tinement', power: 'Puissance', immovable: 'Immobile', wall: 'Mur', regeneration: 'RÃ©gÃ©nÃ©ration',
            protection: 'Protection', spellBoost: 'Sort renforcÃ©', enhance: 'AmÃ©lioration', bloodthirst: 'Soif de sang', melody: 'MÃ©lodie', camouflage: 'Camouflage', lethal: 'Toucher mortel', spectral: 'Spectral', poison: 'Poison', untargetable: 'Inciblable', entrave: 'Entrave', lifelink: 'Lien vital', lifedrain: 'Drain de vie', dissipation: 'Dissipation', antitoxin: 'Antitoxine', unsacrificable: 'Non sacrifiable', provocation: 'Provocation'
        };
        // Filtrer shooter et fly des capacitÃ©s affichÃ©es
        const addedAbils = card.addedAbilities || [];
        const commonAbilities = (card.abilities || [])
            .filter(a => a !== 'shooter' && a !== 'fly')
            .map(a => {
                const isAdded = addedAbils.includes(a);
                if (a === 'cleave') { const t = `Clivant ${card.cleaveX || ''}`.trim(); return isAdded ? `<span class="boosted">${t}</span>` : t; }
                if (a === 'power') { const t = `Puissance ${card.powerX || ''}`.trim(); return isAdded ? `<span class="boosted">${t}</span>` : t; }
                if (a === 'regeneration') { const t = `RÃ©gÃ©nÃ©ration ${card.regenerationX || ''}`.trim(); return isAdded ? `<span class="boosted">${t}</span>` : t; }
                if (a === 'spellBoost') { const t = `Sort renforcÃ© ${card.spellBoostAmount || ''}`.trim(); return isAdded ? `<span class="boosted">${t}</span>` : t; }
                if (a === 'enhance') { const t = `AmÃ©lioration ${card.enhanceAmount || ''}`.trim(); return isAdded ? `<span class="boosted">${t}</span>` : t; }
                if (a === 'bloodthirst') { const t = `Soif de sang ${card.bloodthirstAmount || ''}`.trim(); return isAdded ? `<span class="boosted">${t}</span>` : t; }
                if (a === 'poison') {
                    const basePoison = card.basePoisonX ?? card.poisonX ?? 1;
                    const effectivePoison = card.poisonX || 1;
                    const poisonBoosted = isAdded || effectivePoison > basePoison;
                    const poisonClass = poisonBoosted ? ' class="boosted"' : '';
                    return isAdded ? `<span class="boosted">Poison</span> <span${poisonClass}>${effectivePoison}</span>` : `Poison <span${poisonClass}>${effectivePoison}</span>`;
                }
                if (a === 'entrave') { const t = `Entrave ${card.entraveX || ''}`.trim(); return isAdded ? `<span class="boosted">${t}</span>` : t; }
                if (a === 'lifedrain') { const t = `Drain de vie ${card.lifedrainX || ''}`.trim(); return isAdded ? `<span class="boosted">${t}</span>` : t; }
                if (a === 'lifelink') { const t = `Lien vital ${card.lifelinkX || ''}`.trim(); return isAdded ? `<span class="boosted">${t}</span>` : t; }
                const name = commonAbilityNames[a] || a;
                if (isAdded) return `<span class="boosted">${name}</span>`;
                return name;
            });
        if (card.sacrifice) {
            commonAbilities.push(`Sacrifice ${card.sacrifice}`);
        }
        const abilitiesText = commonAbilities.join(', ');

        let combatTypeText = 'MÃªlÃ©e';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) combatTypeText = 'Tireur';
        else if (card.combatType === 'fly' || card.abilities?.includes('fly')) combatTypeText = 'Volant';

        // Type de crÃ©ature (mort-vivant, humain, dragon...)
        const creatureTypeNames = {
            undead: 'Mort-vivant',
            human: 'Humain',
            goblin: 'Gobelin',
            demon: 'DÃ©mon',
            elemental: 'Ã‰lÃ©mentaire',
            beast: 'BÃªte',
            spirit: 'Esprit',
            dragon: 'Dragon',
            serpent: 'Serpent',
            monstrosity: 'MonstruositÃ©',
            ogre: 'Ogre',
            spider: 'AraignÃ©e',
            parasite: 'Parasite',
            plant: 'Plante',
            vampire: 'Vampire',
            insect: 'Insecte'
        };
        const creatureTypeName = card.creatureType ? creatureTypeNames[card.creatureType] : null;

        // CapacitÃ© spÃ©ciale/unique si prÃ©sente
        let specialAbility = '';
        if (card.description) {
            specialAbility = card.description;
        } else {
            if (card.onHeroHit === 'draw') {
                specialAbility = 'Quand cette crÃ©ature attaque le hÃ©ros adverse, piochez une carte.';
            }
            if (card.onDeath?.damageHero) {
                specialAbility = `Ã€ la mort de cette crÃ©ature, le hÃ©ros adverse subit ${card.onDeath.damageHero} blessures.`;
            }
        }

        // Diamant de raretÃ© basÃ© sur l'Ã©dition
        const rarityMap = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'mythic', 5: 'platinum' };
        const rarityClass = rarityMap[card.edition] || 'common';
        const rarityDiamond = `<div class="arena-edition"><div class="rarity-icon ${rarityClass}"><div class="inner-shape"></div></div></div>`;

        // Ligne de type complÃ¨te
        let typeLineText;
        if (card.isBuilding) {
            typeLineText = 'BÃ¢timent';
            if (creatureTypeName) typeLineText += ` - ${creatureTypeName}`;
        } else {
            typeLineText = `CrÃ©ature - ${combatTypeText}`;
            if (creatureTypeName) typeLineText += ` - ${creatureTypeName}`;
        }

        // Style du titre (couleur personnalisÃ©e si dÃ©finie)
        const titleStyle = card.titleColor ? `style="background: ${card.titleColor}"` : '';

        // Les sorts et piÃ¨ges n'ont pas de stats
        const isSpell = card.type === 'spell';
        const isTrap = card.type === 'trap';
        const noStats = isSpell || isTrap;
        if (noStats) el.classList.add('card-spell');
        if (card.isBuilding) el.classList.add('card-building');

        // Version allÃ©gÃ©e sur le terrain
        if (!inHand) {
            el.classList.add('on-field');
            // Jetons compteurs  empilÃ©s verticalement sur le cÃ´tÃ© droit
            let mkIdx = 0;
            const mkBase = 2;
            const gazeMarker = card.medusaGazeMarker >= 1 ? `<div class="gaze-marker" style="top:${mkBase + mkIdx++ * 28}px">${card.medusaGazeMarker}</div>` : '';
            const poisonMarker = (card.poisonCounters || 0) >= 1 ? `<div class="poison-marker" style="top:${mkBase + mkIdx++ * 28}px"><span class="poison-count">${card.poisonCounters}</span></div>` : '';
            const entraveMarker = (card.entraveCounters || 0) >= 1 ? `<div class="entrave-marker" style="top:${mkBase + mkIdx++ * 28}px"><span class="entrave-count">${card.entraveCounters}</span></div>` : '';
            const buffMarker = (card.buffCounters || 0) >= 1 ? `<div class="buff-marker" style="top:${mkBase + mkIdx++ * 28}px"><span class="buff-count">${card.buffCounters}</span></div>` : '';
            const melodyIcon = '';
            if (noStats) {
                el.innerHTML = `
                    <div class="arena-title" ${titleStyle}><div class="arena-name"${nameStyle}>${card.name}</div></div>
                    <div class="arena-mana">${card.cost}</div>
                    ${gazeMarker}${poisonMarker}${entraveMarker}${buffMarker}${melodyIcon}`;
            } else {
                el.innerHTML = `
                    <div class="arena-title" ${titleStyle}><div class="arena-name"${nameStyle}>${card.name}</div></div>
                    <div class="arena-mana">${card.cost}</div>
                    <div class="arena-stats">${card.isBuilding ? `<span class="arena-armor">${hp}</span>` : `<span class="arena-atk ${atkClass}">${card.atk}</span><span class="arena-hp ${hpClass}">${hp}</span>`}</div>
                    ${gazeMarker}${poisonMarker}${entraveMarker}${buffMarker}${melodyIcon}`;
            }
            autoFitCardName(el);
            return el;
        }

        // Version complÃ¨te (main, hover, cimetiÃ¨re)
        if (noStats) {
            let typeName = 'Sort';
            if (isTrap) {
                typeName = 'PiÃ¨ge';
            } else if (card.spellSpeed !== undefined) {
                typeName = `Sort - Vitesse ${card.spellSpeed}`;
            } else if (card.spellType) {
                const spellTypeMap = { offensif: 'Offensif', 'dÃ©fensif': 'DÃ©fensif', hybride: 'Hybride' };
                typeName = `Sort - ${spellTypeMap[card.spellType] || card.spellType}`;
            }
            // Boost des dÃ©gÃ¢ts de sorts si spellBoost actif
            let spellDescription = card.description || '';
            const spellBoost = (isSpell && card.offensive && card.damage && state?.me?.spellBoost) ? state.me.spellBoost : 0;
            if (spellBoost > 0 && card.damage) {
                const boostedDmg = card.damage + spellBoost;
                spellDescription = spellDescription.replace(
                    new RegExp(`${card.damage}(\\s*(?:blessures?|dÃ©gÃ¢ts?))`, 'g'),
                    `<span class="boosted">${boostedDmg}</span>$1`
                );
            }
            el.innerHTML = `
                <div class="arena-title" ${titleStyle}><div class="arena-name"${nameStyle}>${card.name}</div></div>
                <div class="arena-text-zone">
                    <div class="arena-type">${typeName}</div>
                    ${spellDescription ? `<div class="arena-special">${spellDescription}</div>` : ''}
                </div>
                ${rarityDiamond}
                <div class="arena-mana ${costClass}">${displayCost}</div>`;
        } else {
            // Si pÃ©trifiÃ©, remplacer capacitÃ©s et description
            const displayAbilities = card.petrified ? '' : abilitiesText;
            const displaySpecial = card.petrified ? (card.petrifiedDescription || 'PÃ©trifiÃ© - ne peut ni attaquer ni bloquer.') : specialAbility;
            el.innerHTML = `
                <div class="arena-title" ${titleStyle}><div class="arena-name"${nameStyle}>${card.name}</div></div>
                <div class="arena-text-zone">
                    <div class="arena-type">${typeLineText}</div>
                    ${displayAbilities ? `<div class="arena-abilities">${displayAbilities}</div>` : ''}
                    ${displaySpecial ? `<div class="arena-special">${displaySpecial}</div>` : ''}
                </div>
                ${rarityDiamond}
                <div class="arena-mana ${costClass}">${displayCost}</div>
                <div class="arena-stats ${atkClass || hpClass ? 'modified' : ''}">${card.isBuilding ? `<span class="arena-armor">${hp}</span>` : `<span class="arena-atk ${atkClass}">${card.atk}</span><span class="arena-hp ${hpClass}">${hp}</span>`}</div>`;
        }
        autoFitCardName(el);
        return el;
    }



    autoFitCardName(el);
    return el;
}


