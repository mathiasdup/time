// ==================== GESTION DES CAPACITÉS ====================
// Toutes les capacités des créatures et leurs effets

const { addToGraveyard } = require('./cards');

// ==================== DÉFINITIONS DES CAPACITÉS ====================

const ABILITIES = {
    // Capacités de mouvement/attaque
    haste: {
        name: 'Célérité',
        icon: '⚡',
        description: 'Peut attaquer dès qu\'elle est posée'
    },
    fly: {
        name: 'Vol',
        icon: '🦅',
        description: 'Peut attaquer n\'importe quelle créature sur sa ligne'
    },
    shooter: {
        name: 'Tireur',
        icon: '🎯',
        description: 'Attaque à distance, ne reçoit pas de riposte'
    },

    // Capacités de combat
    initiative: {
        name: 'Initiative',
        icon: '🗡️',
        description: 'Attaque en premier. Si la cible meurt, pas de riposte'
    },
    trample: {
        name: 'Piétinement',
        icon: '🦏',
        description: 'Les dégâts excédentaires vont à la créature derrière ou au héros'
    },
    cleave: {
        name: 'Clivant',
        icon: '⛏️',
        description: 'Inflige des dégâts aux créatures adjacentes (même colonne)'
    },
    power: {
        name: 'Puissance',
        icon: '💪',
        description: 'Gagne +1 ATK chaque fois qu\'elle subit des dégâts et survit'
    },

    // Capacités défensives
    intangible: {
        name: 'Intangible',
        icon: '👻',
        description: 'Ne peut pas être ciblée par les attaques'
    }
};

// ==================== FONCTIONS DE CAPACITÉS ====================

/**
 * Vérifie si une créature a une capacité
 */
function hasAbility(card, abilityId) {
    return card && card.abilities && card.abilities.includes(abilityId);
}

/**
 * Obtient le texte formaté des capacités d'une carte
 */
function getAbilitiesText(card) {
    if (!card || !card.abilities) return '';
    return card.abilities.map(a => ABILITIES[a]?.name || a).join(', ');
}

/**
 * Obtient les icônes des capacités d'une carte
 */
function getAbilitiesIcons(card) {
    if (!card || !card.abilities) return '';
    return card.abilities.map(a => ABILITIES[a]?.icon || '').join(' ');
}

// ==================== CAPACITÉ: POWER ====================

/**
 * Applique le bonus de Power quand une créature survit à des dégâts
 */
function applyPowerBonus(card, log) {
    if (hasAbility(card, 'power') && card.currentHp > 0) {
        card.atk += 1;
        if (log) log(`💪 ${card.name} gagne +1 ATK!`, 'buff');
        return true;
    }
    return false;
}

// ==================== CAPACITÉ: HASTE ====================

/**
 * Vérifie si une créature peut attaquer ce tour (haste ou déjà sur le terrain)
 */
function canAttackThisTurn(card) {
    if (!card) return false;
    // Haste permet d'attaquer immédiatement
    if (hasAbility(card, 'haste')) return true;
    // Sinon, la créature doit avoir été posée au moins un tour avant
    return card.turnsOnField > 0;
}

/**
 * Applique canAttack à une créature en fonction de ses capacités
 */
function updateCanAttack(card) {
    if (!card) return;
    if (hasAbility(card, 'haste')) {
        card.canAttack = true;
    } else {
        card.canAttack = card.turnsOnField > 0;
    }
}

// ==================== CAPACITÉ: ON DEATH ====================

/**
 * Traite les capacités qui se déclenchent à la mort
 */
async function processOnDeathAbility(room, card, ownerPlayer, log, sleep, io) {
    if (!card || !card.onDeath) return;

    // damageHero: inflige des dégâts au héros ennemi
    if (card.onDeath.damageHero) {
        const dmg = card.onDeath.damageHero;
        const enemyPlayer = ownerPlayer === 1 ? 2 : 1;
        room.gameState.players[enemyPlayer].hp -= dmg;
        log(`💀 ${card.name} inflige ${dmg} dégâts au héros adverse!`, 'damage');
        if (io) {
            io.to(room.code).emit('directDamage', { defender: enemyPlayer, damage: dmg });
        }
        await sleep(500);
    }

    // summon: invoque une créature
    if (card.onDeath.summon) {
        // À implémenter si besoin
    }

    // draw: pioche des cartes
    if (card.onDeath.draw) {
        const owner = room.gameState.players[ownerPlayer];
        const cardsToDraw = card.onDeath.draw;
        for (let i = 0; i < cardsToDraw; i++) {
            if (owner.deck.length > 0 && owner.hand.length < 10) {
                const drawn = owner.deck.shift();
                owner.hand.push(drawn);
                log(`🎴 ${card.name} permet de piocher ${drawn.name}`, 'action');
            }
        }
    }
}

// ==================== CAPACITÉ: ON HERO HIT ====================

/**
 * Traite les capacités qui se déclenchent quand le héros est touché
 */
async function processOnHeroHitAbility(room, attackerCard, attackerPlayer, log, emitAnimation) {
    if (!attackerCard || !attackerCard.onHeroHit) return;

    const owner = room.gameState.players[attackerPlayer];

    // draw: pioche une carte
    if (attackerCard.onHeroHit === 'draw') {
        if (owner.deck.length > 0) {
            const drawnCard = owner.deck.shift();
            if (owner.hand.length < 10) {
                owner.hand.push(drawnCard);
                log(`🎴 ${attackerCard.name} pioche ${drawnCard.name}`, 'action');
                emitAnimation(room, 'draw', {
                    cards: [{ player: attackerPlayer, card: drawnCard, handIndex: owner.hand.length - 1 }]
                });
            } else {
                addToGraveyard(owner, drawnCard);
                log(`📦 Main pleine, ${drawnCard.name} au cimetière`, 'damage');
            }
        }
    }
}

// ==================== CAPACITÉ: PLACEMENT ====================

/**
 * Vérifie si une carte peut être placée à une position
 */
function canPlaceAt(card, col) {
    if (!card) return false;
    // Tireurs uniquement en back (col 0)
    if (hasAbility(card, 'shooter')) {
        return col === 0;
    }
    // Autres créatures peuvent aller partout
    return true;
}

// ==================== EXPORTS ====================

module.exports = {
    ABILITIES,
    hasAbility,
    getAbilitiesText,
    getAbilitiesIcons,
    applyPowerBonus,
    canAttackThisTurn,
    updateCanAttack,
    processOnDeathAbility,
    processOnHeroHitAbility,
    canPlaceAt
};
