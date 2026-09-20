# Cómo abrir este proyecto

**Visor de teledetección aeronáutica** — análisis de la ruta **SKVV → SKLT**
(Villavicencio – Leticia) del **7 SEP 2026 a las 1830Z**, con imágenes de
GOES-19, METAR, TAF y SIGMET reales.

---

## En Windows: doble clic en `ABRIR.cmd`

Eso es todo. Se abre una ventana negra con el servidor y, detrás, el navegador en
<http://localhost:5173>.

**No cierres la ventana negra** mientras estés viendo el visor: es el servidor. Al
terminar, ciérrala o pulsa `Ctrl+C`.

Funciona con o sin Node.js instalado: si no lo encuentra, usa el servidor de
PowerShell que ya trae Windows.

## En macOS o Linux

Abre una terminal en esta carpeta y ejecuta una de las dos:

```bash
node herramientas/servidor.mjs      # si tienes Node
python3 -m http.server 5173         # si no
```

Después abre <http://localhost:5173>.

---

## Por qué no se puede abrir `index.html` con doble clic

Saldría en blanco. El visor está escrito con módulos ES y carga sus datos con
`fetch`, y los navegadores bloquean las dos cosas cuando la página viene de
`file://` en vez de `http://`. Por eso hace falta el servidor, aunque sea local.

---

## Qué funciona sin internet

**Todo lo esencial.** El proyecto lleva dentro:

| | |
|---|---|
| Imágenes de satélite | 8 bandas de GOES-19, 28 cuadros cada una (27 en la banda 4), en `medios/satelite/` |
| Animaciones | un `.webm` por banda |
| METAR, TAF, SIGMET | congelados en `datos/*.json` a la hora del caso |
| Frontera y departamentos | `datos/limites-colombia.geojson` |
| Escala de color de cada banda | `datos/barras-color.json` y `medios/satelite/barras/` |
| Mapa base | teselas de relieve guardadas en `medios/mapa/` |
| Leaflet | copia local en `vendor/leaflet/` |

Al abrirlo, el visor **no pide nada a internet**: todo lo que necesita viaja dentro
de la carpeta.

**Con internet además** se puede: consultar los SIGMET en vivo contra la API del
Aviation Weather Center (el botón *Consultar de nuevo*), cambiar a los otros tres
mapas base y ver la capa de radar. Sin internet, el panel de SIGMET lo rotula como
`CONGELADO` y sigue mostrando los avisos guardados: no se pierde el análisis.

El mapa base guardado cubre **Colombia entera** entre los niveles de zoom 4 y 8, que
son los que usan las escenas. Si te alejas o te acercas mucho más allá de eso, esos
niveles sí necesitan red.

---

## Por dónde empezar

1. En la columna izquierda están las **escenas**, numeradas. Van en orden y cada
   una fija el mapa, las capas, la banda y la hora. Se recorren con las flechas
   `←` `→` del teclado.
2. El botón **Presentación** (arriba a la derecha) pasa a pantalla completa para
   exponer. `Esc` para salir.
3. La **barra de tiempo** de abajo mueve el avión por la ruta y cambia el cuadro
   de satélite y el METAR vigente. Las marcas son la salida, la hora de análisis
   y la llegada.
4. **Clic sobre el trazado azul** de la ruta: cadena ATS y la tabla de niveles de
   crucero con el rumbo magnético tramo a tramo.
5. Pestañas de la derecha: **Capas**, **Bandas**, **METAR/TAF**, **Fenómenos**
   (los SIGMET y su cruce con la ruta) y **Alterno** (la matriz de decisión).

### El panel de la derecha, el de las bandas

Las imágenes cubren Colombia entera, no solo el corredor de la ruta, así que el
panel se maneja como un mapa:

- **rueda del ratón** para acercar y alejar, **arrastre** para moverte;
- **doble clic** o el botón **⧉** para volver a ver el recorte completo;
- abajo a la derecha, el aumento y **las coordenadas del centro** de lo que estás
  mirando. El aumento se pone ámbar cuando pasas de la resolución real de la banda:
  a partir de ahí lo que ves es interpolación del navegador, no detalle medido por
  el satélite;
- la **frontera de Colombia y los departamentos** van dibujados sobre la imagen, y
  los nombres de departamento aparecen a partir de ×1,8;
- al pie, la **escala de color** de la banda activa. El botón **?** explica qué
  significa cada color: por ejemplo, en la banda 13 el color empieza exactamente en
  −30 °C y por debajo de −60 °C hay convección profunda.

### Pantalla completa

Los dos paneles la tienen, con el botón **⛶**: en el mapa va debajo del zoom, y en
el de bandas al final de la barra de abajo. `Esc` para salir. Merece la pena: en
pantalla completa caben todos los rótulos de la escala de color, que en media
pantalla no.

---

## Qué hay en cada carpeta

```
index.html            la página
ABRIR.cmd             lanzador para Windows
css/  js/             el visor
datos/                caso.json y los datos meteorológicos congelados
  archivo/            los casos anteriores, guardados enteros
medios/satelite/      las 8 bandas, cuadro a cuadro, más las animaciones
  verificacion.md     trazabilidad de la captura: URLs, huecos, comprobaciones
  barras/             las barras de color publicadas por SLIDER, como evidencia
  referencia-gibs-*   contraste con NASA GIBS para validar la geolocalización
medios/mapa/          teselas del mapa base para funcionar sin internet
herramientas/         los scripts de descarga y el servidor
informe/informe.md    el informe académico
LEEME.md              documentación técnica completa
vendor/leaflet/       la librería de mapas, copia local
```

Lo primero que conviene leer antes de citar cualquier cifra es
`meta._procedenciaDatos` dentro de `datos/caso.json`: clasifica **cada** dato en
verificado, calculado, sin verificar o ilustrativo.
