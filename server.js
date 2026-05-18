// CanonJet / Kerem Backend
// Node + Express + SQLite + Multer

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 4000;
let DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

function ensureWritableDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.accessSync(dir, fs.constants.W_OK);
}

try {
  ensureWritableDir(DATA_DIR);
} catch (err) {
  const renderDiskPath = path.join(__dirname, "data");
  if (DATA_DIR !== renderDiskPath) {
    console.log("DATA_DIR no disponible, usando disco local persistente:", renderDiskPath);
    DATA_DIR = renderDiskPath;
    ensureWritableDir(DATA_DIR);
  } else {
    throw err;
  }
}

app.use(cors());
app.use(express.json());

// ----------------------------------------
// FUNCION HORA LOCAL (CUBA UTC-5)
// ----------------------------------------
function ahora() {
  const date = new Date();
  date.setHours(date.getHours() - 5); // Ajuste UTC-5
  return date.toISOString().replace("T", " ").split(".")[0];
}

// ----------------------------------------
// FUNCION PARA ENVIAR NOTIFICACIONES EXPO
// ----------------------------------------
async function enviarPush(expoToken, titulo, cuerpo, dataExtra = {}) {
  if (!expoToken || !expoToken.startsWith("ExponentPushToken")) {
    return;
  }

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

// ----------------------------------------
// RUTA PARA IMAGENES
// ----------------------------------------
const IMAGES_PATH = process.env.IMAGES_DIR || (
  process.env.DATA_DIR ? path.join(DATA_DIR, "images") : path.join(__dirname, "public", "images")
);
if (!fs.existsSync(IMAGES_PATH)) {
  fs.mkdirSync(IMAGES_PATH, { recursive: true });
}
app.use("/images", express.static(IMAGES_PATH));

// ----------------------------------------
// MULTER PARA IMAGENES
// ----------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMAGES_PATH),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, "img_" + Date.now() + ext);
  },
});
const upload = multer({ storage });

// MULTER PARA CSV INVENTARIO
const CSV_PATH = process.env.UPLOADS_DIR || (
  process.env.DATA_DIR ? path.join(DATA_DIR, "uploads") : path.join(__dirname, "uploads")
);
if (!fs.existsSync(CSV_PATH)) {
  fs.mkdirSync(CSV_PATH, { recursive: true });
}
const uploadCsv = multer({ dest: CSV_PATH });

// ----------------------------------------
// BASE DE DATOS
// ----------------------------------------
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "database.sqlite");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("Error SQLite:", err.message);
  else console.log("SQLite funcionando en:", DB_PATH);
});

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "kerem-server",
    message: "Servidor Kerem activo",
  });
});

app.get("/healthz", (req, res) => {
  db.get("SELECT 1 AS ok", [], (err) => {
    if (err) return res.status(500).json({ ok: false, error: "sqlite" });
    res.json({ ok: true });
  });
});

