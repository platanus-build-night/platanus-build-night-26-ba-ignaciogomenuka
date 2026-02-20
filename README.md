# Monitor de Vuelos Privados

Sistema de monitoreo en tiempo real de aeronaves privadas que envía notificaciones automáticas a Telegram cuando los aviones despegan, aterrizan o están en vuelo.

## Características

- 🛫 Notificaciones automáticas de despegue
- 🛬 Notificaciones automáticas de aterrizaje
- 📊 Información detallada de vuelo (altitud, velocidad, rumbo)
- 🧭 Estimación de destino basado en rumbo
- 📍 Aeropuerto más cercano con ETA aproximado
- 🔄 Persistencia de estado entre reinicios
- 📜 Historial de vuelos
- 🚨 Detección de códigos de emergencia (7700, 7600, 7500)

## Requisitos

- Python 3.7 o superior
- Una cuenta de Telegram
- Un bot de Telegram
- Códigos ICAO24 y matrículas de las aeronaves a monitorear

## Instalación

1. Clonar el repositorio:
```bash
git clone https://github.com/tu-usuario/trackvuelosprivados.git
cd trackvuelosprivados
```

2. Instalar dependencias:
```bash
pip install -r requirements.txt
```

3. Crear archivo de configuración:
```bash
cp .env.example .env
```

4. Configurar variables de entorno en `.env`:
```bash
TELEGRAM_TOKEN=tu_token_del_bot
TELEGRAM_CHAT_ID=tu_chat_id
```

### Obtener Token de Telegram

1. Habla con [@BotFather](https://t.me/botfather) en Telegram
2. Envía `/newbot` y sigue las instrucciones
3. Copia el token que te proporciona
4. Pégalo en `.env` como `TELEGRAM_TOKEN`

### Obtener Chat ID

1. Habla con [@userinfobot](https://t.me/userinfobot) en Telegram
2. Te enviará tu ID de chat
3. Pégalo en `.env` como `TELEGRAM_CHAT_ID`

Para grupos:
1. Agrega tu bot al grupo
2. Envía un mensaje en el grupo
3. Visita: `https://api.telegram.org/bot<TU_TOKEN>/getUpdates`
4. Busca el campo `"chat":{"id":`
5. Usa ese ID (será negativo para grupos)

## Configuración de Aeronaves

Edita el archivo `monitor_vuelos.py` en la **línea 13-19**, modificando el diccionario `PLANES`:

```python
PLANES = {
    "e0659a": "LV-FVZ",  # ICAO24: Matrícula
    "e030cf": "LV-CCO",
    "e06546": "LV-FUF",
    # Agrega más aeronaves aquí
}
```

### Cómo encontrar códigos ICAO24

1. **FlightRadar24**: Busca la matrícula y mira la URL: `flightradar24.com/<MATRICULA>`
2. **OpenSky Network**: [https://opensky-network.org/](https://opensky-network.org/)
3. **ADS-B Exchange**: [https://www.adsbexchange.com/](https://www.adsbexchange.com/)

El código ICAO24 es un identificador hexadecimal único de 6 caracteres.

Ejemplo de Argentina:
- Rango: `e00000` a `e3ffff`
- Formato: `e0659a` (siempre en minúsculas en el código)

## Uso

### Ejecución local

```bash
python monitor_vuelos.py
```

El script verificará vuelos cada 5 minutos (300 segundos).

### Detener el monitor

Presiona `Ctrl+C` para detener el monitoreo.

## Despliegue en Railway

1. Crea cuenta en [Railway.app](https://railway.app)
2. Conecta tu repositorio de GitHub
3. Agrega las variables de entorno:
   - `TELEGRAM_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `ENABLE_MONITOR=true`
4. Railway detectará automáticamente `Procfile` y ejecutará el monitor

## Archivos Generados

- `plane_state.json`: Estado actual de los aviones monitoreados
- `flight_history.json`: Historial de los últimos 100 eventos
- `monitor.log`: Logs de ejecución (en Railway)

## Aeropuertos Argentinos Soportados

- SAEZ: Ezeiza
- SABE: Aeroparque
- SACO: Córdoba
- SAZS: San Carlos de Bariloche
- SAZM: Mendoza
- SASA: Salta
- SARF: Rosario
- SAAV: Ushuaia

Para agregar más aeropuertos, edita el diccionario `ARGENTINA_AIRPORTS` en `monitor_vuelos.py` (línea 26-35).

## Estructura del Proyecto

```
trackvuelosprivados/
├── monitor_vuelos.py       # Script principal
├── requirements.txt        # Dependencias Python
├── Procfile               # Configuración Railway
├── .env                   # Variables de entorno (no incluido)
├── .env.example          # Plantilla de variables
├── README.md             # Este archivo
├── plane_state.json      # Estado persistente
└── flight_history.json   # Historial de vuelos
```

## Ejemplo de Notificación

```
✈️ LV-FVZ despegó
ICAO24: e0659a

📊 Altitud: 3500 m
🚀 Velocidad: 450.0 km/h
🧭 Rumbo: 180° (S)
⬆️ Subiendo +800 ft/min

📍 Aeropuerto más cercano: Ezeiza (SAEZ)
📏 Distancia: 25.5 km
⏱️ ETA aproximado: 3 min

🎯 Dirección estimada: Hacia Mendoza (650.0 km)

🔗 Ver en vivo: https://www.flightradar24.com/LV-FVZ

📡 Fuente: OpenSky
🕐 2025-10-31 14:30:00 -03
```

## Códigos de Emergencia

El sistema detecta automáticamente códigos de emergencia:
- 🆘 7700: Emergencia general
- 📻 7600: Falla de radio
- 🚨 7500: Secuestro

## Contribuir

1. Fork el proyecto
2. Crea tu rama: `git checkout -b feature/nueva-funcionalidad`
3. Commit tus cambios: `git commit -m 'Agregar nueva funcionalidad'`
4. Push a la rama: `git push origin feature/nueva-funcionalidad`
5. Abre un Pull Request

## Licencia

Este proyecto es de código abierto y está disponible bajo la Licencia MIT.

## Nota Importante

Este proyecto utiliza la API pública de OpenSky Network. Respeta sus términos de uso y limitaciones de tasa de solicitudes.

## Soporte

Si tienes problemas o preguntas, abre un issue en GitHub.
