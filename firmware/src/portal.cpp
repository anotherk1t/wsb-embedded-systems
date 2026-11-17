#include "portal.h"

#include <ArduinoJson.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include "config.h"
#include "settings.h"

namespace {

enum PortalCmd : uint8_t {
  CMD_NONE = 0,
  CMD_START = 1,
  CMD_STOP = 2
};

struct ScannedNet {
  char ssid[33];
  int32_t rssi;
  bool secured;
};

constexpr size_t MAX_SCANNED_NETS = 14;
constexpr uint32_t CONNECT_TEST_WINDOW_MS = 15000UL;
constexpr uint32_t AP_CLOSE_DELAY_MS = 2500UL;

std::atomic<bool> s_active{false};
std::atomic<uint8_t> s_pendingCmd{CMD_NONE};
std::atomic<bool> s_credentialsSaved{false};

// Owned exclusively by Core 0 (netTaskFn) inside portalUpdate()
DNSServer s_dns;
WebServer s_web(80);
bool s_routesRegistered = false;
bool s_serverRunning = false;
bool s_stopAfterSend = false;
uint32_t s_stopAtMs = 0;

bool s_connectTestActive = false;
uint32_t s_connectStartMs = 0;
String s_connectSsid;

ScannedNet s_nets[MAX_SCANNED_NETS];
size_t s_netCount = 0;
bool s_scanInProgress = false;

String htmlEscape(const String& in) {
  String out;
  out.reserve(in.length() + 16);
  for (size_t i = 0; i < in.length(); ++i) {
    char c = in[i];
    switch (c) {
      case '&': out += F("&amp;"); break;
      case '<': out += F("&lt;"); break;
      case '>': out += F("&gt;"); break;
      case '"': out += F("&quot;"); break;
      case '\'': out += F("&#39;"); break;
      default: out += c; break;
    }
  }
  return out;
}

String urlEncode(const String& in) {
  static const char kHex[] = "0123456789ABCDEF";
  String out;
  out.reserve(in.length() * 2);
  for (size_t i = 0; i < in.length(); ++i) {
    uint8_t c = static_cast<uint8_t>(in[i]);
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
        (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
      out += static_cast<char>(c);
    } else {
      out += '%';
      out += kHex[(c >> 4) & 0x0F];
      out += kHex[c & 0x0F];
    }
  }
  return out;
}

void startAsyncScan() {
  if (s_scanInProgress || s_connectTestActive) return;
  WiFi.scanDelete();
  int16_t res = WiFi.scanNetworks(true /* async */, false /* show_hidden */);
  if (res == WIFI_SCAN_RUNNING) {
    s_scanInProgress = true;
    Serial.println("[PORTAL] Started async Wi-Fi scan");
  } else if (res >= 0) {
    s_scanInProgress = false;
  } else {
    Serial.printf("[PORTAL] Wi-Fi scan start failed (%d)\n", res);
  }
}

void pollAsyncScan() {
  if (!s_scanInProgress) return;
  int16_t n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) return;

  s_scanInProgress = false;
  if (n < 0) {
    WiFi.scanDelete();
    Serial.printf("[PORTAL] Async Wi-Fi scan error (%d)\n", n);
    return;
  }

