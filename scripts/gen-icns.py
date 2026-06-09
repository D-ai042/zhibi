import struct, os

icons_dir = r'f:\Projects\ai-novel-writer\src-tauri\icons'
png_path = os.path.join(icons_dir, 'icon.png')
icns_path = os.path.join(icons_dir, 'icon.icns')

with open(png_path, 'rb') as f:
    png_data = f.read()

# ICNS format: magic + total_size + entries
# Each entry: icon_type(4) + entry_size(4) + data
icon_type = b'ic07'  # 128x128 PNG
entry_size = 8 + len(png_data)  # type(4) + size(4) + data
total_size = 8 + entry_size     # magic(4) + total_size(4) + entries

with open(icns_path, 'wb') as f:
    f.write(b'icns')
    f.write(struct.pack('>I', total_size))
    f.write(icon_type)
    f.write(struct.pack('>I', entry_size))
    f.write(png_data)

print(f'ICNS created: {icns_path} ({os.path.getsize(icns_path)} bytes)')
