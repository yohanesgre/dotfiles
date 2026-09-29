.pragma library

// The selected text never interpolates into a shell command. The Plasma
// `executable` data engine runs its command through a shell, so text placed in
// the command string is text a shell can execute. Both doors below avoid that:
//
//   typed      -> base64, whose alphabet is [A-Za-z0-9+/=] — no shell
//                 metacharacters are possible.
//   selection  -> the CLI reads the clipboard itself; the text never enters the
//                 widget at all.
//
// Never build a command with the raw text.

// UTF-8 -> base64, so the text can be handed to the CLI as a single argument.
function utf8ToBase64(str) {
    var bytes = []
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i)
        if (c < 0x80) {
            bytes.push(c)
        } else if (c < 0x800) {
            bytes.push(0xC0 | (c >> 6), 0x80 | (c & 63))
        } else if (c >= 0xD800 && c <= 0xDBFF) {
            var lo = str.charCodeAt(++i)
            var cp = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00)
            bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                       0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
        } else {
            bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
        }
    }
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    var out = ""
    for (var j = 0; j < bytes.length; j += 3) {
        var b0 = bytes[j]
        var b1 = bytes[j + 1] || 0
        var b2 = bytes[j + 2] || 0
        var n = (b0 << 16) | (b1 << 8) | b2
        out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63]
        out += (j + 1 < bytes.length) ? alphabet[(n >> 6) & 63] : "="
        out += (j + 2 < bytes.length) ? alphabet[n & 63] : "="
    }
    return out
}

// Command for a typed value. No part of the text appears in this string.
function typedCommand(binary, text) {
    return binary + " lookup --b64 " + utf8ToBase64(text)
}

// Command for the current selection: the CLI reads the clipboard itself, so the
// selection never reaches argv (world-readable in ps) and never reaches a shell.
function selectionCommand(binary) {
    return binary + " lookup --selection"
}
