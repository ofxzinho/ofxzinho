import math
import sys

from PIL import Image, ImageOps

input_path, output_path = sys.argv[1:]
background_color = "#101014"
fade_frames = 10
fade_frame_ms = 40

with Image.open(input_path) as image:
    frames, durations = [], []
    for index in range(image.n_frames):
        image.seek(index)
        frame = image.convert("RGB")
        durations.append(image.info.get("duration", 40))
        frames.append(ImageOps.colorize(
            ImageOps.grayscale(frame),
            black=background_color, mid="#a6112a", white="#ffe9ed",
            blackpoint=24, midpoint=125,
        ))

background = Image.new("RGB", frames[0].size, background_color)


def fade_in(frame):
    return [
        Image.blend(background, frame, (1 - math.cos(math.pi * step / fade_frames)) / 2)
        for step in range(1, fade_frames)
    ]


# Put the transition across the loop boundary so it also fades in on first view.
loop_frames = [background, *fade_in(frames[0]), *frames, *reversed(fade_in(frames[-1]))]
loop_durations = [fade_frame_ms] * fade_frames + durations + [fade_frame_ms] * (fade_frames - 1)
loop_frames[0].save(
    output_path, save_all=True, append_images=loop_frames[1:],
    duration=loop_durations, loop=0, quality=85, method=4,
)

with Image.open(output_path) as result:
    assert result.is_animated and result.size == background.size
    assert result.n_frames >= len(frames), "Unexpected animation output"
    print(f"{result.n_frames} frames, {result.width}x{result.height}")
