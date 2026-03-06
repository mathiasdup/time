const fs = require('fs');
let src = fs.readFileSync('server.js', 'utf8');
const nl = src.includes('\r\n') ? '\r\n' : '\n';

const anchor = 'if (card && card.currentHp > 0 && card.buffOnAnyPoisonDeath) {' + nl +
    '                                    card.buffCounters = (card.buffCounters || 0) + totalPoisonDeaths;' + nl +
    '                                    card.atk += totalPoisonDeaths;';

const replace = 'if (card && card.currentHp > 0 && card.buffOnAnyPoisonDeath) {' + nl +
    '                                    if (card.baseAtk === undefined) card.baseAtk = card.atk;' + nl +
    '                                    if (card.baseHp === undefined) card.baseHp = card.hp;' + nl +
    '                                    if (card.baseRiposte === undefined) card.baseRiposte = card.riposte ?? 0;' + nl +
    '                                    card.buffCounters = (card.buffCounters || 0) + totalPoisonDeaths;' + nl +
    '                                    card.atk += totalPoisonDeaths;';

if (!src.includes(anchor)) {
    console.error('ERROR: anchor not found for 2nd buffOnAnyPoisonDeath');
    process.exit(1);
}
src = src.replace(anchor, replace);
fs.writeFileSync('server.js', src, 'utf8');
console.log('OK: server.js — 2nd buffOnAnyPoisonDeath fixed');
