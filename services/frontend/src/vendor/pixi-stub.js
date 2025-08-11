// No-op stub for 'pixi.js' to prevent bundling of WebGL and shader code.
// Any import of 'pixi.js' will resolve to this file via Vite alias.
// Export minimal objects to avoid runtime errors if referenced accidentally.
export const Application = function() { return {}; };
export const Container = function() { return {}; };
export const Graphics = function() { return {}; };
export const Point = function(x, y) { this.x = x; this.y = y; };
export const Sprite = function() { return {}; };
export const Texture = { from: () => ({}) };
export default {};