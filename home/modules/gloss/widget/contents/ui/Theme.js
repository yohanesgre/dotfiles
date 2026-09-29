.pragma library

// One 4-px scale, and only these values (spec §8). No number outside this set
// appears anywhere in the card.
var space4 = 4
var space8 = 8
var space12 = 12
var space16 = 16
var space20 = 20
var space24 = 24
var space28 = 28

// Card geometry.
var pad = 18
var radiusCard = 6
var radiusInput = 4
var radiusPill = 999
var widthMin = 380
var widthPreferred = 400
var widthMax = 420

// Type scale (spec §8).
var headSize = 22
var transSizeWord = 18
var transSizePhrase = 17
var meaningSize = 14
var metaSize = 13
var exampleSize = 13.5
var notesSize = 13
var chipSize = 11.5
var pillSize = 11

// Mirrors the CLI's `cap` in ~/.config/gloss/config.toml (config.rs). The CLI
// is authoritative — it refuses over-cap input itself — so this is only the
// UI's echo of that value. If config.toml changes and this does not, the
// widget can refuse locally at a stale number.
var cap = 1000

// The field's counter appears from this many graphemes on, so the number is
// there before the cap can be reached.
var counterFrom = 100

// Retryable = worth sending the identical request again. The other six codes
// build no Retry control at all (absent, not disabled).
function retryable(code) {
    return code === "rate_limited"
        || code === "timeout"
        || code === "network"
        || code === "upstream"
        || code === "bad_output"
}

// Model text is rendered, never interpreted — escaping keeps a `<` in a term or
// note from becoming markup when it lands in a RichText bullet.
function escape(s) {
    return String(s === undefined || s === null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}
