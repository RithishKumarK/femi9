/*!
 * <pad-exploder> — scroll-driven exploded view of a sanitary pad.
 *
 * Framework-agnostic Web Component. Zero dependencies, no build step.
 * Include with <script src="pad-exploder.js"></script>, then use:
 *
 *   <pad-exploder frames-path="./frames/optimised/" frame-count="90"></pad-exploder>
 *
 * Attributes (all optional):
 *   frames-path   Folder containing frame-001.webp/.jpg … (default "./frames/optimised/")
 *   frame-count   Number of frames in the sequence          (default 90)
 *   reverse       "true" if frame 1 is the EXPLODED pad and the last frame the
 *                 closed pad, so scrolling down plays the files backwards.
 *                 (default "true" — matches the shipped frames)
 *   scroll-length Height of the scroll runway, e.g. "400vh" (default "400vh")
 *   heading       Section heading                            (default "What's inside")
 *   intro-text    One-line intro under the heading
 *   frame-ext     "auto" | "webp" | "jpg"                   (default "auto")
 *   debug         Present = show anchor dots for label tuning.
 *                 Also enabled by ?debug in the page URL.
 *                 With debug on, add ?pe-progress=1 to the URL to freeze the
 *                 animation at any progress (0–1) while you tune anchors.
 *
 * See README.md for the full integration guide (including the
 * overflow:hidden / position:sticky gotcha — read it before embedding!).
 */
