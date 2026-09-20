# Teledetección aplicada a una ruta aeronáutica

Análisis de teledetección satelital sobre un vuelo real congelado en el tiempo:
**SKVV → SKLT** (Villavicencio – Leticia), ATR 72-600, FL210, 553 NM,
**07 SEP 2026**, salida 1830Z y llegada prevista 2055Z.

La pregunta del trabajo es concreta: *¿se puede volar esta ruta a este nivel?* Y la
respuesta no sale de una imagen, sale de la **evolución** de ocho bandas espectrales de
GOES-19 durante cuatro horas y media, cruzada con METAR, TAF y SIGMET del mismo día.

---

## Cómo abrir el visor

El visor lee **de disco**: no consulta nada en vivo salvo el bloque SIGMET, que va
rotulado como tal. Necesita servirse por HTTP porque usa módulos de JavaScript.

```
node herramientas/servidor.mjs
```

y abrir <http://localhost:5173>. En Windows basta con doble clic en `ABRIR.cmd`.
Los detalles están en [COMO-ABRIR.md](COMO-ABRIR.md).

## Qué hay aquí

| Documento | Qué es |
|---|---|
| [informe/informe.md](informe/informe.md) | El informe completo: marco teórico, metodología, análisis y conclusiones |
| [informe/Briefing-Sustentacion.pdf](informe/Briefing-Sustentacion.pdf) | Briefing de sustentación para tres expositores: qué decir, quién lo dice y qué mostrar |
| [informe/Guia-corte-vertical.pdf](informe/Guia-corte-vertical.pdf) | Cómo se lee el corte vertical de la ruta |
| [informe/Guia-EFB.pdf](informe/Guia-EFB.pdf) | Cómo funciona el panel de vuelo (EFB) |
| [informe/Guia-Tramos.pdf](informe/Guia-Tramos.pdf) | Cómo funciona el análisis por tramos |
| [informe/asesoria-meteorologo.md](informe/asesoria-meteorologo.md) | Transcripción de la asesoría de un meteorólogo en ejercicio |

## Estructura

```
index.html            el visor
js/                   módulos del visor (mapa, satélite, radiometría, perfil, tramos, EFB)
datos/                caso, METAR, TAF, SIGMET, fenómenos derivados, tablas de color
medios/satelite/      223 cuadros congelados de 8 bandas, 1730Z–2200Z cada 10 min
medios/mapa/          teselas del mapa base, para que el visor funcione sin red
herramientas/         captura de datos, derivación de fenómenos, servidor, empaquetado
informe/              informe, guías en PDF y sus figuras
```

## De dónde salen los datos

- **Imágenes:** CIRA/RAMMB SLIDER, Colorado State University — GOES-19 / ABI.
  Son el producto **renderizado** que publica SLIDER, no radiancias calibradas.
- **METAR, TAF y SIGMET:** Aviation Weather Center (NOAA), congelados ese día.
- **Datos aeronáuticos:** AIP Colombia (Aerocivil), AIRAC A 73-26.

## Lo que este trabajo NO afirma

El satélite mide el **tope** de la nube, no la nube. La altura de tope es un **cálculo**
declarado, no una medida: sale de la temperatura con un gradiente tipo anclado en METAR,
y sin radiosondeo no se puede verificar. La escala de color satura por debajo de −90 °C.
Donde la lectura no es concluyente, el visor la rotula como ambigua **en vez de
rellenarla**. No hay detección de descargas eléctricas ni radar: lo que se dice de granizo
y rayo es inferencia por umbral, no observación.

Los límites están desarrollados en §5.4 del informe y en el apartado 34 del briefing.
