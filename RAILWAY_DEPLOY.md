# 🚂 Deployment en Railway

## 🔧 Configuración Necesaria

### Variables de Entorno en Railway

Debes configurar estas variables en Railway Dashboard:

```bash
TELEGRAM_TOKEN=tu_token_aqui
TELEGRAM_CHAT_ID=tu_chat_id_aqui
ENABLE_MONITOR=true
```

### ⚙️ Pasos para Deploy

1. **Push al repositorio**
```bash
git add .
git commit -m "Enable automatic monitoring on Railway"
git push
```

2. **En Railway Dashboard:**
   - Ve a tu proyecto
   - Click en "Variables"
   - Añade: `ENABLE_MONITOR` = `true`
   - Añade: `TELEGRAM_TOKEN` = `tu_token`
   - Añade: `TELEGRAM_CHAT_ID` = `tu_chat_id`

3. **Railway auto-redeploy** tras el push

## ✅ Verificación

Una vez deployed:

1. **Check logs:**
```
Railway Dashboard → Deployments → View Logs
```

Deberías ver:
```
✅ Monitor automático iniciado en thread background
📊 Verificando vuelos cada 5 minutos
```

2. **Test endpoints:**
```bash
curl https://tu-app.railway.app/status
curl https://tu-app.railway.app/api/check
```

## 🔄 Funcionamiento

- **Auto-start**: Monitor inicia automáticamente con el deploy
- **Auto-restart**: Railway reinicia si el proceso falla (hasta 10 intentos)
- **Healthcheck**: Railway verifica `/status` cada 100s
- **Timeout**: 300s para operaciones largas
- **Workers**: 1 worker para evitar duplicados

## 🛠️ Troubleshooting

**Monitor no inicia:**
```bash
# Verifica la variable
echo $ENABLE_MONITOR  # Debe ser 'true'
```

**Sin notificaciones:**
```bash
# Test Telegram
curl https://tu-app.railway.app/test-telegram
```

**Logs no muestran verificaciones:**
- Verifica que ENABLE_MONITOR=true
- Check Railway logs para errores
- Prueba `/api/check` manualmente
