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
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
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
    let current = node;
    while (current && current !== document.documentElement) {
      const colour = parse(getComputedStyle(current).backgroundColor);
      if (colour && colour.a > 0) return colour;
      current = current.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
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
  for (const node of document.querySelectorAll('button, input, select, textarea, [role="tab"]')) {
    if (!shown(node) || node.classList.contains('visually-hidden')) continue;
    const name = node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent.trim()
      || (node.labels && node.labels.length ? [...node.labels].map(l => l.textContent.trim()).join(' ') : '');
    if (!name) unnamed.push({ tag: node.tagName.toLowerCase(), id: node.id || node.className.toString().slice(0, 24) });
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
    contrastFailures, smallTargets, unnamed, unfocusable,
    h1: document.querySelectorAll('h1').length,
    tabsWired: [...document.querySelectorAll('[role="tab"]')].every(tab => tab.hasAttribute('aria-selected')),
    panels: document.querySelectorAll('[role="tabpanel"]').length
  };
};

(async () => {
  const b = await chromium.launch(launchOptions());
  const findings = [];
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', e => errors.push(String(e)));
    await p.goto(url); await p.waitForTimeout(1500);
    // Open every collapsed panel too — the citation links live in there, and they were
    // the pairs that failed.
    await p.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));

    for (const tab of ['train', 'fuel', 'progress']) {
      await p.evaluate(name => setTab(name), tab);
      await p.waitForTimeout(400);
      const audit = await p.evaluate(AUDIT);
      findings.push({ scheme, tab, ...audit });
      t(`${scheme}/${tab}: text meets AA`, audit.contrastFailures.length === 0,
        JSON.stringify(audit.contrastFailures.slice(0, 4)));
      t(`${scheme}/${tab}: touch targets reach 40px`, audit.smallTargets.length === 0,
        JSON.stringify(audit.smallTargets.slice(0, 4)));
      t(`${scheme}/${tab}: every control has a name`, audit.unnamed.length === 0,
        JSON.stringify(audit.unnamed.slice(0, 4)));
      t(`${scheme}/${tab}: every button shows focus`, audit.unfocusable.length === 0,
        JSON.stringify(audit.unfocusable.slice(0, 4)));
    }
    const first = findings.find(f => f.scheme === scheme);
    t(`${scheme}: exactly one H1`, first.h1 === 1, String(first.h1));
    t(`${scheme}: tabs and panels wired`, first.tabsWired && first.panels === 3,
      JSON.stringify({ wired: first.tabsWired, panels: first.panels }));
    t(`${scheme}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  console.log(JSON.stringify({ results: R }, null, 1));
  await b.close();
  process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
