import sys

from PIL import Image, ImageOps

input_path, output_path = sys.argv[1:]
image = Image.open(input_path)
frames, durations = [], []
for index in range(image.n_frames):
    image.seek(index)
    frame = image.convert("RGB")
    durations.append(image.info.get("duration", 40))
    frames.append(ImageOps.colorize(
        ImageOps.grayscale(frame),
        black="#101014", mid="#a6112a", white="#ffe9ed",
        blackpoint=24, midpoint=125,
    ))
frames[0].save(
    output_path, save_all=True, append_images=frames[1:],
    duration=durations, loop=0, quality=85, method=4,
)
result = Image.open(output_path)
assert result.is_animated and result.n_frames == image.n_frames and result.size == image.size
print(f"{result.n_frames} frames, {result.width}x{result.height}")