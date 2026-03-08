// log-filter.js — Suppress diagnostic logs by default
// REACTIVATE: type  window.DEBUG_LOGS = true  in console (instant, no reload)
// Loaded BEFORE all game scripts
(function() {
    var _origLog = console.log;
    var _origWarn = console.warn;

    // All diagnostic prefixes — suppressed by default, DEBUG_LOGS = true to see them
    var _suppressRx = /\[(HP-MUTOBS)\]/;

    function _check(args) {
        if (window.DEBUG_LOGS) return false;
        if (args.length === 0) return false;
        var first = args[0];
        if (typeof first !== 'string') return false;
        return _suppressRx.test(first);
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
