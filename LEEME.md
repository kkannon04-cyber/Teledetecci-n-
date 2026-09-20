# Visor de teledetección aeronáutica

Proyecto de análisis meteorológico de ruta con productos satelitales de
**CIRA/RAMMB SLIDER** (Colorado State University), METAR, TAF y SIGMET.

El caso cargado es **SKVV → SKLT (Villavicencio – Leticia)**, 553 NM sobre la
Amazonía, salida a las **1830Z del 07 SEP 2026** —las 13:30 hora de Colombia—,
llegada **2055Z**, en un **ATR 72-600** a **250 kt** y crucero **FL210**:

```
SKVV  VVC  A301  UBRID  B689  DUBRA  A301  ISORI  A301  ASKAT  A301  DADIL  A301  ROKUL  SKLT
```

VVC es VOR/DME de **ENR 4.1**; UBRID, DUBRA, ISORI, ASKAT, DADIL y ROKUL son
fijos de ruta de **ENR 4.4**; las coordenadas ARP, elevaciones y pistas salen de
**AD 2.2 / AD 2.12** y las zonas P/R/D de **ENR 5.1**, todo del **AIP Colombia,
AIRAC A 73-26** a través del proyecto hermano **Simulador NALA**.

> **Las aerovías A301 y B689 no se pudieron contrastar.** Los siete puntos sí
> están publicados, pero ninguno de los dos designadores figura en la tabla de
> aerovías de esa base. El trazado usa las coordenadas reales —que forman una
> línea casi recta al sureste, coherente con el corredor— y los designadores
> quedan marcados como no verificados en `ruta.aerovias[].verificada`.

Tampoco son dato publicado **TOC y TOD**, calculados con el modelo declarado en
`ruta.perfilVertical`, ni los polígonos de fenómenos, que son interpretación del
analista sobre la imagen satelital (en este caso, todavía sin trazar).

### El nivel de crucero no se elige: lo impone la tabla

Todos los tramos de la ruta van entre **123° y 171° magnéticos**, o sea dentro del
semicírculo 000–179, donde la tabla de niveles de crucero (OACI Anexo 2, Apéndice 3,
adoptada por el RAC 91) obliga a **niveles impares**. FL200 —que es lo primero que
uno escribe para un ATR— corresponde al sentido contrario y no es asignable aquí.

De los impares, **FL190 queda descartado** por una razón concreta: 19 000 ft es
exactamente el techo publicado de la zona restringida **SKR7 (Villavicencio,
9 000–19 000 ft)**, que cubre el propio aeródromo de salida. Nivelar justo en el
límite superior de una restringida no deja margen ante la variación de QNH. Queda
**FL210**.

El desarrollo tramo a tramo —rumbo verdadero, declinación y rumbo magnético— está en
`nivelesCrucero` de `caso.json` y se ve en el visor haciendo **clic sobre el trazado
de la ruta**. La declinación no es estimada: se consultó punto a punto al **WMM-2025
del NOAA/NCEI** para el 04 SEP 2026 —válida para el 7: en tres días el modelo varía
milésimas de grado, dos órdenes de magnitud por debajo de su propia incertidumbre
de ±0,33°— y va de −9,04° en SKVV a −10,75° en SKLT. El
tramo más cercano al cambio de semicírculo es ROKUL → SKLT con 170,9°: quedan 9,1°
de margen, así que la regla no es discutible en ningún punto de la ruta.

Los casos anteriores —**SKBO → SKSM** por el corredor del Magdalena, **SKCL → SKMZ**
Cali–Manizales y la versión del **04 SEP 2026** de esta misma ruta, a 275 kt y con
las bandas recortadas al corredor— están guardados íntegros en `datos/archivo/`. Ese
último se conserva por trazabilidad, no para recargarlo: las imágenes que declara ya
no están en disco, y su propio `meta._archivado` dice cómo volver a bajarlas.

> `meta._procedenciaDatos` en `datos/caso.json` clasifica **cada** dato en
> verificado / calculado / sin verificar / ilustrativo. Es la primera cosa que
> conviene leer antes de citar una cifra en el informe.

---

## Arrancar

```powershell
cd C:\Users\HP\Documents\proyecto-teledeteccion
node herramientas/servidor.mjs
```

Abrir <http://localhost:5173>. `Ctrl+C` para detener.

> Hay que servirlo con el servidor, no abrir `index.html` con doble clic:
> los módulos ES y `fetch` no funcionan sobre `file://`.

En un equipo sin Node —o para dárselo a alguien— basta con **`ABRIR.cmd`**: levanta
el servidor de Node si lo encuentra y, si no, uno equivalente escrito en PowerShell
(`herramientas/servidor.ps1`), que ya viene con Windows. Las instrucciones para
quien lo reciba están en [`COMO-ABRIR.md`](COMO-ABRIR.md).

