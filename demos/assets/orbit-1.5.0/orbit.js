/*
* orbit
* v.1.5.0
* Author Juan Martin Muda - Zumerlab
* License MIT
*/
(() => {
  // src/js/orbit-layout.js
  var STATE = Symbol.for("zumer.orbit.layout.state.v1");
  var REGISTRY = Symbol.for("zumer.orbit.layout.registry.v1");
  var PROBE = Symbol.for("zumer.orbit.layout.probe.v1");
  var VISUALS = "o-arc, o-progress";
  var OBSERVE = { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true };
  function orbitNumber(element) {
    var _a;
    for (const token of element.classList || []) {
      if (/^orbit-\d+$/.test(token)) return Number(token.slice(6));
    }
    return ((_a = element.classList) == null ? void 0 : _a.contains("orbit")) ? null : void 0;
  }
  function setLayoutProperty(element, name, value) {
    const text = String(value);
    if (element.style.getPropertyValue(name) !== text) element.style.setProperty(name, text);
  }
  function cssNumber(element, value, fallback = 0, type = "number") {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    if (type === "number" && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) return Number(raw);
    const angle = raw.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(deg|rad|grad|turn)?$/);
    if (type === "angle" && angle) {
      return Number(angle[1]) * ({ deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 }[angle[2]] || 1);
    }
    const doc = element.ownerDocument;
    if (!(doc == null ? void 0 : doc.documentElement)) return fallback;
    let probe = doc[PROBE];
    if (!probe) {
      probe = doc.createElement("span");
      probe.setAttribute("data-orbit-measure", "");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "all:initial!important;position:fixed!important;visibility:hidden!important;pointer-events:none!important;width:0!important;height:0!important;overflow:hidden!important;";
      doc.documentElement.appendChild(probe);
      Object.defineProperty(doc, PROBE, { value: probe, configurable: true });
    }
    const property = type === "angle" ? "rotate" : "scale";
    probe.style.removeProperty(property);
    probe.style.setProperty(property, raw, "important");
    if (!probe.style.getPropertyValue(property)) return fallback;
    const computed = doc.defaultView.getComputedStyle(probe).getPropertyValue(property);
    const resolved = parseFloat(computed);
    return Number.isFinite(resolved) ? resolved : fallback;
  }
  function group(element) {
    if (element.localName === "o-arc") return "arc";
    for (const name of ["satellite", "vector", "side"]) if (element.classList.contains(name)) return name;
    return null;
  }
  function layoutRing(ring) {
    const counts = { arc: 0, satellite: 0, vector: 0, side: 0 };
    for (const child of ring.children) {
      const kind = group(child);
      if (kind) setLayoutProperty(child, "--o-layout-index", counts[kind]++ - (kind === "side" ? 1 : 0));
      else if (child.localName === "o-progress") setLayoutProperty(child, "--o-layout-index", 0);
    }
    const count = Math.max(counts.arc, counts.satellite, counts.vector, 1);
    const divisor = counts.side ? String(counts.side) : `max(1, ${count} - var(--o-fit-range, 0))`;
    setLayoutProperty(ring, "--o-layout-angle", `calc(var(--o-range, 360deg) / ${divisor})`);
  }
  function isScope(root) {
    return (root == null ? void 0 : root.nodeType) === 9 || (root == null ? void 0 : root.nodeType) === 11 && !!root.host;
  }
  function scopeFor(element) {
    var _a;
    if (isScope(element)) return element;
    const root = (_a = element == null ? void 0 : element.getRootNode) == null ? void 0 : _a.call(element);
    return isScope(root) ? root : null;
  }
  function composedContains(ancestor, node) {
    var _a, _b;
    for (let current = node; current; current = (_a = current.getRootNode) == null ? void 0 : _a.call(current).host) {
      if (ancestor === current || ((_b = ancestor.contains) == null ? void 0 : _b.call(ancestor, current))) return true;
    }
    return false;
  }
  function registryFor(doc) {
    if (!doc[REGISTRY]) Object.defineProperty(doc, REGISTRY, {
      value: { states: /* @__PURE__ */ new Set() },
      configurable: true
    });
    return doc[REGISTRY];
  }
  function dispose(state) {
    if (state.disposed) return;
    state.disposed = true;
    state.view.cancelAnimationFrame(state.frame);
    state.observer.disconnect();
    state.resize.disconnect();
    for (const remove of state.listeners) remove();
    state.rings.clear();
    state.visuals.clear();
    state.dirty.clear();
    state.registry.states.delete(state);
    if (state.scope[STATE] === state) delete state.scope[STATE];
  }
  function pruneDisconnected(registry) {
    for (const state of registry.states) {
      if (state.scope.host && !state.scope.host.isConnected) dispose(state);
    }
  }
  function invalidateDescendants(state, target = state.scope) {
    for (const other of state.registry.states) {
      if (other !== state && other.scope.host && composedContains(target, other.scope.host)) {
        other.all = true;
        other.queue();
      }
    }
  }
  function hasLayoutStructure(node) {
    if (node.nodeType !== 1 || node.hasAttribute("data-orbit-measure")) return false;
    if (orbitNumber(node) !== void 0 || node.matches(".gravity-spot, o-arc, o-progress")) return true;
    return !!node.querySelector(".gravity-spot, .orbit, [data-orbit-ring], o-arc, o-progress");
  }
  function hasStylesheet(node) {
    return node.nodeType === 1 && (node.matches('style, link[rel~="stylesheet"]') || !!node.querySelector('style, link[rel~="stylesheet"]'));
  }
  function needsDiscovery(record, state) {
    if (record.type === "childList") {
      return [...record.addedNodes, ...record.removedNodes].some(hasLayoutStructure);
    }
    if (record.attributeName !== "class") return false;
    const element = record.target;
    return state.rings.has(element) || element.classList.contains("gravity-spot") || orbitNumber(element) !== void 0 || (record.oldValue || "").split(/\s+/).some((token) => token === "gravity-spot" || token === "orbit" || /^orbit-\d+$/.test(token));
  }
  function createState(scope) {
    const doc = scope.nodeType === 9 ? scope : scope.ownerDocument;
    const view = doc.defaultView;
    const registry = registryFor(doc);
    const state = {
      scope,
      doc,
      view,
      registry,
      rings: /* @__PURE__ */ new Set(),
      visuals: /* @__PURE__ */ new Set(),
      dirty: /* @__PURE__ */ new Set(),
      scan: true,
      all: true,
      frame: 0,
      disposed: false,
      listeners: []
    };
    const listen = (target, event, listener, options) => {
      target == null ? void 0 : target.addEventListener(event, listener, options);
      state.listeners.push(() => target == null ? void 0 : target.removeEventListener(event, listener, options));
    };
    const queue = () => {
      if (!state.disposed && !state.frame) state.frame = view.requestAnimationFrame(() => {
        state.frame = 0;
        state.flush();
      });
    };
    state.queue = queue;
    state.flush = () => flush(state);
    state.invalidate = (target = scope, includeDescendants = true) => {
      var _a, _b;
      if (includeDescendants && (target === scope || target === doc.documentElement || target === doc.head)) state.all = true;
      else {
        for (const ring of state.rings) if (ring === target || ring.contains(target) || includeDescendants && ((_a = target.contains) == null ? void 0 : _a.call(target, ring))) state.dirty.add(ring);
        for (const visual of state.visuals) if (visual === target || visual.contains(target) || includeDescendants && ((_b = target.contains) == null ? void 0 : _b.call(target, visual))) state.dirty.add(visual);
      }
      if (state.all || state.dirty.size || state.scan) queue();
    };
    state.observer = new view.MutationObserver((records) => {
      var _a, _b;
      if (records.some((record) => record.type === "childList")) pruneDisconnected(registry);
      if (state.disposed) return;
      for (const record of records) {
        const target = record.target.nodeType === 3 ? record.target.parentElement : record.target;
        if (!target || ((_a = target.hasAttribute) == null ? void 0 : _a.call(target, "data-orbit-measure"))) continue;
        const structural = needsDiscovery(record, state);
        if (structural) state.scan = true;
        const stylesheetChange = record.type === "childList" && [...record.addedNodes, ...record.removedNodes].some(hasStylesheet);
        if (stylesheetChange || ((_b = target.closest) == null ? void 0 : _b.call(target, "head, style")) || target.localName === "link") {
          state.all = true;
          invalidateDescendants(state);
        } else if (record.type === "attributes") invalidateDescendants(state, target);
        state.invalidate(target, record.type === "attributes" || structural);
      }
    });
    state.observer.observe(scope, OBSERVE);
    state.resize = new view.ResizeObserver((entries) => {
      for (const entry of entries) state.dirty.add(entry.target);
      queue();
    });
    const invalidateAll = () => {
      state.all = true;
      invalidateDescendants(state);
      queue();
    };
    if (scope === doc) {
      listen(view, "resize", invalidateAll);
      listen(doc.fonts, "loadingdone", invalidateAll);
    }
    listen(scope, "load", (event) => {
      if (event.target.localName === "link") invalidateAll();
    }, true);
    for (const event of ["pointerover", "pointerout", "focusin", "focusout"]) {
      listen(scope, event, (e) => {
        state.invalidate(e.target);
        invalidateDescendants(state, e.target);
      }, true);
    }
    Object.defineProperty(scope, STATE, { value: state, configurable: true });
    registry.states.add(state);
    queue();
    return state;
  }
  function ensureState(scope) {
    const doc = scope.nodeType === 9 ? scope : scope.ownerDocument;
    if (!(doc == null ? void 0 : doc.defaultView) || !doc.documentElement || scope.host && !scope.host.isConnected) return null;
    if (scope[STATE] && scope[STATE].doc !== doc) dispose(scope[STATE]);
    if (scope.host) {
      const parent = scopeFor(scope.host);
      if (parent) ensureState(parent);
    }
    return scope[STATE] || createState(scope);
  }
  function discover(state) {
    const nextRings = /* @__PURE__ */ new Set();
    const automaticCounts = /* @__PURE__ */ new Map();
    for (const ring of state.scope.querySelectorAll(".gravity-spot > *")) {
      const number = orbitNumber(ring);
      if (number === void 0) continue;
      let automatic = automaticCounts.get(ring.parentElement) || 0;
      if (ring.classList.contains("orbit")) automaticCounts.set(ring.parentElement, ++automatic);
      const resolved = number === null ? automatic : number;
      ring.setAttribute("data-orbit-ring", "");
      setLayoutProperty(ring, "--o-layout-number", resolved === 0 ? 1e-5 : resolved);
      nextRings.add(ring);
      state.dirty.add(ring);
      if (!state.rings.has(ring)) state.resize.observe(ring);
    }
    for (const old of state.rings) if (!nextRings.has(old)) {
      state.resize.unobserve(old);
      old.removeAttribute("data-orbit-ring");
      for (const name of ["--o-layout-number", "--o-layout-angle"]) old.style.removeProperty(name);
    }
    state.rings = nextRings;
    const nextVisuals = new Set(state.scope.querySelectorAll(VISUALS));
    for (const old of state.visuals) if (!nextVisuals.has(old)) state.resize.unobserve(old);
    for (const visual of nextVisuals) if (!state.visuals.has(visual)) {
      state.resize.observe(visual);
      state.dirty.add(visual);
    }
    state.visuals = nextVisuals;
    state.scan = false;
  }
  function flush(state) {
    var _a;
    if (state.disposed) return;
    if (state.scope.host && !state.scope.host.isConnected) {
      dispose(state);
      return;
    }
    state.observer.disconnect();
    try {
      if (state.scan) discover(state);
      const dirty = state.all ? /* @__PURE__ */ new Set([...state.rings, ...state.visuals]) : state.dirty;
      const visuals = /* @__PURE__ */ new Set();
      for (const target of dirty) {
        if (!target.isConnected) continue;
        if (state.rings.has(target)) {
          layoutRing(target);
          for (const visual of target.querySelectorAll(VISUALS)) visuals.add(visual);
        } else if (state.visuals.has(target)) visuals.add(target);
      }
      for (const visual of state.visuals) if (visuals.has(visual)) (_a = visual.update) == null ? void 0 : _a.call(visual);
      state.dirty = /* @__PURE__ */ new Set();
      state.all = false;
    } finally {
      if (!state.disposed) state.observer.observe(state.scope, OBSERVE);
    }
  }
  function requestLayout(element = globalThis.document) {
    var _a;
    const scope = scopeFor(element);
    if (!scope) return;
    const state = ensureState(scope);
    if (!state) return;
    if (((_a = element == null ? void 0 : element.matches) == null ? void 0 : _a.call(element, VISUALS)) && !state.visuals.has(element)) state.scan = true;
    state.invalidate(element || scope);
  }
  function refreshLayout(root = globalThis.document) {
    const scope = scopeFor(root);
    if (!scope) return;
    const state = ensureState(scope);
    if (!state) return;
    pruneDisconnected(state.registry);
    for (const current of state.registry.states) {
      if (current !== state && (!current.scope.host || !composedContains(root, current.scope.host))) continue;
      current.scan = true;
      current.all = true;
      current.view.cancelAnimationFrame(current.frame);
      current.frame = 0;
      current.flush();
    }
  }

  // src/js/orbit-base.js
  var OrbitBase = class extends (globalThis.HTMLElement || class {
  }) {
    constructor() {
      super();
    }
    connectedCallback() {
      requestLayout(this);
    }
    disconnectedCallback() {
      if (this._textFrame) this.ownerDocument.defaultView.cancelAnimationFrame(this._textFrame);
      this._textFrame = 0;
    }
    readNumber(style, name, fallback = 0) {
      return cssNumber(this, style.getPropertyValue(name), fallback);
    }
    readAngle(style, name, fallback = 0) {
      return cssNumber(this, style.getPropertyValue(name), fallback, "angle");
    }
    getCommonAttributes(element) {
      var _a;
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      const measuredRadius = parseFloat(style.getPropertyValue("r"));
      const orbitRadius = Math.max(0, Number.isFinite(measuredRadius) ? measuredRadius : (((_a = element.parentElement) == null ? void 0 : _a.clientWidth) || 0) / 2);
      const orbitNumber2 = Math.max(1e-5, this.readNumber(style, "--o-orbit-number", 1));
      const size = Math.max(0, this.readNumber(style, "--o-size-ratio", 1));
      const strokeWidth = Math.max(0, this.readNumber(style, "--o-stroke-width", 1));
      const shape = element.getAttribute("shape") || "none";
      const arcHeight = Math.max(0, orbitRadius / orbitNumber2 * size - strokeWidth + 0.3);
      const arcHeightPercentage = orbitRadius > 0 ? Math.min(49.999, arcHeight * 25 / orbitRadius) : 0;
      let innerOuter = 0;
      if (element.classList.contains("outer-orbit")) {
        innerOuter = arcHeightPercentage;
      } else if (element.classList.contains("quarter-outer-orbit")) {
        innerOuter = arcHeightPercentage * -0.5;
      } else if (element.classList.contains("inner-orbit")) {
        innerOuter = arcHeightPercentage * -1;
      } else if (element.classList.contains("quarter-inner-orbit")) {
        innerOuter = arcHeightPercentage * 0.5;
      }
      const realRadius = 50 + innerOuter;
      return {
        orbitRadius,
        arcHeight,
        realRadius,
        arcAngle: 0,
        // Se sobrescribe en cada componente
        shape,
        arcHeightPercentage,
        orbitNumber: orbitNumber2,
        size,
        strokeWidth,
        style
      };
    }
    getProgressAngle(maxAngle, value, maxValue = 100) {
      if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) return 0;
      return Math.min(1, Math.max(0, value / maxValue)) * Math.max(0, Math.min(360, maxAngle));
    }
    getControlPoint(x, y, x1, y1, direction = "clockwise") {
      const xm = (x + x1) / 2;
      const ym = (y + y1) / 2;
      const dx = x1 - x;
      const dy = y1 - y;
      if (direction === "clockwise") {
        return {
          xc: xm + dy * 0.4,
          yc: ym - dx * 0.4
        };
      }
      return {
        xc: xm - dy * 0.4,
        yc: ym + dx * 0.4
      };
    }
    arcPoint(radius, angle, radiusAdjustment = 0, angleOffsetDegrees = 0) {
      const adjustedRadius = radius + radiusAdjustment;
      const adjustedAngle = angle + angleOffsetDegrees * Math.PI / 180;
      return {
        x: 50 + adjustedRadius * Math.cos(adjustedAngle),
        y: 50 + adjustedRadius * Math.sin(adjustedAngle)
      };
    }
    calculateCommonArcParameters(arcAngle, radius, arcHeightPercentage, orbitNumber2, shape, strokeWidth, arcHeight, gap = 0) {
      const offset = Math.PI / 2;
      const fangle = Math.max(0, Math.min(359.999999, arcAngle)) * Math.PI / 180;
      const bigRadius = radius + arcHeightPercentage;
      const smallRadius = Math.max(1e-3, radius - arcHeightPercentage);
      const bigGap = Math.min(fangle * 0.49, (gap + strokeWidth * 1.25) / orbitNumber2 / bigRadius);
      const smallGap = Math.min(fangle * 0.49, (gap + strokeWidth * 1.25) / orbitNumber2 / smallRadius);
      const upperAngleStart = bigGap - offset;
      const upperAngleEnd = fangle - bigGap - offset;
      const innerAngleStart = smallGap - offset;
      const innerAngleEnd = fangle - smallGap - offset;
      const upperArcStart = this.arcPoint(bigRadius, upperAngleStart);
      const upperArcEnd = this.arcPoint(bigRadius, upperAngleEnd);
      const innerArcStart = this.arcPoint(smallRadius, innerAngleStart);
      const innerArcEnd = this.arcPoint(smallRadius, innerAngleEnd);
      const upperSweep = upperAngleEnd - upperAngleStart;
      const innerSweep = innerAngleEnd - innerAngleStart;
      const largeArcFlagUpper = upperSweep > Math.PI ? 1 : 0;
      const largeArcFlagInner = innerSweep > Math.PI ? 1 : 0;
      return {
        upperArcStart,
        upperArcEnd,
        innerArcStart,
        innerArcEnd,
        largeArcFlag: largeArcFlagUpper,
        // back-compat alias; prefer the two below
        largeArcFlagUpper,
        largeArcFlagInner,
        bigRadius,
        smallRadius,
        radius,
        upperAngleStart,
        upperAngleEnd,
        innerAngleStart,
        innerAngleEnd
      };
    }
    generatePathData(shape, params, arcHeight, orbitNumber2) {
      let d = "";
      switch (shape) {
        case "rounded":
          d = this.generateRoundedPath(params, arcHeight, orbitNumber2);
          break;
        case "circle":
        case "circle-a":
        case "bullet":
          d = this.generateCirclePath(params, shape);
          break;
        case "circle-b":
          d = this.generateCircleBPath(params, arcHeight, orbitNumber2);
          break;
        case "arrow":
          d = this.generateArrowPath(params, orbitNumber2);
          break;
        case "backslash":
        case "slash":
          d = this.generateSlashPath(params, shape, orbitNumber2);
          break;
        case "zigzag":
          d = this.generateZigzagPath(params, arcHeight, orbitNumber2);
          break;
        default:
          d = this.generateDefaultPath(params);
      }
      return d;
    }
    generateRoundedPath(params, arcHeight, orbitNumber2) {
      const { bigRadius, smallRadius } = params;
      const available = Math.min(params.upperAngleEnd - params.upperAngleStart, params.innerAngleEnd - params.innerAngleStart);
      const curve = Math.min(arcHeight < 5 ? 2.5 : arcHeight < 10 ? 5 : 10, available * 180 / Math.PI * orbitNumber2 * 0.49);
      const capRad = curve / orbitNumber2 * Math.PI / 180;
      const flagU = params.upperAngleEnd - params.upperAngleStart - 2 * capRad > Math.PI ? 1 : 0;
      const flagI = params.innerAngleEnd - params.innerAngleStart - 2 * capRad > Math.PI ? 1 : 0;
      const newUpperStart = this.arcPoint(bigRadius, params.upperAngleStart, 0, curve / orbitNumber2);
      const newUpperEnd = this.arcPoint(bigRadius, params.upperAngleEnd, 0, -curve / orbitNumber2);
      const newInnerStart = this.arcPoint(smallRadius, params.innerAngleStart, 0, curve / orbitNumber2);
      const newInnerEnd = this.arcPoint(smallRadius, params.innerAngleEnd, 0, -curve / orbitNumber2);
      const upperPointStart = this.arcPoint(bigRadius, params.upperAngleStart, -(curve / 2) / orbitNumber2, 0);
      const upperPointEnd = this.arcPoint(bigRadius, params.upperAngleEnd, -(curve / 2) / orbitNumber2, 0);
      const innerPointStart = this.arcPoint(smallRadius, params.innerAngleStart, curve / 2 / orbitNumber2, 0);
      const innerPointEnd = this.arcPoint(smallRadius, params.innerAngleEnd, curve / 2 / orbitNumber2, 0);
      const Q = this.getControlPoint(newUpperEnd.x, newUpperEnd.y, upperPointEnd.x, upperPointEnd.y);
      const Q1 = this.getControlPoint(innerPointEnd.x, innerPointEnd.y, newInnerEnd.x, newInnerEnd.y);
      const Q2 = this.getControlPoint(newInnerStart.x, newInnerStart.y, innerPointStart.x, innerPointStart.y);
      const Q3 = this.getControlPoint(upperPointStart.x, upperPointStart.y, newUpperStart.x, newUpperStart.y);
      let d = `M ${newUpperStart.x},${newUpperStart.y} A ${bigRadius},${bigRadius} 0 ${flagU} 1 ${newUpperEnd.x},${newUpperEnd.y}`;
      d += `Q ${Q.xc},${Q.yc} ${upperPointEnd.x},${upperPointEnd.y} L ${innerPointEnd.x},${innerPointEnd.y}`;
      d += `Q ${Q1.xc},${Q1.yc} ${newInnerEnd.x},${newInnerEnd.y}`;
      d += `A ${smallRadius},${smallRadius} 0 ${flagI} 0 ${newInnerStart.x},${newInnerStart.y}`;
      d += `Q ${Q2.xc},${Q2.yc} ${innerPointStart.x},${innerPointStart.y} L ${upperPointStart.x},${upperPointStart.y}`;
      d += ` Q ${Q3.xc},${Q3.yc} ${newUpperStart.x},${newUpperStart.y}`;
      d += ` Z`;
      return d;
    }
    // Dentro de la clase OrbitCommon en orbit-common.js
    generateCirclePath(params, shape) {
      const { upperArcStart, upperArcEnd, innerArcStart, innerArcEnd, bigRadius, smallRadius, largeArcFlagUpper, largeArcFlagInner } = params;
      let d = `M ${upperArcStart.x},${upperArcStart.y} A ${bigRadius},${bigRadius} 0 ${largeArcFlagUpper} 1 ${upperArcEnd.x},${upperArcEnd.y}`;
      d += ` A 1,1 0 0 1 ${innerArcEnd.x},${innerArcEnd.y} `;
      d += ` A ${smallRadius},${smallRadius} 0 ${largeArcFlagInner} 0 ${innerArcStart.x},${innerArcStart.y}`;
      d += ` A 1,1 0 0 ${shape === "circle" || shape === "circle-a" ? 1 : 0} ${upperArcStart.x},${upperArcStart.y} `;
      d += ` Z`;
      return d;
    }
    generateCircleBPath(params, arcHeight, orbitNumber2) {
      const { upperAngleStart, upperAngleEnd, innerAngleStart, innerAngleEnd, bigRadius, smallRadius } = params;
      const available = Math.min(upperAngleEnd - upperAngleStart, innerAngleEnd - innerAngleStart);
      const segment = Math.min(arcHeight * 1.36, available * 180 / Math.PI * orbitNumber2 * 0.49);
      const capRad = segment / orbitNumber2 * Math.PI / 180;
      const flagU = upperAngleEnd - upperAngleStart - 2 * capRad > Math.PI ? 1 : 0;
      const flagI = innerAngleEnd - innerAngleStart - 2 * capRad > Math.PI ? 1 : 0;
      const newUpperStart = this.arcPoint(bigRadius, upperAngleStart, 0, segment / orbitNumber2);
      const newUpperEnd = this.arcPoint(bigRadius, upperAngleEnd, 0, -segment / orbitNumber2);
      const newInnerStart = this.arcPoint(smallRadius, innerAngleStart, 0, segment / orbitNumber2);
      const newInnerEnd = this.arcPoint(smallRadius, innerAngleEnd, 0, -segment / orbitNumber2);
      let d = `M ${newUpperStart.x},${newUpperStart.y} A ${bigRadius},${bigRadius} 0 ${flagU} 1 ${newUpperEnd.x},${newUpperEnd.y}`;
      d += ` A 1,1 0 0 1 ${newInnerEnd.x},${newInnerEnd.y} `;
      d += ` A ${smallRadius},${smallRadius} 0 ${flagI} 0 ${newInnerStart.x},${newInnerStart.y}`;
      d += ` A 1,1 0 0 1 ${newUpperStart.x},${newUpperStart.y} `;
      d += ` Z`;
      return d;
    }
    generateArrowPath(params, orbitNumber2) {
      const { upperArcStart, upperArcEnd, innerArcStart, innerArcEnd, bigRadius, smallRadius, largeArcFlagUpper, largeArcFlagInner, radius } = params;
      const middleEnd = this.arcPoint(radius, params.upperAngleEnd, 0, 24 / orbitNumber2 / 2);
      const middleStart = this.arcPoint(radius, params.upperAngleStart, 0, 24 / orbitNumber2 / 2);
      let d = `M ${upperArcStart.x},${upperArcStart.y} A ${bigRadius},${bigRadius} 0 ${largeArcFlagUpper} 1 ${upperArcEnd.x},${upperArcEnd.y}`;
      d += `L ${middleEnd.x} ${middleEnd.y}`;
      d += `L ${innerArcEnd.x} ${innerArcEnd.y}`;
      d += `A ${smallRadius},${smallRadius} 0 ${largeArcFlagInner} 0 ${innerArcStart.x}, ${innerArcStart.y}`;
      d += `L ${middleStart.x} ${middleStart.y}`;
      d += `Z`;
      return d;
    }
    generateSlashPath(params, shape, orbitNumber2) {
      const { upperAngleStart, upperAngleEnd, innerAngleStart, innerAngleEnd, bigRadius, smallRadius, largeArcFlagUpper, largeArcFlagInner } = params;
      const newUpperStart = this.arcPoint(bigRadius, upperAngleStart, 0, shape === "backslash" ? 0 : 24 / orbitNumber2 / 2);
      const newUpperEnd = this.arcPoint(bigRadius, upperAngleEnd, 0, shape === "backslash" ? 0 : 24 / orbitNumber2 / 2);
      const newInnerStart = this.arcPoint(smallRadius, innerAngleStart, 0, shape === "backslash" ? 24 / orbitNumber2 / 2 : 0);
      const newInnerEnd = this.arcPoint(smallRadius, innerAngleEnd, 0, shape === "backslash" ? 24 / orbitNumber2 / 2 : 0);
      let d = `M ${newUpperStart.x},${newUpperStart.y} A ${bigRadius},${bigRadius} 0 ${largeArcFlagUpper} 1 ${newUpperEnd.x},${newUpperEnd.y}`;
      d += `L ${newInnerEnd.x} ${newInnerEnd.y}`;
      d += `A ${smallRadius},${smallRadius} 0 ${largeArcFlagInner} 0 ${newInnerStart.x}, ${newInnerStart.y}`;
      d += `Z`;
      return d;
    }
    generateZigzagPath(params, arcHeight, orbitNumber2) {
      const { upperArcStart, upperArcEnd, innerArcStart, innerArcEnd, bigRadius, smallRadius, largeArcFlagUpper, largeArcFlagInner, radius } = params;
      const h2 = arcHeight / orbitNumber2 / 2;
      const s2 = this.arcPoint(radius, params.upperAngleStart, -h2, 3);
      const s3 = this.arcPoint(radius, params.upperAngleStart, 0, 0);
      const s4 = this.arcPoint(radius, params.upperAngleStart, h2, 3);
      const e2 = this.arcPoint(radius, params.innerAngleEnd, h2, 3);
      const e3 = this.arcPoint(radius, params.innerAngleEnd, 0, 0);
      const e4 = this.arcPoint(radius, params.innerAngleEnd, -h2, 3);
      let d = `M ${upperArcStart.x},${upperArcStart.y} A ${bigRadius},${bigRadius} 0 ${largeArcFlagUpper} 1 ${upperArcEnd.x},${upperArcEnd.y}`;
      d += `L ${e2.x} ${e2.y}`;
      d += `L ${e3.x} ${e3.y}`;
      d += `L ${e4.x} ${e4.y}`;
      d += `L ${innerArcEnd.x} ${innerArcEnd.y}`;
      d += `A ${smallRadius},${smallRadius} 0 ${largeArcFlagInner} 0 ${innerArcStart.x}, ${innerArcStart.y}`;
      d += `L ${s2.x} ${s2.y}`;
      d += `L ${s3.x} ${s3.y}`;
      d += `L ${s4.x} ${s4.y}`;
      d += `Z`;
      return d;
    }
    generateDefaultPath(params) {
      const { upperArcStart, upperArcEnd, innerArcStart, innerArcEnd, bigRadius, smallRadius, largeArcFlagUpper, largeArcFlagInner } = params;
      let d = `M ${upperArcStart.x},${upperArcStart.y} A ${bigRadius},${bigRadius} 0 ${largeArcFlagUpper} 1 ${upperArcEnd.x},${upperArcEnd.y}`;
      d += `L ${innerArcEnd.x} ${innerArcEnd.y}`;
      d += `A ${smallRadius},${smallRadius} 0 ${largeArcFlagInner} 0 ${innerArcStart.x}, ${innerArcStart.y}`;
      d += `Z`;
      return d;
    }
  };

  // src/js/orbit-progress.js
  var OrbitProgress = class extends OrbitBase {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
      <style>
        :host {
          --o-fill: var(--o-gray-light);
          --o-stroke: var(--o-fill);
          --o-stroke-width: 1;
          --o-back-fill: transparent;
          --o-back-stroke: none;
          --o-back-stroke-width: 1;
        }
        :host(:hover) {
          --o-fill: var(--o-gray-light);
          --o-stroke: var(--o-fill);
          --o-stroke-width: 1;
          --o-back-fill: transparent;
          --o-back-stroke: none;
          --o-back-stroke-width: 1;
        }
        svg {
          width: 100%;
          height: 100%;
          overflow: visible;
          pointer-events: none;
        }
        /* Display element by default: never steals clicks (see orbit-arc).
           Interaction is opt-in via the "interactive" attribute. */
        svg * {
          pointer-events: none;
        }
        :host([interactive]) svg * {
          pointer-events: visiblePainted;
        }
        :host([interactive]) {
          cursor: pointer;
        }
        .progress-bar {
          fill: var(--o-fill);
          stroke: var(--o-stroke);
          stroke-width: var(--o-stroke-width);
          transition: fill 0.25s, stroke 0.25s;
          stroke-linejoin: round;
        }
        .progress-bg {
          fill: var(--o-back-fill);
          stroke: var(--o-back-stroke);
          stroke-width: var(--o-back-stroke-width);
        }
        /* variant="stroke": the thin, legible gauge (registro "medidor").
           The default band is a FILLED donut wedge, so everyone building a
           thin gauge tripped on --o-fill/--o-back-fill. With this variant the
           paths are open arcs and the data color lives where you expect it:
           --o-stroke for the bar, --o-back-stroke for the track. */
        :host([variant="stroke"]) .progress-bar {
          fill: none;
          stroke: var(--o-stroke);
          stroke-width: var(--o-stroke-width, 2);
          stroke-linecap: round;
        }
        :host([variant="stroke"]) .progress-bg {
          fill: none;
          stroke: var(--o-back-stroke, var(--o-gray-light));
          stroke-width: var(--o-back-stroke-width, 1);
          stroke-linecap: round;
        }
      </style>
      <svg viewBox="0 0 100 100">
        <path class="progress-bg" shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke"></path>
        <path class="progress-bar" shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke"></path>
      </svg>
    `;
    }
    update() {
      const attrs = this.getAttributes();
      const isStroke = this.getAttribute("variant") === "stroke";
      const dBg = isStroke ? this.calculateStrokeArc(attrs, true) : this.calculateArcParameters(attrs, true);
      const dBar = isStroke ? this.calculateStrokeArc(attrs, false) : this.calculateArcParameters(attrs, false);
      this.shadowRoot.querySelector(".progress-bg").setAttribute("d", dBg);
      this.shadowRoot.querySelector(".progress-bar").setAttribute("d", dBar);
    }
    /**
     * variant="stroke": open arc along the orbit radius (no closed band),
     * stroked by CSS. Same progress math as the band variant.
     */
    calculateStrokeArc(attrs, full) {
      const { realRadius } = attrs;
      const arcAngle = Math.max(0, Math.min(this.getProgressAngle(attrs, full), 359.999999));
      if (!(arcAngle > 0) || !(attrs.orbitRadius > 0)) return "";
      const a0 = -90 * (Math.PI / 180);
      const a1 = (-90 + arcAngle) * (Math.PI / 180);
      const x0 = 50 + realRadius * Math.cos(a0);
      const y0 = 50 + realRadius * Math.sin(a0);
      const x1 = 50 + realRadius * Math.cos(a1);
      const y1 = 50 + realRadius * Math.sin(a1);
      const largeArcFlag = arcAngle > 180 ? 1 : 0;
      return `M ${x0},${y0} A ${realRadius},${realRadius} 0 ${largeArcFlag} 1 ${x1},${y1}`;
    }
    getAttributes() {
      const common = super.getCommonAttributes(this);
      const range = Math.max(0, Math.min(360, this.readAngle(common.style, "--o-range", 360)));
      const rawValue = common.style.getPropertyValue("--o-progress").trim();
      const progress = rawValue ? this.readNumber(common.style, "--o-progress", 0) : Number(this.getAttribute("value") || 0);
      const rawMax = this.getAttribute("max");
      const maxValue = rawMax === null ? 100 : Number(rawMax);
      return {
        ...common,
        range,
        progress,
        maxValue
      };
    }
    getProgressAngle(attrs, full) {
      const { range, progress, maxValue } = attrs;
      return full ? range : super.getProgressAngle(range, progress, maxValue);
    }
    calculateArcParameters(attrs, full) {
      const { shape, realRadius, arcHeightPercentage, orbitNumber: orbitNumber2, strokeWidth, arcHeight } = attrs;
      const arcAngle = this.getProgressAngle(attrs, full);
      if (!(arcAngle > 0) || !(attrs.orbitRadius > 0)) return "";
      const params = super.calculateCommonArcParameters(
        arcAngle,
        realRadius,
        arcHeightPercentage,
        orbitNumber2,
        shape,
        strokeWidth,
        arcHeight
      );
      return super.generatePathData(shape, params, arcHeight, orbitNumber2);
    }
  };

  // src/js/orbit-arc.js
  var template = typeof document === "undefined" ? null : document.createElement("template");
  if (template) template.innerHTML = `
  <style>
    :host {
      --o-fill: var(--o-gray-light);
      --o-stroke: var(--o-fill);
      --o-stroke-width: 1;
      --o-color: currentcolor;
    }
    :host(:hover) {
      --o-fill: var(--o-gray-light);
      --o-stroke: var(--o-fill);
      --o-stroke-width: 1;
      --o-color: currentcolor;
    }
    svg {
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }
    /* Arcs are display elements by default: they must NOT steal clicks from
       satellites/controls nearby (a painted arc used to capture clicks even
       at opacity 0, and pointer-events:none on the host could not pierce the
       shadow). Interaction is opt-in via the "interactive" attribute. */
    svg * {
      pointer-events: none;
    }
    :host([interactive]) svg * {
      pointer-events: visiblePainted;
    }
    :host([interactive]) {
      cursor: pointer;
    }
    #orbitShape {
      fill: var(--o-fill);
      stroke: var(--o-stroke);
      stroke-width: var(--o-stroke-width);
      transition: fill 0.25s, stroke 0.25s;
    }
    text {
      fill: var(--o-color);
    }
    #orbitPath {
      fill: transparent;
      stroke: none;
      stroke-width: 0;
    }
  </style>
  <svg viewBox="0 0 100 100">
    <path id="orbitShape" shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke"></path>
    <path id="orbitPath" shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke"></path>
    <text>
      <textPath href="#orbitPath" alignment-baseline="middle"></textPath>
    </text>
  </svg>
