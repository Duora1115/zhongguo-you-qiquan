import UIKit
import WebKit

final class ShellViewController: UIViewController, WKNavigationDelegate {
    static let paper = UIColor(red: 18 / 255, green: 17 / 255, blue: 14 / 255, alpha: 1)
    private static let start = "qiheng://local/apk/index.html"
    private let handler = ShellSchemeHandler()
    private var webView: WKWebView?

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.paper

        let config = WKWebViewConfiguration()
        config.userContentController.addUserScript(
            WKUserScript(source: Self.fetchPatch, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        config.setURLSchemeHandler(handler, forURLScheme: "qiheng")
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let web = WKWebView(frame: view.bounds, configuration: config)
        web.navigationDelegate = self
        web.isOpaque = false
        web.backgroundColor = Self.paper
        web.scrollView.backgroundColor = Self.paper
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.allowsBackForwardNavigationGestures = true
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(web)
        webView = web
        if let url = URL(string: Self.start) {
            web.load(URLRequest(url: url))
        }
    }

    private static let fetchPatch = """
    (function () {
      if (window.__QIHENG_FETCH_PATCHED) return;
      window.__QIHENG_FETCH_PATCHED = true;
      var quote = /sinajs\\.cn|sina\\.com\\.cn|sina\\.cn/i;
      var orig = window.fetch.bind(window);
      window.fetch = function (input, init) {
        try {
          var url = typeof input === "string" ? input : (input && input.url);
          if (url && quote.test(url)) {
            return orig("qiheng://local/__qproxy?u=" + encodeURIComponent(url), init);
          }
        } catch (e) {}
        return orig(input, init);
      };
    })();
    """
}
