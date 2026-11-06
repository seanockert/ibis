// Toss and gulp: the screen text. The score, the multiplier, the lives and the best at the top; words
// that pop up at the bill (Perfect, Bonk, the item swallowed); the title and the game over cards.
import { Vector3 } from 'three';

export class GulpHud {
  constructor(root, camera) {
    this.camera = camera;
    this.root = root;
    this.score = root.querySelector('.score');
    this.mult = root.querySelector('.mult');
    this.lives = root.querySelector('.lives');
    this.best = root.querySelector('.best');
    this.title = root.querySelector('.title');
    this.over = root.querySelector('.over');
    this.pops = root.querySelector('.pops');
    this.shown = {};
    this.p = new Vector3();
  }

  start() {
    this.title.hidden = true;
    this.over.hidden = true;
  }

  hurt() {
    this.lives.classList.remove('hurt');
    void this.lives.offsetWidth;   // restarts the animation
    this.lives.classList.add('hurt');
  }

  // Words that rise and fade at a world point. kind: perfect, good, bad, gulp.
  pop(text, at, kind) {
    const p = this.p.copy(at).project(this.camera);
    const el = document.createElement('div');
    el.className = 'pop ' + kind;
    el.textContent = text;
    el.style.left = `${(p.x * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-p.y * 0.5 + 0.5) * 100}%`;
    this.pops.append(el);
    setTimeout(() => el.remove(), 1100);
  }

  update(game) {
    this.set('score', game.score, () => { this.score.textContent = game.score; });
    this.set('mult', game.mult, () => {
      this.mult.textContent = `x${game.mult}`;
      this.mult.hidden = game.mult < 2;
      this.mult.classList.remove('bump');
      void this.mult.offsetWidth;
      this.mult.classList.add('bump');
    });
    this.set('lives', game.lives, () => { this.lives.textContent = '♥'.repeat(Math.max(game.lives, 0)) + '♡'.repeat(Math.max(3 - game.lives, 0)); });
    this.set('best', game.best, () => { this.best.textContent = `Best ${game.best}`; });
    const overShown = game.state === 'over' && game.time - game.overAt > 1.4;
    this.set('over', overShown, () => {
      this.over.hidden = !overShown;
      if (!overShown) return;
      this.over.querySelector('.final').textContent = game.score;
      this.over.querySelector('.note').textContent = game.newBest ? 'New best!' : `${game.eaten} swallowed. Best ${game.best}`;
    });
  }

  set(key, value, show) {
    if (this.shown[key] === value) return;
    this.shown[key] = value;
    show();
  }
}
