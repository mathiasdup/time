const { execSync } = require('child_process');
const data = execSync('git show ea7e76d:public/js/game-animations.js', { encoding: 'latin1', maxBuffer: 50*1024*1024 });

const idx = data.indexOf('function animateSpellReveal');
const end = data.indexOf('async function animateSpell(data)', idx);
const section = data.substring(idx, end);

// Show card dimensions
const dimIdx = section.indexOf('cardWidth');
console.log('=== OLD CARD DIMENSIONS ===');
console.log(section.substring(dimIdx - 10, dimIdx + 100));

// Show graveScale computation
const gsIdx = section.indexOf('graveScaleX');
console.log('\n=== OLD GRAVE SCALE ===');
console.log(section.substring(gsIdx - 20, gsIdx + 300));

// Show calibration
const calIdx = section.indexOf('Calibrer');
if (calIdx !== -1) {
    console.log('\n=== OLD CALIBRATION ===');
    console.log(section.substring(calIdx, calIdx + 700));
}

// Show fly phase
const flyIdx = section.indexOf('PHASE 4');
console.log('\n=== OLD FLY PHASE ===');
console.log(section.substring(flyIdx - 30, flyIdx + 400));

// Show transform line
const trIdx = section.indexOf('wrapper.style.transform = `scale');
if (trIdx !== -1) {
    console.log('\n=== OLD TRANSFORM ===');
    console.log(section.substring(trIdx, trIdx + 100));
}

// Find the actual transform used during animation
let pos = 0;
const transforms = [];
while (true) {
    const i = section.indexOf('wrapper.style.transform', pos);
    if (i === -1) break;
    transforms.push(section.substring(i, i + 120));
    pos = i + 1;
}
console.log('\n=== ALL TRANSFORMS IN OLD animateSpellReveal ===');
transforms.forEach((t, i) => console.log(i + ':', t));
