/* Path intro heading: fades/rises in once, the first time it scrolls
   into view on the way from the hero down to the path diagram — same
   one-shot IntersectionObserver reveal used elsewhere on the site.
   The heading and subtitle stagger via a CSS transition-delay on the
   subtitle (styles.css), not JS timing. */
(function () {
  const head = document.getElementById("pathIntro");
  if (!head) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      head.classList.add("is-revealed");
      observer.disconnect();
    },
    { threshold: 0.4 }
  );
  observer.observe(head);
})();

/* Construction-cycle path (block 2): 6 stage nodes on a straight line,
   every stage's services lined up above it — one row on desktop,
   wrapping 2-per-row on narrow screens where the pin is skipped
   anyway. Desktop pins
   the section and pans the track sideways as you scroll — same
   sticky+progress technique as the orbit/stack sections used to run,
   but the scroll budget is measured from the track's actual rendered
   width instead of a fixed vh, since it depends on how many service
   tiles a given stage lists. Narrow screens skip the pin and let the
   track scroll natively (touch swipe reads far better than
   scroll-jacked panning on mobile) — reduced-motion users get a
   fully static, fully drawn diagram instead.

   The line itself grows from stage 1 rightward as progress (0..1,
   same value that drives the pan) increases. The first time progress
   reaches a stage's position along that line, its node dot pops in,
   then its connector lines draw outward from the dot one segment at a
   time, and each service card fades in right as the segment reaching
   it finishes — a small cascading reveal per stage, not a single
   fade-everything-at-once. Each stage only ever plays this once. */

