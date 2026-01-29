// =============================================
// Combat: Application des dégâts
// =============================================
// Logique pour appliquer les dégâts en combat

/**
 * Applique les dégâts de base d'une attaque
 * @param {Object} attacker - Créature qui attaque
 * @param {Object} target - Créature ciblée
 * @param {Function} log - Fonction de log
 * @returns {{ damage: number, killed: boolean }}
 */
function applyBaseDamage(attacker, target, log) {
    if (!attacker || !target) return { damage: 0, killed: false };

    const damage = attacker.atk;
    target.currentHp -= damage;
    target.damagedThisTurn = true;

    if (log) {
        log(`⚔️ ${attacker.name} → ${target.name} (-${damage})`, 'damage');
    }

    return {
        damage,
        killed: target.currentHp <= 0
    };
}

/**
 * Applique les dégâts au héros
 * @param {Object} attacker - Créature qui attaque
 * @param {Object} hero - État du héros (player)
 * @param {Function} log - Fonction de log
 * @returns {{ damage: number }}
 */
function applyHeroDamage(attacker, hero, log) {
    if (!attacker || !hero) return { damage: 0 };

    const damage = attacker.atk;
    hero.hp -= damage;
    hero.heroAttackedThisTurn = true;

    if (log) {
        log(`⚔️ ${attacker.name} → ${hero.heroName} (-${damage})`, 'damage');
    }

    return { damage };
}

/**
 * Calcule les dégâts mutuels entre deux créatures
 * @param {Object} creature1 - Première créature
 * @param {Object} creature2 - Deuxième créature
 * @returns {{ dmg1to2: number, dmg2to1: number }}
 */
function calculateMutualDamage(creature1, creature2) {
    return {
        dmg1to2: creature1 ? creature1.atk : 0,
        dmg2to1: creature2 ? creature2.atk : 0
    };
}

/**
 * Applique les dégâts mutuels (combat simultané)
 * @param {Object} creature1 - Première créature
 * @param {Object} creature2 - Deuxième créature
 * @param {Function} log - Fonction de log
 * @returns {{ creature1Killed: boolean, creature2Killed: boolean }}
 */
function applyMutualDamage(creature1, creature2, log) {
    const { dmg1to2, dmg2to1 } = calculateMutualDamage(creature1, creature2);

    creature1.currentHp -= dmg2to1;
    creature2.currentHp -= dmg1to2;
    creature1.damagedThisTurn = true;
    creature2.damagedThisTurn = true;

    if (log) {
        log(`⚔️ ${creature1.name} ↔ ${creature2.name} (-${dmg2to1}/-${dmg1to2})`, 'damage');
    }

    return {
        creature1Killed: creature1.currentHp <= 0,
        creature2Killed: creature2.currentHp <= 0
    };
}

/**
 * Vérifie si une créature est morte
 * @param {Object} creature - La créature
 * @returns {boolean}
 */
function isDead(creature) {
    return creature && creature.currentHp <= 0;
}

/**
 * Vérifie si une créature peut attaquer
 * @param {Object} creature - La créature
 * @returns {boolean}
 */
function canAttack(creature) {
    return creature &&
           creature.canAttack === true &&
           creature.currentHp > 0 &&
           creature.atk > 0;
}

module.exports = {
    applyBaseDamage,
    applyHeroDamage,
    calculateMutualDamage,
    applyMutualDamage,
    isDead,
    canAttack
};
