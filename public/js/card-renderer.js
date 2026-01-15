/**
 * Card Renderer avec PixiJS
 * Génère des cartes visuellement magnifiques avec cadre, ornements et stats
 */

const CardRenderer = {
    // Cache des textures générées
    cache: new Map(),

    // Dimensions de la carte
    CARD_WIDTH: 200,
    CARD_HEIGHT: 280,

    // Couleurs du thème
    COLORS: {
        gold: 0xFFD700,
        goldDark: 0xB8860B,
        bronze: 0xCD7F32,
        silver: 0xC0C0C0,
        darkBg: 0x1a1a2e,
        cardBg: 0x16213e,
        red: 0xe74c3c,
        green: 0x2ecc71,
        blue: 0x3498db,
        purple: 0x9b59b6
    },

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

        // 1. Fond de carte avec dégradé
        await this.drawCardBackground(container, card);

        // 2. Image de la carte
        await this.drawCardImage(container, card);

        // 3. Cadre ornemental
        this.drawFrame(container, card);

        // 4. Bannière du nom
        this.drawNameBanner(container, card);

        // 5. Zone de texte (type + capacités)
        this.drawTextZone(container, card);

        // 6. Gemmes de stats (Mana, ATK, HP)
        this.drawStatGems(container, card);

        // Render et extraire l'image
        this.app.renderer.render(this.app.stage);
        const dataUrl = await this.app.renderer.extract.base64(this.app.stage);

        this.cache.set(cacheKey, dataUrl);
        return dataUrl;
    },

    /**
     * Fond de carte avec effet de profondeur
     */
    async drawCardBackground(container, card) {
        const W = this.CARD_WIDTH;
        const H = this.CARD_HEIGHT;

        // Fond principal sombre
        const bg = new PIXI.Graphics();
        bg.roundRect(0, 0, W, H, 12);
        bg.fill({ color: this.COLORS.darkBg });
        container.addChild(bg);

        // Bordure interne dorée
        const innerBorder = new PIXI.Graphics();
        innerBorder.roundRect(4, 4, W - 8, H - 8, 10);
        innerBorder.stroke({ color: this.COLORS.goldDark, width: 2 });
        container.addChild(innerBorder);
    },

    /**
     * Image de la carte
     */
    async drawCardImage(container, card) {
        if (!card.image) return;

        const W = this.CARD_WIDTH;
        const imgY = 25;
        const imgH = 120;
        const imgW = W - 20;
        const imgX = 10;

        try {
            const texture = await PIXI.Assets.load(`/cards/${card.image}`);
            const sprite = new PIXI.Sprite(texture);

            // Calculer le ratio pour cover
            const scale = Math.max(imgW / texture.width, imgH / texture.height);
            sprite.scale.set(scale);

            // Centrer l'image
            sprite.x = imgX + (imgW - texture.width * scale) / 2;
            sprite.y = imgY + (imgH - texture.height * scale) / 2;

            // Masque pour arrondir les coins
            const mask = new PIXI.Graphics();
            mask.roundRect(imgX, imgY, imgW, imgH, 6);
            mask.fill({ color: 0xffffff });
            container.addChild(mask);
            sprite.mask = mask;

            container.addChild(sprite);

            // Bordure de l'image
            const imgBorder = new PIXI.Graphics();
            imgBorder.roundRect(imgX, imgY, imgW, imgH, 6);
            imgBorder.stroke({ color: this.COLORS.gold, width: 2 });
            container.addChild(imgBorder);

        } catch (e) {
            console.warn('[CardRenderer] Image non trouvée:', card.image);
        }
    },

    /**
     * Cadre ornemental de la carte
     */
    drawFrame(container, card) {
        const W = this.CARD_WIDTH;
        const H = this.CARD_HEIGHT;

        // Cadre extérieur doré
        const frame = new PIXI.Graphics();
        frame.roundRect(0, 0, W, H, 12);
        frame.stroke({ color: this.COLORS.gold, width: 3 });
        container.addChild(frame);

        // Ornements aux coins
        const cornerSize = 15;
        const corners = [
            { x: 8, y: 8 },
            { x: W - 8, y: 8 },
            { x: 8, y: H - 8 },
            { x: W - 8, y: H - 8 }
        ];

        corners.forEach((pos, i) => {
            const corner = new PIXI.Graphics();
            corner.circle(pos.x, pos.y, 4);
            corner.fill({ color: this.COLORS.gold });
            container.addChild(corner);
        });

        // Lignes décoratives horizontales
        const deco = new PIXI.Graphics();
        // Sous l'image
        deco.moveTo(20, 150);
        deco.lineTo(W - 20, 150);
        deco.stroke({ color: this.COLORS.goldDark, width: 1 });
        // Au-dessus des stats
        deco.moveTo(20, H - 50);
        deco.lineTo(W - 20, H - 50);
        deco.stroke({ color: this.COLORS.goldDark, width: 1 });
        container.addChild(deco);
    },

    /**
     * Bannière du nom avec effet parchemin
     */
    drawNameBanner(container, card) {
        const W = this.CARD_WIDTH;
        const bannerY = 148;
        const bannerH = 28;

        // Fond de la bannière
        const banner = new PIXI.Graphics();
        banner.roundRect(15, bannerY, W - 30, bannerH, 4);
        banner.fill({ color: 0x2c1810 });
        banner.stroke({ color: this.COLORS.gold, width: 1 });
        container.addChild(banner);

        // Nom de la carte
        const nameText = new PIXI.Text({
            text: card.name.toUpperCase(),
            style: {
                fontFamily: 'Georgia, serif',
                fontSize: 13,
                fontWeight: 'bold',
                fill: this.COLORS.gold,
                align: 'center',
                letterSpacing: 1
            }
        });
        nameText.anchor.set(0.5);
        nameText.x = W / 2;
        nameText.y = bannerY + bannerH / 2;
        container.addChild(nameText);
    },

    /**
     * Zone de texte avec type et capacités
     */
    drawTextZone(container, card) {
        const W = this.CARD_WIDTH;
        const zoneY = 182;
        const zoneH = 45;

        // Fond de la zone de texte
        const textBg = new PIXI.Graphics();
        textBg.roundRect(10, zoneY, W - 20, zoneH, 4);
        textBg.fill({ color: 0x0f0f1a, alpha: 0.8 });
        container.addChild(textBg);

        // Type de créature
        let typeText = 'Creature';
        if (card.combatType === 'shooter' || card.abilities?.includes('shooter')) {
            typeText = 'Creature - Tireur';
        } else if (card.combatType === 'fly' || card.abilities?.includes('fly')) {
            typeText = 'Creature - Volant';
        } else {
            typeText = 'Creature - Melee';
        }

        const type = new PIXI.Text({
            text: typeText,
            style: {
                fontFamily: 'Arial, sans-serif',
                fontSize: 10,
                fill: 0xaaaaaa,
                align: 'center'
            }
        });
        type.anchor.set(0.5, 0);
        type.x = W / 2;
        type.y = zoneY + 5;
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
                    fill: this.COLORS.gold,
                    align: 'center'
                }
            });
            abText.anchor.set(0.5, 0);
            abText.x = W / 2;
            abText.y = zoneY + 22;
            container.addChild(abText);
        }
    },

    /**
     * Gemmes de statistiques (Mana, ATK, HP)
     */
    drawStatGems(container, card) {
        const W = this.CARD_WIDTH;
        const H = this.CARD_HEIGHT;
        const hp = card.currentHp ?? card.hp;

        // === MANA (haut gauche) - Gemme bleue ===
        this.drawGem(container, 20, 15, this.COLORS.blue, card.cost, 'mana');

        // === ATK (bas gauche) - Gemme verte ===
        this.drawGem(container, 25, H - 35, this.COLORS.green, card.atk, 'atk');

        // === HP (bas droite) - Gemme rouge ===
        const hpColor = hp < card.hp ? 0xff6b6b : this.COLORS.red;
        this.drawGem(container, W - 25, H - 35, hpColor, hp, 'hp');
    },

    /**
     * Dessine une gemme de stat
     */
    drawGem(container, x, y, color, value, type) {
        const size = 18;

        // Ombre
        const shadow = new PIXI.Graphics();
        shadow.circle(x + 2, y + 2, size);
        shadow.fill({ color: 0x000000, alpha: 0.5 });
        container.addChild(shadow);

        // Fond de la gemme (cercle principal)
        const gem = new PIXI.Graphics();
        gem.circle(x, y, size);
        gem.fill({ color: color });
        container.addChild(gem);

        // Reflet brillant
        const highlight = new PIXI.Graphics();
        highlight.circle(x - 5, y - 5, 6);
        highlight.fill({ color: 0xffffff, alpha: 0.4 });
        container.addChild(highlight);

        // Bordure dorée
        const border = new PIXI.Graphics();
        border.circle(x, y, size);
        border.stroke({ color: this.COLORS.gold, width: 2 });
        container.addChild(border);

        // Valeur
        const text = new PIXI.Text({
            text: value.toString(),
            style: {
                fontFamily: 'Arial Black, sans-serif',
                fontSize: 16,
                fontWeight: 'bold',
                fill: 0xffffff,
                stroke: { color: 0x000000, width: 3 }
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
        PIXI.Assets.cache.reset();
    }
};

// Initialiser au chargement
if (typeof window !== 'undefined') {
    window.CardRenderer = CardRenderer;
}
