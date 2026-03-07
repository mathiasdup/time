// log-filter.js — Only suppress truly spammy noise (same value repeated 50x)
// Set window.DEBUG_LOGS = true to disable filtering entirely
// Loaded BEFORE all game scripts
(function() {
    var _origLog = console.log;
    var _origWarn = console.warn;

    // Only suppress the worst offender: HP-MUTOBS fires on every render
    // even when the value hasn't changed (hero-me changed to: 20 x50)
    var SUPPRESS = [
        '[HP-MUTOBS]'
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
