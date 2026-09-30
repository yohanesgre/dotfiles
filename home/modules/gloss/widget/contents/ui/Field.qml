import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami
import "Theme.js" as T

// The keystone: the source field and the headword are the same element, in one
// element tree. Word mode styles it as the hero; phrase mode as a compact muted
// composer. It is editable in both, and no load state can clear, cover or
// disable it — it sits outside the result region in Card.qml.
Item {
    id: field

    // "word" renders the value as the hero heading; "phrase" as a compact line.
    property string mode: "word"
    property int cap: T.cap

    property alias text: input.text
    readonly property alias editorFocus: input.activeFocus
    readonly property int graphemes: text.length
    readonly property bool overCap: graphemes > cap
    readonly property bool empty: text.trim().length === 0

    // The counter appears once it can matter, and is always present when the
    // text is over the cap.
    readonly property bool counterVisible: graphemes >= T.counterFrom

    signal submitted(string text)
    signal textEdited(string text)

    function takeFocus() { input.forceActiveFocus() }

    implicitWidth: input.implicitWidth
    implicitHeight: input.implicitHeight
        + (counter.visible ? counter.implicitHeight + T.space4 : 0)

    QQC2.TextField {
        id: input
        width: parent.width

        font.pixelSize: field.mode === "word" ? T.headSize : T.notesSize
        font.bold: field.mode === "word"
        color: field.mode === "word"
               ? Kirigami.Theme.textColor
               : Kirigami.Theme.disabledTextColor
        placeholderText: i18n("Type or paste text…")
        selectByMouse: true
        wrapMode: field.mode === "word" ? TextInput.NoWrap : TextInput.Wrap
        // Word mode is unboxed at rest; phrase mode is a soft composer box.
        padding: field.mode === "word" ? 0 : T.space8

        onAccepted: if (!field.empty && !field.overCap) field.submitted(field.text)
        onTextEdited: field.textEdited(field.text)

        background: Rectangle {
            // Word mode keeps the text at the content edge (padding 0) so the
            // headword stays flush with the translation, meaning and notes
            // below it. The frame is therefore drawn *outward* from the text
            // bounds — 3 px — and the text never sits on it. Phrase mode keeps
            // the frame at the bounds, around its 8 px inset text.
            anchors.fill: parent
            anchors.margins: field.mode === "word" ? -3 : 0
            radius: T.radiusInput + (field.mode === "word" ? 3 : 0)
            color: (field.mode !== "word" || input.activeFocus) && !field.overCap
                   ? Kirigami.Theme.alternateBackgroundColor
                   : "transparent"
            border.width: (field.mode !== "word" || input.activeFocus || field.overCap) ? 1 : 0
            border.color: field.overCap ? Kirigami.Theme.negativeTextColor
                        : input.activeFocus ? Kirigami.Theme.highlightColor
                        : Kirigami.Theme.disabledTextColor
        }

        // The 2 px focus ring sits outside the 1 px accent border — 3 px in
        // word mode, where the border itself is already 3 px out from the text.
        Rectangle {
            anchors.fill: parent
            anchors.margins: field.mode === "word" ? -6 : -3
            radius: T.radiusInput + (field.mode === "word" ? 6 : 3)
            color: "transparent"
            border.width: 2
            border.color: Kirigami.Theme.highlightColor
            opacity: input.activeFocus ? 0.38 : 0
            visible: opacity > 0
            z: -1
        }
    }

    QQC2.Label {
        id: counter
        anchors.top: input.bottom
        anchors.topMargin: T.space4
        anchors.left: input.left
        visible: field.counterVisible
        text: field.overCap
              ? i18n("%1 / %2 — trim it to look up", field.graphemes, field.cap)
              : i18n("%1 / %2", field.graphemes, field.cap)
        font.pixelSize: T.chipSize
        color: field.overCap
               ? Kirigami.Theme.negativeTextColor
               : Kirigami.Theme.disabledTextColor
    }
}
