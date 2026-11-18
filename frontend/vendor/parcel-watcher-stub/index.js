'use strict';
// Stub inerte de @parcel/watcher (ver package.json). Sin dependencias.
const off = async () => {};
module.exports = {
  subscribe: async () => ({ unsubscribe: off }),
  unsubscribe: off,
  getEventsSince: async () => [],
  writeSnapshot: async () => '',
};