## Preparar el envío

```powershell
node herramientas/empaquetar.mjs --solo-comprobar   # solo revisa
node herramientas/empaquetar.mjs                    # revisa y comprime
node herramientas/capturar-mapa-base.mjs            # fondo del mapa para uso sin red
```

`empaquetar.mjs` no se limita a comprimir: antes comprueba que **cada cuadro que
`caso.json` declara existe de verdad en disco**, que ninguno pesa lo que pesaría un
archivo truncado, y —lo que más caro sale— que las imágenes, los METAR y el caso
hablan **del mismo día**. Si algo no cuadra no genera el `.zip`: lo dice y para.

Dónde queda el archivo, por dónde mandarlo, qué decirle a quien lo reciba y cómo
recortar el tamaño si hace falta: [`COMO-ENVIAR.md`](COMO-ENVIAR.md).

`capturar-mapa-base.mjs` guarda las teselas del fondo en `medios/mapa/` para los
zooms 4–8 de la **caja de cobertura nacional** (`caso.cobertura.caja`, Colombia
entera más margen), no solo de la ruta; por debajo del zoom 7 guarda una caja
continental, que es lo que llena la pantalla al alejar. Con eso el proyecto se abre y pinta el mapa sin
internet; la capa de relieve usa primero lo guardado y solo sale a la red para lo
que no esté. Atribución: © OpenTopoMap (CC-BY-SA), datos © OpenStreetMap (ODbL).

## Actualizar los datos meteorológicos

```powershell
node herramientas/capturar-datos.mjs              # últimas 12 h
node herramientas/capturar-datos.mjs --horas 24
node herramientas/capturar-datos.mjs --fecha 20260831_1340   # histórico
```

Descarga METAR, TAF, SIGMET y PIREP y los **congela** en `datos/*.json`. Una vez
congelados el visor funciona sin internet (solo se pierden los mapas base y la capa
de radar) y, sobre todo, **el caso da lo mismo cada vez que se abre**.

No se piden solo los seis aeródromos del caso:

- **METAR y TAF** se consultan dos veces —por identificador para los seis del caso,
  y por caja para toda la cobertura nacional— y se funden sin duplicar. En este caso
  salen 52 estaciones METAR y 28 TAF. Las 46 que no son del caso se pintan en el
  mapa en la capa *Estaciones METAR*, coloreadas por categoría de vuelo a la hora de
  la barra; el panel sigue detallando solo los seis del caso, que son los que se
  planifican.
- **Los SIGMET** se piden **barriendo la ventana entera hora a hora**, no en un solo
  instante, y se funden por clave. La diferencia no es cosmética: en este caso la
  consulta puntual a las 1830Z devuelve 8 avisos en la caja y 1 sobre la ruta,
  mientras que el barrido devuelve 18 y 3 —los que faltan son los que se emiten con
  el vuelo ya en ruta, justo los del tramo final.

## Convenciones de color de cada banda

```powershell
node herramientas/capturar-barras.mjs
```

Las imágenes de `medios/satelite/` **no son radiancias**: son el producto ya
renderizado por SLIDER, que aplica a cada banda una tabla de color distinta. Sin esa
tabla, «la nube sale roja» no significa nada; con ella significa «tope hacia
−70 °C», que sí es un dato operacional.

El capturador lee de SLIDER qué tabla usa cada banda, descarga la barra que el
propio servidor publica (`medios/satelite/barras/*.png`, 1920×12 px con sus valores
rotulados) y extrae de ella la rampa y la posición de cada marca a
`datos/barras-color.json`. El visor la dibuja como leyenda al pie del panel
satelital, con los rótulos que quepan según el ancho, y la repite en cada ficha de
la pestaña **Bandas** para poder compararlas de un vistazo. El botón **?** abre la
explicación completa de esa banda.

| Banda | Tabla | Escala |
|---|---|---|
| 1 y 2 — visible | `lowlight4` | gris, **sin valores publicados**: es reflectancia, no temperatura |
| 4 y 5 — cirros / hielo | `cirrusband` | gris, sin valores publicados |
| 7 — onda corta | `svgair2` | +120 a −70 °C |
| 9 y 10 — vapor de agua | `svgawvx` | +5 a −80 °C |
| 13 — infrarrojo limpio | `ircimss2` | +40 a −90 °C; **el color empieza justo en −30 °C** |

> **De dónde salen los números.** La rampa se muestrea de la fila 0 del PNG
> publicado, que es la única sin tinta de rótulo. Las marcas se detectan comparando
> las dos filas inferiores contra esa fila 0 y quedándose con los grupos de 2–3 px,
> que es lo que mide una marca. Los valores están **transcritos** de la propia barra
> y solo se publican si su número coincide con el de marcas detectadas: si no cuadra,
> la banda se queda sin escala numérica en vez de asignar valores a ciegas. La
> asignación banda→tabla se contrasta contra SLIDER en cada ejecución.

