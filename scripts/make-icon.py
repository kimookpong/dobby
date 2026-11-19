from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
folder = root / 'assets'
folder.mkdir(exist_ok=True)
image = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((36, 36, 988, 988), radius=220, fill='#101a19')
draw.rounded_rectangle((166, 166, 858, 858), radius=190, fill='#bcf7d4')
draw.rounded_rectangle((266, 341, 758, 673), radius=126, fill='#172d25')
draw.rounded_rectangle((352, 420, 400, 510), radius=24, fill='#bcf7d4')
draw.rounded_rectangle((624, 420, 672, 510), radius=24, fill='#bcf7d4')
draw.arc((456, 478, 568, 574), 5, 175, fill='#bcf7d4', width=18)
draw.polygon([(512, 202), (531, 251), (580, 270), (531, 289), (512, 338), (493, 289), (444, 270), (493, 251)], fill='#172d25')
draw.rounded_rectangle((402, 724, 622, 744), radius=10, fill='#71ae8d')
image.save(folder / 'dobby.png')
image.save(folder / 'dobby.icns')
