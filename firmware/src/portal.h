#pragma once

#include <Arduino.h>

void portalInit();
void portalStart();
void portalStop();
bool portalIsActive();
void portalUpdate();
bool portalConsumeCredentialsSaved();
