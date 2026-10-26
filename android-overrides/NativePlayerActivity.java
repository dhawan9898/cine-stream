package com.cinehype.stream;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

public class NativePlayerActivity extends AppCompatActivity {

    public static final String EXTRA_VIDEO_URL = "extra_video_url";
    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_HEADERS_JSON = "extra_headers_json";

    private ExoPlayer player;
    private PlayerView playerView;

    public static void start(Context context, String videoUrl, String title, String headersJson) {
        Intent intent = new Intent(context, NativePlayerActivity.class);
        intent.putExtra(EXTRA_VIDEO_URL, videoUrl);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_HEADERS_JSON, headersJson);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen immersive mode
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        setContentView(R.layout.activity_native_player);

        playerView = findViewById(R.id.player_view);
        TextView titleView = findViewById(R.id.player_title);

        String videoUrl = getIntent().getStringExtra(EXTRA_VIDEO_URL);
        String title = getIntent().getStringExtra(EXTRA_TITLE);
        String headersJson = getIntent().getStringExtra(EXTRA_HEADERS_JSON);

        if (title != null && titleView != null) {
            titleView.setText(title);
        }

        findViewById(R.id.btn_close).setOnClickListener(v -> finish());

        if (videoUrl == null || videoUrl.isEmpty()) {
            Toast.makeText(this, "Error: Invalid video stream URL", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        initializePlayer(videoUrl, headersJson);
    }

    private void initializePlayer(String videoUrl, String headersJson) {
        Map<String, String> headersMap = new HashMap<>();
        if (headersJson != null && !headersJson.isEmpty()) {
            try {
                JSONObject json = new JSONObject(headersJson);
                Iterator<String> keys = json.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    headersMap.put(key, json.getString(key));
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        DefaultHttpDataSource.Factory httpDataSourceFactory = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15_000)
                .setReadTimeoutMs(15_000);

        String userAgent = headersMap.remove("User-Agent");
        if (userAgent != null) {
            httpDataSourceFactory.setUserAgent(userAgent);
        }

        if (!headersMap.isEmpty()) {
            httpDataSourceFactory.setDefaultRequestProperties(headersMap);
        }

        DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(this)
                .setDataSourceFactory(httpDataSourceFactory);

        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(mediaSourceFactory)
                .build();

        playerView.setPlayer(player);

        MediaItem.Builder mediaItemBuilder = new MediaItem.Builder().setUri(Uri.parse(videoUrl));
        if (videoUrl.contains(".m3u8")) {
            mediaItemBuilder.setMimeType(MimeTypes.APPLICATION_M3U8);
        } else if (videoUrl.contains(".mpd")) {
            mediaItemBuilder.setMimeType(MimeTypes.APPLICATION_MPD);
        } else if (videoUrl.contains(".mp4")) {
            mediaItemBuilder.setMimeType(MimeTypes.VIDEO_MP4);
        }

        player.setMediaItem(mediaItemBuilder.build());
        player.prepare();
        player.setPlayWhenReady(true);
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null) {
            player.pause();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (player != null) {
            player.release();
            player = null;
        }
    }
}
