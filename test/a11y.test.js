// design.md commits to WCAG AA contrast in both themes, 40px touch targets, an
// accessible name on every control, and one H1. Those are claims, and a claim nobody
// measures drifts. This measures them, on every tab, in both themes.
//
// It computes ratios rather than reading them off a palette table, so it stays honest
// through a redesign — the rule in design.md is "re-run the audit after any palette
// change; do not eyeball it".
const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R = []; const t = (n, ok, d = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  -> ${d}` : ''}`);
const url = 'http://127.0.0.1:8911/';

const AUDIT = () => {
  const parse = colour => {
    const m = colour.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    const srgb = colour.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (srgb) return { r: +srgb[1] * 255, g: +srgb[2] * 255, b: +srgb[3] * 255, a: srgb[4] === undefined ? 1 : +srgb[4] };
    const oklch = colour.match(/oklch\(([\d.]+)(%)?\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%)?)?\)/);
    if (!oklch) return null;
    const L = +oklch[1] / (oklch[2] ? 100 : 1);
    const C = +oklch[3];
    const h = +oklch[4] * Math.PI / 180;
    const a = C * Math.cos(h); const b = C * Math.sin(h);
    const l0 = L + 0.3963377774 * a + 0.2158037573 * b;
    const m0 = L - 0.1055613458 * a - 0.0638541728 * b;
    const s0 = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l0 ** 3; const mm = m0 ** 3; const s = s0 ** 3;
    const linear = [
      4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s
    ];
    const gamma = value => 255 * Math.max(0, Math.min(1, value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055));
    return { r: gamma(linear[0]), g: gamma(linear[1]), b: gamma(linear[2]),
      a: oklch[5] === undefined ? 1 : +oklch[5] / (oklch[6] ? 100 : 1) };
  };
  const channel = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = c => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const flatten = (fg, bg) => (fg.a >= 1 ? fg : {
    r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1
  });
  const contrast = (a, b) => {
    const [hi, lo] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
    return (hi + 0.05) / (lo + 0.05);
  };
  const backdrop = node => {
    const layers = [];
    let current = node;
    while (current && current !== document.documentElement) {
      const colour = parse(getComputedStyle(current).backgroundColor);
      if (colour && colour.a > 0) layers.push(colour);
      current = current.parentElement;
    }
    let result = layers.pop() || { r: 255, g: 255, b: 255, a: 1 };
    while (layers.length) result = flatten(layers.pop(), result);
    return result;
  };
  const shown = node => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
  };

  const contrastFailures = [];
  for (const node of document.querySelectorAll('body *')) {
    if (!shown(node)) continue;
    const text = [...node.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
    if (!text) continue;
    const style = getComputedStyle(node);
    const ink = parse(style.color);
    if (!ink) continue;
    const bg = backdrop(node);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const required = large ? 3 : 4.5;
    const measured = contrast(flatten(ink, bg), bg);
    if (measured < required) {
      contrastFailures.push({ tag: node.tagName.toLowerCase(), text: text.slice(0, 28), ratio: +measured.toFixed(2), required });
    }
  }

  // The thing a thumb actually hits: a control wrapped in a label is as big as the
  // label. Measuring the bare input reported 21px boxes that are 46px in practice.
  const target = node => {
    const own = node.getBoundingClientRect();
    const wrapper = node.closest('label');
    const associated = node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`) : null;
    const boxes = [own, wrapper && wrapper.getBoundingClientRect(), associated && associated.getBoundingClientRect()].filter(Boolean);
    return { w: Math.round(Math.max(...boxes.map(b => b.width))), h: Math.round(Math.max(...boxes.map(b => b.height))) };
  };
  const smallTargets = [];
  for (const node of document.querySelectorAll('button, input, select, textarea, [role="tab"]')) {
    // A visually-hidden input driven by its own button is not a target.
    if (!shown(node) || node.classList.contains('visually-hidden')) continue;
    const box = target(node);
    if (box.h < 40) smallTargets.push({ tag: node.tagName.toLowerCase(), id: node.id || node.className.toString().slice(0, 24), ...box });
  }

  const unnamed = [];
  const unidentifiedFields = [];
  const smallInputText = [];
  for (const node of document.querySelectorAll('button, input, select, textarea, [role="tab"]')) {
    if (!shown(node) || node.classList.contains('visually-hidden')) continue;
    const name = node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent.trim()
      || (node.labels && node.labels.length ? [...node.labels].map(l => l.textContent.trim()).join(' ') : '');
    if (!name) unnamed.push({ tag: node.tagName.toLowerCase(), id: node.id || node.className.toString().slice(0, 24) });
    if (node.matches('input, select, textarea') && !node.id && !node.getAttribute('name')) {
      unidentifiedFields.push({ tag: node.tagName.toLowerCase(), className: node.className.toString().slice(0, 24) });
    }
    if (node.matches('input:not([type="checkbox"]):not([type="radio"]), select, textarea')
        && parseFloat(getComputedStyle(node).fontSize) < 16) {
      smallInputText.push({ tag: node.tagName.toLowerCase(), id: node.id || node.className.toString().slice(0, 24),
        fontSize: getComputedStyle(node).fontSize });
    }
  }

  const unfocusable = [];
  for (const node of document.querySelectorAll('button, [role="tab"]')) {
    if (!shown(node)) continue;
    node.focus();
    const style = getComputedStyle(node);
    const ring = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    const shadow = style.boxShadow && style.boxShadow !== 'none';
    if (!ring && !shadow) unfocusable.push(node.id || node.className.toString().slice(0, 24));
    node.blur();
  }

  return {
    contrastFailures, smallTargets, unnamed, unidentifiedFields, smallInputText, unfocusable,
    h1: document.querySelectorAll('h1').length,
    tabsWired: [...document.querySelectorAll('[role="tab"]')].every(tab => tab.hasAttribute('aria-selected')),
    panels: document.querySelectorAll('[role="tabpanel"]').length,
    overflows: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  };
};

(async () => {
  const b = await chromium.launch(launchOptions());
  const findings = [];
  // These audits deliberately reuse one browser in sequence so each theme/tab has
  // an isolated context and cannot leak media preferences or local state.
  /* eslint-disable no-await-in-loop */
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', e => errors.push(String(e)));
    await p.goto(url); await p.waitForTimeout(1500);
    // Open every collapsed panel too — the citation links live in there, and they were
    // the pairs that failed.
    await p.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));

    for (const tab of ['train', 'fuel', 'supplements', 'agent', 'progress']) {
      await p.evaluate(name => setTab(name), tab);
      if (tab === 'train') {
        await p.evaluate(() => {
          state.date = '2026-08-28';
          renderSession();
          document.querySelectorAll('details').forEach(details => { details.open = true; });
        });
      }
      await p.waitForTimeout(400);
      const audit = await p.evaluate(AUDIT);
      findings.push({ scheme, tab, ...audit });
      t(`${scheme}/${tab}: text meets AA`, audit.contrastFailures.length === 0,
        JSON.stringify(audit.contrastFailures.slice(0, 4)));
      t(`${scheme}/${tab}: touch targets reach 40px`, audit.smallTargets.length === 0,
        JSON.stringify(audit.smallTargets.slice(0, 4)));
      t(`${scheme}/${tab}: every control has a name`, audit.unnamed.length === 0,
        JSON.stringify(audit.unnamed.slice(0, 4)));
      t(`${scheme}/${tab}: every form field has a stable identity`, audit.unidentifiedFields.length === 0,
        JSON.stringify(audit.unidentifiedFields.slice(0, 4)));
      t(`${scheme}/${tab}: text inputs avoid iOS focus zoom`, audit.smallInputText.length === 0,
        JSON.stringify(audit.smallInputText.slice(0, 4)));
      t(`${scheme}/${tab}: every button shows focus`, audit.unfocusable.length === 0,
        JSON.stringify(audit.unfocusable.slice(0, 4)));
      t(`${scheme}/${tab}: no horizontal overflow`, !audit.overflows,
        `${audit.scrollWidth}/${audit.viewportWidth}`);
    }
    await p.evaluate(() => setTab('train'));
    const longNameOverflows = await p.evaluate(() => {
      const name = document.querySelector('.exercise-name');
      const textNode = [...name.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
      const original = textNode.textContent;
      textNode.textContent = 'W'.repeat(160);
      const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      textNode.textContent = original;
      return overflow;
    });
    t(`${scheme}: long exercise names wrap without widening the page`, !longNameOverflows);
    const first = findings.find(f => f.scheme === scheme);
    t(`${scheme}: exactly one H1`, first.h1 === 1, String(first.h1));
    t(`${scheme}: tabs and panels wired`, first.tabsWired && first.panels === 5,
      JSON.stringify({ wired: first.tabsWired, panels: first.panels }));
    t(`${scheme}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  /* eslint-enable no-await-in-loop */

  console.log(JSON.stringify({ results: R }, null, 1));
  await b.close();
  process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
