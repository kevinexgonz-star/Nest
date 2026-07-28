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

## Funciones

- Nesting automático de piezas irregulares (algoritmo Grid por defecto y motor NFP/DeepNest opt-in).
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
