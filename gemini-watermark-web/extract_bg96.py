import re

# Read the C++ header file
with open('embedded_assets.hpp', 'r') as f:
    content = f.read()

# Extract bg_96_png array
match = re.search(r'bg_96_png\[\] = \{([^}]+)\}', content, re.DOTALL)
if match:
    hex_str = match.group(1)
    # Parse hex values
    hex_values = re.findall(r'0x([0-9a-fA-F]{2})', hex_str)
    byte_array = bytes([int(h, 16) for h in hex_values])
    
    # Write to file
    with open('public/bg_96.png', 'wb') as f:
        f.write(byte_array)
    print(f'Created bg_96.png ({len(byte_array)} bytes)')
else:
    print('Could not find bg_96_png data')
