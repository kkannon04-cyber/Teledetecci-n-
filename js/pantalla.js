// Pantalla completa para un panel suelto.
//
// El visor parte la pantalla en dos —mapa a la izquierda, banda a la derecha— y eso
// está bien para relacionar una cosa con la otra, pero deja cada mitad en unos 500
// px de ancho. Para leer la textura de una célula en la banda 2, o para seguir un
// SIGMET sobre el mapa, ese ancho se queda corto.
//
// Se usa la API de pantalla completa del navegador sobre el elemento del panel, no
// una clase CSS que lo estire dentro de la página: así se ganan también la barra del
// navegador y la del sistema, que es de donde sale el espacio de verdad.
//
// Quien llame se encarga de recolocar lo suyo cuando cambia el tamaño: Leaflet
// necesita invalidateSize() y el panel satelital tiene que rehacer su encuadre.

const soportada = () =>
  Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);

const actual = () => document.fullscreenElement || document.webkitFullscreenElement || null;

export const enPantallaCompleta = (el) => actual() === el;

/** Entra o sale de pantalla completa con ese elemento. Devuelve el estado final. */
export async function alternar(el) {
  if (!el) return false;
  try {
    if (actual() === el) {
      await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
      return false;
    }
    // Si otro panel la tenía, el navegador la traspasa solo.
    await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
    return true;
  } catch {
    // Safari en iPhone no la da para elementos sueltos, y algunos navegadores la
    // niegan si la acción no viene de un gesto del usuario. No es un fallo del
    // visor: se deja como estaba y se sigue.
    return enPantallaCompleta(el);
  }
}

/**
 * Añade un botón de pantalla completa dentro de `contenedor` para `objetivo`.
 * `alCambiar(activa)` se llama después de cada transición, y también cuando se sale
 * con Escape, que no pasa por el botón.
 */
export function montarBoton(contenedor, objetivo, alCambiar) {
  if (!contenedor || !objetivo || !soportada()) return null;

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn-pantalla';
  boton.textContent = '⛶';
  boton.title = 'Pantalla completa (Esc para salir)';
  boton.addEventListener('click', async (e) => {
    e.stopPropagation();
    await alternar(objetivo);
  });
  contenedor.appendChild(boton);

  const sincronizar = () => {
    const activa = enPantallaCompleta(objetivo);
    boton.classList.toggle('activo', activa);
    boton.textContent = activa ? '⛗' : '⛶';
    boton.title = activa ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa';
    // Dos veces: al entrar y salir, el navegador redimensiona después de emitir el
    // evento, y medir en ese instante da el tamaño viejo.
    alCambiar?.(activa);
    setTimeout(() => alCambiar?.(activa), 120);
  };
  document.addEventListener('fullscreenchange', sincronizar);
  document.addEventListener('webkitfullscreenchange', sincronizar);

  return boton;
}