// ----------------------------------------
// CREAR TABLAS
// ----------------------------------------
db.serialize(() => {

  // --- TABLA USUARIOS
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

  // --- TABLA INVENTARIO
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

  // --- TABLA PEDIDOS
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

  // --- TABLA DETALLE PEDIDOS
  db.run(`
    CREATE TABLE IF NOT EXISTS pedido_detalle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_pedido INTEGER,
      id_producto INTEGER,
      cantidad_pedida INTEGER,
      cantidad_entregada INTEGER,
      precio_base REAL,
      precio_vendido REAL,
      ganancia REAL,
      imagen_seleccionada TEXT
    )
  `);
  db.run("ALTER TABLE pedido_detalle ADD COLUMN imagen_seleccionada TEXT", () => {});

  // --- TABLA ANUNCIOS (NUEVA)
  db.run(`
    CREATE TABLE IF NOT EXISTS anuncios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mensaje TEXT,
      fecha_creacion TEXT
    )
  `);


  // --- TABLA IMAGENES INVENTARIO
  db.run(`
    CREATE TABLE IF NOT EXISTS inventario_imagenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_producto INTEGER,
      imagen TEXT,
      orden INTEGER,
      fecha_creacion TEXT
    )
  `);  // Asegurar columnas nuevas
  db.all("PRAGMA table_info(usuarios)", (err, rows) => {
    if (!rows.some((c) => c.name === "expo_push_token")) {
      db.run("ALTER TABLE usuarios ADD COLUMN expo_push_token TEXT");
    }
  });

  db.all("PRAGMA table_info(pedidos)", (err, rows) => {
    if (!rows.some((c) => c.name === "fecha_entregado")) {
      db.run("ALTER TABLE pedidos ADD COLUMN fecha_entregado TEXT");
    }
  });

  // Migrar la imagen principal vieja a la tabla de imagenes multiples
  db.all(
    `
    SELECT i.id, i.imagen
    FROM inventario i
    WHERE i.imagen IS NOT NULL
      AND i.imagen <> ''
      AND NOT EXISTS (
        SELECT 1 FROM inventario_imagenes ii
        WHERE ii.id_producto = i.id
      )
    `,
    [],
    (err, rows) => {
      if (!err && rows && rows.length > 0) {
        const stmt = db.prepare(
          "INSERT INTO inventario_imagenes (id_producto, imagen, orden, fecha_creacion) VALUES (?, ?, 0, ?)"
        );
        rows.forEach((row) => stmt.run(row.id, row.imagen, ahora()));
        stmt.finalize();
      }
    }
  );
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

// ----------------------------------------
// LOGIN
// ----------------------------------------
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

// ----------------------------------------
// CRUD USUARIOS
// ----------------------------------------
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

// OBTENER USUARIO POR ID
app.get("/api/usuarios/:id", (req, res) => {
  db.get(
    `SELECT id, usuario, rol, telefono, tarjeta, expo_push_token
     FROM usuarios
     WHERE id = ?`,
    [req.params.id],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: "Error obteniendo usuario" });
      }
      if (!row) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }
      res.json(row);
    }
  );
});

// CREAR USUARIO
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

// ACTUALIZAR USUARIO
app.put("/api/usuarios/:id", (req, res) => {
  const { usuario, password, telefono, tarjeta, rol } = req.body;

  const fields = [
    "usuario = ?",
    "telefono = ?",
    "tarjeta = ?",
  ];
  const params = [usuario, telefono, tarjeta];

  if (rol) {
    fields.push("rol = ?");
    params.push(rol);
  }

  if (password && String(password).trim() !== "") {
    fields.push("password = ?");
    params.push(password);
  }

  params.push(req.params.id);

  db.run(
    `
    UPDATE usuarios
    SET ${fields.join(", ")}
    WHERE id = ?
    `,
    params,
    (err) => {
      if (err) {
        return res.status(500).json({ error: "Error actualizando usuario" });
      }
      res.json({ mensaje: "Usuario actualizado" });
    }
  );
});
// ELIMINAR USUARIO
app.delete("/api/usuarios/:id", (req, res) => {
  db.run("DELETE FROM usuarios WHERE id = ?", [req.params.id], () =>
    res.json({ mensaje: "Usuario eliminado" })
  );
});

// GUARDAR TOKEN EXPO DEL USUARIO
app.post("/api/usuarios/:id/token", (req, res) => {
  const { expo_push_token } = req.body;

  db.run(
    `
    UPDATE usuarios
    SET expo_push_token = ?
    WHERE id = ?
    `,
    [expo_push_token || null, req.params.id],
    (err) => {
      if (err) {
        return res.status(500).json({ error: "Error guardando token" });
      }
      res.json({ mensaje: "Token guardado" });
    }
  );
});

