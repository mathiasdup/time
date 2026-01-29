// =============================================
// Resolution Player - Système d'animation robuste
// =============================================
// Ce système gère les animations de résolution de manière isolée et déterministe.
// Il utilise une State Machine et un Canvas overlay pour éviter les conflits avec le DOM.

const ResolutionPlayer = (function() {
    'use strict';

    // ==================== ÉTAT ====================
    const State = {
        IDLE: 'IDLE',           // En attente d'une résolution
        PREPARING: 'PREPARING', // Préparation de l'overlay
        ANIMATING: 'ANIMATING', // Animation en cours
        SYNCING: 'SYNCING',     // Synchronisation avec l'état final
        CLEANUP: 'CLEANUP'      // Nettoyage
    };

    let currentState = State.IDLE;
    let resolutionPacket = null;
    let animationTimeline = [];
    let currentAnimationIndex = 0;
    let overlay = null;
    let animationCanvas = null;
    let ctx = null;
    let onCompleteCallback = null;

    // Positions des slots (sera calculé dynamiquement)
    let slotPositions = {};

    // ==================== CONFIGURATION ====================
    const CONFIG = {
        CARD_WIDTH: 105,
        CARD_HEIGHT: 140,
        ANIMATION_SPEED: 1.0, // Multiplicateur de vitesse
        OVERLAY_Z_INDEX: 5000,
        DEBUG: true
    };

    // ==================== LOGGING ====================
    function log(message, ...args) {
        if (CONFIG.DEBUG) {
            console.log(`[ResolutionPlayer] ${message}`, ...args);
        }
    }

    // ==================== STATE MACHINE ====================
    function setState(newState) {
        log(`State: ${currentState} → ${newState}`);
        currentState = newState;
    }

    function isAnimating() {
        return currentState === State.ANIMATING || currentState === State.PREPARING;
    }

    // ==================== OVERLAY MANAGEMENT ====================
    function createOverlay() {
        if (overlay) return;

        // Créer le container overlay
        overlay = document.createElement('div');
        overlay.id = 'resolution-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            z-index: ${CONFIG.OVERLAY_Z_INDEX};
            pointer-events: none;
            overflow: hidden;
        `;

        // Créer le canvas pour les animations
        animationCanvas = document.createElement('canvas');
        animationCanvas.id = 'resolution-canvas';
        animationCanvas.width = window.innerWidth;
        animationCanvas.height = window.innerHeight;
        animationCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
        `;
        overlay.appendChild(animationCanvas);
        ctx = animationCanvas.getContext('2d');

        document.body.appendChild(overlay);
        log('Overlay created');
    }

    function destroyOverlay() {
        if (overlay) {
            overlay.remove();
            overlay = null;
            animationCanvas = null;
            ctx = null;
            log('Overlay destroyed');
        }
    }

    function resizeCanvas() {
        if (animationCanvas) {
            animationCanvas.width = window.innerWidth;
            animationCanvas.height = window.innerHeight;
        }
    }

    // ==================== SLOT POSITIONS ====================
    function captureSlotPositions() {
        slotPositions = {};

        // Capturer les positions de tous les slots
        document.querySelectorAll('.card-slot').forEach(slot => {
            const owner = slot.dataset.owner;
            const row = slot.dataset.row;
            const col = slot.dataset.col;
            const rect = slot.getBoundingClientRect();
            const key = `${owner}-${row}-${col}`;

            slotPositions[key] = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
                width: rect.width,
                height: rect.height,
                left: rect.left,
                top: rect.top
            };
        });

        // Capturer les positions des héros
        ['me', 'opp'].forEach(owner => {
            const heroEl = document.querySelector(`.hero-area.${owner === 'me' ? 'me' : 'opponent'} .hero-card`);
            if (heroEl) {
                const rect = heroEl.getBoundingClientRect();
                slotPositions[`${owner}-hero`] = {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                    width: rect.width,
                    height: rect.height,
                    left: rect.left,
                    top: rect.top
                };
            }
        });

        log('Captured slot positions:', Object.keys(slotPositions).length);
    }

    // ==================== CARD RENDERING ====================
    // Cache d'images de cartes
    const cardImageCache = new Map();

    function getCardImage(card) {
        const cacheKey = card.id || card.name;
        if (cardImageCache.has(cacheKey)) {
            return cardImageCache.get(cacheKey);
        }

        // Créer un canvas temporaire pour la carte
        const canvas = document.createElement('canvas');
        canvas.width = CONFIG.CARD_WIDTH;
        canvas.height = CONFIG.CARD_HEIGHT;
        const ctx = canvas.getContext('2d');

        // Fond de la carte
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, CONFIG.CARD_WIDTH, CONFIG.CARD_HEIGHT);

        // Bordure
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, CONFIG.CARD_WIDTH - 2, CONFIG.CARD_HEIGHT - 2);

        // Icône
        ctx.font = '32px Arial';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(card.icon || '?', CONFIG.CARD_WIDTH / 2, 45);

        // Nom
        ctx.font = 'bold 10px Arial';
        ctx.fillText(card.name || 'Unknown', CONFIG.CARD_WIDTH / 2, 70);

        // Stats (ATK/HP)
        if (card.atk !== undefined && card.hp !== undefined) {
            ctx.font = 'bold 14px Arial';
            ctx.fillStyle = '#e74c3c';
            ctx.textAlign = 'left';
            ctx.fillText(`⚔${card.atk}`, 8, CONFIG.CARD_HEIGHT - 10);
            ctx.fillStyle = '#2ecc71';
            ctx.textAlign = 'right';
            ctx.fillText(`♥${card.hp}`, CONFIG.CARD_WIDTH - 8, CONFIG.CARD_HEIGHT - 10);
        }

        cardImageCache.set(cacheKey, canvas);
        return canvas;
    }

    // ==================== ANIMATION PRIMITIVES ====================

    // Objet animé représentant une carte en mouvement
    class AnimatedCard {
        constructor(card, startX, startY) {
            this.card = card;
            this.x = startX;
            this.y = startY;
            this.targetX = startX;
            this.targetY = startY;
            this.scale = 1;
            this.alpha = 1;
            this.rotation = 0;
            this.image = getCardImage(card);
            this.zIndex = 0;
            this.visible = true;
        }

        moveTo(x, y, duration) {
            return new Promise(resolve => {
                const startX = this.x;
                const startY = this.y;
                const startTime = performance.now();

                const animate = (currentTime) => {
                    const elapsed = currentTime - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    const eased = easeInOutCubic(progress);

                    this.x = startX + (x - startX) * eased;
                    this.y = startY + (y - startY) * eased;

                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    } else {
                        this.x = x;
                        this.y = y;
                        resolve();
                    }
                };

                requestAnimationFrame(animate);
            });
        }

        draw(ctx) {
            if (!this.visible) return;

            ctx.save();
            ctx.globalAlpha = this.alpha;
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);
            ctx.scale(this.scale, this.scale);
            ctx.drawImage(
                this.image,
                -CONFIG.CARD_WIDTH / 2,
                -CONFIG.CARD_HEIGHT / 2,
                CONFIG.CARD_WIDTH,
                CONFIG.CARD_HEIGHT
            );
            ctx.restore();
        }
    }

    // Easing function
    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // ==================== ANIMATION TIMELINE ====================
    let activeAnimatedObjects = [];

    function clearAnimatedObjects() {
        activeAnimatedObjects = [];
    }

    function addAnimatedObject(obj) {
        activeAnimatedObjects.push(obj);
        activeAnimatedObjects.sort((a, b) => a.zIndex - b.zIndex);
    }

    function removeAnimatedObject(obj) {
        const index = activeAnimatedObjects.indexOf(obj);
        if (index > -1) {
            activeAnimatedObjects.splice(index, 1);
        }
    }

    // Boucle de rendu
    let renderLoopRunning = false;

    function startRenderLoop() {
        if (renderLoopRunning) return;
        renderLoopRunning = true;

        function render() {
            if (!renderLoopRunning || !ctx) return;

            // Clear canvas
            ctx.clearRect(0, 0, animationCanvas.width, animationCanvas.height);

            // Draw all animated objects
            for (const obj of activeAnimatedObjects) {
                obj.draw(ctx);
            }

            requestAnimationFrame(render);
        }

        requestAnimationFrame(render);
    }

    function stopRenderLoop() {
        renderLoopRunning = false;
    }

    // ==================== ANIMATION HANDLERS ====================

    async function animateMove(event) {
        const { player, fromRow, fromCol, toRow, toCol, card } = event.data;
        const owner = player === myNum ? 'me' : 'opp';

        const fromKey = `${owner}-${fromRow}-${fromCol}`;
        const toKey = `${owner}-${toRow}-${toCol}`;

        const fromPos = slotPositions[fromKey];
        const toPos = slotPositions[toKey];

        if (!fromPos || !toPos) {
            log('Missing slot positions for move animation');
            return;
        }

        // Créer la carte animée
        const animCard = new AnimatedCard(card, fromPos.x, fromPos.y);
        animCard.zIndex = 100;
        addAnimatedObject(animCard);

        // Cacher la carte dans le DOM
        const fromSlot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${fromRow}"][data-col="${fromCol}"]`);
        const existingCard = fromSlot?.querySelector('.card');
        if (existingCard) existingCard.style.visibility = 'hidden';

        // Animation de déplacement
        await animCard.moveTo(toPos.x, toPos.y, 500 / CONFIG.ANIMATION_SPEED);

        // Cleanup
        removeAnimatedObject(animCard);

        log(`Move animation complete: ${card.name}`);
    }

    async function animateSummon(event) {
        const { player, row, col, card } = event.data;
        const owner = player === myNum ? 'me' : 'opp';
        const slotKey = `${owner}-${row}-${col}`;
        const pos = slotPositions[slotKey];

        if (!pos) {
            log('Missing slot position for summon animation');
            return;
        }

        // Créer la carte animée (commence au-dessus de l'écran)
        const animCard = new AnimatedCard(card, pos.x, -150);
        animCard.zIndex = 100;
        animCard.scale = 0.8;
        addAnimatedObject(animCard);

        // Animation de chute
        await animCard.moveTo(pos.x, pos.y, 500 / CONFIG.ANIMATION_SPEED);

        // Cleanup
        removeAnimatedObject(animCard);

        log(`Summon animation complete: ${card.name}`);
    }

    async function animateAttack(event) {
        const { attackerOwner, attackerRow, attackerCol, targetOwner, targetRow, targetCol, damage, card } = event.data;

        const attackerKey = `${attackerOwner}-${attackerRow}-${attackerCol}`;
        const attackerPos = slotPositions[attackerKey];

        let targetPos;
        if (targetCol === -1) {
            // Attaque sur le héros
            targetPos = slotPositions[`${targetOwner}-hero`];
        } else {
            const targetKey = `${targetOwner}-${targetRow}-${targetCol}`;
            targetPos = slotPositions[targetKey];
        }

        if (!attackerPos || !targetPos) {
            log('Missing positions for attack animation');
            return;
        }

        // Créer la carte animée
        const animCard = new AnimatedCard(card, attackerPos.x, attackerPos.y);
        animCard.zIndex = 200;
        addAnimatedObject(animCard);

        // Cacher la carte originale
        const slot = document.querySelector(`.card-slot[data-owner="${attackerOwner}"][data-row="${attackerRow}"][data-col="${attackerCol}"]`);
        const existingCard = slot?.querySelector('.card');
        if (existingCard) existingCard.style.visibility = 'hidden';

        // Animation vers la cible
        await animCard.moveTo(targetPos.x, targetPos.y, 300 / CONFIG.ANIMATION_SPEED);

        // Effet de dégâts
        if (damage !== undefined) {
            showDamageNumber(targetPos.x, targetPos.y, damage);
        }

        // Retour à la position initiale
        await animCard.moveTo(attackerPos.x, attackerPos.y, 250 / CONFIG.ANIMATION_SPEED);

        // Cleanup
        removeAnimatedObject(animCard);
        if (existingCard) existingCard.style.visibility = 'visible';

        log(`Attack animation complete: ${card?.name || 'Unknown'}`);
    }

    // Afficher un nombre de dégâts
    function showDamageNumber(x, y, damage) {
        const damageEl = document.createElement('div');
        damageEl.className = 'resolution-damage-number';
        damageEl.textContent = `-${damage}`;
        damageEl.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            transform: translate(-50%, -50%);
            font-size: 32px;
            font-weight: bold;
            color: #e74c3c;
            text-shadow: 2px 2px 4px black;
            z-index: ${CONFIG.OVERLAY_Z_INDEX + 100};
            pointer-events: none;
            animation: damageFloat 1s ease-out forwards;
        `;
        document.body.appendChild(damageEl);

        setTimeout(() => damageEl.remove(), 1000);
    }

    // ==================== MAIN PLAY FUNCTION ====================

    async function play(packet) {
        if (currentState !== State.IDLE) {
            log('Cannot play: already animating');
            return false;
        }

        resolutionPacket = packet;
        log('Starting resolution playback', packet);

        try {
            // Phase 1: Préparation
            setState(State.PREPARING);
            createOverlay();
            captureSlotPositions();
            startRenderLoop();

            // Phase 2: Animation
            setState(State.ANIMATING);

            // IMPORTANT: Bloquer les renders pour éviter que gameStateUpdate
            // ne redessine le terrain pendant les animations
            if (typeof window.blockAllRenders === 'function') {
                window.blockAllRenders(true);
            }

            // Jouer chaque événement de la timeline
            // Les events consécutifs de même type (révélation) sont joués en parallèle
            console.log(`[ResolutionPlayer] Timeline has ${packet.timeline.length} events:`,
                packet.timeline.map(e => `${e.type}(${e.data?.card?.name || e.data?.player || ''})`));

            // Types entrelacés : on joue 1 me + 1 opp en parallèle par étape
            const interleavedTypes = ['move', 'summon', 'trapPlace', 'boneRevive'];
            // shieldDeploy suit toujours un summon — on le rattache au groupe summon
            const summonCompanions = ['shieldDeploy'];

            // Délais minimum par étape pour chaque type d'event entrelacé (ms)
            const minStepDelay = {
                trapPlace: 500,  // Les pièges sont instantanés visuellement, forcer un délai visible
                move: 0,
                summon: 0,
                boneRevive: 0
            };
            // Délai de transition entre deux groupes de types différents (ms)
            const groupTransitionDelay = 500;

            let i = 0;
            let lastGroupType = null;
            while (i < packet.timeline.length) {
                const event = packet.timeline[i];

                if (interleavedTypes.includes(event.type)) {
                    const groupType = event.type;

                    // Pause de transition entre groupes différents (ex: créatures → pièges)
                    if (lastGroupType !== null && lastGroupType !== groupType) {
                        await sleep(groupTransitionDelay / CONFIG.ANIMATION_SPEED);
                    }
                    lastGroupType = groupType;

                    // Collecter les éléments du groupe (chaque élément = event principal + companions)
                    const items = []; // Array of { main, companions[] }
                    while (i < packet.timeline.length && (
                        packet.timeline[i].type === groupType ||
                        (groupType === 'summon' && summonCompanions.includes(packet.timeline[i].type))
                    )) {
                        if (packet.timeline[i].type === groupType) {
                            items.push({ main: packet.timeline[i], companions: [] });
                            i++;
                            // Absorber les companions qui suivent
                            while (i < packet.timeline.length && summonCompanions.includes(packet.timeline[i].type)) {
                                items[items.length - 1].companions.push(packet.timeline[i]);
                                i++;
                            }
                        } else {
                            i++; // skip orphan companion
                        }
                    }

                    // Séparer par joueur
                    const myItems = items.filter(it => it.main.data.player === window.myNum);
                    const oppItems = items.filter(it => it.main.data.player !== window.myNum);
                    const maxLen = Math.max(myItems.length, oppItems.length);

                    log(`Interleaving ${items.length}x ${groupType}: ${myItems.length} me + ${oppItems.length} opp = ${maxLen} steps`);

                    // Jouer par paires entrelacées
                    for (let step = 0; step < maxLen; step++) {
                        const pair = [];
                        // Fonction pour jouer un item (main + ses companions en séquence)
                        const playItem = async (item) => {
                            await playEvent(item.main);
                            for (const comp of item.companions) {
                                await playEvent(comp);
                            }
                        };
                        if (step < myItems.length) pair.push(playItem(myItems[step]));
                        if (step < oppItems.length) pair.push(playItem(oppItems[step]));
                        await Promise.all(pair);
                        // Délai entre chaque étape (pas après la dernière)
                        if (step < maxLen - 1) {
                            const delays = [];
                            if (myItems[step]) delays.push(myItems[step].main.delayAfter || 0);
                            if (oppItems[step]) delays.push(oppItems[step].main.delayAfter || 0);
                            const stepDelay = Math.max(...delays, minStepDelay[groupType] || 0);
                            if (stepDelay) await sleep(stepDelay / CONFIG.ANIMATION_SPEED);
                        }
                    }
                } else {
                    lastGroupType = null;
                    await playEvent(event);
                    if (event.delayAfter) {
                        await sleep(event.delayAfter / CONFIG.ANIMATION_SPEED);
                    }
                    i++;
                }
            }

            // Phase 3: Synchronisation
            setState(State.SYNCING);

            // Pas besoin de délai - les animations sont déjà terminées
            await sleep(50);

            // Phase 4: Cleanup
            setState(State.CLEANUP);
            stopRenderLoop();
            clearAnimatedObjects();
            destroyOverlay();

            // IMPORTANT: Réactiver les renders
            if (typeof window.blockAllRenders === 'function') {
                window.blockAllRenders(false);
            }

            setState(State.IDLE);
            log('Resolution playback complete');

            if (onCompleteCallback) {
                onCompleteCallback();
            }

            return true;

        } catch (error) {
            console.error('[ResolutionPlayer] Error during playback:', error);

            // Emergency cleanup
            stopRenderLoop();
            clearAnimatedObjects();
            destroyOverlay();
            if (typeof window.blockAllRenders === 'function') {
                window.blockAllRenders(false);
            }
            setState(State.IDLE);

            return false;
        }
    }

    async function playEvent(event) {
        log(`Playing event: ${event.type}`, event);

        switch (event.type) {
            case 'move':
                // Utiliser l'animation existante si disponible
                if (typeof window.animateMove === 'function') {
                    await window.animateMove(event.data);
                } else {
                    await animateMove(event);
                }
                break;

            case 'summon':
                // Utiliser l'animation existante si disponible
                if (typeof window.animateSummon === 'function') {
                    await window.animateSummon(event.data);
                } else {
                    await animateSummon(event);
                }
                break;

            case 'attack':
            case 'soloAttack':
                await animateAttack(event);
                break;

            case 'phase':
                // Afficher un message de phase
                if (event.data?.text) {
                    showPhaseMessage(event.data.text);
                    await sleep(600 / CONFIG.ANIMATION_SPEED);
                }
                break;

            case 'shieldDeploy':
                // Déployer un bouclier CSS
                {
                    const owner = event.data.player === window.myNum ? 'me' : 'opp';
                    const slot = document.querySelector(`.card-slot[data-owner="${owner}"][data-row="${event.data.row}"][data-col="${event.data.col}"]`);
                    const card = slot?.querySelector('.card');

                    if (card && !card.querySelector('.shield-container')) {
                        if (typeof addShieldToCard === 'function') {
                            addShieldToCard(card, true); // true = avec animation

                            // Attendre l'animation de déploiement pour l'adversaire
                            if (owner === 'opp') {
                                await sleep(400 / CONFIG.ANIMATION_SPEED);
                            }
                        }
                    }
                }
                break;

            case 'shieldBreak':
                // Casser un bouclier
                if (typeof ShieldEffect !== 'undefined') {
                    const owner = event.data.owner;
                    const cardKey = `${owner}-${event.data.row}-${event.data.col}`;
                    await ShieldEffect.breakShield(cardKey);
                }
                await sleep(500 / CONFIG.ANIMATION_SPEED);
                break;

            case 'death':
                // Animation de mort - utiliser l'existante si disponible
                if (typeof window.animateDeath === 'function') {
                    await window.animateDeath(event.data);
                }
                await sleep(500 / CONFIG.ANIMATION_SPEED);
                break;

            case 'deathTransform':
                // Animation de transformation
                if (typeof window.animateDeathTransform === 'function') {
                    await window.animateDeathTransform(event.data);
                }
                await sleep(1200 / CONFIG.ANIMATION_SPEED);
                break;

            case 'boneRevive':
                // Animation de résurrection (Pile d'os -> Petit Os) - rapide ~500ms
                if (typeof window.animateBoneRevive === 'function') {
                    await window.animateBoneRevive(event.data);
                } else {
                    // Fallback: créer la nouvelle carte directement
                    const boneOwner = event.data.player === window.myNum ? 'me' : 'opp';
                    const boneSlot = document.querySelector(`.card-slot[data-owner="${boneOwner}"][data-row="${event.data.row}"][data-col="${event.data.col}"]`);
                    if (boneSlot && event.data.toCard && typeof window.makeCard === 'function') {
                        const slotLabel = boneSlot.querySelector('.slot-label');
                        boneSlot.innerHTML = '';
                        if (slotLabel) boneSlot.appendChild(slotLabel.cloneNode(true));
                        const newCard = window.makeCard(event.data.toCard, false);
                        newCard.classList.add('just-played');
                        boneSlot.appendChild(newCard);
                        boneSlot.classList.add('has-card');
                    }
                }
                await sleep(600 / CONFIG.ANIMATION_SPEED);
                break;

            case 'damage':
            case 'spellDamage':
                // Animation de dégâts
                showDamageNumber(
                    getSlotPosition(event.data.owner || (event.data.player === window.myNum ? 'me' : 'opp'), event.data.row, event.data.col).x,
                    getSlotPosition(event.data.owner || (event.data.player === window.myNum ? 'me' : 'opp'), event.data.row, event.data.col).y,
                    event.data.amount
                );
                await sleep(300 / CONFIG.ANIMATION_SPEED);
                break;

            case 'heal':
                // Animation de soin
                showHealNumber(
                    getSlotPosition(event.data.player === window.myNum ? 'me' : 'opp', event.data.row, event.data.col).x,
                    getSlotPosition(event.data.player === window.myNum ? 'me' : 'opp', event.data.row, event.data.col).y,
                    event.data.amount
                );
                await sleep(400 / CONFIG.ANIMATION_SPEED);
                break;

            case 'buff':
                // Animation de buff
                showBuffNumber(
                    getSlotPosition(event.data.player === window.myNum ? 'me' : 'opp', event.data.row, event.data.col).x,
                    getSlotPosition(event.data.player === window.myNum ? 'me' : 'opp', event.data.row, event.data.col).y,
                    event.data.atk,
                    event.data.hp
                );
                await sleep(400 / CONFIG.ANIMATION_SPEED);
                break;

            case 'heroDamage':
                // Animation de dégâts au héros
                const heroEl = document.querySelector(event.data.targetOwner === window.myNum ? '#hero-me' : '#hero-opp');
                if (heroEl) {
                    heroEl.classList.add('hit');
                    setTimeout(() => heroEl.classList.remove('hit'), 500);
                }
                await sleep(400 / CONFIG.ANIMATION_SPEED);
                break;

            case 'trapPlace':
                // Placer visuellement le piège pendant la timeline (les renders sont bloqués)
                {
                    const trapOwner = event.data.player === window.myNum ? 'me' : 'opp';
                    const trapSlot = document.querySelector(`.trap-slot[data-owner="${trapOwner}"][data-row="${event.data.row}"]`);
                    if (trapSlot && !trapSlot.classList.contains('has-trap')) {
                        trapSlot.classList.add('has-trap');
                        if (trapOwner === 'me') {
                            trapSlot.classList.add('mine');
                        } else {
                            // Pulse animation pour les pièges adverses
                            trapSlot.classList.add('trap-reveal-pulse');
                            setTimeout(() => trapSlot.classList.remove('trap-reveal-pulse'), 600);
                        }
                    }
                }
                break;

            case 'trapTrigger':
                // Animation de déclenchement de piège
                if (typeof window.animateTrap === 'function') {
                    await window.animateTrap(event.data);
                }
                await sleep(600 / CONFIG.ANIMATION_SPEED);
                break;

            case 'spell':
                // Animation de sort
                if (typeof window.animateSpell === 'function') {
                    window.animateSpell(event.data);
                }
                await sleep(800 / CONFIG.ANIMATION_SPEED);
                break;

            case 'draw':
                // Animation de pioche
                if (typeof GameAnimations !== 'undefined') {
                    GameAnimations.prepareDrawAnimation({ cards: event.data.cards });
                }
                await sleep(400 / CONFIG.ANIMATION_SPEED);
                break;

            case 'state':
            case 'stateSnapshot':
                // Mise à jour intermédiaire de l'état - on ne fait rien ici
                break;

            case 'delay':
                await sleep(event.duration || 500);
                break;

            default:
                log(`Unknown event type: ${event.type}`);
        }
    }

    // Helper pour obtenir la position d'un slot
    function getSlotPosition(owner, row, col) {
        const key = `${owner}-${row}-${col}`;
        if (slotPositions[key]) {
            return slotPositions[key];
        }
        // Fallback
        return { x: 0, y: 0 };
    }

    // Animation de soin
    function showHealNumber(x, y, amount) {
        const healEl = document.createElement('div');
        healEl.className = 'resolution-heal-number';
        healEl.textContent = `+${amount}`;
        healEl.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            transform: translate(-50%, -50%);
            font-size: 28px;
            font-weight: bold;
            color: #2ecc71;
            text-shadow: 2px 2px 4px black;
            z-index: ${CONFIG.OVERLAY_Z_INDEX + 100};
            pointer-events: none;
            animation: healFloat 1s ease-out forwards;
        `;
        document.body.appendChild(healEl);
        setTimeout(() => healEl.remove(), 1000);
    }

    // Animation de buff
    function showBuffNumber(x, y, atk, hp) {
        const buffEl = document.createElement('div');
        buffEl.className = 'resolution-buff-number';
        buffEl.textContent = `+${atk}/+${hp}`;
        buffEl.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            transform: translate(-50%, -50%);
            font-size: 24px;
            font-weight: bold;
            color: #f1c40f;
            text-shadow: 2px 2px 4px black;
            z-index: ${CONFIG.OVERLAY_Z_INDEX + 100};
            pointer-events: none;
            animation: buffFloat 1s ease-out forwards;
        `;
        document.body.appendChild(buffEl);
        setTimeout(() => buffEl.remove(), 1000);
    }

    function showPhaseMessage(text) {
        // Utiliser le système existant si disponible
        if (typeof showPhasePopup === 'function') {
            showPhasePopup(text);
        } else {
            log(`Phase: ${text}`);
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== PUBLIC API ====================

    // Réinitialisation forcée (quand la fenêtre revient au premier plan)
    function forceReset() {
        log('Force reset called');
        stopRenderLoop();
        clearAnimatedObjects();
        destroyOverlay();
        setState(State.IDLE);
        resolutionPacket = null;
        animationTimeline = [];
        currentAnimationIndex = 0;
    }

    return {
        // Jouer un paquet de résolution
        play: play,

        // Vérifier si une animation est en cours
        isAnimating: isAnimating,

        // Obtenir l'état actuel
        getState: () => currentState,

        // Réinitialisation forcée
        forceReset: forceReset,

        // Callback de fin
        onComplete: (callback) => { onCompleteCallback = callback; },

        // Configuration
        setSpeed: (speed) => { CONFIG.ANIMATION_SPEED = speed; },
        setDebug: (debug) => { CONFIG.DEBUG = debug; },

        // États (pour référence externe)
        State: State
    };

})();

// Ajouter le CSS pour les animations
const resolutionCSS = document.createElement('style');
resolutionCSS.textContent = `
@keyframes damageFloat {
    0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    100% { opacity: 0; transform: translate(-50%, -150%) scale(1.5); }
}

@keyframes healFloat {
    0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    100% { opacity: 0; transform: translate(-50%, -150%) scale(1.5); }
}

@keyframes buffFloat {
    0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    100% { opacity: 0; transform: translate(-50%, -150%) scale(1.3); }
}

#resolution-overlay {
    background: transparent;
}
`;
document.head.appendChild(resolutionCSS);

// Exposer globalement
window.ResolutionPlayer = ResolutionPlayer;

console.log('[ResolutionPlayer] Module loaded');
