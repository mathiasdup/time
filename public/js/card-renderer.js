/**
 * Card Renderer avec PixiJS
 * Style Hearthstone : image plein fond + icônes de stats
 */

const CardRenderer = {
    // Cache des textures générées
    cache: new Map(),
    textureCache: {},

    // Dimensions de la carte
    CARD_WIDTH: 200,
    CARD_HEIGHT: 280,

    /**
     * Initialise le renderer
     */
    async init() {
        // Créer un canvas offscreen pour le rendu
        this.app = new PIXI.Application();
        await this.app.init({
            width: this.CARD_WIDTH,
            height: this.CARD_HEIGHT,
            backgroundAlpha: 0,
            antialias: true,
            resolution: 2,
            autoDensity: true
        });

        // Précharger les icônes de stats
        try {
            this.textureCache.mana = await PIXI.Assets.load('/css/mana.png');
            this.textureCache.damage = await PIXI.Assets.load('/css/damage.png');
            this.textureCache.health = await PIXI.Assets.load('/css/health.png');
            console.log('[CardRenderer] Icônes chargées');
        } catch (e) {
            console.warn('[CardRenderer] Erreur chargement icônes:', e);
        }

        this.isReady = true;
        console.log('[CardRenderer] Initialisé avec PixiJS');
        return this;
    },

    /**
     * Génère une carte et retourne une Data URL
     */
    async renderCard(card) {
        if (!this.isReady) await this.init();

        const cacheKey = `${card.id}_${card.currentHp ?? card.hp}_${card.atk}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // Nettoyer le stage
        this.app.stage.removeChildren();

        const container = new PIXI.Container();
        this.app.stage.addChild(container);

        // 1. Image de fond (plein écran)
        await this.drawFullImage(container, card);

        // 2. Nom de la carte (bandeau au milieu-bas)
        this.drawName(container, card);

        // 3. Zone de texte (type + capacités) au-dessus des stats
        this.drawTextZone(container, card);

        // 4. Stats avec grosses icônes (style Hearthstone)
        this.drawStats(container, card);

        // Render et extraire l'image
        this.app.renderer.render(this.app.stage);
        const dataUrl = await this.app.renderer.extract.base64(this.app.stage);

        this.cache.set(cacheKey, dataUrl);
        return dataUrl;
    },

    /**
     * Image de fond en plein écran
     */
    async drawFullImage(container, card) {
        const W = this.CARD_WIDTH;
        const H = this.CARD_HEIGHT;

        // Fond noir au cas où l'image ne charge pas
        const bg = new PIXI.Graphics();
        bg.roundRect(0, 0, W, H, 10);
        bg.fill({ color: 0x1a1a2e });
        container.addChild(bg);

        if (!card.image) return;

        try {
            const texture = await PIXI.Assets.load(`/cards/${card.image}`);
            const sprite = new PIXI.Sprite(texture);

            // Cover : remplir toute la carte
            const scaleX = W / texture.width;
            const scaleY = H / texture.height;
            const scale = Math.max(scaleX, scaleY);

            sprite.scale.set(scale);
            sprite.x = (W - texture.width * scale) / 2;
            sprite.y = (H - texture.height * scale) / 2;

            // Masque arrondi
            const mask = new PIXI.Graphics();
            mask.roundRect(0, 0, W, H, 10);
            mask.fill({ color: 0xffffff });
            container.addChild(mask);
            sprite.mask = mask;

            container.addChild(sprite);

            // Bordure
            const border = new PIXI.Graphics();
            border.roundRect(0, 0, W, H, 10);
            border.stroke({ color: 0x222222, width: 3 });
            container.addChild(border);

        } catch (e) {
            console.warn('[CardRenderer] Image non trouvée:', card.image);
        }
    },

    /**
     * Nom de la carte - bandeau style Hearthstone
     */
    drawName(container, card) {
        const W = this.CARD_WIDTH;
        const H = this.CARD_HEIGHT;
        const bannerY = H * 0.58; // Position du bandeau (58% de la hauteur)

        // Fond du bandeau (dégradé noir semi-transparent)
        const nameBg = new PIXI.Graphics();
        nameBg.roundRect(8, bannerY - 2, W - 16, 28, 6);
        nameBg.fill({ color: 0x000000, alpha: 0.75 });
        container.addChild(nameBg);

        // Texte du nom
        const nameText = new PIXI.Text({
            text: card.name,
            style: {
                fontFamily: 'Georgia, serif',
                fontSize: 15,
                fontWeight: 'bold',
                fill: 0xffffff,
                align: 'center',
                dropShadow: {
                    color: 0x000000,
                    blur: 2,
                    distance: 1
                }
            }
        });
        nameText.anchor.set(0.5);
        nameText.x = W / 2;
        nameText.y = bannerY + 12;
        container.addChild(nameText);
    },

    /**
     * Zone de texte (type + capacités)
     */
    drawTextZone(container, card) {
        const W = this.CARD_WIDTH;
        const H = this.CARD_HEIGHT;
        const zoneY = H * 0.68; // Juste sous le nom

        // Fond semi-transparent
        const textBg = new PIXI.Graphics();
        textBg.roundRect(8, zoneY, W - 16, 38, 4);
        textBg.fill({ color: 0x000000, alpha: 0.6 });
        container.addChild(textBg);

        // Type de créature
        let typeText = 'Créature';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) {
            typeText = 'Créature - Tireur';
        } else if (card.combatType === 'fly' || card.abilities?.includes('fly')) {
            typeText = 'Créature - Volant';
        } else {
            typeText = 'Créature - Mêlée';
        }

        const type = new PIXI.Text({
            text: typeText,
            style: {
                fontFamily: 'Arial, sans-serif',
                fontSize: 9,
                fill: 0xaaaaaa,
                align: 'center'
            }
        });
        type.anchor.set(0.5, 0);
        type.x = W / 2;
        type.y = zoneY + 4;
        container.addChild(type);

        // Capacités
        const abilityNames = {
            fly: 'Vol', shooter: 'Tireur', haste: 'Célérité',
            intangible: 'Intangible', trample: 'Piétinement',
            initiative: 'Initiative', power: 'Puissance', cleave: 'Clivant'
        };

        const abilities = (card.abilities || [])
            .map(a => abilityNames[a] || a)
            .join(', ');

        if (abilities) {
            const abText = new PIXI.Text({
                text: abilities,
                style: {
                    fontFamily: 'Arial, sans-serif',
                    fontSize: 11,
                    fontWeight: 'bold',
                    fill: 0xffd700,
                    align: 'center'
                }
            });
            abText.anchor.set(0.5, 0);
            abText.x = W / 2;
            abText.y = zoneY + 18;
            container.addChild(abText);
        }
    },

    /**
     * Stats avec grosses icônes style Hearthstone
     */
    drawStats(container, card) {
        const W = this.CARD_WIDTH;
        const H = this.CARD_HEIGHT;
        const hp = card.currentHp ?? card.hp;

        // Tailles des icônes
        const manaSize = 50;  // Mana en haut à gauche
        const statSize = 55;  // ATK et HP en bas

        // === MANA (haut gauche, déborde légèrement) ===
        if (this.textureCache.mana) {
            const manaSprite = new PIXI.Sprite(this.textureCache.mana);
            manaSprite.width = manaSize;
            manaSprite.height = manaSize;
            manaSprite.x = -5;
            manaSprite.y = -5;
            container.addChild(manaSprite);

            this.drawStatNumber(container, card.cost, manaSize/2 - 5, manaSize/2 - 5, 0xffffff, 22);
        }

        // === ATK (bas gauche, déborde) ===
        if (this.textureCache.damage) {
            const atkSprite = new PIXI.Sprite(this.textureCache.damage);
            atkSprite.width = statSize;
            atkSprite.height = statSize;
            atkSprite.x = -8;
            atkSprite.y = H - statSize + 8;
            container.addChild(atkSprite);

            this.drawStatNumber(container, card.atk, statSize/2 - 8, H - statSize/2 + 8, 0xffffff, 24);
        }

        // === HP (bas droite, déborde) ===
        if (this.textureCache.health) {
            const hpSprite = new PIXI.Sprite(this.textureCache.health);
            hpSprite.width = statSize;
            hpSprite.height = statSize;
            hpSprite.x = W - statSize + 8;
            hpSprite.y = H - statSize + 8;
            container.addChild(hpSprite);

            // Couleur rouge clair si endommagé
            const hpColor = hp < card.hp ? 0xff6b6b : 0xffffff;
            this.drawStatNumber(container, hp, W - statSize/2 + 8, H - statSize/2 + 8, hpColor, 24);
        }
    },

    /**
     * Dessine un nombre de stat (blanc avec contour noir épais)
     */
    drawStatNumber(container, value, x, y, color = 0xffffff, fontSize = 22) {
        const text = new PIXI.Text({
            text: value.toString(),
            style: {
                fontFamily: 'Arial Black, sans-serif',
                fontSize: fontSize,
                fontWeight: 'bold',
                fill: color,
                stroke: { color: 0x000000, width: 5 }
            }
        });
        text.anchor.set(0.5);
        text.x = x;
        text.y = y;
        container.addChild(text);
    },

    /**
     * Crée un élément DOM avec la carte rendue
     */
    async createCardElement(card) {
        const dataUrl = await this.renderCard(card);

        const el = document.createElement('div');
        el.className = `card ${card.type === 'trap' ? 'trap-card' : card.type} pixi-card`;
        el.style.backgroundImage = `url('${dataUrl}')`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';

        return el;
    },

    /**
     * Vide le cache
     */
    clearCache() {
        this.cache.clear();
    }
};

// Initialiser au chargement
if (typeof window !== 'undefined') {
    window.CardRenderer = CardRenderer;
}
