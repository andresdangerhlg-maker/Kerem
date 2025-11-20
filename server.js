// CanonJet / Kerem Backend
// Node + Express + SQLite + Multer

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

// ------------------------
// RUTA PARA IMAGENES
// ------------------------
const IMAGES_PATH = path.join(__dirname, "public", "images");
if (!fs.existsSync(IMAGES_PATH)) {
  fs.mkdirSync(IMAGES_PATH, { recursive: true });
}
app.use("/images", express.static(IMAGES_PATH));

// ------------------------
// MULTER - SUBIDA DE IMAGENES
// ------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMAGES_PATH),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, "img_" + Date.now() + ext);
  },
});
const upload = multer({ storage });

// ------------------------
// BASE DE DATOS
// ------------------------
const DB_PATH = path.join(__dirname, "data", "database.sqlite");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("Error SQLite:", err.message);
  else console.log("SQLite funcionando en:", DB_PATH);
});

// ------------------------
// CREAR TABLAS
// ------------------------
db.serialize(() => {
  // USUARIOS
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT,
      password TEXT,
      rol TEXT,
      telefono TEXT,
      tarjeta TEXT
    )
  `);

  // INVENTARIO
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

  // PEDIDOS (ya incluye fecha_entregado)
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

  // DETALLES
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

  // Asegurar columna fecha_entregado si la BD es vieja
  db.all("PRAGMA table_info(pedidos)", (err, rows) => {
    if (!rows.some((c) => c.name === "fecha_entregado")) {
      db.run("ALTER TABLE pedidos ADD COLUMN fecha_entregado TEXT");
    }
  });

  // USUARIOS DE PRUEBA
  db.get("SELECT COUNT(*) AS total FROM usuarios", [], (err, row) => {
    if (row.total === 0) {
      db.run(`
        INSERT INTO usuarios (usuario, password, rol, telefono, tarjeta)
        VALUES
          ('gestor','123','gestor','00000000','0000'),
          ('empresa','123','empresa','00000000','0000'),
          ('empresaa','123','empresa','00000000','0000'),
          ('repartidor','123','repartidor','00000000','0000')
      `);
    }
  });
});

// ------------------------
// LOGIN
// ------------------------
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

// ------------------------
// USUARIOS CRUD
// ------------------------
app.get("/api/usuarios", (req, res) => {
  const { rol } = req.query;
  let sql = "SELECT * FROM usuarios";
  const params = [];

  if (rol) {
    sql += " WHERE rol = ?";
    params.push(rol);
  }

  db.all(sql, params, (err, rows) => res.json(rows));
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

// ------------------------
// INVENTARIO CRUD
// ------------------------
app.get("/api/inventario", (req, res) => {
  db.all("SELECT * FROM inventario ORDER BY id DESC", [], (err, rows) =>
    res.json(rows)
  );
});

app.post("/api/inventario", upload.single("imagen"), (req, res) => {
  const { nombre, descripcion, precio_base, cantidad } = req.body;

  if (!req.file) return res.status(400).json({ error: "Debe subir una imagen" });

  db.run(
    `
    INSERT INTO inventario
    (nombre, descripcion, precio_base, cantidad, imagen, fecha_creacion)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    `,
    [nombre, descripcion, precio_base, cantidad, req.file.filename],
    function () {
      res.json({ id: this.lastID, imagen: req.file.filename });
    }
  );
});

// Actualizar producto
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

// Eliminar producto
app.delete("/api/inventario/:id", (req, res) => {
  db.run("DELETE FROM inventario WHERE id = ?", [req.params.id], () =>
    res.json({ mensaje: "Producto eliminado" })
  );
});

// ------------------------
// CREAR PEDIDO
// ------------------------
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

  if (!productos || productos.length === 0)
    return res.status(400).json({ error: "No hay productos" });

  let totalProductos = 0;
  productos.forEach((p) => {
    totalProductos += Number(p.cantidad) * Number(p.precio_vendido);
  });

  const totalGeneral =
    totalProductos + (Number(precio_mensajeria) || 0);

  db.run(
    `
    INSERT INTO pedidos
    (id_gestor, nombre_gestor, nombre_cliente, numero_cliente, direccion,
     tipo_pedido, horario, precio_mensajeria, estado, total_productos,
     total_general, id_repartidor, fecha_creacion, fecha_entregado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, NULL, datetime('now'), NULL)
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
    ],
    function (err) {
      if (err) return res.status(500).json({ error: "Error creando pedido" });

      const idPedido = this.lastID;

      productos.forEach((p) => {
        db.get(
          "SELECT precio_base FROM inventario WHERE id = ?",
          [p.id_producto],
          (err2, inv) => {
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

      res.json({ mensaje: "Pedido creado", id: idPedido });
    }
  );
});
// ------------------------
// LISTA PEDIDOS COMPLETA
// ------------------------
app.get("/api/pedidos", (req, res) => {
  db.all(
    "SELECT * FROM pedidos ORDER BY fecha_creacion DESC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Error leyendo pedidos" });
      res.json(rows);
    }
  );
});

