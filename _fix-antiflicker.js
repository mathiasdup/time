// Fix: Anti-flicker guard should also clear when state was updated AFTER the visual damage
// Previously only expired after 1800ms timeout, now also clears if stateHpSyncAt > visualDmgSetAt
const fs = require('fs');

const path = 'public/js/game-render.js';
let src = fs.readFileSync(path, 'utf8');

const oldCode = 'const visualDmgExpired = visualDmgHp !== undefined && visualDmgSetAt > 0 && (Date.now() - visualDmgSetAt > 1800);';
const newCode = 'const stateHpSyncAt = parseInt(existingCardEl.dataset.stateHpSyncAt || \'0\', 10);\n' +
    '                    const visualDmgExpired = visualDmgHp !== undefined && visualDmgSetAt > 0 && (\n' +
    '                        (Date.now() - visualDmgSetAt > 1800) ||\n' +
    '                        (stateHpSyncAt > visualDmgSetAt)\n' +
    '                    );';

if (!src.includes(oldCode)) {
    console.error('ERROR: anti-flicker guard code not found');
    process.exit(1);
}

// Also need to remove the duplicate stateHpSyncAt declaration that's already above
// Check if stateHpSyncAt is already declared in this scope
const alreadyDeclared = src.indexOf('const stateHpSyncAt = parseInt(existingCardEl.dataset.stateHpSyncAt', src.indexOf('existingCardEl.dataset.stateHp = hpStr;'));
if (alreadyDeclared !== -1 && alreadyDeclared < src.indexOf(oldCode)) {
    // Already declared above - just reference it, don't re-declare
    const newCodeNoRedeclare = 'const visualDmgExpired = visualDmgHp !== undefined && visualDmgSetAt > 0 && (\n' +
        '                        (Date.now() - visualDmgSetAt > 1800) ||\n' +
        '                        (stateHpSyncAt > visualDmgSetAt)\n' +
        '                    );';
    src = src.replace(oldCode, newCodeNoRedeclare);
    console.log('OK: anti-flicker now also checks stateHpSyncAt > visualDmgSetAt (existing var)');
} else {
    src = src.replace(oldCode, newCode);
    console.log('OK: anti-flicker now also checks stateHpSyncAt > visualDmgSetAt (new var)');
}

fs.writeFileSync(path, src, 'utf8');
