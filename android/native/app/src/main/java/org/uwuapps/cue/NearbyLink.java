package org.uwuapps.cue;

import android.content.Context;
import androidx.annotation.NonNull;
import com.getcapacitor.JSObject;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The offline remote: two phones linked directly over Bluetooth and Wi-Fi by
 * Google's Nearby Connections, with no router and no mobile data.
 *
 * It carries the same JSON messages the web remote sends over WebRTC, as
 * strings; the page does all the talking. One remote at a time, the same rule
 * the web remote has.
 *
 * The prompter advertises under a name made from a hash of its remote id, so
 * the remote can find the right prompter among several without the id itself
 * going out over the air. The id is then checked over the encrypted
 * connection, by the page (js/nearby.js).
 */
final class NearbyLink {

    interface Listener {
        void onEvent(JSObject event);
    }

    private static final String SERVICE_ID = "org.uwuapps.cue.remote";
    private static final Strategy STRATEGY = Strategy.P2P_POINT_TO_POINT;

    // A message bigger than one bytes payload (a long script) goes out in
    // pieces, each led by one byte: MORE for every piece but the last.
    private static final byte MORE = 1;
    private static final byte LAST = 0;
    private static final int PIECE = ConnectionsClient.MAX_BYTES_DATA_SIZE - 1;

    private final ConnectionsClient client;
    private final Listener listener;

    private String name;
    private boolean advertising;
    private boolean discovering;
    private String endpoint;
    private final ByteArrayOutputStream incoming = new ByteArrayOutputStream();
    private boolean stopped;

    NearbyLink(Context context, Listener listener) {
        this.client = Nearby.getConnectionsClient(context);
        this.listener = listener;
    }

    /* ---- the prompter end ---- */

    void advertise(String name) {
        this.name = name;
        this.advertising = true;
        startAdvertising();
    }

    private void startAdvertising() {
        if (stopped) return;
        AdvertisingOptions options = new AdvertisingOptions.Builder().setStrategy(STRATEGY).build();
        client.startAdvertising(name, SERVICE_ID, lifecycle, options)
            .addOnSuccessListener((unused) -> emit("waiting"))
            .addOnFailureListener((error) -> {
                // Already advertising is where a restart after a drop lands.
                if (code(error) == ConnectionsStatusCodes.STATUS_ALREADY_ADVERTISING) emit("waiting");
                else fail(error);
            });
    }

    /* ---- the remote end ---- */

    void discover(String name) {
        this.name = name;
        this.discovering = true;
        DiscoveryOptions options = new DiscoveryOptions.Builder().setStrategy(STRATEGY).build();
        client.startDiscovery(SERVICE_ID, discovery, options)
            .addOnSuccessListener((unused) -> emit("searching"))
            .addOnFailureListener((error) -> {
                if (code(error) == ConnectionsStatusCodes.STATUS_ALREADY_DISCOVERING) emit("searching");
                else fail(error);
            });
    }

    private final EndpointDiscoveryCallback discovery = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(@NonNull String id, @NonNull DiscoveredEndpointInfo info) {
            if (stopped || endpoint != null || !name.equals(info.getEndpointName())) return;
            client.stopDiscovery();
            emit("connecting");
            client.requestConnection(name, id, lifecycle).addOnFailureListener((error) -> {
                // Lost the race, or the radio hiccuped: look again.
                if (!stopped && endpoint == null) discover(name);
                fail(error);
            });
        }

        @Override
        public void onEndpointLost(@NonNull String id) {}
    };

    /* ---- both ends ---- */

    private final ConnectionLifecycleCallback lifecycle = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(@NonNull String id, @NonNull ConnectionInfo info) {
            // One at a time. The prompter's page checks the remote id as the
            // first message and drops a remote that gets it wrong.
            if (stopped || endpoint != null) {
                client.rejectConnection(id);
                return;
            }
            client.acceptConnection(id, payloads);
        }

        @Override
        public void onConnectionResult(@NonNull String id, @NonNull ConnectionResolution result) {
            if (result.getStatus().getStatusCode() == ConnectionsStatusCodes.STATUS_OK) {
                endpoint = id;
                incoming.reset();
                emit("connected");
            } else if (discovering && !stopped) {
                discover(name);
            }
        }

        @Override
        public void onDisconnected(@NonNull String id) {
            if (!id.equals(endpoint)) return;
            endpoint = null;
            incoming.reset();
            emit("dropped");
            // The prompter stays findable, so the remote can come back.
            if (advertising) startAdvertising();
        }
    };

    private final PayloadCallback payloads = new PayloadCallback() {
        @Override
        public void onPayloadReceived(@NonNull String id, @NonNull Payload payload) {
            if (!id.equals(endpoint) || payload.getType() != Payload.Type.BYTES) return;
            byte[] bytes = payload.asBytes();
            if (bytes == null || bytes.length == 0) return;

            incoming.write(bytes, 1, bytes.length - 1);
            if (bytes[0] == MORE) return;

            String message = new String(incoming.toByteArray(), StandardCharsets.UTF_8);
            incoming.reset();
            JSObject event = event("message");
            event.put("data", message);
            listener.onEvent(event);
        }

        @Override
        public void onPayloadTransferUpdate(@NonNull String id, @NonNull PayloadTransferUpdate update) {}
    };

    void send(String message) {
        String to = endpoint;
        if (to == null) return;
        byte[] bytes = message.getBytes(StandardCharsets.UTF_8);
        int offset = 0;
        do {
            int length = Math.min(PIECE, bytes.length - offset);
            byte[] piece = new byte[length + 1];
            piece[0] = offset + length < bytes.length ? MORE : LAST;
            System.arraycopy(bytes, offset, piece, 1, length);
            client.sendPayload(to, Payload.fromBytes(piece));
            offset += length;
        } while (offset < bytes.length);
    }

    void disconnect() {
        String id = endpoint;
        if (id == null) return;
        endpoint = null;
        client.disconnectFromEndpoint(id);
        emit("dropped");
        if (advertising) startAdvertising();
    }

    void stop() {
        stopped = true;
        endpoint = null;
        client.stopAdvertising();
        client.stopDiscovery();
        client.stopAllEndpoints();
    }

    /* ---- events to the page ---- */

    private JSObject event(String type) {
        JSObject event = new JSObject();
        event.put("event", type);
        return event;
    }

    private void emit(String status) {
        if (stopped) return;
        JSObject event = event("status");
        event.put("status", status);
        listener.onEvent(event);
    }

    private void fail(Exception error) {
        if (stopped) return;
        JSObject event = event("status");
        event.put("status", "error");
        event.put("code", code(error));
        event.put("message", String.valueOf(error.getMessage()));
        listener.onEvent(event);
    }

    private static int code(Exception error) {
        return error instanceof ApiException ? ((ApiException) error).getStatusCode() : -1;
    }
}
