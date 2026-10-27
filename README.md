# Fábrica Oscura

Aplicación web en español para planificar y escribir guiones de videos de **terror y misterio** para YouTube.
Hecha con HTML, CSS y JavaScript puros: no necesita instalación, servidor ni conexión a internet.

## Cómo abrirla (Windows 10 + Google Chrome)

1. Abre la carpeta `Escritorio\FabricaVideosIA`.
2. Clic derecho sobre `index.html` → **Abrir con** → **Google Chrome**.
3. (Opcional) En Chrome pulsa `Ctrl + D` para guardarla en marcadores.

## Funciones

- Página de inicio con estadísticas y proyectos recientes.
- Crear, editar, duplicar y eliminar proyectos.
- Generador de ideas por subgénero (combinación aleatoria de elementos escritos a mano, **no usa IA**).
- Editor de guion por escenas: narración, visual, sonido y notas; reordenar, duplicar y eliminar escenas.
- Conteo de palabras y duración estimada (150 palabras por minuto).
- Guardado automático en el navegador (y `Ctrl + S`).
- Copiar el guion al portapapeles o exportarlo como `.txt`.
- Diseño adaptable a computadoras y teléfonos.

## Importante sobre tus datos

Los proyectos se guardan en el **almacenamiento local de Chrome**, no en archivos.

- Si borras los datos de navegación de Chrome ("cookies y datos de sitios"), se borran los proyectos.
- Si abres la app en otro navegador o en otro equipo, no verás los mismos proyectos.
- Exporta a `.txt` los guiones importantes como copia de seguridad.

## Estructura

```
index.html        Estructura de la página
css/styles.css    Diseño visual
js/storage.js     Guardado de proyectos (localStorage)
js/ideas.js       Generador de ideas
js/app.js         Pantallas, editor y exportación
```
