import math
import sys

from PIL import Image, ImageChops, ImageOps

INPUT_PATH, OUTPUT_PATH = sys.argv[1:]
BACKGROUND = "#101014"
# Geometry from the default renderer in gh-space-shooter 2.0.5.
PADDING = 40
CELL_PITCH = 15
GRID_ROWS = 7
SHIP_ROW = 10
PIXELS_PER_FRAME = 17
REVEAL_FRAMES = 5
RETURN_FRAME_MS = 40


def recolor(frame):
    return ImageOps.colorize(
        ImageOps.grayscale(frame),
        black=BACKGROUND, mid="#a6112a", white="#ffe9ed",
        blackpoint=24, midpoint=125,
    )


def ship_sprite(frame):
    y = PADDING + SHIP_ROW * CELL_PITCH
    band = frame.crop((0, y - 1, frame.width, y + CELL_PITCH))
    pixels = list(band.get_flattened_data())
    marker = Image.new("L", band.size)
    marker.putdata([255 if b > 135 and b - r > 65 and b - g > 35 else 0
                    for r, g, b in pixels])
    bounds = marker.getbbox()
    if bounds is None or bounds[2] - bounds[0] > 24:
        raise ValueError("Could not identify the Space Shooter sprite")
    left, top, right, bottom = bounds
    box = (max(0, left - 2), y - 1 + top, min(frame.width, right + 2), y - 1 + bottom)
    crop = frame.crop(box)
    mask = Image.new("L", crop.size)
    mask.putdata([min(255, max(0, (b - r - 12) * 2)) for r, _, b in crop.get_flattened_data()])
    return box, recolor(crop), mask


def without_ship(scene, other_scene, box, other_box):
    clean = scene.copy()
    left, top, right, bottom = box
    if right <= other_box[0] or left >= other_box[2]:
        patch = other_scene.crop(box)
    else:
        # Sample nearby sky if the two ship positions overlap.
        offset = right - left + 4
        offset = -offset if right + offset > scene.width else offset
        patch = scene.crop((left + offset, top, right + offset, bottom))
    clean.paste(patch, (left, top))
    return clean


def eased(value):
    return (1 - math.cos(math.pi * max(0, min(1, value)))) / 2


def return_flight(first, last, first_source, last_source):
    start_box, sprite, sprite_mask = ship_sprite(first_source)
    end_box, _, _ = ship_sprite(last_source)
    start_sky = without_ship(first, last, start_box, end_box)
    end_sky = without_ship(last, first, end_box, start_box)
    weeks = (first.width - 2 * PADDING) // CELL_PITCH
    bottom = PADDING + GRID_ROWS * CELL_PITCH

    columns = {}
    for column in range(weeks):
        left = PADDING + column * CELL_PITCH
        box = (left, PADDING, left + CELL_PITCH, bottom)
        before, after = last.crop(box), first.crop(box)
        changed = ImageChops.difference(before, after).convert("L").histogram()
        if sum(changed[20:]) >= 8:
            columns[left + CELL_PITCH / 2] = (box, before, after)

    sprite_center = (sprite.width - 1) / 2
    destination = start_box[0] + sprite_center
    origin = end_box[0] + sprite_center
    waypoints = [origin, destination]
    if columns:
        leftmost, rightmost = min(columns), max(columns)
        candidates = [
            [origin, destination],
            [origin, leftmost, destination],
            [origin, rightmost, destination],
            [origin, leftmost, rightmost, destination],
            [origin, rightmost, leftmost, destination],
        ]
        waypoints = min(
            (path for path in candidates if min(path) <= leftmost and max(path) >= rightmost),
            key=lambda path: sum(abs(b - a) for a, b in zip(path, path[1:])),
        )

    positions = [origin]
    for a, b in zip(waypoints, waypoints[1:]):
        if a == b:
            continue
        steps = max(2, math.ceil(abs(b - a) / PIXELS_PER_FRAME))
        positions.extend(a + (b - a) * eased(step / steps) for step in range(1, steps + 1))
    positions.extend([destination] * REVEAL_FRAMES)

    passed_at = {}
    for index, (previous, current) in enumerate(zip(positions, positions[1:]), 1):
        motion = index / (len(positions) - 1)
        scene = Image.blend(end_sky, start_sky, eased(motion))
        for center, (box, before, after) in columns.items():
            if min(previous, current) <= center <= max(previous, current):
                passed_at.setdefault(center, index)
            progress = (index - passed_at[center] + 1) / REVEAL_FRAMES if center in passed_at else 0
            scene.paste(Image.blend(before, after, eased(progress)), box[:2])

        x = round(current - sprite_center)
        y = round(end_box[1] + (start_box[1] - end_box[1]) * motion - 12 * math.sin(math.pi * motion))
        scene.paste(sprite, (x, y), sprite_mask)
        yield scene

    if len(passed_at) != len(columns):
        raise ValueError("The return flight did not reach every changed column")


with Image.open(INPUT_PATH) as image:
    frames, durations = [], []
    for index in range(image.n_frames):
        image.seek(index)
        frame = image.convert("RGB")
        durations.append(image.info.get("duration", 40))
        frames.append(recolor(frame))
        if index == 0:
            first_source = frame
    last_source = frame

flight = list(return_flight(frames[0], frames[-1], first_source, last_source))
frames[0].save(
    OUTPUT_PATH, save_all=True, append_images=frames[1:] + flight,
    duration=durations + [RETURN_FRAME_MS] * len(flight),
    loop=0, quality=85, method=4,
)

with Image.open(OUTPUT_PATH) as result:
    if not result.is_animated or result.size != frames[0].size:
        raise ValueError("Unexpected animation output")
    print(f"{result.n_frames} frames, {result.width}x{result.height}; {len(flight)} return frames")
