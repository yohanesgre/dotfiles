pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami
import "Theme.js" as T

// The four ways content is absent. All four render inside the result region
// only — the field above them is never covered, disabled, cleared or rebuilt.
// An element whose need is unmet is not built; there is no disabled variant.
ColumnLayout {
    id: voids

    // "empty" | "loading" | "error" | "noKey"
    property string phase: "empty"
    property string message: ""
    property string code: ""
    property var retryAfter: null
    property bool detailsOpen: false

    readonly property bool showDetails: phase === "error" && voids.detailsOpen

    readonly property string metaLine: {
        if (phase !== "error" || code === "")
            return ""
        if (retryAfter === null || retryAfter === undefined)
            return code
        return code + " · retry_after " + retryAfter
    }

    signal retryRequested()

    spacing: 0

    // ---- empty: one grey line naming the one door, no illustration ------
    // The widget never reads the clipboard, so the hint must not promise a
    // lookup of a selection (user decision: "open empty, never read the
    // clipboard"). One line, not a paragraph: the card opens at content
    // height, and the hotkey fact already lives in the compact tooltip.
    Text {
        Layout.fillWidth: true
        visible: voids.phase === "empty"
        text: i18n("Type or paste, then press Enter")
        font.pixelSize: T.chipSize
        color: Kirigami.Theme.disabledTextColor
        wrapMode: Text.Wrap
    }

    // ---- loading: the shape of the real content, in the result region ----
    ColumnLayout {
        Layout.fillWidth: true
        visible: voids.phase === "loading"
        spacing: T.space12

        Repeater {
            model: [0.70, 0.32, 0.66, 0.46, 0.62, 0.42]

            delegate: Rectangle {
                required property int index
                required property real modelData

                Layout.preferredWidth: (parent ? parent.width : 0) * modelData
                implicitHeight: index % 2 === 0 ? T.space12 : T.space16
                radius: T.radiusInput
                color: Kirigami.Theme.disabledTextColor
                opacity: 0.72

                SequentialAnimation on opacity {
                    // Reduced motion. `Kirigami.Units.longDuration` is the KDE
                    // animation-duration scale: under the org.kde.desktop style it
                    // is max(1, 200 × AnimationDurationFactor), so "animations off"
                    // measures 1, not 0 — hence `> 1`, the same gate KDE's own
                    // BusyIndicator uses. When it is false the pulse never runs and
                    // the skeleton holds its declared static 0.72.
                    running: Kirigami.Units.longDuration > 1 && voids.phase === "loading"
                    loops: Animation.Infinite
                    NumberAnimation { to: 1.0; duration: 700 }
                    NumberAnimation { to: 0.72; duration: 700 }
                }
            }
        }

        Text {
            Layout.fillWidth: true
            text: i18n("Looking up…")
            font.pixelSize: T.notesSize
            color: Kirigami.Theme.disabledTextColor
        }
    }

    // ---- error: one line, then the action on its own line --------------
    ColumnLayout {
        Layout.fillWidth: true
        visible: voids.phase === "error"
        spacing: 0

        Text {
            Layout.fillWidth: true
            text: voids.message !== "" ? voids.message : voids.code
            font.pixelSize: T.meaningSize
            color: Kirigami.Theme.negativeTextColor
            wrapMode: Text.Wrap
        }

        // Retry is built only for the five retryable codes. For the other six
        // there is no control at all — absent, never disabled.
        Loader {
            active: voids.phase === "error" && T.retryable(voids.code)
            Layout.topMargin: T.space8
            sourceComponent: QQC2.Button {
                id: retryButton
                text: i18n("Retry")
                onClicked: voids.retryRequested()
            }
        }

        // Developer telemetry never sits in the reading path: the code and the
        // retry delay live behind this collapsed disclosure only.
        QQC2.Button {
            id: detailsButton
            Layout.topMargin: T.space8
            text: i18n("Details")
            flat: true
            onClicked: voids.detailsOpen = !voids.detailsOpen

            QQC2.ToolTip.text: i18n("Machine detail")
            QQC2.ToolTip.visible: detailsButton.hovered
        }

        Text {
            Layout.fillWidth: true
            visible: voids.showDetails
            text: voids.metaLine
            font.pixelSize: T.chipSize
            font.family: "monospace"
            color: Kirigami.Theme.disabledTextColor
            wrapMode: Text.Wrap
        }
    }

    // ---- no key: the field above stays usable, the card keeps its shape --
    ColumnLayout {
        Layout.fillWidth: true
        visible: voids.phase === "noKey"
        spacing: T.space12

        Text {
            Layout.fillWidth: true
            text: voids.message
            font.pixelSize: T.meaningSize
            wrapMode: Text.Wrap
        }

        Rectangle {
            Layout.fillWidth: true
            implicitHeight: 1
            color: Kirigami.Theme.textColor
            opacity: 0.15
        }

        Text {
            Layout.fillWidth: true
            text: i18n("Set the key, then press ⏎ again.")
            font.pixelSize: T.notesSize
            color: Kirigami.Theme.disabledTextColor
            wrapMode: Text.Wrap
        }
    }
}