// ----------------------------------------
// INVENTARIO CRUD
// ----------------------------------------
function adjuntarImagenes(productos, callback) {
  const lista = productos || [];
  if (lista.length === 0) return callback([]);

  const ids = lista.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");

  db.all(
    `
    SELECT id_producto, imagen
    FROM inventario_imagenes
    WHERE id_producto IN (${placeholders})
    ORDER BY orden ASC, id ASC
    `,
    ids,
    (err, imagenes) => {
      const porProducto = new Map();
      (imagenes || []).forEach((img) => {
        const current = porProducto.get(img.id_producto) || [];
        current.push(img.imagen);
        porProducto.set(img.id_producto, current);
      });

      callback(
        lista.map((producto) => {
          const imagenesProducto = porProducto.get(producto.id) || [];
          const imagenPrincipal = producto.imagen || imagenesProducto[0] || null;
          return {
            ...producto,
            imagen: imagenPrincipal,
            imagenes: imagenesProducto.length > 0 ? imagenesProducto : imagenPrincipal ? [imagenPrincipal] : [],
          };
        })
      );
    }
  );
}

app.get("/api/inventario", (req, res) => {
  db.all("SELECT * FROM inventario ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error leyendo inventario" });
    adjuntarImagenes(rows || [], (productos) => res.json(productos));
  });
});

