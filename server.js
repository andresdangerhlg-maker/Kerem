// CanonJet / Kerem Backend
// Node + Express + SQLite + Multer

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const fastcsv = require("fast-csv");  // CSV

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// --------------------------
// FECHA LOCAL CUBA UTC-5
// --------------------------
function ahora() {
  const date = new Date();
  date.setHours(date.getHours() - 5); // Ajuste UTC-5
  return date.toISOString().replace("T", " ").split(".")[0];
}

// --------------------------
// NOTIFICACIONES EXPO
// --------------------------
async function enviarPush(expoToken, titulo, cuerpo, dataExtra = {}) {
  if (!expoToken || !expoToken.startsWith("ExponentPushToken")) return;

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: expoToken,
        title: titulo,
        body: cuerpo,
        sound: "default",
        data: dataExtra,
      }),
    });
  } catch (e) {
    console.log("Error enviando push:", e.message);
  }
}

// --------------------------
// RUTA PARA IMAGENES
// --------------------------
const IMAGES_PATH = path.join(__dirname, "public", "images");
if (!fs.existsSync(IMAGES_PATH)) fs.mkdirSync(IMAGES_PATH, { recursive: true });

app.use("/images", express.static(IMAGES_PATH));

// --------------------------
// MULTER IMAGENES
// --------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMAGES_PATH),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, "img_" + Date.now() + ext);
  },
});
const upload = multer({ storage });

// --------------------------
// BASE DE DATOS
// --------------------------
const DB_PATH = path.join(__dirname, "data", "database.sqlite");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("Error SQLite:", err.message);
  else console.log("SQLite funcionando en:", DB_PATH);
});

