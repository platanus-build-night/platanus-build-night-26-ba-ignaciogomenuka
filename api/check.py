import requests
import os
from datetime import datetime

PLANES = ["LVFVZ", "LVFUF", "LVKMA", "LVCCO"]

def notify_telegram(msg):
    token = os.getenv("TELEGRAM_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if token and chat_id:
        try:
            requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                data={"chat_id": chat_id, "text": msg}
            )
        except Exception as e:
            print(f"Error enviando mensaje por Telegram: {e}")

def handler(request):
    try:
        response = requests.get("https://opensky-network.org/api/states/all", timeout=30)
        data = response.json()

        planes_volando = []

        for state in data.get("states", []):
            if len(state) < 14:
                continue

            callsign = state[1].strip().upper() if state[1] else None

            if callsign in PLANES:
                altitude = state[13] if state[13] is not None else "N/A"
                velocity = round(state[9] * 3.6, 1) if state[9] is not None else "N/A"
                lat = state[6] if state[6] is not None else "N/A"
                lon = state[5] if state[5] is not None else "N/A"
                country = state[2] if state[2] else "N/A"

                plane_info = {
                    "callsign": callsign,
                    "altitude": altitude,
                    "velocity": velocity,
                    "country": country,
                    "lat": lat,
                    "lon": lon
                }
                planes_volando.append(plane_info)

        if planes_volando:
            msg = f"✈️ Aviones en vuelo ({len(planes_volando)}):\n\n"
            for plane in planes_volando:
                msg += (f"{plane['callsign']}: {plane['altitude']}m, "
                       f"{plane['velocity']}km/h, {plane['country']}\n")
            msg += f"\nFecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

            notify_telegram(msg)

        return {
            "statusCode": 200,
            "body": {
                "timestamp": datetime.now().isoformat(),
                "planes_monitoreados": PLANES,
                "planes_en_vuelo": len(planes_volando),
                "aviones": planes_volando
            }
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "body": {"error": str(e)}
        }