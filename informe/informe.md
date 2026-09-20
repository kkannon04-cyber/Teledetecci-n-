# Análisis de teledetección aplicada a una ruta aeronáutica

**Autor:**
**Asignatura:** Teledetección
**Fecha:**
**Caso analizado:** SKVV → SKLT, 2026-09-07 a las 1830Z (13:30 hora de Colombia) — ETA 2055Z
**Ruta ATS:** `SKVV VVC A301 UBRID B689 DUBRA A301 ISORI A301 ASKAT A301 DADIL A301 ROKUL SKLT` — 553 NM
**Aeronave y velocidad:** ATR 72-600 a 250 kt — 2 h 25 min de vuelo
**Nivel de crucero:** FL210 (impar, por semicírculo 000–179 magnético)
**Cobertura de los productos:** Colombia entera (continental e insular) + 1,5° de margen

---

## 1. Introducción y objetivo

> Qué se analiza y para qué. El objetivo operacional concreto: identificar los
> fenómenos meteorológicos que pueden afectar la ruta a la hora seleccionada y
> seleccionar un aeropuerto alterno justificado.

## 2. Marco teórico

### 2.1 Fundamentos de teledetección meteorológica

> Radiación electromagnética, ventanas atmosféricas, radiómetros de barrido.
> Diferencia entre teledetección pasiva (satélite meteorológico) y activa (radar).

### 2.2 El instrumento ABI de la serie GOES-R

> 16 bandas espectrales, resolución espacial de 0.5 a 2 km, resolución temporal
> de 10 min en Full Disk y hasta 1 min en sector mesoescala. Órbita geoestacionaria
> a 35 786 km y sus implicaciones: cobertura continua de la misma zona, pero
> deformación creciente hacia el limbo.

### 2.3 Interpretación por banda

Las ocho bandas de la tabla son las que este trabajo descarga y analiza; las dos
últimas filas son productos derivados que se obtienen combinándolas.

| Banda | λ (µm) | Magnitud física | Uso operacional |
|---|---|---|---|
| 1 — Visible azul | 0.47 | Reflectancia solar | Aerosoles, bruma y humo por dispersión Rayleigh |
| 2 — Visible rojo | 0.64 | Reflectancia solar | Textura, torres convectivas, sombras del yunque |
| 4 — Cirros | 1.37 | Reflectancia en banda de absorción del H₂O | Cirro alto aislado: el H₂O bajo absorbe y el suelo sale negro |
| 5 — Nieve y hielo | 1.6 | Reflectancia solar | Fase del agua: hielo oscuro, agua líquida clara → engelamiento |
| 7 — Ventana onda corta | 3.9 | Emisión térmica + reflexión solar | Niebla y estratos nocturnos, focos de calor |
| 9 — Vapor de agua medio | 6.9 | Radiancia en banda de absorción del H₂O | Humedad y cortantes hacia 400–500 hPa, turbulencia en aire claro |
| 10 — Vapor de agua bajo | 7.3 | Radiancia en banda de absorción del H₂O | Humedad hacia 600–750 hPa: la capa del nivel de crucero |
| 13 — IR ventana limpia | 10.3 | Temperatura de brillo del tope | Severidad convectiva, altura del tope |
| Diferencia 10.3 − 3.9 | — | Contraste de emisividad | Niebla y estratos bajos nocturnos |
| Diferencia 6.9 − 7.3 | — | Humedad relativa entre dos capas | Si la columna está cargada arriba o solo abajo |

> Explicar por qué la temperatura de brillo del tope es un indicador de severidad:
> relación con el perfil térmico de la atmósfera y con la altura alcanzada por la
> corriente ascendente.

### 2.4 Limitaciones de la teledetección satelital

> Solo se observa el **tope** de la nube, no su interior ni su base.
> El visible no funciona de noche. La resolución espacial limita la detección de
> fenómenos de pequeña escala. Ausencia de información directa sobre turbulencia y
> engelamiento: se **infieren** a partir de indicadores indirectos. De ahí la
> necesidad de cruzar con METAR, TAF, SIGMET y PIREP.

## 3. Metodología

1. Definición del caso: ruta, hora Z de análisis y ventana temporal.
2. Construcción de la ruta sobre aerovías ATS publicadas en el AIP Colombia
   (ENR 3.1 / 3.2), tomando cada punto significativo de ENR 4.1 (VOR/DME) y
   ENR 4.4 (fijos de ruta), sin puntos inventados.
3. Elección del nivel de crucero por la tabla semicircular, a partir del rumbo
   magnético de cada tramo (§3.2).
4. Descarga automatizada de las bandas ABI 1, 2, 4, 5, 7, 9, 10 y 13 desde
   CIRA/RAMMB SLIDER, recortadas a **Colombia entera** mediante la proyección
   geoestacionaria del GOES-R PUG y verificadas contra NASA GIBS
   (`herramientas/capturar-satelite.mjs`). El recorte NO se ciñe al corredor: la
   caja es la unión del territorio nacional —continental e insular— y de la propia
   ruta, ambas con 1,5° de margen, de modo que ampliar la cobertura no puede
   dejar fuera ningún punto del trazado. Está declarada en `caso.cobertura`.
5. Congelado de la frontera nacional y la división departamental
   (`herramientas/capturar-limites.mjs`), para poder situar sobre la imagen
   satelital lo que se interpreta en ella.
6. Congelado de METAR, TAF y SIGMET mediante la API del Aviation Weather Center,
   también sobre la caja nacional y no solo sobre los seis aeródromos del caso.
   Los SIGMET se piden **barriendo la ventana entera hora a hora**, no en un solo
   instante: en este caso tres de los avisos que cruzan la ruta se emitieron con
   el vuelo ya despegado y una consulta puntual no los habría traído.
7. Identificación de fenómenos por interpretación multiespectral y delimitación
   de polígonos.
8. Contraste de lo detectado remotamente con lo medido en superficie.
9. Evaluación ponderada de alternos y decisión operacional.

### 3.1 Trazabilidad

> Tabla con el permalink de SLIDER de cada banda utilizada y la hora exacta de
> captura de los datos meteorológicos. Permite que un tercero reproduzca el análisis.

