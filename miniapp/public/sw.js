// Service worker of the web app: shows Web Push messages and opens the app on tap. No caching.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { /* plain text */ }
  e.waitUntil(self.registration.showNotification(d.title || "Life", { body: d.body || "", icon: "icon-180.png", tag: "life-" + Date.now() }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow("./"))));
});
self.addEventListener("pushsubscriptionchange", (e) => {
  // The browser rotated the subscription: tell any open window to subscribe again.
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => cs.forEach((c) => c.postMessage({ resubscribe: true }))));
});
