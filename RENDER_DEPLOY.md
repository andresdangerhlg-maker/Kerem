# Kerem Server en Render

## Carpeta a subir

Sube esta carpeta completa:

`kerem-server`

No subas `node_modules`, `data`, `uploads`, `.npm-cache` ni `public/images`; esos quedan fuera por `.gitignore`.

## Configuracion en Render

- Tipo: `Web Service`
- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/healthz`

Variables de entorno:

```text
NODE_ENV=production
DATA_DIR=/var/data
```

Disco persistente:

```text
Name: kerem-data
Mount path: /var/data
Size: 1 GB
```

## Importante

Render borra los archivos escritos fuera del disco persistente cuando reinicia o redeploya. Por eso el servidor guarda en `/var/data`:

- `database.sqlite`
- fotos del inventario
- archivos temporales de importacion

Cuando Render termine el deploy, prueba:

```text
https://TU-SERVICIO.onrender.com/healthz
```

Debe responder:

```json
{ "ok": true }
```

Luego usa esa URL en la app como `serverUrl`.