| Banda | Producto SLIDER | Resolución | Cuadros | Permalink |
|---|---|---|---|---|
| 1 — Azul visible, 0,47 µm | `goes-19/full_disk/band_01` | 1 km (zoom 4) | 28 · 1730–2200Z | <https://rammb-slider.cira.colostate.edu/?sat=goes-19&sec=full_disk&p%5B0%5D=band_01> |
| 2 — Rojo visible, 0,64 µm | `goes-19/full_disk/band_02` | **0,5 km** (zoom 5) | 28 · 1730–2200Z | <https://rammb-slider.cira.colostate.edu/?sat=goes-19&sec=full_disk&p%5B0%5D=band_02> |
| 4 — Cirros, 1,37 µm | `goes-19/full_disk/band_04` | 2 km (zoom 3) | **27** · 1730–2200Z | <https://rammb-slider.cira.colostate.edu/?sat=goes-19&sec=full_disk&p%5B0%5D=band_04> |
| 5 — Nieve/hielo, 1,6 µm | `goes-19/full_disk/band_05` | 1 km (zoom 4) | 28 · 1730–2200Z | <https://rammb-slider.cira.colostate.edu/?sat=goes-19&sec=full_disk&p%5B0%5D=band_05> |
| 7 — Onda corta, 3,9 µm | `goes-19/full_disk/band_07` | 2 km (zoom 3) | 28 · 1730–2200Z | <https://rammb-slider.cira.colostate.edu/?sat=goes-19&sec=full_disk&p%5B0%5D=band_07> |
| 9 — Vapor medio, 6,9 µm | `goes-19/full_disk/band_09` | 2 km (zoom 3) | 28 · 1730–2200Z | <https://rammb-slider.cira.colostate.edu/?sat=goes-19&sec=full_disk&p%5B0%5D=band_09> |
| 10 — Vapor bajo, 7,3 µm | `goes-19/full_disk/band_10` | 2 km (zoom 3) | 28 · 1730–2200Z | <https://rammb-slider.cira.colostate.edu/?sat=goes-19&sec=full_disk&p%5B0%5D=band_10> |
| 13 — Ventana limpia, 10,3 µm | `goes-19/full_disk/band_13` | 2 km (zoom 3) | 28 · 1730–2200Z | <https://rammb-slider.cira.colostate.edu/?sat=goes-19&sec=full_disk&p%5B0%5D=band_13> |

Todas del **7 SEP 2026**, cada 10 minutos, recortadas a la caja de cobertura
nacional. La caja pedida es lat −5,73…14,90 · lon −83,25…−65,35 y el recorte que
sale de la rejilla del satélite, algo mayor, lat −5,76…14,95 · lon −83,60…−64,92:
cubre desde Providencia y la Guajira hasta el trapecio amazónico. El zoom empleado
es la **resolución nativa** de cada banda: pedir más sería interpolar.

La ventana —1730Z a 2200Z— es una hora anterior a la salida y una hora posterior a
la ETA, redondeada al barrido de disco completo siguiente: GOES-19 barre en punto
cada 10 min, así que el primer cuadro posterior a ETA+1 h (2155Z) es el de 2200Z.

> **Huecos declarados.** Uno solo, y afecta a una sola banda: **la banda 4 no tiene
> el cuadro de las 2020Z**. CIRA/RAMMB no publica ese barrido para el canal de
> 1,37 µm del 7 de septiembre; las otras siete bandas sí lo tienen, así que no es un
> corte del satélite sino de ese producto concreto. La banda 4 queda con 27 cuadros
> frente a los 28 de las demás. **No se rellena con el cuadro vecino**: el visor
> muestra el más próximo en el tiempo y el hueco queda anotado en
> `medios/satelite/verificacion.md`. Ninguna escena del análisis se apoya en ese
> instante —la de cirros lee la banda 4 a las 1850Z—, así que no condiciona ninguna
> conclusión.
>
> Fuera de eso la serie está completa: 28 cuadros cada 10 minutos de 1730Z a 2200Z
> en las otras siete bandas, sin cortes. El caso se analiza el día siguiente al del
> vuelo, así que —a diferencia de la captura del 4 de septiembre— el satélite ya
> había barrido toda la ventana en el momento de la descarga.

> **Una trampa que hubo que cerrar.** Al mover el caso del 1 al 4 de septiembre, la
> descarga incremental reutilizó dos cuadros del día 1 —las 1640Z y las 1740Z— porque
> el archivo ya existía con ese nombre y la configuración de recorte no había
> cambiado. Es decir: dos imágenes de otro día se habrían presentado como del día
> analizado. El capturador guarda desde entonces en `parametros.json` la lista de
> sellos que él mismo escribió, reutiliza solo lo que figura en ella y **borra** lo
> que no, de modo que un cuadro huérfano no puede heredarse.
>
> Ese mecanismo es el que ha permitido mover el caso otra vez, del 4 al 7 de
> septiembre y del corredor al país entero, sin arrastrar nada: al no coincidir ni
> la fecha ni el recorte con los de `parametros.json`, la serie anterior se borró
> por completo y las ocho bandas se rebajaron desde cero.

**Cómo se comprobó que las imágenes son las que dicen ser.** El recorte exige
traducir latitud y longitud a píxel dentro del disco geoestacionaria, y esa
traducción es la parte que puede fallar en silencio. Se validó así:

1. *Geolocalización contra una fuente independiente.* Las bandas 2 y 13 son las
   únicas que NASA GIBS publica ya georreferenciadas. La caja nacional se volvió a
   validar con `--verificar` **antes** de bajar la serie del 7 de septiembre:
   mismo instante (1730Z) y misma caja pedidos a las dos fuentes, una en proyección
   geoestacionaria calculada aquí y otra en Web Mercator georreferenciada por la
   NASA. Los sistemas nubosos —la banda convectiva del Caribe occidental, las
   células aisladas sobre el llano y el límite del yunque amazónico— caen en los
   mismos píxeles en ambas imágenes, y la línea de costa del Caribe y la Guajira
   coinciden en los dos ejes. Como las ocho bandas usan la misma rejilla fija del
   ABI y comparten ventana de píxeles, la validación se extiende a las otras seis,
   incluidas las bandas 4, 9 y 10, que GIBS no publica. Las dos imágenes de
   contraste están en `medios/satelite/referencia-gibs-band_02.jpg` y
   `referencia-gibs-band_13.jpg`.
