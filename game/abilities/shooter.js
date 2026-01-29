// =============================================
// Capacité: Shooter (Tireur)
// =============================================
// Cette créature attaque à distance avec des projectiles.
// Elle peut toucher les créatures volantes.
// Elle combat à distance (animation différente).

/**
 * Vérifie si une créature a la capacité Shooter
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function hasShooter(creature) {
    return creature && creature.abilities && creature.abilities.includes('shooter');
}

/**
 * Vérifie si une créature est un tireur
 * (alias de hasShooter pour compatibilité)
 * @param {Object} creature - La créature à vérifier
 * @returns {boolean}
 */
function isShooter(creature) {
    return hasShooter(creature);
}

/**
 * Vérifie si un tireur peut toucher une cible volante
 * @param {Object} shooter - La créature tireur
 * @param {Object} target - La cible potentiellement volante
 * @returns {boolean}
 */
function canShooterHitFlying(shooter, target) {
    if (!hasShooter(shooter)) return false;
    // Les tireurs peuvent toujours toucher les volants
    return true;
}

/**
 * Détermine le type d'animation pour un tireur
 * @param {Object} attacker - La créature qui attaque
 * @param {Object} target - La cible
 * @returns {'projectile'|'melee'}
 */
function getAttackAnimationType(attacker, target) {
    if (hasShooter(attacker)) {
        return 'projectile';
    }
    return 'melee';
}

/**
 * Calcule la trajectoire du projectile pour l'animation
 * @param {Object} startPos - Position de départ {x, y}
 * @param {Object} endPos - Position d'arrivée {x, y}
 * @returns {Object} - Données de trajectoire pour l'animation
 */
function calculateProjectileTrajectory(startPos, endPos) {
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    return {
        dx,
        dy,
        distance,
        angle,
        duration: Math.min(500, Math.max(200, distance * 0.5)) // 200-500ms selon distance
    };
}

module.exports = {
    hasShooter,
    isShooter,
    canShooterHitFlying,
    getAttackAnimationType,
    calculateProjectileTrajectory
};
