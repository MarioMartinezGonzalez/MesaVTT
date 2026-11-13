(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Geo = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAU = Math.PI * 2;

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function normalizeAngle(angle) {
    let a = angle % TAU;
    if (a > Math.PI) a -= TAU;
    if (a < -Math.PI) a += TAU;
    return a;
  }

  // Casillas recorridas en 5e: la diagonal cuesta lo mismo que un lado.
  function gridUnits(dx, dy, cell) {
    if (!cell) return 0;
    return Math.max(Math.abs(dx), Math.abs(dy)) / cell;
  }

  function feetFromPixels(dx, dy, cell) {
    return gridUnits(dx, dy, cell) * 5;
  }

  function euclidFeet(dx, dy, cell) {
    if (!cell) return 0;
    return (Math.hypot(dx, dy) / cell) * 5;
  }

  function roundFeet(feet) {
    return Math.round(feet / 5) * 5;
  }

  function coneContains(px, py, ox, oy, angle, halfAngle, length) {
    const dx = px - ox;
    const dy = py - oy;
    const distance = Math.hypot(dx, dy);
    if (distance > length) return false;
    if (distance < 1e-6) return true;
    return Math.abs(normalizeAngle(Math.atan2(dy, dx) - angle)) <= halfAngle;
  }

  function circleContains(px, py, ox, oy, radius) {
    return Math.hypot(px - ox, py - oy) <= radius;
  }

  function snapToCellCenter(x, y, cell, offsetX, offsetY) {
    if (!cell) return { x, y };
    return {
      x: offsetX + (Math.floor((x - offsetX) / cell) + 0.5) * cell,
      y: offsetY + (Math.floor((y - offsetY) / cell) + 0.5) * cell,
    };
  }

  return {
    TAU,
    clamp,
    normalizeAngle,
    gridUnits,
    feetFromPixels,
    euclidFeet,
    roundFeet,
    coneContains,
    circleContains,
    snapToCellCenter,
  };
});
