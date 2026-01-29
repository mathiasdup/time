// =============================================
// Index du module combat
// =============================================

const targeting = require('./targeting');
const damage = require('./damage');

module.exports = {
    // Targeting
    ...targeting,

    // Damage
    ...damage
};
