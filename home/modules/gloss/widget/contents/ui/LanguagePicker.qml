pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import "Theme.js" as T

// The language picker: a searchable list of real languages, the current choice
// marked. Opened under the source or the target control; choosing a row sets
// the language by hand.
QQC2.Popup {
    id: picker

    // "source" | "target"
    property string which: "source"
    property string currentSource: "auto"
    property string currentTarget: "id"

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
        searchField.forceActiveFocus()
        open()
    }

    modal: true
    focus: true
    closePolicy: QQC2.Popup.CloseOnEscape | QQC2.Popup.CloseOnPressOutside
    width: 260
    padding: T.space8

    contentItem: ColumnLayout {
        spacing: T.space8

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
                    picker.close()
                }
            }
        }
    }
}
