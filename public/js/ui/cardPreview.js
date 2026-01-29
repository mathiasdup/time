// =============================================
// Interface: Preview de carte
// =============================================
// Affichage des informations détaillées au survol des cartes

// Descriptions détaillées des capacités
const ABILITY_DESCRIPTIONS_DETAILED = {
    fly: { name: 'Vol', desc: 'Cette créature peut attaquer n\'importe quel emplacement adverse, pas seulement celui en face.' },
    shooter: { name: 'Tireur', desc: 'Cette créature peut attaquer à distance sans recevoir de riposte.' },
    haste: { name: 'Célérité', desc: 'Cette créature peut attaquer dès le tour où elle est invoquée.' },
    intangible: { name: 'Intangible', desc: 'Cette créature ne peut pas être ciblée par les sorts ou les pièges.' },
    trample: { name: 'Piétinement', desc: 'Les dégâts excédentaires sont infligés au héros adverse.' },
    power: { name: 'Puissance', desc: 'Quand cette créature subit des dégâts sans mourir, elle gagne +1 ATK.' },
    cleave: { name: 'Clivant', desc: 'Quand cette créature attaque, elle inflige X dégâts aux créatures sur les lignes adjacentes. Ces créatures ne ripostent pas.' },
    immovable: { name: 'Inamovible', desc: 'Cette créature ne peut pas être déplacée.' },
    protection: { name: 'Protection', desc: 'La prochaine fois que cette créature devrait subir des dégâts, ignorez-les et retirez Protection.' }
};

/**
 * Affiche le preview d'une carte
 * @param {Object} card - Données de la carte
 * @param {Event} e - Événement souris
 */
function showCardPreview(card, e) {
    hideCardPreview();

    // Créer le container
    previewEl = document.createElement('div');
    previewEl.className = 'preview-container card-preview';

    // Ajouter la carte (version complète avec tous les détails)
    const cardEl = makeCard(card, true);
    cardEl.classList.add('preview-card');
    previewEl.appendChild(cardEl);

    // Container pour capacités + effets
    const infoContainer = document.createElement('div');
    infoContainer.className = 'preview-info-container';

    // Ajouter les capacités si c'est une créature avec des abilities
    if (card.type === 'creature' && card.abilities && card.abilities.length > 0) {
        const abilitiesContainer = document.createElement('div');
        abilitiesContainer.className = 'preview-abilities';

        card.abilities.forEach(ability => {
            const abilityInfo = ABILITY_DESCRIPTIONS_DETAILED[ability];
            if (abilityInfo) {
                const abilityEl = document.createElement('div');
                abilityEl.className = 'preview-ability';
                // Type de combat (shooter/fly) en blanc, capacités communes en jaune
                const isTypeAbility = ability === 'shooter' || ability === 'fly';
                abilityEl.innerHTML = `
                    <div class="ability-name ${isTypeAbility ? 'type-ability' : ''}">${abilityInfo.name}</div>
                    <div class="ability-desc">${abilityInfo.desc}</div>
                `;
                abilitiesContainer.appendChild(abilityEl);
            }
        });

        infoContainer.appendChild(abilitiesContainer);
    }

    // Ajouter les effets appliqués (sorts) si présents
    if (card.appliedEffects && card.appliedEffects.length > 0) {
        const effectsContainer = document.createElement('div');
        effectsContainer.className = 'preview-effects';

        card.appliedEffects.forEach(effect => {
            const effectEl = document.createElement('div');
            effectEl.className = 'preview-effect';
            effectEl.innerHTML = `
                <div class="effect-name">${effect.name}</div>
                <div class="effect-desc">${effect.description}</div>
            `;
            effectsContainer.appendChild(effectEl);
        });

        infoContainer.appendChild(effectsContainer);
    }

    if (infoContainer.children.length > 0) {
        previewEl.appendChild(infoContainer);
    }

    document.body.appendChild(previewEl);
    const el = previewEl;
    requestAnimationFrame(() => {
        if (el && el.parentNode) el.classList.add('visible');
    });
}

