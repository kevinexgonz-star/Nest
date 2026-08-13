# Rotula-nest

Software web de nesting 2D para optimización de corte CNC. Archivos *standalone* — funcionan directamente en el navegador, sin servidor ni npm.

## Archivos

| Archivo | Qué es | Cuándo usarlo |
|---------|--------|----------------|
| **`rotula-nest-demo.html`** | Demo completa: **panel de pedidos** **+ nesting**. Arranca en el panel de pedidos; al enviar, pasa a la herramienta de nesting. | Ver el flujo completo pedidos → nesting → producción. |
| **`rotula-nest.html`** | **Solo el panel de nesting**, ya extraído del panel de pedidos y listo para integrar. | Embeber el motor de nesting en otro sistema (ERP, panel propio…). |
| `archive/` | Versiones anteriores (`rotula-nest-demo-3` … `-11`). | Referencia histórica. |
| `backend/` | API PHP + esquema MySQL para servir pedidos **por id** desde una base de datos. | Integrar el nesting con una BD (ver más abajo). |

## Uso

Abre cualquiera de los dos HTML directamente en Chrome. React, ReactDOM y ClipperLib van **embebidos** (funciona sin internet); solo pdf.js y opentype.js se cargan de CDN la primera vez (al importar PDF/AI o texto).

## Integrar el panel de nesting

`rotula-nest.html` recibe pedidos desde fuera por dos vías:

- **postMessage** (útil al embeberlo en un iframe o abrirlo con `window.open`):

  ```js
  ventanaNest.postMessage({
    type: "ROTULA_NEST_LOAD",
    payload: {
      orders: [
        {
          ref: "PED-001",          // referencia (color + rótulo en la placa)
          fileName: "pieza.svg",
          fileType: "svg",          // "svg" | "pdf"
          content: "<svg…>",        // SVG en texto, o PDF/AI en base64
          matName: "PVC",           // debe coincidir con un material
          thk: 5,                   // grosor en mm
          qty: 3                    // cantidad
        }
      ]
    }
  }, "*");
  ```

  La app agrupa por material + grosor, anida cada lote en su placa y responde
  con `ROTULA_NEST_ACK`. Al montarse emite `ROTULA_NEST_READY` a `window.opener`.

- **Hash en la URL**: abrir `rotula-nest.html#rotula=<base64>` donde el base64 es
  `JSON.stringify({ orders: [...] })` (con el mismo formato de arriba).

### Recibir los archivos como ids (base de datos)

`rotula-nest.html` acepta pedidos que traen **solo un id** en vez del archivo:

```js
{ type: "ROTULA_NEST_LOAD", payload: { orders: [ { id: "PED-001" }, { id: "PED-002", qty: 10 } ] } }
```

Cuando un pedido no trae `content`, la app hace `GET {API_BASE}/orders/{id}` y
espera `{ref, fileName, fileType, content, matName, thk, qty}`. `API_BASE` es
`/api` por defecto y se puede cambiar con `window.NEST_API_BASE`. Los envíos con
`content` inline siguen funcionando igual (100% compatible).

La carpeta [`backend/`](backend/) trae una implementación lista en **PHP + MySQL**
(esquema, endpoints y guía de despliegue).

## Nesting

Tres motores, seleccionables en el desplegable **Motor** del panel de nesting:

| Motor | Qué hace | Cuándo |
|-------|----------|--------|
| **Forma real** *(por defecto)* | Rasteriza la **silueta** de cada pieza (inflada media separación) a una máscara de ~2 mm y la deja caer por gravedad al hueco más alto y más a la izquierda donde entra, probando los cuatro giros y colándose en los huecos de las letras ya puestas — el mismo resultado entrelazado que da VCarve. Coste lineal en piezas: cientos de letras sin degradar. | Siempre. |
| NFP | Motor anterior (no-fit polygon, exacto). Por encima de ~40 piezas con contornos complejos su compuerta de complejidad lo desvía a empaquetado por cajas. | Comparar. |
| Rejilla | El más rápido, por celdas de 50 mm. **No respeta siluetas finas** (puede solapar arte). | Sólo lotes de piezas rectangulares. |

**Cero solapes por construcción** en «Forma real»: la máscara es un *superconjunto*
del arte (se marca toda celda que el contorno toque, sin umbrales de tinta), se
comprueba contra el mismo mapa de bits que luego se sella, y la silueta sale de
`pieceToPolylinesMM` — la geometría **canónica** de la app: la que pinta el lienzo y
la que sale al DXF/SVG/PDF, recorriendo el SVG con el CTM real de cada elemento
(`<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<polygon>`, `<polyline>`, `<line>` y
transforms anidados). Medido con lotes de letras en placa 2050×3050 y separación
5 mm: **13–15 % menos placa** que el motor anterior, y lotes que pedían 3 placas
entran en 2.

Por encima de todo hay una **red final**: se comprueba el resultado de *cualquier*
motor contra esa geometría canónica y, si queda solape real, se rehace con «Forma
real». Medido sobre 341 letras importadas de SVG, NFP dejaba 19 pares solapados y
Rejilla 11; con la red, los tres motores dan 0.

**Agrupar por pedido** (casilla del panel): coloca las piezas pedido a pedido por
**referencia** (`ref`; `fileName` como respaldo), de modo que cada pedido queda en su
propia banda y se recoge junto de la placa. Aprieta un poco menos —cada pedido se
apoya sobre el anterior en vez de rellenar sus huecos—: ése es el único trade-off.

## Funciones

- Nesting automático de piezas irregulares (ver arriba).
- Importación: SVG, DXF, PDF vectorial, Adobe Illustrator (AI).
  - Los rótulos que Illustrator escribe como **un solo trazado compuesto** se reparten en
    una pieza por letra (los huecos de la «a» o la «O» viajan con su letra).
  - Se descarta el trazado **repetido** cuando el mismo dibujo va pintado en relleno y en
    contorno: una pieza, no dos.
  - **Guarda de escala**: si con la unidad de dibujo elegida (mm/cm/m) el pliego no cabe en
    la placa, se baja al multiplicador que sí cabe y se avisa. El ajuste manual del modal
    de importación sigue teniendo la última palabra.
- Editor visual con arrastre, zoom táctil y edición de polilíneas.
- **Selección por rectángulo al estilo CAD (VCarve)**: arrastrar hacia la *derecha* selecciona
  solo lo que queda entero dentro (ventana, línea continua); hacia la *izquierda*, todo lo que
  el rectángulo toque (cruce, línea discontinua). El cruce se calcula contra la geometría real,
  no contra la caja envolvente.
- Capas de corte: Corte / Hendido / Cajeado (con offset) / Taladros / personalizadas.
- Detección automática de capas por color al importar.
- Identificación de pedidos en la placa **por color**: cada pieza se rellena del color de su
  pedido y la lista de referencias (color → referencia + uds.) va **debajo de la placa**, no
  encima de cada pieza — con lotes grandes rotular pieza a pieza tapaba la placa de letras.
  El lienzo y el PDF de vista previa pintan exactamente lo mismo. El rótulo sobre cada pieza
  sigue disponible en la casilla «Ref.» (apagada por defecto).
- Resumen de material aprovechado (% y m²) por placa.
- Exportación: DXF R12 y SVG plano por capas; PDF de vista previa a escala real.
- Persistencia en localStorage.

## Stack

React 18 · pdf.js · ClipperLib · WASM (Minkowski/offset) · Babel (JSX en navegador)
