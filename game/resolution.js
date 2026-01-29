// =============================================
// Resolution System - Génération des paquets d'animation
// =============================================
// Ce module génère des ResolutionPackets qui contiennent toutes les
// informations nécessaires pour rejouer les animations côté client.

/**
 * Classe pour construire une timeline d'animations
 */
class ResolutionTimeline {
    constructor() {
        this.events = [];
        this.currentTime = 0;
    }

    /**
     * Ajoute un événement à la timeline
     */
    addEvent(type, data, duration = 0, delayAfter = 0) {
        this.events.push({
            type,
            data,
            time: this.currentTime,
            duration,
            delayAfter
        });
        this.currentTime += duration + delayAfter;
    }

    /**
     * Ajoute un délai
     */
    addDelay(ms) {
        this.currentTime += ms;
    }

    /**
     * Ajoute un message de phase
     */
    addPhase(text, type = 'info') {
        this.addEvent('phase', { text, type }, 0, 600);
    }

    /**
     * Ajoute une animation de déplacement
     */
    addMove(playerNum, fromRow, fromCol, toRow, toCol, card) {
        this.addEvent('move', {
            player: playerNum,
            fromRow,
            fromCol,
            toRow,
            toCol,
            card: this.sanitizeCard(card)
        }, 500, 200);
    }

    /**
     * Ajoute une animation d'invocation
     */
    addSummon(playerNum, row, col, card) {
        this.addEvent('summon', {
            player: playerNum,
            row,
            col,
            card: this.sanitizeCard(card)
        }, 400, 50);
    }

    /**
     * Ajoute une animation d'attaque
     */
    addAttack(attackerOwner, attackerRow, attackerCol, targetOwner, targetRow, targetCol, damage, card) {
        this.addEvent('attack', {
            attackerOwner,
            attackerRow,
            attackerCol,
            targetOwner,
            targetRow,
            targetCol,
            damage,
            card: this.sanitizeCard(card)
        }, 550, 100);
    }

    /**
     * Ajoute une animation de combat mutuel
     */
    addMutualCombat(attacker1, attacker2, damage1, damage2) {
        this.addEvent('mutualCombat', {
            attacker1: {
                owner: attacker1.owner,
                row: attacker1.row,
                col: attacker1.col,
                card: this.sanitizeCard(attacker1.card)
            },
            attacker2: {
                owner: attacker2.owner,
                row: attacker2.row,
                col: attacker2.col,
                card: this.sanitizeCard(attacker2.card)
            },
            damage1,
            damage2
        }, 600, 200);
    }

    /**
     * Ajoute une animation de mort
     */
    addDeath(owner, row, col, card) {
        this.addEvent('death', {
            owner,
            row,
            col,
            card: this.sanitizeCard(card)
        }, 500, 100);
    }

    /**
     * Ajoute une animation de sort
     */
    addSpell(casterNum, spellCard, targets, effects) {
        this.addEvent('spell', {
            caster: casterNum,
            spell: this.sanitizeCard(spellCard),
            targets,
            effects
        }, 800, 200);
    }

    /**
     * Ajoute une animation de piège
     */
    addTrap(triggerOwner, row, trapCard, target) {
        this.addEvent('trap', {
            triggerOwner,
            row,
            trap: this.sanitizeCard(trapCard),
            target
        }, 600, 200);
    }

    /**
     * Ajoute une animation de déploiement de bouclier
     */
    addShieldDeploy(playerNum, row, col) {
        this.addEvent('shieldDeploy', {
            player: playerNum,
            row,
            col
        }, 300, 50);
    }

    /**
     * Ajoute une animation de destruction de bouclier
     */
    addShieldBreak(owner, row, col) {
        this.addEvent('shieldBreak', {
            owner,
            row,
            col
        }, 500, 100);
    }

    /**
     * Ajoute une animation de dégâts au héros
     */
    addHeroDamage(targetOwner, damage, source) {
        this.addEvent('heroDamage', {
            targetOwner,
            damage,
            source
        }, 400, 200);
    }

    /**
     * Ajoute un snapshot d'état intermédiaire
     */
    addStateSnapshot(state) {
        this.addEvent('stateSnapshot', { state }, 0, 0);
    }

    /**
     * Ajoute une animation de dégâts sur créature
     */
    addDamage(owner, row, col, amount, card) {
        this.addEvent('damage', {
            owner,
            row,
            col,
            amount,
            card: this.sanitizeCard(card)
        }, 300, 100);
    }

    /**
     * Ajoute une animation de pioche
     */
    addDraw(playerNum, cards) {
        this.addEvent('draw', {
            player: playerNum,
            cards: cards.map(c => ({
                card: this.sanitizeCard(c.card),
                handIndex: c.handIndex,
                burned: c.burned
            }))
        }, 400, 100);
    }

    /**
     * Ajoute une animation de placement de piège
     */
    addTrapPlace(playerNum, row, trap) {
        this.addEvent('trapPlace', {
            player: playerNum,
            row,
            trap
        }, 700, 100);
    }

    /**
     * Ajoute une animation de déclenchement de piège
     */
    addTrapTrigger(playerNum, row, trap) {
        this.addEvent('trapTrigger', {
            player: playerNum,
            row,
            trap: this.sanitizeCard(trap)
        }, 600, 200);
    }

    /**
     * Ajoute une animation de transformation (mort -> nouvelle créature)
     */
    addDeathTransform(playerNum, row, col, fromCard, toCard) {
        this.addEvent('deathTransform', {
            player: playerNum,
            row,
            col,
            fromCard: this.sanitizeCard(fromCard),
            toCard: this.sanitizeCard(toCard)
        }, 1200, 200);
    }

