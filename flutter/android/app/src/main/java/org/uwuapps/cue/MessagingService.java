package org.uwuapps.cue;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * "uwuPromptr 2.0.1 is out" from the site (main-site/api/push/release.js), on the cue-releases
 * topic that New version alerts joins (FIREBASE-SETUP.md). While the app's in the background
 * Android shows it itself, from the message's notification part; this shows it while the app's
 * in front, where Android wouldn't. Either way, tapping it opens the Updates page.
 */
public class MessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (!"update".equals(data.get("type"))) return;
        MainActivity.Notifications.channels(this);
        String title = data.get("title");
        String body = data.get("body");
        Intent open = new Intent(MainActivity.OPEN_UPDATES)
                .setPackage(getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(this, 1, open, flags);
        NotificationCompat.Builder n = new NotificationCompat.Builder(this, MainActivity.Notifications.CHANNEL_UPDATES)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setColor(getColor(R.color.notification_colour))
                .setContentTitle(title == null ? "A new version of uwuPromptr is out" : title)
                .setContentText(body == null ? "Tap to update the app." : body)
                .setAutoCancel(true)
                .setContentIntent(tap);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify("update", 1, n.build());
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // Topics need no token kept on the server.
    }
}
