package app.fantrax.redesign;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.Collections;

public class MainActivity extends Activity {
    private static final String HOME = "https://www.fantrax.com/";
    private static final String ORIGIN = "https://www.fantrax.com";
    // Hosts kept inside the app (site + social login); everything else opens in the system browser.
    private static final String[] IN_APP_HOSTS = {
        "fantrax.com", "google.com", "gstatic.com", "apple.com", "facebook.com"
    };

    private WebView webView;
    private String injectedScript;
    private boolean documentStartInjection;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        injectedScript = wrap(ScriptLoader.load(this));
        ScriptLoader.refreshAsync(this);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString().replace("; wv", ""));

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(
                webView, injectedScript, Collections.singleton(ORIGIN));
            documentStartInjection = true;
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isInApp(uri)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                CookieManager.getInstance().flush();
                // Fallback for WebViews without document-start script support.
                if (!documentStartInjection && url != null && url.startsWith(ORIGIN)) {
                    view.evaluateJavascript(injectedScript, null);
                }
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(HOME);
            Updater.checkAsync(this);
        }
    }

    // Runs the userscript once per document, after the DOM is ready (matches @run-at document-end).
    private static String wrap(String userscript) {
        return "(function(){if(window.__fxApp)return;window.__fxApp=true;"
            + "function run(){\n" + userscript + "\n}"
            + "if(document.readyState==='loading')"
            + "document.addEventListener('DOMContentLoaded',run);else run();})();";
    }

    private static boolean isInApp(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (host == null || !"https".equals(scheme)) return false;
        for (String h : IN_APP_HOSTS) {
            if (host.equals(h) || host.endsWith("." + h)) return true;
        }
        return false;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
