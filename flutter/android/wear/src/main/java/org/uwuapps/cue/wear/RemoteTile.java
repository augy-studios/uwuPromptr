/*
 * The Prompter remote tile: the script's name, the prompter's clock counting on the watch by
 * itself (ProtoLayout's dynamic time) while it plays, the speed, and Play or Pause, slower,
 * faster and Restart. Each button reloads the tile with its id (LoadAction), which is sent to
 * the phone as a command; the tile then waits a moment for the phone's answer and draws it.
 *
 * Redrawn by the StateListener when what plays, or what's playing, changes on the phone.
 */
package org.uwuapps.cue.wear;

import androidx.annotation.NonNull;
import androidx.concurrent.futures.CallbackToFutureAdapter;
import androidx.wear.protolayout.ActionBuilders;
import androidx.wear.protolayout.ColorBuilders;
import androidx.wear.protolayout.DimensionBuilders;
import androidx.wear.protolayout.LayoutElementBuilders;
import androidx.wear.protolayout.ModifiersBuilders;
import androidx.wear.protolayout.ResourceBuilders;
import androidx.wear.protolayout.TimelineBuilders;
import androidx.wear.protolayout.TypeBuilders;
import androidx.wear.protolayout.expression.DynamicBuilders;
import androidx.wear.tiles.RequestBuilders;
import androidx.wear.tiles.TileBuilders;
import androidx.wear.tiles.TileService;

import com.google.common.util.concurrent.ListenableFuture;

