import Foundation
import WebKit

final class ShellSchemeHandler: NSObject, WKURLSchemeHandler {
    private let lock = NSLock()
    private var stopped = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let id = ObjectIdentifier(urlSchemeTask as AnyObject)
        guard let url = urlSchemeTask.request.url else {
            finishText(urlSchemeTask, id: id, status: 400, body: "bad url")
            return
        }
        if url.path == "/__qproxy" {
            proxy(urlSchemeTask, id: id, pageURL: url)
            return
        }
        serveFile(urlSchemeTask, id: id, url: url)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        lock.lock()
        stopped.insert(ObjectIdentifier(urlSchemeTask as AnyObject))
        lock.unlock()
    }

    private func serveFile(_ task: WKURLSchemeTask, id: ObjectIdentifier, url: URL) {
        guard let file = bundledFile(url) else {
            finishText(task, id: id, status: 404, body: "找不到 \(url.path)")
            return
        }
        guard let data = try? Data(contentsOf: file) else {
            finishText(task, id: id, status: 500, body: "读文件失败")
            return
        }
        finish(task, id: id, url: url, status: 200, headers: [
            "Content-Type": mime(file.pathExtension),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        ], body: data)
    }

    private func proxy(_ task: WKURLSchemeTask, id: ObjectIdentifier, pageURL: URL) {
        if task.request.httpMethod?.uppercased() == "OPTIONS" {
            finish(task, id: id, url: pageURL, status: 204, headers: corsHeaders(gbk: false, mime: "text/plain"), body: Data())
            return
        }
        guard
            let raw = URLComponents(url: pageURL, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "u" })?.value,
            let target = URL(string: raw),
            let host = target.host?.lowercased(),
            target.scheme == "https",
            isQuoteHost(host)
        else {
            finishText(task, id: id, status: 400, body: "拒绝的行情地址")
            return
        }
        var request = URLRequest(url: target)
        request.timeoutInterval = 20
        request.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
            forHTTPHeaderField: "User-Agent"
        )
        request.setValue("https://stock.finance.sina.com.cn/", forHTTPHeaderField: "Referer")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            if let error {
                self.finishText(task, id: id, status: 502, body: "行情代理失败: \(error.localizedDescription)")
                return
            }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 502
            var body = data ?? Data()
            let gbk = host.hasSuffix("sinajs.cn")
            if gbk { body = Self.decodeGBK(body) }
            let type = gbk ? "text/plain; charset=utf-8" : "application/json; charset=utf-8"
            self.finish(task, id: id, url: pageURL, status: code, headers: self.corsHeaders(gbk: gbk, mime: type), body: body)
        }.resume()
    }

    private func bundledFile(_ url: URL) -> URL? {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("www", isDirectory: true) else { return nil }
        let path = url.path
        if path.contains("..") { return nil }
        let relative = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let target = root.appendingPathComponent(relative).standardizedFileURL
        let rootPath = root.standardizedFileURL.path
        guard target.path.hasPrefix(rootPath.hasSuffix("/") ? rootPath : rootPath + "/") else { return nil }
        var directory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: target.path, isDirectory: &directory), !directory.boolValue else { return nil }
        return target
    }

    private func isQuoteHost(_ host: String) -> Bool {
        host.hasSuffix("sinajs.cn") || host.hasSuffix("sina.com.cn") || host.hasSuffix("sina.cn")
    }

    private func corsHeaders(gbk: Bool, mime: String) -> [String: String] {
        var headers = [
            "Content-Type": mime,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Expose-Headers": "x-qiheng-charset",
            "Cache-Control": "no-store",
        ]
        if gbk { headers["x-qiheng-charset"] = "utf-8" }
        return headers
    }

    private func finishText(_ task: WKURLSchemeTask, id: ObjectIdentifier, status: Int, body: String) {
        finish(task, id: id, url: task.request.url ?? URL(string: "qiheng://local/")!, status: status, headers: corsHeaders(gbk: true, mime: "text/plain; charset=utf-8"), body: Data(body.utf8))
    }

    private func finish(_ task: WKURLSchemeTask, id: ObjectIdentifier, url: URL, status: Int, headers: [String: String], body: Data) {
        lock.lock()
        let dead = stopped.contains(id)
        if !dead { stopped.insert(id) }
        lock.unlock()
        if dead { return }
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    private static func decodeGBK(_ data: Data) -> Data {
        let encoding = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)))
        guard let text = String(data: data, encoding: encoding) else { return data }
        return Data(text.utf8)
    }

    private func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "png": return "image/png"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "webp": return "image/webp"
        default: return "application/octet-stream"
        }
    }
}
