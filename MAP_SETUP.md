# Dashboard Map Setup

## Google Maps API Key Setup

To enable the map functionality on Android, you need to add your Google Maps API key:

### Steps:

1. **Get a Google Maps API Key**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable "Maps SDK for Android" and "Maps SDK for iOS"
   - Go to "Credentials" and create an API key
   - Restrict the API key to your app's package name for security

2. **Add the API Key**:
   - Open `app.json`
   - Replace `YOUR_GOOGLE_MAPS_API_KEY` with your actual API key in the Android config section

3. **Rebuild the app**:
   ```bash
   npx expo prebuild --clean
   npx expo run:android
   # or
   npx expo run:ios
   ```

## Features

- **Real-time Location**: Shows user's current location on the map
- **Service Providers**: Displays nearby service providers as black dots (similar to Uber/Ola)
- **Service Radius**: Yellow circle showing the service area
- **Post Requirement**: Bottom button to create new job requests
- **Created Jobs**: Quick access to view your posted jobs

## Testing

For development/testing, the map will work on:
- **iOS Simulator**: Works without API key
- **Android Emulator**: Requires Google Maps API key
- **Web**: Uses a fallback map provider

The app generates 8 mock service providers around your location for demonstration purposes.