app.post("/api/inventario", upload.fields([{ name: "imagen", maxCount: 1 }, { name: "imagenes", maxCount: 20 }]), (req, res) => {
  const { nombre, descripcion, precio_base, cantidad } = req.body;
  const files = [
    ...((req.files && req.files.imagen) || []),
    ...((req.files && req.files.imagenes) || []),
  ];

  if (files.length === 0) return res.status(400).json({ error: "Debe subir al menos una imagen" });
  const imagenPrincipal = files[0].filename;

  db.run(
    `
    INSERT INTO inventario
    (nombre, descripcion, precio_base, cantidad, imagen, fecha_creacion)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [nombre, descripcion, precio_base, cantidad, imagenPrincipal, ahora()],
    function (err) {
      if (err) return res.status(500).json({ error: "Error creando producto" });

      const idProducto = this.lastID;
      const stmt = db.prepare(
        "INSERT INTO inventario_imagenes (id_producto, imagen, orden, fecha_creacion) VALUES (?, ?, ?, ?)"
      );
      files.forEach((file, index) => stmt.run(idProducto, file.filename, index, ahora()));
      stmt.finalize(() => {
        res.json({ id: idProducto, imagen: imagenPrincipal, imagenes: files.map((file) => file.filename) });
      });
    }
  );
});

app.put("/api/inventario/:id", upload.fields([{ name: "imagen", maxCount: 1 }, { name: "imagenes", maxCount: 20 }]), (req, res) => {
  const { nombre, descripcion, precio_base, cantidad, imagen_actual } = req.body;
  const files = [
    ...((req.files && req.files.imagen) || []),
    ...((req.files && req.files.imagenes) || []),
  ];
  const reemplazarImagenes = req.body.reemplazar_imagenes === "1";
  let imagenesEliminar = [];
  try {
    imagenesEliminar = req.body.imagenes_eliminar ? JSON.parse(req.body.imagenes_eliminar) : [];
  } catch (e) {
    imagenesEliminar = [];
  }
  if (!Array.isArray(imagenesEliminar)) imagenesEliminar = [];
  imagenesEliminar = imagenesEliminar.map((item) => String(item)).filter(Boolean);
  const nuevaPrincipal = files.length > 0 ? files[0].filename : null;
  const imagenInicial = nuevaPrincipal || imagen_actual;

  db.run(
    `
    UPDATE inventario
    SET nombre = ?, descripcion = ?, precio_base = ?, cantidad = ?, imagen = ?
    WHERE id = ?
    `,
    [nombre, descripcion, precio_base, cantidad, imagenInicial, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: "Error actualizando producto" });

      const insertar = () => {
        const finalizar = () => {
          db.all(
            "SELECT imagen FROM inventario_imagenes WHERE id_producto = ? ORDER BY orden ASC, id ASC",
            [req.params.id],
            (selectErr, rows) => {
              if (selectErr) return res.status(500).json({ error: "Error actualizando imagenes" });
              const imagenes = (rows || []).map((row) => row.imagen);
              const imagenFinal = imagenes.includes(imagenInicial) ? imagenInicial : imagenes[0] || null;
              db.run("UPDATE inventario SET imagen = ? WHERE id = ?", [imagenFinal, req.params.id], () => {
                res.json({ mensaje: "Producto actualizado", imagen: imagenFinal, imagenes });
              });
            }
          );
        };

        if (files.length === 0) return finalizar();

        db.get(
          "SELECT COALESCE(MAX(orden), -1) AS maxOrden FROM inventario_imagenes WHERE id_producto = ?",
          [req.params.id],
          (ordenErr, row) => {
            if (ordenErr) return res.status(500).json({ error: "Error actualizando imagenes" });
            const startOrder = Number(row?.maxOrden ?? -1) + 1;
            const stmt = db.prepare(
              "INSERT INTO inventario_imagenes (id_producto, imagen, orden, fecha_creacion) VALUES (?, ?, ?, ?)"
            );
            files.forEach((file, index) => stmt.run(req.params.id, file.filename, startOrder + index, ahora()));
            stmt.finalize(finalizar);
          }
        );
      };

      if (reemplazarImagenes || imagenesEliminar.length > 0) {
        const params = [req.params.id];
        let sql = "DELETE FROM inventario_imagenes WHERE id_producto = ?";
        if (!reemplazarImagenes && imagenesEliminar.length > 0) {
          sql += ` AND imagen IN (${imagenesEliminar.map(() => "?").join(",")})`;
          params.push(...imagenesEliminar);
        }
        db.run(sql, params, insertar);
      } else {
        insertar();
      }
    }
  );
});

app.delete("/api/inventario/:id", (req, res) => {
  db.run("DELETE FROM inventario_imagenes WHERE id_producto = ?", [req.params.id], () => {
    db.run("DELETE FROM inventario WHERE id = ?", [req.params.id], () =>
      res.json({ mensaje: "Producto eliminado" })
    );
  });
});
app.put("/api/inventario/:id/descontar", (req, res) => {
  const cantidad = Number(req.body.cantidad || 0);

  if (!cantidad || cantidad <= 0) {
    return res.status(400).json({ error: "Cantidad invalida" });
  }

  db.run(
    `
    UPDATE inventario
    SET cantidad = cantidad - ?
    WHERE id = ?
    `,
    [cantidad, req.params.id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Error descontando inventario" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }
      res.json({ mensaje: "Inventario actualizado" });
    }
  );
});
// EXPORTAR INVENTARIO A CSV
app.get("/api/inventario/export", (req, res) => {
  db.all("SELECT * FROM inventario ORDER BY id ASC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Error exportando inventario" });
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="inventario.csv"'
    );

    const header = "id,nombre,descripcion,precio_base,cantidad,imagen,fecha_creacion\n";
    const lines = (rows || []).map((r) => {
      const nombre = (r.nombre || "").replace(/"/g, '""');
      const desc = (r.descripcion || "").replace(/"/g, '""');
      const img = (r.imagen || "").replace(/"/g, '""');
      return `${r.id},"${nombre}","${desc}",${r.precio_base || 0},${r.cantidad || 0},"${img}",${r.fecha_creacion || ""}`;
    });

    res.send(header + lines.join("\n"));
  });
});

// IMPORTAR INVENTARIO DESDE CSV
app.post("/api/inventario/import", uploadCsv.single("csv"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se recibio el archivo CSV" });
  }

  const filePath = req.file.path;

  fs.readFile(filePath, "utf8", (err, content) => {
    if (err) {
      return res.status(500).json({ error: "Error leyendo CSV" });
    }

    const lineas = content.split(/\r?\n/).filter((l) => l.trim() !== "");
    // Saltar encabezado
    lineas.shift();

    db.serialize(() => {
      db.run("DELETE FROM inventario");

      const stmt = db.prepare(
        `
        INSERT INTO inventario
        (nombre, descripcion, precio_base, cantidad, imagen, fecha_creacion)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      );

      lineas.forEach((line) => {
        const cols = line.split(",");

        if (cols.length < 5) return;

        const nombre = cols[1]?.replace(/^"|"$/g, "") || "";
        const descripcion = cols[2]?.replace(/^"|"$/g, "") || "";
        const precio_base = parseFloat(cols[3]) || 0;
        const cantidad = parseInt(cols[4]) || 0;
        const imagen = cols[5]?.replace(/^"|"$/g, "") || "";

        stmt.run(
          nombre,
          descripcion,
          precio_base,
          cantidad,
          imagen,
          ahora()
        );
      });

      stmt.finalize(() => {
        fs.unlink(filePath, () => {});
        res.json({ mensaje: "Inventario importado correctamente" });
      });
    });
  });
});

