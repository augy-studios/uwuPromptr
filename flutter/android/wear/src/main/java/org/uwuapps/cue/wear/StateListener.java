/*
 * What the prompter is doing, as the phone's app sends it (WatchLink.java on the phone, fed by
 * the page's js/watch.js). Wear OS starts this for each message, with the app open or not.
 * Only the same app on the phone, signed with the same key, can reach it.
 */
package org.uwuapps.cue.wear;

import androidx.annotation.NonNull;

import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.WearableListenerService;

public class StateListener extends WearableListenerService {
    @Override
    public void onMessageReceived(@NonNull MessageEvent event) {
        if (Link.FROM_PHONE.equals(event.getPath())) Store.accept(this, event.getData());
    }
}