// ------------------------
// PEDIDOS DE UN GESTOR
// ------------------------
app.get("/api/pedidos/gestor/:id", (req, res) => {
  db.all(
    `
    SELECT * FROM pedidos
    WHERE id_gestor = ?
    ORDER BY fecha_creacion DESC
    `,
    [req.params.id],
    (err, rows) => {
      if (err)
        return res.status(500).json({
          error: "Error leyendo pedidos de gestor",
        });

      res.json(rows);
    }
  );
});

// ------------------------
// NUEVO ? PEDIDOS POR REPARTIDOR
// ------------------------
app.get("/api/pedidos/repartidor/:id", (req, res) => {
  const id = req.params.id;

  db.all(
    `
    SELECT *
    FROM pedidos
    WHERE id_repartidor = ?
    ORDER BY fecha_creacion DESC
    `,
    [id],
    (err, rows) => {
      if (err) {
        return res
          .status(500)
          .json({ error: "Error leyendo pedidos repartidor" });
      }
      res.json(rows);
    }
  );
});

// ------------------------
// DETALLE DE PEDIDO
// ------------------------
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
      if (err) return res.status(500).json({ error: "Error leyendo pedido" });
      if (!pedido) return res.status(404).json({ error: "No existe pedido" });

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
          if (err2)
            return res
              .status(500)
              .json({ error: "Error leyendo detalle de pedido" });

          res.json({ pedido, detalles });
        }
      );
    }
  );
});

// ------------------------
// APROBAR Y ASIGNAR REPARTIDOR
// ------------------------
app.put("/api/pedidos/:id/asignar", (req, res) => {
  const { id_repartidor } = req.body;

  db.run(
    `
    UPDATE pedidos
    SET estado = 'aprobado',
        id_repartidor = ?
    WHERE id = ?
    `,
    [id_repartidor, req.params.id],
    (err) => {
      if (err)
        return res.status(500).json({ error: "Error asignando pedido" });
      res.json({ mensaje: "Pedido aprobado y asignado" });
    }
  );
});

