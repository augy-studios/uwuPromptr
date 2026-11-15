/*
 * The wrist taps: two short ones every interval while the script plays (Store.pace), and
 * three long ones when it reaches its end. Played as alarms, so they come through with the
 * watch's screen off and its app in the background, where Android drops a touch vibration.
 * The crown's clicks are the screen's own haptics (MainActivity), not these.
 */
package org.uwuapps.cue.wear;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

final class Buzz {
    private Buzz() {}

    static void pace(Context c) {
        play(c, new long[]{0, 70, 110, 70});
    }

    static void end(Context c) {
        play(c, new long[]{0, 320, 160, 320, 160, 320});
    }

    @SuppressWarnings("deprecation") // the AudioAttributes form, before Android 13
    private static void play(Context c, long[] timings) {
        Vibrator v = vibrator(c);
        if (v == null || !v.hasVibrator()) return;
        VibrationEffect effect = VibrationEffect.createWaveform(timings, -1);
        if (Build.VERSION.SDK_INT >= 33) {
            v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
        } else {
            v.vibrate(effect, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        }
    }

    @SuppressWarnings("deprecation") // Vibrator as a service, before Android 12
    private static Vibrator vibrator(Context c) {
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager m = c.getSystemService(VibratorManager.class);
            return m == null ? null : m.getDefaultVibrator();
        }
        return c.getSystemService(Vibrator.class);
    }
}