## Límites de Colombia y departamentos

```powershell
node herramientas/capturar-limites.mjs
```

Congela en `datos/limites-colombia.geojson` la frontera nacional y los 34 rasgos de
primer orden —32 departamentos, Bogotá D.C. y la isla de Malpelo, que la fuente no
asigna a ninguno—. El visor los dibuja en dos capas del mapa y, sobre todo, los
**reproyecta sobre las bandas satelitales**: es lo que permite acercarse a una
célula convectiva y saber sobre qué departamento está.

Fuente: **Natural Earth 1:10 M**, dominio público. No es la fuente que uno querría
—lo sería el IGAC— pero su servidor ArcGIS abierto no publica una capa de límites
departamentales, y geoBoundaries, que sí sirve Colombia, toma el país de Wikimedia y
los departamentos de OpenStreetMap: al venir de fuentes distintas, la línea nacional
y la unión de los departamentos no casan, y el desajuste se ve en pantalla. Natural
Earth mantiene los dos niveles como un conjunto coherente.

> **Es cartografía general a 1:10 M: sirve para situarse, no para medir**, y los
> trazados de frontera no son competencia de este proyecto. El archivo lo dice en su
> propio bloque `_procedencia`, junto con una corrección declarada: Natural Earth
> arrastra la división anterior a 1991 y llama *Intendencia* o *Comisaría* a nueve
> territorios que la Constitución de 1991 elevó a departamento. Aquí figuran como
> departamento y el valor original queda guardado en `_tipoFuente`.

## Grabar las imágenes de satélite

```powershell
node herramientas/capturar-satelite.mjs --verificar          # un cuadro + referencia GIBS
node herramientas/capturar-satelite.mjs                       # fecha y ventana, del caso
node herramientas/capturar-satelite.mjs --solo-ruta          # recorte al corredor, no al país
node herramientas/capturar-satelite.mjs --bandas band_13 --paso 30 --sin-video
node herramientas/capturar-satelite.mjs ... --aplicar        # además escribe caso.json
```

Descarga de **CIRA/RAMMB SLIDER** las bandas ABI **1, 2, 4, 5, 7, 9, 10 y 13** de
GOES-19 recortadas a la **caja de cobertura nacional** —Colombia entera, continental
e insular, más 1,5° de margen— y las deja como cuadros JPEG por hora Zulu más una
animación WebM por banda. Todo queda en `medios/satelite/`, así que el visor funciona
después sin internet.

Sin argumentos toma la fecha y la ventana de `caso.json` (`ventanaTiempo`), así que
no hay forma de bajar por descuido imágenes de un día distinto al del caso. La caja
es la **unión** del territorio nacional y de la ruta, de modo que ampliar la
cobertura nunca puede dejar fuera un punto del trazado; `--solo-ruta` vuelve al
recorte del corredor de antes.

| Banda | λ | Resolución | Zoom | Para qué |
|---|---|---|---|---|
| 1 | 0,47 µm | 1 km | 4 | aerosoles, bruma, humo |
| 2 | 0,64 µm | **0,5 km** | 5 | textura de la nube al máximo detalle |
| 4 | 1,37 µm | 2 km | 3 | cirros: solo el hielo alto sale brillante |
| 5 | 1,6 µm | 1 km | 4 | agua líquida frente a hielo → engelamiento |
| 7 | 3,9 µm | 2 km | 3 | niebla y estratos nocturnos, focos de calor |
| 9 | 6,9 µm | 2 km | 3 | vapor de agua medio (400–500 hPa) → cortantes |
| 10 | 7,3 µm | 2 km | 3 | vapor de agua bajo (600–750 hPa) → la capa del vuelo |
| 13 | 10,3 µm | 2 km | 3 | temperatura de tope → severidad convectiva |

Las tres últimas en incorporarse son la **4, la 9 y la 10**, y las tres aportan lo
que a las anteriores les falta: la 4 aísla el cirro que el visible confunde con nube
y el infrarrojo apenas insinúa; la 9 y la 10 no ven el suelo sino la humedad de dos
capas distintas, y enfrentadas dicen si la columna está cargada arriba o solo abajo
—que es lo que decide si la célula crece—, además de marcar en sus bordes los
cortantes de viento donde aparece la turbulencia en aire claro.

El zoom **es** la resolución nativa del instrumento: cada nivel dobla el lado del
disco y el máximo publicado coincide con los 0,5 / 1 / 2 km reales de cada banda.
Pedir más sería interpolar.

### Saber qué trozo de mundo se está mirando

Una banda sin referencia es una foto bonita: se ve la tormenta pero no dónde cae
respecto al vuelo. Por eso el visor cierra el círculo por los dos lados:

