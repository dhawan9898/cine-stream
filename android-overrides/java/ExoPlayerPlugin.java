package com.cinehype.stream;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ExoPlayerPlugin")
public class ExoPlayerPlugin extends Plugin {

    // Set on every play() call so the (separate) ExoPlayerActivity can notify
    // JS listeners of in-player actions - e.g. the sub/dub toggle, which
    // requires re-resolving the stream through the JS scraper and can't be
    // done natively.
    private static ExoPlayerPlugin activeInstance;

    @PluginMethod
    public void play(PluginCall call) {
        Intent intent = buildPlayIntent(call);
        if (intent == null) {
            call.reject("Must provide a video URL");
            return;
        }
        activeInstance = this;

        // ExoPlayerActivity is singleTask: if it's already open (showing its
        // loading spinner) this is delivered to it via onNewIntent instead
        // of stacking a second player.
        getActivity().startActivity(intent);

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    // The stream for the episode after `afterEpisode`, resolved ahead of
    // time while the app's WebView is still active. The player starts it by
    // itself when Next Episode is pressed (or the countdown ends), so going
    // to the next episode never waits on JavaScript - which may be throttled
    // or not running at all after the WebView has been hidden behind the
    // player for a whole episode.
    @PluginMethod
    public void setNextEpisode(PluginCall call) {
        String afterEpisode = call.getString("afterEpisode");
        String mode = call.getString("mode", "sub");
        Intent intent = buildPlayIntent(call);
        ExoPlayerActivity activity = ExoPlayerActivity.current();
        if (intent == null || afterEpisode == null || activity == null) {
            call.resolve();
            return;
        }
        activeInstance = this;
        activity.runOnUiThread(() -> activity.setPrefetchedNext(afterEpisode, mode, intent));
        call.resolve();
    }

    // Same extras for play() and setNextEpisode(); null when there's no URL.
    private Intent buildPlayIntent(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) return null;
        String title = call.getString("title", "CineStream");
        String episode = call.getString("episode", "1");
        String referer = call.getString("referer", "");
        JSObject headers = call.getObject("headers");
        String seasonPrefix = call.getString("seasonPrefix", "");
        String mode = call.getString("mode", "sub");
        JSArray subtitles = call.getArray("subtitles");
        JSArray qualities = call.getArray("qualities");
        JSArray audios = call.getArray("audios");
        JSArray episodes = call.getArray("episodes");
        boolean isFallback = call.getBoolean("isFallback", false);
        JSObject intro = call.getObject("intro");
        JSObject outro = call.getObject("outro");
        Double startPositionMs = call.getDouble("startPositionMs");
        boolean autoSkipIntro = call.getBoolean("autoSkipIntro", false);
        boolean autoPlayNext = call.getBoolean("autoPlayNext", true);
        boolean hasDub = call.getBoolean("hasDub", true);
        String spriteVtt = call.getString("spriteVtt");
        boolean offline = call.getBoolean("offline", false);

        Intent intent = new Intent(getContext(), ExoPlayerActivity.class);
        intent.putExtra("url", url);
        intent.putExtra("title", title);
        intent.putExtra("episode", episode);
        intent.putExtra("referer", referer);
        intent.putExtra("seasonPrefix", seasonPrefix);
        if (headers != null) intent.putExtra("headers", headers.toString());
        intent.putExtra("mode", mode);
        intent.putExtra("subtitles", subtitles != null ? subtitles.toString() : null);
        intent.putExtra("qualities", qualities != null ? qualities.toString() : null);
        intent.putExtra("audios", audios != null ? audios.toString() : null);
        intent.putExtra("episodes", episodes != null ? episodes.toString() : null);
        intent.putExtra("preferredAudio", call.getString("preferredAudio", ""));
        intent.putExtra("dataSaver", Boolean.TRUE.equals(call.getBoolean("dataSaver", false)));
        intent.putExtra("isFallback", isFallback);
        intent.putExtra("offline", offline);
        intent.putExtra("autoSkipIntro", autoSkipIntro);
        intent.putExtra("autoPlayNext", autoPlayNext);
        intent.putExtra("hasDub", hasDub);
        if (spriteVtt != null && !spriteVtt.isEmpty()) intent.putExtra("spriteVtt", spriteVtt);
        putSkipRange(intent, "intro", intro);
        putSkipRange(intent, "outro", outro);
        if (startPositionMs != null && startPositionMs > 0) {
            intent.putExtra("startPositionMs", Math.round(startPositionMs));
        }
        return intent;
    }

