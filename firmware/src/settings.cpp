#include "settings.h"

#include <ArduinoJson.h>
#include <Preferences.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include "config.h"

namespace {

constexpr const char* kNvsNamespace = "wsb_cfg";
constexpr const char* kCredNamespace = "wsb_cred";

SemaphoreHandle_t s_cfgMutex = nullptr;
SemaphoreHandle_t s_credMutex = nullptr;
DeviceConfig s_cfg;
DeviceCredentials s_cred;

bool isPlaceholderWifi(const String& s) {
  return s.length() == 0 || s == "YOUR_WIFI_SSID";
}

bool isPlaceholderPass(const String& s) {
  return s == "YOUR_WIFI_PASSWORD";
}

bool isPlaceholderKey(const String& s) {
  return s.length() == 0 || s == "CHANGE_ME";
}

void clampConfig(DeviceConfig& c) {
  if (c.telemetry_interval_s < 1) c.telemetry_interval_s = 1;
  if (c.telemetry_interval_s > 3600) c.telemetry_interval_s = 3600;
  if (c.sea_level_hpa < 800.0f || c.sea_level_hpa > 1200.0f) {
    c.sea_level_hpa = 1013.25f;
  }
  if (c.gas_baseline_kohm < 0.0f) c.gas_baseline_kohm = 0.0f;
  if (c.gps_baud < 4800 || c.gps_baud > 115200) {
    c.gps_baud = 9600;
  }
}

void saveToNvsLocked(const DeviceConfig& c) {
  Preferences prefs;
  if (!prefs.begin(kNvsNamespace, false)) {
    Serial.println("[CFG] Failed to open NVS for writing");
    return;
  }
  prefs.putUInt("ver", c.version);
  prefs.putUShort("intv", c.telemetry_interval_s);
  prefs.putFloat("toff", c.temp_offset_c);
  prefs.putFloat("hoff", c.humidity_offset);
  prefs.putFloat("poff", c.pressure_offset_hpa);
  prefs.putFloat("slp", c.sea_level_hpa);
  prefs.putFloat("gbase", c.gas_baseline_kohm);
  prefs.putUChar("brit", c.display_brightness);
  prefs.putBool("auto", c.auto_brightness);
  prefs.putUShort("sdim", c.screen_dim_s);
  prefs.putUShort("soff", c.screen_off_s);
  prefs.putUInt("gbaud", c.gps_baud);
  prefs.end();
}

bool saveCredsToNvsLocked(const DeviceCredentials& c) {
  Preferences prefs;
  if (!prefs.begin(kCredNamespace, false)) {
    Serial.println("[CRED] Failed to open NVS wsb_cred for writing");
    return false;
  }
  prefs.putString("wifi_ssid", c.wifi_ssid);
  prefs.putString("wifi_pass", c.wifi_pass);
  prefs.putString("device_id", c.device_id);
  if (c.device_key.length() > 0) {
    prefs.putString("device_key", c.device_key);
  }
  prefs.end();
  return true;
}

}  // namespace

