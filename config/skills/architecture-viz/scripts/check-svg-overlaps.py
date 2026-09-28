#!/usr/bin/env python3
"""Approximate collision checker for hand-authored SVG architecture graphs.

Usage: python3 check-svg-overlaps.py <file.html|file.svg> [svg-index]

When several <svg> elements exist, the checker picks the first one containing a
node group (<g class="n ...">); pass [svg-index] to override.

Conventions it assumes (the architecture-viz template — see
references/layout-rules.md "Checker contract"):
  - node groups:   <g class="n ..."> with a direct <rect width height>, translate(x,y)
  - edges:         <path class="edge ..."> using absolute M/H/V/L/Z only
  - edge labels:   <text class="elabel ..."> with x/y or translate(...) [rotate(-90)]
  - label metrics: mono 11px (CHAR_W 6.6, ascent 8.5, descent 2.5)

Ancestor transforms are not composed: a node group, edge path, or edge label
nested under a transformed <g>/<svg> is a parse error instead of being measured
at untransformed coordinates (which would print a silent false clean). Edge
labels must use x/y or translate(...), never both.

Checks:
  1. edge labels overlapping node rects
  2. edge labels crossing path segments
  3. edge labels overlapping each other
  4. path endpoints (both ends of every subpath) that do not land on a node edge
  5. node text lines wider than their own boxes
  6. edge segments crossing node box interiors (rectangle-span test; endpoints
     merely touching a box edge do not count)

Path data is tokenized directly, so compact syntax (e.g. `M400,120H900,300`) and
repeated coordinates parse without a normalization pass; absolute M/H/V/L/Z are
supported, including diagonal L segments and implicit commands. Any other
command (C/S/Q/T/A, lowercase relative) is a parse error, never silently
skipped.

Exit codes:
  0 = clean, 1 = findings, 2 = usage or parse error.

Treat as a lint: text widths are approximate.
"""
import re
import sys
import xml.etree.ElementTree as ET

CHAR_W = 6.6          # mono 11px average advance
ASCENT, DESCENT = 8.5, 2.5
TITLE_W = 7.8         # bold 14px system-ui average advance
SUB_W = 6.6           # mono 11px

PATH_TOK_RE = re.compile(r"[A-Za-z]|-?(?:\d+(?:\.\d+)?|\.\d+)")
TRANS_RE = re.compile(r"translate\(\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*\)(.*)")
ROT_RE = re.compile(r"^\s*rotate\(\s*(-?[\d.]+)\s*\)\s*$")
NODE_TRANS_RE = re.compile(r"translate\(\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*\)$")


class ParseError(Exception):
    """Raised for malformed input; reported as a readable message + exit 2."""


def _is_node_class(cls):
    return cls == "n" or cls.startswith("n ")


def load_svg(path, index=None):
    raw = open(path, encoding="utf-8").read()
    svgs = re.findall(r"<svg\b.*?</svg>", raw, re.S)
    if not svgs:
        raise ParseError("no <svg> element found")
    if index is not None:
        if index >= len(svgs):
            raise ParseError(f"svg-index {index} out of range (found {len(svgs)})")
        chosen = index
    else:
        chosen = 0
        for i, s in enumerate(svgs):
            try:
                el = ET.fromstring(s)
            except ET.ParseError:
                continue
            if any(_is_node_class(g.get("class", "")) for g in el.iter("g")):
                chosen = i
                break
    try:
        return ET.fromstring(svgs[chosen]), chosen
    except ET.ParseError as e:
        raise ParseError(f"could not parse <svg> #{chosen}: {e}")


def ancestor_transforms(svg):
    """Map each element to True when a strict ancestor carries a transform.

    The checker never composes ancestor transforms, so elements under a
    transformed group would be measured at the wrong coordinates; callers
    reject those instead of reporting a false clean.
    """
    out = {}
    stack = [(svg, False)]
    while stack:
        elem, inherited = stack.pop()
        out[elem] = inherited
        child_inherited = inherited or bool((elem.get("transform") or "").strip())
        for child in elem:
            stack.append((child, child_inherited))
    return out


