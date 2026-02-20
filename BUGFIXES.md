# Bug Fixes - 23 Oct 2025

## 🐛 Problema: Notificación Falsa de Aterrizaje

### Reporte del Usuario
- Recibió notificación de "LV-FUF aterrizó" a las 10:19 AM Argentina (23 oct)
- FlightRadar24 no mostraba movimiento desde el 22 de octubre
- El vuelo real fue el 22 de octubre a las 19:37 Argentina

### Causa Raíz
1. **Estado no persistente**: `active_planes` (aviones en vuelo) NO se guardaba en disco
2. **Pérdida de memoria**: Al reiniciar el sistema, olvidaba qué aviones estaban volando
3. **Detección falsa**: Cuando OpenSky dejó de retornar el avión, el sistema asumió "aterrizaje"

### Flujo del Bug
```
22 Oct 19:37 ARG → LV-FUF despega (detectado ✓)
                   active_planes = {LV-FUF}  (solo en memoria)

Sistema reinicia → active_planes = {}  (perdido ✗)
                   notified_planes = {LV-FUF}  (persistido ✓)

23 Oct 10:19 ARG → OpenSky no retorna LV-FUF
                   Sistema: "estaba en active_planes? No"
                   Sistema: "entonces aterrizó" ✗
                   Envía notificación falsa
```

## ✅ Soluciones Implementadas

### 1. Persistencia Completa del Estado

**Antes** (`plane_state.json`):
```json
["LV-FUF"]
```

**Después** (`plane_state.json`):
```json
{
  "notified_planes": ["LV-FUF"],
  "active_planes": ["LV-FUF"]
}
```

**Archivos modificados**:
- `monitor_vuelos.py:35-55` - load_state() y save_state()
- `app.py:40-60` - Mismos cambios

### 2. Timezone Argentina

**Problema**: Timestamps confusos (sistema en CEST, logs sin timezone)

**Solución**: Todos los timestamps ahora usan UTC-3 (Argentina)

**Antes**:
```
2025-10-23 15:19:29  # ¿Qué timezone?
```

**Después**:
```
2025-10-23 11:07:27 UTC-03:00  # Claramente Argentina
```

**Archivos modificados**:
- `monitor_vuelos.py:1-11` - Import timezone, definir ARGENTINA_TZ
- `monitor_vuelos.py:68-73` - save_flight_event() con timezone
- `monitor_vuelos.py:212-296` - check_flights() con timestamps ARG
- `app.py:1-12` - Mismos cambios de timezone

### 3. Guardado de Estado en Cada Cambio

**Nuevo comportamiento**:
- Se llama `save_state()` después de cada actualización de `active_planes`
- Garantiza que reiniciar no pierde información

**Código agregado**:
```python
active_planes = currently_flying
save_state()  # <- NUEVO
```

## 📊 Verificación

### Antes del Fix
```bash
$ cat plane_state.json
[]

$ # Sistema reinicia, pierde todo
```

### Después del Fix
```bash
$ cat plane_state.json
{
  "notified_planes": [],
  "active_planes": []
}

$ tail -f monitor.log
2025-10-23 11:07:27 UTC-03:00 - Verificando vuelos...
2025-10-23 11:07:27 UTC-03:00 - Verificación completada. Aviones en vuelo: 0
```

## 🔬 Testing

1. **Test de persistencia**:
   ```bash
   # Simular vuelo activo
   echo '{"notified_planes": ["LV-FUF"], "active_planes": ["LV-FUF"]}' > plane_state.json

   # Reiniciar monitor
   pkill -f monitor_vuelos && ./start_monitor.sh

   # Verificar que NO envíe notificación de aterrizaje
   tail -f monitor.log
   ```

2. **Test de timezone**:
   ```bash
   # Ver timestamp en log
   tail monitor.log | grep "UTC-03:00"

   # Verificar historial
   cat flight_history.json | grep timestamp
   ```

## 📝 Notas Adicionales

- Historial anterior mantiene timestamps viejos (sin timezone)
- Nuevos eventos tendrán formato ISO con timezone
- Compatible con Railway deployment (timezone configurable por $TZ)

## 🎯 Resultado

✅ No más notificaciones falsas de aterrizaje
✅ Timestamps claros en hora Argentina
✅ Sistema sobrevive reinicios sin perder estado
✅ Historial completo y persistente
