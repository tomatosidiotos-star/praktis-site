/* Praktis.ID page — self-contained script, separate from the homepage's
   script.js (different page, different element ids, no reason to share
   a file). Same conventions as the homepage: one-shot IntersectionObserver
   reveals, prefers-reduced-motion short-circuits before touching anything,
   cubic-bezier(0.22,1,0.36,1) for every "settle" transition. */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Breadcrumb + hero fade up together on load, staggered via CSS
   transition-delay (same trick as .join-modal.is-open on the homepage) —
   just needs the state class added one frame after paint. */
(function () {
  const breadcrumb = document.getElementById("pidBreadcrumb");
  const hero = document.getElementById("pidHero");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (breadcrumb) breadcrumb.classList.add("is-revealed");
      if (hero) hero.classList.add("is-loaded");
    });
  });
})();

/* Screenshot slider: a flex track, cloned at both ends (clone of the
   last slide prepended, clone of the first appended) so stepping past
   either end is a normal forward/backward animation onto a clone —
   then, once that transition settles, we silently re-point to the
   real slide underneath (transition:none; identical pixels, so the
   snap is invisible) instead of animating a long way back across the
   whole track. That's what makes next/prev feel infinite with just 3
   real images. Centering itself is computed from getBoundingClientRect
   deltas rather than offsetLeft — .pid-slider-track carries a CSS
   transform, which per spec makes it (not the position:relative
   .pid-slider) the offsetParent for its children, so raw offsetLeft
   ends up in the wrong coordinate space the moment the track and the
   full-bleed .pid-slider-viewport disagree on their own offsetLeft.
   Rects sidestep that entirely: both read in real page coordinates,
   and the "how far to shift" delta between them is correct regardless
   of which element anything's offsetLeft happens to be relative to. */
(function () {
  const root = document.getElementById("pidSlider");
  const viewport = root ? root.querySelector(".pid-slider-viewport") : null;
  const track = document.getElementById("pidTrack");
  const realSlides = track ? Array.from(track.querySelectorAll(".pid-slide")) : [];
  const dotsWrap = document.getElementById("pidDots");
  const prevBtn = document.getElementById("pidPrev");
  const nextBtn = document.getElementById("pidNext");
  if (!root || !viewport || !track || realSlides.length < 2) return;

  const cloneOfLast = realSlides[realSlides.length - 1].cloneNode(true);
  const cloneOfFirst = realSlides[0].cloneNode(true);
  cloneOfLast.setAttribute("aria-hidden", "true");
  cloneOfFirst.setAttribute("aria-hidden", "true");
  track.insertBefore(cloneOfLast, realSlides[0]);
  track.appendChild(cloneOfFirst);

  const positions = Array.from(track.children);
  let currentPos = 2; // pos = realIndex + 1; default active real index is 1
  let currentX = 0;
  let autoplayTimer = null;
  let resizeRAF = null;
  let snapTimer = null;

  const dots = realSlides.map((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "pid-dot";
    dot.setAttribute("aria-label", `Экран ${i + 1}`);
    dot.addEventListener("click", () => { centerPos(i + 1, true); restartAutoplay(); });
    dotsWrap.appendChild(dot);
    return dot;
  });

  function updateActiveVisuals(pos) {
    const realIndex = Number(positions[pos].dataset.index);
    positions.forEach((el, i) => el.classList.toggle("is-active", i === pos));
    dots.forEach((d, i) => d.classList.toggle("is-active", i === realIndex));
  }

  function centerPos(pos, animate) {
    currentPos = pos;
    if (!animate) track.style.transition = "none";
    const slideRect = positions[pos].getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    currentX += (viewportRect.left + viewportRect.width / 2) - (slideRect.left + slideRect.width / 2);
    track.style.transform = `translateX(${currentX}px)`;
    updateActiveVisuals(pos);
    if (animate) {
      scheduleSnapCheck();
    } else {
      void track.offsetHeight; // flush the transition:none before re-enabling it
      requestAnimationFrame(() => { track.style.transition = ""; });
    }
  }

  /* After an animated step lands on a clone (position 0 or the last
     one), silently re-point to the real slide it's standing in for. */
  function scheduleSnapCheck() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      if (currentPos === 0) centerPos(positions.length - 2, false);
      else if (currentPos === positions.length - 1) centerPos(1, false);
    }, 650);
  }

  function stepBy(delta) { centerPos(currentPos + delta, true); }

  function startAutoplay() {
    if (reduceMotion) return;
    stopAutoplay();
    autoplayTimer = setInterval(() => stepBy(1), 5000);
  }
  function stopAutoplay() { if (autoplayTimer) clearInterval(autoplayTimer); }
  function restartAutoplay() { startAutoplay(); }

  prevBtn.addEventListener("click", () => { stepBy(-1); restartAutoplay(); });
  nextBtn.addEventListener("click", () => { stepBy(1); restartAutoplay(); });

  root.addEventListener("mouseenter", stopAutoplay);
  root.addEventListener("mouseleave", startAutoplay);
  root.addEventListener("focusin", stopAutoplay);
  root.addEventListener("focusout", startAutoplay);

  let dragging = false, dragStartX = 0, dragBaseX = 0;
  track.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragStartX = e.clientX;
    dragBaseX = currentX;
    track.classList.add("is-dragging");
    track.setPointerCapture(e.pointerId);
    clearTimeout(snapTimer);
    stopAutoplay();
  });
  track.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    track.style.transform = `translateX(${dragBaseX + (e.clientX - dragStartX)}px)`;
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    track.classList.remove("is-dragging");
    const dx = e.clientX - dragStartX;
    if (Math.abs(dx) > 60) stepBy(dx < 0 ? 1 : -1);
    else centerPos(currentPos, true);
    restartAutoplay();
  }
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);

  window.addEventListener("resize", () => {
    if (resizeRAF) return;
    resizeRAF = requestAnimationFrame(() => { resizeRAF = null; centerPos(currentPos, false); });
  });

  centerPos(currentPos, false);
  startAutoplay();
})();

