#!/usr/bin/env python3
# Version: 1.0.1

import os
import sys
import signal
import struct
import fcntl
import termios
import subprocess
import base64


def get_controlling_tty():
    """Find the controlling TTY by walking up the process tree.
    
    Returns (tty_path, tty_pid) where tty_pid is the PID of the process
    attached to the TTY (useful for sending SIGWINCH to trigger a redraw).
    """
    current_pid = os.getpid()
    
    while current_pid > 1:
        result = subprocess.run(
            ['ps', '-o', 'ppid=', '-p', str(current_pid)],
            capture_output=True, text=True
        )
        parent_pid = int(result.stdout.strip()) if result.stdout.strip() else 0
        
        if parent_pid == 0:
            break
        
        result = subprocess.run(
            ['ps', '-o', 'tty=', '-p', str(parent_pid)],
            capture_output=True, text=True
        )
        tty = result.stdout.strip()
        
        if tty and tty != '??':
            return f'/dev/{tty}', parent_pid
        
        current_pid = parent_pid
    
    return None, None


def get_window_size(tty_path):
    """Get terminal window size using ioctl on the TTY device."""
    if not tty_path or not os.path.exists(tty_path):
        return None
    
    try:
        fd = os.open(tty_path, os.O_RDWR)
        ws = fcntl.ioctl(fd, termios.TIOCGWINSZ, '12345678')
        rows, cols, xp, yp = struct.unpack('HHHH', ws)
        os.close(fd)
        
        if cols > 0 and rows > 0:
            return {'cols': cols, 'rows': rows, 'xpixel': xp, 'ypixel': yp}
    except (OSError, IOError):
        pass
    
    return None


def is_kitty():
    """Check if running in kitty terminal."""
    return os.environ.get('KITTY_WINDOW_ID') is not None


def get_png_dimensions(png_path):
    """Read width and height from a PNG file header."""
    with open(png_path, 'rb') as f:
        sig = f.read(8)
        if sig != b'\x89PNG\r\n\x1a\n':
            return None, None
        f.read(4)  # IHDR chunk length
        f.read(4)  # 'IHDR'
        width = struct.unpack('>I', f.read(4))[0]
        height = struct.unpack('>I', f.read(4))[0]
    return width, height


def send_image(tty_fd, image_path, img_cols, img_rows, col_offset, row_offset):
    """Send image using kitty graphics protocol, positioned at the given cell offset."""
    with open(image_path, 'rb') as f:
        image_data = f.read()

    b64_data = base64.b64encode(image_data).decode('utf-8')
    chunk_size = 4096
    chunks = [b64_data[i:i + chunk_size] for i in range(0, len(b64_data), chunk_size)]

    # Save cursor, move to image position, send image, restore cursor.
    os.write(tty_fd, b"\033[s")
    os.write(tty_fd, f"\033[{row_offset + 1};{col_offset + 1}H".encode('utf-8'))

    for idx, chunk in enumerate(chunks):
        is_first = idx == 0
        is_last = idx == len(chunks) - 1
        more = 0 if is_last else 1

        if is_first:
            # c= and r= together tell kitty the exact cell rectangle to fill.
            # q=2 suppresses kitty's acknowledgment response, which would otherwise
            # appear as "_Gi=1;OK" in the terminal and be consumed as a keypress.
            seq = f"\033_Ga=T,f=100,q=2,i=1,c={img_cols},r={img_rows},m={more};{chunk}\033\\"
        else:
            seq = f"\033_Gm={more};{chunk}\033\\"

        os.write(tty_fd, seq.encode('utf-8'))

    # Restore cursor to where it was before we moved it.
    os.write(tty_fd, b"\033[u")


def delete_image(tty_fd, image_id=1):
    """Delete a displayed image by id."""
    os.write(tty_fd, f"\033_Ga=d,d=i,i={image_id}\033\\".encode('utf-8'))


def do_dismiss():
    """Delete the displayed image and trigger a terminal redraw."""
    if not is_kitty():
        print("Error: This tool requires the kitty terminal.", file=sys.stderr)
        sys.exit(1)

    tty_path, tty_pid = get_controlling_tty()
    if not tty_path:
        print("Error: Could not determine controlling terminal.", file=sys.stderr)
        sys.exit(1)

    tty_fd = os.open(tty_path, os.O_RDWR)
    delete_image(tty_fd, image_id=1)
    os.close(tty_fd)

    if tty_pid:
        os.kill(tty_pid, signal.SIGWINCH)




def do_display(image_path):
    """Display an image using the kitty graphics protocol."""
    if not is_kitty():
        print("Error: This tool requires the kitty terminal to display images.", file=sys.stderr)
        print("Please run this command in a kitty terminal.", file=sys.stderr)
        sys.exit(1)

    tty_path, tty_pid = get_controlling_tty()
    if not tty_path:
        print("Error: Could not determine controlling terminal.", file=sys.stderr)
        sys.exit(1)

    size = get_window_size(tty_path)
    if not size:
        print(f"Error: Could not get window size for {tty_path}.", file=sys.stderr)
        sys.exit(1)

    term_cols = size['cols']
    term_rows = size['rows']

    avail_cols = term_cols - 2
    avail_rows = term_rows - 10

    img_w, img_h = get_png_dimensions(image_path)
    if img_w and img_h and img_h > 0:
        img_aspect = img_w / img_h
        cell_aspect = (size['xpixel'] / term_cols) / (size['ypixel'] / term_rows)
        img_aspect_cells = img_aspect / cell_aspect

        if img_aspect_cells >= avail_cols / avail_rows:
            img_cols = avail_cols
            img_rows = max(1, round(img_cols / img_aspect_cells))
        else:
            img_rows = avail_rows
            img_cols = max(1, round(img_rows * img_aspect_cells))
    else:
        img_cols = avail_cols
        img_rows = avail_rows

    col_offset = (term_cols - img_cols) // 2
    row_offset = 1 + (avail_rows - img_rows) // 2

    tty_fd = os.open(tty_path, os.O_RDWR)
    send_image(tty_fd, image_path, img_cols, img_rows, col_offset, row_offset)
    os.close(tty_fd)


def main():
    if len(sys.argv) < 2:
        print("Usage: image.py <image_path>|--dismiss", file=sys.stderr)
        sys.exit(1)

    if sys.argv[1] == '--dismiss':
        do_dismiss()
    else:
        image_path = sys.argv[1]
        if not os.path.isfile(image_path):
            print(f"Error: File not found: {image_path}", file=sys.stderr)
            sys.exit(1)
        do_display(image_path)


if __name__ == '__main__':
    main()
