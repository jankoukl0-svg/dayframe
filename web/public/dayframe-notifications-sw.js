self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.length > 0) {
      await windows[0].focus();
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(self.registration.scope);
  })());
});
