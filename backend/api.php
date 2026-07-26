<?php
// Front controller de la API del panel de nesting.
// Rutas (via .htaccess se accede como /api/...):
//   GET  /orders                 -> lista de pedidos (sin el archivo, ligero)
//   GET  /orders/{id}            -> pedido completo con `content` (lo que pide el nesting)
//   POST /orders                 -> crea pedido (+ archivo inline o multipart)
//   POST /orders/{id}/nesting    -> guarda el resultado del nesting (opcional)
//   POST /files                  -> sube solo un archivo, devuelve su id
require __DIR__ . '/db.php';

$cfg = require __DIR__ . '/config.php';

// ---- CORS (solo si sirves el HTML desde OTRO dominio) --------------------
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array($origin, $cfg['cors_origins'], true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Vary: Origin');
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

// ---- Routing -------------------------------------------------------------
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path   = trim($_SERVER['PATH_INFO'] ?? '', '/');      // p.ej. "orders/123"
$seg    = $path === '' ? [] : explode('/', $path);

try {
  if (($seg[0] ?? '') === 'orders') {
    if ($method === 'GET'  && !isset($seg[1]))                 { list_orders(); }
    if ($method === 'GET'  &&  isset($seg[1]))                 { get_order($seg[1]); }
    if ($method === 'POST' && !isset($seg[1]))                 { create_order(); }
    if ($method === 'POST' &&  isset($seg[1], $seg[2]) && $seg[2] === 'nesting') { save_nesting($seg[1]); }
  }
  if (($seg[0] ?? '') === 'files' && $method === 'POST' && !isset($seg[1])) { upload_file(); }
  json_err('Ruta no encontrada', 404);
} catch (Throwable $e) {
  json_err('Error interno: ' . $e->getMessage(), 500);
}

// ---- Handlers ------------------------------------------------------------

// GET /orders — lista ligera (sin content) para pintar un panel de selección.
function list_orders(): void {
  $status = $_GET['status'] ?? null;
  $sql = "SELECT o.id, o.ref, o.material AS matName, o.thickness AS thk, o.qty,
                 o.status, f.filename AS fileName, f.filetype AS fileType
          FROM orders o JOIN files f ON f.id = o.file_id";
  $args = [];
  if ($status) { $sql .= " WHERE o.status = ?"; $args[] = $status; }
  $sql .= " ORDER BY o.created_at DESC";
  $st = db()->prepare($sql);
  $st->execute($args);
  $rows = $st->fetchAll();
  foreach ($rows as &$r) { $r['thk'] = (int)$r['thk']; $r['qty'] = (int)$r['qty']; }
  json_out(['orders' => $rows]);
}

// GET /orders/{id} — pedido COMPLETO. Formato exacto que consume rotula-nest.html.
function get_order(string $id): void {
  $st = db()->prepare(
    "SELECT o.ref, o.material AS matName, o.thickness AS thk, o.qty,
            f.filename AS fileName, f.filetype AS fileType, f.content AS content
     FROM orders o JOIN files f ON f.id = o.file_id
     WHERE o.id = ?");
  $st->execute([$id]);
  $row = $st->fetch();
  if (!$row) json_err('Pedido no encontrado', 404);
  $row['thk'] = (int)$row['thk'];
  $row['qty'] = (int)$row['qty'];
  json_out($row);
}

// POST /orders — crea un pedido. Dos formas de traer el archivo:
//  (a) inline JSON:  {ref, fileName, fileType, content, matName, thk, qty}
//  (b) file_id existente: {ref, file_id, matName, thk, qty}
function create_order(): void {
  $b = body_json();
  $ref     = trim($b['ref'] ?? '');
  $matName = trim($b['matName'] ?? $b['material'] ?? '');
  $thk     = (int)($b['thk'] ?? $b['thickness'] ?? 0);
  $qty     = max(1, (int)($b['qty'] ?? 1));
  if ($ref === '' || $matName === '') json_err('Faltan campos: ref y matName son obligatorios');

  $pdo = db();
  $pdo->beginTransaction();

  $fileId = $b['file_id'] ?? null;
  if (!$fileId) {
    $content  = $b['content'] ?? null;
    $fileType = strtolower(trim($b['fileType'] ?? ''));
    if ($content === null || !in_array($fileType, ['svg', 'pdf'], true)) {
      $pdo->rollBack();
      json_err('Sin file_id, se requiere content + fileType (svg|pdf)');
    }
    $fileId = uuid();
    $pdo->prepare("INSERT INTO files (id, filename, filetype, content) VALUES (?,?,?,?)")
        ->execute([$fileId, $b['fileName'] ?? ($ref . '.' . $fileType), $fileType, $content]);
  }

  $orderId = uuid();
  $pdo->prepare("INSERT INTO orders (id, ref, file_id, material, thickness, qty) VALUES (?,?,?,?,?,?)")
      ->execute([$orderId, $ref, $fileId, $matName, $thk, $qty]);
  $pdo->commit();
  json_out(['id' => $orderId, 'file_id' => $fileId], 201);
}

// POST /files — sube solo un archivo (multipart, campo "file"), devuelve su id.
// SVG se guarda como texto; PDF/AI se guarda en base64 (lo que espera el nesting).
function upload_file(): void {
  if (empty($_FILES['file']['tmp_name'])) json_err('Falta el campo de archivo "file"');
  $name = $_FILES['file']['name'] ?? 'archivo';
  $ext  = strtolower(pathinfo($name, PATHINFO_EXTENSION));
  $bytes = file_get_contents($_FILES['file']['tmp_name']);
  if ($ext === 'svg') { $type = 'svg'; $content = $bytes; }
  else if (in_array($ext, ['pdf', 'ai'], true)) { $type = 'pdf'; $content = base64_encode($bytes); }
  else json_err('Formato no soportado (usa svg, pdf o ai)');
  $id = uuid();
  db()->prepare("INSERT INTO files (id, filename, filetype, content) VALUES (?,?,?,?)")
      ->execute([$id, $name, $type, $content]);
  json_out(['id' => $id, 'fileType' => $type], 201);
}

// POST /orders/{id}/nesting — guarda el resultado del nesting (JSON) y marca el pedido.
function save_nesting(string $orderId): void {
  $b = body_json();
  if (!isset($b['result'])) json_err('Falta "result"');
  $pdo = db();
  $exists = $pdo->prepare("SELECT 1 FROM orders WHERE id = ?");
  $exists->execute([$orderId]);
  if (!$exists->fetchColumn()) json_err('Pedido no encontrado', 404);
  $id = uuid();
  $pdo->prepare("INSERT INTO nestings (id, order_id, result) VALUES (?,?,?)")
      ->execute([$id, $orderId, json_encode($b['result'], JSON_UNESCAPED_UNICODE)]);
  $pdo->prepare("UPDATE orders SET status = 'anidado' WHERE id = ?")->execute([$orderId]);
  json_out(['id' => $id], 201);
}
