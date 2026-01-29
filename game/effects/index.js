// =============================================
// Index des effets
// =============================================

const onDeath = require('./onDeath');
const onHeroHit = require('./onHeroHit');
const onDamaged = require('./onDamaged');
const transform = require('./transform');

module.exports = {
    // onDeath
    ...onDeath,

    // onHeroHit
    ...onHeroHit,

    // onDamaged
    ...onDamaged,

    // Transform
    ...transform
};