`;
  var OrbitArc = class extends OrbitBase {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }
    update() {
      const attrs = this.getAttributes();
      const { length, fontSize, textAnchor, fitRange } = attrs;
      if (this.hasAttribute("value")) {
        setLayoutProperty(this, "--o-arc-start", `${attrs.stackOffset}deg`);
        setLayoutProperty(this, "--o_stack", attrs.stackOffset + attrs.arcAngle);
      } else {
        this.style.removeProperty("--o-arc-start");
        this.style.removeProperty("--o_stack");
      }
      const orbitPath = this.shadowRoot.querySelector("#orbitPath");
      const orbitShape = this.shadowRoot.querySelector("#orbitShape");
      const textPath = this.shadowRoot.querySelector("textPath");
      orbitShape.setAttribute("d", this.calculateArcParameters(attrs).dShape);
      orbitPath.setAttribute("d", this.calculateTextArcParameters(attrs).dPath);
      if (textAnchor === "start") {
        textPath.setAttribute("startOffset", "0%");
        textPath.setAttribute("text-anchor", "start");
      } else if (textAnchor === "middle") {
        textPath.setAttribute("startOffset", "50%");
        textPath.setAttribute("text-anchor", "middle");
      } else if (textAnchor === "end") {
        textPath.setAttribute("startOffset", "100%");
        textPath.setAttribute("text-anchor", "end");
      }
      if (fitRange) {
        textPath.parentElement.setAttribute("textLength", orbitPath.getTotalLength());
      } else {
        textPath.parentElement.removeAttribute("textLength");
      }
      textPath.parentElement.style.fontSize = `calc(${fontSize} * (100 / (${length}) * (12 / var(--o-orbit-number)))`;
      textPath.textContent = this.textContent;
      this.warnIfTextOverflows(orbitPath, textPath, fitRange);
    }
    /**
     * Curved text has an explicit angular budget: glyphs past the end of the
     * arc path are clipped SILENTLY by SVG. Measure and warn so nobody loses
     * time to invisible truncation (~20 chars in 96° at default sizes).
     * fit-range squeezes the text to the path via textLength, so it never clips.
     */
    warnIfTextOverflows(orbitPath, textPath, fitRange) {
      const raw = (this.textContent || "").trim();
      if (!raw || fitRange || !this.isConnected) return;
      if (this._textFrame) this.ownerDocument.defaultView.cancelAnimationFrame(this._textFrame);
      this._textFrame = this.ownerDocument.defaultView.requestAnimationFrame(() => {
        this._textFrame = 0;
        if (!this.isConnected) return;
        try {
          const pathLen = orbitPath.getTotalLength();
          const textLen = textPath.parentElement.getComputedTextLength();
          if (pathLen > 0 && textLen > pathLen && this._truncWarned !== raw) {
            this._truncWarned = raw;
            console.warn(
              `[orbit] <o-arc> text "${raw.length > 34 ? raw.slice(0, 34) + "\u2026" : raw}" overflows its arc (${Math.round(textLen)} > ${Math.round(pathLen)} units) and will clip. Shorten the text, widen --o-range, or use fit-range to squeeze it.`
            );
          }
        } catch (e) {
        }
      });
    }
    getAttributes() {
      const common = super.getCommonAttributes(this);
      const { style } = common;
      const range = Math.max(0, Math.min(360, this.readAngle(style, "--o-range", 360)));
      const flip = this.hasAttribute("flip") || this.classList.contains("flip");
      const fitRange = this.hasAttribute("fit-range") || this.classList.contains("fit-range");
      const length = common.orbitRadius * 24 / common.orbitNumber || 100;
      const textAnchor = this.getAttribute("text-anchor") || "middle";
      const fontSize = style.fontSize || "16px";
      const gap = Math.max(0, this.readNumber(style, "--o-gap", 1));
      const value = Number(this.getAttribute("value"));
      const rawMax = this.getAttribute("max");
      const max = rawMax === null ? 100 : Number(rawMax);
      const arcAngle = this.hasAttribute("value") ? super.getProgressAngle(range, value, max) : Math.max(0, Math.min(360, this.readAngle(style, "--o-angle", 0)));
      let stackOffset = 0;
      if (this.hasAttribute("value")) {
        for (let prev = this.previousElementSibling; prev; prev = prev.previousElementSibling) {
          if (prev.localName !== "o-arc") continue;
          const previousStyle = this.ownerDocument.defaultView.getComputedStyle(prev);
          if (prev.hasAttribute("value")) {
            const prevMax = prev.hasAttribute("max") ? Number(prev.getAttribute("max")) : 100;
            const prevRange = cssNumber(prev, previousStyle.getPropertyValue("--o-range"), range, "angle");
            stackOffset += super.getProgressAngle(prevRange, Number(prev.getAttribute("value")), prevMax);
          } else stackOffset += cssNumber(prev, previousStyle.getPropertyValue("--o-angle"), 0, "angle");
        }
      }
      return { ...common, gap, arcAngle, stackOffset, flip, fitRange, length, fontSize, textAnchor };
    }
    calculateArcParameters(attrs) {
      const { arcAngle, realRadius, arcHeightPercentage, orbitNumber: orbitNumber2, shape, strokeWidth, arcHeight, gap } = attrs;
      if (!(arcAngle > 0) || !(attrs.orbitRadius > 0)) return { dShape: "" };
      const params = super.calculateCommonArcParameters(
        arcAngle,
        realRadius,
        arcHeightPercentage,
        orbitNumber2,
        shape,
        strokeWidth,
        arcHeight,
        gap
      );
      const dShape = super.generatePathData(shape, params, arcHeight, orbitNumber2);
      return { dShape };
    }
    calculateTextArcParameters(attrs) {
      const { arcAngle, realRadius, gap, flip } = attrs;
      if (!(arcAngle > 0)) return { dPath: "" };
      const adjustedGap = Math.min(gap * 0.5, arcAngle * 0.49);
      const sweepFlag = flip ? 0 : 1;
      const largeArcFlag = arcAngle <= 180 ? 0 : 1;
      let coordX1 = 50 + realRadius * Math.cos((-90 + adjustedGap) * (Math.PI / 180));
      let coordY1 = 50 + realRadius * Math.sin((-90 + adjustedGap) * (Math.PI / 180));
      let coordX2 = 50 + realRadius * Math.cos((arcAngle - 90 - adjustedGap) * Math.PI / 180);
      let coordY2 = 50 + realRadius * Math.sin((arcAngle - 90 - adjustedGap) * Math.PI / 180);
      const [startX, startY, endX, endY] = flip ? [coordX2, coordY2, coordX1, coordY1] : [coordX1, coordY1, coordX2, coordY2];
      const dPath = `M ${startX},${startY} A ${realRadius},${realRadius} 0 ${largeArcFlag} ${sweepFlag} ${endX},${endY}`;
      return { dPath };
    }
    calcularExpresionCSS(cssExpression) {
      return cssNumber(this, cssExpression, 0, "angle");
    }
  };

  // src/js/orbit-resize.js
  var resizing = /* @__PURE__ */ new WeakMap();
  var Orbit = {
    refresh: refreshLayout,
    resize(parentElementSelector) {
      var _a, _b;
      const parent = typeof parentElementSelector === "string" ? (_a = globalThis.document) == null ? void 0 : _a.querySelector(parentElementSelector) : parentElementSelector;
      if (!(parent == null ? void 0 : parent.ownerDocument)) {
        console.error("Orbit.resize: element not found:", parentElementSelector);
        return () => {
        };
      }
      (_b = resizing.get(parent)) == null ? void 0 : _b();
      const view = parent.ownerDocument.defaultView;
      const applyRatio = (width) => {
        if (!(width > 0)) return;
        for (const element of parent.querySelectorAll(".gravity-spot")) {
          const ratio = String(width / 500);
          if (element.style.getPropertyValue("--o-force-ratio") !== ratio) element.style.setProperty("--o-force-ratio", ratio);
        }
        refreshLayout(parent);
      };
      const observer = new view.ResizeObserver((entries) => {
        for (const entry of entries) applyRatio(entry.contentRect.width);
      });
      observer.observe(parent);
      applyRatio(parent.clientWidth || parent.getBoundingClientRect().width);
      const stop = () => {
        observer.disconnect();
        if (resizing.get(parent) === stop) resizing.delete(parent);
      };
      resizing.set(parent, stop);
      return stop;
    }
  };

  // src/orbit.js
  function registerOrbit() {
    if (typeof customElements === "undefined" || typeof document === "undefined") return;
    if (!customElements.get("o-progress")) customElements.define("o-progress", OrbitProgress);
    if (!customElements.get("o-arc")) customElements.define("o-arc", OrbitArc);
    requestLayout(document);
    window.Orbit = Orbit;
  }
  registerOrbit();
})();
