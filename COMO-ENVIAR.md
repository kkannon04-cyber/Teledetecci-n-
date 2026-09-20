# Cómo enviar este proyecto

> Este archivo es **para ti**, no para quien lo reciba. A esa persona lo que le
> sirve es [`COMO-ABRIR.md`](COMO-ABRIR.md), que va dentro del paquete.

---

## 1. Generar el paquete

```powershell
cd C:\Users\HP\Documents\proyecto-teledeteccion
node herramientas/empaquetar.mjs
```

Deja el archivo en la carpeta de arriba:

```
C:\Users\HP\Documents\visor-teledeteccion-SKVV-SKLT-20260907.zip     222,4 MB  (1 098 archivos)
```

Dentro va todo recogido en una carpeta `visor-teledeteccion-SKVV-SKLT-20260907/`,
así que da igual cómo lo descomprima quien lo reciba: con el explorador de Windows o
con «extraer aquí» de 7-Zip, no se le desparrama en la carpeta de descargas.

Este archivo, `COMO-ENVIAR.md`, **queda fuera del paquete**: es para ti y además
lleva rutas locales de esta máquina.

> **No usa `Compress-Archive`.** Es lo primero que uno escribe, pero con este volumen
> —1 098 archivos y 227 MB— falla con un `PermissionDenied ... IOException` señalando
> un archivo cualquiera, y además tarda minutos. El empaquetador usa las clases
> `ZipFile` de .NET, que están en cualquier Windows igualmente: tarda unos 8 segundos
> y no falla.

Si lo quieres en otro sitio: `node herramientas/empaquetar.mjs --destino "C:\ruta\que sea"`.
Ojo con el Escritorio: si está sincronizado con OneDrive, la ruta real es
`C:\Users\HP\OneDrive\Desktop`, no `C:\Users\HP\Desktop`.

**Antes de comprimir, comprueba.** No es un `zip` a secas: verifica que cada cuadro
que declara `caso.json` existe de verdad en disco, que ninguno está truncado, y que
las imágenes, los METAR y el caso hablan **del mismo día**. Si algo no cuadra, lo
dice y no genera el archivo. Para comprobar sin comprimir:

```powershell
node herramientas/empaquetar.mjs --solo-comprobar
```

---

## 2. Mandarlo

**199 MB no pasan por correo** — el límite normal de Gmail y Outlook son 25 MB. Por
orden de preferencia:

| Cómo | Qué hacer | Pegas |
|---|---|---|
| **Google Drive / OneDrive** | Subes el `.zip`, botón derecho → Compartir → *Cualquier persona con el enlace*, y mandas el enlace | Ninguna. Es lo que yo usaría |
| **WeTransfer** (<https://wetransfer.com>) | Hasta 2 GB sin necesidad de cuenta | El enlace **caduca a los 7 días** |
| **USB** | Copias la carpeta o el `.zip` | Solo si la persona está cerca |

> Si compartes por Drive, comprueba que el permiso quedó en *cualquiera con el
> enlace* y no en *restringido*: con el segundo, quien lo reciba verá una pantalla
> de "solicitar acceso" y no podrá abrir nada.

---

## 3. Qué decirle a quien lo reciba

Basta con esto:

> Descomprime la carpeta entera y haz doble clic en **`ABRIR.cmd`**.
> Se abre una ventana negra: no la cierres mientras lo estés viendo, es el servidor.

Y una advertencia que sí importa:

> **Hay que descomprimir.** Si abres el `.zip` y haces doble clic dentro sin
> extraerlo, Windows monta una carpeta temporal a medias y no funciona.

No necesita instalar nada. `ABRIR.cmd` usa Node.js si lo encuentra y, si no, un
servidor equivalente escrito en PowerShell que ya viene con Windows.

En Mac o Linux no hay `.cmd`: ahí se abre una terminal en la carpeta y se lanza
`node herramientas/servidor.mjs` o `python3 -m http.server 5173`. Está explicado en
`COMO-ABRIR.md`.

---

## 4. Qué funciona sin internet

Se probó extrayendo el `.zip`, sirviéndolo y abriéndolo con **todo internet
bloqueado**: 0 teselas de mapa rotas, las ocho bandas cargan, y el panel de SIGMET
cae solo en la captura congelada rotulándolo como tal. Van dentro del paquete:

- las 8 bandas de GOES-19, 28 cuadros cada una, más un `.webm` por banda;
- METAR, TAF y SIGMET congelados a la hora del caso;
- 719 teselas del mapa base (20,8 MB) para la zona del caso;
- Leaflet, en copia local.

Con internet, además, se pueden consultar los SIGMET en vivo, usar los otros tres
mapas base y ver la capa de radar. Sin internet, no se pierde el análisis.

---

## 5. Si necesitas que pese menos

El paquete pesa más que el del caso anterior por una razón concreta: las bandas ya
no se recortan al corredor de la ruta sino a **Colombia entera**, y esa caja tiene
casi el doble de superficie. Es lo que permite mirar el país completo en el visor
en vez de una franja.

| | |
|---|---|
| `band_02` (rojo visible, 0,5 km — 3956×4496 px por cuadro) | 104 MB |
| `band_01` y `band_05` (1 km) | 28 + 28 MB |
| `medios/mapa` (fondo sin internet, z4–z8) | 24 MB |
| las otras cinco bandas (2 km) | 44 MB en total |
| todo lo demás (código, datos, Leaflet, informe) | menos de 4 MB |

Dos formas de recortar, de menos a más pérdida:

**a) Bajar la banda 2 a 1 km.** Sigue siendo mucho detalle y es de largo el mayor
ahorro:

```powershell
node herramientas/capturar-satelite.mjs --bandas band_02 --zoom band_02=4 --aplicar
node herramientas/empaquetar.mjs
```

(Sin `--fecha`, `--desde` ni `--hasta`: el capturador toma la fecha y la ventana de
`caso.json`, así que no hay forma de bajar por descuido imágenes de otro día.)

**b) Volver al recorte del corredor.** Con `--solo-ruta` la caja deja de ser
nacional y vuelve a ceñirse a la ruta con su margen. Ahorra bastante, pero se pierde
justo la cobertura de todo el país, que es lo que se pidió para este caso:

```powershell
node herramientas/capturar-satelite.mjs --solo-ruta --margen 4 --aplicar
node herramientas/empaquetar.mjs
```

---

## 6. Antes de darlo por enviado

- [ ] `node herramientas/empaquetar.mjs --solo-comprobar` termina sin problemas.
- [ ] El `.zip` pesa lo que debe (≈199 MB) y no unos pocos KB.
- [ ] Descomprimirlo en otra carpeta y probar `ABRIR.cmd` una vez. Es un minuto y
      es la única forma de saber que lo que sale del otro lado abre.
- [ ] El enlace que mandas está en *cualquiera con el enlace*, y lo has abierto tú
      en una ventana de incógnito para confirmarlo.
