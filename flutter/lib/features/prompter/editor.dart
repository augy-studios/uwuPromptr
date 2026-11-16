// The script editor (the site's #editor): over the reading area, the name and the text, saved as
// they're typed. Done (or Ctrl+S) saves and closes; Cancel (or Esc) puts back what it opened with,
// asking first if anything changed. Text pasted from a word processor is cleaned on the way in.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/nav.dart';
import '../../theme/icons.dart';
import '../../theme/theme.dart';
import '../../widgets/common.dart';
import '../tour/tour.dart';
import 'session.dart';

class ScriptEditor extends StatefulWidget {
  const ScriptEditor({super.key});

  @override
  State<ScriptEditor> createState() => _ScriptEditorState();
}

class _ScriptEditorState extends State<ScriptEditor> {
  final _body = FocusNode();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _body.requestFocus());
  }

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  Future<void> _paste() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text;
    if (text != null && text.isNotEmpty) Session.I.pasteIntoEditor(text);
  }

  void _save() {
    Session.I.closeEditor();
    AppNav.toast('Script saved');
  }

  /// The text field's menu, its Paste cleaning as Ctrl+V does.
  Widget _menu(BuildContext context, EditableTextState state) {
    final items = [
      for (final item in state.contextMenuButtonItems)
        if (item.type == ContextMenuButtonType.paste)
          item.copyWith(
            onPressed: () {
              state.hideToolbar();
              _paste();
            },
          )
        else
          item,
    ];
    return AdaptiveTextSelectionToolbar.buttonItems(
      anchors: state.contextMenuAnchors,
      buttonItems: items,
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    final s = Session.I;
    final mac = Theme.of(context).platform == TargetPlatform.macOS;
    return CallbackShortcuts(
      bindings: {
        SingleActivator(LogicalKeyboardKey.keyS, control: !mac, meta: mac):
            _save,
        const SingleActivator(LogicalKeyboardKey.escape): s.cancelEditor,
      },
      child: Actions(
        actions: {
          PasteTextIntent: CallbackAction<PasteTextIntent>(
            onInvoke: (_) {
              _paste();
              return null;
            },
          ),
        },
        child: Semantics(
          label: 'Edit script',
          container: true,
          child: Container(
            color: c.paper,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    border: Border(bottom: BorderSide(color: c.border)),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Named(
                          'Script name',
                          child: TextField(
                            key: TourTargets.key('editor-name'),
                            controller: s.nameField,
                            onChanged: (_) => s.editorTyped(),
                            textCapitalization: TextCapitalization.sentences,
                            contextMenuBuilder: _menu,
                            decoration: const InputDecoration(
                              hintText: 'Script name',
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton(
                        onPressed: s.cancelEditor,
                        child: const Text('Cancel'),
                      ),
                      const SizedBox(width: 8),
                      FilledButton.icon(
                        key: TourTargets.key('editor-done'),
                        onPressed: _save,
                        icon: AppIcon('check', size: 16, color: c.onBrand),
                        label: const Text('Done'),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Named(
                      'Script text',
                      child: TextField(
                        key: TourTargets.key('editor-body'),
                        controller: s.bodyField,
                        focusNode: _body,
                        onChanged: (_) => s.editorTyped(),
                        expands: true,
                        maxLines: null,
                        minLines: null,
                        textAlignVertical: TextAlignVertical.top,
                        keyboardType: TextInputType.multiline,
                        textCapitalization: TextCapitalization.sentences,
                        contextMenuBuilder: _menu,
                        style: TextStyle(
                          color: c.ink,
                          fontSize: 18,
                          height: 1.5,
                        ),
                        decoration: const InputDecoration(
                          hintText: 'Type or paste your script here. It saves as you type.',
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