def node_rects(svg):
    out = []
    anc = ancestor_transforms(svg)
    for g in svg.iter("g"):
        cls = g.get("class", "")
        if not _is_node_class(cls):
            continue
        if anc.get(g):
            raise ParseError(
                f'node group class="{cls}" has a transformed ancestor; '
                f"the checker does not compose ancestor transforms"
            )
        m = NODE_TRANS_RE.match((g.get("transform") or "").strip())
        if not m:
            raise ParseError(
                f'node group class="{cls}" has no translate(x,y) transform '
                f'(got {g.get("transform")!r})'
            )
        try:
            x0, y0 = float(m.group(1)), float(m.group(2))
        except ValueError:
            raise ParseError(
                f'node group class="{cls}" has a non-numeric translate '
                f"({m.group(1)!r},{m.group(2)!r})"
            )
        r = g.find("rect")
        if r is None:
            raise ParseError(f'node group class="{cls}" has no direct <rect>')
        if r.get("width") is None or r.get("height") is None:
            raise ParseError(f'node <rect> under class="{cls}" is missing width/height')
        try:
            w, h = float(r.get("width")), float(r.get("height"))
        except ValueError:
            raise ParseError(f'node <rect> under class="{cls}" has non-numeric width/height')
        t = g.find("text")
        name = (t.text or "").strip() if t is not None else "?"
        out.append((name, x0, y0, x0 + w, y0 + h))
    return out


def parse_path(d, where):
    """Return (segments, endpoints) for an absolute M/H/V/L/Z path.

    Segments are reset at every new M so subpaths never produce a phantom
    segment. Endpoints lists the start and terminal point of every subpath.
    """
    toks = PATH_TOK_RE.findall(d)
    segs, ends = [], []
    i, n = 0, len(toks)
    cmd = None
    cur = start = None
    started = False
    while i < n:
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd in ("Z", "z"):
                if cur is None:
                    raise ParseError(f"{where}: 'Z' before any moveto")
                if cur != start:
                    segs.append((cur, start))
                cur = start
                ends.append(cur)
                cmd = None
                continue
            if cmd not in ("M", "H", "V", "L"):
                kind = "relative" if cmd.islower() else "unsupported"
                raise ParseError(
                    f"{where}: {kind} path command {cmd!r} (only absolute M/H/V/L/Z supported)"
                )
            if not started and cmd != "M":
                raise ParseError(f"{where}: path starts with {cmd!r}, expected 'M'")
            continue
        if cmd is None:
            raise ParseError(f"{where}: coordinate {t!r} before any command")
        need = {"M": 2, "H": 1, "V": 1, "L": 2}[cmd]
        args = []
        for _ in range(need):
            if i >= n or toks[i].isalpha():
                raise ParseError(f"{where}: truncated {cmd!r} (expected {need} number(s))")
            try:
                args.append(float(toks[i]))
            except ValueError:
                raise ParseError(f"{where}: invalid number {toks[i]!r}")
            i += 1
        prev = cur
        if cmd == "M":
            if prev is not None:
                ends.append(prev)  # terminal of the subpath being left
            cur = start = (args[0], args[1])
            started = True
            ends.append(cur)
            cmd = "L"  # SVG: coordinate pairs after moveto are implicit lineto
        elif cmd == "H":
            cur = (args[0], cur[1])
            segs.append((prev, cur))
        elif cmd == "V":
            cur = (cur[0], args[0])
            segs.append((prev, cur))
        else:
            cur = (args[0], args[1])
            segs.append((prev, cur))
    if cur is not None:
        ends.append(cur)
    return segs, list(dict.fromkeys(ends))


def edges(svg):
    segs, ends = [], []
    anc = ancestor_transforms(svg)
    for i, p in enumerate(svg.iter("path")):
        if "edge" not in p.get("class", "").split():
            continue
        if anc.get(p):
            raise ParseError(
                f"path.edge #{i} has a transformed ancestor; "
                f"the checker does not compose ancestor transforms"
            )
        if (p.get("transform") or "").strip():
            raise ParseError(
                f"path.edge #{i} must not carry a transform (edge geometry comes from d only)"
            )
        d = p.get("d")
        if not d:
            raise ParseError(f"path.edge #{i} has no d attribute")
        s, e = parse_path(d, f'path.edge #{i} (d="{d}")')
        segs.extend(s)
        ends.extend(e)
    return segs, ends


