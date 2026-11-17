#include "power.h"

#include <WiFi.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "config.h"
#include "net.h"
#include "portal.h"

namespace {

constexpr uint8_t BL_LEDC_CH = 0;
constexpr uint8_t LED_R_CH = 1;
constexpr uint8_t LED_G_CH = 2;
constexpr uint8_t LED_B_CH = 3;
constexpr uint32_t PWM_FREQ_HZ = 5000;
constexpr uint8_t PWM_RES_BITS = 8;

enum LedOverrideMode : uint8_t {
  LED_OVR_AUTO = 0,
  LED_OVR_BLUE = 1,
  LED_OVR_GREEN = 2,
  LED_OVR_RED = 3,
  LED_OVR_OFF = 4
};

SemaphoreHandle_t s_pwrMutex = nullptr;
std::atomic<uint8_t> s_ledOverride{LED_OVR_AUTO};

ScreenState s_screenState = SCREEN_ACTIVE;
ScreenState s_appliedScreenState = SCREEN_ACTIVE;
int8_t s_forcedScreenState = -1;  // -1 = auto timeouts, else ScreenState
uint32_t s_lastTouchMs = 0;
uint32_t s_lastLdrPollMs = 0;
float s_ldrSmoothed = 1000.0f;
bool s_ldrInitialized = false;
uint8_t s_currentBlDuty = 200;
uint8_t s_appliedBlDuty = 200;

uint32_t s_lastSendSeq = 0;
uint32_t s_blueBlinkUntilMs = 0;

void writeRgbLed(uint8_t r, uint8_t g, uint8_t b) {
  // Active-LOW LEDs: 255 triggers esp32-hal-ledc full HIGH (100% duty = OFF)
  ledcWrite(LED_R_CH, static_cast<uint32_t>(255 - r));
  ledcWrite(LED_G_CH, static_cast<uint32_t>(255 - g));
  ledcWrite(LED_B_CH, static_cast<uint32_t>(255 - b));
}

uint16_t sampleLdrAverage() {
  uint32_t sum = 0;
  for (int i = 0; i < 8; ++i) {
    sum += static_cast<uint32_t>(analogRead(PIN_LDR));
  }
  return static_cast<uint16_t>(sum / 8);
}

uint8_t computeActiveBrightnessLocked(const DeviceConfig& cfg) {
  uint8_t base = cfg.display_brightness;
  if (!cfg.auto_brightness || base == 0) {
    return base;
  }

  // CYD LDR reads higher raw ADC values in darkness
  float raw = constrain(s_ldrSmoothed, static_cast<float>(LDR_BRIGHT_RAW),
                        static_cast<float>(LDR_DARK_RAW));
  float t = (raw - static_cast<float>(LDR_BRIGHT_RAW)) /
            static_cast<float>(LDR_DARK_RAW - LDR_BRIGHT_RAW);
  // Scale between 100% in bright light and 20% in darkness
  float scale = 1.0f - (0.80f * t);
  int scaled = lroundf(static_cast<float>(base) * scale);
  int minActive = min<int>(base, 20);
  return static_cast<uint8_t>(constrain(scaled, minActive, 255));
}

uint8_t computeTargetBrightnessLocked(const DeviceConfig& cfg, ScreenState st) {
  if (st == SCREEN_ACTIVE) {
    return computeActiveBrightnessLocked(cfg);
  }
  if (st == SCREEN_DIM) {
    uint8_t active = computeActiveBrightnessLocked(cfg);
    return (active == 0) ? 0 : static_cast<uint8_t>(max<int>(12, active / 10));
  }
  return 0;
}

void applyHardwareScreenMode(ScreenState nextState) {
  if (nextState == s_appliedScreenState) return;

  if (nextState == SCREEN_OFF) {
    Serial.println("[PWR] Screen OFF -> WiFi modem sleep + 80 MHz CPU");
    WiFi.setSleep(true);
    setCpuFrequencyMhz(80);
  } else if (s_appliedScreenState == SCREEN_OFF) {
    setCpuFrequencyMhz(240);
    WiFi.setSleep(false);
    Serial.println("[PWR] Screen WAKE -> 240 MHz CPU + active WiFi");
  }
  s_appliedScreenState = nextState;
}

}  // namespace