// ------------------------
// ENTREGAR PEDIDO ? (CON FECHA_ENTREGADO)
// ------------------------
app.post("/api/pedidos/:id/entregar", (req, res) => {
  const pedidoId = req.params.id;

  const lista =
    req.body.productos_entregados ||
    req.body.items ||
    [];

  if (!Array.isArray(lista) || lista.length === 0) {
    return res.status(400).json({ error: "Lista vacía" });
  }

  lista.forEach((item) => {
    const detalleId = item.detalle_id;
    const entregada = Number(item.cantidad_entregada) || 0;

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

        db.run(
          `
          UPDATE pedido_detalle
          SET cantidad_entregada = ?
          WHERE id = ?
          `,
          [entregada, detalleId]
        );

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
        fecha_entregado = datetime('now')
    WHERE id = ?
    `,
    [pedidoId],
    (err) => {
      if (err)
        return res.status(500).json({ error: "Error entregando pedido" });
      res.json({ mensaje: "Pedido entregado" });
    }
  );
});

// ------------------------
// HISTORIAL LOCAL (SOLO ENTREGADOS)
// ------------------------
app.get("/api/historial/local/dia/:fecha", (req, res) => {
  const f = req.params.fecha;

  db.all(
    `
    SELECT *
    FROM pedidos
    WHERE tipo_pedido = 'local'
      AND estado = 'entregado'
      AND (
        (fecha_entregado IS NOT NULL AND DATE(fecha_entregado) = ?)
        OR (fecha_entregado IS NULL AND DATE(fecha_creacion) = ?)
      )
    ORDER BY fecha_creacion DESC
    `,
    [f, f],
    (err, rows) => {
      if (err)
        return res.status(500).json({ error: "Error historial local" });

      res.json(rows);
    }
  );
});

// ------------------------
// HISTORIAL DOMICILIO
// ------------------------
app.get("/api/historial/domicilio/dia/:fecha", (req, res) => {
  const f = req.params.fecha;

  db.all(
    `
    SELECT *
    FROM pedidos
    WHERE tipo_pedido = 'domicilio'
      AND estado = 'entregado'
      AND (
        (fecha_entregado IS NOT NULL AND DATE(fecha_entregado) = ?)
        OR (fecha_entregado IS NULL AND DATE(fecha_creacion) = ?)
      )
    ORDER BY fecha_creacion DESC
    `,
    [f, f],
    (err, rows) => {
      if (err)
        return res
          .status(500)
          .json({ error: "Error historial domicilio" });

      res.json(rows);
    }
  );
});

// ------------------------
// HISTORIAL POR GESTOR
// ------------------------
app.get("/api/historial/gestor/:id/:fecha", (req, res) => {
  const id = req.params.id;
  const f = req.params.fecha;

  db.all(
    `
    SELECT *
    FROM pedidos
    WHERE id_gestor = ?
      AND estado = 'entregado'
      AND (
        (fecha_entregado IS NOT NULL AND DATE(fecha_entregado) = ?)
        OR (fecha_entregado IS NULL AND DATE(fecha_creacion) = ?)
      )
    ORDER BY fecha_creacion DESC
    `,
    [id, f, f],
    (err, rows) => {
      if (err)
        return res.status(500).json({
          error: "Error historial gestor",
        });

      res.json(rows);
    }
  );
});

// ------------------------
// HISTORIAL POR REPARTIDOR (NUEVO ?)
// ------------------------
app.get("/api/historial/repartidor/:id/:fecha", (req, res) => {
  const id = req.params.id;
  const f = req.params.fecha;

  db.all(
    `
    SELECT *
    FROM pedidos
    WHERE id_repartidor = ?
      AND estado = 'entregado'
      AND (
        (fecha_entregado IS NOT NULL AND DATE(fecha_entregado) = ?)
        OR (fecha_entregado IS NULL AND DATE(fecha_creacion) = ?)
      )
    ORDER BY fecha_entregado DESC
    `,
    [id, f, f],
    (err, rows) => {
      if (err)
        return res.status(500).json({ error: "Error historial repartidor" });

      res.json(rows);
    }
  );
});

// ------------------------
// RESUMEN DEL DIA POR GESTOR
// ------------------------
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
      AND (
        (p.fecha_entregado IS NOT NULL AND DATE(p.fecha_entregado) = ?)
        OR (p.fecha_entregado IS NULL AND DATE(p.fecha_creacion) = ?)
      )
    GROUP BY p.id_gestor
    `,
    [fecha, fecha],
    (err, filasGestores) => {
      if (err)
        return res.status(500).json({ error: "Error resumen gestores" });

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
          AND (
            (p.fecha_entregado IS NOT NULL AND DATE(p.fecha_entregado) = ?)
            OR (p.fecha_entregado IS NULL AND DATE(p.fecha_creacion) = ?)
          )
        GROUP BY p.id_gestor, d.id_producto
        `,
        [fecha, fecha],
        (err2, filasProductos) => {
          if (err2)
            return res
              .status(500)
              .json({ error: "Error resumen productos" });

          resumen.productos = filasProductos || [];
          res.json(resumen);
        }
      );
    }
  );
});

// ------------------------
// INICIO SERVER
// ------------------------
app.listen(PORT, () => {
  console.log("Servidor API listo en http://localhost:" + PORT);
});

