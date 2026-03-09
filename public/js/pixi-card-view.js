/**
 * pixi-card-view.js — GPU card renderer
 *
 * Reproduces the exact DOM/SVG card visuals using Canvas2D composition → PIXI.Texture.
 * Cards are composed once at high resolution, then displayed as GPU sprites.
 * SVG paths are drawn via Path2D for pixel-perfect match with the DOM SVG version.
 *
 * Draw order matches DOM z-index stacking:
 *   z0:  Art image (clipped to inner rect)
 *   z5:  Title bar (semi-transparent bg + text)
 *   z5:  Text zone (semi-transparent bg + type/abilities/description)
 *   z8:  Border frame (evenodd gradient path)
 *   z8:  Stat orbs (ATK spiked circle, Riposte spiked diamond, HP circle)
 *   z8:  Mana orb (gray circle + cost number)
 *   z10: Rarity star
 */
(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════════
    var CW = 144, CH = 192;
    var VB_X = 10, VB_Y = 10, VB_W = 505, VB_H = 680;
    var DEFAULT_RT_SCALE = 2;

    // ═══════════════════════════════════════════════════════════════
    //  RUNTIME STATE
    // ═══════════════════════════════════════════════════════════════
    var _app = null;
    var _stage = null;
    var _artCache = {};      // url -> HTMLImageElement
    var _artLoading = {};    // url -> Promise
    var _pathsReady = false;
    var _fontsReady = false;
    var _fontWaiters = [];
    var _borderPath, _spikedCircle, _spikedDiamond, _spikedDiamondInner, _innerPath;

    // ═══════════════════════════════════════════════════════════════
    //  PATH2D CACHE (lazy from SVG globals)
    // ═══════════════════════════════════════════════════════════════
    function ensurePaths() {
        if (_pathsReady) return;
        if (typeof CARD_SVG_BORDER_PATH === 'undefined') return;
        _pathsReady = true;
        _borderPath = new Path2D(CARD_SVG_BORDER_PATH);
        _innerPath = new Path2D(CARD_SVG_INNER_PATH);
        _spikedCircle = new Path2D(CARD_SVG_SPIKED_CIRCLE);
        _spikedDiamond = new Path2D(CARD_SVG_SPIKED_DIAMOND);
        _spikedDiamondInner = new Path2D(CARD_SVG_SPIKED_DIAMOND_INNER);
    }

    // ═══════════════════════════════════════════════════════════════
    //  ART IMAGE LOADER
    // ═══════════════════════════════════════════════════════════════
    function ensureFonts(cb) {
        if (_fontsReady === true) { if (cb) cb(); return; }
        if (cb) _fontWaiters.push(cb);
        if (_fontsReady === 'loading') return;
        _fontsReady = 'loading';
        var done = function() {
            _fontsReady = true;
            var waiters = _fontWaiters.splice(0);
            for (var i = 0; i < waiters.length; i++) waiters[i]();
        };
        // Force-load all weights used by Canvas2D
        var loads = [
            document.fonts.load('400 16px "Glacial Indifference"'),
            document.fonts.load('500 16px "Glacial Indifference"'),
            document.fonts.load('700 16px "Glacial Indifference"'),
            document.fonts.load('800 16px "Glacial Indifference"'),
            document.fonts.load('900 16px "Glacial Indifference"')
        ];
        Promise.all(loads).then(done).catch(done);
    }

        function loadArt(url, onLoaded) {
        if (!url) return null;
        if (_artCache[url]) {
            if (onLoaded) setTimeout(function () { onLoaded(_artCache[url]); }, 0);
            return _artCache[url];
        }
        if (!_artLoading[url]) {
            _artLoading[url] = [];
            var img = new Image();
            img.onload = function () {
                _artCache[url] = img;
                var cbs = _artLoading[url] || [];
                delete _artLoading[url];
                for (var i = 0; i < cbs.length; i++) cbs[i](img);
            };
            img.onerror = function () {
                delete _artLoading[url];
            };
            img.src = url;
        }
        if (onLoaded) _artLoading[url].push(onLoaded);
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════
    function toNum(v) {
        var n = Number(v);
        return isFinite(n) ? n : null;
    }

    function statColor(current, base, defaultColor) {
        var c = toNum(current), b = toNum(base);
        if (c === null || b === null) return defaultColor || '#e5e5e5';
        if (c > b) return '#7fff7f';
        if (c < b) return '#790606';
        return defaultColor || '#e5e5e5';
    }

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function damp(cur, tgt, rate, dt) { return cur + (tgt - cur) * (1 - Math.exp(-rate * dt)); }

    // ═══════════════════════════════════════════════════════════════
    //  DRAW: ART (SVG viewBox space)
    // ═══════════════════════════════════════════════════════════════
    function drawArt(ctx, artImg) {
        if (!artImg) {
            // Dark fallback when art not loaded
            ctx.save();
            var grad = ctx.createLinearGradient(262, 10, 262, 690);
            grad.addColorStop(0, '#2a2a3a');
            grad.addColorStop(1, '#1a1a25');
            ctx.fillStyle = grad;
            ctx.fill(_innerPath);
            ctx.restore();
            return;
        }
        ctx.save();
        var clip = new Path2D();
        clip.roundRect(21, 20, 483, 660, 4);
        ctx.clip(clip);
        // Cover mode: xMidYMin slice (same as SVG preserveAspectRatio)
        var imgW = artImg.naturalWidth || artImg.width;
        var imgH = artImg.naturalHeight || artImg.height;
        if (imgW > 0 && imgH > 0) {
            var scale = Math.max(525 / imgW, 700 / imgH);
            var dw = imgW * scale;
            var dh = imgH * scale;
            var dx = (525 - dw) / 2;
            var dy = 0;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(artImg, dx, dy, dw, dh);
        }
        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════
    //  DRAW: BORDER FRAME (SVG viewBox space)
    // ═══════════════════════════════════════════════════════════════
    function drawBorder(ctx, theme) {
        var grad = ctx.createLinearGradient(10, 10, 515, 690);
        grad.addColorStop(0, theme.borderDark);
        grad.addColorStop(0.5, theme.borderLight);
        grad.addColorStop(1, theme.borderDark);
        ctx.fillStyle = grad;
        ctx.fill(_borderPath, 'evenodd');
        ctx.strokeStyle = theme.borderDark;
        ctx.lineWidth = 0.5;
        ctx.stroke(_borderPath);
    }

    // ═══════════════════════════════════════════════════════════════
    //  DRAW: STAT TEXT with shadow (SVG local space)
    // ═══════════════════════════════════════════════════════════════
    function drawStatText(ctx, text, fontSize, color) {
        ctx.font = 'bold ' + fontSize + 'px "Glacial Indifference", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = color;
        // SVG dominant-baseline="central" ≈ alphabetic baseline shifted up by ~0.35em
        var yOffset = fontSize * 0.36;
        // Shadow: tight drop shadow matching SVG feDropShadow
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 1;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1;
        ctx.fillText(String(text), 0, yOffset);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  DRAW: CREATURE STATS (SVG viewBox space)
    // ═══════════════════════════════════════════════════════════════
    function drawCreatureStats(ctx, card, fontsOk) {
        var atkVal = toNum(card.atk) !== null ? toNum(card.atk) : 0;
        var riposteVal = toNum(card.riposte) !== null ? toNum(card.riposte) : 0;
        var hpVal = toNum(card.currentHp != null ? card.currentHp : card.hp) !== null
            ? toNum(card.currentHp != null ? card.currentHp : card.hp) : 0;

        var atkColor = card.isBuilding ? '#e5e5e5' : statColor(card.atk, card.baseAtk != null ? card.baseAtk : card.atk, '#e5e5e5');
        var riposteColor = statColor(card.riposte, card.baseRiposte != null ? card.baseRiposte : card.riposte, '#e5e5e5');
        var rawHp = card.currentHp != null ? card.currentHp : card.hp;
        var baseHp = card.baseHp != null ? card.baseHp : card.hp;
        var hpColor = statColor(rawHp, baseHp, '#efefef');

        // ATK (Spiked Circle) — translate(450, 435) scale(0.34)
        if (!card.isBuilding) {
            ctx.save();
            ctx.translate(450, 435);
            ctx.scale(0.34, 0.34);
            // Outer glow
            ctx.fillStyle = 'rgba(221,221,221,0.459)';
            ctx.fill(_spikedCircle);
            // Inner circle with gradient
            var starGrad = ctx.createLinearGradient(-95, -95, 95, 95);
            starGrad.addColorStop(0, '#3a3a3a');
            starGrad.addColorStop(1, '#1a1a1a');
            ctx.fillStyle = starGrad;
            ctx.beginPath();
            ctx.arc(0, 0, 95, 0, Math.PI * 2);
            ctx.fill();
            if (fontsOk) drawStatText(ctx, atkVal, 170, atkColor);
            ctx.restore();

            // RIPOSTE (Spiked Diamond) — translate(450, 534) scale(0.36)
            ctx.save();
            ctx.translate(450, 534);
            ctx.scale(0.36, 0.36);
            ctx.fillStyle = 'rgba(221,221,221,0.459)';
            ctx.fill(_spikedDiamond);
            var starGrad2 = ctx.createLinearGradient(-108, -108, 108, 108);
            starGrad2.addColorStop(0, '#3a3a3a');
            starGrad2.addColorStop(1, '#1a1a1a');
            ctx.fillStyle = starGrad2;
            ctx.fill(_spikedDiamondInner);
            if (fontsOk) drawStatText(ctx, riposteVal, 160, riposteColor);
            ctx.restore();
        }

        // HP (Circle) — translate(450, 629) scale(0.34)
        ctx.save();
        ctx.translate(450, 629);
        ctx.scale(0.34, 0.34);
        ctx.fillStyle = 'rgba(221,221,221,0.459)';
        ctx.beginPath();
        ctx.arc(0, 0, 116, 0, Math.PI * 2);
        ctx.fill();
        var hpGrad;
        if (card.isBuilding) {
            hpGrad = ctx.createLinearGradient(-100, -100, 100, 100);
            hpGrad.addColorStop(0, '#5a5e62');
            hpGrad.addColorStop(0.5, '#44484c');
            hpGrad.addColorStop(1, '#2e3236');
        } else {
            hpGrad = ctx.createLinearGradient(-100, -100, 100, 100);
            hpGrad.addColorStop(0, '#f472b6');
            hpGrad.addColorStop(0.5, '#e11d48');
            hpGrad.addColorStop(1, '#be123c');
        }
        ctx.fillStyle = hpGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 100, 0, Math.PI * 2);
        ctx.fill();
        if (fontsOk) drawStatText(ctx, hpVal, card.isBuilding ? 180 : 170, hpColor);
        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════
    //  DRAW: MANA ORB (SVG viewBox space)
    // ═══════════════════════════════════════════════════════════════
    function drawMana(ctx, card, discountedCost) {
        var cost = (discountedCost != null) ? discountedCost : card.cost;
        var isDiscounted = (discountedCost != null);

        ctx.save();
        ctx.translate(68, 126);
        // Outer stroke ring (r=32, stroke-width=8, stroke-opacity=0.52)
        ctx.beginPath();
        ctx.arc(0, 0, 36, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(209,209,209,0.52)';
        ctx.fill();
        // Inner fill
        ctx.beginPath();
        ctx.arc(0, 0, 32, 0, Math.PI * 2);
        ctx.fillStyle = '#d1d1d1';
        ctx.fill();
        // Cost text
        ctx.font = '900 58px "Glacial Indifference", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = isDiscounted ? '#4caf50' : '#292929';
        ctx.fillText(String(cost != null ? cost : ''), 0, 58 * 0.36);
        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════
    //  DRAW: TITLE BAR (display pixel space, ctx pre-scaled by rtScale)
    // ═══════════════════════════════════════════════════════════════
    function drawTitle(ctx, card, theme, s) {
        s = s || 1;
        var x = Math.round(CW * 0.02 * s);
        var y = Math.round(CH * 0.01 * s);
        var w = Math.round((CW - 2 * Math.round(CW * 0.02)) * s);
        var padTop = 4 * s, padBot = 3 * s, padLR = 4 * s;

        var bgColor = card.titleColor || 'rgba(43,43,43,0.4)';
        ctx.fillStyle = bgColor;

        var text = (card.name || '').toUpperCase();
        var maxWidth = w - padLR * 2;
        var fontSize = 8 * s;
        ctx.font = '800 ' + fontSize + 'px "Glacial Indifference", sans-serif';
        var m = ctx.measureText(text);
        while (m.width > maxWidth && fontSize > 4 * s) {
            fontSize -= 0.5 * s;
            ctx.font = '800 ' + fontSize + 'px "Glacial Indifference", sans-serif';
            m = ctx.measureText(text);
        }
        var lineH = fontSize * 1.2;
        var barH = padTop + lineH + padBot;
        ctx.fillRect(x, y, w, barH);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.titleColor || '#e5e5e5';
        if ('letterSpacing' in ctx) ctx.letterSpacing = Math.round(s) + 'px';
        ctx.fillText(text, x + w / 2, y + padTop + lineH / 2);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }

    // ═══════════════════════════════════════════════════════════════
    //  DRAW: TEXT ZONE — in-hand only (display pixel space)
    // ═══════════════════════════════════════════════════════════════
    function drawTextZone(ctx, card, theme, domEl, s) {
        s = s || 1;
        var x = Math.round(CW * 0.025 * s);
        var y = Math.round(CH * 0.55 * s);
        var w = Math.round((CW - Math.round(CW * 0.025) - Math.round(CW * 0.02)) * s);
        var h = Math.round((CH - Math.round(CH * 0.01) - Math.round(CH * 0.55)) * s);

        // Background
        ctx.fillStyle = theme.darkBase + '0.8)';
        ctx.fillRect(x, y, w, h);

        // Border top
        ctx.strokeStyle = theme.typeSep || 'rgba(255,255,255,0.25)';
        ctx.lineWidth = s;
        ctx.beginPath();
        ctx.moveTo(x, y + 0.5 * s);
        ctx.lineTo(x + w, y + 0.5 * s);
        ctx.stroke();

        var textX = x + 3 * s;
        var textW = w - 33 * s;
        var curY = y + 2 * s;

        // Type line — always use clean-encoded builder
        var typeLine = buildTypeLine(card);
        if (typeLine) {
            ctx.font = '400 ' + (7 * s) + 'px "Glacial Indifference", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#efefef';
            ctx.fillText(typeLine, textX, curY);
            curY += 9 * s;
        }

        // Separator gradient line
        var sepGrad = ctx.createLinearGradient(textX, 0, textX + textW, 0);
        sepGrad.addColorStop(0, 'transparent');
        sepGrad.addColorStop(0.5, theme.typeSep || 'rgba(255,255,255,0.25)');
        sepGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = sepGrad;
        ctx.fillRect(textX, curY, textW, s);
        curY += 4 * s;

        // Abilities text (yellow) — always use our own clean-encoded names
        var abilitiesText = buildAbilitiesText(card);
        if (abilitiesText) {
            ctx.font = '900 ' + (8 * s) + 'px "Glacial Indifference", sans-serif';
            ctx.fillStyle = '#f3b712';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            var abLines = wrapText(ctx, abilitiesText, textW);
            for (var ai = 0; ai < abLines.length; ai++) {
                if (curY > y + h - 4 * s) break;
                ctx.fillText(abLines[ai], textX, curY);
                curY += 10 * s;
            }
            curY += 2 * s;
        }

        // Description text
        var specialText = '';
        if (domEl) {
            var spEl = domEl.querySelector('.arena-special');
            if (spEl) specialText = spEl.textContent || '';
        }
        if (!specialText && card.description) specialText = card.description;
        if (specialText) {
            ctx.font = '500 ' + (8 * s) + 'px "Glacial Indifference", sans-serif';
            ctx.fillStyle = theme.textColor || '#d0d0d0';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            var spLines = wrapText(ctx, specialText, textW);
            for (var si = 0; si < spLines.length; si++) {
                if (curY > y + h - 4 * s) break;
                ctx.fillText(spLines[si], textX, curY);
                curY += 10 * s;
            }
        }
    }

    function wrapText(ctx, text, maxWidth) {
        var words = text.split(/\s+/);
        var lines = [];
        var current = '';
        for (var i = 0; i < words.length; i++) {
            var test = current ? current + ' ' + words[i] : words[i];
            if (ctx.measureText(test).width > maxWidth && current) {
                lines.push(current);
                current = words[i];
            } else {
                current = test;
            }
        }
        if (current) lines.push(current);
        return lines;
    }

    // ═══════════════════════════════════════════════════════════════
    //  DRAW: RARITY STAR (display pixel space)
    // ═══════════════════════════════════════════════════════════════
    function drawRarity(ctx, card, s) {
        s = s || 1;
        var rarityMap = (typeof _RARITY_MAP !== 'undefined') ? _RARITY_MAP : { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'mythic', 5: 'platinum' };
        var rarityClass = rarityMap[card.edition] || 'common';
        var rarity = (typeof CARD_RARITIES !== 'undefined') ? CARD_RARITIES[rarityClass] : null;
        if (!rarity) return;

        ctx.save();
        ctx.font = (8 * s) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = rarity.color;
        ctx.shadowColor = rarity.glow + '0.6)';
        ctx.shadowBlur = 6 * s;
        ctx.fillText('\u2726', CW * s / 2, CH * 0.98 * s);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════
    //  TEXT HELPERS (fallback when no DOM element available)
    // ═══════════════════════════════════════════════════════════════
    function buildTypeLine(card) {
        var isSpell = card.type === 'spell';
        var isTrap = card.type === 'trap';
        if (isTrap) return 'Pi\u00e8ge';
        if (isSpell) {
            if (card.spellSpeed !== undefined) return 'Sort - Vitesse ' + card.spellSpeed;
            if (card.spellType) {
                var m = { offensif: 'Offensif', 'defensif': 'D\u00e9fensif', hybride: 'Hybride' };
                return 'Sort - ' + (m[card.spellType] || card.spellType);
            }
            return 'Sort';
        }
        if (card.isBuilding) {
            var t = 'B\u00e2timent';
            if (card.creatureType && typeof _CREATURE_TYPE_NAMES !== 'undefined' && _CREATURE_TYPE_NAMES[card.creatureType])
                t += ' - ' + _CREATURE_TYPE_NAMES[card.creatureType];
            return t;
        }
        var combatType = 'M\u00eal\u00e9e';
        if (card.combatType === 'shooter' || (card.abilities && card.abilities.indexOf('shooter') >= 0)) combatType = 'Tireur';
        else if (card.combatType === 'fly' || (card.abilities && card.abilities.indexOf('fly') >= 0)) combatType = 'Volant';
        var line = 'Cr\u00e9ature - ' + combatType;
        if (card.creatureType && typeof _CREATURE_TYPE_NAMES !== 'undefined' && _CREATURE_TYPE_NAMES[card.creatureType])
            line += ' - ' + _CREATURE_TYPE_NAMES[card.creatureType];
        return line;
    }

    // Own ability names map with clean Unicode escapes (bypasses double-encoded game-render.js)
    var _PIXI_ABILITY_NAMES = {
        haste: 'C\u00e9l\u00e9rit\u00e9', superhaste: 'Superc\u00e9l\u00e9rit\u00e9', intangible: 'Intangible',
        trample: 'Pi\u00e9tinement', power: 'Puissance', immovable: 'Immobile', wall: 'Mur',
        regeneration: 'R\u00e9g\u00e9n\u00e9ration', protection: 'Protection',
        spellBoost: 'Sort renforc\u00e9', enhance: 'Am\u00e9lioration', bloodthirst: 'Soif de sang',
        melody: 'M\u00e9lodie', camouflage: 'Camouflage', lethal: 'Toucher mortel',
        spectral: 'Spectral', poison: 'Poison', untargetable: 'Inciblable', entrave: 'Entrave',
        lifelink: 'Lien vital', lifedrain: 'Drain de vie', dissipation: 'Dissipation',
        antitoxin: 'Antitoxine', soinToxique: 'Soin toxique', unsacrificable: 'Non sacrifiable',
        provocation: 'Provocation', deflexion: 'D\u00e9flexion', cleave: 'Frappe large'
    };

    function buildAbilitiesText(card) {
        if (!card.abilities || !card.abilities.length) return '';
        var names = _PIXI_ABILITY_NAMES;
        var parts = [];
        for (var i = 0; i < card.abilities.length; i++) {
            var a = card.abilities[i];
            if (a === 'shooter' || a === 'fly') continue;
            var n = names[a] || a;
            // Append numeric value if available
            if (a === 'cleave' && card.cleaveX) n += ' ' + card.cleaveX;
            else if (a === 'power' && card.powerX) n += ' ' + card.powerX;
            else if (a === 'regeneration' && card.regenerationX) n += ' ' + card.regenerationX;
            else if (a === 'spellBoost' && card.spellBoostAmount) n += ' ' + card.spellBoostAmount;
            else if (a === 'enhance' && card.enhanceAmount) n += ' ' + card.enhanceAmount;
            else if (a === 'bloodthirst' && card.bloodthirstAmount) n += ' ' + card.bloodthirstAmount;
            else if (a === 'poison' && card.poisonX) n += ' ' + card.poisonX;
            else if (a === 'entrave' && card.entraveX) n += ' ' + card.entraveX;
            else if (a === 'lifedrain' && card.lifedrainX) n += ' ' + card.lifedrainX;
            else if (a === 'lifelink' && card.lifelinkX) n += ' ' + card.lifelinkX;
            parts.push(n);
        }
        if (card.sacrifice) parts.push('Sacrifice ' + card.sacrifice);
        return parts.join(', ');
    }

    // ═══════════════════════════════════════════════════════════════
    //  COMPOSE CARD → Canvas
    // ═══════════════════════════════════════════════════════════════
    function composeCard(card, rtScale, inHand, artImg, domEl) {
        ensurePaths();
        if (!_pathsReady) return null;
        var fontsOk = (_fontsReady === true);


        var theme = (typeof CARD_THEMES !== 'undefined' && CARD_THEMES[card.faction])
            ? CARD_THEMES[card.faction]
            : (typeof CARD_THEMES !== 'undefined' ? CARD_THEMES.black : {
                borderDark: '#3a3a4a', borderLight: '#7a7a8a', border: '#5a5a6a',
                titleColor: '#e5e5e5', textColor: '#c0bcc8',
                darkBase: 'rgba(8,6,12,', typeSep: 'rgba(167,139,250,0.25)'
            });

        var isSpell = card.type === 'spell';
        var isTrap = card.type === 'trap';
        var noStats = isSpell || isTrap;

        var cw = Math.ceil(CW * rtScale);
        var ch = Math.ceil(CH * rtScale);
        var canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // ── Layer z0: Art (SVG viewBox space) ──
        ctx.save();
        ctx.scale(cw / VB_W, ch / VB_H);
        ctx.translate(-VB_X, -VB_Y);
        drawArt(ctx, artImg);
        ctx.restore();

        // ── Layer z5: Title bar (display pixel space) — in-hand only ──
        if (inHand && fontsOk) {
            ctx.save();
            drawTitle(ctx, card, theme, rtScale);
            ctx.restore();
        }

        // ── Layer z5: Text zone (display pixel space) — in-hand only ──
        if (inHand && fontsOk) {
            ctx.save();
            drawTextZone(ctx, card, theme, domEl, rtScale);
            ctx.restore();
        }

        // ── Layer z8: Border frame (SVG viewBox space) ──
        ctx.save();
        ctx.scale(cw / VB_W, ch / VB_H);
        ctx.translate(-VB_X, -VB_Y);
        drawBorder(ctx, theme);

        // ── Layer z8: Stats (SVG viewBox space) ──
        if (!noStats) {
            drawCreatureStats(ctx, card, fontsOk);
        }

        // ── Layer z8: Mana orb (SVG viewBox space) — in-hand only ──
        if (inHand && fontsOk) {
            drawMana(ctx, card);
        }
        ctx.restore();

        // ── Layer z10: Rarity star (display pixel space) — in-hand only ──
        if (inHand && fontsOk) {
            ctx.save();
            drawRarity(ctx, card, rtScale);
            ctx.restore();
        }

        return canvas;
    }

    // ═══════════════════════════════════════════════════════════════
    //  CARD API — buildCardApi(data, options) → card controller
    // ═══════════════════════════════════════════════════════════════
    function buildCardApi(initialData, creationOpts) {
        var data = initialData || {};
        var opts = creationOpts || {};
        var inHand = !!opts.inHand;
        var domEl = opts.domSourceEl || null;
        var rtScale = opts.rtScale || DEFAULT_RT_SCALE;

        // Art URL
        var artUrl = data.image ? ('/cards/' + data.image) : null;
        var artImg = artUrl ? (_artCache[artUrl] || null) : null;

        // Compose initial texture (may have dark art fallback if image not cached yet)
        var cardCanvas = composeCard(data, rtScale, inHand, artImg, domEl);
        var texture = cardCanvas ? PIXI.Texture.from(cardCanvas) : PIXI.Texture.WHITE;

        // Container
        var container = new PIXI.Container();
        container.sortableChildren = true;

        // Sprite
        var sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.width = CW;
        sprite.height = CH;
        sprite.zIndex = 10;
        container.addChild(sprite);


        // State
        var state = {
            x: 0, y: 0, width: CW, height: CH,
            zIndex: 1, hoverScale: 1.02,
            isHovered: false, curScale: 1,
            px: 0, py: 0
        };
        var destroyed = false;

        // Load art async and recompose
        if (artUrl && !artImg) {
            loadArt(artUrl, function (img) {
                if (destroyed || !img) return;
                artImg = img;
                recompose();
            });
        }

        // Ensure fonts are loaded, then recompose
        if (_fontsReady !== true) {
            ensureFonts(function() {
                if (!destroyed) recompose();
            });
        }

        function recompose() {
            if (destroyed) return;
            var newCanvas = composeCard(data, rtScale, inHand, artImg, domEl);
            if (!newCanvas) return;
            var oldTex = texture;
            texture = PIXI.Texture.from(newCanvas);
            sprite.texture = texture;
            sprite.width = CW;
            sprite.height = CH;
            if (oldTex && oldTex !== PIXI.Texture.WHITE) {
                try { oldTex.destroy(true); } catch (e) { /* no-op */ }
            }
        }

        // API
        var api = {
            container: container,
            __smallRT: texture,

            setLayout: function (next) {
                if (!next) return;
                state.x = next.x != null ? next.x : state.x;
                state.y = next.y != null ? next.y : state.y;
                state.width = next.width != null ? next.width : state.width;
                state.height = next.height != null ? next.height : state.height;
                state.zIndex = next.zIndex != null ? next.zIndex : state.zIndex;
                state.hoverScale = next.hoverScale != null ? next.hoverScale : state.hoverScale;
                container.zIndex = state.zIndex;
            },

            setPointerLocal: function (localX, localY, hovered) {
                state.px = localX;
                state.py = localY;
                state.isHovered = !!hovered;
            },

            setHovered: function (v) {
                state.isHovered = !!v;
            },

            update: function (dt) {
                if (destroyed) return;
                // Position
                // Glow pulse animation
                container.position.set(state.x, state.y);
                // Scale: smooth hover animation
                var targetScale = state.isHovered ? state.hoverScale : 1.0;
                var sx = state.width / CW;
                var sy = state.height / CH;
                state.curScale = damp(state.curScale, targetScale, 12, dt);
                container.scale.set(sx * state.curScale, sy * state.curScale);
            },

            refresh: function (newData, newDomEl) {
                if (destroyed) return;
                data = newData || data;
                domEl = newDomEl || domEl;
                var newArtUrl = data.image ? ('/cards/' + data.image) : null;
                if (newArtUrl && newArtUrl !== artUrl) {
                    artUrl = newArtUrl;
                    artImg = _artCache[artUrl] || null;
                    if (!artImg) {
                        loadArt(artUrl, function (img) {
                            if (destroyed || !img) return;
                            artImg = img;
                            recompose();
                        });
                    }
                }
                recompose();
            },

            refreshDomSnapshotFromElement: function (el) {
                if (destroyed) return;
                domEl = el || domEl;
                recompose();
            },

            destroy: function () {
                if (destroyed) return;
                destroyed = true;
                container.destroy({ children: true });
                if (texture && texture !== PIXI.Texture.WHITE) {
                    try { texture.destroy(true); } catch (e) { /* no-op */ }
                }
            }
        };

        // Alias for compatibility check in pixi-board-layer.js
        Object.defineProperty(api, '__display', {
            get: function () { return sprite; }
        });

        return api;
    }

    // ═══════════════════════════════════════════════════════════════
    //  LIVE CARD TABLE CONTROLLER
    // ═══════════════════════════════════════════════════════════════
    function createLiveCardTableController(stage) {
        var liveCards = new Map();
        var tickerBound = false;

        function bindTicker() {
            if (tickerBound || !_app) return;
            tickerBound = true;
            _app.ticker.add(function () {
                var dt = _app.ticker.deltaMS / 1000;
                for (var rec of liveCards.values()) {
                    rec.update(dt);
                }
            });
        }

        return {
            liveCards: liveCards,
            sync: function (cardModels, layoutFn) {
                var models = Array.isArray(cardModels) ? cardModels : [];
                var keep = new Set();
                for (var i = 0; i < models.length; i++) {
                    var model = models[i];
                    var uid = model.uid || model.id || 'idx-' + i;
                    keep.add(uid);
                    var cardView = liveCards.get(uid);
                    if (!cardView) {
                        cardView = buildCardApi(model);
                        liveCards.set(uid, cardView);
                        stage.addChild(cardView.container);
                    }
                    var layout = (typeof layoutFn === 'function') ? layoutFn(model, i) : null;
                    if (layout) cardView.setLayout(layout);
                }
                for (var entry of liveCards.entries()) {
                    if (keep.has(entry[0])) continue;
                    entry[1].destroy();
                    liveCards.delete(entry[0]);
                }
                bindTicker();
            },
            destroy: function () {
                for (var v of liveCards.values()) v.destroy();
                liveCards.clear();
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  INIT & PUBLIC API
    // ═══════════════════════════════════════════════════════════════
    function init(cfg) {
        var conf = cfg || {};
        if (!conf.app || !conf.app.renderer) {
            throw new Error('PixiCardView.init expects an initialized PIXI.Application.');
        }
        _app = conf.app;
        _stage = conf.stage || conf.app.stage;
        ensurePaths();
        return api;
    }

    // ═══════════════════════════════════════════════════════════════
    //  ASSET PRELOADER — bulk-load art + fonts before game starts
    // ═══════════════════════════════════════════════════════════════
    function preloadAssets(imageUrls, onProgress, onDone) {
        var total = imageUrls.length + 1; // +1 for fonts
        var loaded = 0;
        function tick() {
            loaded++;
            if (onProgress) onProgress(loaded, total);
            if (loaded >= total && onDone) onDone();
        }
        // Fonts
        ensureFonts(tick);
        // Images
        if (imageUrls.length === 0) return;
        for (var i = 0; i < imageUrls.length; i++) {
            (function(url) {
                if (_artCache[url]) { tick(); return; }
                loadArt(url, function() { tick(); });
            })(imageUrls[i]);
        }
    }

    var api = {
        init: init,
        createCard: buildCardApi,
        createLiveCardTableController: createLiveCardTableController,
        preloadAssets: preloadAssets
    };

    window.createCard = function createCard(data, options) {
        return api.createCard(data, options);
    };

    window.PixiCardView = api;

    // Eagerly start font preloading as soon as script loads
    ensureFonts();
})();
