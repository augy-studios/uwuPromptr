package org.uwuapps.cue;

import android.content.Context;
import android.os.SystemClock;
import androidx.annotation.NonNull;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The Wear OS watch app's link to the page (android/native/wear/), over the Wearable Data
 * Layer's messages.
 *
 * The watch speaks the web remote's own messages ({ type: "hello" } and
 * { type: "command", ... }), and they go to the page as they are; the page (js/watch.js)
 * decides what to do with them, and sends back a small summary of the prompter's state.
 * Nothing here reads either.
 *
 * Only while the app is open: the page is what answers. A watch that hears nothing says to
 * open uwuPromptr on the phone, and can open it from there (uwu://cue/watch).
 */
final class WatchLink implements MessageClient.OnMessageReceivedListener {

    interface Listener {
        void onMessage(String data);
    }

    // Keep in step with wear/.../Link.java.
    private static final String FROM_WATCH = "/cue/remote";
    private static final String TO_WATCH = "/cue/state";
    /** Bigger than anything the watch or the page sends. */
    static final int MAX_BYTES = 4096;
    private static final long NODES_FOR_MS = 30_000;

    private final Context context;
    private final Listener listener;
    private List<String> nodes = new ArrayList<>();
    private long nodesAt = -NODES_FOR_MS;
    private boolean looking;

    WatchLink(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    void start() {
        try {
            Wearable.getMessageClient(context).addListener(this);
        } catch (RuntimeException ignored) {
            // No Wear OS on this phone: no watch to hear from.
        }
    }

    void stop() {
        try {
            Wearable.getMessageClient(context).removeListener(this);
        } catch (RuntimeException ignored) {
            // Never added.
        }
    }

    @Override
    public void onMessageReceived(@NonNull MessageEvent event) {
        byte[] data = event.getData();
        if (!FROM_WATCH.equals(event.getPath()) || data == null || data.length > MAX_BYTES) return;
        // The watch that spoke is the one to answer, whenever the list was made.
        if (!nodes.contains(event.getSourceNodeId())) nodesAt = -NODES_FOR_MS;
        listener.onMessage(new String(data, StandardCharsets.UTF_8));
    }

    /** To every connected watch. The page only sends while one is listening. */
    void send(String message) {
        byte[] bytes = message.getBytes(StandardCharsets.UTF_8);
        if (SystemClock.elapsedRealtime() - nodesAt < NODES_FOR_MS) {
            deliver(nodes, bytes);
            return;
        }
        if (looking) return;
        looking = true;
        try {
            Wearable.getNodeClient(context).getConnectedNodes()
                .addOnSuccessListener((found) -> {
                    List<String> ids = new ArrayList<>();
                    for (Node node : found) ids.add(node.getId());
                    nodes = ids;
                    nodesAt = SystemClock.elapsedRealtime();
                    looking = false;
                    deliver(ids, bytes);
                })
                .addOnFailureListener((error) -> looking = false);
        } catch (RuntimeException e) {
            looking = false;
        }
    }

    private void deliver(List<String> ids, byte[] bytes) {
        MessageClient messages = Wearable.getMessageClient(context);
        for (String id : ids) {
            messages.sendMessage(id, TO_WATCH, bytes).addOnFailureListener((error) -> nodesAt = -NODES_FOR_MS);
        }
    }
}
