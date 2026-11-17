"""MQTT bridge: ingests device telemetry/status/logs and publishes retained calibration configs."""
from __future__ import annotations

import json
import logging
import os
import re

import paho.mqtt.client as mqtt

from . import config, store
from .schemas import ValidationError, normalize_telemetry

log = logging.getLogger("wsb.mqtt")

_TOPIC_RE = re.compile(rf"^{re.escape(config.TOPIC_PREFIX)}/([A-Za-z0-9_-]{{1,32}})/(telemetry|status|logs)$")

state = {"connected": False, "received": 0, "rejected": 0}
_client: mqtt.Client | None = None


def _on_connect(client, userdata, flags, reason_code, properties):
    if reason_code.is_failure:
        log.error("connect failed: %s", reason_code)
        store.add_log("server", "mqtt_error", f"Mosquitto connect failed: {reason_code}", level="ERROR")
        return
    state["connected"] = True
    log.info("connected to %s:%s", config.MQTT_HOST, config.MQTT_PORT)
    store.add_log("server", "mqtt_connect", f"Connected to Mosquitto broker at {config.MQTT_HOST}:{config.MQTT_PORT}")
    client.subscribe([
        (f"{config.TOPIC_PREFIX}/+/telemetry", 1),
        (f"{config.TOPIC_PREFIX}/+/status", 1),
        (f"{config.TOPIC_PREFIX}/+/logs", 0),
    ])
    for d in store.list_devices():
        publish_config(d["id"])


def _on_disconnect(client, userdata, flags, reason_code, properties):
    state["connected"] = False
    log.warning("disconnected: %s", reason_code)


def _on_message(client, userdata, msg: mqtt.MQTTMessage):
    m = _TOPIC_RE.match(msg.topic)
    if not m:
        return
    device_id, kind = m.group(1), m.group(2)
    raw = msg.payload.decode("utf-8", errors="replace")
    try:
        if not store.get_device(device_id):
            store.log_rejected(device_id, "unknown device", raw)
            return
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            state["rejected"] += 1
            store.log_rejected(device_id, "invalid JSON", raw)
            return

        if kind == "status":
            if isinstance(payload, dict):
                store.update_device_status(device_id, payload)
            return

        if kind == "logs":
            if isinstance(payload, dict):
                lvl = str(payload.get("level") or "INFO").upper()[:10]
                ev = str(payload.get("event") or "device")[:40]
                det = str(payload.get("detail") or "")[:500]
                store.add_log("device", ev, det, level=lvl, device_id=device_id)
            return

        items = payload if isinstance(payload, list) else [payload]
        recs = []
        for item in items:
            try:
                rec, warnings = normalize_telemetry(item, device_id, "mqtt")
                if warnings:
                    store.log_rejected(device_id, "partial: " + "; ".join(warnings), item)
                recs.append(rec)
            except ValidationError as e:
                state["rejected"] += 1
                store.log_rejected(device_id, str(e), item)
        if recs:
            state["received"] += len(recs)
            store.store_telemetry(recs)
    except Exception:
        log.exception("error handling %s", msg.topic)


def start() -> None:
    global _client
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"wsb-backend-{os.getpid()}")
    c.username_pw_set(config.MQTT_USER, config.MQTT_PASS)
    c.on_connect = _on_connect
    c.on_disconnect = _on_disconnect
    c.on_message = _on_message
    c.reconnect_delay_set(min_delay=1, max_delay=30)
    c.connect_async(config.MQTT_HOST, config.MQTT_PORT, keepalive=30)
    c.loop_start()
    _client = c


def stop() -> None:
    if _client:
        _client.loop_stop()
        _client.disconnect()


def publish_config(device_id: str) -> bool:
    payload = store.device_config_payload(device_id)
    if not _client or not payload:
        return False
    _client.publish(f"{config.TOPIC_PREFIX}/{device_id}/config", json.dumps(payload), qos=1, retain=True)
    return True


def publish_command(device_id: str, command: dict) -> bool:
    if not _client or not state["connected"]:
        return False
    _client.publish(f"{config.TOPIC_PREFIX}/{device_id}/cmd", json.dumps(command), qos=1, retain=False)
    return True
