# WatchTogether

A private two-person movie room with peer-to-peer video, chat, synchronized local playback, and an embedded shared web browser.

## Features
- PeerJS/WebRTC camera, microphone, screen share, and chat
- Synchronized playback for matching local video files
- Translucent camera/microphone status controls over both participant tiles
- Shared in-app browser powered by server-side Chromium; the browser page is rendered inside the app, not captured from either participant's desktop
- Two-participant browser rooms with shared navigation, click, scroll, and keyboard input
- Room-scoped ephemeral browser sessions; sessions close after the room becomes empty

## Run locally
```bash
npm install
npx playwright install chromium
npm start
```

## Deploy
Deploy the Dockerfile as a Render Web Service. Chromium needs a service plan with at least 2 GB RAM for reliable operation. Render supplies the `PORT` environment variable automatically.

## Browser safety
The browser backend allows public HTTP/HTTPS websites only and blocks localhost/private-network destinations. Browser sessions are ephemeral and are not persisted after a room expires. Avoid entering sensitive credentials in a room unless you trust the other participant.