    // Chapter markers from the stream's sources payload, in seconds - passed
    // on as <prefix>StartMs / <prefix>EndMs extras. Missing or empty (0/0)
    // markers are simply omitted.
    private static void putSkipRange(Intent intent, String prefix, JSObject range) {
        if (range == null) return;
        double start = range.optDouble("start", -1);
        double end = range.optDouble("end", -1);
        if (start < 0 || end <= start) return;
        intent.putExtra(prefix + "StartMs", Math.round(start * 1000));
        intent.putExtra(prefix + "EndMs", Math.round(end * 1000));
    }

    // Opens the player straight away in its loading state (title + spinner,
    // no URL yet) so there's no blocking "resolving" screen in the app; the
    // stream arrives later through play().
    @PluginMethod
    public void open(PluginCall call) {
        activeInstance = this;
        Intent intent = new Intent(getContext(), ExoPlayerActivity.class);
        intent.putExtra("title", call.getString("title", "CineStream"));
        intent.putExtra("episode", call.getString("episode", "1"));
        intent.putExtra("seasonPrefix", call.getString("seasonPrefix", ""));
        intent.putExtra("mode", call.getString("mode", "sub"));
        getActivity().startActivity(intent);
        call.resolve();
    }

    private static boolean isMediaUrl(String url) {
        String lower = url.toLowerCase();
        String path = lower.split("\\?")[0];
        if (lower.contains("manifest.webm") || lower.contains("placeholder") || lower.contains("dummy.")
                || lower.contains("sample.") || lower.contains("intro.mp4") || lower.contains("blank.mp4")) {
            return false;
        }
        return path.endsWith(".m3u8") || path.endsWith(".mpd") || path.endsWith(".mp4")
                || path.endsWith(".webm") || path.endsWith(".mkv") || lower.contains(".m3u8");
    }

    private static boolean isManifestUrl(String url) {
        String lower = url.toLowerCase();
        return lower.contains(".m3u8") || lower.split("\\?")[0].endsWith(".mpd");
    }

    // ---- Hidden-WebView stream sniffer -------------------------------------------------
    //
    // Loads an embed page in a hidden WebView and reports the first real media request it
    // makes, so ExoPlayer is only ever given a direct stream URL.
    //
    // WebViews are pooled: building one and starting its JavaScript engine is a real cost,
    // paid once instead of on every lookup. One is built shortly after the app starts, up to
    // SNIFF_POOL_MAX stay alive between lookups, and idle ones are released after a while.
    // A lookup can also be cancelled (another provider already won), which frees its WebView
    // for the next job at once. The timings of each phase go back to JS.

    // Three, so the best two providers can be sniffed side by side from the first moment and a
    // third can be hedged; idle ones are released after a while either way.
    private static final int SNIFF_POOL_MAX = 3;
    private static final long SNIFF_IDLE_RELEASE_MS = 3 * 60 * 1000;
    private static final String SNIFF_UA = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    private static final String AUTOPLAY_JS = "(function(){try{document.querySelectorAll('video').forEach(function(v){v.muted=true;var p=v.play();if(p&&p.catch)p.catch(function(){});});"
            + "['.jw-icon-display','.vjs-big-play-button','.plyr__control--overlaid','.play-button','#play','[aria-label=Play]','button.play'].forEach(function(s){var e=document.querySelector(s);if(e)e.click();});}catch(e){}})();";

    // Injected at document start into EVERY frame (androidx.webkit addDocumentStartJavaScript).
    // Embed players sit two or three cross-origin iframes deep and wait for a tap on Play before
    // they ask for the stream; a script run only in the top page after onPageFinished (which waits
    // for every ad script) never reaches them. This one keeps nudging - mute and play videos,
    // press visible Play controls - from the frame's first moment until a video is playing.
    private static final String NUDGE_JS = "(function(){if(window.__csNudge)return;window.__csNudge=1;"
            + "var sel=['.jw-icon-display','.vjs-big-play-button','.plyr__control--overlaid','.play-button','#play','[aria-label=Play]','button.play',"
            + "'.play','.btn-play','.play-btn','#player-button','.vjs-play-control','[class*=play-button]','[class*=PlayButton]','[id*=play]','.jw-display-icon-container','#pl_but','.poster'];"
            + "var n=0;function tick(){if(++n>60)return;try{var playing=false;document.querySelectorAll('video').forEach(function(v){if(!v.paused&&v.currentTime>0)playing=true;v.muted=true;"
            + "if(v.paused){var p=v.play();if(p&&p.catch)p.catch(function(){});}});"
            + "if(!playing){sel.forEach(function(s){var e=document.querySelector(s);if(e&&e.offsetParent!==null)e.click();});}}catch(e){}"
            + "setTimeout(tick,n<10?150:400);}"
            + "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick);else tick();setTimeout(tick,50);})();";

