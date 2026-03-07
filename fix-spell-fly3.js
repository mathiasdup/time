const fs = require('fs');
let src = fs.readFileSync('public/js/game-animations.js', 'latin1');

// 1. Fix fly phase: uniform scale instead of separate X/Y
const oldFly = 'scaleX = 1.0 + (graveScaleX - 1.0) * ep;\n                scaleY = 1.0 + (graveScaleY - 1.0) * ep;';
const newFly = 'scaleX = scaleY = 1.0 + (graveScaleX - 1.0) * ep;';

let idx = src.indexOf(oldFly);
if (idx === -1) { console.error('Fly scale not found'); process.exit(1); }
src = src.substring(0, idx) + newFly + src.substring(idx + oldFly.length);
console.log('1. Fly: uniform scale');

// 2. Fix calibration: use uniform ratio like animateBurn
// Find: "graveScaleX *= target.width / m.width;\n                graveScaleY *= target.height / m.height;"
const oldRatio = 'graveScaleX *= target.width / m.width;\n                graveScaleY *= target.height / m.height;';
const newRatio = 'var _ratio = Math.min(target.width / m.width, target.height / m.height);\n                graveScaleX *= _ratio;\n                graveScaleY = graveScaleX;';

idx = src.indexOf(oldRatio);
if (idx === -1) { console.error('Calibration ratio not found'); process.exit(1); }
src = src.substring(0, idx) + newRatio + src.substring(idx + oldRatio.length);
console.log('2. Calibration: uniform ratio (Math.min)');

// 3. Fix calibration transform: scale(X) instead of scale(X, Y) since they're equal now
const oldCalibTransform = 'scale(${graveScaleX}, ${graveScaleY}) rotateX';
const newCalibTransform = 'scale(${graveScaleX}) rotateX';

idx = src.indexOf(oldCalibTransform);
if (idx === -1) { console.error('Calibration transform not found'); process.exit(1); }
src = src.substring(0, idx) + newCalibTransform + src.substring(idx + oldCalibTransform.length);
console.log('3. Calibration transform: scale(uniform)');

// 4. Change 3 passes to 6 for better convergence with uniform scale
const old3pass = 'for (let pass = 0; pass < 3; pass++)';
// Make sure we're in animateSpellReveal, not elsewhere
const spellFuncIdx = src.indexOf('function animateSpellReveal');
const nextFuncIdx = src.indexOf('async function animateSpell(data)', spellFuncIdx);
const spellSection = src.substring(spellFuncIdx, nextFuncIdx);
const passIdx = spellSection.indexOf(old3pass);
if (passIdx === -1) { console.error('3-pass loop not found in spellReveal'); process.exit(1); }
const absPassIdx = spellFuncIdx + passIdx;
src = src.substring(0, absPassIdx) + 'for (let pass = 0; pass < 6; pass++)' + src.substring(absPassIdx + old3pass.length);
console.log('4. Calibration: 6 passes');

// Verify
if (src.indexOf('Math.min(target.width') === -1) { console.error('FAIL: Math.min not in output'); process.exit(1); }
if (src.indexOf('scaleX = scaleY = 1.0 + (graveScaleX') === -1) { console.error('FAIL: uniform fly not in output'); process.exit(1); }

fs.writeFileSync('public/js/game-animations.js', src, 'latin1');
console.log('OK');
