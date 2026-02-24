/**
 * Combat Animations System - Hybrid DOM + PixiJS VFX
 * - Mouvements des créatures en DOM (mêlée/volant se déplacent, tireur tire)
 * - Griffures (claw) pour les dégâts de combat
 * - Croix (X) pour les dégâts de sort single-target
 * - Shockwave + screen shake aux impacts
 */

class CombatAnimationSystem {
    constructor() {
        this.initialized = false;
        this.TIMINGS = {
            PROJECTILE_FLIGHT: 400,
            ATTACK_MOVE: 300,
            ATTACK_RETURN: 250,
            BETWEEN_PHASES: 200,
        };
    }

    async init() {
        this.initialized = true;
        await CombatVFX.init();
        return Promise.resolve();
    }

    // ==================== UTILITAIRES ====================

    getCardElement(owner, row, col) {
        const slot = getSlot(owner, row, col);
        return slot?.querySelector('.card');
    }

    getSlotCenter(owner, row, col) {
        const slot = getSlot(owner, row, col);
        if (!slot) return null;
        const rect = slot.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    getHeroCenter(owner) {
        const heroEl = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');
        if (!heroEl) return null;
        const rect = heroEl.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    /** Scale factor du game-scaler (zoom) */
    get _S() {
        const scaler = document.getElementById('game-scaler');
        if (!scaler) return 1;
        return parseFloat(scaler.style.zoom) || 1;
    }

    /** Convertit des pixels écran en pixels CSS (espace local du scaler) */
    _toLocal(screenPx) { return screenPx / this._S; }

    /** Coords viewport — passées telles quelles (le main app n'a pas de stage transform) */
    _V(x, y) { return { x, y }; }

    /** Taille viewport — passée telle quelle */
    _VS(viewportPx) { return viewportPx; }

    /** Met à jour les HP affichés sur une carte au moment de l'impact.
     *  Pose aussi un marqueur data-visual-dmg-hp pour empêcher render()
     *  d'écraser la valeur avec un state stale (race condition serveur). */
    _applyVisualDamage(cardEl, damage, attackEventTs) {
        if (!cardEl || !damage) return;
        const hpEl = cardEl.querySelector('.arena-hp') || cardEl.querySelector('.arena-armor');
        if (!hpEl) return;
        const currentHp = parseInt(hpEl.textContent) || 0;
        const newHp = currentHp - damage;
        const cardName = cardEl.querySelector('.arena-name')?.textContent || '?';
        const isRadjawak = cardName.toLowerCase().includes('radjawak');
        const stateHp = parseInt(cardEl.dataset.stateHp || '', 10);
        const stateSyncAt = parseInt(cardEl.dataset.stateHpSyncAt || '0', 10);
        const hasNewerStateThanAttack =
            Number.isFinite(attackEventTs) &&
            stateSyncAt > 0 &&
            stateSyncAt > attackEventTs &&
            Number.isFinite(stateHp);

        if (hasNewerStateThanAttack) {
            if (currentHp <= 0 && stateHp > 0) {
                if (window.DEBUG_LOGS) console.log(`[HP-VIS-DBG] visual-skip-newer card=${cardName} uid=${cardEl.dataset.uid || '-'} domHp=${currentHp} stateHp=${stateHp} eventTs=${attackEventTs}`);
            }
            if (isRadjawak) {
                if (window.DEBUG_LOGS) console.log(
                    `[RADJ-DBG] visual-damage skip-newer-state card=${cardName} uid=${cardEl.dataset.uid || '-'} eventTs=${attackEventTs} stateSyncAt=${stateSyncAt} stateHp=${stateHp} domHp=${currentHp} damage=${damage}`
                );
            }
            hpEl.textContent = String(stateHp);
            delete cardEl.dataset.visualDmgHp;
            delete cardEl.dataset.visualDmgSetAt;
            return;
        }

        if (isRadjawak) {
            if (window.DEBUG_LOGS) console.log(`[RADJ-DBG] visual-damage start card=${cardName} uid=${cardEl.dataset.uid || '-'} domHpBefore=${currentHp} damage=${damage} domHpAfter=${newHp}`);
        }
        // if (window.DEBUG_LOGS) console.log(`[VISUAL_DMG] ${cardName}: HP ${currentHp} ? ${newHp} (damage=${damage})`);
        hpEl.textContent = newHp;
        if (newHp <= 0) {
            if (window.DEBUG_LOGS) console.log(`[HP-VIS-DBG] visual-apply-zero card=${cardName} uid=${cardEl.dataset.uid || '-'} domHpBefore=${currentHp} damage=${damage} newHp=${newHp} eventTs=${attackEventTs}`);
        }
        hpEl.classList.add('reduced');
        hpEl.classList.remove('boosted');
        // Marqueur anti-flicker : render() ne doit pas ecraser avec un state stale
        cardEl.dataset.visualDmgHp = String(newHp);
        cardEl.dataset.visualDmgSetAt = String(Date.now());
        if (isRadjawak) {
            if (window.DEBUG_LOGS) console.log(`[RADJ-DBG] visual-damage marker-set card=${cardName} visualDmgHp=${cardEl.dataset.visualDmgHp}`);
        }
    }

    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Animation rAF-based pour interpoler des valeurs avec easing
     * @returns Promise qui résout à la fin
     */
    _animate(durationMs, fn, easing = t => t * (2 - t)) {
        return new Promise(resolve => {
            const start = performance.now();
            const step = () => {
                const raw = Math.min((performance.now() - start) / durationMs, 1);
                const eased = easing(raw);
                fn(eased, raw);
                if (raw >= 1) resolve();
                else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    }

    /**
     * Crée un container PIXI positionné au centre d'une carte pour y dessiner des FX
     */
    _createCardFxLayer(x, y) {
        const p = this._V(x, y);
        const c = new PIXI.Container();
        c.position.set(p.x, p.y);
        CombatVFX.container.addChild(c);
        const self = this;
        return {
            container: c,
            moveTo(nx, ny) { const np = self._V(nx, ny); c.position.set(np.x, np.y); },
            cleanup() { if (c.parent) c.parent.removeChild(c); c.destroy({ children: true }); }
        };
    }

    // ==================== EFFET DE DÉGÂTS ====================

    showDamageEffect(x, y, damage) {
        const p = this._V(x, y);
        CombatVFX.createDamageExplosion(p.x, p.y, damage);
    }

    // ==================== ANIMATION PROJECTILE (TIREUR) ====================

    /**
     * Un projectile part du tireur vers la cible
     * LE TIREUR NE BOUGE PAS — griffures à l'impact
     */
    async animateProjectile(data) {
        const { startOwner, startRow, startCol, targetOwner, targetRow, targetCol, damage, attackEventTs } = data;

        const startPos = this.getSlotCenter(startOwner, startRow, startCol);
        const endPos = targetCol === -1
            ? this.getHeroCenter(targetOwner)
            : this.getSlotCenter(targetOwner, targetRow, targetCol);

        if (!startPos || !endPos) return;

        // Recul du tireur
        const shooterCard = this.getCardElement(startOwner, startRow, startCol);
        if (shooterCard) {
            shooterCard.classList.add('shooting');
            setTimeout(() => shooterCard.classList.remove('shooting'), 300);
        }

        // Projectile PixiJS (coords VFX = espace scaler)
        const sp = this._V(startPos.x, startPos.y);
        const ep = this._V(endPos.x, endPos.y);
        await CombatVFX.animateProjectile(
            sp.x, sp.y,
            ep.x, ep.y,
            this.TIMINGS.PROJECTILE_FLIGHT
        );

        // Impact : griffures + dégâts
        if (targetCol === -1) {
            // Impact héros
            CombatVFX.createProjectileImpact(ep.x, ep.y, damage);
            const heroEl = document.getElementById(targetOwner === 'me' ? 'hero-me' : 'hero-opp');
            if (heroEl) {
                heroEl.classList.add('hero-hit');
                setTimeout(() => heroEl.classList.remove('hero-hit'), 550);
            }
        } else {
            // Impact créature : shake + dégâts
            CombatVFX.screenShake(8, 0.88, 300);
            if (damage !== undefined) {
                this.showDamageEffect(endPos.x, endPos.y, damage);
                const targetCard = this.getCardElement(targetOwner, targetRow, targetCol);
                this._applyVisualDamage(targetCard, damage, attackEventTs);
            }
            await this.wait(200);
        }
    }

    // ==================== ATTAQUE SOLO (mêlée/volant) ====================

    /**
     * Charge vers la cible, griffures, knockback, retour
     */
    /**
     * Helper : applique un knockback via transform CSS.
     * Le flottement des volants est déjà suspendu quand data-in-combat=true.
     */
    _applyKnockback(card, knockX, knockY, L) {
        const setTf = tf => { card.style.transform = tf; };
        const clearTf = () => { card.style.transform = ''; };
        return { setTf, clearTf };
    }

    _liftCombatLayer(card, zIndex = 1200) {
        if (!card) return () => {};
        const slot = card.closest('.card-slot');
        const prev = {
            cardZ: card.style.zIndex,
            slotZ: slot ? slot.style.zIndex : '',
            slotPos: slot ? slot.style.position : ''
        };
        card.style.zIndex = String(zIndex);
        if (slot) {
            if (!slot.style.position) slot.style.position = 'relative';
            slot.style.zIndex = String(zIndex - 1);
        }
        return () => {
            card.style.zIndex = prev.cardZ;
            if (slot) {
                slot.style.zIndex = prev.slotZ;
                slot.style.position = prev.slotPos;
            }
        };
    }

    async animateSoloAttack(data) {
        const { attackerOwner, attackerRow, attackerCol, targetOwner, targetRow, targetCol, damage, riposteDamage, attackEventTs } = data;
        const L = v => this._toLocal(v);

        const attackerCard = this.getCardElement(attackerOwner, attackerRow, attackerCol);
        if (!attackerCard) return;

        attackerCard.dataset.inCombat = 'true';
        let targetCard = null;
        let targetWasInCombat = false;
        let restoreAttackerLayer = null;
        let restoreTargetLayer = null;
        try {
            let targetPos;
            if (targetCol === -1) targetPos = this.getHeroCenter(targetOwner);
            else targetPos = this.getSlotCenter(targetOwner, targetRow, targetCol);
            if (!targetPos) return;

            const atkRect = attackerCard.getBoundingClientRect();
            const atkPos = { x: atkRect.left + atkRect.width / 2, y: atkRect.top + atkRect.height / 2 };
            const dx = targetPos.x - atkPos.x;
            const dy = targetPos.y - atkPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const dirX = dx / dist;
            const dirY = dy / dist;
            const atkHalf = (Math.abs(dirX) * atkRect.width + Math.abs(dirY) * atkRect.height) / 2;
            const gap = 5;
            const stopDist = atkHalf + gap;
            const chargeDX = dx - dirX * stopDist;
            const chargeDY = dy - dirY * stopDist;

            restoreAttackerLayer = this._liftCombatLayer(attackerCard, 1200);

            attackerCard.style.transition = 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)';
            attackerCard.style.transform = `translate(${L(-dirX * 25)}px, ${L(-dirY * 25)}px)`;
            await this.wait(200);

            attackerCard.style.transition = 'transform 140ms cubic-bezier(0.9, 0, 1, 1)';
            attackerCard.style.transform = `translate(${L(chargeDX)}px, ${L(chargeDY)}px)`;
            await this.wait(140);

            attackerCard.style.transition = 'none';
            CombatVFX.screenShake(14, 0.86, 400);
            { const vp = this._V(targetPos.x, targetPos.y); CombatVFX.createShockwave(vp.x, vp.y, 100, 500); }

            if (targetCol === -1) {
                if (damage !== undefined) this.showDamageEffect(targetPos.x, targetPos.y, damage);
                const heroEl = document.getElementById(targetOwner === 'me' ? 'hero-me' : 'hero-opp');
                if (heroEl) {
                    heroEl.style.animation = 'heroShake 0.5s ease-out';
                    heroEl.classList.add('hero-hit');
                    setTimeout(() => { heroEl.style.animation = ''; heroEl.classList.remove('hero-hit'); }, 550);
                    const heroRect = heroEl.getBoundingClientRect();
                    const hp = this._V(heroRect.left + heroRect.width / 2, heroRect.top + heroRect.height / 2);
                    CombatVFX.createHeroHitEffect(hp.x, hp.y, this._VS(heroRect.width), this._VS(heroRect.height));
                }
                await this.wait(100);
                attackerCard.style.transition = 'transform 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                attackerCard.style.transform = '';
                await this.wait(300);
                return;
            }

            targetCard = this.getCardElement(targetOwner, targetRow, targetCol);
            if (targetCard) {
                targetWasInCombat = targetCard.dataset.inCombat === 'true';
                // Suspend aussi la lévitation de la cible pendant knockback/riposte.
                targetCard.dataset.inCombat = 'true';
                restoreTargetLayer = this._liftCombatLayer(targetCard, 1201);
            }

            if (damage !== undefined) {
                this.showDamageEffect(targetPos.x, targetPos.y, damage);
                this._applyVisualDamage(targetCard, damage, attackEventTs);
            }

            const knockScreen = stopDist;
            const knockX = dirX * knockScreen;
            const knockY = dirY * knockScreen;
            if (targetCard) {
                const { setTf } = this._applyKnockback(targetCard, knockX, knockY, L);
                await this._animate(180, t => {
                    const kx = knockX * t;
                    const ky = knockY * t;
                    const s = t < 0.55 ? 0.1 * Math.sin((t / 0.55) * Math.PI) : 0;
                    setTf(`translate(${L(kx)}px, ${L(ky)}px) scaleX(${1 - s}) scaleY(${1 + s * 0.6})`);
                }, t => (--t) * t * t + 1);
            }

            await this.wait(260);

            if (riposteDamage !== undefined && riposteDamage > 0 && targetCard) {
                const { setTf, clearTf } = this._applyKnockback(targetCard, 0, 0, L);

                attackerCard.style.transition = 'transform 100ms ease-out';
                attackerCard.style.transform = `translate(${L(chargeDX - dirX * 18)}px, ${L(chargeDY - dirY * 18)}px)`;
                await this.wait(100);

                const atkCurrentX = atkPos.x + chargeDX - dirX * 18;
                const atkCurrentY = atkPos.y + chargeDY - dirY * 18;
                const targetCurrentX = targetPos.x + knockX;
                const targetCurrentY = targetPos.y + knockY;
                const riposteDX = atkCurrentX - targetCurrentX;
                const riposteDY = atkCurrentY - targetCurrentY;
                const riposteDist = Math.sqrt(riposteDX * riposteDX + riposteDY * riposteDY) || 1;
                const riposteDirX = riposteDX / riposteDist;
                const riposteDirY = riposteDY / riposteDist;
                const tgtRect = targetCard.getBoundingClientRect();
                const tgtHalf = (Math.abs(riposteDirX) * tgtRect.width + Math.abs(riposteDirY) * tgtRect.height) / 2;
                const riposteStopDist = tgtHalf + gap;
                const riposteDestX = knockX + (riposteDX - riposteDirX * riposteStopDist);
                const riposteDestY = knockY + (riposteDY - riposteDirY * riposteStopDist);

                await this._animate(120, t => {
                    const rx = knockX + (riposteDestX - knockX) * t;
                    const ry = knockY + (riposteDestY - knockY) * t;
                    setTf(`translate(${L(rx)}px, ${L(ry)}px)`);
                }, t => t * t);

                CombatVFX.screenShake(10, 0.88, 300);
                { const vp = this._V(atkCurrentX, atkCurrentY); CombatVFX.createShockwave(vp.x, vp.y, 80, 450); }
                this.showDamageEffect(atkCurrentX, atkCurrentY, riposteDamage);
                this._applyVisualDamage(attackerCard, riposteDamage, attackEventTs);

                attackerCard.style.transition = 'transform 260ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                attackerCard.style.transform = '';

                await this._animate(260, t => {
                    const rx = riposteDestX * (1 - t);
                    const ry = riposteDestY * (1 - t);
                    setTf(`translate(${L(rx)}px, ${L(ry)}px)`);
                }, t => t * (2 - t));
                clearTf();
            } else {
                const returnPromises = [];
                if (targetCard) {
                    const { setTf, clearTf } = this._applyKnockback(targetCard, knockX, knockY, L);
                    returnPromises.push(
                        this._animate(260, t => {
                            const kx = knockX * (1 - t);
                            const ky = knockY * (1 - t);
                            const tremble = (1 - t) * 2.4;
                            const tx = (Math.random() - 0.5) * tremble * 2;
                            const ty = (Math.random() - 0.5) * tremble * 2;
                            setTf(`translate(${L(kx + tx)}px, ${L(ky + ty)}px)`);
                        }, t => t * (2 - t)).then(() => clearTf())
                    );
                }

                attackerCard.style.transition = 'transform 260ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                attackerCard.style.transform = '';
                returnPromises.push(this.wait(260));
                await Promise.all(returnPromises);
            }
        } finally {
            attackerCard.style.transition = '';
            attackerCard.style.transform = '';
            attackerCard.style.zIndex = '';
            if (targetCard) {
                targetCard.style.transition = '';
                targetCard.style.transform = '';
                targetCard.style.zIndex = '';
                if (!targetWasInCombat) {
                    // Si la cible n'était pas dans le combat de ligne actif, restaurer son état.
                    targetCard.dataset.inCombat = 'false';
                }
            }
            if (restoreTargetLayer) restoreTargetLayer();
            if (restoreAttackerLayer) restoreAttackerLayer();
        }
    }

    // ==================== COMBAT MUTUEL MÊLÉE — CLASH ====================

    /**
     * Les deux créatures chargent vers le centre, griffures simultanées,
     * knockback avec tremblement résistant, retour
     */
    async animateMutualMelee(data) {
        const { attacker1, attacker2, damage1, damage2, attackEventTs } = data;
        const L = v => this._toLocal(v); // écran → CSS local

        const card1 = this.getCardElement(attacker1.owner, attacker1.row, attacker1.col);
        const card2 = this.getCardElement(attacker2.owner, attacker2.row, attacker2.col);
        if (!card1 || !card2) return;

        card1.dataset.inCombat = 'true';
        card2.dataset.inCombat = 'true';

        const rect1 = card1.getBoundingClientRect();
        const rect2 = card2.getBoundingClientRect();
        const pos1 = { x: rect1.left + rect1.width / 2, y: rect1.top + rect1.height / 2 };
        const pos2 = { x: rect2.left + rect2.width / 2, y: rect2.top + rect2.height / 2 };

        const midX = (pos1.x + pos2.x) / 2;
        const midY = (pos1.y + pos2.y) / 2;

        // Vecteurs vers le centre (espace écran)
        const dx1 = midX - pos1.x;
        const dy1 = midY - pos1.y;
        const dx2 = midX - pos2.x;
        const dy2 = midY - pos2.y;

        const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
        const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
        const dir1X = dx1 / dist1, dir1Y = dy1 / dist1;
        const dir2X = dx2 / dist2, dir2Y = dy2 / dist2;

        // Demi-dimension de la carte le long de l'axe de mouvement (écran)
        const cardHalf1 = (Math.abs(dir1X) * rect1.width + Math.abs(dir1Y) * rect1.height) / 2;
        const cardHalf2 = (Math.abs(dir2X) * rect2.width + Math.abs(dir2Y) * rect2.height) / 2;
        // Overlap négatif pour que les cartes se touchent/chevauchent à l'impact
        const overlap = -8;

        // Positions de charge — les cartes se chevauchent légèrement au centre
        const charge1X = dx1 - dir1X * (cardHalf1 + overlap);
        const charge1Y = dy1 - dir1Y * (cardHalf1 + overlap);
        const charge2X = dx2 - dir2X * (cardHalf2 + overlap);
        const charge2Y = dy2 - dir2Y * (cardHalf2 + overlap);

        card1.style.zIndex = '1000';
        card2.style.zIndex = '1001';

        // Phase 1 : Wind-up (les deux reculent) — CSS en local
        const recoil = 25;
        card1.style.transition = 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)';
        card2.style.transition = 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)';
        card1.style.transform = `translate(${L(-dir1X * recoil)}px, ${L(-dir1Y * recoil)}px)`;
        card2.style.transform = `translate(${L(-dir2X * recoil)}px, ${L(-dir2Y * recoil)}px)`;
        await this.wait(200);

        // Phase 2 : Charge vers le centre — CSS en local
        card1.style.transition = 'transform 140ms cubic-bezier(0.9, 0, 1, 1)';
        card2.style.transition = 'transform 140ms cubic-bezier(0.9, 0, 1, 1)';
        card1.style.transform = `translate(${L(charge1X)}px, ${L(charge1Y)}px)`;
        card2.style.transform = `translate(${L(charge2X)}px, ${L(charge2Y)}px)`;
        await this.wait(140);

        // Phase 3 : Collision — freeze 40ms
        card1.style.transition = 'none';
        card2.style.transition = 'none';
        await this.wait(40);

        // Screen shake + shockwave
        CombatVFX.screenShake(18, 0.84, 500);
        { const vp = this._V(midX, midY); CombatVFX.createShockwave(vp.x, vp.y, 120, 500); }

        // Dégâts aux positions de charge + mise à jour HP sur les cartes
        // damage1 = dégâts infligés PAR card1, donc reçus par card2 (et vice-versa)
        if (damage1 !== undefined) {
            this.showDamageEffect(pos2.x + charge2X, pos2.y + charge2Y, damage1);
            this._applyVisualDamage(card2, damage1, attackEventTs);
        }
        if (damage2 !== undefined) {
            setTimeout(() => this.showDamageEffect(pos1.x + charge1X, pos1.y + charge1Y, damage2), 30);
            this._applyVisualDamage(card1, damage2, attackEventTs);
        }

        // Phase 4 : Knockback direct vers la position d'origine avec tremblement
        await this._animate(350, (t, raw) => {
            // Interpole de charge → 0 (position d'origine)
            const base1X = charge1X * (1 - t);
            const base1Y = charge1Y * (1 - t);
            const base2X = charge2X * (1 - t);
            const base2Y = charge2Y * (1 - t);

            const tremble = (1 - t) * 5;
            const tx = (Math.random() - 0.5) * tremble * 2;
            const ty = (Math.random() - 0.5) * tremble * 2;

            const squash = 0.1 * Math.max(0, 1 - t * 2.5);
            card1.style.transform = `translate(${L(base1X + tx)}px, ${L(base1Y + ty)}px) scaleX(${1 - squash}) scaleY(${1 + squash * 0.6})`;
            card2.style.transform = `translate(${L(base2X - tx)}px, ${L(base2Y - ty)}px) scaleX(${1 - squash}) scaleY(${1 + squash * 0.6})`;
        }, t => t * (2 - t)); // outQuad

        // Petit hold
        await this.wait(100);

        card1.style.transform = '';
        card2.style.transform = '';
        card1.style.transition = '';
        card2.style.transition = '';
        card1.style.zIndex = '';
        card2.style.zIndex = '';
        // Ne PAS supprimer dataset.inCombat — combatEnd s'en charge
        // après les animations de mort, pour garder le glow violet
    }

    // ==================== TIREUR VS VOLANT (SIMULTANÉ) ====================

    async animateShooterVsFlyer(data) {
        const { shooter, flyer, shooterDamage, flyerDamage, attackEventTs } = data;
        const L = v => this._toLocal(v); // écran → CSS local

        const shooterPos = this.getSlotCenter(shooter.owner, shooter.row, shooter.col);
        const flyerPos = this.getSlotCenter(flyer.owner, flyer.row, flyer.col);
        const flyerCard = this.getCardElement(flyer.owner, flyer.row, flyer.col);
        const shooterCard = this.getCardElement(shooter.owner, shooter.row, shooter.col);

        if (!shooterPos || !flyerPos || !flyerCard) return;

        flyerCard.dataset.inCombat = 'true';
        if (shooterCard) shooterCard.dataset.inCombat = 'true';

        const flyerRect = flyerCard.getBoundingClientRect();
        const flyerStartX = flyerRect.left + flyerRect.width / 2;
        const flyerStartY = flyerRect.top + flyerRect.height / 2;

        // Distances en espace écran
        const dx = shooterPos.x - flyerStartX;
        const dy = shooterPos.y - flyerStartY;

        const interceptX = flyerStartX + dx * 0.5;
        const interceptY = flyerStartY + dy * 0.5;

        const flyerMoveDuration = this.TIMINGS.ATTACK_MOVE;
        const projectileDuration = flyerMoveDuration * 0.5;

        const flyerAnimation = (async () => {
            flyerCard.style.transition = `transform ${flyerMoveDuration}ms cubic-bezier(0.4, 0, 0.8, 1)`;
            flyerCard.style.transform = `translate(${L(dx)}px, ${L(dy)}px) scale(1.15)`;
            flyerCard.style.zIndex = '1000';

            await this.wait(flyerMoveDuration);

            // Vérifier que la carte du tireur est toujours dans le DOM
            const shooterCardAtImpact = this.getCardElement(shooter.owner, shooter.row, shooter.col);
            // Le volant frappe le tireur : shake + dégâts
            CombatVFX.screenShake(10, 0.88, 300);
            if (flyerDamage !== undefined) {
                this.showDamageEffect(shooterPos.x, shooterPos.y, flyerDamage);
                this._applyVisualDamage(shooterCardAtImpact, flyerDamage, attackEventTs);
            }
            await this.wait(200);

            flyerCard.style.transition = `transform ${this.TIMINGS.ATTACK_RETURN}ms ease-out`;
            flyerCard.style.transform = '';
            await this.wait(this.TIMINGS.ATTACK_RETURN);
            flyerCard.style.transition = '';
            flyerCard.style.zIndex = '';
        })();

        const projectileAnimation = (async () => {
            await this.animateProjectileToPoint({
                startPos: shooterPos,
                targetPos: { x: interceptX, y: interceptY },
                duration: projectileDuration,
                damage: shooterDamage,
                targetCard: flyerCard,
                attackEventTs
            });
        })();

        await Promise.all([flyerAnimation, projectileAnimation]);
    }

    async animateProjectileToPoint(data) {
        const { startPos, targetPos, duration, damage, targetCard, attackEventTs } = data;

        const sp = this._V(startPos.x, startPos.y);
        const tp = this._V(targetPos.x, targetPos.y);
        await CombatVFX.animateProjectile(
            sp.x, sp.y,
            tp.x, tp.y,
            duration
        );

        // Impact du projectile : shake + dégâts
        CombatVFX.screenShake(8, 0.88, 300);
        if (damage !== undefined) {
            this.showDamageEffect(targetPos.x, targetPos.y, damage);
            if (targetCard) this._applyVisualDamage(targetCard, damage, attackEventTs);
        }
        await this.wait(200);
    }

    // ==================== COMBAT MUTUEL TIREURS ====================

    async animateMutualShooters(data) {
        const { shooter1, shooter2, damage1, damage2, attackEventTs } = data;

        await Promise.all([
            this.animateProjectile({
                startOwner: shooter1.owner,
                startRow: shooter1.row,
                startCol: shooter1.col,
                targetOwner: shooter2.owner,
                targetRow: shooter2.row,
                targetCol: shooter2.col,
                damage: damage1,
                attackEventTs
            }),
            this.animateProjectile({
                startOwner: shooter2.owner,
                startRow: shooter2.row,
                startCol: shooter2.col,
                targetOwner: shooter1.owner,
                targetRow: shooter1.row,
                targetCol: shooter1.col,
                damage: damage2,
                attackEventTs
            })
        ]);
    }

    // ==================== DÉGÂTS AU HÉROS ====================

    async animateHeroHit(data) {
        const { owner, damage, amount } = data;
        const dmg = damage || amount;

        const pos = this.getHeroCenter(owner);
        if (!pos) return;

        const heroEl = document.getElementById(owner === 'me' ? 'hero-me' : 'hero-opp');
        if (heroEl) {
            heroEl.style.animation = 'heroShake 0.5s ease-out';
            setTimeout(() => heroEl.style.animation = '', 500);
        }

        this.showDamageEffect(pos.x, pos.y, dmg);
    }

    // ==================== DÉGÂTS SUR CRÉATURE ====================

    async animateDamage(data) {
        const { owner, row, col, amount } = data;

        const pos = this.getSlotCenter(owner, row, col);
        if (!pos) return;

        const card = this.getCardElement(owner, row, col);
        if (card) {
            card.style.animation = 'cardShake 0.4s ease-out';
            setTimeout(() => card.style.animation = '', 400);
        }

        this.showDamageEffect(pos.x, pos.y, amount);
    }

    // ==================== DÉGÂTS DE SORT (CROIX X) ====================

    async animateSpellDamage(data) {
        const { owner, row, col, amount } = data;

        const pos = this.getSlotCenter(owner, row, col);
        if (!pos) return;
        const card = this.getCardElement(owner, row, col);

        CombatVFX.screenShake(10, 0.88, 300);

        const slashSize = 162;
        const fx = this._createCardFxLayer(pos.x, pos.y);
        const slash = CombatVFX.spawnSlash(fx.container, 'cross', slashSize);
        await slash.animateIn();

        if (amount !== undefined) this.showDamageEffect(pos.x, pos.y, amount);
        if (card && Number.isFinite(Number(amount)) && Number(amount) > 0) {
            this._applyVisualDamage(card, Number(amount));
        }

        await this.wait(380);
        await slash.fadeOut();
        fx.cleanup();
    }

    // ==================== DÉGÂTS DE SORT AOE (GRIFFURES) ====================

    async animateSpellDamageAoE(data) {
        const { owner, row, col, amount } = data;

        const pos = this.getSlotCenter(owner, row, col);
        if (!pos) return;
        const card = this.getCardElement(owner, row, col);

        const slashSize = 162;
        const fx = this._createCardFxLayer(pos.x, pos.y);
        const slash = CombatVFX.spawnSlash(fx.container, 'claw', slashSize);
        await slash.animateIn();

        if (amount !== undefined) this.showDamageEffect(pos.x, pos.y, amount);
        if (card && Number.isFinite(Number(amount)) && Number(amount) > 0) {
            this._applyVisualDamage(card, Number(amount));
        }

        await this.wait(380);
        await slash.fadeOut();
        fx.cleanup();
    }

    // ==================== ATTAQUES PARALLÈLES ====================

    async animateParallelAttacks(data) {
        const { attack1, attack2 } = data;
        const animations = [];
        if (attack1) animations.push(this.animateSingleAttack(attack1));
        if (attack2) animations.push(this.animateSingleAttack(attack2));
        await Promise.all(animations);
    }

    async animateSingleAttack(attack) {
        const { attackerOwner, attackerRow, attackerCol, targetOwner, targetRow, targetCol, damage, isShooter, attackEventTs } = attack;

        if (isShooter) {
            await this.animateProjectile({
                startOwner: attackerOwner,
                startRow: attackerRow,
                startCol: attackerCol,
                targetOwner: targetOwner,
                targetRow: targetRow,
                targetCol: targetCol,
                damage: damage,
                attackEventTs
            });
        } else {
            await this.animateSoloAttack({
                attackerOwner,
                attackerRow,
                attackerCol,
                targetOwner,
                targetRow,
                targetCol,
                damage,
                attackEventTs
            });
        }
    }

    // ==================== COMPATIBILITÉ ====================

    async animateAttack(data) {
        await this.animateSoloAttack(data);
    }

    async animateMutualAttack(data) {
        await this.animateMutualMelee({
            attacker1: data.attacker1,
            attacker2: data.attacker2,
            damage1: data.damage2,
            damage2: data.damage1
        });
    }
}

// Instance globale
const CombatAnimations = new CombatAnimationSystem();

// Initialiser immédiatement
CombatAnimations.init();

// ==================== CSS ANIMATIONS ====================
const combatCSS = document.createElement('style');
combatCSS.textContent = `
@keyframes cardShake {
    0%, 100% { transform: translateX(0) rotate(0); }
    20% { transform: translateX(-12px) rotate(-4deg); }
    40% { transform: translateX(12px) rotate(4deg); }
    60% { transform: translateX(-8px) rotate(-2deg); }
    80% { transform: translateX(8px) rotate(2deg); }
}

@keyframes heroShake {
    0%, 100% { transform: scale(1); opacity: 1; }
    15% { transform: scale(0.92); opacity: 0.4; }
    30% { transform: scale(1.05); opacity: 0.85; }
    50% { transform: scale(0.97); opacity: 0.55; }
    70% { transform: scale(1.02); opacity: 0.9; }
}

@keyframes slotShake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-4px); }
    40% { transform: translateX(4px); }
    60% { transform: translateX(-3px); }
    80% { transform: translateX(2px); }
}
`;
document.head.appendChild(combatCSS);