void settingsInit() {
  if (!s_cfgMutex) {
    s_cfgMutex = xSemaphoreCreateMutex();
  }
  if (!s_credMutex) {
    s_credMutex = xSemaphoreCreateMutex();
  }

  DeviceConfig loaded;
  Preferences prefs;
  if (prefs.begin(kNvsNamespace, true)) {
    if (prefs.isKey("ver")) {
      loaded.version = prefs.getUInt("ver", 0);
      loaded.telemetry_interval_s = prefs.getUShort("intv", 10);
      loaded.temp_offset_c = prefs.getFloat("toff", 0.0f);
      loaded.humidity_offset = prefs.getFloat("hoff", 0.0f);
      loaded.pressure_offset_hpa = prefs.getFloat("poff", 0.0f);
      loaded.sea_level_hpa = prefs.getFloat("slp", 1013.25f);
      loaded.gas_baseline_kohm = prefs.getFloat("gbase", 0.0f);
      loaded.display_brightness = prefs.getUChar("brit", 200);
      loaded.auto_brightness = prefs.getBool("auto", true);
      loaded.screen_dim_s = prefs.getUShort("sdim", 30);
      loaded.screen_off_s = prefs.getUShort("soff", 120);
      loaded.gps_baud = prefs.getUInt("gbaud", 9600);
      clampConfig(loaded);
      Serial.printf("[CFG] Loaded NVS config v%u (intv=%us, baud=%u)\n",
                    loaded.version, loaded.telemetry_interval_s, loaded.gps_baud);
    } else {
      Serial.println("[CFG] No NVS config saved yet, using defaults (v0)");
    }
    prefs.end();
  } else {
    Serial.println("[CFG] NVS namespace empty, using defaults (v0)");
  }

  xSemaphoreTake(s_cfgMutex, portMAX_DELAY);
  s_cfg = loaded;
  xSemaphoreGive(s_cfgMutex);

  // Load credentials with secrets.h fallbacks for non-placeholder values
  DeviceCredentials loadedCred;
  String defSsid = String(WIFI_SSID);
  String defPass = String(WIFI_PASS);
  if (!isPlaceholderWifi(defSsid)) {
    loadedCred.wifi_ssid = defSsid;
    loadedCred.wifi_pass = isPlaceholderPass(defPass) ? String("") : defPass;
  }

  String defId = String(DEVICE_ID);
  defId.trim();
  loadedCred.device_id = (defId.length() > 0) ? defId : String("cyd-01");

  String defKey = String(DEVICE_KEY);
  loadedCred.device_key = isPlaceholderKey(defKey) ? String("") : defKey;

  Preferences credPrefs;
  if (credPrefs.begin(kCredNamespace, true)) {
    if (credPrefs.isKey("wifi_ssid")) {
      String nvsSsid = credPrefs.getString("wifi_ssid", "");
      if (!isPlaceholderWifi(nvsSsid)) {
        loadedCred.wifi_ssid = nvsSsid;
        loadedCred.wifi_pass = credPrefs.isKey("wifi_pass")
                                   ? credPrefs.getString("wifi_pass", "")
                                   : String("");
      }
    }
    if (credPrefs.isKey("device_id")) {
      String nvsId = credPrefs.getString("device_id", "");
      nvsId.trim();
      if (nvsId.length() > 0) {
        loadedCred.device_id = nvsId;
      }
    }
    if (credPrefs.isKey("device_key")) {
      String nvsKey = credPrefs.getString("device_key", "");
      if (!isPlaceholderKey(nvsKey)) {
        loadedCred.device_key = nvsKey;
      }
    }
    credPrefs.end();
  } else {
    Serial.println("[CRED] NVS wsb_cred empty, using compiled defaults");
  }

  xSemaphoreTake(s_credMutex, portMAX_DELAY);
  s_cred = loadedCred;
  xSemaphoreGive(s_credMutex);

  Serial.printf("[CRED] SSID=%s  ID=%s  hasKey=%d\n",
                loadedCred.wifi_ssid.length() > 0 ? loadedCred.wifi_ssid.c_str() : "(unconfigured)",
                loadedCred.device_id.c_str(),
                loadedCred.device_key.length() > 0 ? 1 : 0);
}

DeviceConfig settingsGet() {
  if (!s_cfgMutex) return s_cfg;
  xSemaphoreTake(s_cfgMutex, portMAX_DELAY);
  DeviceConfig copy = s_cfg;
  xSemaphoreGive(s_cfgMutex);
  return copy;
}

bool settingsApplyJson(const char* json, size_t len, bool* gpsBaudChanged) {
  if (!json || len == 0) return false;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, json, len);
  if (err) {
    Serial.printf("[CFG] JSON parse error: %s\n", err.c_str());
    return false;
  }
  if (!doc.is<JsonObject>() || doc["version"].isNull()) {
    Serial.println("[CFG] Config JSON missing 'version'");
    return false;
  }

  uint32_t newVer = doc["version"].as<uint32_t>();

  xSemaphoreTake(s_cfgMutex, portMAX_DELAY);
  if (newVer <= s_cfg.version) {
    uint32_t curVer = s_cfg.version;
    xSemaphoreGive(s_cfgMutex);
    Serial.printf("[CFG] Ignoring config v%u (current v%u)\n", newVer, curVer);
    return false;
  }

  DeviceConfig next = s_cfg;
  next.version = newVer;

  if (!doc["telemetry_interval_s"].isNull()) {
    next.telemetry_interval_s = doc["telemetry_interval_s"].as<uint16_t>();
  }
  if (!doc["temp_offset_c"].isNull()) {
    next.temp_offset_c = doc["temp_offset_c"].as<float>();
  }
  if (!doc["humidity_offset"].isNull()) {
    next.humidity_offset = doc["humidity_offset"].as<float>();
  }
  if (!doc["pressure_offset_hpa"].isNull()) {
    next.pressure_offset_hpa = doc["pressure_offset_hpa"].as<float>();
  }
  if (!doc["sea_level_hpa"].isNull()) {
    next.sea_level_hpa = doc["sea_level_hpa"].as<float>();
  }
  if (!doc["gas_baseline_kohm"].isNull()) {
    next.gas_baseline_kohm = doc["gas_baseline_kohm"].as<float>();
  }
  if (!doc["display_brightness"].isNull()) {
    int b = doc["display_brightness"].as<int>();
    next.display_brightness = static_cast<uint8_t>(constrain(b, 0, 255));
  }
  if (!doc["auto_brightness"].isNull()) {
    next.auto_brightness = doc["auto_brightness"].as<bool>();
  }
  if (!doc["screen_dim_s"].isNull()) {
    next.screen_dim_s = doc["screen_dim_s"].as<uint16_t>();
  }
  if (!doc["screen_off_s"].isNull()) {
    next.screen_off_s = doc["screen_off_s"].as<uint16_t>();
  }
  if (!doc["gps_baud"].isNull()) {
    next.gps_baud = doc["gps_baud"].as<uint32_t>();
  }

  clampConfig(next);
  bool baudChanged = (next.gps_baud != s_cfg.gps_baud);
  s_cfg = next;
  saveToNvsLocked(s_cfg);
  xSemaphoreGive(s_cfgMutex);

  if (gpsBaudChanged) {
    *gpsBaudChanged = baudChanged;
  }

  Serial.printf("[CFG] Applied config v%u: intv=%us toff=%.2f hoff=%.2f poff=%.2f slp=%.2f gasBase=%.1f brit=%u auto=%d dim=%us off=%us baud=%u\n",
                next.version, next.telemetry_interval_s, next.temp_offset_c,
                next.humidity_offset, next.pressure_offset_hpa, next.sea_level_hpa,
                next.gas_baseline_kohm, next.display_brightness,
                next.auto_brightness ? 1 : 0, next.screen_dim_s, next.screen_off_s,
                next.gps_baud);
  return true;
}

