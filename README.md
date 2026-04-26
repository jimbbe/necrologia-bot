# WhatsApp Necrologia AI

Bot de WhatsApp para agencias funerarias. El operador envía los datos del difunto por WhatsApp; el bot recopila la información, genera una vista previa y, cuando corresponde, publica el necrologio en amcannunci.it.

El panel admin no usa React/Vue/Next/Vite: es HTML/CSS/JavaScript estático servido por Express. En producción queda detrás de Caddy como reverse proxy HTTPS.

## Funcionalidades

- 4 tipologías: **participación**, **anuncio familiar**, **aniversario**, **agradecimiento/trigésimo**
- Recopilación progresiva de datos por chat en italiano (IA Grok/xAI)
- Vista previa en texto y captura del formulario completo antes de publicar
- Carga de foto y selección de símbolo (cruz cristiana / estrella de David)
- Eliminación del necrologio dentro de las 24 horas (`#elimina`)
- Transcripción de mensajes de voz (Groq/Whisper)
- Panel web de administración con QR, lista de permitidos, sesiones y eventos en tiempo real

## Tags disponibles

| Tag | Función |
|-----|---------|
| `#necro <texto>` | Inicia una nueva sesión |
| `#conferma` | Publica el necrologio después de revisar la vista previa |
| `#rifiuta` | Descarta la sesión y permite empezar de nuevo |
| `#cancella` | Cancela la sesión actual |
| `#elimina` | Elimina el último necrologio publicado dentro de las 24 horas |

## Requisitos

- Docker y Docker Compose
- Clave API de xAI ([console.x.ai](https://console.x.ai))
- Credenciales de amcannunci.it si `PREVIEW_ONLY=false`
- Clave API de Groq ([console.groq.com](https://console.groq.com)) — opcional, solo para transcripción de audio

## Despliegue rápido

### 1. Configurar variables de entorno

En Hostinger Docker Manager, cargá estas variables en el panel de entorno del servicio. No hace falta crear un archivo `.env` si el gestor ya inyecta las variables.

Variables mínimas:

- `FRONTEND_DOMAIN` (ej: `tudominio.com`)
- `FRONTEND_URL` (ej: `https://tudominio.com`)
- `BACKEND_URL` (ej: `https://tudominio.com`)
- `XAI_API_KEY`
- `ADMIN_PASSWORD`
- `AMC_USERNAME`
- `AMC_PASSWORD`

Para producción real, configurar:

```env
PREVIEW_ONLY=false
DRY_RUN=false
```

### 2. Levantar el contenedor

Antes de levantarlo, apuntá el registro DNS `A` de `FRONTEND_DOMAIN` a la IP de la VPS y abrí solo los puertos `80/tcp` y `443/tcp`.

```bash
docker compose up -d
```

### 3. Escanear el QR

El panel queda detrás de Caddy y se accede por HTTPS:

```text
https://tudominio.com
```

Ingresá con `ADMIN_PASSWORD` y escaneá el QR con WhatsApp desde:

**Ajustes → Dispositivos vinculados → Vincular un dispositivo**

La sesión se guarda en `data/auth/` y persiste entre reinicios.

## Operaciones cotidianas

```bash
# Estado del contenedor
docker compose ps

# Logs en tiempo real
docker compose logs -f

# Reiniciar después de cambios de configuración
docker compose restart

# Actualizar el código
docker compose down
# publicar una nueva imagen y luego
docker compose pull
docker compose up -d
```

## Cambiar el número de WhatsApp

1. Entrar al panel admin → botón **Nuevo QR**
2. Escanear el QR con el nuevo número

## Panel admin

Disponible solo si `ADMIN_PASSWORD` está configurado.

Funciones:

- Estado de conexión de WhatsApp en tiempo real
- Visualización y escaneo de QR
- Reconexión / generación de nuevo QR
- Lista de números autorizados (alta/baja)
- Sesiones activas con posibilidad de cancelación
- Log de eventos en tiempo real

## Configuración de entorno

| Variable | Obligatoria | Valor por defecto real del código | Descripción |
|----------|-------------|-------------------------|-------------|
| `XAI_API_KEY` | Sí | — | Clave API de xAI (Grok) |
| `GROQ_API_KEY` | No | — | Clave API de Groq para transcripción de audio |
| `AI_MODEL` | No | `grok-4-1-fast` | Modelo de Grok |
| `MAX_HISTORY` | No | `30` | Cantidad máxima de mensajes por historial de chat |
| `AMC_USERNAME` | Si `PREVIEW_ONLY=false` | — | Usuario de amcannunci.it |
| `AMC_PASSWORD` | Si `PREVIEW_ONLY=false` | — | Contraseña de amcannunci.it |
| `AMC_BASE_URL` | No | `https://www.amcannunci.it` | URL base del sitio |
| `FRONTEND_DOMAIN` | Sí | — | Dominio público para Caddy, sin protocolo |
| `FRONTEND_URL` | Sí | — | URL pública del panel, con `https://` |
| `BACKEND_URL` | Sí | — | URL pública del backend; en este proyecto normalmente igual a `FRONTEND_URL` |
| `PREVIEW_ONLY` | No | `true` | Solo genera vistas previas; no interactúa con amcannunci.it |
| `DRY_RUN` | No | `true` | Completa el formulario pero no lo envía |
| `SESSION_TIMEOUT_MS` | No | `1800000` | Timeout por inactividad (30 min) |
| `ADMIN_PASSWORD` | Sí para deploy | — | Contraseña del panel admin; sin ella no hay panel ni healthcheck |
| `ADMIN_HOST` | No | `0.0.0.0` | Host interno donde escucha Express dentro del contenedor |
| `ADMIN_PORT` | No | `3000` | Puerto del panel admin |

> Importante: por seguridad, el código queda en modo prueba si no configurás explícitamente `PREVIEW_ONLY=false` y `DRY_RUN=false`.

## Solución de problemas

**El QR no aparece:** en el panel admin, hacer clic en **Nuevo QR**.

**`XAI_API_KEY is required`:** verificar que la variable esté cargada en Hostinger Docker Manager.

**El contenedor queda `unhealthy`:** el endpoint real de salud es `/api/health`. Si el healthcheck apunta a `/health` o falta `ADMIN_PASSWORD`, corregirlo antes de subir.

**Sesión invalidada por WhatsApp:** el panel mostrará un nuevo QR. Si no aparece, usar **Nuevo QR**.

**Puppeteer no puede abrir el navegador:** verificar memoria disponible. Para producción, conviene usar una VPS con 2 GB de RAM.

**La lista de permitidos está vacía:** el bot queda bloqueado hasta que agregues al menos un número autorizado.