2. *Identidad radiométrica.* Un archivo llamado `band_05` no prueba ser 1,6 µm. Cada
   banda tiene una firma que se comprobó mirando el recorte de las 1830Z del 7 SEP,
   la hora de análisis del caso:

   - **Banda 5 (1,6 µm).** Los ríos amazónicos salen **negros** y los topes glaciados
     aparecen como discos **oscuros con anillo claro** de agua líquida, justo al revés
     que en el visible.
   - **Banda 4 (1,37 µm).** El fondo es **negro por completo**: ni costas, ni ríos, ni
     nube baja. Lo único que aparece son filamentos claros de cirro y los topes de la
     convección profunda. Es la prueba de que el vapor de agua de los niveles bajos
     está absorbiendo la radiación solar antes de que llegue al satélite, que es
     exactamente lo que define a esta banda. En la 2 o la 13 la misma escena enseña
     toda la superficie amazónica.
   - **Bandas 9 y 10 (6,9 y 7,3 µm).** Ninguna de las dos muestra rasgo alguno del
     terreno —son bandas de absorción del H₂O, no ventanas— y las dos comparten los
     mismos núcleos convectivos en los mismos píxeles. Pero sus campos de humedad son
     **claramente distintos**: la 10, que pesa más abajo, sale mucho más «seca» sobre
     el corredor que la 9. Si fueran el mismo canal duplicado se verían iguales.
   - **Bandas 7 y 13.** Sitúan las mismas células convectivas en los mismos píxeles
     con renderizados distintos.

   > **Las imágenes son el producto renderizado de SLIDER, no radiancias
   > calibradas.** SLIDER aplica a cada banda su realce por defecto —las de vapor de
   > agua llegan en falso color— y eso es lo que se descarga. Sirve para interpretar
   > estructuras y compararlas entre bandas, no para leer temperaturas de brillo
   > en grados: para eso harían falta los ficheros NetCDF del ABI.
   >
   > Precisamente por eso el proyecto congela también la **tabla de color** de cada
   > banda (`herramientas/capturar-barras.mjs` → `datos/barras-color.json`), tomada
   > de la barra que el propio SLIDER publica: sin ella el color de una nube no es
   > un dato. Las bandas 1, 2, 4 y 5 salen en gris **sin valores publicados** —son
   > reflectivas, no miden temperatura—; la 7 va de +120 a −70 °C, las 9 y 10 de +5
   > a −80 °C, y la 13 de +40 a −90 °C con el color empezando exactamente en
   > −30 °C. Los umbrales que se citen en §5 deben salir de esa escala, no de una
   > apreciación del color a ojo.

Las imágenes de contraste quedan en `medios/satelite/referencia-gibs-*.jpg`, y la
trazabilidad completa de la captura —parámetros, ventana de píxeles de cada banda,
teselas descargadas y URL de origen— en `medios/satelite/verificacion.md`.

**Procedencia de los datos aeronáuticos.** Todo dato de aeródromo, ruta,
radioayuda o espacio aéreo citado en este informe procede del eAIP Colombia
(Aerocivil), **AIRAC A 73-26**, vigente desde el 09 JUL 2026:

| Dato | Referencia AIP |
|---|---|
| Coordenadas ARP y elevación | AD 2.2 |
| Designación, longitud, ancho y superficie de pista | AD 2.12 |
| Aerovías ATS (A301, B689) | ENR 3.1 (inferiores), ENR 3.2 (superiores) — **no contrastadas**, ver más abajo |
| VOR/DME (VVC, SJE, MTU, PDA, LET, FLA, TQS, PLG, SVC, MDU, SOA) | ENR 4.1 |
| Fijos de ruta (UBRID, DUBRA, ISORI, ASKAT, DADIL, ROKUL) | ENR 4.4 |
| Zonas prohibidas, restringidas y peligrosas | ENR 5.1 |
| Frontera nacional y límites departamentales | **fuera del AIP**: Natural Earth 1:10 M (dominio público), ver más abajo |
| Declinación magnética de cada punto de la ruta | **fuera del AIP**: WMM-2025 del NOAA/NCEI, época 2026-09-04, ±0,33° — válida para el 7: en tres días el modelo varía milésimas de grado |

> **Las aerovías A301 y B689 no se pudieron contrastar.** Los siete puntos de la
> ruta sí están publicados (VVC en ENR 4.1; los otros seis en ENR 4.4), pero
> ninguno de los dos designadores figura en la tabla de aerovías de la base
> consultada. El trazado usa las coordenadas reales de los siete puntos y los
> designadores quedan marcados como no verificados.

**Frontera nacional y límites departamentales.** No salen del AIP —no es un dato
aeronáutico— sino de **Natural Earth 1:10 M**, dominio público, capas
`ne_10m_admin_0_countries` y `ne_10m_admin_1_states_provinces`. Se dibujan sobre el
mapa y, reproyectados a la rejilla del ABI, sobre las propias bandas: sin ellos, el
panel satelital es una imagen de nubes sobre negro y al acercarse a una célula no
hay forma de decir sobre qué departamento está. La elección de fuente está
razonada: el **IGAC**, que sería la fuente oficial colombiana, no publica una capa
de límites departamentales en su servidor ArcGIS abierto, y **geoBoundaries**, que
sí sirve Colombia, toma el país de Wikimedia y los departamentos de OpenStreetMap:
al proceder de fuentes distintas, la línea nacional y la unión de los departamentos
no tienen por qué coincidir, y ese desajuste sería visible en pantalla. Natural
Earth mantiene ambos niveles como un conjunto coherente.

> Es **cartografía general a 1:10 M**: sirve para situarse sobre la imagen, no para
> medir, y los trazados de frontera no son competencia de este trabajo. Se aplicó
> además una corrección declarada: Natural Earth arrastra la división anterior a
> 1991 y rotula como *Intendencia* (Arauca, Caquetá, Casanare, Putumayo) o
> *Comisaría* (Amazonas, Guainía, Guaviare, Vaupés, Vichada) a nueve territorios que
> la **Constitución de 1991, art. 309**, elevó a departamento. Figuran aquí como
> departamento, con el valor original conservado en `_tipoFuente`. Un décimo rasgo
> llega sin nombre —la fuente lo rotula «Colombia minor island» y por posición es
> **Malpelo**—: se conserva por ser territorio nacional dentro de la cobertura del
> caso, pero **no se le atribuye departamento**, porque la fuente no lo trae.

