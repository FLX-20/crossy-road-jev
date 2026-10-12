const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = { score: $('score'), top: $('top'), coins: $('coins'), badge: $('badge') };
    this.shown = {};
  }

  set(key, text) {
    if (this.shown[key] !== text) {
      this.shown[key] = text;
      this.el[key].textContent = text;
    }
  }

  update(score, top, coins) {
    this.set('score', String(score));
    this.set('top', `TOP ${top}`);
    this.set('coins', String(coins));
  }

  badge(text) {
    this.el.badge.classList.toggle('hidden', !text);
    if (text) this.set('badge', text);
  }
}
