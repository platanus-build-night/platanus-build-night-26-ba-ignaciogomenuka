"""
Parses a Telegram chat (JSON export OR plain text paste) from the flight monitor bot
and generates import_telegram.sql ready to paste in Supabase SQL Editor.

Usage:
  python parse_telegram.py [input_file]

Accepts:
  - telegram_export.json  (Telegram Desktop JSON export)
  - telegram_export.txt   (plain text — just copy all messages and paste into a .txt file)

Default: tries telegram_export.txt, then telegram_export.json
"""

import json
import re
import sys
from datetime import datetime, timezone

OUTPUT_FILE = "import_telegram.sql"

PLANES = {
    "LV-FVZ": "e0659a",
    "LV-CCO": "e030cf",
    "LV-FUF": "e06546",
    "LV-KMA": "e0b341",
    "LV-KAX": "e0b058",
}

# Matches tail numbers anywhere in text
TAIL_RE  = re.compile(r'\b(LV-[A-Z]{3})\b')
# Timestamp line like: 🕐 2025-11-15 14:30:22
TIME_RE  = re.compile(r'(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})')
ALT_RE   = re.compile(r'Altitud:\s*([\d.]+)')
VEL_RE   = re.compile(r'Velocidad:\s*([\d.]+)')
SRC_RE   = re.compile(r'Fuente:\s*(\S+)')


def get_text(msg):
    """Extract plain text from a Telegram message (string or entity list)."""
    t = msg.get("text", "")
    if isinstance(t, str):
        return t
    # Array of strings / entity objects
    parts = []
    for chunk in t:
        if isinstance(chunk, str):
            parts.append(chunk)
        elif isinstance(chunk, dict):
            parts.append(chunk.get("text", ""))
    return "".join(parts)


def detect_event(text):
    """Return 'TAKEOFF', 'LANDING', or None based on message content."""
    if any(w in text for w in ("despegó", "en curso", "takeoff", "TAKEOFF")):
        return "TAKEOFF"
    if any(w in text for w in ("aterrizó", "landing", "LANDING")):
        return "LANDING"
    return None


def parse_timestamp(text, msg_date):
    """Try to extract timestamp from message body, fall back to message date."""
    m = TIME_RE.search(text)
    if m:
        try:
            return datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    # Fall back to Telegram message date
    try:
        return datetime.fromisoformat(msg_date).replace(tzinfo=timezone.utc)
    except Exception:
        return None


def escape(s):
    return s.replace("'", "''")


def load_messages(path):
    """Return list of {text, date} dicts regardless of input format."""
    with open(path, encoding="utf-8") as f:
        raw = f.read()

    # Try JSON first
    if raw.lstrip().startswith("{"):
        data = json.loads(raw)
        out = []
        for m in data.get("messages", []):
            if m.get("type") == "message":
                out.append({"text": get_text(m), "date": m.get("date", "")})
        return out

    # Plain text: split by Telegram header lines like "Monitor de Vuelos, [31/12/2025 17:29]"
    parts = re.split(r'^.+,\s*\[\d+/\d+/\d{4}\s+\d+:\d+\]\n', raw, flags=re.MULTILINE)
    return [{"text": c.strip(), "date": ""} for c in parts if c.strip()]


def main():
    # Determine input file
    if len(sys.argv) > 1:
        input_file = sys.argv[1]
    elif __import__("os").path.exists("telegram_export.txt"):
        input_file = "telegram_export.txt"
    elif __import__("os").path.exists("telegram_export.json"):
        input_file = "telegram_export.json"
    else:
        print("No input file found.")
        print("Save copied Telegram messages as telegram_export.txt in this folder.")
        return

    try:
        messages = load_messages(input_file)
    except FileNotFoundError:
        print(f"File not found: {input_file}")
        return

    print(f"Loaded {len(messages)} message chunks from {input_file}")

    rows = []
    skipped = 0

    for msg in messages:
        if "type" in msg and msg["type"] != "message":
            continue

        text = get_text(msg)
        if not text:
            continue

        event_type = detect_event(text)
        if not event_type:
            continue

        tails = TAIL_RE.findall(text)
        if not tails:
            skipped += 1
            continue

        tail = tails[0]
        icao24 = PLANES.get(tail)
        if not icao24:
            skipped += 1
            continue

        ts = parse_timestamp(text, msg.get("date", ""))
        if not ts:
            skipped += 1
            continue

        # Extract optional metadata
        alt = ALT_RE.search(text)
        vel = VEL_RE.search(text)
        src = SRC_RE.search(text)
        meta = {
            "source": src.group(1) if src else "telegram-history",
        }
        if alt:
            meta["altitude"] = float(alt.group(1))
        if vel:
            meta["velocity"] = float(vel.group(1))

        meta_json = escape(json.dumps(meta))
        ts_iso    = ts.isoformat()

        rows.append(
            f"((SELECT id FROM aircraft WHERE icao24 = '{icao24}'), "
            f"'{ts_iso}', '{event_type}', '{meta_json}'::jsonb)"
        )

    print(f"Parsed {len(rows)} events ({skipped} skipped — no tail/timestamp)")

    if not rows:
        print("No events found. Check that the export is from the flight monitor bot.")
        return

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("-- Auto-generated by parse_telegram.py\n")
        f.write("-- Paste this in Supabase SQL Editor\n\n")
        f.write("INSERT INTO events (aircraft_id, ts, type, meta)\nVALUES\n")
        f.write(",\n".join(rows))
        f.write("\nON CONFLICT DO NOTHING;\n")

    print(f"Done. {len(rows)} rows written to {OUTPUT_FILE}")
    print(f"Paste {OUTPUT_FILE} into Supabase SQL Editor to import.")


if __name__ == "__main__":
    main()