(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const section = document.getElementById("pathSection");
  const sticky = document.getElementById("pathSticky");
  const viewport = document.getElementById("pathViewport");
  const track = document.getElementById("pathTrack");
  const svg = document.getElementById("pathConnectors");
  const spacer = document.getElementById("pathSpacer");
  const lineEl = track ? track.querySelector(".path-line") : null;
  const stageEls = track ? Array.from(track.querySelectorAll(".path-stage")) : [];
  if (!section || !sticky || !viewport || !track || !svg || !lineEl || !stageEls.length) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Declared up here (not just where isDesktop is set up below) so
  // buildConnectors can read mq.matches even on the reduced-motion
  // path, which lays everything out before that point further down.
  const mq = window.matchMedia("(min-width: 901px)");

  const stages = stageEls.map((el) => ({
    el,
    dot: el.querySelector(".path-node-dot"),
    node: el.querySelector(".path-node"),
    label: el.querySelector(".path-node-label"),
    branch: el.querySelector(".path-branch"),
    nx: 0,
    ny: 0,
    nodeT: 0,
    steps: [],
    triggered: false,
  }));

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
    return el;
  }

  // Straight segments through a list of [x, y] waypoints, with every
  // interior corner rounded by `r` (clamped to half of whichever
  // adjacent segment is shorter).
  function roundedPath(points, r) {
    let d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      const d1 = Math.hypot(x1 - x0, y1 - y0) || 1;
      const d2 = Math.hypot(x2 - x1, y2 - y1) || 1;
      const rr = Math.max(0, Math.min(r, d1 / 2, d2 / 2));
      const inX = x1 - ((x1 - x0) / d1) * rr;
      const inY = y1 - ((y1 - y0) / d1) * rr;
      const outX = x1 + ((x2 - x1) / d2) * rr;
      const outY = y1 + ((y2 - y1) / d2) * rr;
      d += ` L ${inX} ${inY} Q ${x1} ${y1} ${outX} ${outY}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last[0]} ${last[1]}`;
    return d;
  }

  let lineFirstX = 0;
  let lineRangeX = 0;

  // A little breathing room in the connector geometry: how far above
  // the node the trunk forks (shelf), how far outside the card group
  // the outer-frame routes run before turning up, and how far short of
  // a far tile's own side edge its dot and line stop — so the dot
  // sits fully outside the card's opaque background, not half hidden
  // under it.
  //
  // AIR_SHELF sits the fork at the midpoint of the node-to-nearest-card
  // run: that run is .path-branch's 140px padding-bottom plus the 20px
  // from the node's top edge down to its own center (half of the 40px
  // dot), 160px total — so the fork sits 80px above the node's center.
  // Keep this at half that sum if either figure changes.
  const AIR_SHELF = 80;
  const AIR_OUTER = 30;
  const DOT_STANDOFF = 7;

  // Every tile gets its own direct line from the node — no chaining
  // between stacked tiles. The tile nearest the line takes a simple
  // elbow straight to the node; anything stacked above it instead
  // routes out to that column's outer edge and up the *outside* of
  // the whole card group, arriving at the middle of the far tile's own
  // outer side edge — so it never has to cross the row of cards
  // sitting between it and the trunk. Every connector ends the same
  // way, in a small dot.
  function buildConnectors(stage, trackRect) {
    const tiles = stage.branch ? Array.from(stage.branch.querySelectorAll(".path-service")) : [];

    // Mobile stages with more than one card (5, 6) scroll their own
    // inner carousel (styles.css) instead of wrapping 2-per-row — only
    // one card is actually in view at a time, so only one connector
    // line is drawn, to whichever card is currently centered in that
    // scroller. Kept in sync by the branch scroll listener below,
    // which re-runs this on every settle, not just on layout()/resize.
    if (!mq.matches && tiles.length > 1) {
      const branchRect = stage.branch.getBoundingClientRect();
      const branchMidX = branchRect.left + branchRect.width / 2;
      let active = tiles[0];
      let bestDist = Infinity;
      tiles.forEach((tile) => {
        const r = tile.getBoundingClientRect();
        const dist = Math.abs(r.left + r.width / 2 - branchMidX);
        if (dist < bestDist) {
          bestDist = dist;
          active = tile;
        }
      });
      const tRect = active.getBoundingClientRect();
      const tx = tRect.left + tRect.width / 2 - trackRect.left;
      const ty = tRect.bottom - trackRect.top;
      const shelfY = stage.ny - AIR_SHELF;
      return [{
        tile: active,
        d: roundedPath([[stage.nx, stage.ny], [stage.nx, shelfY], [tx, shelfY], [tx, ty]], 12),
        mx: tx,
        my: ty,
      }];
    }

    // Must match .path-branch's current layout in styles.css: desktop
    // lays every stage out in one row (each tile its own column, no
    // stacking); mobile only reaches here for single-card stages,
    // which need no columns at all.
    const COLS = mq.matches ? tiles.length || 1 : 2;
    const byCol = [];
    tiles.forEach((tile, i) => {
      const c = i % COLS;
      (byCol[c] = byCol[c] || []).push(tile);
    });

    const branchRect = stage.branch.getBoundingClientRect();
    const outerLeftX = branchRect.left - trackRect.left - AIR_OUTER;
    const outerRightX = branchRect.right - trackRect.left + AIR_OUTER;
    const shelfY = stage.ny - AIR_SHELF;

    const near = [];
    const far = [];

    byCol.forEach((colTiles, c) => {
      const nearest = colTiles[colTiles.length - 1];
      const nRect = nearest.getBoundingClientRect();
      const tx = nRect.left + nRect.width / 2 - trackRect.left;
      const ty = nRect.bottom - trackRect.top;
      near.push({
        tile: nearest,
        d: roundedPath([[stage.nx, stage.ny], [stage.nx, shelfY], [tx, shelfY], [tx, ty]], 12),
        mx: tx,
        my: ty,
      });

      for (let i = colTiles.length - 2; i >= 0; i--) {
        const tile = colTiles[i];
        const tRect = tile.getBoundingClientRect();
        const outerX = c === 0 ? outerLeftX : outerRightX;
        const cornerX = c === 0
          ? tRect.left - trackRect.left - DOT_STANDOFF
          : tRect.right - trackRect.left + DOT_STANDOFF;
        const cornerY = tRect.top + tRect.height / 2 - trackRect.top;
        far.push({
          tile,
          d: roundedPath(
            [[stage.nx, stage.ny], [stage.nx, shelfY], [outerX, shelfY], [outerX, cornerY], [cornerX, cornerY]],
            12
          ),
          mx: cornerX,
          my: cornerY,
        });
      }
    });

    return near.concat(far);
  }

  // Hex mirrors --accent in styles.css: var() support inside
  // freshly-created SVG nodes is inconsistent, so it stays in sync by
  // hand. Every line and every endpoint dot share the same color.
  // Just the per-tile connector lines — the node's own dot is added
  // separately by layout() below, once per stage, since (unlike these)
  // it never needs to move when a mobile branch's inner carousel
  // settles on a different active tile.
  function buildStageSteps(stage, trackRect) {
    const items = buildConnectors(stage, trackRect);
    return items.map((item) => {
      const path = svgEl("path", { d: item.d, fill: "none", stroke: "#3c83f6", "stroke-width": "1.5" });
      svg.appendChild(path);
      const len = path.getTotalLength();
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = stage.triggered ? "0" : String(len);

      const marker = svgEl("circle", { cx: item.mx, cy: item.my, r: "3", fill: "#3c83f6" });
      marker.style.opacity = stage.triggered ? "1" : "0";
      svg.appendChild(marker);

      return { path, marker, tile: item.tile };
    });
  }

  // Rebuilds node positions and every connector from the actual
  // rendered layout. Re-run on resize; stages already triggered are
  // restored straight into their fully-drawn state, not replayed.
  function layout() {
    // Set before measuring track.scrollWidth below, since the spacer's
    // own width is part of what that measures.
    if (spacer) {
      spacer.style.width = "0px";
      const lastStage = stageEls[stageEls.length - 1];
      spacer.style.width = `${lastStage.getBoundingClientRect().width}px`;
    }

    const trackRect = track.getBoundingClientRect();
    const w = track.scrollWidth;
    const h = track.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.innerHTML = "";

    stages.forEach((stage) => {
      const dotRect = stage.dot.getBoundingClientRect();
      stage.nx = dotRect.left + dotRect.width / 2 - trackRect.left;
      stage.ny = dotRect.top + dotRect.height / 2 - trackRect.top;
    });

    lineFirstX = stages[0].nx;
    lineRangeX = stages[stages.length - 1].nx - lineFirstX;
    lineEl.style.left = `${lineFirstX}px`;
    lineEl.style.top = `${stages[0].ny - 1}px`;

    stages.forEach((stage) => {
      stage.nodeT = lineRangeX > 0 ? (stage.nx - lineFirstX) / lineRangeX : 0;
      stage.steps = buildStageSteps(stage, trackRect);
      svg.appendChild(svgEl("circle", { cx: stage.nx, cy: stage.ny, r: "4", fill: "#3c83f6" }));
    });
  }

  function renderLine(p) {
    lineEl.style.width = `${clamp(p, 0, 1) * lineRangeX}px`;
  }

  // Choreography: the number pops in, then the stage name, then every
  // connector line draws outward from the node (each with a small
  // stagger so they don't all move as one block), and each card fades
  // in right as the line reaching it finishes.
  function animateStage(stage) {
    stage.node.classList.add("is-revealed");

    const LABEL_DELAY = 130;
    const LINES_START = 280;
    const STEP_STAGGER = 55;
    const SEG_DUR = 280;
    const TILE_OFFSET = 130;

    if (stage.label) {
      setTimeout(() => stage.label.classList.add("is-revealed"), LABEL_DELAY);
    }

    stage.steps.forEach((step, i) => {
      const delay = LINES_START + i * STEP_STAGGER;
      setTimeout(() => {
        step.path.style.transition = `stroke-dashoffset ${SEG_DUR}ms ease`;
        step.path.style.strokeDashoffset = "0";
        step.marker.style.transition = "opacity 250ms ease";
        step.marker.style.opacity = "1";
      }, delay);
      setTimeout(() => step.tile.classList.add("is-revealed"), delay + TILE_OFFSET);
    });

    // A mobile multi-card stage only ever gets one connector (above,
    // to whichever card is currently active) — its other cards, sitting
    // off to the side in that branch's own carousel, still need to
    // reveal now rather than staying invisible until swiped to.
    if (stage.branch) {
      const revealed = new Set(stage.steps.map((step) => step.tile));
      stage.branch.querySelectorAll(".path-service").forEach((tile) => {
        if (!revealed.has(tile)) tile.classList.add("is-revealed");
      });
    }
  }

  function checkTriggers(p) {
    stages.forEach((stage) => {
      if (!stage.triggered && p >= stage.nodeT - 0.001) {
        stage.triggered = true;
        animateStage(stage);
      }
    });
  }

  // Mobile multi-card stages (5, 6) scroll their own inner carousel
  // (styles.css), completely independent of the outer stage-to-stage
  // scroll everything else above reacts to — so its single connector
  // needs its own resync on settle, not just on the global
  // layout()/resize pass. Runs regardless of reduced motion: this is
  // reflecting where the user actually scrolled to, not an animation.
  stages.forEach((stage) => {
    if (!stage.branch || stage.branch.querySelectorAll(".path-service").length <= 1) return;
    let settleTimer = null;
    stage.branch.addEventListener(
      "scroll",
      () => {
        if (mq.matches) return;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          const trackRect = track.getBoundingClientRect();
          stage.steps.forEach((step) => {
            step.path.remove();
            step.marker.remove();
          });
          stage.steps = buildStageSteps(stage, trackRect);
        }, 120);
      },
      { passive: true }
    );
  });

  if (reduceMotion) {
    stages.forEach((stage) => {
      stage.triggered = true;
      stage.node.classList.add("is-revealed");
      stage.el.querySelectorAll(".path-service").forEach((t) => t.classList.add("is-revealed"));
    });
    layout();
    renderLine(1);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        layout();
        renderLine(1);
      });
    }
    window.addEventListener("resize", () => {
      layout();
      renderLine(1);
    });
    return;
  }

  let isDesktop = mq.matches;
  // Pan distance alone — where translateX stops changing and progress
  // (line growth, stage triggers) caps at 1.
  let maxShiftCore = 0;
  // Pan distance plus a frozen hold afterward (desktop only): the pin
  // stays put with the finished diagram fully in frame for one more
  // viewport-height of scroll, rather than releasing right as the last
  // stage finishes and letting the next section peek in behind an animation
  // that's still mid-reveal. Nothing pans during the hold — the only
  // motion left is the next section climbing up to cover it, which is
  // what actually reads as "something is happening" while it lasts.
  let maxShift = 0;
  let armed = false;

  function measurePin() {
    const trackW = track.scrollWidth;
    const viewportW = viewport.clientWidth;
    maxShiftCore = Math.max(0, trackW - viewportW);
    if (!isDesktop) {
      section.style.height = "";
      track.style.transform = "";
      maxShift = 0;
      return;
    }
    const hold = maxShiftCore > 0 ? window.innerHeight : 0;
    maxShift = maxShiftCore + hold;
    // .path-section has its own top/bottom padding, which eats into
    // the sticky's pinnable range (a sticky child can only stay stuck
    // for as long as its parent's *content* box, padding excluded,
    // keeps scrolling past). Add that padding back on top so the
    // section's content box actually holds the full pan+hold budget —
    // otherwise the pin releases a beat early and the section's own
    // background shows through as a stray gap right where block 3
    // should start.
    if (maxShiftCore > 0) {
      const sectionStyle = getComputedStyle(section);
      const padY = parseFloat(sectionStyle.paddingTop) + parseFloat(sectionStyle.paddingBottom);
      section.style.height = `${sticky.offsetHeight + maxShift + padY}px`;
    } else {
      section.style.height = "";
    }
  }

  // Raw scrolled pixels, desktop (vertical pin) or mobile (native
  // horizontal scroll) alike, clamped to the full range (pan + hold).
  function getScrolledPx() {
    if (isDesktop) {
      if (maxShift <= 0) return 0;
      const rect = section.getBoundingClientRect();
      return clamp(-rect.top, 0, maxShift);
    }
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    return clamp(viewport.scrollLeft, 0, max);
  }

  // 0..1 over maxShiftCore alone — clamps at 1 once scrolledPx passes
  // that point, even while scrolledPx keeps growing through the hold.
  function getPanProgress(scrolledPx) {
    if (maxShiftCore <= 0) return 0;
    return clamp(scrolledPx / maxShiftCore, 0, 1);
  }

  function render() {
    const scrolledPx = getScrolledPx();
    if (isDesktop && maxShiftCore > 0) {
      const panPx = Math.min(scrolledPx, maxShiftCore);
      track.style.transform = `translateX(${-panPx}px)`;
    }
    const p = getPanProgress(scrolledPx);
    renderLine(p);
    if (armed) checkTriggers(p);
  }

  let ticking = false;
  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        render();
        ticking = false;
      });
    }
  }

  function onResize() {
    isDesktop = mq.matches;
    layout();
    measurePin();
    onScroll();
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  viewport.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);

  layout();
  measurePin();
  render();

  // The node labels are variable-width text (white-space: nowrap), so
  // a stage can be wider than its cards and the swap from the
  // fallback font to Inter — which happens after this first layout()
  // call, once the webfont finishes loading — reflows stage widths and
  // shifts node x-positions. Re-measure once fonts are actually ready
  // so connectors don't stay pinned to the pre-swap (stale) position.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      layout();
      measurePin();
      render();
    });
  }

  // Don't start triggering stage reveals until the diagram has
  // actually scrolled a bit into view — otherwise, on any viewport
  // shorter than the hero, the section already pokes a few px above
  // the fold at page load and stage 1 fires before the user scrolls
  // anywhere near it. The negative bottom margin means "in view"
  // only counts once the section is a little way past the fold.
  const armObserver = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      armed = true;
      checkTriggers(getPanProgress(getScrolledPx()));
      armObserver.disconnect();
    },
    { threshold: 0.01, rootMargin: "0px 0px -120px 0px" }
  );
  armObserver.observe(section);
})();