Quedan **explícitamente fuera** por no estar publicados en la base consultada:
tipo de aproximación por pista (AD 2.19), horario de operación (AD 2.3) y
servicios en tierra (AD 2.4). Por eso el criterio de radioayuda de la matriz de
alternos puntúa la proximidad del VOR/DME de referencia —dato publicado— y no la
disponibilidad de ILS. Son datos calculados, no publicados, el TOC, el TOD y las
puntuaciones de distancia, pista y radioayuda; sus fórmulas están en
`datos/caso.json → alternos.metodo` y la memoria de cálculo en
`alternos._memoriaCalculo`.

Las zonas ENR 5.1 se representan como círculos de 5 NM alrededor del punto de
referencia publicado: el AIP remite el trazado lateral al RAC 5-1.3 y a las
cartas de radionavegación, que no son texto. Sirven para **situar** el conflicto
—SKR7 Villavicencio, de 9 000 a 19 000 ft, cubre el propio aeródromo de salida y
condiciona el nivel de crucero (§3.2)—, no para medir separaciones.

### 3.2 Elección del nivel de crucero

El nivel no es una preferencia del operador: lo impone la **tabla de niveles de
crucero** del Anexo 2 de OACI, Apéndice 3, adoptada por el RAC 91 de Colombia. Por
debajo de FL290 y en vuelo IFR, una derrota **magnética** de 000° a 179° exige
niveles **impares** y de 180° a 359°, **pares**.

El rumbo magnético cambia a lo largo de 553 NM, así que se calcula tramo a tramo:
rumbo verdadero por ortodrómica sobre las coordenadas publicadas, y declinación
consultada punto a punto al **WMM-2025 del NOAA/NCEI** para el 04 SEP 2026. Al
mover el caso al 7 de septiembre esos valores NO se recalcularon, y no hace falta:
la variación secular del modelo en tres días es de milésimas de grado, dos órdenes
de magnitud por debajo de su propia incertidumbre declarada de ±0,33°.

| Tramo | Rumbo verdadero | Declinación | Rumbo magnético | Semicírculo |
|---|---|---|---|---|
| SKVV → VVC | 114,0° | −9,04° | 123,0° | 000–179 |
| VVC → UBRID | 154,2° | −9,21° | 163,4° | 000–179 |
| UBRID → DUBRA | 151,1° | −9,64° | 160,7° | 000–179 |
| DUBRA → ISORI | 160,2° | −10,00° | 170,2° | 000–179 |
| ISORI → ASKAT | 160,2° | −10,22° | 170,4° | 000–179 |
| ASKAT → DADIL | 160,2° | −10,40° | 170,6° | 000–179 |
| DADIL → ROKUL | 160,2° | −10,56° | 170,8° | 000–179 |
| ROKUL → SKLT | 160,2° | −10,69° | 170,9° | 000–179 |

Todos los tramos caen en el mismo semicírculo, así que **la ruta entera es de
niveles impares**. El tramo más cercano al cambio es ROKUL → SKLT con 170,9°:
quedan 9,1° hasta los 180° que invertirían la regla, muy por encima de la
incertidumbre del modelo magnético (±0,33°). FL200 —el nivel «natural» de un ATR
en este sector— corresponde al sentido contrario y **no es asignable**.

Entre los impares posibles se descarta **FL190** porque 19 000 ft es exactamente el
techo publicado de la zona restringida **SKR7 (Villavicencio, 9 000–19 000 ft)**,
que cubre el aeródromo de salida: nivelar en el límite superior de una restringida
no deja margen ante la variación de QNH. Se asigna **FL210**, que además obliga a
recalcular el perfil vertical (TOC a 55 NM, TOD a 66 NM del destino).

Lo que esto no resuelve: FL210 sigue estando muy por debajo de los topes
convectivos amazónicos, que en esta zona superan con holgura FL400. La restricción
de nivel no da margen para sobrevolar la convección, solo para rodearla — y ese es
el condicionante que atraviesa todo el análisis de §5.

### 3.3 Georreferenciación de las imágenes

Los recortes se muestran en su **geometría original**, la rejilla fija del ABI en
proyección geoestacionaria. No se reproyectan a Web Mercator para encajarlos sobre
el mapa: hacerlo a partir de capturas, y no de los datos originales, introduciría un
error que además quedaría disimulado bajo la cartografía.

Lo que sí se hace es lo contrario, que no tiene ese problema: **llevar la ruta a la
imagen**. El visor repite en el navegador la misma proyección del GOES-R PUG que usó
el recorte —con los parámetros guardados en `satelite._recorte.proyeccion`— y calcula
en qué píxel de cada banda cae cada latitud y longitud. Sobre la imagen se dibujan
así la ruta, los aeródromos con su OACI, la posición del avión a la hora de la barra
de tiempo y una retícula de meridianos y paralelos cada 5°.

En el mapa, de forma complementaria, la capa **Cobertura de las bandas** dibuja el
contorno real de lo que abarcan las imágenes. Sale ligeramente curvado, y debe salir
así: el recorte es un rectángulo en la rejilla del satélite, no en el mapa.

Las ocho bandas comparten **exactamente** el mismo contorno geográfico. La ventana
de píxeles se calcula una sola vez a zoom 3 y las demás la heredan multiplicada por
potencias de dos; sin eso, el redondeo a píxel entero de cada nivel de zoom las
descuadraba un par de kilómetros entre sí y la comparación por cortina dejaba de
enfrentar los mismos puntos.

### 3.4 De color de píxel a temperatura de brillo

Las imágenes de SLIDER no son radiancias calibradas: son **el producto ya
renderizado**, cada banda con su tabla de color. Mientras esa tabla no se invierta,
«la nube sale roja» es una impresión y no una medida, y todo el análisis se queda
en lo cualitativo. El proyecto invierte la tabla (`js/radiometria.js`) usando la
rampa y las marcas que publica el propio servidor, congeladas en
`datos/barras-color.json`.