// --------------------------
// CREAR TABLAS
// --------------------------
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT,
      password TEXT,
      rol TEXT,
      telefono TEXT,
      tarjeta TEXT,
      expo_push_token TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS inventario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      descripcion TEXT,
      precio_base REAL,
      cantidad INTEGER,
      imagen TEXT,
      fecha_creacion TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_gestor INTEGER,
      nombre_gestor TEXT,
      nombre_cliente TEXT,
      numero_cliente TEXT,
      direccion TEXT,
      tipo_pedido TEXT,
      horario TEXT,
      precio_mensajeria REAL,
      estado TEXT,
      total_productos REAL,
      total_general REAL,
      id_repartidor INTEGER,
      fecha_creacion TEXT,
      fecha_entregado TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pedido_detalle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_pedido INTEGER,
      id_producto INTEGER,
      cantidad_pedida INTEGER,
      cantidad_entregada INTEGER,
      precio_base REAL,
      precio_vendido REAL,
      ganancia REAL
    )
  `);

  // Agregar columnas faltantes si no existen
  db.all("PRAGMA table_info(pedidos)", (err, rows) => {
    if (!rows.some((c) => c.name === "fecha_entregado")) {
      db.run("ALTER TABLE pedidos ADD COLUMN fecha_entregado TEXT");
    }
  });

  db.all("PRAGMA table_info(usuarios)", (err, rows) => {
    if (!rows.some((c) => c.name === "expo_push_token")) {
      db.run("ALTER TABLE usuarios ADD COLUMN expo_push_token TEXT");
    }
  });

  // Usuarios de prueba
  db.get("SELECT COUNT(*) AS total FROM usuarios", [], (err, row) => {
    if (row && row.total === 0) {
      db.run(`
        INSERT INTO usuarios (usuario, password, rol, telefono, tarjeta)
        VALUES
          ('gestor','123','gestor','00000000','0000'),
          ('empresa','123','empresa','00000000','0000'),
          ('repartidor','123','repartidor','00000000','0000')
      `);
    }
  });
});

// --------------------------
// LOGIN
// --------------------------
app.post("/api/login", (req, res) => {
  const { usuario, password } = req.body;

  db.get(
    "SELECT * FROM usuarios WHERE usuario = ? AND password = ?",
    [usuario, password],
    (err, row) => {
      if (!row) return res.status(401).json({ error: "Credenciales invalidas" });
      delete row.password;
      res.json(row);
    }
  );
});

// --------------------------
// CRUD USUARIOS
// --------------------------
app.get("/api/usuarios", (req, res) => {
  const { rol } = req.query;
  let sql = "SELECT * FROM usuarios";
  const params = [];

  if (rol) {
    sql += " WHERE rol = ?";
    params.push(rol);
  }

  db.all(sql, params, (err, rows) => res.json(rows || []));
});

app.post("/api/usuarios", (req, res) => {
  const { usuario, password, rol, telefono, tarjeta } = req.body;

  db.run(
    `
    INSERT INTO usuarios (usuario, password, rol, telefono, tarjeta)
    VALUES (?, ?, ?, ?, ?)
    `,
    [usuario, password, rol, telefono, tarjeta],
    function () {
      res.json({ id: this.lastID });
    }
  );
});

app.put("/api/usuarios/:id", (req, res) => {
  const { usuario, password, telefono, tarjeta } = req.body;

  db.run(
    `
    UPDATE usuarios
    SET usuario = ?, password = ?, telefono = ?, tarjeta = ?
    WHERE id = ?
    `,
    [usuario, password, telefono, tarjeta, req.params.id],
    () => res.json({ mensaje: "Usuario actualizado" })
  );
});

app.delete("/api/usuarios/:id", (req, res) => {
  db.run("DELETE FROM usuarios WHERE id = ?", [req.params.id], () =>
    res.json({ mensaje: "Usuario eliminado" })
  );
});

// --------------------------
// GUARDAR TOKEN EXPO DEL USUARIO
// --------------------------
app.post("/api/usuarios/:id/token", (req, res) => {
  const { expo_push_token } = req.body;

  if (!expo_push_token) {
    return res.status(400).json({ error: "Falta expo_push_token" });
  }

  db.run(
    `
    UPDATE usuarios
    SET expo_push_token = ?
    WHERE id = ?
    `,
    [expo_push_token, req.params.id],
    (err) => {
      if (err) {
        return res.status(500).json({ error: "Error guardando token" });
      }
      res.json({ mensaje: "Token guardado" });
    }
  );
});

// =====================================================
//   INVENTARIO CRUD + EXPORTAR / IMPORTAR (CSV)
// =====================================================

app.get("/api/inventario", (req, res) => {
  db.all("SELECT * FROM inventario ORDER BY id DESC", [], (err, rows) =>
    res.json(rows || [])
  );
});

app.post("/api/inventario", upload.single("imagen"), (req, res) => {
  const { nombre, descripcion, precio_base, cantidad } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: "Debe subir una imagen" });
  }

  db.run(
    `
    INSERT INTO inventario
    (nombre, descripcion, precio_base, cantidad, imagen, fecha_creacion)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [nombre, descripcion, precio_base, cantidad, req.file.filename, ahora()],
    function () {
      res.json({ id: this.lastID, imagen: req.file.filename });
    }
  );
});

app.put("/api/inventario/:id", upload.single("imagen"), (req, res) => {
  const { nombre, descripcion, precio_base, cantidad, imagen_actual } = req.body;
  const imagen = req.file ? req.file.filename : imagen_actual;

  db.run(
    `
    UPDATE inventario
    SET nombre = ?, descripcion = ?, precio_base = ?, cantidad = ?, imagen = ?
    WHERE id = ?
    `,
    [nombre, descripcion, precio_base, cantidad, imagen, req.params.id],
    () => res.json({ mensaje: "Producto actualizado", imagen })
  );
});

app.delete("/api/inventario/:id", (req, res) => {
  db.run("DELETE FROM inventario WHERE id = ?", [req.params.id], () =>
    res.json({ mensaje: "Producto eliminado" })
  );
});

// -----------------------------------------------------
// EXPORTAR INVENTARIO A CSV
// GET /api/inventario/export
// -----------------------------------------------------
app.get("/api/inventario/export", (req, res) => {
  db.all("SELECT * FROM inventario ORDER BY id ASC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Error leyendo inventario" });
    }

    // Cabecera del CSV
    let csvData = "id,nombre,descripcion,precio_base,cantidad,imagen\n";

    rows.forEach((r) => {
      // Limpieza basica de comas y saltos
      const nombre = (r.nombre || "").toString().replace(/,/g, " ");
      const desc = (r.descripcion || "").toString().replace(/,/g, " ");
      const imagen = (r.imagen || "").toString().replace(/,/g, " ");

      csvData += `${r.id},${nombre},${desc},${r.precio_base},${r.cantidad},${imagen}\n`;
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=inventario.csv"
    );
    res.send(csvData);
  });
});

