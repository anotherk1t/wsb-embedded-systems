"""Admin CLI.

  python -m app.cli add-user <username> [--password P]
  python -m app.cli add-device <device_id> [--name N] [--key K]      (prints the device key)
  python -m app.cli rotate-device-key <device_id> [--key K]
  python -m app.cli list

Device MQTT credentials must also be added to Mosquitto:  mosquitto_passwd -b /etc/mosquitto/passwd <id> <key>
(deploy/deploy.sh does this automatically for the default device).
"""
from __future__ import annotations

import argparse
import getpass
import secrets
import sys

from . import db, store


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)

    u = sub.add_parser("add-user", help="create a dashboard user or reset their password")
    u.add_argument("username")
    u.add_argument("--password")

    d = sub.add_parser("add-device", help="register a device and print its key")
    d.add_argument("device_id")
    d.add_argument("--name")
    d.add_argument("--key")

    r = sub.add_parser("rotate-device-key")
    r.add_argument("device_id")
    r.add_argument("--key")

    sub.add_parser("list")
    a = p.parse_args(argv)
    db.init()

    if a.cmd == "add-user":
        pw = a.password or getpass.getpass("Password: ")
        if len(pw) < 10:
            print("password must be at least 10 characters", file=sys.stderr)
            return 1
        store.upsert_user(a.username, pw)
        print(f"user {a.username} saved")
    elif a.cmd == "add-device":
        if store.get_device(a.device_id):
            print(f"device {a.device_id} already exists (use rotate-device-key)", file=sys.stderr)
            return 1
        key = store.create_device(a.device_id, a.name, a.key)
        print(key)
    elif a.cmd == "rotate-device-key":
        if not store.get_device(a.device_id):
            print("no such device", file=sys.stderr)
            return 1
        key = a.key or secrets.token_urlsafe(18)
        store.set_device_key(a.device_id, key)
        print(key)
    elif a.cmd == "list":
        for dev in store.list_devices():
            print(f"{dev['id']:<16} online={dev['online']!s:<5} last_seen={dev['last_seen']} fw={dev['fw']}")
        for usr in db.query("SELECT username, last_login FROM users"):
            print(f"user {usr['username']:<16} last_login={usr['last_login']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
