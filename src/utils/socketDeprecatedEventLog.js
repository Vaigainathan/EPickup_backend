function resolveAppVersion(socket, data = {}) {
  return (
    data.appVersion ||
    socket?.appVersion ||
    socket?.handshake?.auth?.appVersion ||
    socket?.handshake?.headers?.['x-app-version'] ||
    null
  );
}

function logBlockedSocketEvent(socket, eventName, data = {}) {
  const payload = {
    event: eventName,
    userId: socket?.userId ?? null,
    userType: socket?.userType ?? null,
    appVersion: resolveAppVersion(socket, data),
    timestamp: new Date().toISOString()
  };
  console.warn('[SOCKET_DEPRECATED_EVENT_BLOCKED]', JSON.stringify(payload));
  return payload;
}

function blockDeprecatedSocketEvent(socket, eventName, errorPayload, data = {}) {
  logBlockedSocketEvent(socket, eventName, data);
  socket.emit('error', errorPayload);
}

module.exports = {
  resolveAppVersion,
  logBlockedSocketEvent,
  blockDeprecatedSocketEvent
};
