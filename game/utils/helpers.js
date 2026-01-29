// =============================================
// Utilitaires généraux
// =============================================

/**
 * Génère un code de room unique (6 caractères)
 * @param {Map} existingRooms - Map des rooms existantes pour éviter les doublons
 * @returns {string}
 */
function generateRoomCode(existingRooms) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (existingRooms && existingRooms.has(code));
    return code;
}

/**
 * Clone profond d'un objet (via JSON)
 * @param {Object} obj - Objet à cloner
 * @returns {Object}
 */
function deepClone(obj) {
    if (obj === null || obj === undefined) return obj;
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Fonction sleep pour les délais async
 * @param {number} ms - Millisecondes
 * @returns {Promise}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Noms des slots pour le log
 */
const slotNames = [
    ['Rang 1 Avant', 'Rang 1 Arrière'],
    ['Rang 2 Avant', 'Rang 2 Arrière'],
    ['Rang 3 Avant', 'Rang 3 Arrière'],
    ['Rang 4 Avant', 'Rang 4 Arrière']
];

/**
 * Vérifie si une colonne est valide pour placer une carte
 * @param {Object} card - La carte à placer
 * @param {number} col - Colonne (0 = arrière, 1 = avant)
 * @returns {boolean}
 */
function canPlaceAt(card, col) {
    if (!card) return false;
    // Les tireurs ne peuvent pas être placés en première ligne
    if (card.abilities && card.abilities.includes('shooter') && col === 1) {
        return false;
    }
    return true;
}

module.exports = {
    generateRoomCode,
    deepClone,
    sleep,
    slotNames,
    canPlaceAt
};
