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
          matLabel: "Plancha De Pvc 5mm Pvc Negro", // opcional: color de plancha (título y lote)
          qty: 3                    // copias del diseño entero
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
espera `{ref, fileName, fileType, content, matName, thk, qty}` (y opcionalmente `matLabel` o
`matColor`). `API_BASE` es
`/api` por defecto y se puede cambiar con `window.NEST_API_BASE`. Los envíos con
`content` inline siguen funcionando igual (100% compatible).

La carpeta [`backend/`](backend/) trae una implementación lista en **PHP + MySQL**
(esquema, endpoints y guía de despliegue).

## Maquetación como en VCarve (v100)

Lo que sale del nesting (lienzo, DXF, SVG y PDF) queda maquetado como se hace a mano en VCarve:

- **Un bloque por pedido.** Las piezas de cada pedido se anidan juntas en un bloque compacto
  (motor raster de forma real, letras preferentemente derechas) y los bloques se reparten por
  la placa retrato. Entre pedidos queda más aire que entre letras de un mismo pedido. Casilla
  «Agrupar por pedido» (activada por defecto); apagada vuelve al nesting libre de siempre.
- **Código de pedido fuera de la placa**, junto a su bloque y en su color (`BDKGQVISY`, sin el
  `-1` de la línea), y **título del material encima** (`PVC 3MM NEGRO`). Se escriben con una
  fuente de trazo propia, como vectores, así VCarve los muestra igual que el lienzo.
- **DXF/SVG con una capa por pedido** (nombre = código, color ACI = el mismo que en el lienzo) y
  su rótulo en la capa `<código> ETIQUETA`; el título va en `ETIQUETAS`. Hendidos, taladros y
  cajeados conservan su capa. Ya no se rotula el nombre de cada pieza encima de ella.
- **Siempre espejado.** Toda pieza importada (PDF/AI, DXF, SVG) entra con volteo horizontal: las
  letras se cortan boca abajo. Se aplica sobre la geometría de origen, así nesting, lienzo,
  editor y exportación ven lo mismo (`__NEST_CFG__.mirror`).
- **Color de plancha** («Color plancha»): llega del panel (`matColor`, o se deduce de
  `matLabel`, p. ej. «Plancha De Pvc 3mm Pvc Negro») y separa lotes: PVC 3 mm negro y blanco ya
  no comparten placa.
- La **cantidad** de un pedido multiplica TODAS sus piezas (antes solo la primera).

## Piezas muy grandes e interiores (v103)

Un lote de PVC 3 con dos flechas enormes (BFYACFTOX) dejaba una placa casi vacía para ellas
(48 % + 31 %); con v103 las letras de los demás pedidos se anidan entre las flechas y en su
curva (54 % + 25 %, con la mitad inferior de la última placa libre).

- **Interiores pasantes**: el hueco de una «O», una «D» o un marco queda libre para piezas de
  su mismo pedido. Solo cuenta como interior un anillo de corte de la misma capa que el que lo
  contiene, con una banda de material ≥ 4 mm y al menos 50 mm de hueco: un cajeado (capa
  «MET CAJEADO» o similar), un trazo doble o un taladro nunca.
- **Zona de relleno junto a piezas muy grandes** (caja ≥ 12 % de la placa y material < 60 % de
  esa caja: flechas curvas, aros, marcos enormes): ahí entran, sueltas y sin pasillo, piezas de
  otros pedidos. Primero pedidos pequeños **enteros** —como bloque compacto si cabe, si no
  juntos (cada pieza cerca de las suyas)— y luego, en lo que quede, parte de un pedido grande
  (≥ 40 piezas); el resto de ese pedido se re-empaqueta como bloque. Fuera de la zona todo
  sigue agrupado como en v102.
- **Última placa casi vacía**: si sus pedidos caben juntos (y con su pasillo) en los huecos de
  las demás placas, se vacía.
- **SVG con capas**: una capa «… CAJEADO» o «AGUJEROS» manda sobre el color del trazo; antes un
  cajeado con trazo negro entraba como corte y salía en la capa de corte del DXF.
- Interruptor **Rellenar huecos** junto a «Giro» (apagado = comportamiento de v102). Los
  colores de pedido se reparten para que los primeros sean bien distintos.

## Aprovechar el material sin dejar de agrupar (v102)

Un lote real de Opal 8 (8 pedidos, 68 letras con cajeado) que VCarve saca en 2 placas gastaba 3
con v101; con v102 sale en 2, cada pedido en su bloque y con su rótulo fuera de la placa.