- **Sobre la imagen** se calca la ruta, los aeródromos, el avión en la posición que
  marca la barra de tiempo y una retícula de meridianos y paralelos cada 5°. El
  navegador repite la misma proyección geoestacionaria del capturador
  (`js/geoestacionaria.js`) con los parámetros que quedaron guardados en
  `satelite._recorte.proyeccion` y la ventana de píxeles de cada banda (`banda.geo`).
- **Sobre el mapa** se dibuja la capa *Cobertura de las bandas*: el contorno real de
  lo que abarcan las imágenes. Sale ligeramente curvado porque el recorte es
  rectangular en la rejilla del satélite, no en el mapa.

El calco se dibuja en un SVG con `preserveAspectRatio="xMidYMid meet"`, que encaja
exactamente igual que el `object-fit: contain` de la imagen, así que sigue cuadrando
cuando el panel cambia de tamaño. Las coordenadas se normalizan a un lienzo de 1 000
de ancho: los recortes van de 865 px (banda 13) a 3 460 px (banda 2), y sin
normalizar el mismo texto saldría legible en una banda e invisible en la otra.

> Las ocho bandas comparten **exactamente** el mismo contorno geográfico: la ventana
> se calcula una vez a zoom 3 y las demás la heredan multiplicada por potencias de
> dos. Sin eso, el redondeo a píxel entero de cada zoom las descuadraba un par de
> kilómetros y la cortina comparadora no casaba.

### Cómo se recorta la zona de la ruta

SLIDER entrega el disco completo en teselas de 678 px en **proyección
geoestacionaria**, no en coordenadas geográficas. El script traduce latitud/longitud
a píxel con la proyección del GOES-R PUG, elige solo las teselas que tocan la caja,
las recompone en un `<canvas>` de Chromium y recorta. Se usa el navegador como
compositor a propósito: el proyecto no tiene `package.json` ni dependencias, y así
sigue.

> **La geolocalización se verifica, no se supone.** Con `--verificar` se descarga
> además el mismo instante y la misma caja desde **NASA GIBS**, que ya viene
> georreferenciado, para contrastarlos. La comprobación hecha sobre la costa Caribe
> (`--caja 8,13,-76,-70`) situó la Guajira y el golfo de Venezuela con menos de un 1 %
> de diferencia. Las referencias quedan en `medios/satelite/referencia-gibs-*.jpg` y
> el informe en `medios/satelite/verificacion.md`.

### Límites conocidos

- **No se puede generar `.mp4`.** El único ffmpeg disponible es el que trae
  Playwright: compilación mínima, solo VP8/WebM, sin demuxer `concat` ni `image2` de
  fichero —los cuadros se le pasan por `pipe:0`—. El WebM se ve en Chrome, Edge y
  Firefox; en PowerPoint, no de forma fiable.
- **Las bandas 1, 2, 4 y 5 son reflectivas: de noche no sirven.** La ventana del
  caso (1730–2200Z = 12:30–17:00 hora local) es diurna entera, así que no afecta,
  pero conviene decirlo antes de citarlas: en los últimos cuadros el sol ya está
  bajo y el contraste cae. Las bandas 7, 9, 10 y 13 son térmicas y funcionan a
  cualquier hora.
- **Un hueco declarado.** La banda 4 no tiene el cuadro de las **2020Z**: SLIDER no
  publica ese barrido para ese canal ese día. Las otras siete bandas tienen los 28.
  No se rellena con el vecino; queda anotado en `medios/satelite/verificacion.md` y
  el visor muestra el cuadro más próximo en el tiempo.
- **Reutilización de cuadros.** `parametros.json` guarda en cada carpeta la fecha,
  el zoom, el recorte **y la lista de sellos que esa configuración escribió de
  verdad**. Un cuadro se reutiliza solo si figura en esa lista; lo que no figura se
  borra. Las dos condiciones hacen falta: sin la primera, una prueba sobre otra
  zona contamina la serie; sin la segunda, un cuadro de **otro día** con el mismo
  nombre sobrevive al cambio de fecha y se cuela como si fuera del día analizado.
  Eso pasó de verdad al mover el caso del 1 al 4 de septiembre —los cuadros de las
  1640Z y 1740Z del día 1 se reutilizaron— y por eso la lista existe. La ficha se
  guarda tras cada cuadro, así que un corte de red a mitad de banda no obliga a
  repetirla entera.

## SIGMET: cruce automático con la ruta

La pestaña **Fenómenos** consulta los avisos SIGMET y responde tres preguntas por
aviso, que son las que deciden si afecta o no al vuelo:

1. **¿Su polígono corta la ruta?** Se comprueba geométricamente: punto de la ruta
   dentro del polígono, o tramo de la ruta que corte un lado. Si no corta, se
   calcula la separación mínima en NM entre ambos contornos.
