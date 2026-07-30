"""Prepare generated cinematic pixel art for the browser.

Usage:
    python tools/process-cine-assets.py <generated-assets-directory>

Backgrounds are reduced to the 640x360 art grid with nearest-neighbour
sampling. Sprite-sheet checkerboards are flood-cleared from the image edges,
then both the cleaned atlases and named frame PNGs are exported.
"""

from collections import deque
from pathlib import Path
import sys

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "cine"
SPRITES = OUT / "sprites"

BACKGROUNDS = {
    "cine-intro-pixel.png": "intro-bg.webp",
    "cine-ask-pixel.png": "ask-bg.webp",
    "cine-yes-pixel.png": "yes-bg.webp",
    "cine-no-pixel.png": "no-bg.webp",
}

HERO_FRAMES = (
    ("hero-idle", "hero-walk-a", "hero-walk-b", "hero-offer", "hero-kneel", "hero-sit"),
    ("companion-idle", "companion-walk-a", "companion-walk-b", "companion-offer", "companion-recoil", "companion-sit"),
)

DRAGON_FRAMES = (
    ("dragon-fly-up", "dragon-fly-down", "dragon-dead", "dragon-dead-far"),
    ("dragon-eye", "dragon-rise", "dragon-roar", "dragon-lunge"),
)

MOTION_ATLASES = (
    (
        "cine-heroes-motion-atlas.png",
        "heroes-motion-atlas.png",
        (
            ("hero-breathe-low", "hero-breathe-high", "hero-walk-contact-a",
             "hero-walk-pass", "hero-walk-contact-b", "hero-offer-anticipate", "hero-offer-settle"),
            ("companion-breathe-low", "companion-breathe-high", "companion-walk-contact-a",
             "companion-walk-pass", "companion-walk-contact-b",
             "companion-offer-anticipate", "companion-offer-settle"),
        ),
    ),
    (
        "cine-heroes-gesture-atlas.png",
        "heroes-gesture-atlas.png",
        (
            ("hero-attentive", "hero-lean", "hero-half-kneel", "hero-full-kneel",
             "hero-kneel-settle", "hero-seated", "hero-recoil"),
            ("companion-attentive", "companion-head-turn", "companion-reach-anticipate",
             "companion-reach", "companion-reach-settle",
             "companion-seated", "companion-recoil-strong"),
        ),
    ),
    (
        "cine-dragon-motion-atlas.png",
        "dragon-motion-atlas.png",
        (
            ("dragon-fly-high", "dragon-fly-descend", "dragon-fly-low",
             "dragon-fly-rise", "dragon-glide", "dragon-bank"),
            ("dragon-wake-eye", "dragon-wake-head", "dragon-wake-half",
             "dragon-wake-anticipate", "dragon-wake-roar", "dragon-wake-lunge"),
        ),
    ),
)


