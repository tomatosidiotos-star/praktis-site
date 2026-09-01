/* Orbit scroll animation, modeled on the reference (onewhale.io, 4th
   screen): every card sits at the exact same spot at scroll start, so
   perfect overlap alone makes the whole stack read as a single card —
   no opacity fade anywhere. As you scroll, the angular gap between
   consecutive cards grows from 0 to a full even split of the circle,
   while the whole stack keeps spinning; each card is also rotated to
   match its own position angle, which is what gives the fan its life
   (a card near the top of the circle sits sideways, one near the side
   sits upright, so even perfectly even spacing reads as an organic,
   uneven-looking spread — no per-card randomness needed). Once the
   ring is fully formed the motion holds briefly, then the same angular
   spacing is kept while the radius explodes outward and the headline
   fades in. Driven directly by scroll position on scroll events only —
   no continuous per-frame loop, no per-card lag/spring. */

(function () {
  const section = document.getElementById("orbitSection");
  const scene = document.getElementById("orbitScene");
  const headline = document.getElementById("orbitHeadline");
  const items = section ? Array.from(section.querySelectorAll(".orbit-item")) : [];

  if (!section || !items.length) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  const N = items.length;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInCubic(t) { return t * t * t; }

  let ticking = false;
  let progress = 0;

  function getProgress() {
    const rect = section.getBoundingClientRect();
    const total = section.offsetHeight - window.innerHeight;
    if (total <= 0) return 0;
    const scrolled = -rect.top;
    return clamp(scrolled / total, 0, 1);
  }

  function render(p) {
    // Stage boundaries along the 0..1 scroll progress of the section.
    const STACK_END = 0.1;   // perfectly overlapped up to here
    const FAN_END = 0.6;     // ring fully formed and spacing settled
    const HOLD_END = 0.78;   // brief plateau before the fly-apart
    const FLY_END = 0.98;

    const fanT = easeOutCubic(smoothstep(STACK_END, FAN_END, p));
    const angleStep = (360 / N) * fanT;

    // Spin never really stops: it races through most of its motion while
    // the fan opens, then keeps drifting slowly through the hold and fly.
    const spinFastT = easeOutCubic(smoothstep(STACK_END, FAN_END, p));
    const spinSlowT = smoothstep(HOLD_END, FLY_END, p);
    const rotationOffset = -110 + 228 * spinFastT + 34 * spinSlowT;

    // Scale: starts a touch smaller while stacked, grows as the ring
    // opens, keeps climbing a little further through the fly-apart.
    const scaleFastT = easeOutCubic(smoothstep(STACK_END, FAN_END, p));
    const scaleSlowT = smoothstep(HOLD_END, FLY_END, p);
    const scale = 0.68 + 0.3 * scaleFastT + 0.08 * scaleSlowT;

    // Radius: grows to the settled ring size while fanning out, holds,
    // then explodes outward once the fly-apart phase begins.
    const radiusFormT = easeOutCubic(smoothstep(STACK_END, FAN_END, p));
    const radiusFlyT = easeInCubic(smoothstep(HOLD_END, FLY_END, p));
    const radius = 300 * radiusFormT + 780 * radiusFlyT;

    // While the cards are still stacked (or barely separated), every
    // card's own shadow overlaps every other one at the same spot and
    // compounds into a much darker blob than a single card should cast.
    // Fade shadows in only as the fan actually opens.
    scene.style.setProperty("--shadow-o", String(0.35 * fanT));

    items.forEach((el, i) => {
      const angleDeg = rotationOffset + i * angleStep;
      const angle = (angleDeg * Math.PI) / 180;

      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${angleDeg}deg) scale(${scale})`;
      el.style.zIndex = String(1000 - i);
    });

    // Headline: fades/rises in only once the icons have mostly dispersed.
    const textT = smoothstep(0.78, 1, p);
    headline.style.opacity = String(textT);
    headline.style.transform = `translate(-50%, -50%) translateY(${lerp(16, 0, textT)}px)`;
  }

  function onScroll() {
    progress = getProgress();
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        render(progress);
        ticking = false;
      });
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  render(getProgress());
})();

/* Pixel-dissolve button hover, ported from Setl Tech's .btn-primary
   component: a canvas overlay divided into a staggered 8x2 grid of
   cells fades in on hover instead of a plain background crossfade.
   Colors: dissolves to near-black (unchanged from the source), and
   the icon chip flips from black to our accent blue (was red there). */
(function () {
  const COLS = 8, ROWS = 2;

  function buildGrid(cvs) {
    const w = cvs.width, h = cvs.height;
    const cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = Math.round((c * w) / COLS);
        const y = Math.round((r * h) / ROWS);
        const x2 = Math.round(((c + 1) * w) / COLS);
        const y2 = Math.round(((r + 1) * h) / ROWS);
        cells.push({ x, y, w: x2 - x, h: y2 - y, d: Math.random() });
      }
    }
    return cells;
  }

  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function initDissolveBtn(btn, opts) {
    const { fillRGB, accent, duration = 420 } = opts;
    const icon = btn.querySelector(".btn-icon");
    let cvs, ctx, cells, raf;

    function build() {
      const w = btn.offsetWidth, h = btn.offsetHeight;
      if (!cvs) {
        cvs = document.createElement("canvas");
        cvs.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:1;";
        btn.prepend(cvs);
      }
      cvs.width = w;
      cvs.height = h;
      ctx = cvs.getContext("2d");
      cells = buildGrid(cvs);
    }

    function play(enter) {
      if (!cvs || cvs.width !== btn.offsetWidth) build();
      cancelAnimationFrame(raf);
      const t0 = performance.now();
      let midFired = false;

      function step(now) {
        const p = Math.min((now - t0) / duration, 1);
        ctx.clearRect(0, 0, cvs.width, cvs.height);

        cells.forEach((cell) => {
          const lp = Math.max(0, Math.min(1, (p - cell.d * 0.45) / 0.55));
          const a = enter ? ease(lp) : 1 - ease(lp);
          if (a > 0.01) {
            ctx.fillStyle = `rgba(${fillRGB[0]},${fillRGB[1]},${fillRGB[2]},${a})`;
            ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
          }
        });

        if (!midFired && (enter ? p : 1 - p) > 0.5) {
          midFired = true;
          if (icon) icon.style.background = enter ? accent : "#16213d";
        }

        if (p < 1) {
          raf = requestAnimationFrame(step);
        } else {
          if (enter) {
            ctx.fillStyle = `rgb(${fillRGB[0]},${fillRGB[1]},${fillRGB[2]})`;
            ctx.fillRect(0, 0, cvs.width, cvs.height);
          } else {
            ctx.clearRect(0, 0, cvs.width, cvs.height);
          }
        }
      }

      raf = requestAnimationFrame(step);
    }

    build();
    btn.addEventListener("mouseenter", () => play(true));
    btn.addEventListener("mouseleave", () => play(false));
    new ResizeObserver(build).observe(btn);
  }

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3c83f6";
  document.querySelectorAll(".btn-accent").forEach((btn) => {
    initDissolveBtn(btn, { fillRGB: [22, 33, 61], accent });
  });
})();

/* Draggable auto-scroll logo marquee, ported from Setl Tech. No-ops
   safely if the trust strip isn't on the page. */
(function () {
  const wrapper = document.querySelector(".trust-marquee");
  const inner = document.getElementById("trustInner");
  if (!wrapper || !inner) return;

  let x = 0, dragging = false, startMX = 0, startX = 0;
  const SPEED = 0.45;

  function half() { return inner.scrollWidth / 2; }

  function wrap(val) {
    const h = half();
    if (!h) return val;
    val = val % h;
    if (val > 0) val -= h;
    return val;
  }

  (function tick() {
    if (!dragging) x = wrap(x - SPEED);
    inner.style.transform = `translateX(${x}px)`;
    requestAnimationFrame(tick);
  })();

  wrapper.addEventListener("mousedown", (e) => {
    dragging = true;
    startMX = e.clientX;
    startX = x;
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    x = wrap(startX + (e.clientX - startMX));
  });

  window.addEventListener("mouseup", () => { dragging = false; });
})();

/* Stack section: cards queue below the sticky viewport (each a little
   further down than the last) and slide up one at a time as you
   scroll, each settling at its own fixed tilt on top of the previous
   one. Only one card is ever "in transit" at a given scroll position —
   reverse-engineered from onewhale.io's stack-section, same technique
   as the orbit ring but applied to a deck instead of a circle. */
(function () {
  const section = document.getElementById("stackSection");
  const wrap = document.getElementById("stackWrap");
  const cards = wrap ? Array.from(wrap.querySelectorAll(".stack-card")) : [];

  if (!section || cards.length < 2) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  const contentCards = cards.slice(1); // skip the base video card, it never moves
  const N = contentCards.length;
  const FINAL_ROTATIONS = [-2, 2, -3, 3, -2, 4, -3];

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function getProgress() {
    const rect = section.getBoundingClientRect();
    const total = section.offsetHeight - window.innerHeight;
    if (total <= 0) return 0;
    return clamp(-rect.top / total, 0, 1);
  }

  let ticking = false;
  let cardHalfHeight = 0;

  function measure() {
    // All stack-cards share the same size (aspect-ratio-driven), so any
    // one of them tells us the real rendered height for this viewport.
    cardHalfHeight = cards[0].getBoundingClientRect().height / 2;
  }

  function render(p) {
    const FILL_START = 0.03;
    const FILL_SPAN = 0.8;
    const ITEM_DUR = 0.24;
    const viewportHalf = window.innerHeight / 2;
    // How far below the sticky viewport's bottom edge a fully-queued
    // card's top edge sits (0 = flush with the edge, no peek at all).
    const PEEK = 90;
    const STAGGER = 46;

    contentCards.forEach((el, i) => {
      const staggerFrac = N > 1 ? i / (N - 1) : 0;
      const start = FILL_START + staggerFrac * FILL_SPAN;
      const end = start + ITEM_DUR;
      const t = easeOutCubic(smoothstep(start, end, p));

      const queuedOffset = viewportHalf + cardHalfHeight - PEEK + i * STAGGER;
      const y = lerp(queuedOffset, 0, t);
      const rot = lerp(0, FINAL_ROTATIONS[i % FINAL_ROTATIONS.length], t);

      el.style.transform = `translateY(${y}px) rotate(${rot}deg)`;
      el.style.zIndex = String(20 + i);
    });
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        render(getProgress());
        ticking = false;
      });
    }
  }

  function onResize() {
    measure();
    onScroll();
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  measure();
  render(getProgress());
})();