**La ambigüedad del gris.** La tabla `ircimss2` de la banda 13 usa el gris **dos
veces**: la rampa cálida va de negro en +40 °C a gris claro en −30 °C, y la cola
fría vuelve a arrancar en negro a −80 °C y aclara hasta blanco en −90 °C. Un píxel
gris, por su color, puede ser selva al sol o la cima de un cumulonimbo: 120 °C de
diferencia. El color no lo resuelve, así que se resuelve por **conectividad**:

1. Se inunda la imagen desde el borde pasando solo por píxeles grises. Al gris que
   se alcanza desde fuera se llega por el suelo, luego es suelo.
2. El gris que queda encerrado y **toca color del extremo frío** es la cima del
   núcleo. No es una heurística de conveniencia: es la estructura física de un
   cumulonimbo, cuya cima más fría está siempre dentro de su propio yunque.

El segundo umbral importa más de lo que parece. En una primera versión bastaba con
tocar «color frío» de cualquier tipo (−30 °C), y entonces **una mota de compresión
JPEG perdida dentro de un yunque a −45 °C recibía −88 °C**: cuarenta y tres grados
inventados por un artefacto. Exigir adyacencia con color de −72 °C o menos respeta
la continuidad de la propia rampa —del color a la cola gris se pasa por −80, no por
−45— y redujo los grises reclasificados de unos 25 000 por cuadro a unos 1 000.

**Verificación independiente.** El resultado se contrastó contra otras bandas del
mismo instante y la misma rejilla. Sobre el centro de los núcleos, la banda 9
(vapor de agua, 6,9 µm) queda entre 3 y 5 °C por debajo de la banda 13, que es la
convergencia esperable en topes que alcanzan la alta troposfera. Si la inversión
estuviera fabricando frío, las dos bandas no coincidirían.

**De temperatura a altura.** La altura del tope sale de un modelo declarado:

> `z_tope = z_estación + (T_estación − Tb) / Γ`, con **Γ = 6,5 °C/km**

Γ es el gradiente de la troposfera de la Atmósfera Tipo OACI (Doc 7488), que es un
valor publicado. Lo que **no** es publicado es que ese gradiente valga para la
Amazonía el 07 SEP 2026: sin radiosondeo no hay forma de comprobarlo. Por eso
`T_estación` y `z_estación` no son de atmósfera tipo sino del **METAR real más
cercano al punto y a la hora**, y por eso toda altura sale rotulada como calculada,
con la estación que la ancla escrita al lado.

Una corroboración cómoda: en el entorno de Mitú, donde el METAR declara `BKN035`
—base a 3 500 ft—, el modelo deriva topes del orden de 4 800 ft. Son magnitudes
compatibles, y proceden de dos instrumentos que no se hablan entre sí.

**Máscara de nube.** El modelo le calcularía «altura de tope» también al suelo
desnudo. Solo se considera nube el píxel cuya temperatura de brillo está **más de
10 °C por debajo** de la del METAR de anclaje; por debajo de ese corte el campo se
deja vacío, no en cero. El umbral es un corte razonado y declarado, no un producto
calibrado, y tiene una consecuencia conocida: un estrato bajo tropical, cuyo tope
está casi a la temperatura del suelo, **no se separa del terreno** (véase §6.2).

### 3.5 Detección y seguimiento de núcleos convectivos

Un polígono dibujado a ojo sobre la imagen no se puede defender: nadie puede
reproducirlo ni discutir dónde acaba. Los de este trabajo salen de
`herramientas/derivar-fenomenos.mjs` y se obtienen idénticos en cada ejecución
—comprobado— con este procedimiento:

| Paso | Criterio | Por qué ese valor |
|---|---|---|
| Umbral | Tb ≤ **−52 °C** | Corte de «convección profunda». Con el modelo de §3.4 ese tope queda muy por encima de FL210, y es bajo de sobra para excluir cirro delgado y nubosidad media. |
| Tamaño mínimo | **80 píxeles** (~320 km²) | Por debajo, la componente es ruido de umbral o una torre aislada que no define un área a evitar. |
| Corredor | **120 NM** de la ruta | Más lejos no condiciona esta navegación. |
| Enlace temporal | centroides a **≤ 45 NM** entre cuadros consecutivos | A 10 min eso son 270 kt: techo generoso para propagación convectiva. |

**Por qué percentil y no mínimo.** La severidad se clasifica por el **percentil 5**
de la temperatura de brillo de cada componente, no por su mínimo. El mínimo es el
valor de un solo píxel y el anillo de compresión del JPEG en el borde del núcleo
puede fabricarlo; el percentil 5 exige que el 5 % del área esté igual de fría, y eso
el ruido no lo produce. El cambio movió las clasificaciones de forma apreciable:
con el mínimo, trece de catorce células salían al tope de escala de −90 °C; con el
percentil, la distribución va de −60,5 a −88,6 °C y discrimina de verdad.

**Por qué células y no manchas.** Cada núcleo se enlaza con el del cuadro anterior
por proximidad de centroide, de modo que lo que se guarda no es una mancha suelta
por imagen sino una **célula con nacimiento, máximo y final**. Eso permite algo que
una foto no permite: cruzar la vida de cada célula con la posición que ocupa la
aeronave en ese mismo instante. Que una célula corte la traza y que el **vuelo** se
la encuentre son cosas distintas —un cumulonimbo sobre ROKUL a las 2140Z no afecta
a un avión que aterrizó a las 2055Z— y es la segunda la que decide.

**Limitación del seguimiento.** El enlace por centroide puede continuar la rama
equivocada cuando dos células se fusionan o una se divide. Queda declarado en la
procedencia del propio archivo.

### 3.6 Herramientas de lectura del caso

Sobre esa base, el visor añade cuatro vistas que no son adorno sino formas de
interrogar el mismo dato:

- **Corte vertical** (`js/perfil.js`): distancia contra altitud, con el tope
  derivado y el nivel de crucero en los mismos ejes. El relleno usa la tabla de
  color de la banda 13, de modo que el color de la gráfica y el de la imagen
  significan lo mismo.
- **Análisis por tramos y fases** (`js/tramos.js`): los ocho tramos publicados con
  su rumbo magnético, su tope máximo, su porcentaje bloqueado y un veredicto
  —LIBRE / PRECAUCIÓN / EVITAR— emitido por una **regla declarada y visible en la
  propia interfaz**, no por criterio del autor.
