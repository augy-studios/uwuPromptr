import Cocoa
import FlutterMacOS
import desktop_multi_window

// The main window. The Flutter view sits in a container over a vibrancy view (macOS's own
// translucent window material), hidden until the glass look asks for it
// (lib/desktop/backdrop.dart): then the window and the Flutter view go see-through, and the
// desktop shows blurred through the app's page, as in macOS Tahoe's own apps.
class MainFlutterWindow: NSWindow {
  private let backdrop = NSVisualEffectView()
  private weak var flutterViewController: FlutterViewController?
  private var flutterBackground: NSColor?

  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame

    // The container: the vibrancy view under the Flutter view, both filling it.
    let host = NSViewController()
    let container = NSView(frame: NSRect(origin: .zero, size: windowFrame.size))
    container.autoresizesSubviews = true
    backdrop.frame = container.bounds
    backdrop.autoresizingMask = [.width, .height]
    backdrop.blendingMode = .behindWindow
    backdrop.material = .underWindowBackground
    backdrop.state = .followsWindowActiveState
    backdrop.isHidden = true
    container.addSubview(backdrop)
    flutterViewController.view.frame = container.bounds
    flutterViewController.view.autoresizingMask = [.width, .height]
    container.addSubview(flutterViewController.view)
    host.view = container
    host.addChild(flutterViewController)
    self.contentViewController = host
    self.flutterViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)
    // Each desktop widget is a window with an engine of its own: it gets the same plugins.
    FlutterMultiWindowPlugin.setOnWindowCreatedCallback { controller in
      RegisterGeneratedPlugins(registry: controller)
    }
    (NSApp.delegate as? AppDelegate)?.attach(flutterViewController.engine.binaryMessenger, window: self)

    super.awakeFromNib()
    // Keys go to Flutter, as they would were its view the window's own.
    self.makeFirstResponder(flutterViewController.view)
  }

  /// The glass look's backdrop on or off, light or dark: "blurred" when it's on, else "none".
  func setBackdrop(on: Bool, dark: Bool) -> String {
    guard let flutterViewController = flutterViewController else { return "none" }
    if flutterBackground == nil { flutterBackground = flutterViewController.backgroundColor }
    if on {
      backdrop.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
      backdrop.isHidden = false
      isOpaque = false
      backgroundColor = .clear
      flutterViewController.backgroundColor = .clear
      return "blurred"
    }
    // Never on: the window stays as it was made.
    if backdrop.isHidden { return "none" }
    backdrop.isHidden = true
    isOpaque = true
    backgroundColor = .windowBackgroundColor
    if let original = flutterBackground { flutterViewController.backgroundColor = original }
    return "none"
  }
}