/* Touch equivalent of the desc/checklist hover crossfade above
   (styles.css): there's no hover to reach it on touch, so a tap does
   the same job, as an accordion — opening one card closes any other
   open card in the same stage's branch (unrelated stages are left
   alone). The .is-open class this toggles is read only under a
   (hover: none) media query, so this listener is harmless to attach
   unconditionally, mouse users included: nothing visible reacts to it
   there since that crossfade already runs on real :hover. Adding
   tabindex here also makes these cards keyboard-reachable for the
   first time, which is what the existing (until now dead)
   :focus-visible crossfade rule was already written for. */
(function () {
  const cards = Array.from(document.querySelectorAll(".path-service:not(.path-service-video)"));
  if (!cards.length) return;

  cards.forEach((card, i) => {
    const points = card.querySelector(".path-service-points");
    if (!points) return;
    if (!points.id) points.id = `pathServicePoints${i}`;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-expanded", "false");
    card.setAttribute("aria-controls", points.id);

    function toggle() {
      const opening = !card.classList.contains("is-open");
      const branch = card.closest(".path-branch");
      if (branch) {
        branch.querySelectorAll(".path-service.is-open").forEach((other) => {
          if (other !== card) {
            other.classList.remove("is-open");
            other.setAttribute("aria-expanded", "false");
          }
        });
      }
      card.classList.toggle("is-open", opening);
      card.setAttribute("aria-expanded", String(opening));
    }

    card.addEventListener("click", toggle);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
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

/* Tiles row: reveal once with a short stagger the first time it scrolls
   into view, instead of always sitting there static — a small echo of
   the orbit/stack sections' motion without needing their scroll-driven
   height. Fires once, then disconnects. */
(function () {
  const row = document.querySelector(".tiles-row");
  const cards = row ? Array.from(row.querySelectorAll(".tile-card")) : [];
  if (!row || !cards.length) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      cards.forEach((card, i) => {
        setTimeout(() => card.classList.add("is-revealed"), i * 90);
      });
      observer.disconnect();
    },
    { threshold: 0.35 }
  );

  observer.observe(row);
})();

/* Services section: each row's tiles fly in from the left with a short
   stagger the first time that row scrolls into view — same one-shot
   IntersectionObserver approach as the hero tiles, run per row so each
   category reveals independently as you scroll down to it. */
(function () {
  const rows = Array.from(document.querySelectorAll(".services-row"));
  if (!rows.length) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  rows.forEach((row) => {
    const tiles = Array.from(row.querySelectorAll(".service-tile"));
    if (!tiles.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        tiles.forEach((tile, i) => {
          setTimeout(() => tile.classList.add("is-revealed"), i * 80);
        });
        observer.disconnect();
      },
      { threshold: 0.25 }
    );

    observer.observe(row);
  });
})();

/* Hero video plays once and holds on its final sky shot — no loop.
   The logo fades in late in that shot and stays once the video ends.
   Scrolling the hero out of view and back into view (leaving and
   returning) replays it from the start, logo hidden again. */
(function () {
  const video = document.querySelector(".hero-video");
  const logo = document.querySelector(".hero-video-logo");
  const heroSection = document.querySelector(".hero");
  if (!video || !logo || !heroSection) return;

  video.loop = false;

  const FADE_IN_BEFORE_END = 1.7; // seconds before the video ends

  function onTimeUpdate() {
    const duration = video.duration;
    if (!isFinite(duration) || duration < FADE_IN_BEFORE_END) return;
    if (video.currentTime >= duration - FADE_IN_BEFORE_END) {
      logo.classList.add("is-visible");
    }
  }

  function resetLogo() {
    logo.classList.add("no-transition");
    logo.classList.remove("is-visible");
    requestAnimationFrame(() => logo.classList.remove("no-transition"));
  }

  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("ended", () => logo.classList.add("is-visible"));

  let hasLeftView = false;
  const observer = new IntersectionObserver((entries) => {
    const isVisible = entries[0].isIntersecting;
    if (!isVisible) {
      hasLeftView = true;
      return;
    }
    if (hasLeftView) {
      hasLeftView = false;
      resetLogo();
      video.currentTime = 0;
      video.play();
    }
  }, { threshold: 0.4 });

  observer.observe(heroSection);
})();

/* Stats section: sticky "digit belt" between hero and the path diagram.
   .stats-static (a plain grid, already real content) is what's in the
   markup and what mobile/reduced-motion users see untouched. Here, on
   desktop with motion allowed, we build an animated version from that
   same data and swap it in: a small plate shows one crisp active number
   in a cropped window, while the same number strip — uncropped, very
   pale — bleeds above/below the plate onto the page background; the
   panel's title/description move in sync.

   The move is a discrete snap keyed off scroll progress, not a value
   tied 1:1 to every pixel scrolled: render() only touches the strips
   when the nearest stat actually changes (crossing the midpoint to the
   next one), and CSS animates that one jump. Between snaps nothing
   moves, so a stat's number/text can't be caught half-scrolled the way
   a continuous transform would. */
(function () {
  const section = document.getElementById("statsSection");
  const staticEl = document.getElementById("statsStatic");
  const itemsEl = document.getElementById("statsItems");
  const items = itemsEl ? Array.from(itemsEl.querySelectorAll(".stats-item")) : [];
  if (!section || !staticEl || items.length < 2) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  const data = items.map((li) => ({
    number: li.querySelector(".stats-item-number").textContent.trim(),
    title: li.querySelector(".stats-item-title").innerHTML,
    desc: li.querySelector(".stats-item-desc").innerHTML,
  }));
  const N = data.length;

  const pinWrap = document.createElement("div");
  pinWrap.className = "stats-pin-wrap";
  pinWrap.innerHTML =
    '<div class="stats-sticky"><div class="stats-row">' +
    '<div class="stats-plate"><div class="stats-plate-ghost"></div>' +
    '<div class="stats-plate-mask"><div class="stats-plate-active"></div></div></div>' +
    '<div class="stats-panel"><div class="stats-text-window"><div class="stats-text-track"></div></div></div>' +
    "</div></div>";
  staticEl.parentElement.insertBefore(pinWrap, staticEl);

  const sticky = pinWrap.querySelector(".stats-sticky");
  const plate = pinWrap.querySelector(".stats-plate");
  const ghostStrip = pinWrap.querySelector(".stats-plate-ghost");
  const maskEl = pinWrap.querySelector(".stats-plate-mask");
  const activeStrip = pinWrap.querySelector(".stats-plate-active");
  const textWindow = pinWrap.querySelector(".stats-text-window");
  const textStrip = pinWrap.querySelector(".stats-text-track");

  data.forEach((d) => {
    const g = document.createElement("div");
    g.className = "stats-plate-ghost-item";
    g.textContent = d.number;
    ghostStrip.appendChild(g);

    const a = document.createElement("div");
    a.className = "stats-plate-active-item";
    a.textContent = d.number;
    activeStrip.appendChild(a);

    const slot = document.createElement("div");
    slot.className = "stats-text-slot";
    slot.innerHTML =
      '<h3 class="h3 stats-text-title">' + d.title + '</h3><p class="stats-text-desc">' + d.desc + "</p>";
    textStrip.appendChild(slot);
  });

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Mask window covers just over half the plate's height, centered —
  // enough to read the active number clearly while still leaving the
  // ghost strip's neighbors peeking outside it top and bottom.
  const MASK_RATIO = 0.55;
  let plateSize = 0;
  let maskHeight = 0;
  let trackHeight = 0;
  // -1 so the first render() jumps straight to the right stat with no
  // walk-through animation (there's no real "previous" card yet).
  let activeIndex = -1;
  let targetIndex = 0;
  let stepTimer = null;
  // Catch-up step spacing — shorter than the CSS transition itself, so
  // a fast scroll that lands several stats ahead cascades through the
  // ones in between instead of holding still and then leaping.
  const STEP_MS = 260;

  function layout() {
    activeIndex = -1;
    clearTimeout(stepTimer);
    stepTimer = null;
    plateSize = plate.getBoundingClientRect().width;
    maskHeight = plateSize * MASK_RATIO;

    Array.from(ghostStrip.children).forEach((el, i) => {
      el.style.height = `${plateSize}px`;
      el.style.top = `${i * plateSize}px`;
    });

    maskEl.style.top = `${(plateSize - maskHeight) / 2}px`;
    maskEl.style.height = `${maskHeight}px`;
    Array.from(activeStrip.children).forEach((el, i) => {
      el.style.height = `${maskHeight}px`;
      el.style.top = `${i * maskHeight}px`;
    });

    // All slots share the tallest one's height so the track can be
    // stacked at fixed offsets instead of measuring during scroll.
    trackHeight = 0;
    Array.from(textStrip.children).forEach((el) => {
      trackHeight = Math.max(trackHeight, el.getBoundingClientRect().height);
    });
    textWindow.style.height = `${trackHeight}px`;
    Array.from(textStrip.children).forEach((el, i) => {
      el.style.top = `${i * trackHeight}px`;
    });

    // Short, snappy scroll budget — this is a quick content swap, not a
    // cinematic multi-stage reveal like the path diagram.
    const scrollBudget = (N - 1) * window.innerHeight * 0.42;
    pinWrap.style.height = `${window.innerHeight + scrollBudget}px`;
  }

  function applyIndex(idx) {
    activeIndex = idx;
    ghostStrip.style.transform = `translateY(${-idx * plateSize}px)`;
    activeStrip.style.transform = `translateY(${-idx * maskHeight}px)`;
    textStrip.style.transform = `translateY(${-idx * trackHeight}px)`;
  }

  // Advances activeIndex by exactly one step toward whatever
  // targetIndex currently is (re-read fresh each call, so a change in
  // scroll direction mid-catch-up just bends the walk the other way).
  // Chains itself via setTimeout until the two meet.
  function stepToward() {
    stepTimer = null;
    if (activeIndex === targetIndex) return;
    applyIndex(activeIndex + (targetIndex > activeIndex ? 1 : -1));
    if (activeIndex !== targetIndex) {
      stepTimer = setTimeout(stepToward, STEP_MS);
    }
  }

  function render() {
    const rect = pinWrap.getBoundingClientRect();
    const total = pinWrap.offsetHeight - window.innerHeight;
    const progress = total > 0 ? clamp(-rect.top / total, 0, 1) : 0;
    // Nearest stat to the current scroll position — changes exactly at
    // the midpoint between two stats, not gradually across the range.
    targetIndex = clamp(Math.round(progress * (N - 1)), 0, N - 1);

    if (activeIndex === -1) {
      applyIndex(targetIndex);
      return;
    }
    // A fast scroll can land two or more stats ahead of what's on
    // screen between one animation frame and the next. Rather than
    // jump straight to targetIndex (skipping whatever sat in between),
    // take one step now and let stepToward() chain through the rest —
    // every stat still gets its moment, just quickly.
    if (targetIndex !== activeIndex && !stepTimer) {
      applyIndex(activeIndex + (targetIndex > activeIndex ? 1 : -1));
      if (activeIndex !== targetIndex) {
        stepTimer = setTimeout(stepToward, STEP_MS);
      }
    }
  }

  let ticking = false;
  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        render();
        ticking = false;
      });
    }
  }

  const mq = window.matchMedia("(min-width: 901px)");
  function applyMode() {
    if (mq.matches) {
      staticEl.style.display = "none";
      pinWrap.style.display = "";
      layout();
      render();
    } else {
      staticEl.style.display = "";
      pinWrap.style.display = "none";
      pinWrap.style.height = "";
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", applyMode);
  applyMode();

  // Inter swaps in after first layout and reflows the number/text
  // widths — re-measure once it's actually ready.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (mq.matches) {
        layout();
        render();
      }
    });
  }
})();