- **Giros finos** de las piezas, 15° por defecto, como el «paso de rotación» de VCarve. Selector
  **Giro** junto a «Agrupar por pedido» (15° · 30° · 45° · 90°; 90° = solo derechas o tumbadas,
  para materiales con veta o impresos). Una letra solo se gira si gana sitio de verdad.
- **Dos criterios** por pedido: lo más arriba posible y el centro de masas más arriba (la «A»
  que se acomoda en la diagonal de otra). Se queda lo mejor de cada uno.
- **Bloque por silueta**: el bloque de un pedido ocupa su silueta cerrada (los huecos estrechos
  entre sus letras quedan cerrados), no su rectángulo, así que otro pedido puede entrar en la
  ensenada que deja una «L» o un bloque escalonado. Entre pedidos queda siempre un pasillo
  (≥ hueco + ~12 mm).
- **Dos pasadas con tiempo medido**: primero 0/90/180/270 (resultado seguro, mide la máquina) y
  después la fina si cabe en el presupuesto (15° → 30° → 45°; los lotes de más de 300 piezas no
  bajan de 30°), con tope duro de 26 s. Gana la que gasta menos placas y, a igualdad, deja la
  última más libre y más arriba (un retal aprovechable).
- El lienzo, el DXF/SVG/PDF y el estimado dibujan cada giro fino exactamente donde lo reservó el
  motor.
- El código de pedido de los archivos de repetición del panel
  (`HMWHXBAPZ_554567_repeticion_…`) se rotula como `HMWHXBAPZ`.

## Piezas a cortar por pedido (v101)

La lista «PIEZAS A CORTAR» se agrupa por pedido en pestañas plegables:

- **Cabecera** (un toque solo pliega/despliega): color del pedido, código, cliente (sacado del
  nombre del archivo), `N pzs · U uds` y, tras el nesting, en qué placa quedó (`▦ Placa 1`) o
  cuántas unidades no entraron (`⚠ N sin colocar`). `⚑` si alguna pieza está fijada a placa.
  Con un solo pedido se ve abierto; con varios, plegados. «Abrir todo / Cerrar todo» arriba.
- **Abierta**: las tarjetas de siempre (nombre, medidas, cantidad, capa, ✎ contornos, placa fija,
  quitar). Si el pedido llega en varias líneas (`BDKGQVISY-1`, `BDKGQVISY-2`) va una subcabecera
  por línea. Se montan 50 tarjetas y luego «Mostrar las N restantes»; plegada no monta ninguna,
  así un lote de 600 piezas solo pinta cabeceras.
- **＋ Archivo / ＋ Pieza** dentro del pedido: lo nuevo entra en ESE pedido, detrás de sus piezas,
  con la referencia de su primera línea (manda sobre el nombre del archivo), numeración
  `<línea> #k` a continuación, cantidad × copias del pedido y su material. Las piezas sin
  código van a «Sin pedido», al final.
- **Eliminar pedido** pide confirmación en línea («Sí, quitar»).
- **Visor de pieza** (miniatura o 🔍): la pieza en grande con su **medida real de corte** (el
  dibujo se encaja sin deformarse en la caja `w×h`; si la caja no guarda la proporción lo
  avisa), ancho/alto con proporción bloqueada, cantidad, capa, contorno a contorno, placa fija,
  eliminar (doble toque) y ‹ › o ←/→ para recorrer todo el pedido. Mientras está abierto el
  teclado no llega al lienzo (Supr/flechas no tocan la selección). En móvil ocupa la pantalla.
- **Cambiar de lote conserva lo editado** (piezas y nesting del lote que se deja). Un lote sin
  nesting deja el lienzo vacío en lugar de mostrar el anidado de otro material; no se puede
  cambiar de lote mientras se calcula un nesting.

## Tests

```bash
npm i -D playwright            # una vez (usa Chromium)
node tests/run-tests.js [carpeta-con-pdfs-del-panel]
```

Abre `rotula-nest.html` en Chromium y comprueba con archivos sintéticos (PDF, DXF y SVG que
genera el propio test), con los 6 pedidos SVG reales que trae la demo y, si se pasa, con una
carpeta de PDF reales: tamaño exacto de la geometría, espejo, cantidades, nesting sin solapes y
dentro de placa, bloques por pedido, rótulos fuera de la placa, capas del DXF, la lista por
pedidos (pestañas, añadir/quitar, visor, cambio de lote, móvil, 600 piezas) y el flujo
completo panel → nesting → lienzo → exportar. `ROTULA_HTML=rotula-nest-demo.html` prueba la demo.
pdf.js se descarga de cdnjs la primera vez (hace falta red).

## Funciones

- Nesting automático de piezas irregulares: bloques por pedido (por defecto), Grid y motor NFP.
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
