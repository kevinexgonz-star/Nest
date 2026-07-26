# K-nest

Software web de nesting 2D para optimización de corte CNC. Archivos *standalone* — funcionan directamente en el navegador, sin servidor ni npm.

## Archivos

| Archivo | Qué es | Cuándo usarlo |
|---------|--------|----------------|
| **`rotula-nest-demo.html`** | Demo completa: **panel de pedidos** (Wolfcut) **+ nesting**. Arranca en el panel de pedidos; al enviar, pasa a la herramienta de nesting. | Ver el flujo completo pedidos → nesting → producción. |
| **`rotula-nest.html`** | **Solo el panel de nesting**, ya extraído del panel de pedidos y listo para integrar. | Embeber el motor de nesting en otro sistema (ERP, panel propio…). |
| `archive/` | Versiones anteriores (`rotula-nest-demo-3` … `-11`). | Referencia histórica. |

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

## Funciones

- Nesting automático de piezas irregulares (algoritmo Grid por defecto y motor NFP/DeepNest opt-in).
- Importación: SVG, DXF, PDF vectorial, Adobe Illustrator (AI).
- Editor visual con arrastre, zoom táctil y edición de polilíneas.
- Capas de corte: Corte / Hendido / Cajeado (con offset) / Taladros / personalizadas.
- Detección automática de capas por color al importar.
- Identificación de pedidos en la placa: color + referencia por pedido y PDF de vista previa.
- Resumen de material aprovechado (% y m²) por placa.
- Exportación: DXF R12 y SVG plano por capas; PDF de vista previa a escala real.
- Persistencia en localStorage.

## Stack

React 18 · pdf.js · ClipperLib · WASM (Minkowski/offset) · Babel (JSX en navegador)
