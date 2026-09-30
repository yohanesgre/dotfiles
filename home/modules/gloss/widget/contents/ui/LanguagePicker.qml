pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.plasma.core as PlasmaCore
import "Theme.js" as T

// The language picker: a searchable list of real languages, the current choice
// marked. Opened under the source or the target control; choosing a row sets
// the language by hand.
//
// A window, not a Popup. Qt reparents a Popup into the window's overlay layer,
// so it can never be taller than the applet window — and that window is sized
// to the card (`main.qml`'s Layout.preferredHeight is card.implicitHeight),
// as little as ~101 px in the empty state, against a picker that needs ~284.
// PlasmaCore.Dialog is a real top-level window (PlasmaQuick::Dialog :
// QQuickWindow, exported as org.kde.plasma.core/Dialog), so the card's size
// cannot clip it: the card stays compact and the picker floats over it.
//
// Deliberately `org.kde.plasma.core`, never `org.kde.plasma.components`: the
// latter has a different Dialog.qml with in-window Popup semantics, which
// would chop exactly as before.
PlasmaCore.Dialog {
    id: picker

    // "source" | "target"
    property string which: "source"
    property string currentSource: "auto"
    property string currentTarget: "id"

    // The controls this picker belongs to. The window is positioned relative
    // to whichever one opened it, so the list hangs under the control rather
    // than at Qt's default centre for an unparented overlay.
    property Item sourceControl
    property Item targetControl

    // The applet's own popup. A separate window outlives the card, so main.qml
    // reports when that popup closes and this one closes with it — see
    // `onAppletExpandedChanged` below.
    property bool appletExpanded: true

    property alias search: searchField.text

    readonly property var allLanguages: [
        { name: "Auto-detect", code: "AUTO" },
        { name: "English", code: "EN" },
        { name: "Indonesian", code: "ID" },
        { name: "Dutch", code: "NL" },
        { name: "Javanese", code: "JV" },
        { name: "Sundanese", code: "SU" },
        { name: "Arabic", code: "AR" },
        { name: "Spanish", code: "ES" },
        { name: "French", code: "FR" },
        { name: "German", code: "DE" },
        { name: "Japanese", code: "JA" },
        { name: "Chinese", code: "ZH" }
    ]

    // The target is never "auto" — the envelope forbids it — so the auto row is
    // not built for the target control.
    readonly property var rows: {
        var wanted = which === "target" ? allLanguages.slice(1) : allLanguages
        var q = search.trim().toLowerCase()
        if (q === "")
            return wanted
        return wanted.filter(function (r) {
            return r.name.toLowerCase().indexOf(q) >= 0
                || r.code.toLowerCase().indexOf(q) >= 0
        })
    }

    readonly property string current: (which === "target" ? currentTarget : currentSource).toLowerCase()

    signal picked(string which, string code)

    function openFor(w) {
        which = w
        search = ""
        // Anchors the window to the control it belongs to.
        visualParent = w === "target" ? targetControl : sourceControl
        visible = true
        // A window has to exist before a child can hold active focus; the
        // Popup got this for free from `focus: true`.
        Qt.callLater(function () { searchField.forceActiveFocus() })
    }

    function dismiss() {
        visible = false
    }

    onAppletExpandedChanged: {
        if (!appletExpanded)
            dismiss()
    }

    // The controls sit in the card's top chrome row, so the list opens
    // downward from the control.
    location: PlasmaCore.Types.TopEdge
    // A themed panel behind the list — the Popup's background, in a window.
    backgroundHints: PlasmaCore.Dialog.StandardBackground
    // No `modal: true`: a separate window cannot dim the card, so the dim is
    // dropped. Losing activation — the card's popup closing, a click
    // elsewhere — closes it instead.
    hideOnWindowDeactivate: true

    // hideOnWindowDeactivate hides on *deactivation*, and PlasmaQuick::Dialog
    // only ever hides in focusOutEvent (`dialog.h`: "Whether the dialog should
    // be hidden when the dialog loses focus"). setHideOnWindowDeactivate just
    // stores the flag — it neither activates the window nor sets
    // Qt::WindowDoesNotAcceptFocus — so a window that never takes focus can
    // never deactivate, and the property is inert. A window shown with
    // setVisible() is not guaranteed activation either, which is why Plasma
    // activates its own applet dialogs explicitly: CompactApplet.qml calls
    // `dialog.requestActivate()` when its popup becomes visible, and Desktop.qml
    // does `KX11Extras.forceActiveWindow(sidePanel)` / `sidePanel.requestActivate()`.
    // The window's visualParent makes it a transient child of the applet popup
    // (setVisualParent() sets the transient parent), and that popup's
    // hideOnWindowDeactivate is false by default (AppletQuickItem doc), so
    // taking focus here does not close the card.
    onVisibleChanged: {
        if (visible)
            requestActivate()
    }

    // The window resizes to its main item, so the item carries the size (the
    // same shape FolderViewDialog uses). 224 px of list cap plus the search
    // field and the gap between them, which is the ~284 px the Popup could
    // never fit.
    ColumnLayout {
        width: 260
        height: implicitHeight
        spacing: T.space8

        // Escape anywhere in the window, whichever row holds the focus.
        Shortcut {
            sequence: "Escape"
            onActivated: picker.dismiss()
        }

        QQC2.TextField {
            id: searchField
            Layout.fillWidth: true
            placeholderText: i18n("Search languages…")
        }

        ListView {
            id: list
            Layout.fillWidth: true
            Layout.preferredHeight: Math.min(contentHeight, T.space28 * 8)
            clip: true
            model: picker.rows

            delegate: QQC2.ItemDelegate {
                required property var modelData

                width: list.width
                text: (picker.current === modelData.code.toLowerCase() ? "✓  " : "")
                      + modelData.name + "   " + modelData.code
                highlighted: picker.current === modelData.code.toLowerCase()
                onClicked: {
                    picker.picked(picker.which, modelData.code.toLowerCase())
                    picker.dismiss()
                }
            }
        }
    }
}
