#pragma once

// Release builds never contain shared credentials. New controllers receive
// per-device values in NVS from the authenticated USB enrollment workflow.
#ifndef LUCKY_BOOTSTRAP_WIFI_SSID
#define LUCKY_BOOTSTRAP_WIFI_SSID ""
#endif

#ifndef LUCKY_BOOTSTRAP_WIFI_PASSWORD
#define LUCKY_BOOTSTRAP_WIFI_PASSWORD ""
#endif

#ifndef LUCKY_BOOTSTRAP_API_KEY
#define LUCKY_BOOTSTRAP_API_KEY ""
#endif

#ifndef LUCKY_SETUP_AP_ENABLED
#define LUCKY_SETUP_AP_ENABLED 1
#endif

#ifndef LUCKY_SETUP_BUTTON_ENABLED
#define LUCKY_SETUP_BUTTON_ENABLED 0
#endif

#ifndef LUCKY_AUTOMATIC_WIFI_RECOVERY_ENABLED
#define LUCKY_AUTOMATIC_WIFI_RECOVERY_ENABLED 0
#endif
