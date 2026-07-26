# Backend PHP — pedidos por id para el panel de nesting

API mínima en PHP + MySQL/MariaDB para que `rotula-nest.html` reciba pedidos como
**ids** y traiga el archivo (SVG/PDF) desde la base de datos.

## Puesta en marcha

1. **Base de datos**

   ```bash
   mysql -u USUARIO -p -e "CREATE DATABASE nest CHARACTER SET utf8mb4;"
   mysql -u USUARIO -p nest < schema.sql
   ```

2. **Credenciales**: edita `config.php` (o exporta `NEST_DB_HOST/NEST_DB_NAME/NEST_DB_USER/NEST_DB_PASS`).

3. **Servir**: publica esta carpeta de forma que `/api/` apunte aquí. Lo más
   simple es servir **el HTML del nesting y la API desde el mismo dominio** (así
   no necesitas CORS). Ejemplo de estructura en el servidor:

   ```
   /var/www/html/
     nest/rotula-nest.html      -> https://tu-erp/nest/rotula-nest.html
     api/  (esta carpeta)       -> https://tu-erp/api/orders/...
   ```

   Requiere Apache con `mod_rewrite` (usa el `.htaccess` incluido). En Nginx,
   redirige `location /api/ { try_files $uri /api/api.php$is_args$args; }` con PHP-FPM.

   Prueba rápida en local (sin Apache):
   ```bash
   php -S localhost:8000 api.php   # las rutas quedan en http://localhost:8000/orders/...
   ```

## Endpoints

| Método | Ruta | Para qué |
|--------|------|----------|
| `GET`  | `/orders` | Lista ligera de pedidos (sin el archivo). Filtro opcional `?status=pendiente`. |
| `GET`  | `/orders/{id}` | Pedido completo: `{ref, fileName, fileType, content, matName, thk, qty}`. **Lo que consume el nesting.** |
| `POST` | `/orders` | Crea pedido. Body JSON inline o con `file_id`. |
| `POST` | `/files` | Sube un archivo (multipart, campo `file`); devuelve `{id, fileType}`. |
| `POST` | `/orders/{id}/nesting` | Guarda el resultado del nesting (opcional). |

### Crear un pedido con archivo inline

```bash
curl -X POST https://tu-erp/api/orders -H 'Content-Type: application/json' -d '{
  "ref": "PED-001", "matName": "PVC", "thk": 5, "qty": 3,
  "fileName": "logo.svg", "fileType": "svg", "content": "<svg …></svg>"
}'
# -> {"id":"<order-id>","file_id":"<file-id>"}
```

### Enviar ese pedido al nesting

En la página que abre/embebe `rotula-nest.html`:

```js
ventanaNest.postMessage({
  type: "ROTULA_NEST_LOAD",
  payload: { orders: [ { id: "<order-id>" }, { id: "<otro-id>", qty: 10 } ] }
}, "*");
```

La app hace `GET /api/orders/<order-id>`, recibe el archivo y anida. El `qty` del
`postMessage` (si lo mandas) pisa al de la BD.

## Notas

- **CORS**: si sirves el HTML desde otro dominio, añade ese origen a
  `cors_origins` en `config.php`. Mismo dominio = sin CORS.
- **`API_BASE`**: el nesting apunta por defecto a `/api`. Para cambiarlo, define
  `window.NEST_API_BASE = "https://tu-erp/api"` antes de cargar el HTML.
- **PDF grandes**: aquí `content` va en base64 dentro de JSON. Si te pesa, guarda
  los bytes en `LONGBLOB` y añade un endpoint binario `GET /files/{id}/raw`; en el
  nesting, sustituye `_b64ToBuf(o.content)` por `await (await fetch(...)).arrayBuffer()`.
- **Seguridad**: añade autenticación (token/cookie de sesión de tu ERP) antes de
  exponerlo; este ejemplo no la incluye.