def clear_checkerboard(image: Image.Image) -> Image.Image:
    """Remove a light generated checkerboard connected to the image edges."""
    rgba = image.convert("RGBA")
    px = rgba.load()
    width, height = rgba.size
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def is_background(x: int, y: int) -> bool:
        red, green, blue, _ = px[x, y]
        return min(red, green, blue) > 214 and max(red, green, blue) - min(red, green, blue) < 12

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if seen[index] or not is_background(x, y):
            return
        seen[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        red, green, blue, _ = px[x, y]
        px[x, y] = (red, green, blue, 0)
        if x:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    return rgba


def split_row(image: Image.Image, top: int, bottom: int, expected: int) -> list[Image.Image]:
    """Split an AI atlas row by visible pixel islands instead of assumed cells."""
    alpha = image.getchannel("A")
    occupied = [
        any(alpha.getpixel((x, y)) > 16 for y in range(top, bottom))
        for x in range(image.width)
    ]
    runs: list[list[int]] = []
    start = None
    for x, visible in enumerate((*occupied, False)):
        if visible and start is None:
            start = x
        elif not visible and start is not None:
            runs.append([start, x])
            start = None

    # Detached hair tips, sparks and surprise glyphs can form extra islands.
    # Merge the closest neighbours until one island remains per requested pose.
    while len(runs) > expected:
        index = min(range(len(runs) - 1), key=lambda i: runs[i + 1][0] - runs[i][1])
        runs[index:index + 2] = [[runs[index][0], runs[index + 1][1]]]

    if len(runs) != expected:
        raise ValueError(f"Expected {expected} frames, found {len(runs)} in atlas row")

    frames = []
    for left, right in runs:
        frame = image.crop((max(0, left - 3), top, min(image.width, right + 3), bottom))
        alpha_box = frame.getchannel("A").getbbox()
        if alpha_box:
            frame = frame.crop(alpha_box)
        frames.append(frame)
    return frames


def keep_largest_island(frame: Image.Image) -> Image.Image:
    """Discard neighbouring poses leaking into an uneven generated atlas cell."""
    alpha = frame.getchannel("A")
    width, height = frame.size
    seen = bytearray(width * height)
    islands: list[list[tuple[int, int]]] = []

    for y in range(height):
        for x in range(width):
            index = y * width + x
            if seen[index] or alpha.getpixel((x, y)) <= 16:
                continue
            seen[index] = 1
            queue = deque([(x, y)])
            island = []
            while queue:
                px, py = queue.popleft()
                island.append((px, py))
                for nx, ny in (
                    (px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1),
                    (px - 1, py - 1), (px + 1, py - 1), (px - 1, py + 1), (px + 1, py + 1),
                ):
                    if not (0 <= nx < width and 0 <= ny < height):
                        continue
                    neighbour = ny * width + nx
                    if seen[neighbour] or alpha.getpixel((nx, ny)) <= 16:
                        continue
                    seen[neighbour] = 1
                    queue.append((nx, ny))
            islands.append(island)

    if not islands:
        return frame
    keep = set(max(islands, key=len))
    rgba = frame.copy()
    pixels = rgba.load()
    for y in range(height):
        for x in range(width):
            if (x, y) not in keep:
                red, green, blue, _ = pixels[x, y]
                pixels[x, y] = (red, green, blue, 0)
    box = rgba.getchannel("A").getbbox()
    return rgba.crop(box) if box else rgba


def export_atlas(
    source: Path,
    atlas_name: str,
    names: tuple[tuple[str, ...], ...],
    adaptive: bool = False,
    clean_components: bool = False,
) -> None:
    image = clear_checkerboard(Image.open(source))
    image.save(SPRITES / atlas_name, optimize=True)
    columns = len(names[0])
    rows = len(names)
    cell_height = image.height / rows

    for row, frame_names in enumerate(names):
        top = round(row * cell_height)
        bottom = round((row + 1) * cell_height)
        adaptive_frames = split_row(image, top, bottom, columns) if adaptive else None
        for column, frame_name in enumerate(frame_names):
            if adaptive_frames:
                frame = adaptive_frames[column]
            else:
                cell_width = image.width / columns
                left = round(column * cell_width)
                right = round((column + 1) * cell_width)
                frame = image.crop((left, top, right, bottom))
                alpha_box = frame.getchannel("A").getbbox()
                if alpha_box:
                    frame = frame.crop(alpha_box)
            if clean_components:
                frame = keep_largest_island(frame)
            frame.save(SPRITES / f"{frame_name}.png", optimize=True)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Generated asset directory is required.")

    source_dir = Path(sys.argv[1]).resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    SPRITES.mkdir(parents=True, exist_ok=True)

    for source_name, output_name in BACKGROUNDS.items():
        source = source_dir / source_name
        if not source.exists():
            continue
        image = Image.open(source).convert("RGB")
        image = image.resize((640, 360), Image.Resampling.NEAREST)
        image.save(OUT / output_name, "WEBP", lossless=True, method=6)

    legacy_atlases = (
        ("cine-heroes-atlas.png", "heroes-atlas.png", HERO_FRAMES),
        ("cine-dragon-atlas.png", "dragon-atlas.png", DRAGON_FRAMES),
    )
    for source_name, atlas_name, frames in (*legacy_atlases, *MOTION_ATLASES):
        source = source_dir / source_name
        if source.exists():
            export_atlas(
                source,
                atlas_name,
                frames,
                clean_components=source_name in {item[0] for item in MOTION_ATLASES},
            )
    print(f"Cinematic assets written to {OUT}")


if __name__ == "__main__":
    main()
