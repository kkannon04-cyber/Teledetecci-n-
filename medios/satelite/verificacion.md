# Captura satelital — trazabilidad
Generado por `herramientas/capturar-satelite.mjs` el 2026-09-08T22:58:19.531Z.
## Parámetros
- Satélite / sector: **goes-19 / full_disk**
- Fecha: **20260907** · ventana **1730Z–2200Z** · paso **10 min**
- Caja de cobertura nacional (margen 1.5°): lat -5.730 … 14.900, lon -83.250 … -65.350
- Meridiano subsatélite usado en la proyección: **-75°**
## Bandas
| Banda | λ | Resolución | Zoom | Recorte | Teselas/cuadro | Cuadros | Vídeo |
|---|---|---|---|---|---|---|---|
| band_01 — Azul visible | 0.47 µm | 1 km | 4 | 1978×2248 px | 16 | 28 | webm |
| band_02 — Rojo visible | 0.64 µm | 0.5 km | 5 | 3956×4496 px | 49 | 28 | webm |
| band_04 — Cirros | 1.37 µm | 2 km | 3 | 989×1124 px | 6 | 27 | webm |
| band_05 — Nieve y hielo | 1.6 µm | 1 km | 4 | 1978×2248 px | 16 | 28 | webm |
| band_07 — Ventana de onda corta | 3.9 µm | 2 km | 3 | 989×1124 px | 6 | 28 | webm |
| band_09 — Vapor de agua, nivel medio | 6.9 µm | 2 km | 3 | 989×1124 px | 6 | 28 | webm |
| band_10 — Vapor de agua, nivel bajo | 7.3 µm | 2 km | 3 | 989×1124 px | 6 | 28 | webm |
| band_13 — Infrarrojo ventana limpia | 10.3 µm | 2 km | 3 | 989×1124 px | 6 | 28 | webm |
## Verificación de geolocalización
Las bandas 2 y 13 son las únicas que NASA GIBS publica georreferenciadas, así que
sirven de contraste independiente del recorte calculado aquí: misma caja, mismo
instante, dos proyecciones distintas. Si los accidentes geográficos y los bordes de
nube coinciden, la traducción de latitud/longitud a píxel es correcta — y lo es
también para las demás bandas, que usan exactamente la misma rejilla fija del ABI.
- **band_02**: referencia guardada en una verificación anterior — `medios/satelite/referencia-gibs-band_02.jpg`
- **band_13**: referencia guardada en una verificación anterior — `medios/satelite/referencia-gibs-band_13.jpg`
## URLs de origen
- **band_01**: `https://rammb-slider.cira.colostate.edu/data/imagery/2026/09/07/goes-19---full_disk/band_01/20260907173020/04/005_006.png` (primera tesela del primer cuadro)
- **band_02**: `https://rammb-slider.cira.colostate.edu/data/imagery/2026/09/07/goes-19---full_disk/band_02/20260907173020/05/011_013.png` (primera tesela del primer cuadro)
- **band_04**: `https://rammb-slider.cira.colostate.edu/data/imagery/2026/09/07/goes-19---full_disk/band_04/20260907173020/03/002_003.png` (primera tesela del primer cuadro)
- **band_05**: `https://rammb-slider.cira.colostate.edu/data/imagery/2026/09/07/goes-19---full_disk/band_05/20260907173020/04/005_006.png` (primera tesela del primer cuadro)
- **band_07**: `https://rammb-slider.cira.colostate.edu/data/imagery/2026/09/07/goes-19---full_disk/band_07/20260907173020/03/002_003.png` (primera tesela del primer cuadro)
- **band_09**: `https://rammb-slider.cira.colostate.edu/data/imagery/2026/09/07/goes-19---full_disk/band_09/20260907173020/03/002_003.png` (primera tesela del primer cuadro)
- **band_10**: `https://rammb-slider.cira.colostate.edu/data/imagery/2026/09/07/goes-19---full_disk/band_10/20260907173020/03/002_003.png` (primera tesela del primer cuadro)
- **band_13**: `https://rammb-slider.cira.colostate.edu/data/imagery/2026/09/07/goes-19---full_disk/band_13/20260907173020/03/002_003.png` (primera tesela del primer cuadro)
## Huecos declarados
Cuadros que el servidor no publica. **No se rellenan con el vecino**: se dejan como hueco.
- band_04: 27 de 28 cuadros esperados
---
Teselas descargadas: **3102** (909.7 MB).
Las teselas no se conservan: solo el recorte compuesto de cada cuadro.
