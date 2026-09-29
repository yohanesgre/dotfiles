import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.plasma5support as Plasma5Support
import "../code/run.js" as Run

// The applet. The widget renders one JSON envelope and nothing else: it writes
// the selection (or the typed text) to the CLI, parses the single envelope the
// CLI prints on stdout, and hands it to Card.
PlasmoidItem {
    id: root

    // On PATH via the Nix module (W3). One config lives in
    // ~/.config/gloss/config.toml, not here — the widget has none of its own.
    property string binary: "gloss"

    property var envelope: ({})
    // "empty" | "loading" | "ready". Named `phase`, not `state`: `state` is a
    // QQuickItem property and using it here would shadow the item state machine.
    property string phase: "empty"
    property string source: "auto"
    property string target: "id"
    property string fieldText: ""
    // A recorded envelope was rendered. The popup-open lookup is suppressed so
    // the GLOSS_FIXTURE door keeps its card (the fixture is a dev render path,
    // not a live one).
    property bool fixtureAccepted: false

    // Fixture door (deferred acceptance item): when GLOSS_FIXTURE names a
    // recorded envelope on disk, the widget renders it through the same Card
    // path, with no API key and no CLI. The command is a constant string — the
    // data engine runs it in a shell, and that shell expands its own
    // environment, so nothing read here is interpolated into the command.
    // Unset or empty: cat writes nothing, no envelope is accepted, and the
    // live path is untouched.
    readonly property string fixtureSource: "cat \"$GLOSS_FIXTURE\""

    readonly property string translation: {
        var e = root.envelope
        if (!e || (e.kind !== "word" && e.kind !== "phrase"))
            return ""
        return (e.payload && e.payload.translation) ? e.payload.translation : ""
    }

    // ---- the two doors ---------------------------------------------------

    // The hotkey path. The CLI reads the primary selection itself, so the text
    // never enters the widget and never becomes part of a shell command. Called
    // when the popup expands (below).
    function lookUpSelection() {
        root.phase = "loading"
        root.run(Run.selectionCommand(root.binary))
    }

    // The typed path. Base64 only — no shell metacharacter can survive it.
    // `refresh` is the deliberate cache bypass; a normal lookup leaves it false,
    // so a warm cache still serves instantly.
    function lookUpTyped(text, refresh) {
        if (text === undefined || text === null || String(text).trim() === "")
            return
        root.fieldText = String(text)
        root.phase = "loading"
        root.run(Run.typedCommand(root.binary, String(text), refresh === true))
    }

    function relook() {
        if (root.fieldText.trim() !== "")
            root.lookUpTyped(root.fieldText)
    }

    function swap() {
        var previous = root.source
        root.source = root.target
        root.target = (previous === "auto") ? "id" : previous
        root.relook()
    }

    function run(command) {
        exec.disconnectSource(command)
        exec.connectSource(command)
    }

    // The fixture read, once at startup. Same DataSource, same Card path as a
    // live result — the fixture exercises the real renderer.
    function loadFixture() {
        exec.connectSource(root.fixtureSource)
    }

    function acceptFixture(data) {
        // Empty stdout means GLOSS_FIXTURE is unset or its file is unreachable;
        // leave phase and envelope exactly as they were.
        if ((data.stdout || "").trim() === "")
            return
        root.fixtureAccepted = true
        root.accept(root.fixtureSource, data)
    }

    // The shell turns the global shortcut (and keyboard activation) into
    // Plasmoid.activated(), which expands the popup; the shortcut cannot be bound
    // to code, so the selection is translated when the popup opens — the same
    // toggle the panel icon performs. A rendered fixture is left alone.
    onExpandedChanged: {
        if (root.expanded && !root.fixtureAccepted)
            root.lookUpSelection()
    }

    // The global shortcut default. plasma-desktop's AppletConfiguration.qml
    // injects a "Keyboard Shortcuts" page (ConfigurationShortcuts.qml) into every
    // applet's config dialog; it writes this same property. Applied only while the
    // property is empty, so a sequence the user picked is never overwritten. Set
    // imperatively: a property binding on the attached Plasmoid is not available
    // while the applet is being built.
    Component.onCompleted: {
        if (!Plasmoid.globalShortcut)
            Plasmoid.globalShortcut = "Meta+Ctrl+G"
        root.loadFixture()
    }

    // One envelope. No exit codes, no stderr, no partial objects: a parse
    // failure keeps the last card rather than blanking the field or the result.
    function accept(sourceName, data) {
        exec.disconnectSource(sourceName)
        root.phase = "ready"
        var out = (data.stdout || "").trim()
        if (out === "")
            return
        var parsed
        try {
            parsed = JSON.parse(out)
        } catch (e) {
            return
        }
        root.envelope = parsed
        // The field is a local echo, never re-set from the payload. On the
        // selection path the widget never saw the text, so the CLI's echo of
        // what it read is the only place the headword can come from.
        if (root.fieldText.trim() === "" && parsed.query && parsed.query.text)
            root.fieldText = parsed.query.text
    }

    function copyTranslation() {
        if (root.translation !== "")
            clipper.copyText(root.translation)
    }

    // The clipboard, in-process: no shell, and the translation never becomes a
    // command argument. At root scope so copyTranslation() can reach it — an
    // id inside a representation is not visible from the applet, and the
    // representations are assigned by plasmashell, not by this file.
    TextEdit {
        id: clipper
        width: 0
        height: 0
        visible: false
        readOnly: true

        function copyText(value) {
            clipper.text = value
            clipper.selectAll()
            clipper.copy()
        }
    }

    compactRepresentation: PlasmaComponents.ToolButton {
        id: compactButton
        icon.name: "accessories-dictionary"
        onClicked: root.expanded = !root.expanded

        HoverHandler { id: compactHover }

        PlasmaComponents.ToolTip {
            enabled: false
            text: i18n("gloss — EN↔ID lookup (Meta+Ctrl+G)")
            visible: compactHover.hovered
        }
    }

    fullRepresentation: Item {
        Layout.minimumWidth: 380
        Layout.preferredWidth: 400
        Layout.maximumWidth: 420
        Layout.minimumHeight: card.implicitHeight
        Layout.preferredHeight: card.implicitHeight

        Card {
            id: card
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            envelope: root.envelope
            phase: root.phase
            source: root.source
            target: root.target
            text: root.fieldText
            onTextEdited: function (text) { root.fieldText = text }
            onSubmitted: function (text) { root.lookUpTyped(text) }
            // A hand-picked language: the applet owns source/target, Card only
            // reports the choice. `onSourceChanged`/`onTargetChanged` would be
            // no-arg property-change handlers and would read `code` as undefined.
            onLanguageChosen: function (which, code) {
                if (which === "target")
                    root.target = code
                else
                    root.source = code
                root.relook()
            }
            onSwapRequested: root.swap()
            // Refresh re-rolls: it must bypass the cache for the same text.
            onRefreshRequested: root.lookUpTyped(root.fieldText, true)
            onCopyRequested: root.copyTranslation()
            // Retry is deliberately a plain re-run: errors are never cached, so
            // there is nothing to bypass — and `--refresh` here would be a no-op
            // that only muddies the difference between the two controls.
            onRetryRequested: root.lookUpTyped(root.fieldText)
        }
    }

    Plasma5Support.DataSource {
        id: exec
        engine: "executable"

        onNewData: function (sourceName, data) {
            if (sourceName === root.fixtureSource)
                root.acceptFixture(data)
            else
                root.accept(sourceName, data)
        }
    }
}