  s_netCount = 0;
  for (int16_t i = 0; i < n; ++i) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0 || ssid.length() > 32) continue;
    int32_t rssi = WiFi.RSSI(i);
    bool secured = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);

    bool found = false;
    for (size_t j = 0; j < s_netCount; ++j) {
      if (ssid == s_nets[j].ssid) {
        if (rssi > s_nets[j].rssi) {
          s_nets[j].rssi = rssi;
          s_nets[j].secured = secured;
        }
        found = true;
        break;
      }
    }
    if (found) continue;

    if (s_netCount < MAX_SCANNED_NETS) {
      snprintf(s_nets[s_netCount].ssid, sizeof(s_nets[s_netCount].ssid), "%s", ssid.c_str());
      s_nets[s_netCount].rssi = rssi;
      s_nets[s_netCount].secured = secured;
      ++s_netCount;
    } else {
      size_t minIdx = 0;
      for (size_t j = 1; j < s_netCount; ++j) {
        if (s_nets[j].rssi < s_nets[minIdx].rssi) minIdx = j;
      }
      if (rssi > s_nets[minIdx].rssi) {
        snprintf(s_nets[minIdx].ssid, sizeof(s_nets[minIdx].ssid), "%s", ssid.c_str());
        s_nets[minIdx].rssi = rssi;
        s_nets[minIdx].secured = secured;
      }
    }
  }

  for (size_t i = 0; i + 1 < s_netCount; ++i) {
    for (size_t j = i + 1; j < s_netCount; ++j) {
      if (s_nets[j].rssi > s_nets[i].rssi) {
        ScannedNet tmp = s_nets[i];
        s_nets[i] = s_nets[j];
        s_nets[j] = tmp;
      }
    }
  }

  WiFi.scanDelete();
  Serial.printf("[PORTAL] Cached %u unique 2.4GHz networks\n", static_cast<unsigned>(s_netCount));
}

const char kPageCss[] PROGMEM =
    "<style>"
    "*{box-sizing:border-box;margin:0;padding:0}"
    "body{background:#fff;color:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.45;padding:0 0 28px}"
    ".bar{background:#0066ff;color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center}"
    ".bar h1{font-size:16px;font-weight:700;letter-spacing:.02em}"
    ".bar span{font-size:12px;opacity:.95;font-family:ui-monospace,monospace}"
    ".wrap{max-width:460px;margin:0 auto;padding:16px}"
    ".card{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:16px;margin-bottom:14px}"
    ".head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}"
    ".head h2{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#52525b}"
    ".btn-sm{background:#f4f4f5;color:#09090b;border:1px solid #e4e4e7;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none}"
    ".nets{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto}"
    ".net{display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left;background:#fff;border:1px solid #e4e4e7;border-radius:9px;padding:10px 12px;cursor:pointer;color:#09090b;font-size:14px}"
    ".net:hover,.net.sel{border-color:#0066ff;background:#f4f4f5}"
    ".net-meta{font-size:12px;color:#52525b;white-space:nowrap;margin-left:8px}"
    ".empty{color:#52525b;font-size:13px;padding:8px 0}"
    "label{display:block;font-size:12px;font-weight:600;color:#52525b;margin:12px 0 5px}"
    "label:first-of-type{margin-top:0}"
    "input{width:100%;padding:11px 12px;border:1px solid #d4d4d8;border-radius:9px;font-size:15px;color:#09090b;background:#fff}"
    "input:focus{outline:none;border-color:#0066ff;box-shadow:0 0 0 3px rgba(0,102,255,.15)}"
    ".pw-row{display:flex;gap:8px;align-items:center}"
    ".pw-row input{flex:1}"
    ".btn{display:block;width:100%;margin-top:16px;padding:12px 16px;background:#0066ff;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;text-align:center;text-decoration:none;cursor:pointer}"
    ".btn:active{background:#0052cc}"
    ".meta{font-size:12px;color:#52525b;margin-top:10px;font-family:ui-monospace,monospace}"
    ".toast{background:#0066ff;color:#fff;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:14px;font-weight:700}"
    ".err{background:#f4f4f5;border:1px solid #09090b;color:#09090b;border-radius:10px;padding:12px;margin-bottom:14px;font-size:14px}"
    ".hide{display:none}"
    ".spin{display:inline-block;width:14px;height:14px;border:2px solid #e4e4e7;border-top-color:#0066ff;border-radius:50%;vertical-align:-2px;margin-right:8px;animation:sp .8s linear infinite}"
    "@keyframes sp{to{transform:rotate(360deg)}}"
    "</style>";

