#pragma once

#include <Arduino.h>
#include <Wire.h>

struct Ens160Reading {
  bool valid = false;
  uint8_t ubaAqi = 0;      // Raw UBA 1..5
  int16_t aqi500 = 0;      // Mapped 0..500 (25,75,150,250,400)
  uint16_t tvocPpb = 0;
  uint16_t eco2Ppm = 0;
  uint8_t validity = 3;    // 0=normal, 1=warmup, 2=startup, 3=invalid
};

class Ens160Driver {
 public:
  bool begin(TwoWire& wire, uint8_t addr);
  void setCompensation(float tempC, float rhPct);
  bool read(Ens160Reading& out);

  bool isDetected() const { return _detected; }
  uint8_t address() const { return _addr; }
  uint8_t lastValidity() const { return _lastReading.validity; }

 private:
  TwoWire* _wire = nullptr;
  uint8_t _addr = 0;
  bool _detected = false;
  bool _hasCached = false;
  Ens160Reading _lastReading;
  uint32_t _lastValidMs = 0;

  bool writeReg8(uint8_t reg, uint8_t val);
  bool writeReg16LE(uint8_t reg, uint16_t val);
  bool readRegs(uint8_t reg, uint8_t* buf, size_t len);
};
