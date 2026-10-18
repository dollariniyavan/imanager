import WebKit

/// Serves the bundled `www` folder at app://localhost/... so ES modules (<script type="module">),
/// fetch() and localStorage work. (file:// URLs block module scripts in WKWebView.)
final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    private let root: String = {
        let url = Bundle.main.url(forResource: "www", withExtension: nil) ?? Bundle.main.bundleURL
        return url.standardizedFileURL.path
    }()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = URL(fileURLWithPath: root + path).standardizedFileURL
        guard file.path.hasPrefix(root + "/"), let data = try? Data(contentsOf: file) else {
            let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1",
                                    headerFields: ["Content-Type": "text/plain"])!
            task.didReceive(r); task.didReceive(Data("Not found".utf8)); task.didFinish()
            return
        }
        let headers = ["Content-Type": mime(file.pathExtension),
                       "Content-Length": String(data.count),
                       "Access-Control-Allow-Origin": "*",
                       "Cache-Control": "no-cache"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