void handleRoot() {
  if (s_web.arg("rescan") == "1") {
    startAsyncScan();
  }
  pollAsyncScan();

  DeviceCredentials cred = settingsGetCredentials();
  String mac = WiFi.macAddress();

  String html;
  html.reserve(4096);
  html += F("<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>WSB Merito Wi-Fi Setup</title>");
  html += FPSTR(kPageCss);
  html += F("</head><body>"
            "<div class='bar'><h1>WSB MERITO</h1><span>");
  html += htmlEscape(mac);
  html += F("</span></div><div class='wrap'>"
            "<div class='card'><div class='head'><h2>2.4 GHz Wi-Fi Networks</h2>"
            "<button type='button' class='btn-sm' id='scanBtn' onclick='rescan()'>Rescan</button></div>"
            "<div class='nets' id='nets'>");

  if (s_netCount == 0) {
    html += F("<div class='empty'>");
    html += s_scanInProgress ? F("Scanning nearby 2.4 GHz networks...")
                             : F("No networks cached yet. Tap Rescan or type SSID below.");
    html += F("</div>");
  } else {
    for (size_t i = 0; i < s_netCount; ++i) {
      String escSsid = htmlEscape(String(s_nets[i].ssid));
      html += F("<button type='button' class='net' data-ssid='");
      html += escSsid;
      html += F("' onclick='pickNet(this)'><span>");
      html += escSsid;
      html += F("</span><span class='net-meta'>");
      html += s_nets[i].secured ? F("WPA2 ") : F("Open ");
      html += String(s_nets[i].rssi);
      html += F("dBm</span></button>");
    }
  }

  html += F("</div></div>"
            "<div class='card'><form method='POST' action='/save'>"
            "<label for='ssid'>Wi-Fi Network (SSID)</label>"
            "<input id='ssid' name='ssid' required maxlength='32' autocomplete='off' placeholder='Tap network above or type SSID' value='");
  html += htmlEscape(cred.wifi_ssid);
  html += F("'>"
            "<label for='pass'>Wi-Fi Password</label>"
            "<div class='pw-row'><input id='pass' name='pass' type='password' maxlength='63' autocomplete='off' placeholder='Password (blank if open)'>"
            "<button type='button' class='btn-sm' onclick='togglePw()'>Show</button></div>"
            "<label for='device_id'>Device ID (optional)</label>"
            "<input id='device_id' name='device_id' maxlength='32' autocomplete='off' placeholder='cyd-01' value='");
  html += htmlEscape(cred.device_id);
  html += F("'>"
            "<button type='submit' class='btn'>Save &amp; Connect</button>"
            "<div class='meta'>FW ");
  html += F(FW_VERSION);
  html += F(" &middot; AP 192.168.4.1</div>"
            "</form></div></div>"
            "<script>"
            "function pickNet(b){"
            "var s=b.getAttribute('data-ssid');"
            "document.getElementById('ssid').value=s;"
            "var els=document.querySelectorAll('.net');"
            "for(var i=0;i<els.length;i++)els[i].classList.remove('sel');"
            "b.classList.add('sel');"
            "document.getElementById('pass').focus();"
            "}"
            "function togglePw(){"
            "var p=document.getElementById('pass');"
            "p.type=(p.type==='password')?'text':'password';"
            "}"
            "function renderNets(d){"
            "var c=document.getElementById('nets');"
            "if(!d||!d.nets||!d.nets.length){"
            "c.innerHTML=\"<div class='empty'>\"+(d&&d.scanning?'Scanning nearby 2.4 GHz networks...':'No networks found. Tap Rescan.')+\"</div>\";return;}"
            "c.innerHTML='';"
            "for(var j=0;j<d.nets.length;j++){"
            "var m=d.nets[j];"
            "var b=document.createElement('button');b.type='button';b.className='net';"
            "b.setAttribute('data-ssid',m.ssid);b.onclick=function(){pickNet(this);};"
            "var a=document.createElement('span');a.textContent=m.ssid;"
            "var k=document.createElement('span');k.className='net-meta';"
            "k.textContent=(m.secured?'WPA2 ':'Open ')+m.rssi+'dBm';"
            "b.appendChild(a);b.appendChild(k);c.appendChild(b);"
            "}"
            "}"
            "function pollScan(n){"
            "fetch('/scan').then(function(r){return r.json();}).then(function(d){"
            "renderNets(d);"
            "if(d.scanning&&n<10){setTimeout(function(){pollScan(n+1);},600);}"
            "else{document.getElementById('scanBtn').textContent='Rescan';}"
            "}).catch(function(){document.getElementById('scanBtn').textContent='Rescan';});"
            "}"
            "function rescan(){"
            "document.getElementById('scanBtn').textContent='Scanning...';"
            "fetch('/scan?start=1').then(function(){setTimeout(function(){pollScan(0);},500);})"
            ".catch(function(){location.href='/?rescan=1';});"
            "}"
            "</script></body></html>");

  s_web.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  s_web.send(200, "text/html; charset=utf-8", html);
}