- **Panel de vuelo y puntos de decisión** (`js/vuelo.js`): posición simulada,
  alertas con su medida de origen y opciones de desvío cuya consecuencia está
  calculada —millas extra por geometría, separación resultante, categoría del
  alterno a la hora estimada de llegada—.
- **Decodificación de partes** (`js/decodificar.js`): desmonta cada METAR, TAF y
  SIGMET en sus grupos y los traduce al lado del original, sin sustituirlo.

Se desarrolló también una vista de cabina en perspectiva, por trazado de rayos
contra el campo de alturas, y **se retiró**. El motivo es instructivo y pertenece al
propio análisis: con un píxel de 2 km, el instrumento no resuelve estructura a corta
distancia, de modo que la mitad inferior de la escena salía como una superficie lisa.
Corregirlo habría exigido añadir detalle que el sensor nunca midió, que es
exactamente lo que este trabajo se ha negado a hacer en todos los demás apartados.
El corte vertical responde a la misma pregunta —qué hay sobre el nivel de crucero y
dónde— con el mismo dato y sin fingir una resolución que no existe.

## 4. Descripción de la ruta

> Origen, destino, distancia, nivel de crucero, aeronave, tiempo estimado.
> Relieve atravesado y sus implicaciones (altitudes mínimas de seguridad).

## 5. Análisis de fenómenos

Los polígonos de este apartado **no están trazados a mano**. Salen del umbral de
temperatura de brillo descrito en §3.5, aplicado cuadro a cuadro a la banda 13, y
se reproducen idénticos ejecutando `node herramientas/derivar-fenomenos.mjs`. Lo
que sigue siendo interpretación del analista —que un tope de −74 °C implique
granizo o turbulencia severa— va marcado como tal y separado de la medida.

De las 19 a 64 componentes frías que el umbral encuentra en cada cuadro sobre la
cobertura nacional, el corredor de 120 NM y el seguimiento dejan **14 células** con
vida propia. Están en `datos/fenomenos.geojson` con su historia completa.

### 5.1 El campo convectivo se organiza contra el reloj del vuelo

El dato más importante del caso no es ninguna célula concreta: es la **tendencia**.
Midiendo el mismo perfil de ruta en tres instantes:

| Hora | Puntos con nube (de 170) | Puntos con tope sobre FL210 | Tope máximo estimado | Tb mínima |
|---|---|---|---|---|
| 1830Z (salida) | 93 | 4 · **2 %** | FL236 | −86,0 °C |
| 1930Z | 110 | 8 · **5 %** | FL327 | −83,3 °C |
| 2030Z | 76 | 24 · **14 %** | FL478 | −83,3 °C |

**Interpretación.** Es el ciclo diurno de la convección amazónica: el calentamiento
de la tarde dispara las torres, y el vuelo las encuentra en su fase más madura. La
fracción de ruta bloqueada al nivel de crucero se multiplica por siete entre la
salida y el final del trayecto, y el tope máximo derivado pasa de FL236 a FL478.

**Impacto operacional.** Lo que empeora no es la ruta entera: es **el último
tercio**. A las 2030Z los conflictos se reparten entre la milla 56 y la 504, pero
los que coinciden con la posición de la aeronave están todos más allá de la milla
450, es decir, en el descenso y la aproximación a SKLT. Un análisis hecho solo con
la imagen de la hora de salida habría declarado la ruta prácticamente limpia —2 %—
y habría fallado justo donde importa.

### 5.2 Las tres células que interceptan el vuelo

De las catorce seguidas, tres coinciden con la aeronave a menos de 20 NM. La
distancia no es la del polígono a la traza, sino la del **centroide de la célula a
la posición que ocupa el avión en ese mismo instante**, que es la pregunta
operacional de verdad (§3.5).

| Célula | Sev. | p05 Tb | Área máx. | Vida | Cuadros | Encuentro | Separación |
|---|---|---|---|---|---|---|---|
| **cb-03** | severo | −73,9 °C | 186 NM² | 1900–2110Z | 14 | 2030Z, milla 458 | **19,2 NM — la traza la atraviesa** |
| **cb-01** | severo | −72,6 °C | 163 NM² | 2010–2200Z | 12 | 2030Z, milla 458 | 16,3 NM |
| **cb-02** | severo | −71,2 °C | 243 NM² | 2020–2200Z | 11 | 2040Z, milla 496 | 15,9 NM |

**Evidencia observada.** Las tres clasifican como severas por percentil 5 de la
temperatura de brillo por debajo de −70 °C sobre el cuadro de su máximo desarrollo.
cb-03 es la más antigua de las tres: se la sigue catorce cuadros, desde las 1900Z,
o sea que ya estaba organizada dos horas antes de que el vuelo llegara a su altura.

**Interpretación del analista.** Un percentil 5 por debajo de −70 °C sitúa la cima
en la alta troposfera y es compatible con corriente ascendente intensa, granizo en
el núcleo y actividad eléctrica. La temperatura por sí sola no distingue la fase de
crecimiento de la de disipación; para eso está la serie `pasos` de cada célula, que
guarda área y percentil cuadro a cuadro.

**Impacto operacional.** Con topes de esa temperatura, **el nivel de crucero no es
una solución**: FL210 queda muy por debajo de la cima, y no hay nivel disponible
para un ATR 72-600 que la salve. La respuesta es lateral o temporal.

**Recomendación.** Desvío lateral en el tramo DADIL → TOD → ROKUL, o retraso de la
hora de paso. El visor calcula el coste de la primera opción en el punto de
decisión: para llevar la separación a 25 NM bastan unos 9 NM de desvío, que sobre
un tramo de 150 NM salen a unas 0,5 NM adicionales de recorrido. Es barato, y por
eso se decide con quince minutos de antelación y no encima del obstáculo.

### 5.3 El campo de fondo: cb-09 y cb-05

Dos células grandes no llegan a interceptar el vuelo pero explican el entorno.
**cb-09** es la mayor del caso —3 045 NM² en su máximo, seguida veintiséis cuadros,
de 1730Z a 2140Z— y pasa a 73,7 NM de la ruta; **cb-05** alcanza 934 NM² y se sigue
veintiún cuadros. Ninguna condiciona la navegación por sí misma, pero su tamaño y
su persistencia describen un campo convectivo organizado y no un par de torres
aisladas, que es lo que justifica planificar el desvío en vez de improvisarlo.