// -----------------------------------------------------
// IMPORTAR INVENTARIO DESDE CSV
// POST /api/inventario/import (campo "archivo")
// -----------------------------------------------------

// carpeta para CSV temporales (dentro de /data, que ya es persistente en Render)
const CSV_UPLOAD_PATH = path.join(__dirname, "data", "uploads");
if (!fs.existsSync(CSV_UPLOAD_PATH)) {
  fs.mkdirSync(CSV_UPLOAD_PATH, { recursive: true });
}
const uploadCSV = multer({ dest: CSV_UPLOAD_PATH });

app.post("/api/inventario/import", uploadCSV.single("archivo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se envio ningun archivo" });
  }

  const filePath = req.file.path;
  const items = [];

  fs.createReadStream(filePath)
    .pipe(fastcsv.parse({ headers: true }))
    .on("error", (error) => {
      console.error("Error leyendo CSV:", error);
      res.status(500).json({ error: "Error leyendo CSV" });
    })
    .on("data", (row) => {
      items.push(row);
    })
    .on("end", () => {
      db.serialize(() => {
        const stmt = db.prepare(
          `
          INSERT OR REPLACE INTO inventario
          (id, nombre, descripcion, precio_base, cantidad, imagen)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        );

        items.forEach((p) => {
          const id = p.id ? Number(p.id) : null;
          const nombre = p.nombre || "";
          const descripcion = p.descripcion || "";
          const precio_base = Number(p.precio_base || 0);
          const cantidad = Number(p.cantidad || 0);
          const imagen = p.imagen || "";

          stmt.run(id, nombre, descripcion, precio_base, cantidad, imagen);
        });

        stmt.finalize();
      });

      // borrar archivo temporal
      fs.unlink(filePath, () => {});

      res.json({ ok: true, mensaje: "Inventario importado correctamente" });
    });
});

// =====================================================
//                 PEDIDOS - CRUD PRINCIPAL
// =====================================================

// Crear pedido
app.post("/api/pedidos", (req, res) => {
  const {
    id_gestor,
    nombre_gestor,
    nombre_cliente,
    numero_cliente,
    direccion,
    tipo_pedido,
    horario,
    precio_mensajeria,
    productos,
  } = req.body;

  if (!productos || productos.length === 0) {
    return res.status(400).json({ error: "No hay productos" });
  }

  let totalProductos = 0;
  productos.forEach((p) => {
    totalProductos += Number(p.cantidad) * Number(p.precio_vendido);
  });

  const totalGeneral = totalProductos + (Number(precio_mensajeria) || 0);

  db.run(
    `
    INSERT INTO pedidos
    (id_gestor, nombre_gestor, nombre_cliente, numero_cliente, direccion,
     tipo_pedido, horario, precio_mensajeria, estado, total_productos,
     total_general, id_repartidor, fecha_creacion, fecha_entregado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, NULL, ?, NULL)
    `,
    [
      id_gestor,
      nombre_gestor,
      nombre_cliente,
      numero_cliente,
      direccion,
      tipo_pedido,
      horario,
      precio_mensajeria,
      totalProductos,
      totalGeneral,
      ahora(),
    ],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Error creando pedido" });
      }

      const idPedido = this.lastID;

      // Detalles del pedido + descuento de inventario
      productos.forEach((p) => {
        db.get(
          "SELECT precio_base FROM inventario WHERE id = ?",
          [p.id_producto],
          (err2, inv) => {
            if (err2) return;

            const precioBase = inv ? inv.precio_base : 0;
            const gan = Number(p.precio_vendido) - Number(precioBase);

            db.run(
              `
              INSERT INTO pedido_detalle
              (id_pedido, id_producto, cantidad_pedida, cantidad_entregada,
               precio_base, precio_vendido, ganancia)
              VALUES (?, ?, ?, 0, ?, ?, ?)
              `,
              [
                idPedido,
                p.id_producto,
                p.cantidad,
                precioBase,
                p.precio_vendido,
                gan,
              ]
            );

            // Descontar del inventario
            db.run(
              `
              UPDATE inventario
              SET cantidad = cantidad - ?
              WHERE id = ?
              `,
              [p.cantidad, p.id_producto]
            );
          }
        );
      });

      // Notificar a empresa: nuevo pedido
      db.all(
        "SELECT expo_push_token FROM usuarios WHERE rol = 'empresa' AND expo_push_token IS NOT NULL",
        [],
        (e3, filasEmp) => {
          if (!e3 && filasEmp && filasEmp.length > 0) {
            filasEmp.forEach((emp) => {
              enviarPush(
                emp.expo_push_token,
                "Nuevo pedido",
                "El gestor " +
                  nombre_gestor +
                  " creo el pedido #" +
                  idPedido +
                  " (" +
                  tipo_pedido +
                  ")",
                { tipo: "nuevo_pedido", id_pedido: idPedido }
              );
            });
          }

          res.json({ mensaje: "Pedido creado", id: idPedido });
        }
      );
    }
  );
});

// Listar todos los pedidos
app.get("/api/pedidos", (req, res) => {
  db.all(
    "SELECT * FROM pedidos ORDER BY fecha_creacion DESC",
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Error leyendo pedidos" });
      }
      res.json(rows || []);
    }
  );
});

// Pedidos de un gestor
app.get("/api/pedidos/gestor/:id", (req, res) => {
  db.all(
    `
    SELECT *
    FROM pedidos
    WHERE id_gestor = ?
    ORDER BY fecha_creacion DESC
    `,
    [req.params.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Error leyendo pedidos de gestor" });
      }
      res.json(rows || []);
    }
  );
});

// Pedidos de un repartidor
app.get("/api/pedidos/repartidor/:id", (req, res) => {
  db.all(
    `
    SELECT *
    FROM pedidos
    WHERE id_repartidor = ?
    ORDER BY fecha_creacion DESC
    `,
    [req.params.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Error pedidos repartidor" });
      }
      res.json(rows || []);
    }
  );
});

// Detalle de un pedido
app.get("/api/pedidos/:id", (req, res) => {
  const id = req.params.id;

  db.get(
    `
    SELECT 
      p.*,
      ur.usuario AS nombre_repartidor
    FROM pedidos p
    LEFT JOIN usuarios ur ON ur.id = p.id_repartidor
    WHERE p.id = ?
    `,
    [id],
    (err, pedido) => {
      if (err) {
        return res.status(500).json({ error: "Error leyendo pedido" });
      }
      if (!pedido) {
        return res.status(404).json({ error: "No existe pedido" });
      }

      db.all(
        `
        SELECT 
          d.*,
          i.nombre AS producto_nombre,
          i.imagen AS producto_imagen
        FROM pedido_detalle d
        JOIN inventario i ON i.id = d.id_producto
        WHERE d.id_pedido = ?
        `,
        [id],
        (err2, detalles) => {
          if (err2) {
            return res
              .status(500)
              .json({ error: "Error leyendo detalle pedido" });
          }

          res.json({ pedido, detalles: detalles || [] });
        }
      );
    }
  );
});

// =====================================================
//       APROBAR / ASIGNAR REPARTIDOR (EMPRESA)
// =====================================================
app.put("/api/pedidos/:id/asignar", (req, res) => {
  const { id_repartidor } = req.body;
  const pedidoId = req.params.id;

  db.run(
    `
    UPDATE pedidos
    SET estado = 'aprobado',
        id_repartidor = ?
    WHERE id = ?
    `,
    [id_repartidor, pedidoId],
    (err) => {
      if (err) {
        return res.status(500).json({ error: "Error asignando pedido" });
      }

      // Buscar info del pedido, gestor y repartidor
      db.get(
        `
        SELECT 
          p.*,
          ug.expo_push_token AS token_gestor,
          ur.expo_push_token AS token_repartidor,
          ur.usuario AS nombre_repartidor
        FROM pedidos p
        LEFT JOIN usuarios ug ON ug.id = p.id_gestor
        LEFT JOIN usuarios ur ON ur.id = p.id_repartidor
        WHERE p.id = ?
        `,
        [pedidoId],
        (e2, p) => {
          if (!e2 && p) {
            // Notificar al gestor
            if (p.token_gestor) {
              enviarPush(
                p.token_gestor,
                "Pedido aprobado",
                "Tu pedido #" + p.id + " fue aprobado y asignado a un repartidor",
                { tipo: "pedido_aprobado", id_pedido: p.id }
              );
            }

            // Notificar al repartidor
            if (p.token_repartidor) {
              enviarPush(
                p.token_repartidor,
                "Nuevo pedido asignado",
                "Tienes un nuevo pedido #" + p.id + " para entregar",
                { tipo: "pedido_asignado", id_pedido: p.id }
              );
            }
          }

          res.json({ mensaje: "Pedido aprobado y asignado" });
        }
      );
    }
  );
});

// =====================================================
//                 RECHAZAR PEDIDO
//  (IMPORTANTE: Ruta /api/pedidos/:id/rechazar)
// =====================================================
app.put("/api/pedidos/:id/rechazar", (req, res) => {
  const pedidoId = req.params.id;

  db.run(
    `
    UPDATE pedidos
    SET estado = 'rechazado'
    WHERE id = ?
    `,
    [pedidoId],
    (err) => {
      if (err) {
        return res.status(500).json({ error: "Error rechazando pedido" });
      }

      // Buscar gestor para notificacion
      db.get(
        `
        SELECT p.*, u.expo_push_token AS token_gestor
        FROM pedidos p
        LEFT JOIN usuarios u ON u.id = p.id_gestor
        WHERE p.id = ?
        `,
        [pedidoId],
        (e2, p) => {
          if (!e2 && p && p.token_gestor) {
            enviarPush(
              p.token_gestor,
              "Pedido rechazado",
              "Tu pedido #" + p.id + " fue rechazado por la empresa",
              { tipo: "pedido_rechazado", id_pedido: p.id }
            );
          }

          res.json({ mensaje: "Pedido rechazado correctamente" });
        }
      );
    }
  );
});

// =====================================================
//                   ENTREGAR PEDIDO
// =====================================================
app.post("/api/pedidos/:id/entregar", (req, res) => {
  const pedidoId = req.params.id;

  const lista =
    req.body.productos_entregados ||
    req.body.items ||
    [];

  if (!Array.isArray(lista) || lista.length === 0) {
    return res.status(400).json({ error: "Lista vacia" });
  }

  lista.forEach((item) => {
    const detalleId = item.detalle_id;
    const entregada = Number(item.cantidad_entregada || 0);

    db.get(
      `
      SELECT id_producto, cantidad_pedida
      FROM pedido_detalle
      WHERE id = ? AND id_pedido = ?
      `,
      [detalleId, pedidoId],
      (err, detalle) => {
        if (!detalle) return;

        const devolver = detalle.cantidad_pedida - entregada;

        // Actualizar cantidad entregada
        db.run(
          `
          UPDATE pedido_detalle
          SET cantidad_entregada = ?
          WHERE id = ?
          `,
          [entregada, detalleId]
        );

        // Devolver al inventario lo no entregado
        if (devolver > 0) {
          db.run(
            `
            UPDATE inventario
            SET cantidad = cantidad + ?
            WHERE id = ?
            `,
            [devolver, detalle.id_producto]
          );
        }
      }
    );
  });

  db.run(
    `
    UPDATE pedidos
    SET estado = 'entregado',
        fecha_entregado = ?
    WHERE id = ?
    `,
    [ahora(), pedidoId],
    (err) => {
      if (err) {
        return res.status(500).json({ error: "Error entregando pedido" });
      }

      // Info del pedido y token del gestor
      db.get(
        `
        SELECT p.*, ug.expo_push_token AS token_gestor
        FROM pedidos p
        LEFT JOIN usuarios ug ON ug.id = p.id_gestor
        WHERE p.id = ?
        `,
        [pedidoId],
        (e2, p) => {
          if (!e2 && p && p.token_gestor) {
            enviarPush(
              p.token_gestor,
              "Pedido entregado",
              "Tu pedido #" + p.id + " fue entregado correctamente",
              { tipo: "pedido_entregado", id_pedido: p.id }
            );
          }

          // Notificar a empresa
          db.all(
            "SELECT expo_push_token FROM usuarios WHERE rol = 'empresa' AND expo_push_token IS NOT NULL",
            [],
            (e3, filasEmp) => {
              if (!e3 && filasEmp && filasEmp.length > 0) {
                filasEmp.forEach((emp) => {
                  enviarPush(
                    emp.expo_push_token,
                    "Pedido entregado",
                    "El pedido #" + pedidoId + " ya fue entregado",
                    { tipo: "pedido_entregado", id_pedido: pedidoId }
                  );
                });
              }

              res.json({ mensaje: "Pedido entregado" });
            }
          );
        }
      );
    }
  );
});

// =====================================================
//                  HISTORIAL / RESUMEN
// =====================================================

// Historial local por dia
app.get("/api/historial/local/dia/:fecha", (req, res) => {
  const f = req.params.fecha;

  db.all(
    `
    SELECT *
    FROM pedidos
    WHERE tipo_pedido = 'local'
      AND estado = 'entregado'
      AND DATE(fecha_entregado) = ?
    ORDER BY fecha_creacion DESC
    `,
    [f],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Error historial local" });
      }
      res.json(rows || []);
    }
  );
});

// Historial domicilio por dia
app.get("/api/historial/domicilio/dia/:fecha", (req, res) => {
  const f = req.params.fecha;

  db.all(
    `
    SELECT *
    FROM pedidos
    WHERE tipo_pedido = 'domicilio'
      AND estado = 'entregado'
      AND DATE(fecha_entregado) = ?
    ORDER BY fecha_creacion DESC
    `,
    [f],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Error historial domicilio" });
      }
      res.json(rows || []);
    }
  );
});

// Historial por gestor
app.get("/api/historial/gestor/:id/:fecha", (req, res) => {
  const id = req.params.id;
  const f = req.params.fecha;

  db.all(
    `
    SELECT *
    FROM pedidos
    WHERE id_gestor = ?
      AND estado = 'entregado'
      AND DATE(fecha_entregado) = ?
    ORDER BY fecha_creacion DESC
    `,
    [id, f],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Error historial gestor" });
      }
      res.json(rows || []);
    }
  );
});

// Historial por repartidor
app.get("/api/historial/repartidor/:id/:fecha", (req, res) => {
  const id = req.params.id;
  const f = req.params.fecha;

  db.all(
    `
    SELECT *
    FROM pedidos
    WHERE id_repartidor = ?
      AND estado = 'entregado'
      AND DATE(fecha_entregado) = ?
    ORDER BY fecha_entregado DESC
    `,
    [id, f],
    (err, rows) => {
      if (err) {
        return res
          .status(500)
          .json({ error: "Error historial repartidor" });
      }
      res.json(rows || []);
    }
  );
});

// Resumen del dia por gestor
app.get("/api/historial/resumen/:fecha", (req, res) => {
  const fecha = req.params.fecha;
  const resumen = {};

  db.all(
    `
    SELECT 
      p.id_gestor,
      p.nombre_gestor,
      u.telefono,
      u.tarjeta,
      SUM(d.cantidad_entregada * d.precio_vendido) AS vendido,
      SUM(d.ganancia * d.cantidad_entregada) AS ganancia
    FROM pedido_detalle d
    JOIN pedidos p ON p.id = d.id_pedido
    JOIN usuarios u ON u.id = p.id_gestor
    WHERE p.estado = 'entregado'
      AND DATE(p.fecha_entregado) = ?
    GROUP BY p.id_gestor
    `,
    [fecha],
    (err, filasGestores) => {
      if (err) {
        return res.status(500).json({ error: "Error resumen gestores" });
      }

      resumen.gestores = filasGestores || [];

      db.all(
        `
        SELECT
          p.id_gestor,
          i.nombre AS producto,
          SUM(d.cantidad_entregada) AS total
        FROM pedido_detalle d
        JOIN pedidos p ON p.id = d.id_pedido
        JOIN inventario i ON i.id = d.id_producto
        WHERE p.estado = 'entregado'
          AND DATE(p.fecha_entregado) = ?
        GROUP BY p.id_gestor, d.id_producto
        `,
        [fecha],
        (err2, filasProductos) => {
          if (err2) {
            return res
              .status(500)
              .json({ error: "Error resumen productos" });
          }

          resumen.productos = filasProductos || [];
          res.json(resumen);
        }
      );
    }
  );
});

// =====================================================
//              INICIAR SERVIDOR
// =====================================================
app.listen(PORT, () => {
  console.log("Servidor API listo en puerto:", PORT);
});