void handleScanJson() {
  if (s_web.arg("start") == "1") {
    startAsyncScan();
  }
  pollAsyncScan();

  JsonDocument doc;
  doc["scanning"] = s_scanInProgress;
  JsonArray arr = doc["nets"].to<JsonArray>();
  for (size_t i = 0; i < s_netCount; ++i) {
    JsonObject obj = arr.add<JsonObject>();
    obj["ssid"] = s_nets[i].ssid;
    obj["rssi"] = s_nets[i].rssi;
    obj["secured"] = s_nets[i].secured;
  }

  String json;
  serializeJson(doc, json);
  s_web.sendHeader("Cache-Control", "no-store");
  s_web.send(200, "application/json", json);
}

void handleConnectStatus() {
  bool connected = (WiFi.status() == WL_CONNECTED);
  int status = static_cast<int>(WiFi.status());
  String ip = connected ? WiFi.localIP().toString() : String("0.0.0.0");

  if (connected && s_connectTestActive && !s_stopAfterSend) {
    s_connectTestActive = false;
    s_credentialsSaved.store(true);
    s_stopAfterSend = true;
    s_stopAtMs = millis() + AP_CLOSE_DELAY_MS;
    Serial.printf("[PORTAL] Router connected (IP %s); closing SoftAP in 2.5s\n", ip.c_str());
  }

  JsonDocument doc;
  doc["connected"] = connected;
  doc["status"] = status;
  doc["ip"] = ip;

  String json;
  serializeJson(doc, json);
  s_web.sendHeader("Cache-Control", "no-store");
  s_web.send(200, "application/json", json);
}

