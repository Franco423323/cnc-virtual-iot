# CNC Virtual — Fase 6 preparada para Render

Simulador educativo de plotter CNC XY. Cada pestaña anfitriona ejecuta su propio motor G-Code, dibujo y animación. El servidor Node.js transmite sus coordenadas y órdenes por WebSocket a los controladores emparejados **con esa sesión**. No hay una segunda CNC en el celular. El Arduino y el circuito Wokwi siguen como contexto académico; no son necesarios para esta aplicación.

## Requisitos y ejecución local

- Node.js 24 LTS y npm.
- En la carpeta del proyecto: `npm ci` y `npm start`.
- Abre `http://localhost:3000/` en la laptop anfitriona. La consola también muestra la dirección IP de la red local.
- En otro dispositivo, abre **el enlace exacto** mostrado en el panel «Control remoto real» de la laptop. Incluye `?session=...`. Introduce el código de seis dígitos visible solo en la pestaña anfitriona. El código dura 30 minutos; «Renovar» genera otro.
- Deja abierta la pestaña anfitriona: allí se ejecuta el trabajo cargado. El control remoto puede iniciar, pausar, reanudar, detener, mover X/Y, subir/bajar lapicero y regresar al origen. La selección o importación de una figura se hace en el anfitrión.

El servidor usa `process.env.PORT` (3000 por defecto) y escucha en `0.0.0.0` por defecto. En PowerShell puedes cambiarlo con `$env:PORT="3100"` y luego `npm start`. Para restringirlo a la misma laptop usa `$env:HOST="127.0.0.1"`. `MAX_SESSIONS` limita las sesiones residentes (100 por defecto; máximo 1000). `.env.example` documenta las variables; la aplicación no carga archivos `.env` automáticamente.

Para usar Wi-Fi local en Windows, ejecuta `ipconfig`, identifica la IPv4 del adaptador Wi-Fi y permite el puerto TCP configurado en el firewall para la red **privada**. Celular y laptop deben estar en una red que permita comunicación entre clientes; las redes de invitados o campus pueden aislarlos. Si la página abre pero la máquina aparece desconectada, comprueba que la pestaña anfitriona siga abierta y conectada al servidor.

## Modo sin servidor

`index.html` puede abrirse directamente (`file://`) o con Live Server para dibujar, importar G-Code, usar controles manuales y el panel **IoT simulado** de la Fase 5. El panel de WebSocket indica «MODO LOCAL». Live Server no provee el control remoto de esta aplicación. Los scripts de simulación no requieren Internet ni dependencias externas.

## Publicar con GitHub y Render (pasos manuales)

1. Crea un repositorio privado o público **vacío** en GitHub. Esta carpeta todavía no es un repositorio Git. Desde PowerShell en esta carpeta, ejecuta lo siguiente tras sustituir `TU_USUARIO/TU_REPO`:

   ```powershell
   git init
   git add .
   git status
   git commit -m "Preparar CNC Virtual para Render"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```

   Revisa la salida de `git status` **antes** del commit. No subas `node_modules`, `.env`, tokens ni datos personales; `.gitignore` excluye los dos primeros. Este proyecto no contiene una credencial fija para Render. El `package-lock.json` debe incluirse.
2. En Render, conecta tu cuenta de GitHub y concede acceso a ese repositorio. Crea un **Blueprint** desde el repositorio: Render leerá `render.yaml`. Revisa que el servicio web sea `Free`, runtime `Node`, build `npm ci`, start `npm start`, health check `/health`, y despliegue automático desactivado. Otra opción es crear manualmente un Web Service con los mismos valores.
3. Render asigna una URL `https://...onrender.com`. Ábrela en una pestaña anfitriona y espera que el panel muestre conexión. Comparte únicamente el enlace `/remote?session=...` de esa pestaña y comunica el código temporal por otro medio. En HTTPS los navegadores usan `wss://` automáticamente; en HTTP local usan `ws://`.
4. Para probar, abre una segunda CNC desde otra pestaña o navegador y verifica que aparezca **otro** enlace y código. Los controles de un enlace deben afectar solo a su anfitrión. Usa el botón de despliegue manual de Render cuando quieras publicar cambios posteriores.