    // Ad loaders rotate throwaway domains faster than any host list, but their URL shapes do not:
    // Monetag / Propeller style tags (/14/<32 hex>, /20, /3/<hex>?uidm=...), interstitial bundles
    // and trackers. Answered empty, they no longer delay the player or cover it with an overlay.
    private static final java.util.regex.Pattern[] AD_URL_SHAPES = {
            java.util.regex.Pattern.compile("^https?://[^/]+/\\d{1,2}(/[0-9a-f]{32})?(\\?uidm=.*)?$", java.util.regex.Pattern.CASE_INSENSITIVE),
            java.util.regex.Pattern.compile("^https?://[^/]+/\\d{1,2}/[0-9a-f]{32}\\?", java.util.regex.Pattern.CASE_INSENSITIVE),
            java.util.regex.Pattern.compile("/(interstitial|popunder|clickunder)/", java.util.regex.Pattern.CASE_INSENSITIVE),
            java.util.regex.Pattern.compile("(cloudpiko|show-sb\\.com|dtscout|dtscdn|tynt\\.com|crwdcntrl|onaudience|adsrvr|eyeota|mrktmtrcs|33across|cloudflareinsights|google-analytics|googletagmanager)", java.util.regex.Pattern.CASE_INSENSITIVE)
    };
    // Throwaway TLDs the ad loaders use; only for scripts and API calls, never for frames.
    private static final java.util.regex.Pattern AD_TLD = java.util.regex.Pattern.compile("^https?://[^/]+\\.(cfd|cyou|fyi|sbs)(:\\d+)?/", java.util.regex.Pattern.CASE_INSENSITIVE);

    static boolean isAdLike(String url, Map<String, String> headers) {
        if (ExoPlayerActivity.isAdRequest(url)) return true;
        for (java.util.regex.Pattern p : AD_URL_SHAPES) if (p.matcher(url).find()) return true;
        String accept = headers != null ? headers.get("Accept") : null;
        boolean frame = accept != null && accept.contains("text/html");
        return !frame && AD_TLD.matcher(url).find();
    }

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    // Main thread only.
    private static final java.util.ArrayDeque<SniffView> idleSniffers = new java.util.ArrayDeque<>();
    private static final Map<String, SniffJob> sniffJobs = new java.util.concurrent.ConcurrentHashMap<>();
    private static long sniffLastUsed = 0;
    // Main thread only. Background (speculative) sniffs run one at a time and only while no
    // foreground sniff does; a foreground sniff cancels any background one and takes its WebView.
    private static int foregroundSniffs = 0;
    private static int backgroundSniffs = 0;

    private static final class SniffView {
        final WebView web;
        // True when NUDGE_JS runs in every frame from document start.
        boolean everyFrame;
        SniffJob job; // main thread only
        SniffView(WebView web) { this.web = web; }
    }

    @Override
    public void load() {
        // Have one WebView ready before the first lookup, without competing with app start-up.
        MAIN.postDelayed(() -> {
            try {
                if (idleSniffers.isEmpty()) idleSniffers.add(newSniffView());
                scheduleSniffTrim();
            } catch (Exception ignored) {}
        }, 1500);
        // A second one a little later: the first lookup sniffs two providers at once.
        MAIN.postDelayed(() -> {
            try {
                if (idleSniffers.size() < 2 && sniffJobs.isEmpty()) idleSniffers.add(newSniffView());
            } catch (Exception ignored) {}
        }, 5000);
    }

