pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Shapes
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents
import "Theme.js" as T

// The chrome row: the language pair on the left, card status and the two
// actions on the right. The three language controls are always present; the
// cached pill, refresh and copy need a result, so they are not built without
// one — and not built while a request is in flight, either.
RowLayout {
    id: chrome

    property string source: "auto"
    property string target: "id"
    property var detected: null
    property bool cached: false
    property string fetchedAt: ""
    property bool hasResult: false
    property bool busy: false

    readonly property bool autoSource: source === "auto"
    readonly property bool detectedSource: autoSource
        && detected !== null && detected !== undefined
        && detected.source !== undefined && detected.source !== ""

    readonly property string sourceLabel: {
        if (!autoSource)
            return source.toUpperCase()
        if (detectedSource)
            return detected.source.toUpperCase() + " · " + i18n("detected")
        return i18n("AUTO")
    }

    readonly property string sourceTooltip: {
        if (!autoSource)
            return i18n("Source language — %1, set by hand", source.toUpperCase())
        if (detectedSource)
            return i18n("Source language — auto-detected as %1", detected.source.toUpperCase())
        return i18n("Source language — detect automatically")
    }

    readonly property bool actionsVisible: hasResult && !busy

    signal languageChosen(string which, string code)
    signal swapRequested()
    signal refreshRequested()
    signal copyRequested()

    spacing: T.space8

    // Source: a dotted border means "detected, not chosen"; a solid one means
    // a human set it (spec §7.2).
    PlasmaComponents.ToolButton {
        id: sourceButton

        text: chrome.sourceLabel
        font.pixelSize: T.chipSize
        font.bold: !chrome.autoSource
        padding: T.space4
        opacity: chrome.detectedSource ? 0.75 : 1
        onClicked: picker.openFor("source")

        background: Item {
            Shape {
                anchors.fill: parent
                antialiasing: true

                ShapePath {
                    fillColor: "transparent"
                    strokeWidth: 1
                    strokeColor: sourceButton.hovered || picker.visible
                                 ? Kirigami.Theme.highlightColor
                                 : Kirigami.Theme.disabledTextColor
                    // Spec §7.2: dotted = auto-detected, solid = a human chose
                    // it. Rectangle has no border style in Qt Quick, so the
                    // stroke is drawn with Shapes; a round-capped 1-on/3-off
                    // dash reads as a dotted line. dashPattern is ignored when
                    // the style is solid. The 0.5 inset keeps the 1 px stroke
                    // inside the button's bounds.
                    strokeStyle: chrome.detectedSource
                                 ? ShapePath.DashLine : ShapePath.SolidLine
                    dashPattern: [1, 3]
                    capStyle: ShapePath.RoundCap

                    PathRectangle {
                        x: 0.5
                        y: 0.5
                        width: Math.max(0, sourceButton.width - 1)
                        height: Math.max(0, sourceButton.height - 1)
                        radius: T.radiusInput
                    }
                }
            }
        }

        PlasmaComponents.ToolTip {
            enabled: false
            text: chrome.sourceTooltip
            visible: sourceButton.hovered || sourceButton.activeFocus
        }
    }

    PlasmaComponents.ToolButton {
        id: swapButton

        text: "↔"
        font.pixelSize: T.metaSize
        padding: T.space4
        onClicked: chrome.swapRequested()

        PlasmaComponents.ToolTip {
            enabled: false
            text: i18n("Swap source and target")
            visible: swapButton.hovered || swapButton.activeFocus
        }
    }

    PlasmaComponents.ToolButton {
        id: targetButton

        text: chrome.target.toUpperCase()
        font.pixelSize: T.chipSize
        padding: T.space4
        onClicked: picker.openFor("target")

        background: Rectangle {
            radius: T.radiusInput
            color: "transparent"
            border.width: 1
            border.color: targetButton.hovered || picker.visible
                          ? Kirigami.Theme.highlightColor
                          : Kirigami.Theme.disabledTextColor
        }

        PlasmaComponents.ToolTip {
            enabled: false
            text: i18n("Target language — %1", chrome.target.toUpperCase())
            visible: targetButton.hovered || targetButton.activeFocus
        }
    }

    Item { Layout.fillWidth: true }

    // Refresh needs a rendered result; without one it is absent, not disabled.
    // `visible` mirrors `active`: a Loader with active:false builds nothing, but
    // it is still an item in the RowLayout, so its row spacing would leave a
    // phantom gap. QtQuick Layouts skip invisible items.
    Loader {
        active: chrome.actionsVisible
        visible: chrome.actionsVisible
        sourceComponent: PlasmaComponents.ToolButton {
            id: refreshButton
            icon.name: "view-refresh"
            onClicked: chrome.refreshRequested()

            HoverHandler { id: refreshHover }

            PlasmaComponents.ToolTip {
                enabled: false
                text: i18n("Refresh — bypasses the cache")
                visible: refreshHover.hovered
            }
        }
    }

    // Copy needs a result with a non-empty translation.
    Loader {
        active: chrome.actionsVisible
        visible: chrome.actionsVisible
        sourceComponent: PlasmaComponents.ToolButton {
            id: copyButton
            icon.name: "edit-copy"
            onClicked: chrome.copyRequested()

            HoverHandler { id: copyHover }

            PlasmaComponents.ToolTip {
                enabled: false
                text: i18n("Copy translation")
                visible: copyHover.hovered
            }
        }
    }

    // Cached is card-level status, so it belongs here and not in the reading
    // flow. It needs a result that came from the local cache.
    Loader {
        active: chrome.actionsVisible && chrome.cached
        visible: chrome.actionsVisible && chrome.cached
        sourceComponent: Rectangle {
            id: cachedPill
            radius: T.radiusPill
            color: "transparent"
            border.width: 1
            border.color: Kirigami.Theme.disabledTextColor
            implicitWidth: cachedLabel.implicitWidth + T.space12
            implicitHeight: cachedLabel.implicitHeight + T.space4

            HoverHandler { id: pillHover }

            PlasmaComponents.Label {
                id: cachedLabel
                anchors.centerIn: parent
                text: i18n("CACHED")
                font.pixelSize: T.pillSize
                color: Kirigami.Theme.disabledTextColor
            }

            PlasmaComponents.ToolTip {
                enabled: false
                text: i18n("From cache · fetched %1", chrome.fetchedAt)
                visible: pillHover.hovered
            }
        }
    }

    LanguagePicker {
        id: picker
        currentSource: chrome.source
        currentTarget: chrome.target
        onPicked: function (which, code) { chrome.languageChosen(which, code) }
    }
}
