# Mesa VTT · D&D 5e

Aplicación de escritorio (Electron) para dirigir partidas de D&D 5e con mapas importados, malla de casillas, tokens controlables y herramientas de medición.

# IMPORTANTE
solo disponible para linx

## Puesta en marcha

```bash
npm install
npm start
```

## Qué incluye

- **Mapas**: importa JPG, PNG, WEBP, GIF, BMP o AVIF. La malla se ajusta con tamaño de casilla y desfases X/Y; el zoom y el desplazamiento de la vista se controlan con la rueda y con espacio + arrastrar.
- **Biblioteca de mapas**: crea carpetas dentro de la app, importa varios mapas a la vez con miniaturas, renombra o elimina carpetas y carga cualquier mapa en la mesa con un clic. Incluye buscador por nombre, filtro por formato y arrastrar y soltar mapas entre carpetas. El botón **Guardar mapa actual en biblioteca** archiva el mapa que ya está en la mesa. También puedes **importar una carpeta entera del disco**: se replica su árbol de subcarpetas y se cargan todas las imágenes compatibles que contenga. Las miniaturas se generan también para WEBP, GIF, BMP y AVIF la primera vez que se muestran. Los archivos se copian a los datos de la aplicación, así que la biblioteca sobrevive a reinicios y no depende de la carpeta original.
- **Tokens**: crea tokens de **jugador** o **enemigo** (el tipo lo eliges tú), con nombre, color, tamaño de 1×1 a 4×4, PG actuales/máximos opcionales, modificador de iniciativa e imagen propia.
- **Mover tokens**: herramienta *Mover / seleccionar* y arrastre; con el ajuste a casillas el token queda centrado en su casilla. También puedes usar las flechas del teclado.
- **Vida**: barra de PG sobre el token y controles −5, −1, +1, +5 e inputs directos en la lista de tokens. A 0 PG el token se marca como caído. El botón ✎ abre un editor para ajustar la posición X/Y exacta y los PG actuales/máximos; las cifras exactas nunca se envían a la pantalla de jugadores, solo una proporción para dibujar su barra.
- **Mediciones**: regla entre dos puntos (5 pies por casilla, diagonales incluidas), círculo con radio y cono con apertura de 53° (5e), 45° o 90°. Los resultados se leen en pies, casillas y metros. La medición activa también puede mostrarse en la pantalla de jugadores.
- **Combate**: tira iniciativa para todos los tokens (1d20 + su modificador), ordena automáticamente los turnos, avanza con **Siguiente turno** y cuenta las rondas. La lista de iniciativa se proyecta en la pantalla de jugadores durante el combate.
- **Reglas rápidas**: movimiento, acciones, cobertura, estados y plantillas en la barra lateral izquierda.
- **Campañas y runs**: crea una campaña desde el panel derecho, guarda y carga el progreso completo de la run (escena, mapa, tokens, combate y vista), y conserva fichas de personaje, enemigos y mapas para reutilizarlos. Cada campaña tiene su propia carpeta en `userData/campaigns/<id>/` con `campaign.json`, `run.json`, `characters/`, `enemies/` y `maps/`, así que el progreso sobrevive a reinicios y no depende de la escena temporal del navegador.
- **Persistencia**: guardado automático en el navegador y exportación/importación de la escena completa a JSON (incluye mapa e imágenes de tokens). La biblioteca se guarda aparte, en `userData/library`, con su propio índice.

## Pantalla de jugadores

El botón **Abrir pantalla de jugadores** crea una ventana limpia con el mapa, la malla y los tokens. En el panel puedes activar o desactivar las **barras de vida** y las **mediciones de reglas**. Las barras muestran solo la proporción de vida, sin cifras exactas: el proceso principal descarta los PG actuales/máximos y solo envía un porcentaje y el estado caído. La medición activa (regla, círculo o cono) se proyecta con su distancia en pies y casillas. Durante el combate aparece además el **orden de turnos** con la ronda y el combatiente actual. Si hay un segundo monitor, se coloca allí a pantalla completa; si no, se abre como ventana y puedes arrastrarla al monitor que quieras. La vida se sigue controlando desde la mesa principal y la ventana se actualiza al mover tokens, cambiar de mapa, modificar la malla, la medición o el turno.

## Atajos

| Tecla | Acción |
| --- | --- |
| `V` / `R` / `C` / `O` | Mover, regla, cono, círculo |
| Rueda | Zoom |
| Espacio + arrastrar | Desplazar la vista |
| `Supr` | Borrar el token seleccionado |
| Flechas | Mover el token 1 casilla (con `Shift`, 5) |
| `Esc` | Quitar medición / deseleccionar |
| `F11` / `Esc` | Pantalla completa / salir de ella (ventana de jugadores) |

## Crear un ejecutable de Linux

Con Node y npm instalados:

```bash
npm install
npm run dist:linux
```

Los artefactos quedan en `dist/`:

- **`MesaVTT-1.0.0-x86_64.AppImage`**: ejecutable único. Si hace falta, dale permisos y ábrelo:
  ```bash
  chmod +x dist/MesaVTT-1.0.0-x86_64.AppImage
  ./dist/MesaVTT-1.0.0-x86_64.AppImage
  ```
  El lanzador de escritorio del AppImage ya incluye `--no-sandbox`. Si lo ejecutas desde una terminal y la sandbox de Chromium está restringida, usa `./dist/MesaVTT-1.0.0-x86_64.AppImage --no-sandbox`.
- **`MesaVTT-1.0.0-x64.tar.gz`**: versión portable. Descomprime y ejecuta `MesaVTT-1.0.0-x64/mesa-vtt`.

El AppImage necesita FUSE 2 en algunas distribuciones; si no está disponible, usa el tar.gz. El icono y la entrada de escritorio se generan a partir de `build/icon.svg`.

## Estructura

- `main.js` — proceso principal de Electron y diálogos de archivos.
- `preload.js` — puente IPC mínimo y seguro.
- `index.html` / `styles.css` — interfaz de dos barras laterales y lienzo central.
- `renderer.js` — mesa: dibujo, tokens, mediciones, biblioteca y persistencia.
- `geometry.js` — matemática de casillas, distancias, conos y círculos.
- `library.js` — almacén de carpetas y mapas en disco, con miniaturas e importación recursiva (independiente de Electron para poder probarlo).
- `campaign.js` — almacén de campañas, runs, fichas, enemigos y mapas en `userData/campaigns` (independiente de Electron para poder probarlo).
- `build/icon.svg` / `build/icon.png` — icono del ejecutable.
- `player.html` / `player.css` / `player.js` — ventana de proyección para los jugadores (barras proporcionales, mediciones y orden de combate).
- `player-preload.js` — puente IPC aislado de la ventana de jugadores.
