# Implementation Plan - Allivision 📺

**Allivision** es una aplicación web premium para ver televisión global en vivo, utilizando señales abiertas de todo el mundo.

## 1. Visión del Producto
- **Nombre**: Allivision
- **Concepto**: "El mundo en tus ojos". Una interfaz futurista y cinemática para explorar culturas a través de su televisión.
- **Estética**: Dark UI, Glassmorphism, Neon Accents (Cyan/Magenta), animaciones fluidas (60fps), tipografías modernas (Inter/Outfit).

## 2. Stack Tecnológico
- **Core**: Vanilla HTML5, JavaScript (ES6 Modules).
- **Estilos**: Vainilla CSS3 (CSS Variables para temas, Grid/Flexbox).
- **Reproductor de Video**: [HLS.js](https://github.com/video-dev/hls.js/) (Estándar ligero para reproducir streams `.m3u8` en cualquier navegador).
- **API de Datos**: [IPTV-org API](https://github.com/iptv-org/api). Usaremos los endpoints JSON para obtener listas de canales filtradas.

## 3. Funcionalidades Clave (MVP)
1.  **Global Tuner**: Explorador de canales por País (con banderas) y Categoría (Noticias, Música, Edu, Movies).
2.  **Instant Play**: Reproductor de video integrado que soporta HLS (streaming adaptativo).
3.  **Smart Search**: Buscador en tiempo real por nombre de canal.
4.  **Favorites**: Guardar canales en `localStorage`.
5.  **Picture-in-Picture (PiP)**: Seguir viendo mientras navegas (nativo del navegador).

## 4. Estructura de Archivos
```
Allivision/
├── index.html          # Entry point (Single Page App structure)
├── css/
│   ├── style.css       # Estilos globales y layout
│   └── player.css      # Estilos específicos del reproductor de video
├── js/
│   ├── app.js          # Lógica principal y ruteo simple
│   ├── api.js          # Conexión con IPTV-org y gestión de datos
│   ├── player.js       # Wrapper para HLS.js y controles de video
│   └── ui.js           # Renderizado de listas y componentes
└── assets/             # Iconos y recursos estáticos
```

## 5. Roadmap de Desarrollo
1.  **Fase 1: Skeleton & API** - Configurar proyecto y obtener lista de canales JSON.
2.  **Fase 2: UI/UX Design** - Crear la interfaz "Wow" (Sidebar, Grid de canales, Modal de Player).
3.  **Fase 3: Player Implementation** - Integrar HLS.js para que el video funcione realemente.
4.  **Fase 4: Categorización** - Implementar filtros de País y Categoría.
5.  **Fase 5: Polish** - Animaciones de carga, manejo de errores (canales offline), y logo.

## 6. Detalles Técnicos (API)
Usaremos `https://iptv-org.github.io/api/channels.json` para metadatos y `streams.json` para enlaces, o la versión combinada si está disponible para evitar corrupciones de datos.
*Nota: Muchos canales de IPTV pública pueden caerse o tener geobloqueo. Implementaremos un indicador de "Check" si es posible o manejo suave de errores.*