void powerInit(const DeviceConfig& cfg) {
  if (!s_pwrMutex) {
    s_pwrMutex = xSemaphoreCreateMutex();
  }

  setCpuFrequencyMhz(240);

  // Backlight PWM
  ledcSetup(BL_LEDC_CH, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcAttachPin(PIN_TFT_BL, BL_LEDC_CH);
  s_currentBlDuty = cfg.display_brightness;
  s_appliedBlDuty = s_currentBlDuty;
  ledcWrite(BL_LEDC_CH, s_appliedBlDuty);

  // RGB LED PWM (active LOW)
  ledcSetup(LED_R_CH, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcSetup(LED_G_CH, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcSetup(LED_B_CH, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcAttachPin(PIN_LED_R, LED_R_CH);
  ledcAttachPin(PIN_LED_G, LED_G_CH);
  ledcAttachPin(PIN_LED_B, LED_B_CH);
  writeRgbLed(0, 0, 0);

  // LDR ADC
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_LDR, ADC_11db);
  s_ldrSmoothed = static_cast<float>(sampleLdrAverage());
  s_ldrInitialized = true;

  s_lastTouchMs = millis();
  s_screenState = SCREEN_ACTIVE;
  s_appliedScreenState = SCREEN_ACTIVE;
  s_forcedScreenState = -1;
}

void powerUpdate(const DeviceConfig& cfg,
                 bool wifiConnected,
                 bool mqttConnected,
                 bool httpHealthy,
                 uint32_t sendPulseSeq) {
  uint32_t now = millis();
  bool stateChanged = false;
  ScreenState activeState = SCREEN_ACTIVE;
  uint8_t nextBl = 0;

  // Sample LDR outside mutex if awake
  ScreenState curState = powerGetScreenState();
  bool haveSample = false;
  float sample = 0.0f;
  if (curState != SCREEN_OFF && (now - s_lastLdrPollMs) >= LDR_POLL_MS) {
    s_lastLdrPollMs = now;
    sample = static_cast<float>(sampleLdrAverage());
    haveSample = true;
  }

  if (s_pwrMutex) {
    xSemaphoreTake(s_pwrMutex, portMAX_DELAY);
  }

  if (haveSample) {
    if (!s_ldrInitialized) {
      s_ldrSmoothed = sample;
      s_ldrInitialized = true;
    } else {
      s_ldrSmoothed = 0.85f * s_ldrSmoothed + 0.15f * sample;
    }
  }

  bool apActive = portalIsActive();
  ScreenState desiredState = s_screenState;
  if (s_forcedScreenState >= 0) {
    desiredState = static_cast<ScreenState>(s_forcedScreenState);
  } else if (apActive) {
    s_lastTouchMs = now;
    desiredState = SCREEN_ACTIVE;
  } else {
    uint32_t idleMs = now - s_lastTouchMs;
    if (cfg.screen_off_s > 0 && idleMs >= static_cast<uint32_t>(cfg.screen_off_s) * 1000UL) {
      desiredState = SCREEN_OFF;
    } else if (cfg.screen_dim_s > 0 && idleMs >= static_cast<uint32_t>(cfg.screen_dim_s) * 1000UL) {
      desiredState = SCREEN_DIM;
    } else {
      desiredState = SCREEN_ACTIVE;
    }
  }

  if (desiredState != s_screenState) {
    s_screenState = desiredState;
    stateChanged = true;
  }
  activeState = s_screenState;

  uint8_t targetBl = computeTargetBrightnessLocked(cfg, activeState);
  if (targetBl != s_currentBlDuty) {
    if (targetBl == 0 || targetBl > s_currentBlDuty) {
      s_currentBlDuty = targetBl;
    } else {
      int diff = static_cast<int>(s_currentBlDuty) - static_cast<int>(targetBl);
      s_currentBlDuty = static_cast<uint8_t>(s_currentBlDuty - max(1, diff / 4));
    }
  }
  nextBl = s_currentBlDuty;

  if (s_pwrMutex) {
    xSemaphoreGive(s_pwrMutex);
  }

  applyHardwareScreenMode(activeState);
  if (nextBl != s_appliedBlDuty) {
    s_appliedBlDuty = nextBl;
    ledcWrite(BL_LEDC_CH, s_appliedBlDuty);
  }
  if (stateChanged) {
    netRequestStatusPublish();
  }

  if (sendPulseSeq != s_lastSendSeq) {
    s_lastSendSeq = sendPulseSeq;
    s_blueBlinkUntilMs = now + 120UL;
  }

  // Respect remote RGB LED override before falling back to automatic mode
  uint8_t ovr = s_ledOverride.load();
  if (ovr == LED_OVR_BLUE) {
    writeRgbLed(0, 0, 230);
    return;
  }
  if (ovr == LED_OVR_GREEN) {
    writeRgbLed(0, 180, 0);
    return;
  }
  if (ovr == LED_OVR_RED) {
    writeRgbLed(180, 0, 0);
    return;
  }
  if (ovr == LED_OVR_OFF) {
    writeRgbLed(0, 0, 0);
    return;
  }

  // Automatic RGB LED status: bright blue on send, Merito Blue online, pulsing AP, red offline
  if (static_cast<int32_t>(s_blueBlinkUntilMs - now) > 0) {
    writeRgbLed(0, 0, 255);
  } else if (apActive) {
    uint32_t phase = now % 1600UL;
    uint8_t b = (phase < 800UL)
                    ? static_cast<uint8_t>((phase * 220UL) / 800UL)
                    : static_cast<uint8_t>(((1600UL - phase) * 220UL) / 800UL);
    writeRgbLed(0, 0, b);
  } else if (!wifiConnected || (!mqttConnected && !httpHealthy)) {
    if (activeState == SCREEN_OFF) {
      bool pulse = (now % 3000UL) < 150UL;
      writeRgbLed(pulse ? 120 : 0, 0, 0);
    } else {
      writeRgbLed(120, 0, 0);
    }
  } else {
    if (activeState == SCREEN_OFF) {
      bool pulse = (now % 5000UL) < 120UL;
      writeRgbLed(0, 0, pulse ? 200 : 0);
    } else {
      writeRgbLed(0, 0, 200);
    }
  }
}

bool powerNotifyTouch() {
  bool woke = false;
  if (s_pwrMutex) {
    xSemaphoreTake(s_pwrMutex, portMAX_DELAY);
  }
  s_lastTouchMs = millis();
  s_forcedScreenState = -1;
  if (s_screenState != SCREEN_ACTIVE) {
    s_screenState = SCREEN_ACTIVE;
    woke = true;
  }
  if (s_pwrMutex) {
    xSemaphoreGive(s_pwrMutex);
  }

  if (woke) {
    applyHardwareScreenMode(SCREEN_ACTIVE);
    netRequestStatusPublish();
  }
  return woke;
}

ScreenState powerGetScreenState() {
  if (!s_pwrMutex) return s_screenState;
  xSemaphoreTake(s_pwrMutex, portMAX_DELAY);
  ScreenState st = s_screenState;
  xSemaphoreGive(s_pwrMutex);
  return st;
}

bool powerIsScreenOff() {
  return powerGetScreenState() == SCREEN_OFF;
}

uint16_t powerGetLdrRaw() {
  if (!s_pwrMutex) return static_cast<uint16_t>(lroundf(s_ldrSmoothed));
  xSemaphoreTake(s_pwrMutex, portMAX_DELAY);
  uint16_t val = static_cast<uint16_t>(lroundf(s_ldrSmoothed));
  xSemaphoreGive(s_pwrMutex);
  return val;
}

uint8_t powerGetBacklightDuty() {
  if (!s_pwrMutex) return s_currentBlDuty;
  xSemaphoreTake(s_pwrMutex, portMAX_DELAY);
  uint8_t duty = s_currentBlDuty;
  xSemaphoreGive(s_pwrMutex);
  return duty;
}

void powerSetLedOverride(const char* mode) {
  uint8_t next = LED_OVR_AUTO;
  if (mode) {
    if (strcmp(mode, "blue") == 0) next = LED_OVR_BLUE;
    else if (strcmp(mode, "green") == 0) next = LED_OVR_GREEN;
    else if (strcmp(mode, "red") == 0) next = LED_OVR_RED;
    else if (strcmp(mode, "off") == 0) next = LED_OVR_OFF;
    else next = LED_OVR_AUTO;
  }
  s_ledOverride.store(next);
  Serial.printf("[PWR] LED override mode -> %s\n", powerGetLedMode());
}

const char* powerGetLedMode() {
  switch (s_ledOverride.load()) {
    case LED_OVR_BLUE: return "blue";
    case LED_OVR_GREEN: return "green";
    case LED_OVR_RED: return "red";
    case LED_OVR_OFF: return "off";
    default: return "auto";
  }
}

void powerSetRemoteScreenState(const char* state) {
  if (!state) return;
  DeviceConfig cfg = settingsGet();

  if (s_pwrMutex) {
    xSemaphoreTake(s_pwrMutex, portMAX_DELAY);
  }
  if (strcmp(state, "off") == 0) {
    s_forcedScreenState = SCREEN_OFF;
    s_screenState = SCREEN_OFF;
  } else if (strcmp(state, "dim") == 0) {
    s_forcedScreenState = SCREEN_DIM;
    s_screenState = SCREEN_DIM;
  } else {
    s_forcedScreenState = -1;
    s_lastTouchMs = millis();
    s_screenState = SCREEN_ACTIVE;
  }
  s_currentBlDuty = computeTargetBrightnessLocked(cfg, s_screenState);
  ScreenState resolved = s_screenState;
  uint8_t duty = s_currentBlDuty;
  if (s_pwrMutex) {
    xSemaphoreGive(s_pwrMutex);
  }

  Serial.printf("[PWR] Remote screen state -> %s (target duty=%u)\n",
                resolved == SCREEN_OFF ? "off" : (resolved == SCREEN_DIM ? "dim" : "active"),
                duty);
}
