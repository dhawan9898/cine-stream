package com.cinehype.stream;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    @PluginMethod
    public void openPlayer(PluginCall call) {
        String videoUrl = call.getString("videoUrl");
        String title = call.getString("title", "CineStream Native");
        JSObject headers = call.getObject("headers");

        if (videoUrl == null || videoUrl.isEmpty()) {
            call.reject("Must supply a valid videoUrl");
            return;
        }

        String headersJson = headers != null ? headers.toString() : "{}";

        try {
            NativePlayerActivity.start(getContext(), videoUrl, title, headersJson);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open native player: " + e.getMessage(), e);
        }
    }
}