2. **¿Sus niveles se solapan con el perfil del vuelo?** Un SIGMET que cruza la
   ruta pero por debajo del nivel de crucero **no** la afecta, y la ficha lo dice
   con esas palabras.
3. **¿Está vigente a la hora de la barra de tiempo?** Los que no lo están se
   atenúan en el mapa y en la lista.

Solo cuando las tres son afirmativas el aviso cuenta como *afecta la ruta*, y el
veredicto de arriba del panel lo resume.

> **El veredicto tiene tres estados, no dos.** «No cruza» no significa «no importa».
> En este caso el SIGMET 39 de la FIR Amazónica (SBAZ) —tormenta embebida, topes en
> FL370— no corta el trazado, pero el borde de su polígono pasa a **0,13 NM de
> SKLT**: por encima del aeródromo de destino. A esa distancia el margen lo pone la
> precisión con que se publica el aviso, que va en minutos de arco enteros, no el
> vuelo. Por eso, cuando nada cruza pero algo queda a menos de 10 NM, el panel lo
> dice en ámbar en vez de en verde, y la distancia se muestra con decimal por debajo
> de 10 NM: redondeada a entero decía «0 NM», que se lee justo como lo contrario de
> lo que es.

### Comparar contra el mapa del Aviation Weather Center

El selector **Alcance** cambia qué avisos se dibujan: *área de la ruta* (300 NM),
*regional* (1 500 NM) o *todo el mundo*. El contador dice cuántos hay
decodificados, cuántos quedan fuera del alcance y cuántos no traen geometría
utilizable, para que nunca desaparezca nada en silencio.

Al comparar con <https://aviationweather.gov> hay que tener en cuenta dos cosas,
o los dos mapas parecen contradecirse sin estarlo:

- **La página del AWC pinta la situación de AHORA; aquí la vigencia se evalúa a
  la hora de la barra de tiempo**, que es la del caso. Un aviso emitido después
  de esa hora sale atenuado aquí y en color pleno allá. Para contrastar
  directamente, mueve la barra al momento presente.
- **El alcance por defecto es de 300 NM.** El AWC no filtra: pon *todo el mundo*
  y los recuentos deben cuadrar aviso a aviso.

> Un aviso con `geom: "AREAS"` publica **varias áreas** y la API las entrega como
> lista de listas, no como lista de vértices. Leerlo mal hace que el aviso
> desaparezca del mapa sin dar error — le pasaba a este visor con los SIGMET de
> áreas múltiples, entre ellos los de tormenta de la FIR Maiquetía. Está
> corregido en `anillosDe()`; si algún día vuelve a fallar, el contador de
> «sin geometría utilizable» lo delata.

**La consulta se hace a la hora del caso, no a la de ahora.** Si el caso analiza
un vuelo pasado, preguntar por los avisos vigentes en este momento sería
responder correctamente a la pregunta equivocada. El visor pide a la API los
SIGMET que estaban vigentes a la hora de análisis (`date=AAAAMMDD_HHMM`), y el
botón **Consultar de nuevo** repregunta por la hora que marque la barra de
tiempo. El sello del panel dice cuál de los tres casos se está viendo:

| Sello | Qué significa |
|---|---|
| `HORA DEL CASO` | consulta a la API para el instante analizado |
| `EN VIVO` | el caso es de ahora mismo, así que se pidió la situación actual |
| `CONGELADO` | la API no respondió; se usa `datos/sigmet.json` |

`aviationweather.gov` no envía cabeceras CORS, así que el navegador no puede
llamarla directamente: `herramientas/servidor.mjs` expone un proxy en
`/api/sigmet`, `/api/metar` y `/api/taf` que la consulta desde el servidor y
devuelve el JSON en el mismo origen. Solo esas tres rutas y solo contra ese
host: no es un proxy abierto.

`capturar-datos.mjs` sigue el mismo criterio: `--fecha` acota la ventana de
METAR/TAF, y los SIGMET se congelan barriendo la **ventana completa del caso**, que
es el intervalo que se está estudiando.

El visor usa **primero lo congelado** y solo consulta la API si no hay captura o si
se pulsa «Consultar de nuevo». Esa consulta trae solo los avisos vigentes en el
instante de la barra —normalmente menos que la captura— y recargar la página vuelve
a lo congelado. Es lo que hace que el caso no cambie entre reproducciones.

---


## Análisis derivado: de la imagen a la decisión

Las imágenes de SLIDER son **el producto ya renderizado**, no radiancias
calibradas. Mientras la tabla de color no se invierta, «la nube sale roja» es una
impresión y no una medida. El proyecto la invierte y a partir de ahí construye
todo lo demás.