/**
 * Affiche le dos d'une carte (pour les cartes adverses)
 */
function showCardBackPreview() {
    hideCardPreview();
    previewEl = document.createElement('div');
    previewEl.className = 'card-back-preview card-preview';
    document.body.appendChild(previewEl);
    const el = previewEl;
    requestAnimationFrame(() => {
        if (el && el.parentNode) el.classList.add('visible');
    });
}

/**
 * Affiche le preview d'un héros
 * @param {Object} hero - Données du héros
 * @param {number} hp - Points de vie actuels
 */
function showHeroPreview(hero, hp) {
    if (!hero) {
        hero = window.heroData?.me || window.heroData?.opp;
    }
    if (!hp) {
        hp = state?.me?.hp || state?.opponent?.hp || 20;
    }

    hideCardPreview();

    const rarityClasses = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'mythic', 5: 'platinum' };
    const rarityClass = hero?.edition ? rarityClasses[hero.edition] || 'common' : 'common';
    const factionClass = hero?.faction ? `faction-${hero.faction}` : '';

    previewEl = document.createElement('div');
    previewEl.className = `hero-preview hero-detail-card arena-style ${factionClass}`;

    if (hero && hero.image) {
        previewEl.style.backgroundImage = `url('/cards/${hero.image}')`;
        previewEl.innerHTML = `
            <div class="arena-title-bar">
                <div class="arena-title-inner">
                    <span class="title-text">${hero.name}</span>
                </div>
            </div>
            <div class="hero-hp-circle">
                <div class="hero-hp-inner">
                    <span class="hero-hp-number">${hp}</span>
                </div>
            </div>
            <div class="arena-text-zone">
                <div class="arena-text-inner">
                    <div class="arena-type">Héros</div>
                    <div class="arena-special">${hero.ability}</div>
                </div>
            </div>
            <div class="arena-edition ${rarityClass}">
                <div class="edition-circle"><div class="rarity-icon"><div class="inner-shape"></div></div></div>
            </div>
        `;
    } else {
        previewEl.innerHTML = `
            <div class="hero-preview-name">${hero ? hero.name : 'Héros'}</div>
        `;
    }
    document.body.appendChild(previewEl);
    const el = previewEl;
    requestAnimationFrame(() => {
        if (el && el.parentNode) {
            el.classList.add('visible');
        }
    });
}

/**
 * Affiche les détails complets d'un héros
 * @param {Object} hero - Données du héros
 * @param {number} hp - Points de vie actuels
 */
function showHeroDetail(hero, hp) {
    if (!hero) {
        hero = window.heroData?.me || window.heroData?.opp;
    }
    if (!hp) {
        hp = state?.me?.hp || state?.opponent?.hp || 20;
    }

    hideCardPreview();
    previewEl = document.createElement('div');
    previewEl.className = 'hero-detail-preview';

    if (hero && hero.image) {
        previewEl.style.backgroundImage = `url('/cards/${hero.image}')`;
        previewEl.innerHTML = `
            <div class="hero-detail-overlay">
                <div class="hero-detail-title">${hero.name}</div>
                <div class="hero-detail-ability">${hero.ability}</div>
                <div class="hero-detail-hp">${hp} PV</div>
            </div>
        `;
    }
    document.body.appendChild(previewEl);
    const el = previewEl;
    requestAnimationFrame(() => {
        if (el && el.parentNode) el.classList.add('visible');
    });
}

/**
 * Déplace le preview avec la souris
 * @param {Event} e - Événement souris
 */
function moveCardPreview(e) {
    // Le preview est positionné automatiquement par CSS
}

/**
 * Cache le preview de carte
 */
function hideCardPreview() {
    if (previewEl) {
        previewEl.remove();
        previewEl = null;
    }
}
