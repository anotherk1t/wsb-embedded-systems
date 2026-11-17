#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "==> [1/7] Installing system packages..."
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip mosquitto mosquitto-clients nginx ufw sqlite3 curl ca-certificates openssl >/dev/null

echo "==> [2/6] Creating system user & directories..."
id -u wsb >/dev/null 2>&1 || useradd --system --home-dir /var/lib/wsb --create-home --shell /usr/sbin/nologin wsb
mkdir -p /opt/wsb/server /var/lib/wsb /etc/wsb /opt/wsb/server/static
chown -R wsb:wsb /var/lib/wsb

echo "==> [3/6] Setting up Python virtualenv & FastAPI dependencies..."
if [ ! -x /opt/wsb/server/.venv/bin/uvicorn ]; then
  python3 -m venv /opt/wsb/server/.venv
fi
/opt/wsb/server/.venv/bin/pip install --quiet --upgrade pip
/opt/wsb/server/.venv/bin/pip install --quiet -r /opt/wsb/server/requirements.txt

echo "==> [5/7] Generating secrets & provisioning Mosquitto + FastAPI database..."
CRED_FILE=/etc/wsb/credentials.txt
ENV_FILE=/etc/wsb/api.env

if [ ! -f "$ENV_FILE" ]; then
  JWT_SECRET=$(openssl rand -hex 32)
  MQTT_PASS=$(openssl rand -base64 24 | tr -d '/+=')
  ADMIN_PASS="WSB-$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | head -c 12)"
  DEVICE_KEY=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9_-' | head -c 24)

  cat > "$ENV_FILE" <<EOF
DB_PATH=/var/lib/wsb/telemetry.db
STATIC_DIR=/opt/wsb/server/static
JWT_SECRET=$JWT_SECRET
JWT_TTL_HOURS=12
MQTT_HOST=127.0.0.1
MQTT_PORT=1883
MQTT_USER=backend
MQTT_PASS=$MQTT_PASS
RETENTION_DAYS=90
OFFLINE_AFTER_SEC=90
EOF
  chmod 640 "$ENV_FILE"
  chown root:wsb "$ENV_FILE"

  cat > "$CRED_FILE" <<EOF
DASHBOARD_URL=http://164.92.227.240/
ADMIN_USER=admin
ADMIN_PASS=$ADMIN_PASS
DEVICE_ID=cyd-01
DEVICE_KEY=$DEVICE_KEY
MQTT_HOST=164.92.227.240
MQTT_PORT=1883
EOF
  chmod 600 "$CRED_FILE"
fi

# Source generated credentials
set -a
. "$ENV_FILE"
. "$CRED_FILE"
set +a

# Configure Mosquitto passwd + ACL
touch /etc/mosquitto/passwd
mosquitto_passwd -b /etc/mosquitto/passwd backend "$MQTT_PASS"
mosquitto_passwd -b /etc/mosquitto/passwd "$DEVICE_ID" "$DEVICE_KEY"
chown root:mosquitto /etc/mosquitto/passwd
chmod 640 /etc/mosquitto/passwd

cp /opt/wsb/server/deploy/mosquitto.acl /etc/mosquitto/acl
chown root:mosquitto /etc/mosquitto/acl
chmod 640 /etc/mosquitto/acl

cp /opt/wsb/server/deploy/mosquitto-wsb.conf /etc/mosquitto/conf.d/wsb.conf
systemctl enable mosquitto >/dev/null
systemctl restart mosquitto

# Seed user and device in SQLite DB
cd /opt/wsb/server
sudo -u wsb -E /opt/wsb/server/.venv/bin/python -m app.cli add-user "$ADMIN_USER" --password "$ADMIN_PASS" >/dev/null
if ! sudo -u wsb -E /opt/wsb/server/.venv/bin/python -m app.cli list | grep -q "^$DEVICE_ID "; then
  sudo -u wsb -E /opt/wsb/server/.venv/bin/python -m app.cli add-device "$DEVICE_ID" --name "ESP32 CYD Station" --key "$DEVICE_KEY" >/dev/null
else
  sudo -u wsb -E /opt/wsb/server/.venv/bin/python -m app.cli rotate-device-key "$DEVICE_ID" --key "$DEVICE_KEY" >/dev/null
fi
chown -R wsb:wsb /var/lib/wsb

echo "==> [6/7] Configuring systemd service & Nginx..."
cp /opt/wsb/server/deploy/wsb-api.service /etc/systemd/system/wsb-api.service
systemctl daemon-reload
systemctl enable wsb-api.service >/dev/null
systemctl restart wsb-api.service

cp /opt/wsb/server/deploy/nginx-wsb.conf /etc/nginx/sites-available/wsb
ln -sf /etc/nginx/sites-available/wsb /etc/nginx/sites-enabled/wsb
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null
systemctl reload nginx

echo "==> [7/7] Configuring UFW firewall (22/tcp, 80/tcp, 443/tcp, 1883/tcp)..."
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 1883/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> Deployment complete! Credentials:"
cat "$CRED_FILE"