```
color del píxel  →  temperatura de brillo  →  altura del tope  →  ¿pasa por encima de FL210?
   radiometria.js        productos.js            productos.js         perfil.js / tramos.js
```

Cada salto tiene su fórmula escrita y sus límites rotulados **en la propia
interfaz**, no solo en un comentario. Nada de esto es una observación: son cálculos
sobre un JPEG de 192 escalones de tabla, y así se declaran en
`meta._procedenciaDatos.derivado`.

### Los fenómenos ya no se dibujan a mano

```powershell
node herramientas/servidor.mjs          # en otra consola
node herramientas/derivar-fenomenos.mjs
```

Recorre los 28 cuadros de la banda 13, umbraliza a −52 °C, agrupa en componentes,
las contornea y **las sigue de un cuadro al siguiente** por proximidad de
centroide. Lo que escribe en `datos/fenomenos.geojson` no son manchas sueltas sino
células con nacimiento, máximo y final, y con el dato que de verdad decide: a qué
distancia queda cada una **de la aeronave en el instante en que esta pasa por ahí**.
Que una célula corte la traza y que el vuelo se la encuentre son cosas distintas.

Es determinista: la misma imagen da el mismo polígono siempre. Si lo ejecutas dos
veces, el archivo sale idéntico.

### Dos trampas que costó ver, y cómo se resolvieron

**El gris de la banda 13 significa dos cosas.** La tabla `ircimss2` va de negro en
+40 °C a gris claro en −30 °C, y luego la cola fría vuelve a arrancar en negro a
−80 °C y aclara hasta blanco en −90 °C. Un píxel gris puede ser selva al sol o la
cima de un cumulonimbo: 120 °C de diferencia. Se resuelve por conectividad —el gris
al que se llega desde el borde de la imagen es suelo; el gris encerrado por color
del extremo frío es la cima— y el umbral de adyacencia es **−72 °C, no −30 °C**. Con
−30 °C, una mota de compresión dentro de un yunque a −45 °C recibía −88 °C.

**El mínimo de un núcleo es el valor de un píxel.** Y el anillo de compresión del
JPEG en el borde puede fabricarlo. Por eso la severidad se clasifica por el
**percentil 5**: exige que el 5 % del área esté igual de fría. Con el mínimo, trece
de catorce células salían al tope de escala de −90 °C; con el percentil, la
distribución va de −60,5 a −88,6 °C.

La comprobación de que todo esto mide algo real es multiespectral: sobre el centro
de los núcleos, la banda 9 (vapor de agua) queda 3 a 5 °C por debajo de la banda 13,
que es la convergencia esperable en topes que alcanzan la alta troposfera.

### Lo que añade el visor

| Vista | Qué contesta |
|---|---|
| **Perfil** (botón de la cabecera) | Corte vertical distancia × altitud: dónde la nube rebasa FL210. Pasar el cursor da la Tb, el tope y la estación que ancla el cálculo. |
| **Tramos** (pestaña) | Los ocho tramos publicados con rumbo magnético, tope máximo, porcentaje bloqueado y veredicto LIBRE / PRECAUCIÓN / EVITAR, con la regla a la vista. |
| **EFB** (botón) | Posición simulada, alertas con su medida de origen, células vivas con marcación en horas de reloj y puntos de decisión con el coste de cada opción calculado. |
| **Portada** (botón) | Pantalla de título para la sustentación, con los cuadros reales de la banda 13 pasando de fondo sobre el mapa de Colombia. Sale de `caso.meta`, así que si cambia el caso cambia con él. Con → se cierra y arranca la primera escena del guion. |
| **Panel ⟩** (botón o tecla **H**) | Pliega el panel de herramientas y deja el mapa y la imagen a pantalla completa. |
| **Descifrar el parte** (METAR/TAF) | Desmonta el crudo grupo a grupo y lo traduce al lado, sin sustituirlo. |

Hubo además una vista de cabina en 3D, por trazado de rayos contra el campo de
alturas. Se retiró: a 2 km de resolución el instrumento no resuelve detalle a corta
distancia, así que de cerca la escena salía como una sábana blanca, y lo único que
la habría arreglado —inventar textura— es justo lo que este proyecto no hace. El
corte vertical contesta la misma pregunta con el mismo dato y sin ese problema.

## Cómo se maneja