Render establece `PORT` en el entorno del servicio; no es necesario fijarlo en el Blueprint. `render.yaml` usa un solo servicio gratuito sin base de datos. **No se ha desplegado este proyecto automáticamente.** Consulta la documentación actual de [Web Services](https://render.com/docs/web-services), [WebSockets](https://render.com/docs/websocket), [Blueprints](https://render.com/docs/blueprint-spec) y [límites gratuitos](https://render.com/docs/free) antes de publicarlo.

## Arquitectura y seguridad

`POST /api/sessions` crea un ID aleatorio, un token de anfitrión y un código temporal **por sesión**. El token se conserva en `sessionStorage` de la pestaña anfitriona y se usa para reconectar y renovar el código. No se pone en la URL ni en el JavaScript público. Al recargar la pestaña se recupera la sesión; una pestaña nueva crea otra. El enlace remoto contiene solo el ID de sesión. El servidor exige el código de esa sesión antes de aceptar órdenes. La telemetría y las órdenes se envían únicamente a los sockets de esa sesión. Solo un anfitrión puede ocupar cada sesión a la vez.

El servidor valida estructura y tamaño JSON (4 KB), acciones, parámetros y límites X 0–200 / Y 0–150 mm. Aplica límites de frecuencia a creación de sesiones, intentos de emparejamiento y órdenes, y confirma cada acción tras la respuesta del anfitrión. El motor CNC vuelve a validar movimientos. No hay ejecución de código recibido ni lectura arbitraria de rutas. Las rutas de archivos públicos están en una lista cerrada. La comprobación de Origin de WebSocket acepta el mismo host de la página.

Las sesiones, tokens y estados están **solo en memoria**. Un reinicio o una suspensión del servicio gratuito elimina las sesiones; el anfitrión genera una nueva al reconectar y debe compartir un enlace nuevo. El panel remoto necesita un anfitrión abierto. La cuenta gratuita puede suspenderse por inactividad y tener un arranque lento. Este MVP está pensado para demostración educativa, con **una instancia de Render**. No tiene cuentas de usuario, persistencia, auditoría duradera ni coordinación entre instancias; no se presenta como sistema de producción o control de maquinaria. El acceso público debe usarse por HTTPS/WSS de Render; no expongas el puerto local HTTP/WS directamente a Internet.

## Funciones conservadas

El parser y el motor único de la Fase 5 admiten `G0`, `G1`, `G20/G21`, `G90/G91`, `G92`, `M3/M5`; no admiten arcos G2/G3 ni parámetros F/S. Incluye cuadrado, triángulo, círculo segmentado, estrella, casa, letras CNC y nombre vectorial. Los movimientos rápidos no dibujan. El trazado, el cabezal y la telemetría proceden del mismo estado. El panel IoT **simulado** se mantiene separado del panel WebSocket real.

## Pruebas

Ejecuta `npm test`. La suite cubre parser y figuras, límites, pausa/reanudación, controles locales y remotos, importación de G-Code, modo `file://`, servidor HTTP, emparejamiento, autorización, telemetría, reconexión, selección de WS/WSS y aislamiento de dos sesiones simultáneas. Las pruebas WebSocket usan `127.0.0.1`; no sustituyen una comprobación visual en dispositivos reales ni una prueba del despliegue de Render. `npm ci` verifica que el lockfile puede instalar las dependencias.

**Resultado ejecutado el 30-10-2026:** `npm ci` completó sin vulnerabilidades informadas; `npm test` pasó **16/16**; `node --check` pasó para servidor y clientes de red; `npm start` respondió `200 {"status":"ok"}` en `/health`. La negociación TLS/WSS de Render, el acceso desde Internet y el comportamiento visual en navegadores reales quedan pendientes de comprobación cuando se despliegue manualmente.

## Archivos

- `server/server.cjs`: HTTP, sesiones y WebSocket.
- `js/network-client.js`: anfitrión, recuperación de sesión y telemetría.
- `remote.html`, `js/remote.js`, `css/remote.css`: controlador remoto responsive.
- `js/gcode-parser.js`, `js/cnc-engine.js`, `js/cnc-renderer.js`: CNC local.
- `js/app.js`, `js/examples.js`, `js/iot-simulator.js`: interfaz, ejemplos e IoT simulado.
- `render.yaml`, `package.json`, `.env.example`: despliegue y configuración.
- `wokwi/`: materiales electrónicos previos, sin dependencia de ejecución.