def parse_label_transform(t, where):
    tr = (t.get("transform") or "").strip()
    if not tr:
        return None
    m = TRANS_RE.match(tr)
    if not m:
        raise ParseError(
            f"{where}: unsupported transform {tr!r} (only translate(x,y) [rotate(-90)])"
        )
    try:
        x, y = float(m.group(1)), float(m.group(2))
    except ValueError:
        raise ParseError(
            f"{where}: non-numeric translate coordinates ({m.group(1)!r},{m.group(2)!r})"
        )
    rest = m.group(3).strip()
    rot = 0.0
    if rest:
        r = ROT_RE.match(rest)
        if not r:
            raise ParseError(f"{where}: unsupported transform suffix {rest!r}")
        try:
            rot = float(r.group(1))
        except ValueError:
            raise ParseError(f"{where}: non-numeric rotate angle {r.group(1)!r}")
    return x, y, rot


def labels(svg):
    out = []
    anc = ancestor_transforms(svg)
    for i, t in enumerate(svg.iter("text")):
        if "elabel" not in t.get("class", "").split():
            continue
        txt = "".join(t.itertext()).strip()
        where = f'text.elabel #{i} "{txt}"'
        if anc.get(t):
            raise ParseError(
                f"{where}: has a transformed ancestor; "
                f"the checker does not compose ancestor transforms"
            )
        anchor = t.get("text-anchor", "start")
        if anchor not in ("start", "middle", "end"):
            raise ParseError(f"{where}: unsupported text-anchor {anchor!r}")
        w = len(txt) * CHAR_W
        tr = parse_label_transform(t, where)
        if tr is not None:
            if t.get("x") is not None or t.get("y") is not None:
                raise ParseError(
                    f"{where}: has both a transform and x/y attributes; use one placement only"
                )
            x0, y0, rot = tr
            if rot == -90:
                if anchor == "middle":
                    ya, yb = y0 - w / 2, y0 + w / 2
                elif anchor == "start":
                    ya, yb = y0 - w, y0
                else:
                    ya, yb = y0, y0 + w
                box = (x0 - ASCENT, ya, x0 + DESCENT, yb)
            elif rot == 90:
                if anchor == "middle":
                    ya, yb = y0 - w / 2, y0 + w / 2
                elif anchor == "start":
                    ya, yb = y0, y0 + w
                else:
                    ya, yb = y0 - w, y0
                box = (x0 - DESCENT, ya, x0 + ASCENT, yb)
            elif rot == 0:
                x0b = x0 - w / 2 if anchor == "middle" else (x0 - w if anchor == "end" else x0)
                box = (x0b, y0 - ASCENT, x0b + w, y0 + DESCENT)
            else:
                raise ParseError(f"{where}: unsupported rotate({rot})")
        else:
            xs, ys = t.get("x"), t.get("y")
            if xs is None or ys is None:
                raise ParseError(f"{where}: needs x/y attributes or a translate(...) transform")
            try:
                x, y = float(xs), float(ys)
            except ValueError:
                raise ParseError(f"{where}: non-numeric x/y {xs!r},{ys!r}")
            x0 = x - w / 2 if anchor == "middle" else (x - w if anchor == "end" else x)
            box = (x0, y - ASCENT, x0 + w, y + DESCENT)
        out.append((txt, *box))
    return out


def overlap(a, b, pad=2.0):
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


def _clip(seg, box):
    """Liang-Barsky clip of segment against box; returns (t0, t1) or None."""
    (x1, y1), (x2, y2) = seg
    bx0, by0, bx1, by1 = box
    dx, dy = x2 - x1, y2 - y1
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x1 - bx0), (dx, bx1 - x1), (-dy, y1 - by0), (dy, by1 - y1)):
        if p == 0:
            if q < 0:
                return None
            continue
        t = q / p
        if p < 0:
            if t > t1:
                return None
            t0 = max(t0, t)
        else:
            if t < t0:
                return None
            t1 = min(t1, t)
    if t0 > t1:
        return None
    return t0, t1