void handleSave() {
  String ssid = s_web.arg("ssid");
  String pass = s_web.arg("pass");
  String devId = s_web.arg("device_id");
  devId.trim();

  if (ssid.length() == 0 || ssid.length() > 32 || pass.length() > 63 || devId.length() > 32) {
    String errHtml;
    errHtml += F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                 "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                 "<title>Setup Error</title>");
    errHtml += FPSTR(kPageCss);
    errHtml += F("</head><body><div class='bar'><h1>WSB MERITO</h1><span>Error</span></div>"
                 "<div class='wrap'><div class='err'>Please enter a valid Wi-Fi SSID (1-32 chars).</div>"
                 "<a class='btn' href='/'>Back to Setup</a></div></body></html>");
    s_web.send(400, "text/html; charset=utf-8", errHtml);
    return;
  }

  settingsSaveCredentials(ssid, pass, devId);
  DeviceCredentials cred = settingsGetCredentials();
  String dashUrl = String(DASHBOARD_BASE_URL) + "/?device=" + urlEncode(cred.device_id);

  // Cancel any scan, keep WIFI_AP_STA active, and begin STA association right away
  if (s_scanInProgress) {
    WiFi.scanDelete();
    s_scanInProgress = false;
  }
  WiFi.disconnect(false);
  WiFi.persistent(false);
  WiFi.setSleep(false);
  WiFi.setScanMethod(WIFI_ALL_CHANNEL_SCAN);
  WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);
  WiFi.begin(ssid.c_str(), pass.c_str());

  s_connectTestActive = true;
  s_connectStartMs = millis();
  s_stopAfterSend = false;
  s_connectSsid = ssid;
  Serial.printf("[PORTAL] Testing Wi-Fi connection to '%s' (WIFI_AP_STA)...\n", ssid.c_str());

  String escSsid = htmlEscape(cred.wifi_ssid);
  String html;
  html.reserve(2800);
  html += F("<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>Connecting Wi-Fi</title>");
  html += FPSTR(kPageCss);
  html += F("</head><body>"
            "<div class='bar'><h1>WSB MERITO</h1><span>");
  html += htmlEscape(cred.device_id);
  html += F("</span></div><div class='wrap'>"
            "<div id='st-wait' class='card'>"
            "<p style='font-weight:700;margin-bottom:8px'><span class='spin'></span>Connecting to ");
  html += escSsid;
  html += F("</p>"
            "<p style='color:#52525b;font-size:14px'>Testing router connection (<span id='sec'>0</span>s / 15s)...</p>"
            "</div>"
            "<div id='st-ok' class='hide'>"
            "<div id='ok-toast' class='toast'>Connected!</div>"
            "<div class='card'>"
            "<p style='margin-bottom:8px'><strong>Wi-Fi:</strong> ");
  html += escSsid;
  html += F("</p><p style='margin-bottom:10px'><strong>Device ID:</strong> ");
  html += htmlEscape(cred.device_id);
  html += F("</p><p style='color:#52525b;font-size:14px'>"
            "Setup Wi-Fi will close in a moment. Rejoin your router or cellular data, then open the telemetry dashboard:"
            "</p>"
            "<a class='btn' href='");
  html += htmlEscape(dashUrl);
  html += F("'>Open Telemetry Dashboard</a>"
            "<div class='meta'>");
  html += htmlEscape(dashUrl);
  html += F("</div></div></div>"
            "<div id='st-err' class='hide'>"
            "<div class='err'>Could not connect to '");
  html += escSsid;
  html += F("'. Please check the password (must be a 2.4 GHz network) and try again.</div>"
            "<a class='btn' href='/'>Back to Wi-Fi Setup</a>"
            "</div></div>"
            "<script>"
            "var ticks=0,done=false;"
            "function showOk(ip){"
            "done=true;"
            "document.getElementById('st-wait').className='hide';"
            "document.getElementById('ok-toast').textContent='Connected! IP: '+ip;"
            "document.getElementById('st-ok').className='';"
            "}"
            "function showErr(){"
            "done=true;"
            "document.getElementById('st-wait').className='hide';"
            "document.getElementById('st-err').className='';"
            "}"
            "function poll(){"
            "if(done)return;"
            "ticks++;"
            "document.getElementById('sec').textContent=ticks;"
            "fetch('/connect-status').then(function(r){return r.json();}).then(function(d){"
            "if(d&&d.connected){showOk(d.ip||'');return;}"
            "if(ticks>=15){showErr();return;}"
            "setTimeout(poll,1000);"
            "}).catch(function(){"
            "if(ticks>=15){showErr();return;}"
            "setTimeout(poll,1000);"
            "});"
            "}"
            "setTimeout(poll,1000);"
            "</script></body></html>");

  s_web.sendHeader("Cache-Control", "no-store");
  s_web.send(200, "text/html; charset=utf-8", html);
}

void handleCaptiveRedirect() {
  if (s_web.hostHeader() != F("192.168.4.1")) {
    s_web.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    s_web.sendHeader("Location", "http://192.168.4.1/", true);
    s_web.send(302, "text/plain", "");
    return;
  }
  handleRoot();
}

void registerRoutesOnce() {
  if (s_routesRegistered) return;
  s_routesRegistered = true;

  s_web.on("/", HTTP_GET, handleRoot);
  s_web.on("/scan", HTTP_GET, handleScanJson);
  s_web.on("/connect-status", HTTP_GET, handleConnectStatus);
  s_web.on("/save", HTTP_POST, handleSave);

  // Common OS captive-portal probes
  s_web.on("/generate_204", HTTP_GET, handleCaptiveRedirect);
  s_web.on("/gen_204", HTTP_GET, handleCaptiveRedirect);
  s_web.on("/hotspot-detect.html", HTTP_GET, handleCaptiveRedirect);
  s_web.on("/library/test/success.html", HTTP_GET, handleCaptiveRedirect);
  s_web.on("/connecttest.txt", HTTP_GET, handleCaptiveRedirect);
  s_web.on("/ncsi.txt", HTTP_GET, handleCaptiveRedirect);
  s_web.on("/redirect", HTTP_GET, handleCaptiveRedirect);
  s_web.on("/canonical.html", HTTP_GET, handleCaptiveRedirect);
  s_web.on("/success.txt", HTTP_GET, handleCaptiveRedirect);
  s_web.on("/fwlink", HTTP_GET, handleCaptiveRedirect);
  s_web.onNotFound(handleCaptiveRedirect);
}

