const fs = require('fs');
let code = fs.readFileSync('public/js/game-render.js', 'utf8');

// ====== 1. Add _flipOppHandCards helper before renderOppHand ======
const anchorHelper = 'function renderOppHand(count, oppHand) {';
if (!code.includes(anchorHelper)) { console.log('ANCHOR renderOppHand NOT FOUND'); process.exit(1); }

const helperFn = [
    '// --- FLIP helper: smooth repositioning of opp hand cards ---',
    'function _flipOppHandCards(panel, oldLefts, duration) {',
    '    if (!oldLefts || oldLefts.length === 0) return;',
    '    duration = duration || 0.35;',
    '    var current = Array.from(panel.children).filter(function(c) {',
    '        return c.style.width !== \'0px\';',
    '    });',
    '    var toAnimate = [];',
    '    for (var i = 0; i < Math.min(oldLefts.length, current.length); i++) {',
    '        var newLeft = current[i].getBoundingClientRect().left;',
    '        var dx = oldLefts[i] - newLeft;',
    '        if (Math.abs(dx) > 1) {',
    '            current[i].style.transition = \'none\';',
    '            current[i].style.transform = \'translateX(\' + dx + \'px)\';',
    '            toAnimate.push(current[i]);',
    '        }',
    '    }',
    '    if (toAnimate.length > 0) {',
    '        panel.getBoundingClientRect(); // force reflow',
    '        requestAnimationFrame(function() {',
    '            for (var j = 0; j < toAnimate.length; j++) {',
    '                toAnimate[j].style.transition = \'transform \' + duration + \'s cubic-bezier(0.4, 0, 0.2, 1)\';',
    '                toAnimate[j].style.transform = \'\';',
    '            }',
    '            setTimeout(function() {',
    '                for (var k = 0; k < toAnimate.length; k++) {',
    '                    toAnimate[k].style.transition = \'\';',
    '                }',
    '            }, duration * 1000 + 50);',
    '        });',
    '    }',
    '}',
    '',
    ''
].join('\r\n');

code = code.replace(anchorHelper, helperFn + anchorHelper);
console.log('Step 1 OK: _flipOppHandCards helper added');

// ====== 2. Add pre-purge position capture before the purge ======
const anchorPurge = code.indexOf('// Purger les cartes collapsed');
if (anchorPurge === -1) { console.log('ANCHOR purge NOT FOUND'); process.exit(1); }

// Find the line start
let lineStart = code.lastIndexOf('\n', anchorPurge) + 1;
const prePurgeCode = [
    '    // FLIP: capture positions of visible cards BEFORE purge',
    '    var _prePurgeLefts = Array.from(panel.children)',
    '        .filter(function(c) { return c.style.width !== \'0px\'; })',
    '        .map(function(c) { return c.getBoundingClientRect().left; });',
    '',
    ''
].join('\r\n');

code = code.substring(0, lineStart) + prePurgeCode + code.substring(lineStart);
console.log('Step 2 OK: pre-purge capture added');

// ====== 3. Add FLIP after purge in resolution early-return ======
// Find "return;" after the resolution shrink block
const shrinkAnchor = 'shrinkApplied: sortedRemoval.length > 0';
const shrinkIdx = code.indexOf(shrinkAnchor);
if (shrinkIdx === -1) { console.log('ANCHOR shrinkApplied NOT FOUND'); process.exit(1); }

// Find the "return;" after this
const returnAfterShrink = code.indexOf('return;', shrinkIdx);
if (returnAfterShrink === -1) { console.log('ANCHOR return after shrink NOT FOUND'); process.exit(1); }

// Insert FLIP call before the return
const flipBeforeReturn = '// FLIP: smooth reposition after purge during resolution\r\n        if (purgedCount > 0) _flipOppHandCards(panel, _prePurgeLefts, 0.3);\r\n        ';
code = code.substring(0, returnAfterShrink) + flipBeforeReturn + code.substring(returnAfterShrink);
console.log('Step 3 OK: FLIP added in resolution return path');

// ====== 4. Replace FLIP step 1 (old position capture) ======
const flipStep1Start = code.indexOf('// FLIP step 1 :');
if (flipStep1Start === -1) { console.log('ANCHOR FLIP step 1 NOT FOUND'); process.exit(1); }
const flipStep1End = code.indexOf('.map(c => c.getBoundingClientRect().left);', flipStep1Start);
if (flipStep1End === -1) { console.log('ANCHOR FLIP step 1 end NOT FOUND'); process.exit(1); }
// Find the end of that line + closing brace
let step1BlockEnd = code.indexOf('}', flipStep1End);
// Include the closing brace and newline
step1BlockEnd = code.indexOf('\n', step1BlockEnd) + 1;

code = code.substring(0, flipStep1Start) + '// (FLIP step 1 moved to pre-purge capture above)\r\n' + code.substring(step1BlockEnd);
console.log('Step 4 OK: old FLIP step 1 removed');

// ====== 5. Replace FLIP step 2 with _flipOppHandCards call ======
const flipStep2Start = code.indexOf('// FLIP step 2 :');
if (flipStep2Start === -1) { console.log('ANCHOR FLIP step 2 NOT FOUND'); process.exit(1); }

// Find the end of the FLIP step 2 block
// It ends with: }, 350); }); } }
// Let's find "if (oldPositions && !completedOppBounce)" first
const flipCondStart = code.indexOf('if (oldPositions && !completedOppBounce)', flipStep2Start);
if (flipCondStart === -1) {
    console.log('ANCHOR oldPositions condition NOT FOUND');
    process.exit(1);
}

// Find the closing of this entire if block
// Count braces from flipCondStart
let braceCount = 0;
let flipBlockEnd = -1;
for (let i = flipCondStart; i < code.length; i++) {
    if (code[i] === '{') braceCount++;
    if (code[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
            flipBlockEnd = i + 1;
            break;
        }
    }
}
if (flipBlockEnd === -1) { console.log('FLIP step 2 block end NOT FOUND'); process.exit(1); }

// Replace from FLIP step 2 comment to end of block
const oldFlip2 = code.substring(flipStep2Start, flipBlockEnd);
const newFlip2 = [
    '// FLIP step 2 : smooth reposition using pre-purge positions',
    '    if (!completedOppBounce) {',
    '        _flipOppHandCards(panel, _prePurgeLefts, 0.35);',
    '    }'
].join('\r\n');

code = code.replace(oldFlip2, newFlip2);
console.log('Step 5 OK: FLIP step 2 replaced');

// Clean up: remove stale "let oldPositions" references if any
// (oldPositions is no longer used, but the variable declaration was removed in step 4)

fs.writeFileSync('public/js/game-render.js', code);
console.log('\nAll done! renderOppHand FLIP improved.');
