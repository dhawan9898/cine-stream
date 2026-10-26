package com.cinehype.stream;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.JsResult;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePlayerPlugin.class);
        super.onCreate(savedInstanceState);

        // Capacitor's default client hands every non-app URL to an external browser
        // intent, which is what turns ad scripts inside the stream iframe into popups.
        // Never launch external intents; keep top-level navigation on the app itself.
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) {
                    return false; // let the embed navigate inside its own iframe
                }
                Uri url = request.getUrl();
                String host = url.getHost();
                boolean isApp = host != null && host.equals(getBridge().getHost());
                return !isApp; // block top-level hijacks to ad/external sites
            }
        });

        // Android back (button or gesture). Screens are in-memory state, so the
        // web layer decides what "back" means (window.__cinestreamBack closes
        // the top-most panel/player/page, or returns a tab to Home). Only when
        // it has nothing left to close - i.e. on Home - is the app sent to the
        // background instead of being closed.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    moveTaskToBack(true);
                    return;
                }
                webView.evaluateJavascript(
                        "(function(){try{return window.__cinestreamBack?window.__cinestreamBack():false}catch(e){return false}})()",
                        value -> {
                            if (!"true".equals(value)) moveTaskToBack(true);
                        });
            }
        });

        // Ad scripts register beforeunload handlers, which the WebView turns into a
        // "Confirm Navigation" dialog. Accept silently; hijack navigations are blocked above.
        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public boolean onJsBeforeUnload(WebView view, String url, String message, JsResult result) {
                result.confirm();
                return true;
            }
        });
    }
}
