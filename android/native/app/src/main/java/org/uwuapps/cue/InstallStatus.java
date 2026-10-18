package org.uwuapps.cue;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import androidx.core.content.IntentCompat;

/**
 * What Android's installer says about an update UpdateActivity committed.
 *
 * Needing the user means showing Android's confirm screen, which is allowed
 * here because the update dialog is on screen. Success needs nothing: Android
 * replaces the app. Anything else goes back to the dialog to be explained.
 */
public class InstallStatus extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent.class);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(confirm);
            }
            return;
        }

        if (status == PackageInstaller.STATUS_SUCCESS) return;

        Intent back = new Intent(context, UpdateActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(UpdateActivity.EXTRA_STATUS, status);
        context.startActivity(back);
    }
}
