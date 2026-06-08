import struct, os

icons_dir = r'f:\Projects\ai-novel-writer\src-tauri\icons'
png_path = os.path.join(icons_dir, 'icon.png')
ico_path = os.path.join(icons_dir, 'icon.ico')

with open(png_path, 'rb') as f:
    png_data = f.read()

# ICO header: reserved(2) + type(2) + count(2)
header = struct.pack('<HHH', 0, 1, 1)
# Directory entry: w, h, colors, reserved, planes, bpp, size, offset
direntry = struct.pack('<BBBBHHII', 32, 32, 0, 0, 1, 32, len(png_data), 22)

with open(ico_path, 'wb') as f:
    f.write(header + direntry + png_data)

print(f'ICO created: {ico_path} ({os.path.getsize(ico_path)} bytes)')
