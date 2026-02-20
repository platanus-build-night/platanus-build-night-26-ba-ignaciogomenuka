# Sistema de Monitoreo de Vuelos Privados

## Estado Actual ✅
Sistema funcionando correctamente con 2 componentes:

1. **monitor_vuelos.py** - Monitoreo continuo cada 5 minutos
2. **app.py** - Dashboard web en http://localhost:5000

## Aviones Monitoreados
- LV-FVZ (e0659a)
- LV-CCO (e030cf)
- LV-FUF (e06546)
- LV-KMA (e0b341)
- LV-KAX (e0b058)

## Comandos Útiles

### Iniciar el monitoreo
```bash
./start_monitor.sh
```

### Ver el log del monitor
```bash
tail -f monitor.log
```

### Verificar servicios activos
```bash
ps aux | grep "python.*app.py\|python.*monitor" | grep -v grep
```

### Detener el monitoreo
```bash
pkill -f monitor_vuelos
```

### Detener el dashboard
```bash
pkill -f "python.*app.py"
```

### Reiniciar todo
```bash
pkill -f monitor_vuelos
pkill -f "python.*app.py"
./start_monitor.sh
source venv/bin/activate && nohup python3 app.py > app.log 2>&1 &
```

## Endpoints del Dashboard

- **/** - Interfaz web principal
- **/status** - Estado del sistema (JSON)
- **/api/check** - Verificar vuelos manualmente
- **/api/history** - Ver historial de vuelos
- **/test-telegram** - Probar notificaciones de Telegram

## Archivos de Estado

- **plane_state.json** - Estado persistente (aviones notificados + en vuelo)
  ```json
  {
    "notified_planes": ["LV-FUF"],
    "active_planes": ["LV-FUF"]
  }
  ```
- **flight_history.json** - Historial de despegues/aterrizajes (últimos 100)
- **monitor.log** - Log del monitoreo continuo (timestamps en hora Argentina UTC-3)
- **app.log** - Log del dashboard web

## Notificaciones de Telegram

Configuradas en `.env`:
- Token: configurado ✓
- Chat ID: configurado ✓

Las notificaciones incluyen:
- ✈️ Despegue detectado
- 🔄 Vuelo en curso (si se reinicia el sistema)
- 🛬 Aterrizaje detectado
- 📊 Altitud, velocidad, rumbo
- 📍 Aeropuerto más cercano
- 🎯 Destino estimado
- ⏱️ ETA aproximado
- 🔗 Link a FlightRadar24

## Solución del Problema Original

**Problema**: El sistema no estaba corriendo, por lo tanto no detectaba vuelos.

**Causa**: Thread daemon en Flask causaba que requests HTTP se colgaran.

**Solución**:
- Separé el monitoreo en un proceso independiente (monitor_vuelos.py)
- Eliminé el thread daemon de app.py
- Creé script de inicio robusto (start_monitor.sh)

## Verificación de Funcionamiento

1. Ver log en tiempo real:
   ```bash
   tail -f monitor.log
   ```

2. Verificar web dashboard:
   ```bash
   curl http://localhost:5000/status
   ```

3. Probar notificación de Telegram:
   ```bash
   curl http://localhost:5000/test-telegram
   ```

## Fixes Recientes (23 Oct 2025)

Ver `BUGFIXES.md` para detalles técnicos:
- ✅ Corregido: Notificaciones falsas de aterrizaje
- ✅ Persistencia completa del estado (sobrevive reinicios)
- ✅ Timestamps en hora Argentina (UTC-3)
- ✅ Estado se guarda después de cada cambio

## Próximos Pasos Recomendados

1. **Automatizar inicio**: Crear servicio systemd para que inicie automáticamente
2. **Railway deployment**: Subir cambios a Railway para monitoreo cloud
3. **Agregar más aviones**: Editar PLANES en monitor_vuelos.py y app.py

## Troubleshooting

**Si recibes notificaciones duplicadas o falsas**:
```bash
# Limpiar estado y reiniciar
pkill -f monitor_vuelos
rm -f plane_state.json
./start_monitor.sh
```

**Ver qué aviones están marcados como activos**:
```bash
cat plane_state.json | python3 -m json.tool
```
