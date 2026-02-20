#!/bin/bash

cd "$(dirname "$0")"

source venv/bin/activate

echo "Iniciando monitor de vuelos en background..."

if command -v screen &> /dev/null; then
    screen -dmS flight_monitor python3 -u monitor_vuelos.py
    echo "✓ Monitor iniciado en screen session 'flight_monitor'"
    echo "  Ver log: screen -r flight_monitor"
    echo "  Detener: screen -S flight_monitor -X quit"
else
    nohup python3 -u monitor_vuelos.py > monitor.log 2>&1 &
    echo "✓ Monitor iniciado con PID $!"
    echo "  Ver log: tail -f monitor.log"
    echo "  Detener: pkill -f monitor_vuelos"
fi

echo ""
echo "Monitoreando: LV-FVZ, LV-CCO, LV-FUF, LV-KMA, LV-KAX"
echo "Verificación cada 5 minutos"