| Control | Qué hace |
|---|---|
| **Barra de tiempo** (abajo) | Eje central. Mueve la aeronave, cambia el frame satelital, el METAR vigente y el periodo del TAF, todo a la vez. `▶` la reproduce. |
| **Pestaña Capas** | Enciende/apaga cada capa y ajusta su opacidad. |
| **Pestaña Bandas** | Cambia la banda satelital mostrada en el panel derecho. |
| **Zoom del panel satelital** | Rueda del ratón sobre la imagen para acercar y alejar, arrastre para desplazarse, doble clic o el botón ⧉ para volver al recorte completo. El encuadre se conserva al cambiar de banda, de hora o al abrir la cortina, que es lo que permite comparar dos bandas sobre la misma célula. |
| **Pantalla completa** | Botón **⛶** en cada panel: bajo el zoom en el mapa, y al final de la barra inferior en el satelital. Usa la pantalla completa del navegador, así que se gana también la barra del sistema. `Esc` sale. Al ampliar, el panel satelital recoloca el encuadre y muestra todos los rótulos de la escala de color que antes no cabían. |
| **Leyenda de color** | Al pie del panel satelital: la rampa de la banda activa con su escala. El botón **?** abre qué significa cada color en esa banda. |
| **Límites sobre la imagen** | La frontera de Colombia y los departamentos se dibujan también sobre la banda activa, reproyectados a la rejilla del satélite. Los nombres de departamento aparecen a partir de ×1,8: a vista de país serían treinta y cuatro rótulos pisándose. |
| **Lectura del panel satelital** | Abajo a la derecha: el aumento y las coordenadas del centro de la vista. El aumento se pone ámbar y avisa cuando se pasa de la resolución nativa de la banda —a partir de ahí lo que se ve es interpolación del navegador, no detalle medido por el instrumento. |
| **Comparar bandas** | Activa la cortina deslizante; después se hace clic en una segunda banda para enfrentarla a la activa. |
| **Guion de escenas** | `←` `→` recorren las nueve escenas: cada una fija capas, encuadre, banda y hora. El cartel de narración se cierra con `Esc` sin salir de la escena. Una escena sin banda cierra el panel satelital a propósito; vuelve pulsando cualquier banda. |
| **Plegar el panel** | Botón **Panel ⟩** o tecla `H`. Deja el mapa y la imagen a todo lo ancho. |
| **Portada** | Botón **Portada**. Desde ella, *Pantalla completa* pone el visor entero en el proyector sin salir de la portada, y *Entrar al visor* empieza. |
| **Pestaña Fenómenos** | SIGMET vigentes con su veredicto de cruce con la ruta, y debajo los fenómenos interpretados. Clic en un aviso para encuadrarlo en el mapa. |
| **Pestaña Alterno** | Matriz ponderada. Mover un peso recalcula el ganador en vivo. |
| **Exportar a PDF** | Botón al final de la pestaña Alterno; usa la impresión del navegador. |

---

## Cambiar de ruta o de caso

Todo el visor se configura desde **`datos/caso.json`**. No hay que tocar el código.

1. **Vuelo y ventana temporal** — `vuelo` y `ventanaTiempo`. `horaAnalisisZ` es la
   hora a la que arranca el visor.
2. **Aeródromos** — `aerodromos[]`. El campo `rol` acepta `origen`, `destino` o
   `alterno`; los alternos aparecen automáticamente en la matriz de decisión.
   `tipoAlterno` distingue el alterno de destino del alterno de ruta.
3. **Ruta** — `ruta.waypoints[]` en orden. Tipos: `aerodromo`, `toc`, `tod`,
   `vor`, `waypoint`; `via` guarda la aerovía por la que se llega a cada punto y
   `ruta.aerovias[]` documenta cada tramo con su referencia del AIP.
4. **Navegación** — `navegacion.vor[]` (ENR 4.1) y `navegacion.zonas[]` (ENR 5.1)
   alimentan las dos capas del grupo *Navegación*. Cada zona lleva calculada su
   separación a la ruta: las que están a 5 NM o menos se dibujan resaltadas.
5. **Fenómenos** — polígonos en `datos/fenomenos.geojson`, cada uno con su ficha
   (evidencia, interpretación, impacto, recomendación) y la banda que lo revela.
6. **Alternos** — pesos en `alternos.criterios` y puntuaciones en
   `alternos.evaluacion`. `meteo` se **recalcula solo** con el METAR de la hora
   seleccionada; `distancia`, `pista` y `ayudas` se calculan con las fórmulas
   escritas en `alternos.metodo` y su memoria de cálculo queda en
   `alternos._memoriaCalculo`. El criterio de horario y servicios se retiró de la
   matriz a propósito: ese dato (AD 2.3 / AD 2.4) no está en la base, y puntuarlo
   habría sido inventarlo.
7. **Escenas** — el guion de la sustentación, en `escenas[]`.

### Añadir los medios de SLIDER

Exportar desde <https://rammb-slider.cira.colostate.edu/> y guardar en
`medios/satelite/<id-de-banda>/`. Luego declararlo en la banda correspondiente:

```jsonc
// Captura única
"medio": { "tipo": "imagen", "archivo": "medios/satelite/ir-c13/1340z.png" }

// Animación exportada. Con inicioZ/finZ, la barra de tiempo recorre el video.
"medio": {
  "tipo": "video",
  "archivo": "medios/satelite/ir-c13/animacion.mp4",
  "inicioZ": "2026-08-31T11:00:00Z",
  "finZ":    "2026-08-31T17:00:00Z"
}

// Cuadros sueltos: sincronización exacta con la hora seleccionada.
"medio": {
  "tipo": "secuencia",
  "cuadros": [
    { "horaZ": "2026-08-31T13:00:00Z", "archivo": "medios/satelite/ir-c13/1300z.png" },
    { "horaZ": "2026-08-31T13:30:00Z", "archivo": "medios/satelite/ir-c13/1330z.png" }
  ]
}
```

**Guardar siempre el `permalink` de SLIDER** de cada banda. La URL lleva satélite,
sector, producto, zoom y rango temporal: es la prueba de trazabilidad del análisis.

### Superponer una banda sobre el mapa

Añadir a la banda las esquinas del recorte, `[[latSur, lonOeste], [latNorte, lonEste]]`:

```jsonc
"esquinas": [[0.0, -80.0], [16.0, -68.0]]
```

Aparece entonces la capa *Superposición satelital (aprox.)*.

> **Advertencia metodológica.** SLIDER entrega proyección **geoestacionaria**, no
> Web Mercator. Anclar una captura por sus esquinas es una aproximación válida
> solo en recortes regionales pequeños, y el visor lo rotula como tal. El modo
> correcto para el análisis es el **panel satelital**, que conserva la geometría
> original. Conviene declararlo así en el informe.

---

## Estructura

```
index.html                 Visor
css/estilo.css             Tema oscuro + hoja de impresión
js/
  app.js                   Arranque y cableado de módulos
  util.js                  Bus de eventos, tiempo Zulu, geometría
  mapa.js                  Leaflet, ruta, aeródromos, radioayudas, zonas, anillos, aeronave
  capas.js                 Registro de capas, toggles y opacidad
  tiempo.js                Barra de tiempo Zulu
  metar.js                 METAR/TAF: vigencia, decodificación, categoría
  decodificar.js           Desmonta METAR, TAF y SIGMET grupo a grupo
  fenomenos.js             Polígonos y fichas de análisis
  geoestacionaria.js       Proyección GOES-R: sitúa la ruta dentro de la imagen
  sigmet.js                SIGMET: consulta en vivo y cruce geométrico con la ruta
  satelite.js              Bandas, cortina comparadora, superposición
  decision.js              Matriz de alternos y bitácora
  escenas.js               Modo sustentación
  --- análisis derivado ---
  radiometria.js           Invierte la tabla de color: color de píxel → °C
  muestreo.js              Lee píxeles de los cuadros congelados por lat/lon
  productos.js             Tb → altura de tope, máscara de nube, perfil de ruta
  nucleos.js               Umbral, componentes conexas y contorno de los núcleos
  perfil.js                Corte vertical distancia × altitud
  tramos.js                Veredicto por tramo y por fase de vuelo
  vuelo.js                 Panel de vuelo (EFB), alertas y puntos de decisión
  portada.js               Portada de la sustentación, con fondo animado de la banda 13
  lateral.js               Plegado del panel de herramientas
datos/                     caso.json y datos congelados
datos/archivo/             casos anteriores completos, para poder volver a ellos
medios/satelite/           Capturas y animaciones de SLIDER
herramientas/              servidor.mjs, capturar-*.mjs y derivar-fenomenos.mjs
informe/informe.md         Informe escrito
vendor/leaflet/            Leaflet local (funciona sin internet)
Simulador-NALA.html        Proyecto hermano. Fuente de la base aeronáutica
                           (AIRPORTS, AIRWAYS, VOR_STATIONS, WAYPOINTS,
                           RESTRICTED_ZONES) de la que se tomó este caso
```

## Fuentes

- **Satélite:** CIRA/RAMMB SLIDER, Colorado State University — GOES-19 (GOES-East)
- **METAR / TAF / SIGMET:** Aviation Weather Center (NOAA), `aviationweather.gov/api`
- **Ruta, aeródromos, radioayudas y espacio aéreo:** eAIP Colombia (Aerocivil),
  AIRAC A 73-26 — AD 2.2, AD 2.12, ENR 3.1, ENR 3.2, ENR 4.1, ENR 4.4, ENR 5.1.
  Cargados desde la base aeronáutica del proyecto **Simulador NALA**
  (`Simulador-NALA.html` en la raíz)
- **Cartografía:** Esri (Dark Gray Canvas, World Imagery), OpenTopoMap, OpenStreetMap

> Se descartó CARTO como mapa base: desde que exige `apikey` entrega los tiles con
> la marca de agua «API KEY REQUIRED» incrustada, y responde 200 igualmente.
- **Radar:** RainViewer