    /**
     * Ajoute une animation de résurrection (Pile d'os -> Petit Os)
     */
    addBoneRevive(playerNum, row, col, fromCard, toCard) {
        this.addEvent('boneRevive', {
            player: playerNum,
            row,
            col,
            fromCard: this.sanitizeCard(fromCard),
            toCard: this.sanitizeCard(toCard)
        }, 600, 100);
    }

    /**
     * Ajoute une animation de dégâts de sort (zone)
     */
    addSpellDamage(playerNum, row, col, amount) {
        this.addEvent('spellDamage', {
            player: playerNum,
            row,
            col,
            amount
        }, 400, 50);
    }

    /**
     * Ajoute une animation de soin
     */
    addHeal(playerNum, row, col, amount) {
        this.addEvent('heal', {
            player: playerNum,
            row,
            col,
            amount
        }, 400, 100);
    }

    /**
     * Ajoute une animation de buff
     */
    addBuff(playerNum, row, col, atk, hp) {
        this.addEvent('buff', {
            player: playerNum,
            row,
            col,
            atk,
            hp
        }, 400, 100);
    }

    /**
     * Nettoie un objet carte pour transmission
     */
    sanitizeCard(card) {
        if (!card) return null;
        return {
            id: card.id,
            uid: card.uid,
            name: card.name,
            icon: card.icon,
            type: card.type,
            atk: card.atk,
            hp: card.hp,
            maxHp: card.maxHp,
            baseHp: card.baseHp,
            baseAtk: card.baseAtk,
            cost: card.cost,
            abilities: card.abilities,
            hasProtection: card.hasProtection,
            color: card.color,
            image: card.image,
            fullArt: card.fullArt,
            arenaStyle: card.arenaStyle,
            faction: card.faction
        };
    }

    /**
     * Obtient la timeline complète
     */
    getTimeline() {
        return this.events;
    }

    /**
     * Obtient la durée totale
     */
    getTotalDuration() {
        return this.currentTime;
    }
}

/**
 * Crée un paquet de résolution complet
 */
function createResolutionPacket(room, initialState, finalState, timeline) {
    return {
        version: 1,
        turn: room.gameState.turn,
        timestamp: Date.now(),
        initialState: sanitizeGameState(initialState, 1), // Vue joueur 1
        finalState: sanitizeGameState(finalState, 1),
        timeline: timeline.getTimeline(),
        totalDuration: timeline.getTotalDuration()
    };
}

/**
 * Crée un paquet personnalisé pour chaque joueur
 */
function createPlayerResolutionPacket(room, initialState, finalState, timeline, playerNum) {
    return {
        version: 1,
        turn: room.gameState.turn,
        timestamp: Date.now(),
        playerNum: playerNum,
        initialState: sanitizeGameState(initialState, playerNum),
        finalState: sanitizeGameState(finalState, playerNum),
        timeline: timeline.getTimeline(),
        totalDuration: timeline.getTotalDuration()
    };
}

/**
 * Nettoie l'état du jeu pour transmission
 * (masque les informations sensibles selon le joueur)
 */
function sanitizeGameState(gameState, forPlayerNum) {
    if (!gameState) return null;

    const sanitized = {
        turn: gameState.turn,
        phase: gameState.phase,
        players: {}
    };

    for (let p = 1; p <= 2; p++) {
        const player = gameState.players[p];
        const isMe = p === forPlayerNum;

        sanitized.players[p] = {
            hp: player.hp,
            energy: player.energy,
            heroName: player.heroName,
            field: player.field.map(row => row.map(card =>
                card ? sanitizeCardForPlayer(card, isMe) : null
            )),
            traps: isMe ? player.traps : player.traps.map(() => ({ hidden: true })),
            handCount: player.hand.length,
            graveyard: player.graveyard.map(c => sanitizeCardForPlayer(c, true))
        };

        // La main n'est visible que pour le joueur lui-même
        if (isMe) {
            sanitized.players[p].hand = player.hand.map(c => sanitizeCardForPlayer(c, true));
        }
    }

    return sanitized;
}

function sanitizeCardForPlayer(card, fullInfo) {
    if (!card) return null;

    const base = {
        id: card.id,
        name: card.name,
        icon: card.icon,
        type: card.type,
        color: card.color,
        image: card.image,
        arenaStyle: card.arenaStyle,
        faction: card.faction,
        fullArt: card.fullArt
    };

    if (fullInfo || card.type === 'creature') {
        return {
            ...base,
            atk: card.atk,
            hp: card.hp,
            maxHp: card.maxHp,
            baseHp: card.baseHp,
            baseAtk: card.baseAtk,
            cost: card.cost,
            abilities: card.abilities,
            hasProtection: card.hasProtection,
            turnsOnField: card.turnsOnField,
            movedThisTurn: card.movedThisTurn,
            creatureType: card.creatureType,
            combatType: card.combatType,
            edition: card.edition,
            description: card.description,
            onHeroHit: card.onHeroHit,
            onDeath: card.onDeath,
            powerX: card.powerX,
            cleaveX: card.cleaveX,
            regenerationX: card.regenerationX,
            maxHp: card.maxHp  // Pour la régénération (si buffé)
        };
    }

    return base;
}

module.exports = {
    ResolutionTimeline,
    createResolutionPacket,
    createPlayerResolutionPacket,
    sanitizeGameState
};
