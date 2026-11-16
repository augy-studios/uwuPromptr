#include "my_application.h"

#include <flutter_linux/flutter_linux.h>
#ifdef GDK_WINDOWING_X11
#include <gdk/gdkx.h>
#endif

#include <cstring>

#include "flutter/generated_plugin_registrant.h"
#include "desktop_multi_window/desktop_multi_window_plugin.h"

struct _MyApplication {
  GtkApplication parent_instance;
  char** dart_entrypoint_arguments;
  GtkWindow* window;
  // The app's own channel (org.uwuapps.cue/desktop, lib/desktop/runner.dart): here, only the
  // glass look's backdrop.
  FlMethodChannel* channel;
  // Whether the window could be made see-through (a compositing desktop): an RGBA visual.
  gboolean see_through;
};

G_DEFINE_TYPE(MyApplication, my_application, GTK_TYPE_APPLICATION)

// The glass look's backdrop (lib/desktop/backdrop.dart). The window is see-through from the
// start wherever the desktop composites, and the app paints it solid in its other looks; on, it
// asks the compositor to blur what's behind it: KWin's blur, which Deepin's window manager
// (deepin-kwin) keeps, offered to apps on X11 when its root window carries the property.
// Answers "blurred", "clear" (see-through, nothing to blur it: most Wayland desktops, COSMIC's
// included, so the app frosts it itself) or "none" (not see-through).
static const gchar* set_backdrop(MyApplication* self, gboolean on) {
  if (!self->see_through || self->window == nullptr) return "none";
  if (!on) {
#ifdef GDK_WINDOWING_X11
    GdkWindow* gdk_window = gtk_widget_get_window(GTK_WIDGET(self->window));
    if (gdk_window != nullptr && GDK_IS_X11_WINDOW(gdk_window)) {
      gdk_property_delete(gdk_window, gdk_atom_intern_static_string("_KDE_NET_WM_BLUR_BEHIND_REGION"));
    }
#endif
    return "none";
  }
#ifdef GDK_WINDOWING_X11
  GdkWindow* gdk_window = gtk_widget_get_window(GTK_WIDGET(self->window));
  if (gdk_window != nullptr && GDK_IS_X11_WINDOW(gdk_window)) {
    GdkAtom blur = gdk_atom_intern_static_string("_KDE_NET_WM_BLUR_BEHIND_REGION");
    GdkAtom type = GDK_NONE;
    gint format = 0;
    gint length = 0;
    guchar* data = nullptr;
    // The compositor announces its blur on the root window.
    gboolean offered = gdk_property_get(gdk_get_default_root_window(), blur, GDK_NONE, 0, 1,
                                        FALSE, &type, &format, &length, &data);
    g_free(data);
    // An empty region: the whole window.
    gdk_property_change(gdk_window, blur, gdk_atom_intern_static_string("CARDINAL"), 32,
                        GDK_PROP_MODE_REPLACE, nullptr, 0);
    return offered ? "blurred" : "clear";
  }
#endif
  return "clear";
}

static void method_call_cb(FlMethodChannel* channel, FlMethodCall* method_call,
                           gpointer user_data) {
  MyApplication* self = MY_APPLICATION(user_data);
  const gchar* method = fl_method_call_get_name(method_call);
  g_autoptr(FlMethodResponse) response = nullptr;
  if (strcmp(method, "setBackdrop") == 0) {
    FlValue* args = fl_method_call_get_args(method_call);
    gboolean on = FALSE;
    if (args != nullptr && fl_value_get_type(args) == FL_VALUE_TYPE_MAP) {
      FlValue* v = fl_value_lookup_string(args, "on");
      on = v != nullptr && fl_value_get_type(v) == FL_VALUE_TYPE_BOOL && fl_value_get_bool(v);
    }
    g_autoptr(FlValue) result = fl_value_new_string(set_backdrop(self, on));
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(result));
  } else {
    response = FL_METHOD_RESPONSE(fl_method_not_implemented_response_new());
  }
  fl_method_call_respond(method_call, response, nullptr);
}

// Called when first Flutter frame received.
static void first_frame_cb(MyApplication* self, FlView* view) {
  gtk_widget_show(gtk_widget_get_toplevel(GTK_WIDGET(view)));
}

