"""Runtime configuration, read from environment (systemd EnvironmentFile=/etc/wsb/api.env)."""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _required(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        print(f"[config] missing required env var {name}", file=sys.stderr)
        sys.exit(1)
    return v


BASE_DIR = Path(__file__).resolve().parent.parent

DB_PATH = Path(os.environ.get("DB_PATH", BASE_DIR / "data" / "telemetry.db"))
STATIC_DIR = Path(os.environ.get("STATIC_DIR", BASE_DIR / "static"))

JWT_SECRET = _required("JWT_SECRET")
JWT_TTL_HOURS = int(os.environ.get("JWT_TTL_HOURS", "12"))

MQTT_HOST = os.environ.get("MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USER = os.environ.get("MQTT_USER", "backend")
MQTT_PASS = _required("MQTT_PASS")
TOPIC_PREFIX = "wsb/devices"

RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", "90"))
OFFLINE_AFTER_SEC = int(os.environ.get("OFFLINE_AFTER_SEC", "90"))

# Login brute-force protection
LOGIN_MAX_ATTEMPTS = int(os.environ.get("LOGIN_MAX_ATTEMPTS", "8"))
LOGIN_WINDOW_SEC = int(os.environ.get("LOGIN_WINDOW_SEC", "900"))
