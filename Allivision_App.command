#!/bin/bash
# Navegar explícitamente a la carpeta del proyecto donde está el index.html
cd "/Users/hjalmarmeza/Downloads/Antigravity/Allivision"

# Matar cualquier servidor previo en el puerto 8040
lsof -ti:8040 | xargs kill -9 2>/dev/null

# Iniciar servidor Python en segundo plano
nohup python3 -m http.server 8040 >/dev/null 2>&1 &

# Esperar un poco
sleep 1

# Abrir el navegador
open "http://localhost:8040"