### 5.4 Lo que este análisis NO puede afirmar

Cuatro límites, todos verificados durante el desarrollo y no supuestos:

1. **El satélite mide el tope, no la nube.** Bajo esa superficie no hay dato: ni
   base, ni cizalladura, ni granizo en superficie. El corte vertical dibuja por eso
   una columna desde el tope hacia abajo, sin afirmar dónde empieza la nube.
2. **La escala satura.** La barra publicada de la tabla `ircimss2` no rotula por
   debajo de −90 °C. Los mínimos que llegan a ese valor son un **límite**, no una
   medida, y salen marcados. Por eso la severidad se clasifica por percentil 5 y no
   por el mínimo.
3. **El gris es ambiguo y se resuelve por vecindad, no por color.** El
   procedimiento está en §3.4; tiene un coste: entre 7 y 18 de los 170 puntos del
   perfil quedan sin lectura concluyente según la hora, y el visor los rotula como
   ambiguos en vez de rellenarlos.
4. **La altura de tope es un cálculo, no una observación.** Depende de un gradiente
   térmico tipo y de un METAR de anclaje. Se explica en §3.4 y la gráfica lo lleva
   escrito en su propio pie.

## 6. Contraste con observaciones de superficie

Aquí es donde el trabajo deja de ser una lectura de imágenes. La pregunta no es si
el satélite «acierta», sino **qué ve cada fuente que la otra no puede ver**.

### 6.1 El destino: dos relatos que no se contradicen

A las 2030Z el satélite deriva topes de hasta FL478 en el último tercio de la ruta
y tres células severas a menos de 20 NM de la aeronave. En tierra, el mismo
aeródromo de destino informa:

| Hora | Categoría | METAR |
|---|---|---|
| 1900Z | VFR | `SKLT 071900Z 18008KT 130V210 9999 2000E RA SCT020 29/25 Q1010` |
| 2000Z | VFR | `SKLT 072000Z 21009KT 170V240 9999 SCT037 30/26 Q1009` |
| 2100Z | MVFR | `SKLT 072100Z 20007KT 160V230 8000 VCSH SCT020 29/25 Q1008` |
| 2200Z | VFR | `SKLT 072200Z 18005KT 150V210 9999 SCT020 29/25 Q1009` |

No hay contradicción: **hay complementariedad**. El METAR describe el cilindro de
aire sobre la pista y dice que el campo está operable —visibilidad 8 000 m en el
peor momento, nubosidad dispersa—. El satélite describe los 100 NM anteriores, por
donde hay que pasar para llegar, y dice que ahí hay cumulonimbos maduros. Un vuelo
que solo leyera el METAR de destino saldría convencido de tener el día resuelto.

Y hay una confirmación cruzada explícita: el grupo **`2000E RA` de las 1900Z**
—lluvia al este, a 2 000 m— y el **`VCSH` de las 2100Z** son el mismo fenómeno que
el infrarrojo está viendo como núcleos fríos en las proximidades, visto desde
abajo. Dos instrumentos independientes, la misma conclusión.

### 6.2 Dónde falla cada fuente

- **El satélite no vio** el episodio de nube muy baja del mediodía en SKLT
  (`OVC004` y `BKN008` con `BR` entre 1100Z y 1200Z, fuera de la ventana del
  vuelo). Un estrato bajo a 400 ft tiene una temperatura de tope casi idéntica a la
  del suelo tropical, así que la máscara de nube de §3.4 —que exige 10 °C de
  diferencia con el METAR de anclaje— no lo separa del terreno. **Para techos bajos
  y niebla, la observación de superficie es insustituible.**
- **La superficie no vio** ninguna de las catorce células, porque ninguna estaba
  sobre una estación. En la Amazonía las estaciones están a cientos de millas unas
  de otras: entre SKVV y SKLT, el METAR de anclaje más cercano a la ruta llega a
  estar a más de 100 NM. **Para el espacio entre aeródromos, el satélite es la
  única fuente.**

Esa es, en una frase, la respuesta a la pregunta del proyecto: la teledetección
cubre el hueco geográfico entre estaciones; la observación de superficie cubre el
hueco vertical bajo el tope de nube.

## 7. Selección del aeropuerto alterno

### 7.1 Situación de partida

El caso arrastra una restricción que no depende de la meteorología y que está
declarada en `alternos._advertencia`: **ningún alterno colombiano queda cerca de
SKLT.** El más próximo, SKMU, está a 327 NM del destino. Cualquier desvío desde el
área de Leticia es, por definición, un desvío largo.

### 7.2 Estado de los alternos a la hora de llegada

Los cuatro candidatos, con su METAR más próximo a la ETA (2055Z):

| Alterno | Categoría | METAR a 2100Z | Lectura |
|---|---|---|---|
| **SKMU** | VFR | `34003KT 230V030 9999 FEW048TCU 29/24 Q1008` | Operable. El grupo **`TCU`** avisa de cumulonimbo en desarrollo al oeste. |
| **SKSJ** | VFR | `36005KT 330V030 9999 BKN040 32/22 Q1009` | Operable, capa fragmentada a 4 000 ft. |
| **SKPD** | VFR | `36005KT 330V040 9999 FEW030 33/24 Q1008` | Operable, el más despejado. |
| **SKFL** | VFR | `VRB03KT 9999 FEW040 32/23 Q1009` | Operable, viento variable flojo. |

Los cuatro están en VFR a la hora de llegada, así que **el criterio meteorológico
no discrimina** en este caso: la decisión la deciden distancia, pista y ayudas, que
es lo que pondera la matriz de `alternos.criterios`. El visor recalcula el criterio
meteorológico con el METAR vigente a la hora que marque la barra de tiempo, de modo
que la matriz responde a la hora de evaluación y no a un valor congelado.

### 7.3 El matiz que aporta el satélite

SKMU es el más cercano al destino y el que gana por distancia, pero es también el
único cuyo METAR declara **`FEW048TCU`**: torre en desarrollo a 4 800 ft, al oeste
del campo. Contrastado con el análisis derivado, SKMU está además en el entorno de
**cb-09**, la célula más grande y persistente del caso. La decisión de alterno no
cambia por eso —sigue operable y sigue siendo el más próximo—, pero **el margen es
menor de lo que sugiere su categoría VFR**, y eso es justo lo que una categoría de
vuelo sola no dice.