void settingsSetDisplayBrightness(uint8_t brightness) {
  if (!s_cfgMutex) {
    s_cfg.display_brightness = brightness;
    return;
  }
  xSemaphoreTake(s_cfgMutex, portMAX_DELAY);
  s_cfg.display_brightness = brightness;
  xSemaphoreGive(s_cfgMutex);
}

DeviceCredentials settingsGetCredentials() {
  if (!s_credMutex) return s_cred;
  xSemaphoreTake(s_credMutex, portMAX_DELAY);
  DeviceCredentials copy = s_cred;
  xSemaphoreGive(s_credMutex);
  return copy;
}

void settingsGetDeviceId(char* outBuf, size_t maxLen) {
  if (!outBuf || maxLen == 0) return;
  if (!s_credMutex) {
    snprintf(outBuf, maxLen, "%s", DEVICE_ID);
    return;
  }
  xSemaphoreTake(s_credMutex, portMAX_DELAY);
  snprintf(outBuf, maxLen, "%s",
           s_cred.device_id.length() > 0 ? s_cred.device_id.c_str() : "cyd-01");
  xSemaphoreGive(s_credMutex);
}

bool settingsHasWifiCredentials() {
  if (!s_credMutex) return s_cred.wifi_ssid.length() > 0;
  xSemaphoreTake(s_credMutex, portMAX_DELAY);
  bool ok = s_cred.wifi_ssid.length() > 0;
  xSemaphoreGive(s_credMutex);
  return ok;
}

bool settingsSaveCredentials(const String& wifiSsid,
                             const String& wifiPass,
                             const String& deviceId) {
  if (wifiSsid.length() == 0 || !s_credMutex) return false;

  xSemaphoreTake(s_credMutex, portMAX_DELAY);
  DeviceCredentials next = s_cred;
  next.wifi_ssid = wifiSsid;
  next.wifi_pass = wifiPass;

  String cleanId = deviceId;
  cleanId.trim();
  if (cleanId.length() > 0) {
    next.device_id = cleanId;
  }

  bool ok = saveCredsToNvsLocked(next);
  if (ok) {
    s_cred = next;
  }
  xSemaphoreGive(s_credMutex);

  Serial.printf("[CRED] Saved Wi-Fi credentials: ssid='%s' id='%s' ok=%d\n",
                next.wifi_ssid.c_str(), next.device_id.c_str(), ok ? 1 : 0);
  return ok;
}

bool settingsSaveDeviceAuth(const String& deviceId, const String& deviceKey) {
  if (!s_credMutex) return false;
  String cleanId = deviceId;
  cleanId.trim();
  if (cleanId.length() == 0 && deviceKey.length() == 0) return false;

  xSemaphoreTake(s_credMutex, portMAX_DELAY);
  bool changed = false;
  DeviceCredentials next = s_cred;
  if (cleanId.length() > 0 && cleanId != next.device_id) {
    next.device_id = cleanId;
    changed = true;
  }
  if (deviceKey.length() > 0 && deviceKey != next.device_key) {
    next.device_key = deviceKey;
    changed = true;
  }
  if (changed && saveCredsToNvsLocked(next)) {
    s_cred = next;
  }
  xSemaphoreGive(s_credMutex);

  if (changed) {
    Serial.printf("[CRED] Updated device auth in NVS: id='%s'\n", next.device_id.c_str());
  }
  return changed;
}
