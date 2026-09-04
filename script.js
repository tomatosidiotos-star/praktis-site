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
   every stage's services stacked above it (2 per row). Desktop pins
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
    const COLS = 2;
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
  function buildStageSteps(stage, trackRect) {
    const items = buildConnectors(stage, trackRect);
    const steps = items.map((item) => {
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

    svg.appendChild(svgEl("circle", { cx: stage.nx, cy: stage.ny, r: "4", fill: "#3c83f6" }));
    return steps;
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

    const LABEL_DELAY = 200;
    const LINES_START = 420;
    const STEP_STAGGER = 90;
    const SEG_DUR = 420;
    const TILE_OFFSET = 200;

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
  }

  function checkTriggers(p) {
    stages.forEach((stage) => {
      if (!stage.triggered && p >= stage.nodeT - 0.001) {
        stage.triggered = true;
        animateStage(stage);
      }
    });
  }

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

  const mq = window.matchMedia("(min-width: 901px)");
  let isDesktop = mq.matches;
  // Pan distance alone — where translateX stops changing and progress
  // (line growth, stage triggers) caps at 1.
  let maxShiftCore = 0;
  // Pan distance plus a frozen hold afterward (desktop only): the pin
  // stays put with the finished diagram fully in frame for one more
  // viewport-height of scroll, rather than releasing right as stage 6
  // finishes and letting the next section peek in behind an animation
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

/* Service-card hover popover (block 2): hovering a card shows its
   checklist in a single shared panel, positioned from the card's live
   screen rect and faded/scaled in with its items staggering one at a
   time. Fixed-position and mouse-only by design — desktop only, since
   there's no hover on touch and the diagram falls back to native
   scroll there anyway.

   Driven by a single global mousemove + elementsFromPoint hit-test
   (rAF-throttled) rather than per-tile mouseenter/mouseleave: the
   popover is bigger than a card and deliberately overlaps its
   neighbors, so a naive enter/leave chain breaks as soon as it's
   sitting on top of a tile the user is trying to reach next — the
   popover would intercept the pointer and that tile would never see
   its own mouseenter. Checking the *whole* stack at the cursor instead
   means a covered tile still counts as hovered. */
(function () {
  const popover = document.getElementById("pathPopover");
  const tiles = Array.from(document.querySelectorAll(".path-service:not(.path-service-video)"));
  if (!popover || !tiles.length) return;

  const hoverCapable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!hoverCapable) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const titleEl = popover.querySelector(".path-popover-title");
  const listEl = popover.querySelector(".path-popover-list");
  const SWITCH_DELAY = 180; // matches the opacity transition in styles.css

  let activeTile = null;
  let hideTimer = null;
  let switchTimer = null;
  let itemTimers = [];

  function clearItemTimers() {
    itemTimers.forEach(clearTimeout);
    itemTimers = [];
  }

  function position(tile) {
    const r = tile.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const margin = 16;
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    const left = Math.min(Math.max(margin, cx - pw / 2), window.innerWidth - pw - margin);
    const top = Math.min(Math.max(margin, cy - ph / 2), window.innerHeight - ph - margin);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  // Populates, positions and fades the popover in for `tile`. Assumes
  // it's currently hidden — callers that might catch it still visible
  // over a different tile go through show(), which fades it out first.
  function reveal(tile) {
    activeTile = tile;

    const title = tile.querySelector(".path-service-title");
    const points = Array.from(tile.querySelectorAll(".path-service-points li")).map((li) => li.textContent);

    titleEl.textContent = title ? title.textContent : "";
    listEl.innerHTML = points
      .map(
        (text) =>
          '<li class="path-popover-item"><span class="path-popover-check"><svg viewBox="0 0 16 16"><polyline points="3,8.5 6.5,12 13,4"/></svg></span><span class="path-popover-item-text">' +
          text +
          "</span></li>"
      )
      .join("");

    position(tile);
    popover.classList.add("is-visible");

    Array.from(listEl.querySelectorAll(".path-popover-item")).forEach((item, i) => {
      const delay = reduceMotion ? 0 : 90 + i * 70;
      itemTimers.push(setTimeout(() => item.classList.add("is-shown"), delay));
    });
  }

  // Switching straight to a new position/content while still visible
  // reads as a snap, not a move — there's no transition on left/top.
  // So when the popover is already open on a different tile, fade it
  // out first and only reveal the new one once it's actually gone.
  function show(tile) {
    if (activeTile === tile) {
      clearTimeout(hideTimer);
      return;
    }
    clearTimeout(hideTimer);
    clearTimeout(switchTimer);
    clearItemTimers();

    if (activeTile) {
      popover.classList.remove("is-visible");
      switchTimer = setTimeout(() => reveal(tile), reduceMotion ? 0 : SWITCH_DELAY);
    } else {
      reveal(tile);
    }
  }

  function hide() {
    popover.classList.remove("is-visible");
    clearItemTimers();
    clearTimeout(switchTimer);
    activeTile = null;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 150);
  }

  const tileSet = new Set(tiles);
  let pendingX = 0;
  let pendingY = 0;
  let rafId = null;

  function processPoint() {
    rafId = null;
    const stack = document.elementsFromPoint(pendingX, pendingY);
    const hitTile = stack.find((el) => tileSet.has(el));

    if (hitTile) {
      show(hitTile);
      return;
    }
    if (stack.includes(popover)) {
      clearTimeout(hideTimer);
      return;
    }
    if (activeTile) scheduleHide();
  }

  document.addEventListener(
    "mousemove",
    (e) => {
      pendingX = e.clientX;
      pendingY = e.clientY;
      if (rafId == null) rafId = requestAnimationFrame(processPoint);
    },
    { passive: true }
  );

  // The pinned diagram pans on scroll, so a card's screen position
  // (and the popover pinned to it) would go stale mid-scroll — simpler
  // to just dismiss it than to track the pan every frame.
  window.addEventListener("scroll", hide, { passive: true, capture: true });
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