**Recomendación.** SKMU como alterno por proximidad, con SKSJ como segunda opción
por tener la nubosidad más alta y estar fuera del entorno de cb-09. Si el desvío se
decidiera ya en el tramo final, la distancia desde la posición de la aeronave —y no
desde el destino— es la que manda, y el visor la calcula en el punto de decisión.

## 8. Bitácora de decisión operacional

| Campo | Valor |
|---|---|
| Ruta | SKVV VVC A301 UBRID B689 DUBRA A301 ISORI A301 ASKAT A301 DADIL A301 ROKUL SKLT · 553 NM · FL210 |
| Aeronave | ATR 72-600 · 250 kt · salida 1830Z · ETA 2055Z |
| Hora Z de análisis | 071830Z (planificación) con reevaluación a 2030Z, que es cuando el campo está maduro |
| Alterno seleccionado | **SKMU** (327 NM del destino) · segunda opción SKSJ |
| Mínimos aplicables | Pendientes — AD 2.19 del AIP no está en la base cargada (véase `_procedenciaDatos`) |
| Combustible de alterno | 45 min declarados en `vuelo.combustibleAlternoMin` |
| Riesgos principales | Tres células severas (cb-01, cb-02, cb-03; percentil 5 entre −71 y −74 °C) a menos de 20 NM de la aeronave entre las 2030Z y las 2040Z, en el descenso y la aproximación a SKLT. El 14 % de la ruta tiene topes por encima de FL210 a esa hora. |
| Medidas de mitigación | Desvío lateral de ~9 NM en el tramo DADIL → TOD → ROKUL para llevar la separación a 25 NM, con coste calculado de ~0,5 NM de recorrido. Decisión adelantada 15 min al punto de máxima aproximación. Vigilancia del TCU declarado en SKMU. |
| **Decisión** | **GO con desvío planificado.** La ruta es volable al nivel asignado durante los dos primeros tercios; el conflicto está acotado en espacio y tiempo, el destino permanece operable (MVFR en su peor momento) y hay cuatro alternos en VFR a la hora de llegada. Lo que NO es defendible es volar la trayectoria publicada sin desvío entre las 2030Z y las 2040Z. |

> La decisión se apoya en la regla declarada en la pestaña **Tramos** del visor, que
> emite el veredicto por tramo y enseña el criterio que aplica. A las 2030Z el
> veredicto de la ruta es **EVITAR**, y lo marca el tramo ASKAT → DADIL.

## 9. Conclusiones

**1. La teledetección cubre el hueco geográfico; la superficie, el hueco vertical.**
Ninguna de las catorce células seguidas estaba sobre una estación, y entre SKVV y
SKLT el METAR de anclaje más próximo a la ruta llega a quedar a más de 100 NM. Sin
satélite, los 553 NM de corredor amazónico son un vacío de observación. A la
inversa, el episodio de `OVC004` con `BR` de SKLT no aparece en el infrarrojo
porque un estrato a 400 ft emite casi a la temperatura del suelo tropical: para
techos bajos y niebla, la observación de superficie no tiene sustituto.

**2. Una sola imagen habría dado la respuesta contraria.** A la hora de salida, el
2 % de la ruta tenía topes por encima del nivel de crucero; dos horas después, el
14 %, con el máximo derivado pasando de FL236 a FL478. El caso no se decide con la
imagen de la planificación sino con la **evolución**, y esa es la diferencia entre
mirar una foto y hacer un análisis.

**3. El análisis multiespectral es lo que permite verificar.** La coincidencia
entre la banda 13 y la banda 9 —3 a 5 °C sobre los núcleos, la convergencia
esperable en topes altos— fue lo que confirmó que la inversión de la tabla de color
medía algo real. Con una sola banda no habría habido forma de detectar que la
primera versión del algoritmo estaba fabricando topes de −88 °C a partir de
artefactos de compresión.

**4. Declarar el método vale más que afinar el número.** Los tres momentos en que
este trabajo estuvo a punto de afirmar algo falso —el gris ambiguo, el mínimo
contaminado por el JPEG, la altura de tope calculada sobre suelo despejado— se
resolvieron los tres igual: escribiendo el criterio, comprobándolo contra otra
fuente y dejando el límite a la vista en la propia interfaz. Un visor que rotula
«18 puntos ambiguos» es más defendible que uno que enseña una curva continua y
bonita sin decir de dónde sale.

**5. Lo que queda pendiente y por qué.** Los mínimos de aproximación (AD 2.19), el
horario (AD 2.3) y los servicios (AD 2.4) no están en la base aeronáutica cargada y
se dejan explícitamente pendientes, igual que los designadores de aerovía A301 y
B689. Ninguno se ha rellenado con un valor plausible.

## 10. Referencias

- CIRA/RAMMB SLIDER, Colorado State University. <https://rammb-slider.cira.colostate.edu/>
- NOAA/NESDIS. *GOES-R Series ABI Band Quick Guides*.
- Aviation Weather Center, NOAA. <https://aviationweather.gov/>
- Unidad Administrativa Especial de Aeronáutica Civil (Aerocivil). *AIP Colombia*,
  AIRAC A 73-26, vigente desde el 09 JUL 2026. AD 2.2, AD 2.12, ENR 3.1, ENR 3.2,
  ENR 4.1, ENR 4.4, ENR 5.1.
- OACI, Anexo 3 — *Servicio meteorológico para la navegación aérea internacional*.
- OACI, Anexo 2 — *Reglamento del aire*, Apéndice 3: **tabla de niveles de crucero**.
  Adoptada en Colombia por el RAC 91.
- NOAA/NCEI. *World Magnetic Model WMM-2025*, calculadora de declinación.
  <https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination>
- GOES-R Series *Product Definition and Users' Guide* (PUG), vol. 3, §5.1.2.8 —
  proyección de la rejilla fija del ABI.
- NASA GIBS / Worldview — capas GOES-East georreferenciadas, usadas como contraste
  independiente de la geolocalización. <https://gibs.earthdata.nasa.gov/>
- OpenTopoMap (CC-BY-SA), datos de OpenStreetMap (ODbL) — cartografía base.