// ----------------------------------------
// CREAR PEDIDO
// ----------------------------------------
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
               precio_base, precio_vendido, ganancia, imagen_seleccionada)
              VALUES (?, ?, ?, 0, ?, ?, ?, ?)
              `,
              [
                idPedido,
                p.id_producto,
                p.cantidad,
                precioBase,
                p.precio_vendido,
                gan,
                p.imagen_seleccionada || null,
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
                `El gestor ${nombre_gestor} creo el pedido #${idPedido} (${tipo_pedido})`,
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

// ----------------------------------------
// LISTAR TODOS LOS PEDIDOS
// ----------------------------------------
app.get("/api/pedidos", (req, res) => {
  db.all(
    "SELECT * FROM pedidos ORDER BY fecha_creacion DESC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Error leyendo pedidos" });
      res.json(rows || []);
    }
  );
});

// ----------------------------------------
// PEDIDOS POR GESTOR
// ----------------------------------------
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

      res.json(rows || []);
    }
  );
});

// ----------------------------------------
// PEDIDOS POR REPARTIDOR
// ----------------------------------------
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
      if (err)
        return res.status(500).json({ error: "Error pedidos repartidor" });

      res.json(rows || []);
    }
  );
});

// ----------------------------------------
// DETALLE DE UN PEDIDO
// ----------------------------------------
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
          COALESCE(d.imagen_seleccionada, i.imagen) AS producto_imagen,
          (
            SELECT GROUP_CONCAT(ii.imagen, '|')
            FROM inventario_imagenes ii
            WHERE ii.id_producto = i.id
            ORDER BY ii.orden ASC, ii.id ASC
          ) AS producto_imagenes
        FROM pedido_detalle d
        JOIN inventario i ON i.id = d.id_producto
        WHERE d.id_pedido = ?
        `,
        [id],
        (err2, detalles) => {
          if (err2)
            return res
              .status(500)
              .json({ error: "Error leyendo detalle pedido" });

          const normalizados = (detalles || []).map((detalle) => ({
            ...detalle,
            producto_imagenes: detalle.producto_imagenes
              ? detalle.producto_imagenes.split("|").filter(Boolean)
              : detalle.producto_imagen
                ? [detalle.producto_imagen]
                : [],
          }));
          res.json({ pedido, detalles: normalizados });
        }
      );
    }
  );
});

// ----------------------------------------
// EDITAR PEDIDO (EMPRESA)
// ----------------------------------------
app.put("/api/pedidos/:id", (req, res) => {
  const pedidoId = req.params.id;
  const {
    nombre_cliente,
    numero_cliente,
    direccion,
    tipo_pedido,
    horario,
    precio_mensajeria,
    detalles = [],
  } = req.body;

  if (!Array.isArray(detalles) || detalles.length === 0) {
    return res.status(400).json({ error: "El pedido debe tener productos" });
  }

  db.get("SELECT * FROM pedidos WHERE id = ?", [pedidoId], (pedidoErr, pedido) => {
    if (pedidoErr) return res.status(500).json({ error: "Error leyendo pedido" });
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    if (pedido.estado === "entregado") {
      return res.status(400).json({ error: "No se puede editar un pedido entregado" });
    }

    db.all(
      `
      SELECT d.*, i.cantidad AS stock_actual
      FROM pedido_detalle d
      JOIN inventario i ON i.id = d.id_producto
      WHERE d.id_pedido = ?
      `,
      [pedidoId],
      (detalleErr, actuales) => {
        if (detalleErr) return res.status(500).json({ error: "Error leyendo detalle pedido" });

        const actualesPorId = new Map((actuales || []).map((item) => [Number(item.id), item]));
        const editados = [];
        let totalProductos = 0;

        for (const item of detalles) {
          const detalleId = Number(item.detalle_id);
          const actual = actualesPorId.get(detalleId);
          const cantidad = Number(item.cantidad_pedida);
          const precioVendido = Number(item.precio_vendido);

          if (!actual) return res.status(400).json({ error: `Detalle invalido: ${detalleId}` });
          if (!Number.isFinite(cantidad) || cantidad <= 0) {
            return res.status(400).json({ error: "Cantidad pedida invalida" });
          }
          if (!Number.isFinite(precioVendido) || precioVendido <= 0) {
            return res.status(400).json({ error: "Precio de venta invalido" });
          }

          const diferencia = cantidad - Number(actual.cantidad_pedida || 0);
          if (diferencia > Number(actual.stock_actual || 0)) {
            return res.status(400).json({
              error: `Stock insuficiente para editar ${actual.id_producto}. Disponible: ${actual.stock_actual}`,
            });
          }

          totalProductos += cantidad * precioVendido;
          editados.push({
            actual,
            cantidad,
            precioVendido,
            diferencia,
            imagenSeleccionada: item.imagen_seleccionada || actual.imagen_seleccionada || null,
          });
        }

        const mensajeria = Number(precio_mensajeria || 0);
        const totalGeneral = totalProductos + mensajeria;

        db.serialize(() => {
          const stmtDetalle = db.prepare(
            `
            UPDATE pedido_detalle
            SET cantidad_pedida = ?,
                precio_vendido = ?,
                ganancia = ?,
                imagen_seleccionada = ?
            WHERE id = ?
            `
          );
          const stmtStock = db.prepare(
            `
            UPDATE inventario
            SET cantidad = cantidad - ?
            WHERE id = ?
            `
          );

          editados.forEach(({ actual, cantidad, precioVendido, diferencia, imagenSeleccionada }) => {
            stmtDetalle.run(
              cantidad,
              precioVendido,
              precioVendido - Number(actual.precio_base || 0),
              imagenSeleccionada,
              actual.id
            );
            if (diferencia !== 0) {
              stmtStock.run(diferencia, actual.id_producto);
            }
          });

          stmtDetalle.finalize();
          stmtStock.finalize();

          db.run(
            `
            UPDATE pedidos
            SET nombre_cliente = ?,
                numero_cliente = ?,
                direccion = ?,
                tipo_pedido = ?,
                horario = ?,
                precio_mensajeria = ?,
                total_productos = ?,
                total_general = ?
            WHERE id = ?
            `,
            [
              nombre_cliente,
              numero_cliente,
              direccion,
              tipo_pedido,
              horario,
              mensajeria,
              totalProductos,
              totalGeneral,
              pedidoId,
            ],
            (updateErr) => {
              if (updateErr) return res.status(500).json({ error: "Error actualizando pedido" });
              res.json({ mensaje: "Pedido actualizado", total_productos: totalProductos, total_general: totalGeneral });
            }
          );
        });
      }
    );
  });
});

// ----------------------------------------
// ASIGNAR REPARTIDOR (APROBAR)
// ----------------------------------------
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
        SELECT p.*,
               ug.expo_push_token AS token_gestor,
               ur.expo_push_token AS token_repartidor
        FROM pedidos p
        LEFT JOIN usuarios ug ON ug.id = p.id_gestor
        LEFT JOIN usuarios ur ON ur.id = p.id_repartidor
        WHERE p.id = ?
        `,
        [pedidoId],
        (e2, p) => {
          if (!e2 && p) {
            // Notificar gestor
            if (p.token_gestor) {
              enviarPush(
                p.token_gestor,
                "Pedido aprobado",
                `Tu pedido #${p.id} fue aprobado y asignado`,
                { tipo: "pedido_aprobado", id_pedido: p.id }
              );
            }

            // Notificar repartidor
            if (p.token_repartidor) {
              enviarPush(
                p.token_repartidor,
                "Nuevo pedido",
                `Tienes asignado el pedido #${p.id}`,
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

// ----------------------------------------
// RECHAZAR PEDIDO
// ----------------------------------------
function rechazarPedido(pedidoId, res) {
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

      // Notificar al gestor
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
              `Tu pedido #${p.id} fue rechazado`,
              { tipo: "pedido_rechazado", id_pedido: p.id }
            );
          }

          res.json({ mensaje: "Pedido rechazado" });
        }
      );
    }
  );
}

