// Injected into the page before any script runs. It recreates the `window.Android` object that the
// original Kotlin MainActivity provided, but every call is asynchronous (WKWebView has no sync bridge).
// main.js was patched to `await` the results.
enum Shim {
    static let js = #"""
    (function () {
      var call = function (method) {
        var args = Array.prototype.slice.call(arguments, 1);
        return window.webkit.messageHandlers.native.postMessage({ method: method, args: args });
      };
      var withId = function (id, p) {
        p.then(function (r) { if (window.__nativeCb) window.__nativeCb(id, r === undefined ? {} : r); })
         .catch(function (e) { if (window.__nativeCb) window.__nativeCb(id, { error: String(e) }); });
      };
      window.Android = {
        canAuthenticate: function () { return call('canAuthenticate'); },
        authenticate:    function (id) { withId(id, call('authenticate')); },
        setLocked:       function () { return call('setLocked'); },
        dbInit:          function (schema) { return call('dbInit', schema); },
        dbQuery:         function (sql, params) { return call('dbQuery', sql, params); },
        dbRun:           function (sql, params) { return call('dbRun', sql, params); },
        dbBatch:         function (set) { return call('dbBatch', set); },
        pickContact:     function (id) { withId(id, call('pickContact')); },
        voiceSearch:     function (id) { withId(id, call('voiceSearch')); },
        shareFile:       function (name, text, title, id) { withId(id, call('shareFile', name, text, title)); },
        printHtml:       function (html, job) { call('printHtml', html, job); },
        openUrl:         function (url) { return call('openUrl', url); }
      };
    })();
    """#
}
