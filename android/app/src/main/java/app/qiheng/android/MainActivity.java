package app.qiheng.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = APP_ORIGIN + "/www/apk/index.html";
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#12110E"));
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setAllowFileAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new ShellClient(assets));
        setContentView(webView);
        webView.loadUrl(START_URL);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private static final class ShellClient extends WebViewClient {
        private final WebViewAssetLoader assets;

        private ShellClient(WebViewAssetLoader assets) {
            this.assets = assets;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String host = uri.getHost() == null ? "" : uri.getHost();
            if (isQuoteHost(host)) {
                return proxyQuote(request);
            }
            return assets.shouldInterceptRequest(uri);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String host = uri.getHost() == null ? "" : uri.getHost();
            if ("appassets.androidplatform.net".equals(host) || isQuoteHost(host)) {
                return false;
            }
            return true;
        }
    }

    private static boolean isQuoteHost(String host) {
        return host.endsWith("sinajs.cn") || host.endsWith("sina.com.cn") || host.endsWith("sina.cn");
    }

    private static WebResourceResponse proxyQuote(WebResourceRequest request) {
        String method = request.getMethod() == null ? "GET" : request.getMethod();
        if ("OPTIONS".equalsIgnoreCase(method)) {
            return cors(204, "OK", "text/plain", new byte[0], false);
        }
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(request.getUrl().toString()).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(12_000);
            conn.setReadTimeout(20_000);
            conn.setRequestMethod("GET".equalsIgnoreCase(method) ? "GET" : "GET");
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile Safari/537.36");
            conn.setRequestProperty("Referer", "https://stock.finance.sina.com.cn/");
            conn.setRequestProperty("Accept", "*/*");
            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            byte[] body = readAll(stream);
            boolean gbk = request.getUrl().getHost() != null && request.getUrl().getHost().endsWith("sinajs.cn");
            if (gbk) {
                body = new String(body, Charset.forName("GBK")).getBytes(StandardCharsets.UTF_8);
            }
            String mime = gbk ? "text/plain" : "application/json";
            String reason = code >= 400 ? "error" : "OK";
            return cors(code, reason, mime, body, gbk);
        } catch (Exception error) {
            byte[] body = ("行情代理失败: " + error.getMessage()).getBytes(StandardCharsets.UTF_8);
            return cors(502, "bad gateway", "text/plain", body, true);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static WebResourceResponse cors(int code, String reason, String mime, byte[] body, boolean markUtf8) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", APP_ORIGIN);
        headers.put("Access-Control-Allow-Methods", "GET, OPTIONS");
        headers.put("Access-Control-Allow-Headers", "*");
        headers.put("Access-Control-Expose-Headers", "x-qiheng-charset");
        if (markUtf8) headers.put("x-qiheng-charset", "utf-8");
        return new WebResourceResponse(mime, "utf-8", code, reason, headers, new ByteArrayInputStream(body));
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        if (in == null) return new byte[0];
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }
}
