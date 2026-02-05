#!/bin/bash
APP_NAME="Allivision"
APP_PATH="$HOME/Desktop/$APP_NAME.app"
ICON_URL="https://cdn-icons-png.flaticon.com/512/3208/3208696.png" # Icono de TV futurista
WEB_URL="https://hjalmarmeza.github.io/Allivision/" # URL de GitHub Pages (Asumiendo que lo subirás)
TEMP_DIR=$(mktemp -d)

# Si no está subido, usaremos localhost o una ruta local para el script, 
# pero idealmente debería ser una URL pública.
# De momento, configurémoslo para abrir el index.html local para pruebas inmediatas si prefieres,
# o la URL de GitHub si planeas subirlo ya.
# Voy a usar una ruta local absoluta para que funcione YA MISMO sin internet.
LOCAL_PATH="file:///Users/hjalmarmeza/Downloads/Antigravity/Allivision/index.html"

echo "Creating $APP_NAME.app linked to $LOCAL_PATH..."

# 1. Create the App using osacompile
osacompile -o "$APP_PATH" -e "do shell script \"open '$LOCAL_PATH'\""

# 2. Download Icon
echo "Downloading icon..."
curl -s -L "$ICON_URL" -o "$TEMP_DIR/icon_original.png"

# 3. Create Iconset
ICONSET_DIR="$TEMP_DIR/$APP_NAME.iconset"
mkdir -p "$ICONSET_DIR"

# Resize to standard sizes
sips -z 16 16     "$TEMP_DIR/icon_original.png" --out "$ICONSET_DIR/icon_16x16.png" > /dev/null
sips -z 32 32     "$TEMP_DIR/icon_original.png" --out "$ICONSET_DIR/icon_16x16@2x.png" > /dev/null
sips -z 32 32     "$TEMP_DIR/icon_original.png" --out "$ICONSET_DIR/icon_32x32.png" > /dev/null
sips -z 64 64     "$TEMP_DIR/icon_original.png" --out "$ICONSET_DIR/icon_32x32@2x.png" > /dev/null
sips -z 128 128   "$TEMP_DIR/icon_original.png" --out "$ICONSET_DIR/icon_128x128.png" > /dev/null
sips -z 256 256   "$TEMP_DIR/icon_original.png" --out "$ICONSET_DIR/icon_128x128@2x.png" > /dev/null
sips -z 256 256   "$TEMP_DIR/icon_original.png" --out "$ICONSET_DIR/icon_256x256.png" > /dev/null
sips -z 512 512   "$TEMP_DIR/icon_original.png" --out "$ICONSET_DIR/icon_512x512.png" > /dev/null
# If original is large enough, do 1024
sips -z 512 512   "$TEMP_DIR/icon_original.png" --out "$ICONSET_DIR/icon_512x512@2x.png" > /dev/null

# 4. Convert to icns
echo "Converting to .icns..."
iconutil -c icns "$ICONSET_DIR" -o "$TEMP_DIR/applet.icns"

# 5. Replace icon
cp "$TEMP_DIR/applet.icns" "$APP_PATH/Contents/Resources/applet.icns"

# 6. Touch to refresh
touch "$APP_PATH"

# Cleanup
rm -rf "$TEMP_DIR"

echo "Done! Allivision.app created on Desktop."