app.put("/api/pedidos/rechazar/:id", (req, res) => {
  rechazarPedido(req.params.id, res);
});

app.put("/api/pedidos/:id/rechazar", (req, res) => {
  rechazarPedido(req.params.id, res);
});

// ----------------------------------------
// BORRAR PEDIDOS RECHAZADOS
// ----------------------------------------
app.delete("/api/pedidos/rechazados", (req, res) => {
  db.run(
    "DELETE FROM pedido_detalle WHERE id_pedido IN (SELECT id FROM pedidos WHERE estado = 'rechazado')",
    [],
    (err) => {
      if (err) {
        return res.status(500).json({ error: "Error borrando detalle de rechazados" });
      }

      db.run("DELETE FROM pedidos WHERE estado = 'rechazado'", [], function (err2) {
        if (err2) {
          return res.status(500).json({ error: "Error borrando pedidos rechazados" });
        }

        res.json({ mensaje: "Pedidos rechazados eliminados", total: this.changes || 0 });
      });
    }
  );
});
// ----------------------------------------
// ENTREGAR PEDIDO
// ----------------------------------------
app.post("/api/pedidos/:id/entregar", (req, res) => {
  const pedidoId = req.params.id;
  const lista = req.body.productos_entregados || req.body.items || [];

  if (!Array.isArray(lista) || lista.length === 0) {
    return res.status(400).json({ error: "Lista vacia" });
  }

  db.get("SELECT * FROM pedidos WHERE id = ?", [pedidoId], (pedidoErr, pedido) => {
    if (pedidoErr) {
      return res.status(500).json({ error: "Error leyendo pedido" });
    }
    if (!pedido) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }
    if (pedido.estado === "entregado") {
      return res.status(400).json({ error: "El pedido ya fue entregado" });
    }
    if (pedido.estado === "rechazado") {
      return res.status(400).json({ error: "No se puede entregar un pedido rechazado" });
    }

    db.all(
      `
      SELECT id, id_producto, cantidad_pedida
      FROM pedido_detalle
      WHERE id_pedido = ?
      `,
      [pedidoId],
      (detalleErr, detalles) => {
        if (detalleErr) {
          return res.status(500).json({ error: "Error leyendo detalle pedido" });
        }

        const detallesPorId = new Map((detalles || []).map((d) => [Number(d.id), d]));
        const entregas = [];

        for (const item of lista) {
          const detalleId = Number(item.detalle_id);
          const detalle = detallesPorId.get(detalleId);
          const entregada = Number(item.cantidad_entregada || 0);

          if (!detalle) {
            return res.status(400).json({ error: `Detalle invalido: ${detalleId}` });
          }
          if (!Number.isFinite(entregada) || entregada < 0) {
            return res.status(400).json({ error: "Cantidad entregada invalida" });
          }
          if (entregada > Number(detalle.cantidad_pedida || 0)) {
            return res.status(400).json({ error: "La entrega no puede superar la cantidad pedida" });
          }

          entregas.push({ detalle, entregada });
        }

        db.serialize(() => {
          entregas.forEach(({ detalle, entregada }) => {
            const devolver = Number(detalle.cantidad_pedida || 0) - entregada;

            db.run(
              `
              UPDATE pedido_detalle
              SET cantidad_entregada = ?
              WHERE id = ?
              `,
              [entregada, detalle.id]
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

              // Notificar gestor
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
                      `Tu pedido #${p.id} fue entregado`,
                      { tipo: "pedido_entregado", id_pedido: p.id }
                    );
                  }

                  // Notificar empresa
                  db.all(
                    "SELECT expo_push_token FROM usuarios WHERE rol = 'empresa' AND expo_push_token IS NOT NULL",
                    [],
                    (e3, filasEmp) => {
                      if (!e3 && filasEmp && filasEmp.length > 0) {
                        filasEmp.forEach((emp) => {
                          enviarPush(
                            emp.expo_push_token,
                            "Pedido entregado",
                            `El pedido #${pedidoId} ya fue entregado`,
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
      }
    );
  });
});
// ----------------------------------------
// HISTORIAL LOCAL
// ----------------------------------------
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
      if (err)
        return res.status(500).json({ error: "Error historial local" });

      res.json(rows || []);
    }
  );
});

// ----------------------------------------
// HISTORIAL DOMICILIO
// ----------------------------------------
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
      if (err)
        return res.status(500).json({ error: "Error historial domicilio" });

      res.json(rows || []);
    }
  );
});

