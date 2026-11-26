export const environment = {
  production: true,
  // The same Worker serves the app and the /parties/* WebSocket, so connect to the page's own host.
  partyHost: location.host,
};
