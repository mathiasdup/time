// Fix: Card flash watchdog should compare UIDs to distinguish real flash from slot replacement
const fs = require('fs');

const path = 'public/js/card-flash-watchdog.js';
let src = fs.readFileSync(path, 'utf8');

// Find the flash detection block and add UID comparison
const oldCheck = "if (delta <= FLASH_THRESHOLD_MS) {";
const newCheck = "if (delta <= FLASH_THRESHOLD_MS && (pending.uid === addUid || !pending.uid || !addUid)) {";

if (!src.includes(oldCheck)) {
    console.error('ERROR: flash threshold check not found');
    process.exit(1);
}

src = src.replace(oldCheck, newCheck);

// Also add a log for slot replacements (different UID = not a flash)
const oldDeletePending = "                    delete _pendingRemovals[slotKey];";
// Find the one AFTER the flash detection (not the trap one)
const flashContext = "                    }\n                    delete _pendingRemovals[slotKey];";
const newFlashContext = "                    } else if (delta <= FLASH_THRESHOLD_MS && pending.uid && addUid && pending.uid !== addUid) {\n" +
    "                        // Different card replaced on same slot — not a flash\n" +
    "                        console.log('[CARD-FLASH] \\u267B slot-replace @' + slotKey +\n" +
    "                            ': \"' + (pending.name || '?') + '\" -> \"' + (addName || '?') +\n" +
    "                            '\" in ' + delta + 'ms');\n" +
    "                    }\n                    delete _pendingRemovals[slotKey];";

if (!src.includes(flashContext)) {
    console.error('ERROR: flash context block not found');
    process.exit(1);
}

src = src.replace(flashContext, newFlashContext);

fs.writeFileSync(path, src, 'utf8');
console.log('OK: card-flash-watchdog now compares UIDs — slot replacements are not flagged as flashes');
