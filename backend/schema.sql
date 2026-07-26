-- Esquema mínimo para servir pedidos por id al panel de nesting (rotula-nest.html).
-- MySQL / MariaDB. Ejecutar una vez:  mysql -u USUARIO -p BASE < schema.sql

CREATE TABLE IF NOT EXISTS files (
  id         CHAR(36)     NOT NULL PRIMARY KEY,   -- UUID
  filename   VARCHAR(255) NOT NULL DEFAULT '',
  filetype   ENUM('svg','pdf') NOT NULL,
  -- SVG guardado como texto; PDF/AI guardado en base64 (formato que el
  -- nesting espera en `content`). Para PDF grandes puedes migrar a LONGBLOB
  -- + endpoint binario; ver comentario en api.php.
  content    LONGTEXT     NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id         CHAR(36)     NOT NULL PRIMARY KEY,    -- UUID (el id que recibe el nesting)
  ref        VARCHAR(120) NOT NULL,                -- referencia visible en la placa
  file_id    CHAR(36)     NOT NULL,
  material   VARCHAR(80)  NOT NULL,                -- debe coincidir con un material de la app (PVC, Opal, Dibond…)
  thickness  INT          NOT NULL DEFAULT 0,      -- grosor en mm
  qty        INT          NOT NULL DEFAULT 1,
  status     ENUM('pendiente','anidado','enviado') NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  INDEX idx_orders_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Opcional: guardar el resultado del nesting (placa anidada / PDF de vista previa).
CREATE TABLE IF NOT EXISTS nestings (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  order_id   CHAR(36)     NOT NULL,
  result     LONGTEXT     NOT NULL,                -- JSON del nesting (placas, posiciones…)
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_nest_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