import java.time.Instant;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class RemoteTile extends TileService {
    private static final String RESOURCES = "1";
    private static final long FRESH_MS = 60_000;
    // How long a tap waits for the phone to answer before drawing what's known.
    private static final long ANSWER_MS = 1_500;
    private static final int BRAND = 0xFFCCFFCC;
    private static final int WHITE = 0xFFFFFFFF;
    private static final int GREY = 0xFFAAAAAA;
    private static final int KEY = 0xFF2A2A2A;
    private static final int BLACK = 0xFF000000;

    private final ExecutorService work = Executors.newSingleThreadExecutor();

    @NonNull
    @Override
    protected ListenableFuture<TileBuilders.Tile> onTileRequest(@NonNull RequestBuilders.TileRequest request) {
        String click = request.getCurrentState().getLastClickableId();
        return CallbackToFutureAdapter.getFuture(done -> {
            work.execute(() -> {
                try {
                    done.set(tile(layout(click == null ? "" : click)));
                } catch (Exception e) {
                    done.set(tile(message("Couldn’t reach your phone just now.", "")));
                }
            });
            return "remote tile";
        });
    }

    @NonNull
    @Override
    protected ListenableFuture<ResourceBuilders.Resources> onTileResourcesRequest(@NonNull RequestBuilders.ResourcesRequest request) {
        return CallbackToFutureAdapter.getFuture(done -> {
            done.set(new ResourceBuilders.Resources.Builder().setVersion(RESOURCES).build());
            return "remote tile resources";
        });
    }

    @Override
    public void onDestroy() {
        work.shutdown();
        super.onDestroy();
    }

    private TileBuilders.Tile tile(LayoutElementBuilders.LayoutElement content) {
        return new TileBuilders.Tile.Builder()
                .setResourcesVersion(RESOURCES)
                .setFreshnessIntervalMillis(FRESH_MS)
                .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(padded(content)))
                .build();
    }

    private LayoutElementBuilders.LayoutElement layout(String click) {
        if (click.equals("open")) {
            Link.openOnPhone(this, ok -> { });
            return message("Opening uwuPromptr on your phone. Tap here once it’s open.", "retry");
        }

        // Ask, and wait a moment for the answer: after a tap, always; otherwise when what's
        // known is old. The phone answers a command or a hello at once.
        Store.State known = Store.state(this);
        Store.State s = known;
        if (!click.isEmpty() || !Store.reachable(known)) {
            long asked = System.currentTimeMillis();
            Link.sendNow(this, click);
            s = Store.await(this, asked, ANSWER_MS);
        }

        if (!Store.reachable(s)) return message("Open uwuPromptr on your phone.", "open");
        if (s.remote() && !s.live) return message("Connect your phone’s remote to a prompter.", "retry");

        LayoutElementBuilders.Column.Builder col = new LayoutElementBuilders.Column.Builder()
                .setWidth(DimensionBuilders.expand())
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                .addContent(openApp(text(s.name.isEmpty() ? "Untitled script" : s.name, 14, BRAND, true)))
                .addContent(clock(s))
                .addContent(text(String.format(Locale.ROOT, "Speed %.1f", s.speed), 12, GREY, false))
                .addContent(gap(6))
                .addContent(new LayoutElementBuilders.Row.Builder()
                        .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
                        .addContent(button("slower", "−", 40, 40, KEY, WHITE))
                        .addContent(gapWide(6))
                        .addContent(button("toggle", s.playing ? "Pause" : "Play", 68, 44, BRAND, BLACK))
                        .addContent(gapWide(6))
                        .addContent(button("faster", "+", 40, 40, KEY, WHITE))
                        .build())
                .addContent(gap(6))
                .addContent(button("reset", "Restart", 84, 32, KEY, WHITE));
        return col.build();
    }

    /** The prompter's clock, counting on by itself while it plays. */
    private LayoutElementBuilders.LayoutElement clock(Store.State s) {
        long elapsed = s.elapsedNow();
        TypeBuilders.StringProp.Builder said = new TypeBuilders.StringProp.Builder(minutesSeconds(elapsed));
        if (s.playing) {
            DynamicBuilders.DynamicDuration running = DynamicBuilders.DynamicInstant
                    .withSecondsPrecision(Instant.ofEpochMilli(System.currentTimeMillis() - elapsed))
                    .durationUntil(DynamicBuilders.DynamicInstant.platformTimeWithSecondsPrecision());
            DynamicBuilders.DynamicInt32.IntFormatter two = new DynamicBuilders.DynamicInt32.IntFormatter.Builder()
                    .setMinIntegerDigits(2)
                    .build();
            said.setDynamicValue(running.toIntMinutes().format(two)
                    .concat(DynamicBuilders.DynamicString.constant(":"))
                    .concat(running.getSecondsPart().format(two)));
        }
        return new LayoutElementBuilders.Text.Builder()
                .setText(said.build())
                .setLayoutConstraintsForDynamicText(new TypeBuilders.StringLayoutConstraint.Builder("000:00").build())
                .setFontStyle(style(24, WHITE, false))
                .build();
    }

    private static String minutesSeconds(long ms) {
        long total = ms / 1000;
        return String.format(Locale.ROOT, "%02d:%02d", total / 60, total % 60);
    }

    /** A sentence, and the whole tile as a button that does `click`. */
    private LayoutElementBuilders.LayoutElement message(String text, String click) {
        LayoutElementBuilders.LayoutElement t = new LayoutElementBuilders.Text.Builder()
                .setText(text)
                .setMaxLines(4)
                .setMultilineAlignment(LayoutElementBuilders.TEXT_ALIGN_CENTER)
                .setFontStyle(style(13, WHITE, false))
                .build();
        if (click.isEmpty()) return t;
        return new LayoutElementBuilders.Box.Builder()
                .setWidth(DimensionBuilders.expand())
                .setHeight(DimensionBuilders.expand())
                .setModifiers(new ModifiersBuilders.Modifiers.Builder()
                        .setClickable(clickable(click))
                        .build())
                .addContent(t)
                .build();
    }

    private LayoutElementBuilders.LayoutElement button(String id, String label, float w, float h, int fill, int ink) {
        return new LayoutElementBuilders.Box.Builder()
                .setWidth(DimensionBuilders.dp(w))
                .setHeight(DimensionBuilders.dp(h))
                .setModifiers(new ModifiersBuilders.Modifiers.Builder()
                        .setBackground(new ModifiersBuilders.Background.Builder()
                                .setColor(ColorBuilders.argb(fill))
                                .setCorner(new ModifiersBuilders.Corner.Builder().setRadius(DimensionBuilders.dp(h / 2)).build())
                                .build())
                        .setClickable(clickable(id))
                        .build())
                .addContent(text(label, label.length() <= 1 ? 20 : 14, ink, true))
                .build();
    }

    private static ModifiersBuilders.Clickable clickable(String id) {
        return new ModifiersBuilders.Clickable.Builder()
                .setId(id)
                .setOnClick(new ActionBuilders.LoadAction.Builder().build())
                .build();
    }

    /** The script's name opens the watch's screen, for the crown. */
    private LayoutElementBuilders.LayoutElement openApp(LayoutElementBuilders.LayoutElement content) {
        ActionBuilders.LaunchAction launch = new ActionBuilders.LaunchAction.Builder()
                .setAndroidActivity(new ActionBuilders.AndroidActivity.Builder()
                        .setPackageName(getPackageName())
                        .setClassName(MainActivity.class.getName())
                        .build())
                .build();
        return new LayoutElementBuilders.Box.Builder()
                .setModifiers(new ModifiersBuilders.Modifiers.Builder()
                        .setClickable(new ModifiersBuilders.Clickable.Builder().setId("app").setOnClick(launch).build())
                        .build())
                .addContent(content)
                .build();
    }

    private static LayoutElementBuilders.LayoutElement text(String s, float sp, int color, boolean bold) {
        return new LayoutElementBuilders.Text.Builder()
                .setText(s)
                .setMaxLines(1)
                .setFontStyle(style(sp, color, bold))
                .build();
    }

    private static LayoutElementBuilders.FontStyle style(float sp, int color, boolean bold) {
        return new LayoutElementBuilders.FontStyle.Builder()
                .setSize(DimensionBuilders.sp(sp))
                .setColor(ColorBuilders.argb(color))
                .setWeight(bold ? LayoutElementBuilders.FONT_WEIGHT_BOLD : LayoutElementBuilders.FONT_WEIGHT_NORMAL)
                .build();
    }

    private static LayoutElementBuilders.LayoutElement gap(float dp) {
        return new LayoutElementBuilders.Spacer.Builder().setHeight(DimensionBuilders.dp(dp)).build();
    }

    private static LayoutElementBuilders.LayoutElement gapWide(float dp) {
        return new LayoutElementBuilders.Spacer.Builder().setWidth(DimensionBuilders.dp(dp)).build();
    }

    private static LayoutElementBuilders.LayoutElement padded(LayoutElementBuilders.LayoutElement content) {
        return new LayoutElementBuilders.Box.Builder()
                .setWidth(DimensionBuilders.expand())
                .setHeight(DimensionBuilders.expand())
                .setModifiers(new ModifiersBuilders.Modifiers.Builder()
                        .setPadding(new ModifiersBuilders.Padding.Builder().setAll(DimensionBuilders.dp(12)).build())
                        .build())
                .addContent(content)
                .build();
    }
}
