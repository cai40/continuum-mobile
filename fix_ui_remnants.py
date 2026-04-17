import re

file_path = r'c:\Users\cai40\.gemini\antigravity\scratch\continuum\continuum-mobile\App.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the specific dark view container and its internal E5E5E5 (which used to be white)
pattern = r"backgroundColor: '#000', padding: 12, borderRadius: 10, marginBottom: 16, borderWidth: 0.5, borderColor: '#333'"
replacement = r"backgroundColor: '#F2F2F7', padding: 12, borderRadius: 10, marginBottom: 16, borderWidth: 0.5, borderColor: '#E5E5E5'"
content = content.replace(pattern, replacement)

# Replace the text colors within that block
content = content.replace("color: '#E5E5E5', fontSize: 11", "color: '#000000', fontSize: 11")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Surgical UI Fix Complete.")