/* Generic one-shot reveal helpers, reused by every section below —
   same pattern as the homepage's per-row IntersectionObservers, just
   factored out since this page has many more sections calling it. */
function onVisible(el, cb, threshold) {
  const io = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    cb();
    io.disconnect();
  }, { threshold: threshold || 0.25 });
  io.observe(el);
}

function revealSingle(el) {
  if (el) onVisible(el, () => el.classList.add("is-revealed"));
}

function revealStagger(container, selector, step) {
  if (!container) return;
  const items = Array.from(container.querySelectorAll(selector));
  if (!items.length) return;
  onVisible(container, () => {
    items.forEach((item, i) => setTimeout(() => item.classList.add("is-revealed"), i * (step || 80)));
  });
}

if (!reduceMotion) {
  document.querySelectorAll(".pid-section-head").forEach(revealSingle);

  /* Methodology: on desktop the section pins the paragraph mid-screen
     (see .pid-method-pin-wrap's 220vh in CSS) and each word lights up
     as its point in the text scrolls past — same continuous-progress
     read as the steps timeline's fill line below, applied to words
     instead of a bar. The text is authored as four separate
     .pid-method-line paragraphs (with <em> around the enumerated
     phrases) — wrapWordsIn() walks each line's nodes so those stay
     intact, only wrapping the actual word text in .pid-method-word
     spans; words inside <em> end up nested inside it, so its accent+
     italic color just cascades down normally. Wrapping happens
     unconditionally (harmless on mobile/reduced-motion: with no
     .is-lit rule outside the desktop+motion media query, wrapped
     words render identically to plain text); the desktopMotion check
     inside update() is what actually gates the scroll effect. */
  (function () {
    const wrap = document.getElementById("pidMethodPinWrap");
    const text = document.getElementById("pidMethodText");
    if (!wrap || !text) return;

    function wrapWordsIn(el) {
      const found = [];
      Array.from(el.childNodes).forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          found.push(...wrapWordsIn(node));
          return;
        }
        if (node.nodeType !== Node.TEXT_NODE) return;
        const raw = node.textContent;
        const tokens = raw.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return;
        const frag = document.createDocumentFragment();
        if (/^\s/.test(raw)) frag.appendChild(document.createTextNode(" "));
        tokens.forEach((w, i) => {
          const span = document.createElement("span");
          span.className = "pid-method-word";
          span.textContent = w;
          frag.appendChild(span);
          found.push(span);
          if (i < tokens.length - 1) frag.appendChild(document.createTextNode(" "));
        });
        if (/\s$/.test(raw)) frag.appendChild(document.createTextNode(" "));
        node.replaceWith(frag);
      });
      return found;
    }

    const lines = Array.from(text.querySelectorAll(".pid-method-line"));
    const wordEls = lines.flatMap(wrapWordsIn);

    const desktopMotion = window.matchMedia("(min-width: 901px) and (prefers-reduced-motion: no-preference)");

    function update() {
      if (!desktopMotion.matches) return;
      const rect = wrap.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const progress = total > 0 ? Math.max(0, Math.min(1, -rect.top / total)) : 0;
      const litCount = progress * wordEls.length;
      wordEls.forEach((el, i) => el.classList.toggle("is-lit", i < litCount));
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
  })();

  document.querySelectorAll(".pid-compare-col").forEach((col) => revealStagger(col, ".pid-compare-row", 70));
  revealStagger(document.getElementById("pidFeatures"), ".pid-feature-card", 80);
  revealStagger(document.getElementById("pidBenefits"), ".pid-benefit-card", 90);
  revealStagger(document.getElementById("pidModules"), ".pid-module-card", 110);
  revealSingle(document.getElementById("pidCta"));

  /* Steps timeline: each row reveals on its own as it scrolls in; the
     connecting line separately tracks scroll continuously (viewport
     centre's progress through the list) — lighter cousin of the
     homepage path diagram's pin/pan, no scroll-jacking needed since
     the list is short enough to just read top to bottom. */
  document.querySelectorAll(".pid-step").forEach((step) => onVisible(step, () => step.classList.add("is-revealed"), 0.4));

  (function () {
    const list = document.getElementById("pidSteps");
    const fill = document.getElementById("pidStepsFill");
    const steps = list ? Array.from(list.querySelectorAll(".pid-step")) : [];
    if (!list || !fill || !steps.length) return;

    function update() {
      const rect = list.getBoundingClientRect();
      const viewportMid = window.innerHeight / 2;
      const start = rect.top - viewportMid;
      const end = rect.bottom - viewportMid;
      const total = end - start;
      const progress = total > 0 ? Math.max(0, Math.min(1, -start / total)) : 0;
      fill.style.height = `${progress * 100}%`;
      steps.forEach((step, i) => {
        const threshold = i / (steps.length - 1);
        step.classList.toggle("is-active", progress >= threshold - 0.02);
      });
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
  })();
}
