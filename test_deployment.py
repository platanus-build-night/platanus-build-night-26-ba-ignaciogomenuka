#!/usr/bin/env python3

import requests
import json
import sys
from datetime import datetime

def test_deployment(base_url):
    """Test del deployment en Railway"""

    print(f"🧪 Testing deployment: {base_url}")
    print("=" * 50)

    # Test 1: Health check
    print("\n1️⃣ Testing health check...")
    try:
        response = requests.get(f"{base_url}/status", timeout=10)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Health check OK")
            print(f"   Status: {data.get('status')}")
            print(f"   Planes monitoreados: {data.get('planes_monitoreados')}")
            print(f"   Timestamp: {data.get('timestamp')}")
        else:
            print(f"❌ Health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Health check error: {e}")
        return False

    # Test 2: Web interface
    print("\n2️⃣ Testing web interface...")
    try:
        response = requests.get(base_url, timeout=10)
        if response.status_code == 200:
            print("✅ Web interface accessible")
            if "Monitor de Vuelos Privados" in response.text:
                print("✅ Page content looks correct")
            else:
                print("⚠️ Page content might be wrong")
        else:
            print(f"❌ Web interface failed: {response.status_code}")
    except Exception as e:
        print(f"❌ Web interface error: {e}")

    # Test 3: API endpoint
    print("\n3️⃣ Testing API endpoint...")
    try:
        response = requests.get(f"{base_url}/api/check", timeout=30)
        if response.status_code == 200:
            data = response.json()
            print("✅ API endpoint working")
            print(f"   Planes monitoreados: {data.get('planes_monitoreados')}")
            print(f"   Planes en vuelo: {data.get('planes_en_vuelo')}")
            print(f"   Timestamp: {data.get('timestamp')}")

            if data.get('planes_en_vuelo', 0) > 0:
                print("✈️ AVIONES DETECTADOS EN VUELO:")
                for avion in data.get('aviones', []):
                    print(f"   🛩️ {avion['callsign']}: {avion['altitude']}m, {avion['velocity']}km/h")
            else:
                print("🔴 No hay aviones en vuelo actualmente")

        else:
            print(f"❌ API endpoint failed: {response.status_code}")
            print(f"Response: {response.text}")
    except Exception as e:
        print(f"❌ API endpoint error: {e}")

    # Test 4: Manual Telegram test
    print("\n4️⃣ Testing Telegram notification...")
    try:
        test_message = f"🧪 Test del sistema de monitoreo\nFecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

        # Intentar enviar mensaje de test
        telegram_test_url = f"{base_url}/api/check"  # Esto triggereará el check y posibles notificaciones
        response = requests.get(telegram_test_url, timeout=30)

        if response.status_code == 200:
            print("✅ Telegram test triggered")
            print("📱 Revisa tu Telegram para ver si llegaron notificaciones")
        else:
            print("⚠️ Could not trigger Telegram test")

    except Exception as e:
        print(f"❌ Telegram test error: {e}")

    print("\n" + "=" * 50)
    print("🏁 Test completado!")
    print("\n📝 Próximos pasos:")
    print("1. Revisa tu Telegram para confirmar que llegan las notificaciones")
    print("2. El sistema monitoreará automáticamente cada 5 minutos")
    print("3. Usa la web interface para verificaciones manuales")

    return True

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Uso: python test_deployment.py <URL_DE_RAILWAY>")
        print("Ejemplo: python test_deployment.py https://tu-app.railway.app")
        sys.exit(1)

    base_url = sys.argv[1].rstrip('/')
    test_deployment(base_url)