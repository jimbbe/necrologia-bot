# Despliegue — necrologia-bot

Bot de WhatsApp para agencia funeraria. Publica necrologios en amcannunci.it mediante Puppeteer.

## Recomendación de servidor

La opción más simple y estable para esta app es una **VPS con Docker Compose**.

Recomendado:

- Ubuntu 22.04 o 24.04 LTS
- Docker >= 24
- Docker Compose v2 (`docker compose`, sin guión)
- 1 vCPU mínimo
- 2 GB de RAM recomendado (1 GB puede quedar justo por Chromium/Puppeteer)
- 10 GB de disco o más

No es buena candidata para serverless: necesita proceso persistente, sesión local de WhatsApp, filesystem estable y Chromium.

## Hostinger VPS Docker Manager

Para Hostinger Docker Manager, usá una imagen pública en lugar de `build: .`.

En el `docker-compose.yml` final, la línea clave debe ser algo como:

```yaml
image: jimbe01/necrologia-bot:3.0.0
```

El bloque `environment:` usa placeholders como `${XAI_API_KEY}` para que Hostinger tome los valores del panel de entorno del servicio.

## Checklist antes de producción

- Configurar `XAI_API_KEY`.
- Configurar `ADMIN_PASSWORD`; si falta, no levanta el panel web.
- Para publicación real, usar `PREVIEW_ONLY=false` y `DRY_RUN=false`.
- Si `PREVIEW_ONLY=false`, completar `AMC_USERNAME` y `AMC_PASSWORD`.
- Agregar números autorizados a la lista de permitidos. Si está vacía, el bot queda bloqueado.
- Verificar el healthcheck: el endpoint real de la app es `/api/health`.

> Nota importante: si `docker-compose.yml` apunta el healthcheck a `/health`, el contenedor puede quedar `unhealthy` aunque la app esté corriendo. Cambiarlo a `/api/health` antes del deploy productivo.

## Pasos de despliegue

### 1. Crear directorio y descomprimir

```bash
mkdir -p /opt/necrologia-bot
cd /opt/necrologia-bot
unzip necrologia-bot.zip
```

### 2. Cargar variables de entorno

En Hostinger Docker Manager, pegá estas variables en el panel de entorno del servicio. No hace falta crear `.env` si el gestor las inyecta directamente.

Variables mínimas:

| Variable | Descripción |
|----------|-------------|
| `XAI_API_KEY` | Clave API de xAI (Grok) |
| `ADMIN_PASSWORD` | Contraseña para el panel web; necesaria para escanear QR |
| `AMC_USERNAME` | Usuario de amcannunci.it, obligatorio si `PREVIEW_ONLY=false` |
| `AMC_PASSWORD` | Contraseña de amcannunci.it, obligatorio si `PREVIEW_ONLY=false` |
| `GROQ_API_KEY` | Opcional, necesario para transcribir audios |

Para producción real:

```env
PREVIEW_ONLY=false
DRY_RUN=false
```

### 3. Levantar el contenedor

```bash
docker compose pull
docker compose up -d
```

La primera descarga puede tardar unos minutos si la imagen todavía no está en el host.

### 4. Verificar que levantó correctamente

```bash
# Estado del contenedor
docker compose ps

# Health check real de la app
curl http://localhost:3000/api/health

# Logs en tiempo real
docker compose logs -f
```

La respuesta esperada del endpoint de salud incluye `"status":"ok"`.

### 5. Escanear el QR de WhatsApp

El `docker-compose.yml` actual publica el puerto así:

```yaml
ports:
  - "3000:3000"
```

Eso deja el panel accesible desde fuera del VPS. Asegurate de abrir el puerto 3000 en el firewall de Hostinger o en `ufw`.

Podés entrar directo desde el navegador a:

```text
http://IP_DE_LA_VPS:3000
```

Si preferís un acceso más cerrado, usar túnel SSH:

```bash
ssh -L 3000:localhost:3000 usuario@IP_DE_LA_VPS
```

Luego abrir:

```text
http://localhost:3000
```

Ingresar la `ADMIN_PASSWORD`, ir a la sección QR y escanearlo con WhatsApp.

### 6. Agregar números a la lista de permitidos

Desde el panel web → sección **Números autorizados** → agregar los números que pueden usar el bot.

Si la lista de permitidos está vacía, el bot queda bloqueado hasta que agregues al menos un número.

## Acceso público al panel admin

Como el puerto 3000 queda público, asegurá firewall y contraseña fuerte. Si más adelante querés endurecerlo, poné un reverse proxy con HTTPS delante del puerto 3000.

## Comandos de operación

```bash
# Ver logs
docker compose logs -f

# Reiniciar
docker compose restart

# Detener
docker compose down

# Actualizar desde un nuevo ZIP
docker compose down
docker compose pull
docker compose up -d
```

## Persistencia

El directorio `./data` se monta como volumen. Contiene:

- `data/auth/` — credenciales de sesión de WhatsApp. No borrarlo salvo que quieras reescanear QR.
- `data/allowed-numbers.json` — lista de números autorizados.

Ante un `docker compose down && docker compose up -d`, la sesión de WhatsApp se mantiene.

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| Contenedor en estado `unhealthy` | Healthcheck apuntando a `/health` o `ADMIN_PASSWORD` ausente | Usar `/api/health`, configurar `ADMIN_PASSWORD` y revisar `docker compose logs` |
| `XAI_API_KEY is required` en logs | `.env` sin la key | Editar `.env` y reiniciar |
| `Bad MAC` en logs de WhatsApp | Sesión Signal desincronizada | `rm -rf data/auth/`, reiniciar y reescanear QR |
| Bot no responde a mensajes | Número bloqueado por la lista de permitidos o sesión caída | Revisar panel admin y lista de permitidos |
| Bot bloqueado al arrancar | Lista de permitidos vacía | Agregar al menos un número autorizado |
| Puppeteer falla al abrir Chromium | Falta memoria o dependencia del sistema | Usar la imagen Docker del repo y una VPS de 2 GB RAM |
| No aparece el panel admin | Falta `ADMIN_PASSWORD` o puerto no expuesto públicamente | Configurar `ADMIN_PASSWORD`; acceder por túnel SSH |
