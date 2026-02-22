// =============================================
// Système de Drag & Drop Professionnel
// =============================================
// Remplace le drag natif HTML5 par un système custom
// avec animations fluides, tilt 3D et feedback visuel

const CustomDrag = (function() {
    // ==========================================
    // État
    // ==========================================
    let dragState = null;
    let ghostEl = null;
    let isDraggingFlag = false;
    let isArrowMode = false;
    let rafId = null;
    let lastHoverTarget = null;

    // Position souris courante
    let mouseX = 0;
    let mouseY = 0;
    let prevMouseX = 0;
    let prevMouseY = 0;

    // Tilt 3D lissé
    let tiltX = 0;
    let tiltY = 0;

    // Callbacks externes
    let onDragStart = null;
    let onDragMove = null;
    let onDragEnd = null;
    let onDrop = null;
    let canDragCheck = null;
    let arrowModeCheck = null;

    // ==========================================
    // Configuration
    // ==========================================
    const config = {
        dragThreshold: 8,
        ghostScale: 1,
        ghostOpacity: 0.92,
        liftDuration: 180,
        dropDuration: 200,
        returnDuration: 250,
        tiltMaxDeg: 8,
        tiltSmoothing: 0.12
    };

    // ==========================================
    // Ghost Management
    // ==========================================

    /**
     * Crée le ghost - utilise makeCard() pour un rendu propre
     */
    function createGhost(data, sourceEl) {
        const container = document.createElement('div');
        container.className = 'drag-ghost-container';

        // Créer la carte via makeCard (version terrain = léger)
        let cardEl;
        const card = data.card || data;
        if (typeof makeCard === 'function') {
            cardEl = makeCard(card, false);
        } else {
            // Fallback: clone simple
            cardEl = sourceEl.cloneNode(true);
        }
        cardEl.classList.add('drag-ghost-card');
        cardEl.classList.remove('dragging', 'selected', 'can-attack', 'just-played', 'shake');
        // Retirer les event listeners en clonant
        const cleanCard = cardEl.cloneNode(true);
        container.appendChild(cleanCard);

        // Positionner sur la carte source, taille = slot visuel (--card-w × --card-h × gameScale)
        const rect = sourceEl.getBoundingClientRect();
        const rootStyle = getComputedStyle(document.documentElement);
        const gameScale = parseFloat(rootStyle.getPropertyValue('--game-scale')) || 1;
        const baseW = parseFloat(rootStyle.getPropertyValue('--card-w')) || 144;
        const baseH = parseFloat(rootStyle.getPropertyValue('--card-h')) || 192;
        const ghostW = baseW * gameScale;
        const ghostH = baseH * gameScale;
        // Centrer le ghost sur le centre de la carte source
        const ghostLeft = rect.left + (rect.width - ghostW) / 2;
        const ghostTop = rect.top + (rect.height - ghostH) / 2;
        container.style.cssText = `
            position: fixed;
            left: ${ghostLeft}px;
            top: ${ghostTop}px;
            width: ${ghostW}px;
            height: ${ghostH}px;
            z-index: 10000;
            pointer-events: none;
            will-change: transform;
            transform-origin: center center;
            transform: translate3d(0px, 0px, 0px) scale(1);
        `;

        document.body.appendChild(container);

        // Re-fit le nom de la carte (la taille a changé par rapport à la main)
        if (typeof autoFitCardName === 'function') {
            autoFitCardName(cleanCard);
        }

        return container;
    }

    /**
     * Détruit le ghost
     */
    function destroyGhost() {
        if (ghostEl) {
            ghostEl.remove();
            ghostEl = null;
        }
    }

    // ==========================================
    // Boucle de rendu (rAF)
    // ==========================================

    function startRenderLoop() {
        function loop() {
            if (!isDraggingFlag || !ghostEl || !dragState) return;
            updateGhostTransform();
            rafId = requestAnimationFrame(loop);
        }
        rafId = requestAnimationFrame(loop);
    }

    function stopRenderLoop() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

    /**
     * Met à jour la position et le tilt du ghost
     */
    function updateGhostTransform() {
        if (!ghostEl || !dragState) return;

        // Calculer le déplacement depuis la position d'origine
        const dx = mouseX - dragState.offsetX - dragState.originRect.left;
        const dy = mouseY - dragState.offsetY - dragState.originRect.top;

        // Calculer la vélocité pour le tilt
        const velX = mouseX - prevMouseX;
        const velY = mouseY - prevMouseY;
        prevMouseX = mouseX;
        prevMouseY = mouseY;

        // Tilt cible basé sur la vélocité
        const targetTiltY = clamp((velX / 8) * config.tiltMaxDeg, -config.tiltMaxDeg, config.tiltMaxDeg);
        const targetTiltX = clamp((-velY / 8) * config.tiltMaxDeg, -config.tiltMaxDeg, config.tiltMaxDeg);

        // Lissage exponentiel
        tiltX += (targetTiltX - tiltX) * config.tiltSmoothing;
        tiltY += (targetTiltY - tiltY) * config.tiltSmoothing;

        // Appliquer la transformation (10deg = inclinaison du board)
        const boardTilt = 10;
        ghostEl.style.transform =
            `translate3d(${dx}px, ${dy}px, 0) ` +
            `scale(${config.ghostScale}) ` +
            `perspective(1000px) rotateX(${(boardTilt + tiltX).toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg)`;
    }

    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    // ==========================================
    // Drop Target Detection
    // ==========================================

    /**
     * Trouve la cible de drop sous le curseur
     */
    function getDropTargetAt(x, y) {
        const element = document.elementFromPoint(x, y);
        if (!element) return null;

        // Chercher le slot ou la zone de drop
        const slot = element.closest('.card-slot, .trap-slot, .hero-card, .global-spell-zone');
        if (!slot) return null;

        return {
            element: slot,
            type: slot.classList.contains('card-slot') ? 'field' :
                  slot.classList.contains('trap-slot') ? 'trap' :
                  slot.classList.contains('hero-card') ? 'hero' :
                  slot.classList.contains('global-spell-zone') ? 'global' : null,
            owner: slot.dataset.owner,
            row: parseInt(slot.dataset.row),
            col: parseInt(slot.dataset.col)
        };
    }

    /**
     * Gère le feedback visuel de hover
     */
    function updateHoverFeedback(x, y) {
        const target = getDropTargetAt(x, y);

        // Retirer le hover de l'ancienne cible
        if (lastHoverTarget && lastHoverTarget.element !== (target && target.element)) {
            lastHoverTarget.element.classList.remove('drag-hover', 'drag-over', 'hero-drag-over');
            // Retirer le highlight de la créature dans l'ancien slot
            const oldCard = lastHoverTarget.element.querySelector && lastHoverTarget.element.querySelector('.card');
            if (oldCard) oldCard.classList.remove('spell-hover-target');
        }

        // Ajouter le hover à la nouvelle cible
        if (target && target.element) {
            const isValid = target.element.classList.contains('valid-target') ||
                           target.element.classList.contains('moveable') ||
                           target.element.classList.contains('hero-targetable') ||
                           target.element.classList.contains('active');

            if (isValid) {
                if (target.type === 'hero') {
                    target.element.classList.add('hero-drag-over');
                } else if (target.type === 'global') {
                    target.element.classList.add('drag-over');
                } else {
                    target.element.classList.add('drag-hover', 'drag-over');
                    // Si le slot contient une créature, la mettre en surbrillance orange
                    const cardInSlot = target.element.querySelector('.card');
                    if (cardInSlot) cardInSlot.classList.add('spell-hover-target');
                }
            } else {
                // Pas valide — s'assurer que la créature n'est pas highlightée
                const cardInSlot = target.element.querySelector('.card');
                if (cardInSlot) cardInSlot.classList.remove('spell-hover-target');
            }

            // Tilt de la flèche si survol d'une cible valide
            if (isArrowMode && typeof ArrowTargeting !== 'undefined') {
                ArrowTargeting.setTiltTarget(isValid);
            }
        } else {
            // Pas de cible sous le curseur — désactiver le tilt
            if (isArrowMode && typeof ArrowTargeting !== 'undefined') {
                ArrowTargeting.setTiltTarget(false);
            }
        }

        // Reset global zone style si on la quitte
        if (lastHoverTarget && lastHoverTarget.type === 'global' &&
            (!target || target.element !== lastHoverTarget.element)) {
            lastHoverTarget.element.classList.remove('drag-over');
        }

        lastHoverTarget = target;
    }

    // ==========================================
    // Animations
    // ==========================================

    /**
     * Animation de snap vers la cible (drop réussi)
     */
    function animateSnap(targetEl, callback) {
        // Drop instantané : le ghost disparaît, la carte apparaît dans le slot via render()
        // Ne pas restaurer la visibilité de la carte source — évite un flash dans la main
        if (dragState && dragState.sourceEl) {
            dragState.sourceEl.classList.remove('custom-dragging', 'arrow-dragging');
            dragState.sourceEl = null; // cleanup() ne restaurera pas visibility
        }
        cleanup();
        if (callback) callback();
    }

    /**
     * Animation de retour à la position d'origine (drop invalide)
     */
    function animateReturn(callback) {
        if (!ghostEl || !dragState) {
            cleanup();
            if (callback) callback();
            return;
        }

        stopRenderLoop();

        ghostEl.classList.add('returning');

        requestAnimationFrame(() => {
            if (!ghostEl) return;
            ghostEl.style.transform = 'translate3d(0px, 0px, 0px) scale(1) rotateX(0deg) rotateY(0deg)';
            ghostEl.style.opacity = '0.4';
        });

        setTimeout(() => {
            cleanup();
            if (callback) callback();
        }, config.returnDuration);
    }

    // ==========================================
    // Nettoyage
    // ==========================================

    function cleanup() {
        stopRenderLoop();
        destroyGhost();

        if (dragState && dragState.sourceEl) {
            dragState.sourceEl.classList.remove('custom-dragging', 'arrow-dragging');
            dragState.sourceEl.style.visibility = '';
        }
        if (typeof CardGlow !== 'undefined') CardGlow.markDirty();

        // Retirer les classes de survol
        document.querySelectorAll('.drag-hover, .drag-over').forEach(el => {
            el.classList.remove('drag-hover', 'drag-over');
        });
        document.querySelectorAll('.hero-drag-over').forEach(el => {
            el.classList.remove('hero-drag-over');
        });
        document.querySelectorAll('.spell-hover-target').forEach(el => {
            el.classList.remove('spell-hover-target');
        });

        // Reset global zone
        const globalZone = document.querySelector('.global-spell-zone');
        if (globalZone) {
            globalZone.classList.remove('drag-over');
        }

        dragState = null;
        isDraggingFlag = false;
        isArrowMode = false;
        lastHoverTarget = null;
        tiltX = 0;
        tiltY = 0;

        // Restaurer la sélection de texte
        document.body.style.userSelect = '';
    }

    // ==========================================
    // Event Handlers
    // ==========================================

    function handleMouseDown(e, sourceEl, data) {
        // Seulement bouton gauche
        if (e.button !== 0) return;

        // Pas de double drag
        if (isDraggingFlag) return;

        // Vérifier si le drag est autorisé
        if (canDragCheck && !canDragCheck()) return;

        // Empêcher le drag natif et la sélection
        e.preventDefault();
        e.stopPropagation();

        const rect = sourceEl.getBoundingClientRect();

        dragState = {
            sourceEl: sourceEl,
            data: data,
            startX: e.clientX,
            startY: e.clientY,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            originRect: {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height
            },
            hasMoved: false
        };

        mouseX = e.clientX;
        mouseY = e.clientY;
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;

        // Empêcher la sélection de texte
        document.body.style.userSelect = 'none';

        // Listeners globaux
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }

    function handleMouseMove(e) {
        if (!dragState) return;

        mouseX = e.clientX;
        mouseY = e.clientY;

        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Seuil minimum pour activer le drag
        if (!isDraggingFlag && distance < config.dragThreshold) return;

        if (!isDraggingFlag) {
            // Premier mouvement significatif — démarrer le drag
            isDraggingFlag = true;

            // Vérifier si on utilise le mode flèche (sorts/pièges)
            if (arrowModeCheck && arrowModeCheck(dragState.data)) {
                isArrowMode = true;

                // La carte se lève mais reste en place
                dragState.sourceEl.classList.add('arrow-dragging');
                if (typeof CardGlow !== 'undefined') CardGlow.markDirty();

                // Activer la flèche WebGL depuis le haut de la carte
                if (typeof ArrowTargeting !== 'undefined') {
                    ArrowTargeting.init();
                    const rect = dragState.sourceEl.getBoundingClientRect();
                    ArrowTargeting.activate(rect.left + rect.width / 2, rect.top);
                }
            } else {
                isArrowMode = false;

                // Mode classique : créer le ghost (taille slot)
                ghostEl = createGhost(dragState.data, dragState.sourceEl);

                // Mettre à jour originRect/offset pour le ghost slot-sized
                const ghostRect = ghostEl.getBoundingClientRect();
                dragState.originRect = {
                    left: ghostRect.left,
                    top: ghostRect.top,
                    width: ghostRect.width,
                    height: ghostRect.height
                };
                dragState.offsetX = mouseX - ghostRect.left;
                dragState.offsetY = mouseY - ghostRect.top;

                // Masquer la carte source
                dragState.sourceEl.classList.add('custom-dragging');
                dragState.sourceEl.style.visibility = 'hidden';

                // Démarrer la boucle de rendu immédiatement (pas de délai)
                startRenderLoop();
            }

            // Callback de démarrage
            if (onDragStart) {
                onDragStart(dragState.data, dragState.sourceEl);
            }
        }

        dragState.hasMoved = true;

        // Mettre à jour la flèche si mode arrow
        if (isArrowMode && typeof ArrowTargeting !== 'undefined') {
            ArrowTargeting.updateEnd(e.clientX, e.clientY);
        }

        // Feedback de hover — utiliser la pointe de la flèche en mode arrow
        if (isArrowMode && typeof ArrowTargeting !== 'undefined') {
            const tip = ArrowTargeting.getTipPos();
            updateHoverFeedback(tip.x, tip.y);
        } else {
            updateHoverFeedback(e.clientX, e.clientY);
        }

        // Callback de mouvement — passer la position de la pointe en mode arrow
        if (onDragMove) {
            if (isArrowMode && typeof ArrowTargeting !== 'undefined') {
                const tip = ArrowTargeting.getTipPos();
                onDragMove(tip.x, tip.y, dragState.data);
            } else {
                onDragMove(e.clientX, e.clientY, dragState.data);
            }
        }
    }

    function handleMouseUp(e) {
        // Retirer les listeners globaux
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        if (!dragState) return;

        const wasClick = !dragState.hasMoved || !isDraggingFlag;

        if (wasClick) {
            // C'était un clic, pas un drag
            cleanup();
            return;
        }

        // Trouver la cible — utiliser la pointe de la flèche en mode arrow
        let detectX = e.clientX, detectY = e.clientY;
        if (isArrowMode && typeof ArrowTargeting !== 'undefined') {
            const tip = ArrowTargeting.getTipPos();
            detectX = tip.x;
            detectY = tip.y;
        }
        const target = getDropTargetAt(detectX, detectY);

        let dropAccepted = false;

        if (target && onDrop) {
            dropAccepted = onDrop(dragState.data, target, dragState.sourceEl);
        }

        // Mode flèche : pas de ghost, pas d'animation snap/return
        if (isArrowMode) {
            if (typeof ArrowTargeting !== 'undefined') {
                ArrowTargeting.deactivate();
            }
            const savedData = dragState ? { ...dragState.data } : null;
            cleanup();
            if (onDragEnd) {
                onDragEnd(savedData, dropAccepted);
            }
            return;
        }

        // Mode classique avec ghost
        if (dropAccepted && target) {
            // Animation snap vers la cible
            animateSnap(target.element, () => {
                if (onDragEnd) {
                    onDragEnd(dragState ? dragState.data : null, true);
                }
            });
        } else {
            // Animation de retour
            const savedData = dragState ? { ...dragState.data } : null;
            animateReturn(() => {
                if (onDragEnd) {
                    onDragEnd(savedData, false);
                }
            });
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'Escape' && isDraggingFlag) {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            if (isArrowMode) {
                if (typeof ArrowTargeting !== 'undefined') ArrowTargeting.deactivate();
                const savedData = dragState ? { ...dragState.data } : null;
                cleanup();
                if (onDragEnd) onDragEnd(savedData, false);
            } else {
                const savedData = dragState ? { ...dragState.data } : null;
                animateReturn(() => {
                    if (onDragEnd) onDragEnd(savedData, false);
                });
            }
        }
    }

    function handleWindowBlur() {
        if (isDraggingFlag) {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            if (isArrowMode) {
                if (typeof ArrowTargeting !== 'undefined') ArrowTargeting.deactivate();
                const savedData = dragState ? { ...dragState.data } : null;
                cleanup();
                if (onDragEnd) onDragEnd(savedData, false);
            } else {
                const savedData = dragState ? { ...dragState.data } : null;
                animateReturn(() => {
                    if (onDragEnd) onDragEnd(savedData, false);
                });
            }
        }
    }

    // Listeners globaux permanents
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleWindowBlur);

    // ==========================================
    // API Publique
    // ==========================================

    return {
        /**
         * Active le drag sur un élément
         */
        makeDraggable(el, data) {
            el._dragData = data; // Référence mutable pour mise à jour par le fast-path
            // Guard : ne pas empiler de listeners sur le même élément
            if (!el._dragMouseDown) {
                el._dragMouseDown = (e) => handleMouseDown(e, el, el._dragData);
                el.addEventListener('mousedown', el._dragMouseDown);
            }

            // Empêcher le drag natif
            el.draggable = false;
            el.ondragstart = (e) => e.preventDefault();
        },

        /**
         * Configure les callbacks
         */
        setCallbacks({ dragStart, dragMove, dragEnd, drop, canDrag, arrowMode }) {
            onDragStart = dragStart;
            onDragMove = dragMove;
            onDragEnd = dragEnd;
            onDrop = drop;
            canDragCheck = canDrag;
            arrowModeCheck = arrowMode || null;
        },

        /**
         * Annule le drag en cours
         */
        cancel() {
            if (isDraggingFlag) {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                if (isArrowMode) {
                    if (typeof ArrowTargeting !== 'undefined') ArrowTargeting.deactivate();
                    cleanup();
                } else {
                    animateReturn();
                }
            } else {
                cleanup();
            }
        },

        /**
         * Vérifie si un drag est en cours
         */
        isDragging() {
            return isDraggingFlag;
        },

        /**
         * Récupère l'état actuel du drag
         */
        getState() {
            return dragState ? { ...dragState } : null;
        },

        /**
         * Détection de cible (exposée pour le cross-spell preview)
         */
        getDropTargetAt: getDropTargetAt,

        /**
         * Configure les options
         */
        configure(options) {
            Object.assign(config, options);
        }
    };
})();

// Exposer globalement
window.CustomDrag = CustomDrag;