// Implements GApplication::activate.
static void my_application_activate(GApplication* application) {
  MyApplication* self = MY_APPLICATION(application);
  GtkWindow* window =
      GTK_WINDOW(gtk_application_window_new(GTK_APPLICATION(application)));

  // The app draws its own title bar (lib/desktop/chrome.dart), so no header bar here.
  gtk_window_set_title(window, "uwuPromptr");

  gtk_window_set_default_size(window, 1120, 760);

  // See-through where the desktop composites, for the glass look (set_backdrop above). The app
  // paints every pixel itself in its other looks, so nothing shows through them.
  GdkScreen* screen = gtk_window_get_screen(window);
  GdkVisual* visual = gdk_screen_get_rgba_visual(screen);
  self->see_through = visual != nullptr && gdk_screen_is_composited(screen);
  if (self->see_through) {
    gtk_widget_set_visual(GTK_WIDGET(window), visual);
    gtk_widget_set_app_paintable(GTK_WIDGET(window), TRUE);
  }
  self->window = window;

  g_autoptr(FlDartProject) project = fl_dart_project_new();
  fl_dart_project_set_dart_entrypoint_arguments(
      project, self->dart_entrypoint_arguments);

  FlView* view = fl_view_new(project);
  GdkRGBA background_color;
  // Clear where the window can be seen through, for the glass look; black otherwise.
  gdk_rgba_parse(&background_color, self->see_through ? "#00000000" : "#000000");
  fl_view_set_background_color(view, &background_color);
  gtk_widget_show(GTK_WIDGET(view));
  gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));

  // Show the window when Flutter renders.
  // Requires the view to be realized so we can start rendering.
  g_signal_connect_swapped(view, "first-frame", G_CALLBACK(first_frame_cb),
                           self);
  gtk_widget_realize(GTK_WIDGET(view));

  fl_register_plugins(FL_PLUGIN_REGISTRY(view));

  g_autoptr(FlStandardMethodCodec) codec = fl_standard_method_codec_new();
  self->channel = fl_method_channel_new(
      fl_engine_get_binary_messenger(fl_view_get_engine(view)),
      "org.uwuapps.cue/desktop", FL_METHOD_CODEC(codec));
  fl_method_channel_set_method_call_handler(self->channel, method_call_cb, self, nullptr);
  // Each desktop widget is a window with an engine of its own: it gets the same plugins.
  desktop_multi_window_plugin_set_window_created_callback([](FlPluginRegistry* registry) {
    fl_register_plugins(registry);
  });

  gtk_widget_grab_focus(GTK_WIDGET(view));
}

// Implements GApplication::local_command_line.
static gboolean my_application_local_command_line(GApplication* application,
                                                  gchar*** arguments,
                                                  int* exit_status) {
  MyApplication* self = MY_APPLICATION(application);
  // Strip out the first argument as it is the binary name.
  self->dart_entrypoint_arguments = g_strdupv(*arguments + 1);

  g_autoptr(GError) error = nullptr;
  if (!g_application_register(application, nullptr, &error)) {
    g_warning("Failed to register: %s", error->message);
    *exit_status = 1;
    return TRUE;
  }

  g_application_activate(application);
  *exit_status = 0;

  return TRUE;
}

// Implements GApplication::startup.
static void my_application_startup(GApplication* application) {
  // MyApplication* self = MY_APPLICATION(object);

  // Perform any actions required at application startup.

  G_APPLICATION_CLASS(my_application_parent_class)->startup(application);
}

// Implements GApplication::shutdown.
static void my_application_shutdown(GApplication* application) {
  // MyApplication* self = MY_APPLICATION(object);

  // Perform any actions required at application shutdown.

  G_APPLICATION_CLASS(my_application_parent_class)->shutdown(application);
}

// Implements GObject::dispose.
static void my_application_dispose(GObject* object) {
  MyApplication* self = MY_APPLICATION(object);
  g_clear_pointer(&self->dart_entrypoint_arguments, g_strfreev);
  g_clear_object(&self->channel);
  G_OBJECT_CLASS(my_application_parent_class)->dispose(object);
}

static void my_application_class_init(MyApplicationClass* klass) {
  G_APPLICATION_CLASS(klass)->activate = my_application_activate;
  G_APPLICATION_CLASS(klass)->local_command_line =
      my_application_local_command_line;
  G_APPLICATION_CLASS(klass)->startup = my_application_startup;
  G_APPLICATION_CLASS(klass)->shutdown = my_application_shutdown;
  G_OBJECT_CLASS(klass)->dispose = my_application_dispose;
}

static void my_application_init(MyApplication* self) {}

MyApplication* my_application_new() {
  // Set the program name to the application ID, which helps various systems
  // like GTK and desktop environments map this running application to its
  // corresponding .desktop file. This ensures better integration by allowing
  // the application to be recognized beyond its binary name.
  g_set_prgname(APPLICATION_ID);

  return MY_APPLICATION(g_object_new(my_application_get_type(),
                                     "application-id", APPLICATION_ID, "flags",
                                     G_APPLICATION_NON_UNIQUE, nullptr));
}