// ----------------------------------------
// HISTORIAL POR GESTOR
// ----------------------------------------
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
      if (err)
        return res.status(500).json({
          error: "Error historial gestor",
        });

      res.json(rows || []);
    }
  );
});

// ----------------------------------------
// HISTORIAL POR REPARTIDOR
// ----------------------------------------
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
      if (err)
        return res.status(500).json({ error: "Error historial repartidor" });

      res.json(rows || []);
    }
  );
});

// ----------------------------------------
// RESUMEN DEL DIA
// ----------------------------------------
app.get("/api/historial/resumen/:fecha", (req, res) => {
  const fecha = req.params.fecha;
  const resumen = {};

  // ----------------------------------------
  // RESUMEN POR GESTOR
  // ----------------------------------------
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
      if (err)
        return res.status(500).json({ error: "Error resumen gestores" });

      resumen.gestores = filasGestores || [];

      // ----------------------------------------
      // RESUMEN POR PRODUCTO
      // ----------------------------------------
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
          if (err2)
            return res.status(500).json({
              error: "Error resumen productos",
            });

          resumen.productos = filasProductos || [];

          res.json(resumen);
        }
      );
    }
  );
});

// ----------------------------------------
// RUTAS DE ANUNCIOS
// ----------------------------------------

// Obtener anuncio actual
app.get("/api/anuncio", (req, res) => {
  db.get(
    "SELECT mensaje FROM anuncios ORDER BY id DESC LIMIT 1",
    [],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: "Error cargando anuncio" });
      }
      res.json({ mensaje: row ? row.mensaje : "" });
    }
  );
});

// Guardar anuncio nuevo
app.post("/api/anuncio", (req, res) => {
  const { mensaje } = req.body;

  if (!mensaje || mensaje.trim() === "") {
    return res.status(400).json({ error: "Mensaje vacío" });
  }

  db.run(
    `
    INSERT INTO anuncios (mensaje, fecha_creacion)
    VALUES (?, ?)
    `,
    [mensaje, ahora()],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "No se pudo guardar el anuncio" });
      }

      res.json({ mensaje: "Anuncio guardado correctamente" });
    }
  );
});

// ----------------------------------------
// INICIAR SERVIDOR
// ----------------------------------------
app.listen(PORT, () => {
  console.log("Servidor API listo en puerto:", PORT);
});
