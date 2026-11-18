'use strict';
// Stub inerte de @parcel/watcher (ver package.json). Sin dependencias.
// Asignaciones `exports.x` (no `module.exports = {}`) para que el analizador
// CJS de Node detecte cada export como named export desde ESM.
const off = async () => {};
exports.subscribe = async () => ({ unsubscribe: off });
exports.unsubscribe = off;
exports.getEventsSince = async () => [];
exports.writeSnapshot = async () => '';