    // Main thread only.
    private SniffView newSniffView() {
        WebView web = new WebView(getContext());
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setMediaPlaybackRequiresUserGesture(false);
        // Only the page's scripts and API calls matter for finding the stream: no
        // pictures, so the embed page is ready sooner and uses less data.
        ws.setLoadsImagesAutomatically(false);
        ws.setBlockNetworkImage(true);
        ws.setSupportMultipleWindows(false);
        ws.setJavaScriptCanOpenWindowsAutomatically(false);
        ws.setUserAgentString(SNIFF_UA);
        final SniffView sv = new SniffView(web);
        try {
            if (androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.DOCUMENT_START_SCRIPT)) {
                androidx.webkit.WebViewCompat.addDocumentStartJavaScript(web, NUDGE_JS, java.util.Collections.singleton("*"));
                sv.everyFrame = true;
            }
        } catch (Throwable ignored) {
            // Old WebView: the top-page script after onPageFinished below still runs.
        }
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                SniffJob job = sv.job;
                if (job != null && request != null && request.getUrl() != null) {
                    WebResourceResponse answer = job.intercept(request);
                    if (answer != null) return answer;
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                SniffJob job = sv.job;
                return job != null && job.blocksNavigation(request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                SniffJob job = sv.job;
                if (job != null && url != null && !"about:blank".equals(url)) job.pageFinished(view);
            }
        });
        return sv;
    }

    // Main thread only. Returns a ready WebView and whether it came from the pool.
    private SniffView acquireSniffView(boolean[] pooled) {
        SniffView sv = idleSniffers.poll();
        pooled[0] = sv != null;
        return sv != null ? sv : newSniffView();
    }

    // Main thread only. Wipes the page and keeps the WebView for the next job.
    private void releaseSniffView(SniffView sv) {
        if (sv == null) return;
        sniffLastUsed = System.currentTimeMillis();
        sv.job = null;
        try {
            sv.web.stopLoading();
            sv.web.loadUrl("about:blank");
            sv.web.clearHistory();
        } catch (Exception e) {
            destroySniffer(sv.web);
            return;
        }
        if (idleSniffers.size() < SNIFF_POOL_MAX) {
            idleSniffers.add(sv);
            scheduleSniffTrim();
        } else {
            destroySniffer(sv.web);
        }
    }

    // Lets go of the idle WebViews after a quiet spell (memory).
    private void scheduleSniffTrim() {
        MAIN.postDelayed(() -> {
            if (System.currentTimeMillis() - sniffLastUsed < SNIFF_IDLE_RELEASE_MS && sniffLastUsed != 0) return;
            SniffView sv;
            while ((sv = idleSniffers.poll()) != null) destroySniffer(sv.web);
        }, SNIFF_IDLE_RELEASE_MS + 1000);
    }

    // Runs now when already on the main thread (so a cancelled job's WebView is back in the
    // pool before the job that cancelled it asks for one), otherwise posts.
    private static void runOnMain(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) r.run(); else MAIN.post(r);
    }

    private final class SniffJob {
        final String id;
        final String pageUrl;
        final String referer;
        final int timeoutMs;
        // Not final: a background (speculative) sniff is promoted when Play asks for the same page.
        boolean background;
        // Everyone waiting for this sniff, by call id: the one who started it, and anyone who joined
        // (Play while the same page was being sniffed in the background). Main thread only.
        final Map<String, PluginCall> callers = new java.util.LinkedHashMap<>();
        boolean counted;
        final AtomicBoolean done = new AtomicBoolean(false);
        final long requestedAt = System.currentTimeMillis();
        SniffView sv;
        boolean pooled;
        long loadStartedAt;
        long pageFinishedAt;
        long mediaAt;
        String mp4Candidate;
        Map<String, String> mp4Headers;
        final Runnable onTimeout = () -> { if (!done.get()) finishWithBestGuess(); };

        SniffJob(String id, String pageUrl, String referer, int timeoutMs, boolean background, PluginCall call) {
            this.id = id;
            this.pageUrl = pageUrl;
            this.referer = referer;
            this.timeoutMs = timeoutMs;
            this.background = background;
            this.callers.put(id, call);
        }

        void start() {
            getActivity().runOnUiThread(() -> {
                try {
                    if (background) {
                        // Only when nothing else wants a WebView, and one is already warm.
                        if (foregroundSniffs > 0 || backgroundSniffs > 0 || idleSniffers.isEmpty()) { rejectBusy(); return; }
                        backgroundSniffs++;
                    } else {
                        foregroundSniffs++;
                        // Background sniffs only give way when their WebView is actually needed.
                        if (idleSniffers.isEmpty()) {
                            for (SniffJob other : new java.util.ArrayList<>(sniffJobs.values())) {
                                if (other.background) other.cancel();
                            }
                        }
                    }
                    counted = true;
                    boolean[] pooledFlag = new boolean[1];
                    sv = acquireSniffView(pooledFlag);
                    pooled = pooledFlag[0];
                    if (done.get()) { releaseSniffView(sv); return; } // cancelled while waiting
                    sv.job = this;
                    Map<String, String> headers = new HashMap<>();
                    if (!referer.isEmpty()) headers.put("Referer", referer);
                    loadStartedAt = System.currentTimeMillis();
                    sv.web.loadUrl(pageUrl, headers);
                    MAIN.postDelayed(onTimeout, timeoutMs);
                } catch (Exception e) {
                    finishWithBestGuess();
                }
            });
        }

        // Called on the WebView's network thread for every request the page makes.
        WebResourceResponse intercept(WebResourceRequest request) {
            if (done.get()) return null;
            String req = request.getUrl().toString();
            Map<String, String> headers = request.getRequestHeaders();
            boolean adLike = isAdLike(req, headers);
            // A stream manifest is never treated as an ad (the URL rules only target loaders).
            if (isMediaUrl(req) && isManifestUrl(req) && !req.equalsIgnoreCase(pageUrl) && !ExoPlayerActivity.isAdRequest(req)) {
                succeed(req, headers);
                return null;
            }
            // Ad networks and page furniture (fonts, stylesheets, images) are answered empty
            // without touching the network: they slow the embed down and never carry the stream.
            if (adLike || isPageFurniture(req)) {
                return new WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
            }
            // A plain video file is only a fallback, and never an ad's video (interstitials play an
            // .mp4 seconds before the real player asks for its stream).
            if (isMediaUrl(req) && !req.equalsIgnoreCase(pageUrl) && mp4Candidate == null) {
                mp4Candidate = req;
                mp4Headers = headers;
                MAIN.postDelayed(() -> { if (!done.get()) finishWithBestGuess(); }, 2500);
            }
            return null;
        }

        boolean blocksNavigation(WebResourceRequest request) {
            // Keep the top frame on the embed; block ad redirects. A plain server redirect
            // within the same site (a provider that moved host, e.g. http -> https, www ->
            // bare) is part of loading the embed, not a hijack.
            if (request == null || !request.isForMainFrame() || request.getUrl() == null) return false;
            String target = request.getUrl().toString();
            if (target.equalsIgnoreCase(pageUrl)) return false;
            return !(request.isRedirect() && sameSite(target, pageUrl));
        }

        void pageFinished(WebView view) {
            if (pageFinishedAt == 0) pageFinishedAt = System.currentTimeMillis();
            // With the every-frame script the player has long been nudged; this is the fallback.
            if (sv != null && sv.everyFrame) return;
            // Start playback as early as the page allows: many players only ask for the
            // stream once they play, and again later once their own scripts have settled.
            for (int delay : new int[]{150, 1000, 2500, 5000, 8000}) {
                MAIN.postDelayed(() -> { if (!done.get() && sv != null && sv.job == this) view.evaluateJavascript(AUTOPLAY_JS, null); }, delay);
            }
        }

        void finishWithBestGuess() {
            if (mp4Candidate != null) { succeed(mp4Candidate, mp4Headers); return; }
            complete(false, null, null, false);
        }

        void succeed(String media, Map<String, String> reqHeaders) {
            if (mediaAt == 0) mediaAt = System.currentTimeMillis();
            complete(true, media, reqHeaders, false);
        }

        void cancel() {
            if (done.get()) return;
            runOnMain(() -> complete(false, null, null, true));
        }

        /**
         * One caller no longer needs the stream (another provider won for it). The sniff only stops
         * when nobody else is waiting for it.
         */
        void cancelFor(String callId) {
            if (done.get()) return;
            runOnMain(() -> {
                if (done.get()) return;
                PluginCall leaving = callers.remove(callId);
                sniffJobs.remove(callId);
                if (callers.isEmpty()) {
                    if (leaving != null) callers.put(callId, leaving); // so complete() answers it
                    complete(false, null, null, true);
                } else if (leaving != null) {
                    JSObject ret = new JSObject();
                    ret.put("found", false);
                    ret.put("cancelled", true);
                    leaving.resolve(ret);
                }
            });
        }

        /** Play asked for the page this background sniff is already loading: continue it in the foreground. */
        void promote(String callId, PluginCall waiting) {
            callers.put(callId, waiting);
            sniffJobs.put(callId, this);
            if (background && counted) {
                backgroundSniffs--;
                foregroundSniffs++;
            }
            background = false;
            // The foreground gets its full time from now.
            MAIN.removeCallbacks(onTimeout);
            MAIN.postDelayed(onTimeout, timeoutMs);
        }

        private void rejectBusy() {
            if (!done.compareAndSet(false, true)) return;
            sniffJobs.remove(id);
            JSObject ret = new JSObject();
            ret.put("found", false);
            ret.put("busy", true);
            for (PluginCall c : callers.values()) c.resolve(ret);
            callers.clear();
        }

        private void complete(boolean found, String media, Map<String, String> reqHeaders, boolean cancelled) {
            if (!done.compareAndSet(false, true)) return;
            runOnMain(() -> {
                MAIN.removeCallbacks(onTimeout);
                for (String callId : callers.keySet()) sniffJobs.remove(callId);
                sniffJobs.remove(id);
                if (counted) {
                    counted = false;
                    if (background) backgroundSniffs--; else foregroundSniffs--;
                }
                releaseSniffView(sv);
                for (PluginCall c : callers.values()) c.resolve(buildResult(found, media, reqHeaders, cancelled));
                callers.clear();
            });
        }

        private JSObject buildResult(boolean found, String media, Map<String, String> reqHeaders, boolean cancelled) {
                JSObject ret = new JSObject();
                ret.put("found", found);
                ret.put("cancelled", cancelled);
                if (found) {
                    ret.put("url", media);
                    String ref = reqHeaders != null ? reqHeaders.get("Referer") : null;
                    ret.put("referer", ref != null ? ref : referer);
                    JSObject h = new JSObject();
                    if (reqHeaders != null) {
                        for (String k : new String[]{"Referer", "Origin", "User-Agent"}) {
                            String v = reqHeaders.get(k);
                            if (v != null) h.put(k, v);
                        }
                    }
                    ret.put("headers", h);
                }
                // Where the time went: getting a WebView, the page loading, the stream request.
                JSObject timing = new JSObject();
                long now = System.currentTimeMillis();
                timing.put("pooled", pooled);
                timing.put("acquireMs", loadStartedAt > 0 ? loadStartedAt - requestedAt : now - requestedAt);
                timing.put("pageMs", pageFinishedAt > 0 && loadStartedAt > 0 ? pageFinishedAt - loadStartedAt : -1);
                timing.put("streamMs", mediaAt > 0 && loadStartedAt > 0 ? mediaAt - loadStartedAt : -1);
                timing.put("totalMs", now - requestedAt);
                ret.put("timing", timing);
                return ret;
        }
    }

    @PluginMethod
    public void sniffStream(PluginCall call) {
        final String pageUrl = call.getString("url");
        final String referer = call.getString("referer", "");
        final int timeoutMs = call.getInt("timeoutMs", 15000);
        if (pageUrl == null || pageUrl.isEmpty()) {
            call.reject("Must provide a url");
            return;
        }
        final String id = call.getString("id", java.util.UUID.randomUUID().toString());
        final boolean background = Boolean.TRUE.equals(call.getBoolean("background", false));
        if (!background) {
            // Tapping Play while the same page is being sniffed speculatively: join that sniff
            // (it may be seconds from done) instead of cancelling it and starting over.
            runOnMain(() -> {
                for (SniffJob running : sniffJobs.values()) {
                    if (running.background && !running.done.get() && running.pageUrl.equals(pageUrl)) {
                        running.promote(id, call);
                        return;
                    }
                }
                SniffJob job = new SniffJob(id, pageUrl, referer, timeoutMs, false, call);
                sniffJobs.put(id, job);
                job.start();
            });
            return;
        }
        SniffJob job = new SniffJob(id, pageUrl, referer, timeoutMs, background, call);
        sniffJobs.put(id, job);
        job.start();
    }

    // Another provider already gave a stream: stop this lookup and free its WebView.
    @PluginMethod
    public void cancelSniff(PluginCall call) {
        String id = call.getString("id");
        SniffJob job = id != null ? sniffJobs.get(id) : null;
        if (job != null) job.cancelFor(id);
        call.resolve();
    }

    private static boolean isPageFurniture(String url) {
        String path = url.toLowerCase().split("[?#]")[0];
        return path.endsWith(".css") || path.endsWith(".woff") || path.endsWith(".woff2") || path.endsWith(".ttf")
                || path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".jpeg") || path.endsWith(".gif")
                || path.endsWith(".webp") || path.endsWith(".svg") || path.endsWith(".ico");
    }

    // Same registrable site: the last two host labels match (vidsrc.to -> www.vidsrc.to).
    // A provider that moved to a sibling domain (autoembed.co -> .me) is handled by
    // updating its URL in the extractor, not by trusting any redirect.
    private static boolean sameSite(String a, String b) {
        try {
            String ha = Uri.parse(a).getHost();
            String hb = Uri.parse(b).getHost();
            if (ha == null || hb == null) return false;
            return siteOf(ha).equalsIgnoreCase(siteOf(hb));
        } catch (Exception e) {
            return false;
        }
    }

    private static String siteOf(String host) {
        String[] parts = host.split("\\.");
        if (parts.length <= 2) return host;
        return parts[parts.length - 2] + "." + parts[parts.length - 1];
    }

    private static void destroySniffer(WebView web) {
        if (web == null) return;
        try {
            web.stopLoading();
            web.loadUrl("about:blank");
            web.destroy();
        } catch (Exception ignored) {}
    }

    // Stream resolution failed - show it inside the open player.
    @PluginMethod
    public void fail(PluginCall call) {
        String message = call.getString("message", "Couldn't load this episode.");
        ExoPlayerActivity activity = ExoPlayerActivity.current();
        if (activity == null) {
            call.reject("Player is not open");
            return;
        }
        activity.runOnUiThread(() -> activity.showLoadFailure(message));
        call.resolve();
    }

    static void notifyPlayerClosed() {
        if (activeInstance == null) return;
        activeInstance.notifyListeners("playerClosed", new JSObject());
    }

    // The stream failed with an HTTP error (e.g. 404). JS resolves the same
    // episode again - what closing and reopening it does - and play()s it
    // at positionMs.
    static boolean notifyReloadRequested(String title, String episode, String mode, long positionMs) {
        if (activeInstance == null) return false;
        JSObject data = new JSObject();
        data.put("title", title);
        data.put("episode", episode);
        data.put("mode", mode);
        data.put("positionMs", positionMs);
        activeInstance.notifyListeners("reloadRequested", data);
        return true;
    }

    // The player started the prefetched next episode on its own; JS records
    // it as the playing episode (for watch history) and prefetches the one
    // after it.
    static void notifyNextEpisodeStarted(String title, String episode, String mode, String url) {
        if (activeInstance == null) return;
        JSObject data = new JSObject();
        data.put("title", title);
        data.put("episode", episode);
        data.put("mode", mode);
        data.put("url", url);
        activeInstance.notifyListeners("nextEpisodeStarted", data);
    }

    static void notifyModeSwitchRequested(String title, String episode, String newMode, long positionMs) {
        if (activeInstance == null) return;
        JSObject data = new JSObject();
        data.put("positionMs", positionMs);
        data.put("title", title);
        data.put("episode", episode);
        data.put("mode", newMode);
        activeInstance.notifyListeners("modeSwitchRequested", data);
    }

    static void notifyNextEpisodeRequested(String title, String episode) {
        if (activeInstance == null) return;
        JSObject data = new JSObject();
        data.put("title", title);
        data.put("episode", episode);
        activeInstance.notifyListeners("nextEpisodeRequested", data);
    }

    static void notifyEpisodeSelected(String title, String episode, String selectedNumber) {
        if (activeInstance == null) return;
        JSObject data = new JSObject();
        data.put("title", title);
        data.put("episode", episode);
        data.put("selectedNumber", selectedNumber);
        activeInstance.notifyListeners("episodeSelected", data);
    }

    // The native player is the only place playback position actually lives -
    // JS (and its watch-history storage) only finds out by being told,
    // periodically, the same way the other in-player actions are reported.
    static void notifyProgressUpdate(String title, String episode, String mode, long positionMs, long durationMs) {
        if (activeInstance == null) return;
        JSObject data = new JSObject();
        data.put("title", title);
        data.put("episode", episode);
        data.put("mode", mode);
        data.put("positionMs", positionMs);
        data.put("durationMs", durationMs);
        activeInstance.notifyListeners("progressUpdate", data);
    }
}
