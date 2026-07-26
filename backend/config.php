<?php
// Configuración de la base de datos. Ajusta a tu servidor.
// En producción, mejor leer de variables de entorno que dejarlo en claro.
return [
  'db_host' => getenv('NEST_DB_HOST') ?: '127.0.0.1',
  'db_name' => getenv('NEST_DB_NAME') ?: 'nest',
  'db_user' => getenv('NEST_DB_USER') ?: 'root',
  'db_pass' => getenv('NEST_DB_PASS') ?: '',
  'db_charset' => 'utf8mb4',

  // Orígenes permitidos para CORS. Si sirves el HTML del nesting desde el MISMO
  // dominio que esta API, deja el array vacío (no hace falta CORS).
  // Ej.: ['https://erp.tuempresa.com']
  'cors_origins' => [],
];
