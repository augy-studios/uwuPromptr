package org.uwuapps.cue;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;

/**
 * The app's notification channels, one per kind, each a switch in Android's
 * settings.
 *
 * A channel's importance and sound are fixed when it is first created on a
 * phone: changing them here does nothing to installed copies. A different
 * behaviour needs a new channel id.
 */
final class Notifications {

    /** "Version X is out", sent to the cue-releases topic when a release is published. */
    static final String CHANNEL_UPDATES = "updates";

    private Notifications() {}

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel updates = new NotificationChannel(
            CHANNEL_UPDATES,
            context.getString(R.string.channel_updates),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        updates.setDescription(context.getString(R.string.channel_updates_description));
        manager.createNotificationChannel(updates);
    }

    /** Whether the user lets this app post at all. */
    static boolean allowed(Context context) {
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }
}
