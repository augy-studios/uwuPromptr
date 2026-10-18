/*
 * Twist to play or pause: a quick turn of the wrist and back, read from the gyroscope. The
 * Wear OS stand-in for ColorOS watches' motion gestures, for when both hands are busy.
 *
 * The forearm runs along the watch's y axis (12 o'clock to 6), so a twist of the wrist is a
 * spin about y. A twist counts when one way passes TURN and the other way passes BACK within
 * WITHIN_MS: fast enough that walking, gesturing and turning a page don't reach it, and the
 * turn back is what tells it from simply raising the wrist to look. Off until it's turned on,
 * and only listened for while the watch's screen is open.
 */
package org.uwuapps.cue.wear;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.SystemClock;

final class Twist implements SensorEventListener {
    // Radians a second: about 340 and 230 degrees a second.
    private static final float TURN = 6f;
    private static final float BACK = 4f;
    private static final long WITHIN_MS = 600;
    // One twist, one toggle: the wrist settling afterwards isn't another.
    private static final long REST_MS = 1200;

    private final SensorManager sensors;
    private final Sensor gyro;
    private final Runnable onTwist;
    private boolean on;
    // The sign of the first turn, and when it was; 0 when there's none.
    private int turned;
    private long turnedAt;
    private long restUntil;

    Twist(Context c, Runnable onTwist) {
        sensors = c.getSystemService(SensorManager.class);
        gyro = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
        this.onTwist = onTwist;
    }

    boolean available() {
        return gyro != null;
    }

    void start() {
        if (on || gyro == null) return;
        on = sensors.registerListener(this, gyro, SensorManager.SENSOR_DELAY_GAME);
        turned = 0;
    }

    void stop() {
        if (!on) return;
        sensors.unregisterListener(this);
        on = false;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        long now = SystemClock.elapsedRealtime();
        if (now < restUntil) return;
        float spin = event.values[1];

        if (turned != 0 && now - turnedAt > WITHIN_MS) turned = 0;
        if (turned == 0) {
            if (Math.abs(spin) > TURN) {
                turned = spin > 0 ? 1 : -1;
                turnedAt = now;
            }
            return;
        }
        if (Math.signum(spin) == -turned && Math.abs(spin) > BACK) {
            turned = 0;
            restUntil = now + REST_MS;
            onTwist.run();
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