def seg_through_box(seg, box, pad=3.0):
    """True if the segment crosses a label box expanded by pad (any geometry)."""
    expanded = (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)
    return _clip(seg, expanded) is not None


def seg_crosses_interior(seg, box, eps=0.5):
    """True if the segment penetrates a node box interior by more than eps.

    Endpoints landing on the box boundary (edges) do not count.
    """
    shrunk = (box[0] + eps, box[1] + eps, box[2] - eps, box[3] - eps)
    if shrunk[0] >= shrunk[2] or shrunk[1] >= shrunk[3]:
        return False
    r = _clip(seg, shrunk)
    return r is not None and (r[1] - r[0]) > 1e-9


def on_rect_edge(pt, rect, tol=2.0):
    _, x0, y0, x1, y1 = rect
    x, y = pt
    on_v = (abs(x - x0) <= tol or abs(x - x1) <= tol) and y0 - tol <= y <= y1 + tol
    on_h = (abs(y - y0) <= tol or abs(y - y1) <= tol) and x0 - tol <= x <= x1 + tol
    return on_v or on_h


def main():
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        sys.stderr.write("usage: check-svg-overlaps.py <file.html|file.svg> [svg-index]\n")
        sys.exit(2)
    path = sys.argv[1]
    index = None
    if len(sys.argv) > 2:
        try:
            index = int(sys.argv[2])
        except ValueError:
            index = -1
        if index < 0:
            sys.stderr.write(
                f"check-svg-overlaps: svg-index must be a non-negative integer, got {sys.argv[2]!r}\n"
            )
            sys.exit(2)

    try:
        svg, used = load_svg(path, index)
        rects = node_rects(svg)
        segs, ends = edges(svg)
        labs = labels(svg)
    except ParseError as e:
        sys.stderr.write(f"check-svg-overlaps: parse error: {e}\n")
        sys.exit(2)
    except OSError as e:
        sys.stderr.write(f"check-svg-overlaps: cannot read {path}: {e}\n")
        sys.exit(2)

    if not rects:
        sys.stderr.write(
            f"check-svg-overlaps: parse error: no node groups (g.n with translate + direct <rect>) in {path}\n"
        )
        sys.exit(2)
    if not labs:
        sys.stderr.write(
            f"check-svg-overlaps: parse error: no edge labels (text.elabel) in {path} — renamed or missing class?\n"
        )
        sys.exit(2)
    if not segs:
        sys.stderr.write(
            f"check-svg-overlaps: parse error: no edge segments (path.edge with d) in {path}\n"
        )
        sys.exit(2)

    findings = []

    for txt, *box in labs:
        for name, *r in rects:
            if overlap(box, r):
                findings.append(f'label "{txt}" {box} overlaps node {name} {r}')
        for s in segs:
            if seg_through_box(s, box):
                findings.append(f'label "{txt}" {box} crosses line {s}')
    for i in range(len(labs)):
        for j in range(i + 1, len(labs)):
            if overlap(labs[i][1:], labs[j][1:]):
                findings.append(f'label "{labs[i][0]}" overlaps label "{labs[j][0]}"')
    for pt in ends:
        if not any(on_rect_edge(pt, r) for r in rects):
            findings.append(f"arrow endpoint {pt} does not land on a node edge")
    for s in segs:
        for name, *r in rects:
            if seg_crosses_interior(s, r):
                findings.append(f"edge segment {s[0]}->{s[1]} crosses node {name} {r}")

    for g in svg.iter("g"):
        if not _is_node_class(g.get("class", "")):
            continue
        r = g.find("rect")
        w = float(r.get("width"))
        for t in g.findall("text"):
            txt = "".join(t.itertext())
            x = float(t.get("x", 0))
            cw = TITLE_W if t.get("class") == "t" else SUB_W
            need = x + len(txt) * cw
            if need > w - 8:
                findings.append(f'text "{txt}" needs ~{need:.0f}px > box width {w:.0f}px')

    if findings:
        print(f"{len(findings)} finding(s) in {path} (svg #{used}):")
        for f in findings:
            print("  -", f)
        sys.exit(1)
    print(
        f"clean: {path} (svg #{used}): {len(rects)} nodes, {len(segs)} edges, {len(labs)} labels"
    )


if __name__ == "__main__":
    main()
