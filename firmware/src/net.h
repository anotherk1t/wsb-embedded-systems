#pragma once

#include <Arduino.h>

struct NetStatus {
  bool wifiConnected = false;
  bool apActive = false;
  int16_t rssi = 0;
  char ip[20] = "0.0.0.0";
  char ssid[36] = "";
  char deviceId[36] = "";
  bool ntpSynced = false;
  bool mqttConnected = false;
  bool httpHealthy = false;
  bool bootConfigFetched = false;
  bool bootstrapOk = false;
  char pairUrl[128] = "";
  char claimCode[16] = "";
  uint32_t mqttSent = 0;
  uint32_t mqttFailed = 0;
  uint32_t httpSent = 0;
  uint32_t httpFailed = 0;
};

void netInit();
void netStartTask();
NetStatus netGetStatus();
bool netGetNtpEpochMs(int64_t& outEpochMs);
uint32_t netGetSendPulseSeq();
uint32_t netConsumePendingGpsBaud();
bool netConsumeForceSample();
void netRequestStatusPublish();
void netLogEvent(const char* level, const char* event, const char* detail);