void beginApInternal() {
  if (s_serverRunning) {
    startAsyncScan();
    return;
  }

  registerRoutesOnce();

  WiFi.persistent(false);
  WiFi.setSleep(false);
  WiFi.disconnect(false);
  vTaskDelay(pdMS_TO_TICKS(50));
  WiFi.mode(WIFI_AP_STA);
  vTaskDelay(pdMS_TO_TICKS(50));

  IPAddress apIp(192, 168, 4, 1);
  IPAddress netMask(255, 255, 255, 0);
  WiFi.softAP(AP_SETUP_SSID, AP_SETUP_PASS);
  vTaskDelay(pdMS_TO_TICKS(50));
  WiFi.softAPConfig(apIp, apIp, netMask);

  s_dns.setErrorReplyCode(DNSReplyCode::NoError);
  s_dns.start(53, "*", apIp);
  s_web.begin();

  s_serverRunning = true;
  s_stopAfterSend = false;
  s_connectTestActive = false;
  s_active.store(true);

  Serial.printf("[PORTAL] SoftAP '%s' started at %s\n",
                AP_SETUP_SSID, WiFi.softAPIP().toString().c_str());

  startAsyncScan();
}

void endApInternal() {
  if (s_serverRunning) {
    s_web.stop();
    s_dns.stop();
    s_serverRunning = false;
  }
  if (s_scanInProgress) {
    WiFi.scanDelete();
    s_scanInProgress = false;
  }
  s_stopAfterSend = false;
  s_connectTestActive = false;

  WiFi.softAPdisconnect(true);
  vTaskDelay(pdMS_TO_TICKS(50));
  WiFi.mode(WIFI_STA);
  s_active.store(false);
  Serial.println("[PORTAL] SoftAP stopped -> WIFI_STA");
}

}  // namespace

void portalInit() {
  s_active.store(false);
  s_pendingCmd.store(CMD_NONE);
  s_credentialsSaved.store(false);
}

void portalStart() {
  s_active.store(true);
  s_pendingCmd.store(CMD_START);
}

void portalStop() {
  s_active.store(false);
  s_pendingCmd.store(CMD_STOP);
}

bool portalIsActive() {
  return s_active.load();
}

void portalUpdate() {
  uint8_t cmd = s_pendingCmd.exchange(CMD_NONE);
  if (cmd == CMD_START) {
    beginApInternal();
  } else if (cmd == CMD_STOP) {
    endApInternal();
  }

  if (!s_serverRunning) return;

  s_dns.processNextRequest();
  s_web.handleClient();
  pollAsyncScan();

  if (s_connectTestActive) {
    uint32_t elapsed = millis() - s_connectStartMs;
    if (WiFi.status() == WL_CONNECTED) {
      if (!s_stopAfterSend && elapsed >= CONNECT_TEST_WINDOW_MS) {
        s_connectTestActive = false;
        s_credentialsSaved.store(true);
        s_stopAfterSend = true;
        s_stopAtMs = millis() + AP_CLOSE_DELAY_MS;
      }
    } else if (elapsed >= (CONNECT_TEST_WINDOW_MS + 1500UL)) {
      s_connectTestActive = false;
      WiFi.disconnect(false);
      Serial.printf("[PORTAL] Wi-Fi connection test timed out for '%s'\n",
                    s_connectSsid.c_str());
    }
  }

  if (s_stopAfterSend && static_cast<int32_t>(millis() - s_stopAtMs) >= 0) {
    endApInternal();
  }
}

bool portalConsumeCredentialsSaved() {
  return s_credentialsSaved.exchange(false);
}
