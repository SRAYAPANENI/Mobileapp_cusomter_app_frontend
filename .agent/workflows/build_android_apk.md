---
description: Build and install Android APK (Debug)
---

To build the debug APK and verify installation on the connected device:

1. Verify device connection
// turbo
2. Build and install the APK

```bash
adb devices
cd android
./gradlew installDebug
```