/* Join modal ("Присоединиться" in the hero): a plain centered dialog,
   not positioned off a button rect like the popover removed from the
   path diagram — backdrop + card fade/scale in, then the title, intro,
   each field and the submit button stagger in on their own delays
   (styles.css) using the same curve as the rest of the page. No
   backend yet: a valid submit just swaps to the success state and
   logs what would have been sent. */
(function () {
  const trigger = document.getElementById("joinTrigger");
  const modal = document.getElementById("joinModal");
  if (!trigger || !modal) return;

  const dialog = modal.querySelector(".join-modal-dialog");
  const form = document.getElementById("joinForm");
  const formState = document.getElementById("joinFormState");
  const successState = document.getElementById("joinSuccess");
  const errorEl = document.getElementById("joinFormError");
  const nameInput = document.getElementById("joinName");
  const emailInput = document.getElementById("joinEmail");
  const phoneInput = document.getElementById("joinPhone");
  const messageInput = document.getElementById("joinMessage");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const OPEN_DELAY = reduceMotion ? 0 : 20;
  const CLOSE_DURATION = reduceMotion ? 0 : 350;
  const SUCCESS_SWITCH_DELAY = reduceMotion ? 0 : 200;

  const iti = window.intlTelInput
    ? window.intlTelInput(phoneInput, {
        initialCountry: "ru",
        // Dial code sits next to the flag as its own segment (+7),
        // separate from the input — without this it's baked into the
        // input's placeholder/value instead, which read oddly next to
        // an already-selected country flag.
        separateDialCode: true,
        // Country names stay in English (no vanilla-script way to pull
        // the library's ~200-entry translation file without a module
        // loader) — just the interface strings, copied from its
        // build/js/i18n/ru/interface.js so the search box etc. read
        // in Russian like the rest of the page.
        uiTranslations: {
          selectedCountryAriaLabel: "Выбранная страна",
          noCountrySelected: "Страна не выбрана",
          countryListAriaLabel: "Список стран",
          searchPlaceholder: "Поиск",
          zeroSearchResults: "результатов не найдено",
          oneSearchResult: "найден 1 результат",
          multipleSearchResults: "Найдено ${count} результатов",
        },
      })
    : null;

  let lastFocused = null;
  let closeTimer = null;

  function autoGrow() {
    messageInput.style.height = "auto";
    messageInput.style.height = `${messageInput.scrollHeight}px`;
  }
  messageInput.addEventListener("input", autoGrow);

  function setInvalid(el, bad) {
    if (bad) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  }

  // Simple presence+shape check — good enough to catch typos, not a
  // full RFC 5322 validator (nothing here needs that level of rigor).
  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function focusablesIn(el) {
    return Array.from(
      el.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((n) => n.offsetParent !== null);
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = focusablesIn(dialog);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function resetForm() {
    form.reset();
    if (iti) iti.setCountry("ru");
    autoGrow();
    errorEl.hidden = true;
    [nameInput, emailInput, phoneInput].forEach((el) => setInvalid(el, false));
    successState.hidden = true;
    successState.classList.remove("is-shown");
    formState.hidden = false;
    formState.classList.remove("is-hiding");
  }

  function open() {
    lastFocused = document.activeElement;
    clearTimeout(closeTimer);
    resetForm();
    modal.hidden = false;
    // Force a reflow so removing [hidden] and adding .is-open land in
    // separate frames — otherwise the browser coalesces them and the
    // opening transition never plays.
    void modal.offsetWidth;
    setTimeout(() => modal.classList.add("is-open"), OPEN_DELAY);
    document.body.classList.add("join-modal-lock");
    document.addEventListener("keydown", onKeydown);
    setTimeout(() => nameInput.focus(), reduceMotion ? 0 : 320);
  }

  function close() {
    modal.classList.remove("is-open");
    document.body.classList.remove("join-modal-lock");
    document.removeEventListener("keydown", onKeydown);
    closeTimer = setTimeout(() => {
      modal.hidden = true;
    }, CLOSE_DURATION);
    if (lastFocused) lastFocused.focus();
  }

  trigger.addEventListener("click", open);
  modal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", close));

  // Empty is never "invalid" on its own here — only content that's
  // actually malformed gets the red border. Whether at least one
  // contact method was given at all is a separate, form-level check
  // (hasContact in the submit handler below).
  function emailOk() {
    const v = emailInput.value.trim();
    return !v || isValidEmail(v);
  }
  function phoneOk() {
    const v = phoneInput.value.trim();
    return !v || (iti ? iti.isValidNumber() : true);
  }

  // Live feedback on blur, same rule the submit handler enforces — so
  // a typo surfaces as soon as you tab away instead of only at submit.
  emailInput.addEventListener("blur", () => setInvalid(emailInput, !emailOk()));
  phoneInput.addEventListener("blur", () => setInvalid(phoneInput, !phoneOk()));

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const phoneRaw = phoneInput.value.trim();

    const emailValid = emailOk();
    const phoneValid = phoneOk();
    const hasContact = (email && emailValid) || (phoneRaw && phoneValid);
    const valid = Boolean(name) && emailValid && phoneValid && hasContact;

    setInvalid(nameInput, !name);
    setInvalid(emailInput, Boolean(email) && !emailValid);
    setInvalid(phoneInput, Boolean(phoneRaw) && !phoneValid);
    errorEl.hidden = valid;

    if (!valid) return;

    // No backend wired up yet — this is where the real request goes
    // once there's somewhere to send it.
    console.log("[joinForm] submit", {
      name,
      email: email || null,
      phone: phoneRaw ? (iti ? iti.getNumber() : phoneRaw) : null,
      message: messageInput.value.trim() || null,
    });

    formState.classList.add("is-hiding");
    setTimeout(() => {
      formState.hidden = true;
      successState.hidden = false;
      void successState.offsetWidth;
      successState.classList.add("is-shown");
    }, SUCCESS_SWITCH_DELAY);
  });
})();