(function () {
  'use strict';

  /* SSR guard — Next.js/Nuxt execute this file on the server. Bail before
     touching window/document/HTMLElement so server renders never crash. */
  if (typeof window === 'undefined' || typeof document === 'undefined' ||
      typeof HTMLElement === 'undefined' || !window.customElements) {
    return;
  }
  /* Double-registration guard — a second <script> include is a no-op. */
  if (window.customElements.get('pad-exploder')) return;

  /* ======================================================================
   * TUNABLES — everything you are likely to hand-edit lives here.
   * ==================================================================== */

  /* ----------------------------------------------------------------------
   * LABEL ANCHORS — keyframe tracks.
   * Each callout follows its layer while the pad expands. `track` holds the
   * anchor's position at expansion keyframes, where `f` is the EXPANSION
   * frame (1 = closed pad … 90 = fully exploded — note this is playback
   * order, the reverse of the file numbering) and x/y are PERCENTAGES OF
   * THE CANVAS (0–100). Positions between keyframes are interpolated, so
   * the dot + line + text glide along with the layer as you scroll and
   * lock in exactly at the final frame.
   *
   * To tune the finished look, edit the LAST keyframe (f:90) of a track —
   * open demo.html?debug&pe-progress=1 to see the dots frozen fully
   * exploded. To tune mid-flight tracking, adjust the earlier keyframes
   * (?debug&pe-progress=0.6 shows ≈ frame 60). Add extra keyframes to any
   * track if a layer drifts — the array can be any length, sorted by f.
   *
   * `desc` values are placeholders — replace each with your one-liner.
   * Layers 4/8 and 5/7 intentionally repeat (the pad is symmetrical).
   * The layers tilt up toward the right of the render, so right-side
   * anchors sit visually higher than left-side ones around them — correct.
   * -------------------------------------------------------------------- */
  var LABELS = [
    { name: 'Soft Top Layer',     desc: 'Certified organic cotton, and nothing else.', side: 'left',
      track: [{ f: 60, x: 30, y: 27 }, { f: 75, x: 30, y: 26 }, { f: 90, x: 30, y: 24 }] },
    { name: 'Side Leakage Guard', desc: 'Raised edges that hold the flow in place.', side: 'right',
      track: [{ f: 60, x: 70, y: 31 }, { f: 75, x: 70, y: 30 }, { f: 90, x: 70, y: 28 }] },
    { name: '9 Smart Benefits',   desc: 'The anion strip, at work.', side: 'left',
      track: [{ f: 60, x: 38, y: 46 }, { f: 75, x: 38, y: 44 }, { f: 90, x: 38, y: 41 }] },
    /* y nudged 49 -> 51 at full expansion: labels 3 and 4 are the closest pair
       on the left and their text boxes grazed. The cotton layer is thick enough
       that the dot still sits on it; label 3 stays put because its dot has to
       land on the thin anion strip exactly. */
    { name: 'Cotton Layer',       desc: 'Spreads flow, never pools.', side: 'left',
      track: [{ f: 60, x: 31, y: 53 }, { f: 75, x: 31, y: 52 }, { f: 90, x: 30, y: 51 }] },
    { name: 'Air Laid Paper',     desc: 'Carries moisture down and away from you.', side: 'right',
      track: [{ f: 60, x: 70, y: 50 }, { f: 75, x: 70, y: 48 }, { f: 90, x: 70, y: 45 }] },
    { name: 'Absorbent Gel',      desc: 'The core. Locks liquid into a gel.', side: 'right',
      track: [{ f: 60, x: 71, y: 60 }, { f: 75, x: 71, y: 59 }, { f: 90, x: 72, y: 58 }] },
    { name: 'Air Laid Paper',     desc: 'Keeps the pad flat and even.', side: 'left',
      track: [{ f: 60, x: 27, y: 71 }, { f: 75, x: 27, y: 71 }, { f: 90, x: 27, y: 70 }] },
    { name: 'Cotton Layer',       desc: 'Why the pad stays thin, not stiff.', side: 'right',
      track: [{ f: 60, x: 64, y: 71 }, { f: 75, x: 65, y: 69 }, { f: 90, x: 66, y: 67 }] },
    { name: 'Breathable Layer',   desc: 'Lets air through, then breaks down after.', side: 'left',
      track: [{ f: 60, x: 30, y: 82 }, { f: 75, x: 30, y: 84 }, { f: 90, x: 30, y: 86 }] }
  ];
  /* Note: sides don't strictly alternate — layer 4 (cotton) shows its face
     on the LEFT and layer 5 (air laid) on the RIGHT, because each partly
     hides the other; the anchors sit where each layer is actually visible. */

  /* Callout choreography — all scroll-driven, so scrubbing back and forth
     replays it precisely. Callout i (0-based, top of the stack first) fades
     in when the expansion reaches frame
       REVEAL_START_FRAME + i * (REVEAL_END_FRAME - REVEAL_START_FRAME) / 8
     i.e. the first appears at frame 60 and the rest follow one by one,
     the last landing exactly as the final frame settles. They fade back
     out in reverse order on the way up. REVEAL_HYST_FRAMES is how many
     frames back you must scrub past a threshold before that callout hides
     (kills flicker). Frame numbers assume the shipped 90-frame sequence —
     retune if you swap in a different frame count. */
  var REVEAL_START_FRAME = 60;
  var REVEAL_END_FRAME   = 90;
  var REVEAL_HYST_FRAMES = 2.5;

  /* The animation finishes early: the pad is FULLY exploded once progress
     hits (1 - END_HOLD), and the last END_HOLD of the runway is a still
     "hold" — a breathing space where the finished view (pad + all callouts)
     stays pinned so the user gets a moment to take it in before the section
     releases. 0.12 of a 400vh runway ≈ half a viewport of quiet scroll. */
  var END_HOLD = 0.12;

  var FADE_MS      = 400;   // label fade/slide duration
  var CONNECTOR_PX = 56;    // connector line length on desktop

  /* Attribute defaults. */
  var DEFAULTS = {
    framesPath:   './frames/optimised/',
    frameCount:   90,
    reverse:      true,          // frames are exploded→closed on disk
    scrollLength: '400vh',
    heading:      "What's inside",
    introText:    'Nine thoughtful layers, working together. Scroll to pull them apart.',
    frameExt:     'auto'
  };

  /* frame index (0-based) → filename without extension. */
  function frameName(i) {
    var n = String(i + 1);
    while (n.length < 3) n = '0' + n;
    return 'frame-' + n;
  }

  var MAX_DPR = 2;          // cap devicePixelRatio for canvas backing store
  var MOBILE_BP = 940;      // px viewport width below which the label grid is used

  /* Palette. field/fieldEdge stay sampled from the frames themselves - they are
     what makes the canvas edge disappear into the page, so they are NOT site
     tokens. Ink and accent are retuned to the Femi9 lavender palette:
     ink = --navy #34204E, accent = --yellow #F0C14E (the locked brand accent). */
  var C = {
    field:    '#c3abda',    // frame background lavender (sampled from frames)
    fieldEdge:'#b89fd2',    // slightly deeper, for the page-side vignette
    ink:      '#34204E',    // --navy, Femi9 plum ink
    inkSoft:  'rgba(52, 32, 78, .66)',
    inkFaint: 'rgba(52, 32, 78, .38)',
    mint:     '#F0C14E',    // --yellow, anchor dots in the brand accent
    white:    'rgba(255, 255, 255, .92)'
  };

  /* ======================================================================
   * Internals below — you shouldn't need to edit past this line.
   * ==================================================================== */

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* WebP support check, shared across instances (tiny lossy WebP data URI). */
  var webpPromise = null;
  function supportsWebP() {
    if (!webpPromise) {
      webpPromise = new Promise(function (resolve) {
        var img = new Image();
        img.onload  = function () { resolve(img.width === 1); };
        img.onerror = function () { resolve(false); };
        img.src = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
      });
    }
    return webpPromise;
  }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /* Shadow stylesheet. All styles are scoped by the shadow root: nothing
     leaks out, nothing leaks in. No !important anywhere; box-sizing is set
     locally so we never rely on the host page's reset. Only opacity and
     transform/translate are ever animated — no layout properties. */
  var CSS = '' +
    ':host{display:block;height:var(--pe-scroll-len,400vh);' +
      'font-family:ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",Quicksand,Seravek,"Segoe UI",system-ui,sans-serif;' +
      '-webkit-font-smoothing:antialiased;}' +
    ':host([data-static]){height:auto;}' +
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}' +

    /* --pe-stick-top lets a host page with its own sticky header push the
       pinned stage below it; the stage shortens by the same amount so it still
       fills exactly the space left over. Defaults to 0 for a bare page.
       Each height is declared twice: svh (no jump when mobile browser chrome
       collapses) with a vh fallback for engines that lack svh. */
    '.stage{position:sticky;top:var(--pe-stick-top,0px);' +
      'height:calc(100vh - var(--pe-stick-top,0px));' +
      'height:calc(100svh - var(--pe-stick-top,0px));' +
      'display:flex;flex-direction:column;align-items:center;' +
      /* Gradient sampled from the frames\' own edges (lighter top, shadowed
         floor) so the canvas melts into the stage with no visible seam. */
      'background:linear-gradient(180deg,#c4adda 0%,#c2abda 55%,#af95c2 100%);}' +
    ':host([data-static]) .stage{position:static;}' +

    '.head{flex:none;text-align:center;padding:clamp(20px,4.5svh,44px) 24px 10px;pointer-events:none;}' +
    '.head h2{color:' + C.ink + ';font-size:clamp(26px,3.4vw,40px);font-weight:700;letter-spacing:.01em;}' +
    '.head p{color:' + C.inkSoft + ';font-size:clamp(13px,1.35vw,16px);margin-top:6px;max-width:44ch;margin-inline:auto;}' +

    /* Scene: the canvas sized to the frame aspect by JS, centred. */
    '.scene-wrap{flex:1 1 auto;min-height:0;align-self:stretch;position:relative;' +
      'display:flex;align-items:center;justify-content:center;}' +
    '.scene{position:relative;flex:none;}' +
    'canvas{display:block;width:100%;height:100%;' +
      /* Feather the left/right canvas edges so the frame background melts into the stage. */
      '-webkit-mask-image:linear-gradient(90deg,transparent,#000 44px,#000 calc(100% - 44px),transparent);' +
      'mask-image:linear-gradient(90deg,transparent,#000 44px,#000 calc(100% - 44px),transparent);}' +

    /* ---- Desktop labels: absolute overlay tracking the canvas ---- */
    '.overlay{position:absolute;inset:0;pointer-events:none;}' +
    /* Label geometry: JS sets each label\'s `transform` every frame so the
       callout rides along with its layer (anchor tracks are interpolated).
       The fade uses the separate `translate` property, so it composes with
       the JS-owned transform without fighting it. */
    '.lbl{position:absolute;left:0;top:0;display:flex;align-items:center;width:max-content;' +   /* max-content: don\'t shrink-to-fit against the overlay edge */
      'opacity:0;translate:0 10px;' +
      'transition:opacity ' + FADE_MS + 'ms ease,translate ' + FADE_MS + 'ms ease;}' +
    '.lbl.show{opacity:1;translate:0 0;}' +           /* each label crosses its own scroll threshold */
    '.lbl .dot{flex:none;width:8px;height:8px;border-radius:50%;background:' + C.mint + ';' +
      'box-shadow:0 0 0 3px rgba(255,255,255,.55);}' +
    '.lbl.side-left .dot{margin-right:-4px;}' +
    '.lbl.side-right .dot{margin-left:-4px;}' +
    '.lbl .line{flex:none;width:' + CONNECTOR_PX + 'px;height:1px;background:' + C.inkFaint + ';}' +
    '.lbl .txt{max-width:clamp(150px,17vw,220px);padding:0 12px;}' +
    '.lbl.side-left .txt{text-align:right;}' +
    '.lbl .num{display:block;font-size:10px;font-weight:700;letter-spacing:.14em;color:' + C.inkFaint + ';}' +
    '.lbl h3{font-size:15px;font-weight:700;color:' + C.ink + ';margin-top:1px;}' +
    '.lbl p{font-size:12px;line-height:1.45;color:' + C.inkSoft + ';margin-top:2px;}' +

    /* ---- Mobile: compact numbered grid below the pad; space is always
       reserved (visibility animates opacity only) so nothing shifts. ---- */
    '.grid{display:none;}' +
    '@media (max-width:' + (MOBILE_BP - 1) + 'px){' +
      '.overlay{display:none;}' +                      /* no connector lines on mobile */
      '.head p{display:none;}' +
      /* minmax(0,1fr), NOT 1fr: `1fr` means minmax(auto,1fr), and the auto
         minimum of a column holding `white-space:nowrap` text is that text's
         full un-wrapped width - so the columns blow past the viewport and the
         ellipsis below never gets a chance to apply. */
      '.grid{flex:none;align-self:stretch;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);' +
        'gap:6px 8px;list-style:none;padding:10px 14px calc(14px + env(safe-area-inset-bottom,0px));' +
        'max-height:38svh;overflow-y:auto;-webkit-overflow-scrolling:touch;}' +
      '.grid li{background:rgba(255,255,255,.30);border-radius:10px;padding:6px 10px;' +
        'opacity:0;translate:0 8px;transition:opacity ' + FADE_MS + 'ms ease,translate ' + FADE_MS + 'ms ease;}' +
      '.grid li.show{opacity:1;translate:0 0;}' +
      '.grid .num{font-size:9px;font-weight:700;letter-spacing:.12em;color:' + C.inkFaint + ';margin-right:5px;}' +
      '.grid h3{font-size:12px;font-weight:700;color:' + C.ink + ';display:inline;}' +
      /* One-line clamp keeps all nine rows on screen; full text lives in the light-DOM <dl>. */
      '.grid p{font-size:10px;line-height:1.4;color:' + C.inkSoft + ';margin-top:1px;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '}' +

    /* ---- Scroll hint: fades out on first scroll (opacity only) ---- */
    '.hint{position:absolute;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);' +
      'display:flex;align-items:center;gap:8px;padding:9px 18px;border-radius:999px;' +
      'background:rgba(255,255,255,.34);color:' + C.ink + ';font-size:13px;font-weight:600;letter-spacing:.02em;' +
      'pointer-events:none;transition:opacity .5s ease;}' +
    '.hint .chev{display:inline-block;width:8px;height:8px;border-right:2px solid ' + C.ink + ';border-bottom:2px solid ' + C.ink + ';' +
      'transform:rotate(45deg);animation:pe-bob 1.6s ease-in-out infinite;}' +
    '@keyframes pe-bob{0%,100%{transform:rotate(45deg) translate(0,0);}50%{transform:rotate(45deg) translate(3px,3px);}}' +
    '.hint.off{opacity:0;}' +

    /* ---- Loading state ---- */
    '.loader{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;' +
      'background:linear-gradient(180deg,#c4adda 0%,#c2abda 55%,#af95c2 100%);' +
      'transition:opacity .45s ease;z-index:2;}' +
    '.loader.done{opacity:0;pointer-events:none;visibility:hidden;transition:opacity .45s ease,visibility 0s .45s;}' +
    '.loader span{color:' + C.inkSoft + ';font-size:13px;font-weight:600;letter-spacing:.04em;}' +
    '.bar{width:140px;height:3px;border-radius:2px;background:rgba(255,255,255,.4);overflow:hidden;}' +
    '.bar i{display:block;width:100%;height:100%;background:' + C.ink + ';' +
      'transform:scaleX(0);transform-origin:left;transition:transform .2s ease;}' +   /* transform, not width */

    /* ---- Debug anchor dots ---- */
    '.dbg{position:absolute;inset:0;pointer-events:none;display:none;}' +
    ':host([data-debug]) .dbg{display:block;}' +
    ':host([data-debug]) .scene{outline:1px dashed rgba(216,0,150,.6);}' +
    '.dbg b{position:absolute;left:0;top:0;width:10px;height:10px;border-radius:50%;background:#e0219e;' +
      'box-shadow:0 0 0 2px #fff;}' +
    '.dbg em{position:absolute;left:0;top:0;font-style:normal;font-size:10px;font-weight:700;' +
      'color:#fff;background:rgba(120,10,90,.85);padding:1px 5px;border-radius:4px;white-space:nowrap;}' +

    /* ---- Fallback (all frames failed): reveal the semantic light DOM ---- */
    '.sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);}' +
    ':host([data-fallback]) .sr{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;clip-path:none;' +
      'padding:24px;color:' + C.ink + ';}' +
    ':host([data-fallback]) .scene-wrap,:host([data-fallback]) .hint,:host([data-fallback]) .grid{display:none;}' +
    ':host([data-fallback]) .stage{height:auto;min-height:0;padding-bottom:8px;}' +   /* no full-viewport empty field */

    /* Reduced motion: no bobbing chevron, no transitions (state changes are instant). */
    '@media (prefers-reduced-motion:reduce){' +
      '.hint{display:none;}' +
      '.lbl,.grid li,.loader{transition:none;}' +
      '.hint .chev{animation:none;}' +
    '}';

  /* ==================================================================== */

  function PadExploderFactory() {
    /* class syntax via function to keep this file ES5-parseable except for
       the class itself — customElements requires a real class. */
    return class PadExploder extends HTMLElement {

      static get observedAttributes() { return ['debug', 'heading', 'intro-text']; }

      constructor() {
        super();
        this._destroyed = true;   // becomes false on connect
        this._frames = null;      // Image[] once loaded
        this._raf = 0;
        this._resizeTimer = 0;
        this._curIdx = -1;
        this._lblShown = [];
        this._hinted = false;
        this._aspect = 9 / 16;    // replaced by real frame aspect once loaded
        this._onScroll = this._onScroll.bind(this);
        this._onResize = this._onResize.bind(this);
        this._onOrient = this._onOrient.bind(this);
        this._onMotionPref = this._onMotionPref.bind(this);
      }

      /* ---------- lifecycle ---------- */

      connectedCallback() {
        this._destroyed = false;
        this._readConfig();
        this._ensureLightDom();
        this._buildShadow();
        this._applyMode();

        /* Listeners. scroll uses capture so scrolling inside an
           overflow:auto ancestor still drives the animation; passive so we
           never block the host page's scrolling (no hijacking, ever). */
        document.addEventListener('scroll', this._onScroll, { passive: true, capture: true });
        window.addEventListener('resize', this._onResize);
        window.addEventListener('orientationchange', this._onOrient);
        if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', this._onMotionPref);
        else if (reduceMotion.addListener) reduceMotion.addListener(this._onMotionPref);

        /* ResizeObserver also covers "component starts display:none /
           off-screen and becomes visible later" — layout() is a no-op at
           0×0 and runs again the moment we get real dimensions. */
        if (typeof ResizeObserver !== 'undefined') {
          this._ro = new ResizeObserver(this._onResize);
          this._ro.observe(this._els.wrap);
        }

        this._layout();

        /* The frame set is a few MB. Kicking it off here would put it in flight
           during first paint, competing with the hero image for bandwidth even
           though this section is usually several screens down. Instead wait
           until the section is within ~2.5 viewports and preload then, which
           still lands well before the user arrives. The loader/progress UI
           covers the case where they scroll straight down. */
        if (typeof IntersectionObserver !== 'undefined') {
          var self = this;
          this._io = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
              if (entries[i].isIntersecting) {
                if (self._io) { self._io.disconnect(); self._io = null; }
                if (!self._destroyed) self._loadFrames();
                return;
              }
            }
          }, { rootMargin: '250% 0px' });
          this._io.observe(this);
        } else {
          this._loadFrames();
        }
      }

      disconnectedCallback() {
        /* Self-cleaning: the component must survive repeated mount/unmount
           (React strict mode, route changes) without leaking. */
        this._destroyed = true;
        document.removeEventListener('scroll', this._onScroll, { capture: true });
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('orientationchange', this._onOrient);
        if (reduceMotion.removeEventListener) reduceMotion.removeEventListener('change', this._onMotionPref);
        else if (reduceMotion.removeListener) reduceMotion.removeListener(this._onMotionPref);
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._io) { this._io.disconnect(); this._io = null; }
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        if (this._resizeTimer) { clearTimeout(this._resizeTimer); this._resizeTimer = 0; }
        /* Release image memory: abort in-flight loads and drop references. */
        if (this._frames) {
          for (var i = 0; i < this._frames.length; i++) {
            var img = this._frames[i];
            if (img) { img.onload = img.onerror = null; if (!img.complete) img.src = ''; }
          }
        }
        this._frames = null;
        this._curIdx = -1;
      }

      attributeChangedCallback(name) {
        if (this._destroyed || !this._els) return;
        if (name === 'debug') this._syncDebug();
        if (name === 'heading') this._els.h2.textContent = this.getAttribute('heading') || DEFAULTS.heading;
        if (name === 'intro-text') this._els.intro.textContent = this.getAttribute('intro-text') || DEFAULTS.introText;
      }

      /* ---------- config ---------- */

      _readConfig() {
        var attr = this.getAttribute.bind(this);
        var path = attr('frames-path') || DEFAULTS.framesPath;
        if (path.charAt(path.length - 1) !== '/') path += '/';
        this._cfg = {
          path: path,                                       /* everything resolves from frames-path */
          count: Math.max(1, parseInt(attr('frame-count'), 10) || DEFAULTS.frameCount),
          reverse: attr('reverse') === null ? DEFAULTS.reverse
                   : !/^(false|0|no)$/i.test(attr('reverse')),
          heading: attr('heading') || DEFAULTS.heading,
          intro: attr('intro-text') || DEFAULTS.introText,
          ext: (attr('frame-ext') || DEFAULTS.frameExt).toLowerCase()
        };
        var len = attr('scroll-length') || DEFAULTS.scrollLength;
        if (/^\d+(\.\d+)?$/.test(len)) len += 'vh';         /* bare number means vh */
        this.style.setProperty('--pe-scroll-len', len);

        /* debug progress lock: ?pe-progress=0.8 freezes the scrub there */
        var m = /[?&]pe-progress=([\d.]+)/.exec(window.location.search);
        this._lockProgress = m ? clamp01(parseFloat(m[1])) : null;
      }

      /* If the page author didn't provide semantic fallback content in the
         light DOM, generate it — screen readers and SEO always get a real
         heading + <dl>, animation or not. */
      _ensureLightDom() {
        if (this.querySelector('dl')) return;
        var doc = document;
        var frag = doc.createDocumentFragment();
        var h = doc.createElement('h2'); h.textContent = this._cfg.heading; frag.appendChild(h);
        var p = doc.createElement('p'); p.textContent = this._cfg.intro; frag.appendChild(p);
        var dl = doc.createElement('dl');
        for (var i = 0; i < LABELS.length; i++) {
          var dt = doc.createElement('dt'); dt.textContent = (i + 1) + '. ' + LABELS[i].name;
          var dd = doc.createElement('dd'); dd.textContent = LABELS[i].desc;
          dl.appendChild(dt); dl.appendChild(dd);
        }
        frag.appendChild(dl);
        this.appendChild(frag);
      }

      /* ---------- shadow DOM ---------- */

      _buildShadow() {
        var root = this.shadowRoot || this.attachShadow({ mode: 'open' });
        root.innerHTML = '';                                /* idempotent on re-mount */

        var style = document.createElement('style');
        style.textContent = CSS;
        root.appendChild(style);

        var stage = el('div', 'stage');

        /* Heading — aria-hidden: the real semantic copy lives in the light
           DOM <slot>, so assistive tech hears it exactly once. */
        var head = el('header', 'head');
        head.setAttribute('aria-hidden', 'true');
        var h2 = el('h2'); h2.textContent = this._cfg.heading;
        var intro = el('p'); intro.textContent = this._cfg.intro;
        head.appendChild(h2); head.appendChild(intro);
        stage.appendChild(head);

        /* Scene: canvas + label overlay + debug layer. */
        var wrap = el('div', 'scene-wrap');
        var scene = el('div', 'scene');
        var canvas = document.createElement('canvas');
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label',
          'Exploded view of a sanitary pad: as you scroll, nine layers separate — ' +
          'from the soft top layer down to the breathable base layer.');
        scene.appendChild(canvas);

        var overlay = el('div', 'overlay');
        overlay.setAttribute('aria-hidden', 'true');
        var lblEls = [];
        for (var i = 0; i < LABELS.length; i++) {
          var L = LABELS[i];
          var lbl = el('div', 'lbl side-' + (L.side === 'left' ? 'left' : 'right'));
          var dot = el('span', 'dot');
          var line = el('span', 'line');
          var txt = el('div', 'txt');
          var num = el('span', 'num'); num.textContent = pad2(i + 1);
          var h3 = el('h3'); h3.textContent = L.name;
          var p = el('p'); p.textContent = L.desc;
          txt.appendChild(num); txt.appendChild(h3); txt.appendChild(p);
          if (L.side === 'left') { lbl.appendChild(txt); lbl.appendChild(line); lbl.appendChild(dot); }
          else { lbl.appendChild(dot); lbl.appendChild(line); lbl.appendChild(txt); }
          overlay.appendChild(lbl);
          lblEls.push(lbl);
        }
        scene.appendChild(overlay);

        var dbg = el('div', 'dbg');
        var dbgEls = [];
        for (var d = 0; d < LABELS.length; d++) {
          var b = el('b');
          var t = el('em');
          dbg.appendChild(b); dbg.appendChild(t);
          dbgEls.push({ dot: b, tag: t });
        }
        scene.appendChild(dbg);
        wrap.appendChild(scene);
        stage.appendChild(wrap);

        /* Mobile grid — space always reserved; items animate opacity only. */
        var grid = el('ol', 'grid');
        grid.setAttribute('aria-hidden', 'true');
        var gridEls = [];
        for (var g = 0; g < LABELS.length; g++) {
          var li = el('li');
          var gn = el('span', 'num'); gn.textContent = pad2(g + 1);
          var gh = el('h3'); gh.textContent = LABELS[g].name;
          var gp = el('p'); gp.textContent = LABELS[g].desc;
          li.appendChild(gn); li.appendChild(gh); li.appendChild(gp);
          grid.appendChild(li);
          gridEls.push(li);
        }
        stage.appendChild(grid);

        var hint = el('div', 'hint');
        hint.setAttribute('aria-hidden', 'true');
        var hs = el('span'); hs.textContent = 'Scroll to explore';
        var ch = el('span', 'chev');
        hint.appendChild(hs); hint.appendChild(ch);
        stage.appendChild(hint);

        var loader = el('div', 'loader');
        loader.setAttribute('aria-hidden', 'true');
        var ls = el('span'); ls.textContent = 'Preparing the layers…';
        var bar = el('div', 'bar'); var fill = el('i');
        bar.appendChild(fill);
        loader.appendChild(ls); loader.appendChild(bar);
        stage.appendChild(loader);

        root.appendChild(stage);

        /* Light DOM slot: visually hidden, fully present for AT + SEO.
           If frames fail entirely, [data-fallback] reveals it instead. */
        var sr = el('div', 'sr');
        sr.appendChild(document.createElement('slot'));
        root.appendChild(sr);

        this._els = {
          stage: stage, wrap: wrap, scene: scene, canvas: canvas, ctx: canvas.getContext('2d'),
          overlay: overlay, grid: grid, lblEls: lblEls, gridEls: gridEls, dbgEls: dbgEls,
          hint: hint, loader: loader, loaderFill: fill,
          loaderText: ls, h2: h2, intro: intro
        };
        this._lblShown = new Array(LABELS.length);        /* per-callout visibility state */
        this._lastAnimF = -1;                             /* last frame labels were positioned at */
        this._syncDebug();
      }

      _syncDebug() {
        var on = this.hasAttribute('debug') || /[?&]debug\b/.test(window.location.search);
        if (on) this.setAttribute('data-debug', '');
        else this.removeAttribute('data-debug');
      }

      /* Reduced motion → static mode: no scroll runway, no scrub. The final
         EXPLODED frame is drawn once with every label visible. */
      _applyMode() {
        this._static = reduceMotion.matches;
        if (this._static) this.setAttribute('data-static', '');
        else this.removeAttribute('data-static');
      }

      _onMotionPref() {
        if (this._destroyed) return;
        this._applyMode();
        this._layout();
        this._schedule();
      }

      /* ---------- frame loading ---------- */

      _loadFrames() {
        var self = this;
        var cfg = this._cfg;
        var extPromise = cfg.ext === 'auto'
          ? supportsWebP().then(function (ok) { return ok ? 'webp' : 'jpg'; })
          : Promise.resolve(cfg.ext);

        extPromise.then(function (ext) {
          if (self._destroyed) return;
          var frames = new Array(cfg.count);
          var settled = 0, failed = 0;

          function done() {
            if (self._destroyed) return;
            /* Patch gaps: any frame that failed borrows its nearest loaded
               neighbour, so a few 404s degrade invisibly. */
            var okCount = cfg.count - failed;
            if (okCount === 0) { self._fatal(); return; }
            for (var i = 0; i < cfg.count; i++) {
              if (!frames[i]) {
                for (var r = 1; r < cfg.count && !frames[i]; r++) {
                  if (frames[i - r]) frames[i] = frames[i - r];
                  else if (frames[i + r]) frames[i] = frames[i + r];
                }
              }
            }
            self._frames = frames;
            var probe = frames[0];
            if (probe && probe.naturalWidth) self._aspect = probe.naturalWidth / probe.naturalHeight;
            if (failed > 0) {
              /* Degrade to a static view of the last reachable state rather
                 than risking a janky partial scrub — never a blank box. */
              console.warn('<pad-exploder> ' + failed + ' frame(s) failed to load; showing static view.');
              self._static = true;
              self.setAttribute('data-static', '');
            }
            self._els.loader.classList.add('done');
            self._layout();
            self._schedule();
          }

          function tick() {
            settled++;
            var pct = settled / cfg.count;
            self._els.loaderFill.style.transform = 'scaleX(' + pct + ')';   /* transform only */
            self._els.loaderText.textContent = 'Preparing the layers… ' + Math.round(pct * 100) + '%';
            if (settled === cfg.count) done();
          }

          for (var i = 0; i < cfg.count; i++) {
            (function (i) {
              var img = new Image();
              img.decoding = 'async';
              img.onload = function () {
                /* decode() up front so the first scroll never stutters on
                   lazy decodes; fall back gracefully where unsupported. */
                var p = img.decode ? img.decode().catch(function () {}) : Promise.resolve();
                p.then(function () { if (!self._destroyed) { frames[i] = img; tick(); } });
              };
              img.onerror = function () {
                if (self._destroyed) return;
                if (ext === 'webp' && cfg.ext === 'auto') {
                  /* per-frame JPG fallback in case a lone .webp is missing */
                  var jpg = new Image();
                  jpg.decoding = 'async';
                  jpg.onload = function () { if (!self._destroyed) { frames[i] = jpg; tick(); } };
                  jpg.onerror = function () { if (!self._destroyed) { failed++; tick(); } };
                  jpg.src = cfg.path + frameName(i) + '.jpg';
                } else { failed++; tick(); }
              };
              img.src = cfg.path + frameName(i) + '.' + ext;
            })(i);
          }
        });
      }

      /* Every frame failed (bad path, offline). Show the semantic light-DOM
         content on the lavender field instead — readable, never blank. */
      _fatal() {
        console.warn('<pad-exploder> no frames could be loaded from "' + this._cfg.path +
          '" — check frames-path. Falling back to text content.');
        this.setAttribute('data-fallback', '');
        this.setAttribute('data-static', '');
        this._els.loader.classList.add('done');
      }

      /* ---------- geometry ---------- */

      _onResize() {
        if (this._destroyed) return;
        /* Debounced: batches the resize storm, then recomputes everything. */
        if (this._resizeTimer) clearTimeout(this._resizeTimer);
        var self = this;
        this._resizeTimer = setTimeout(function () {
          self._resizeTimer = 0;
          if (self._destroyed) return;
          self._layout();
          self._schedule();
        }, 150);
      }

      _onOrient() {
        /* iOS reports stale dimensions right after orientationchange; run a
           normal debounce now and a safety pass once things settle. */
        this._onResize();
        var self = this;
        setTimeout(function () { if (!self._destroyed) { self._layout(); self._schedule(); } }, 400);
      }

      /* Size the scene to a contain-fit of the frame aspect, and size the
         canvas backing store for the devicePixelRatio so it's crisp on
         retina. Safe no-op while the component is display:none / 0×0. */
      _layout() {
        var els = this._els;
        if (!els) return;
        var availW = els.wrap.clientWidth;
        var availH = els.wrap.clientHeight;
        if (availW <= 0 || availH <= 0) return;             /* hidden — try again on next resize */

        var ar = this._aspect;
        var w = Math.min(availW, availH * ar);
        var h = w / ar;
        els.scene.style.width = Math.round(w) + 'px';
        els.scene.style.height = Math.round(h) + 'px';

        var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        var bw = Math.max(1, Math.round(w * dpr));
        var bh = Math.max(1, Math.round(h * dpr));
        if (els.canvas.width !== bw || els.canvas.height !== bh) {
          els.canvas.width = bw;
          els.canvas.height = bh;
        }
        this._drawSize = { w: w, h: h, dpr: dpr };
        this._curIdx = -1;                                  /* force redraw at new size */
        this._lastAnimF = -1;                               /* force label reposition at new size */
      }

      /* Place every callout (and its debug dot) at its layer's interpolated
         position for the given expansion frame. Transform-only — no layout. */
      _positionLabels(animF) {
        var els = this._els, d = this._drawSize;
        if (!els || !d) return;
        for (var i = 0; i < LABELS.length; i++) {
          var L = LABELS[i];
          var pos = trackPos(L.track, animF);
          var px = (pos.x / 100 * d.w).toFixed(1);
          var py = (pos.y / 100 * d.h).toFixed(1);
          var base = 'translate(' + px + 'px,' + py + 'px) ';
          els.lblEls[i].style.transform = base +
            (L.side === 'left' ? 'translate(-100%,-50%)' : 'translateY(-50%)');
          var dbg = els.dbgEls[i];
          dbg.dot.style.transform = base + 'translate(-50%,-50%)';
          dbg.tag.style.transform = base + 'translate(8px,-50%)';
          dbg.tag.textContent = (i + 1) + ' · ' + pos.x.toFixed(1) + ',' + pos.y.toFixed(1);
        }
        this._lastAnimF = animF;
      }

      /* ---------- scroll → progress → frame ---------- */

      _onScroll() {
        if (this._destroyed || this._static) return;
        this._schedule();
      }

      _schedule() {
        /* Coalesce everything into one rAF; all drawing happens inside it. */
        if (this._raf || this._destroyed) return;
        var self = this;
        this._raf = requestAnimationFrame(function () {
          self._raf = 0;
          if (!self._destroyed) self._update();
        });
      }

      _progress() {
        if (this._static) return 1;                         /* static mode: fully exploded */
        if (this._lockProgress !== null) return this._lockProgress;
        /* Fresh geometry every frame — never cached, so resizes, font loads
           and content shifts above the component can't break the mapping. */
        var rect = this.getBoundingClientRect();
        var travel = rect.height - this._els.stage.clientHeight;
        if (travel <= 0) return 1;
        return clamp01(-rect.top / travel);
      }

      _update() {
        var els = this._els;
        if (!els || !this._drawSize) return;
        var p = this._progress();
        var n = this._cfg.count;

        /* The explosion completes at (1 - END_HOLD); the rest of the runway
           holds the finished view so the user gets a beat to take it in. */
        var pAnim = Math.min(1, p / (1 - END_HOLD));

        /* Expansion frame, 1 (closed) … n (fully exploded), fractional —
           drives the canvas, the callout tracks and the reveal thresholds. */
        var animF = 1 + pAnim * (n - 1);

        /* Map animation progress to a frame. Frames on disk run
           exploded→closed, so with reverse=true scrolling down walks the
           files backwards: closed pad → expanding → fully exploded. */
        var idx = Math.round(pAnim * (n - 1));
        if (this._cfg.reverse) idx = n - 1 - idx;           /* frames[total - 1 - i] */

        if (this._frames && idx !== this._curIdx) {
          var img = this._frames[idx];
          if (img) {
            var d = this._drawSize;
            var ctx = els.ctx;
            ctx.setTransform(d.dpr, 0, 0, d.dpr, 0, 0);
            ctx.clearRect(0, 0, d.w, d.h);
            /* Scene is already contain-fit to the frame's aspect ratio, so
               drawing edge-to-edge preserves proportions and centring. */
            ctx.drawImage(img, 0, 0, d.w, d.h);
            this._curIdx = idx;
          }
        }

        if (this._static) animF = n;                        /* static mode: finished view */

        /* Ride the callouts along with their layers. */
        if (animF !== this._lastAnimF) this._positionLabels(animF);

        /* Callouts: each has its own expansion-frame threshold, spread
           evenly between REVEAL_START_FRAME and REVEAL_END_FRAME, so they
           arrive one by one as the stack opens and leave one by one
           (reverse order) on the way back up. Hysteresis avoids flicker
           right at a threshold. */
        var count = LABELS.length;
        for (var li = 0; li < count; li++) {
          var at = REVEAL_START_FRAME + li * (REVEAL_END_FRAME - REVEAL_START_FRAME) / (count - 1);
          var vis = this._static ||
                    (this._lblShown[li] ? (animF >= at - REVEAL_HYST_FRAMES) : (animF >= at));
          if (vis !== this._lblShown[li]) {
            this._lblShown[li] = vis;
            els.lblEls[li].classList.toggle('show', vis);
            els.gridEls[li].classList.toggle('show', vis);
          }
        }

        /* Hint: gone after the first meaningful scroll (and in static mode). */
        if (!this._hinted && (p > 0.01 || this._static)) {
          this._hinted = true;
          els.hint.classList.add('off');
        } else if (this._hinted && p <= 0.001 && !this._static) {
          this._hinted = false;                             /* back at the very top: invite again */
          els.hint.classList.remove('off');
        }
      }
    };
  }

  /* small helpers */
  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /* Interpolate a label's anchor track at (fractional) expansion frame f.
     Clamps outside the keyframe range, lerps between keyframes inside. */
  function trackPos(track, f) {
    if (f <= track[0].f) return track[0];
    var last = track[track.length - 1];
    if (f >= last.f) return last;
    for (var k = 1; k < track.length; k++) {
      if (f <= track[k].f) {
        var a = track[k - 1], b = track[k];
        var t = (f - a.f) / (b.f - a.f);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    return last;
  }

  window.customElements.define('pad-exploder', PadExploderFactory());
})();
