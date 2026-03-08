// log-filter.js — Suppress diagnostic logs by default
// REACTIVATE: type  window.DEBUG_LOGS = true  in console (instant, no reload)
// Loaded BEFORE all game scripts
(function() {
    var _origLog = console.log;
    var _origWarn = console.warn;

    // All diagnostic prefixes — suppressed by default, DEBUG_LOGS = true to see them
    var SUPPRESS = [
        '[HP-MUTOBS]',
        '[HP-WATCHDOG]',
        '[HP]',
        '[CARD-FLASH-WATCHDOG]',
        '[CARD-FLASH]',
        '[HAND-ORDER-WATCHDOG]',
        '[HAND-ORDER]',
        '[RENDER-OPP]',
        '[OPP-HAND-DOM]',
        '[SPECTRE-DBG]',
        '[EVEQUE-DBG]',
        '[GAP-CLOSE]'
    ];

    function _check(args) {
        if (window.DEBUG_LOGS) return false;
        if (args.length === 0) return false;
        var first = String(args[0]);
        for (var i = 0; i < SUPPRESS.length; i++) {
            if (first.indexOf(SUPPRESS[i]) !== -1) return true;
        }
        return false;
    }

    console.log = function() {
        if (!_check(arguments)) _origLog.apply(console, arguments);
    };
    console.warn = function() {
        if (!_check(arguments)) _origWarn.apply(console, arguments);
    };

    // Restore originals if needed
    console._origLog = _origLog;
    console._origWarn = _origWarn;
})();
