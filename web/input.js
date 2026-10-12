// Keyboard and touch input. Like the original, pressing squashes the chicken and releasing makes it hop.
// Touch: tap = forward, swipe = direction.

const KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};

export class Input {
  constructor(canvas, { onMove, onCharge, onKey }) {
    const held = new Set();
    const typing = (e) => e.target instanceof HTMLInputElement;
    window.addEventListener('keydown', (e) => {
      const dir = KEYS[e.code];
      if (!dir || typing(e)) return onKey(e);
      e.preventDefault();
      if (e.repeat || held.has(e.code)) return;
      held.add(e.code);
      onCharge(true);
    });
    window.addEventListener('keyup', (e) => {
      const dir = KEYS[e.code];
      if (!dir || typing(e) || !held.delete(e.code)) return;
      onMove(dir);
      onCharge(held.size > 0);
    });
    window.addEventListener('blur', () => {
      held.clear();
      onCharge(false);
    });

    let start = null;
    canvas.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY };
      onCharge(true);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      onCharge(false);
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) onMove('up');
      else if (Math.abs(dx) > Math.abs(dy)) onMove(dx > 0 ? 'right' : 'left');
      else onMove(dy > 0 ? 'down' : 'up');
    });
    canvas.addEventListener('pointercancel', () => {
      start = null;
      onCharge(false);
    });
  }
}
