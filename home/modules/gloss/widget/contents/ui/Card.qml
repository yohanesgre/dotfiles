import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import "Theme.js" as T

// One envelope, rendered by one element tree. The field and the headword are
// the same element (Field.qml); everything below it is optional content whose
// presence depends on the result. Errors and the void states render in the
// same result region, below the field — never over it.
Item {
    id: card

    property var envelope: ({})
    // "empty" | "loading" | "ready"
    property string phase: "empty"
    property string source: "auto"
    property string target: "id"
    property int cap: T.cap

    // The field's text is a local echo owned outside the card, so a failure can
    // never clear it and typing never fights the model's answer.
    property string text: ""

    readonly property string kind: (envelope && envelope.kind) ? envelope.kind : ""
    readonly property bool hasResult: kind === "word" || kind === "phrase"
    readonly property bool busy: phase === "loading"
    readonly property var payload: (envelope && envelope.payload) ? envelope.payload : ({})
    readonly property var meta: (envelope && envelope.meta) ? envelope.meta : ({})
    readonly property var detected: (envelope && envelope.detected) ? envelope.detected : null
    readonly property string errorCode: kind === "error" ? (envelope.code || "") : ""
    readonly property string errorMessage: kind === "error" ? (envelope.message || "") : ""

    readonly property string mode: kind === "phrase" ? "phrase" : "word"

    readonly property bool bodyVisible: hasResult && !busy
    readonly property bool voidsVisible: busy || !hasResult

    readonly property string voidPhase: {
        if (busy)
            return "loading"
        if (kind === "error")
            return errorCode === "missing_key" ? "noKey" : "error"
        if (hasResult)
            return ""
        return "empty"
    }

    readonly property string translationText: hasResult ? (payload.translation || "") : ""
    readonly property bool hasIpaOrPos: kind === "word" && !!((payload.ipa || payload.pos))
    readonly property bool hasTranslation: translationText.length > 0
    readonly property bool hasMeaning: kind === "word" && !!(payload.meaning)
    readonly property bool hasExamples: kind === "word"
        && payload.examples !== undefined && payload.examples.length > 0
    readonly property bool hasExplanation: kind === "phrase"
        && payload.explanation !== undefined && payload.explanation.length > 0
    readonly property bool hasNotes: hasResult && !!(payload.notes)
    readonly property bool cached: meta.cached === true
    readonly property string fetchedAt: meta.fetched_at || ""

    signal submitted(string text)
    signal textEdited(string text)
    signal languageChosen(string which, string code)
    signal swapRequested()
    signal refreshRequested()
    signal copyRequested()
    signal retryRequested()

    function takeFocus() { field.takeFocus() }

    implicitWidth: T.widthPreferred
    implicitHeight: T.space8 + col.implicitHeight

    // The result region grows with its content until it would not fit the
    // screen; past that it scrolls. The bound is the available desktop height
    // minus everything above the region that must stay pinned: the card's top
    // inset, the chrome row, its gap to the field, the field itself, the gap
    // from the field down to the region, and a bottom inset. Short content
    // never reaches it, so no scroll gutter exists at rest. (Logical pixels.)
    readonly property real scrollMaxHeight: Math.max(0,
        Screen.desktopAvailableHeight
        - T.space8                    // card top inset
        - chromeRow.implicitHeight
        - T.space12                   // chrome row to field
        - field.implicitHeight
        - T.space16                   // largest field-to-region gap (word/voids)
        - T.space12)                  // bottom inset

    ColumnLayout {
        id: col

        x: T.pad
        y: T.space8
        width: Math.max(0, card.width - T.pad * 2)
        spacing: 0

        // 12 px: chrome row to heading.
        Chrome {
            id: chromeRow

            Layout.fillWidth: true
            Layout.bottomMargin: T.space12
            source: card.source
            target: card.target
            detected: card.detected
            cached: card.cached
            fetchedAt: card.fetchedAt
            hasResult: card.bodyVisible
            busy: card.busy
            onLanguageChosen: function (which, code) { card.languageChosen(which, code) }
            onSwapRequested: card.swapRequested()
            onRefreshRequested: card.refreshRequested()
            onCopyRequested: card.copyRequested()
        }

        // The keystone. Outside the result region, so no void state reaches it.
        Field {
            id: field
            Layout.fillWidth: true
            mode: card.mode
            cap: card.cap

            // Two-way without fighting: the outside value only lands while the
            // user is not editing, so the caret and the selection survive.
            Binding on text {
                value: card.text
                when: !field.editorFocus
            }

            onTextEdited: function (text) { card.textEdited(text) }
            onSubmitted: function (text) { card.submitted(text) }
        }

        // ---- the result region ------------------------------------------
        // The only part that scrolls (spec §8). The chrome row and the field
        // sit above it, outside the viewport, and stay pinned. The region is
        // content-sized while it fits the screen and clips at scrollMaxHeight
        // beyond it; short content yields no scroll gutter.
        Flickable {
            id: resultScroll

            Layout.fillWidth: true
            implicitHeight: Math.min(resultCol.implicitHeight, card.scrollMaxHeight)
            contentWidth: width
            contentHeight: resultCol.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            ColumnLayout {
                id: resultCol
                width: resultScroll.width
                spacing: 0

                Voids {
                    Layout.fillWidth: true
                    Layout.topMargin: T.space16
                    visible: card.voidsVisible
                    phase: card.voidsVisible ? card.voidPhase : "empty"
                    message: card.errorMessage
                    code: card.errorCode
                    retryAfter: (card.envelope && card.envelope.retry_after !== undefined)
                                ? card.envelope.retry_after : null
                    onRetryRequested: card.retryRequested()
                }

                // ---- word body ------------------------------------------
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.topMargin: T.space16
                    Layout.bottomMargin: card.hasNotes ? 0 : T.space12
                    visible: card.bodyVisible && card.kind === "word"
                    spacing: 0

                    // 8 px: heading to pronunciation/POS. The 4 px left offset
                    // stops this reading as a label for the heading above it.
                    // Only the IPA is monospace (spec §8); the part of speech is
                    // human-facing and stays in the system family. Two Text
                    // items rather than rich text — model output needs no
                    // escaping.
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: card.hasIpaOrPos ? T.space8 : 0
                        Layout.leftMargin: T.space4
                        visible: card.hasIpaOrPos
                        spacing: T.space8

                        Text {
                            id: ipaText
                            visible: card.payload.ipa !== undefined
                                     && card.payload.ipa !== null && card.payload.ipa !== ""
                            text: card.payload.ipa || ""
                            font.pixelSize: T.metaSize
                            font.family: "monospace"
                            color: Kirigami.Theme.disabledTextColor
                            wrapMode: Text.Wrap
                        }

                        Text {
                            id: posText
                            Layout.fillWidth: true
                            visible: card.payload.pos !== undefined
                                     && card.payload.pos !== null && card.payload.pos !== ""
                            text: (ipaText.visible ? "·  " : "") + (card.payload.pos || "")
                            font.pixelSize: T.metaSize
                            color: Kirigami.Theme.disabledTextColor
                            wrapMode: Text.Wrap
                        }
                    }

                    // 16 px: IPA/POS to translation.
                    Text {
                        Layout.fillWidth: true
                        Layout.topMargin: card.hasIpaOrPos ? T.space16 : 0
                        visible: card.hasTranslation
                        text: card.translationText
                        font.pixelSize: T.transSizeWord
                        font.bold: true
                        color: Kirigami.Theme.linkColor
                        wrapMode: Text.Wrap
                    }

                    // 8 px: translation to meaning — one unit, not two lines.
                    Text {
                        Layout.fillWidth: true
                        Layout.topMargin: T.space8
                        visible: card.hasMeaning
                        text: card.payload.meaning || ""
                        font.pixelSize: T.meaningSize
                        color: Kirigami.Theme.textColor
                        wrapMode: Text.Wrap
                    }

                    // 16 px: meaning to examples; 12 px pair to pair.
                    Repeater {
                        model: card.hasExamples ? card.payload.examples : []

                        delegate: RowLayout {
                            id: exampleRow
                            required property int index
                            required property var modelData

                            Layout.fillWidth: true
                            Layout.topMargin: exampleRow.index === 0 ? T.space16 : T.space12
                            spacing: T.space8

                            Text {
                                Layout.preferredWidth: T.space16
                                text: "▸"
                                font.pixelSize: T.exampleSize
                                color: Kirigami.Theme.disabledTextColor
                            }

                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: T.space4

                                Text {
                                    Layout.fillWidth: true
                                    text: exampleRow.modelData.src
                                    font.pixelSize: T.exampleSize
                                    color: Kirigami.Theme.textColor
                                    wrapMode: Text.Wrap
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: exampleRow.modelData.dst
                                    font.pixelSize: T.exampleSize
                                    font.italic: true
                                    color: Kirigami.Theme.disabledTextColor
                                    wrapMode: Text.Wrap
                                }
                            }
                        }
                    }
                }

                // ---- phrase body ----------------------------------------
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.topMargin: T.space12
                    Layout.bottomMargin: card.hasNotes ? 0 : T.space12
                    visible: card.bodyVisible && card.kind === "phrase"
                    spacing: 0

                    // 12 px: the field to the translation in sentence mode.
                    Text {
                        Layout.fillWidth: true
                        visible: card.hasTranslation
                        text: card.translationText
                        font.pixelSize: T.transSizePhrase
                        font.bold: true
                        color: Kirigami.Theme.linkColor
                        wrapMode: Text.Wrap
                    }

                    // 20 px: translation to EXPLANATION.
                    Text {
                        Layout.fillWidth: true
                        Layout.topMargin: T.space20
                        visible: card.hasExplanation
                        text: i18n("EXPLANATION")
                        font.pixelSize: T.chipSize
                        font.bold: true
                        // Typography tracking, not layout spacing — deliberately
                        // not on the §8 4-px scale.
                        font.letterSpacing: 0.6
                        color: Kirigami.Theme.disabledTextColor
                    }

                    // 12 px: heading to first bullet, and bullet to bullet.
                    Repeater {
                        model: card.hasExplanation ? card.payload.explanation : []

                        delegate: RowLayout {
                            id: explanationRow
                            required property int index
                            required property var modelData

                            Layout.fillWidth: true
                            Layout.topMargin: T.space12
                            spacing: T.space8

                            Text {
                                Layout.preferredWidth: T.space16
                                text: "▸"
                                font.pixelSize: T.exampleSize
                                color: Kirigami.Theme.disabledTextColor
                            }

                            Text {
                                Layout.fillWidth: true
                                textFormat: Text.RichText
                                text: (explanationRow.modelData.note || "") === ""
                                      ? "<b>" + T.escape(explanationRow.modelData.term) + "</b>"
                                      : "<b>" + T.escape(explanationRow.modelData.term) + "</b> <font color=\""
                                        + Kirigami.Theme.disabledTextColor + "\">—</font> "
                                        + T.escape(explanationRow.modelData.note)
                                font.pixelSize: T.exampleSize
                                color: Kirigami.Theme.textColor
                                wrapMode: Text.Wrap
                            }
                        }
                    }
                }

                // ---- the quiet last line --------------------------------
                // 24 px: last unit to the rule; 12 px rule to notes; 20 px to
                // the card bottom. The rule never stands above nothing.
                Rectangle {
                    Layout.fillWidth: true
                    Layout.topMargin: T.space24
                    visible: card.hasNotes
                    implicitHeight: 1
                    color: Kirigami.Theme.textColor
                    opacity: 0.15
                }

                Text {
                    Layout.fillWidth: true
                    Layout.topMargin: T.space12
                    Layout.bottomMargin: T.space20
                    visible: card.hasNotes
                    text: card.payload.notes || ""
                    font.pixelSize: T.notesSize
                    color: Kirigami.Theme.disabledTextColor
                    wrapMode: Text.Wrap
                }
            }
        }
    }
}
