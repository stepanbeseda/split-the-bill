import qrcode from 'qrcode-generator';
import { epcPayload, spaydPayload } from '../core/payments';
import { assignedUnits, compileBill, computeSplit, type CompiledBill, type ItemState, type Split } from '../core/split';
import type { Bill, Cells } from '../core/types';
import { translator, type T } from './i18n';

const $ = <E extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as E;
const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const MAX_Q = 35;
const POLL_MS = 4000;

/* ===== Bootstrapping ===== */
const slug = /^\/b\/([a-z0-9-]+)\/?$/.exec(location.pathname)?.[1];
if (slug) loadBill(slug);
else landing();

async function landing() {
  const t = translator(navigator.language.startsWith('cs') ? 'cs' : 'en');
  let listed: { slug: string; title: string }[] = [];
  try {
    listed = await (await fetch('/bills/index.json')).json();
  } catch { /* no listed bills */ }
  $('#app').innerHTML = `<div class="landing"><div style="font-size:3rem">🧾</div><h1>${esc(t('landingTitle'))}</h1>
    <p>${esc(t('landingText'))}</p>${listed.map((b) => `<a class="btn primary" href="/b/${esc(b.slug)}">${esc(t('demo'))}: ${esc(b.title)}</a>`).join('')}</div>`;
}

async function loadBill(slug: string) {
  let bill: Bill;
  try {
    const r = await fetch(`/bills/${slug}.json`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 404 ? 'notFound' : 'loadError');
    bill = await r.json();
  } catch (e) {
    const t = translator(navigator.language.startsWith('cs') ? 'cs' : 'en');
    $('#app').innerHTML = `<div class="landing"><h1>🧾</h1><p>${esc(t((e as Error).message === 'notFound' ? 'notFound' : 'loadError'))}</p></div>`;
    return;
  }
  new BillApp(bill, slug).start();
}

/* ===== The bill page ===== */
class BillApp {
  private cb: CompiledBill;
  private t: T;
  private n: number;
  private cells: Cells = {};
  private me: number | null = null;
  private paidBack: Record<number, boolean> = {};
  private tab: 'items' | 'summary' = 'items';
  private storeKey: string;
  private api: string;
  private dirty = new Set<string>();
  private inflight = new Set<string>();
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private pushing = false;
  private pushSeq = 0;
  private retryDelay = 2000;
  private money: Intl.NumberFormat;
  private homeMoney: Intl.NumberFormat | null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private bill: Bill, slug: string) {
    this.cb = compileBill(bill);
    this.t = translator(bill.locale);
    this.n = bill.people.length;
    this.storeKey = `split-the-bill:${slug}`;
    this.api = `/api/state?bill=${encodeURIComponent(slug)}`;
    const loc = bill.locale === 'cs' ? 'cs-CZ' : 'en-GB';
    this.money = new Intl.NumberFormat(loc, { style: 'currency', currency: bill.currency });
    this.homeMoney = bill.settlement ? new Intl.NumberFormat(loc, { style: 'currency', currency: bill.settlement.currency }) : null;
    document.documentElement.lang = bill.locale;
    document.title = `${this.t('appTitle')} · ${bill.title}`;
  }

  /* --- formatting --- */
  private fmt = (minor: number) => this.money.format(Math.round(minor) / 100);
  private fmtHome = (minor: number) => (this.homeMoney ?? this.money).format(Math.round(minor) / 100);
  /** Amount people actually send: settlement currency if the bill has one. */
  private sendAmount = (S: Split, p: number) => (S.oweSettled ? S.oweSettled[p] : S.owe[p]);
  private payerTo = () => this.bill.payerDative ?? this.bill.payer;
  private label = (i: number) => {
    const it = this.cb.items[i];
    const dup = this.cb.items.filter((x) => x.name === it.name).length > 1;
    return it.name + (dup && it.note ? ` (${it.note})` : '');
  };
  private dateText = () =>
    new Intl.DateTimeFormat(this.bill.locale === 'cs' ? 'cs-CZ' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(
      new Date(this.bill.date + 'T12:00:00'),
    );
  private plural = (n: number) => (n === 1 ? this.t('items1') : n >= 2 && n <= 4 ? this.t('items2') : this.t('items5'));

  /* --- state --- */
  private cell = (p: number, i: number) => this.cells[`${p}.${i}`] ?? { q: 0, s: 0 as const, t: 0 };
  private setCell(p: number, i: number, q: number, s: boolean) {
    const k = `${p}.${i}`;
    this.cells[k] = { q, s: s ? 1 : 0, t: this.cells[k]?.t ?? 0 };
    this.dirty.add(k);
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.push(), 200);
  }
  private load() {
    try {
      const d = JSON.parse(localStorage.getItem(this.storeKey) ?? 'null');
      if (!d) return;
      this.cells = d.cells ?? {};
      this.paidBack = d.paidBack ?? {};
      this.me = Number.isInteger(d.me) && d.me >= 0 && d.me < this.n ? d.me : null;
    } catch { /* ignore broken storage */ }
  }
  private save() {
    try {
      localStorage.setItem(this.storeKey, JSON.stringify({ cells: this.cells, me: this.me, paidBack: this.paidBack }));
    } catch { /* private mode */ }
  }
  private filled = (S: Split, p: number) => S.lines[p].some((l) => l.q || (l.k ?? 0) < this.n);
  private isApprox = (S: Split, p: number) => (S.unassigned > 0 || S.over > 0) && S.lines[p].some((l) => !l.q && (l.k ?? 0) < this.n);

  /* --- sync: changes go out immediately, the server state is polled --- */
  private setSync(ok: boolean) {
    const el = $('#sync');
    el.className = 'sync ' + (ok ? 'on' : 'off');
    el.textContent = this.t(ok ? 'live' : 'offline');
  }
  private applyServer(server: Cells) {
    const before = JSON.stringify(this.cells);
    const keep = (k: string) => this.dirty.has(k) || this.inflight.has(k);
    for (const k of Object.keys(this.cells)) if (!(k in server) && !keep(k)) delete this.cells[k];
    for (const [k, c] of Object.entries(server)) if (!keep(k)) this.cells[k] = c;
    this.save();
    if (JSON.stringify(this.cells) !== before) this.render();
  }
  private async push() {
    if (this.pushing || !this.dirty.size) return;
    this.pushing = true;
    const keys = [...this.dirty];
    this.dirty.clear();
    keys.forEach((k) => this.inflight.add(k));
    try {
      const r = await fetch(this.api, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cells: Object.fromEntries(keys.map((k) => [k, this.cells[k]])) }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      this.pushSeq++;
      keys.forEach((k) => this.inflight.delete(k));
      this.applyServer(d.cells);
      if (d.rejected?.length) this.toast(this.t('beatYou'));
      this.setSync(true);
      this.retryDelay = 2000;
      if (this.dirty.size) this.pushTimer = setTimeout(() => this.push(), 50);
    } catch {
      keys.forEach((k) => {
        this.inflight.delete(k);
        this.dirty.add(k);
      });
      this.setSync(false);
      this.pushTimer = setTimeout(() => this.push(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30000);
    }
    this.pushing = false;
  }
  private async pull() {
    if (document.hidden) return;
    const seq = this.pushSeq;
    try {
      const r = await fetch(this.api, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (seq === this.pushSeq && !this.pushing) this.applyServer(d.cells);
      this.setSync(true);
    } catch {
      this.setSync(false);
    }
  }

  /* --- layout --- */
  start() {
    const t = this.t;
    const tip = this.cb.paid - this.cb.receipt;
    const pct = ((this.cb.paid / this.cb.receipt - 1) * 100).toLocaleString(this.bill.locale, { maximumFractionDigits: 1 });
    const eyebrow = [this.bill.title, this.bill.place, this.dateText()].filter(Boolean).map(esc).join(' · ');
    $('#app').innerHTML = `
      <header>
        <div class="eyebrow">${eyebrow}</div>
        <h1>${esc(t('appTitle'))} 🧾</h1>
        <div class="stats">
          <div><span>${esc(t('receipt'))}</span><b>${this.fmt(this.cb.receipt)}</b></div>
          <div><span>${esc(t('paid'))}</span><b>${this.fmt(this.cb.paid)}</b>${this.cb.settlement ? `<small>${this.fmtHome(this.cb.settlement.amount)}</small>` : ''}</div>
          <div><span>${esc(t('tip'))}</span><b>${this.fmt(tip)}</b><small>${pct} %</small></div>
        </div>
        <div id="sync" class="sync"></div>
      </header>
      <nav class="tabs" role="tablist">
        <button role="tab" data-act="tab" data-tab="items">${esc(t('tabItems'))}</button>
        <button role="tab" data-act="tab" data-tab="summary">${esc(t('tabSummary'))}</button>
      </nav>
      <section id="tab-items">
        <details class="help" id="help" open>
          <summary>${esc(t('howTo'))}</summary>
          <ol><li>${esc(t('step1'))}</li><li>${esc(t('step2'))}</li><li>${esc(t('step3', { n: this.n }))}</li><li>${esc(t('step4'))}</li></ol>
          <p>${esc(t('liveNote'))}</p><p>${esc(t('tipNote'))}</p>
        </details>
        <h2 class="label">${esc(t('whoAreYou'))}</h2>
        <div class="chips" id="people"></div>
        <div class="hint" id="pick-hint">${esc(t('pickFirst'))}</div>
        <div id="items"></div>
      </section>
      <section id="tab-summary" hidden>
        <div class="card" id="progress"></div>
        <div class="card people-card" id="people-sum"></div>
        <div class="card totals" id="totals"></div>
        <div id="issues"></div>
        <div class="actions">
          <button class="btn primary" data-act="copy-summary">${esc(t('copySummary'))}</button>
          <button class="btn" data-act="share-invite">${esc(t('shareLink'))}</button>
          <button class="btn danger" data-act="reset">${esc(t('resetAll'))}</button>
        </div>
        <p class="fine">${esc(t('fine'))}</p>
      </section>`;
    for (const [id, key] of [['pay-acc-l', 'account'], ['pay-amt-l', 'amount'], ['pay-msg-l', 'message'], ['pay-close', 'close'],
      ['pay-share', 'shareToGroup'], ['share-title', 'sendThis'], ['share-hint', 'sendThisHint'], ['share-close', 'close'], ['share-copy', 'copy'], ['bar-pay', 'pay']] as const) {
      $('#' + id).textContent = t(key);
    }
    this.load();
    if (this.me != null) ($('#help') as HTMLDetailsElement).open = false;
    document.addEventListener('click', (e) => this.onClick(e));
    addEventListener('storage', (e) => {
      if (e.key === this.storeKey) {
        this.load();
        this.render();
      }
    });
    this.render();
    this.pull();
    setInterval(() => this.pull(), POLL_MS);
    document.addEventListener('visibilitychange', () => !document.hidden && this.pull());
    // Netlify can inject a badge in the bottom-right corner; keep the action bar above it.
    const markBadge = () => document.body.classList.toggle('has-badge', !!document.getElementById('nl-badge-frame'));
    new MutationObserver(markBadge).observe(document.body, { childList: true });
    markBadge();
  }

  private render() {
    const S = computeSplit(this.cb, this.cells);
    document.querySelectorAll<HTMLElement>('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === this.tab)));
    $('#tab-items').hidden = this.tab !== 'items';
    $('#tab-summary').hidden = this.tab !== 'summary';
    this.renderPeople(S);
    this.renderItems(S);
    this.renderBar(S);
    this.renderSummary(S);
  }

  private renderPeople(S: Split) {
    $('#people').innerHTML = this.bill.people
      .map((name, p) => `<button class="chip${p === this.me ? ' on' : ''}" data-act="me" data-p="${p}" aria-pressed="${p === this.me}">${esc(name)}${this.filled(S, p) ? '<i class="dot"></i>' : ''}</button>`)
      .join('');
    $('#pick-hint').hidden = this.me != null;
  }

  /** A fully taken item moves to the bottom – unless I have a part of it. */
  private isGone(i: number, x: ItemState) {
    if (assignedUnits(this.cb, x, i) < this.cb.items[i].qty || x.over) return false;
    if (this.me == null) return true;
    const c = this.cell(this.me, i);
    return !c.q && !c.s;
  }

  private renderItems(S: Split) {
    const goneWasOpen = !!document.querySelector('#items details.gone[open]');
    const cats: string[] = [];
    this.cb.items.forEach((it) => !cats.includes(it.category) && cats.push(it.category));
    let html = '';
    let gone = '';
    let nGone = 0;
    for (const cat of cats) {
      const idx = this.cb.items.map((_, i) => i).filter((i) => this.cb.items[i].category === cat);
      const vis = idx.filter((i) => !this.isGone(i, S.items[i]));
      idx.filter((i) => this.isGone(i, S.items[i])).forEach((i) => {
        gone += this.itemHtml(i, S.items[i]);
        nGone++;
      });
      if (vis.length) html += (cat ? `<h2 class="group">${esc(cat)}</h2>` : '') + vis.map((i) => this.itemHtml(i, S.items[i])).join('');
    }
    if (!html) html = `<p class="hint">${esc(this.t('allTaken'))}</p>`;
    if (nGone) html += `<details class="gone"${goneWasOpen ? ' open' : ''}><summary>${esc(this.t('alreadyTaken', { n: nGone }))}</summary>${gone}</details>`;
    $('#items').innerHTML = html;
  }

  private itemHtml(i: number, x: ItemState) {
    const t = this.t;
    const it = this.cb.items[i];
    const done = assignedUnits(this.cb, x, i);
    const st = x.over ? 'bad' : done === it.qty ? 'ok' : done ? 'part' : 'none';
    const tags = x.claims.map(([p, q]) => `<span class="tag${p === this.me ? ' me' : ''}">${esc(this.bill.people[p])} ${q}×</span>`);
    if (x.sharers.length) {
      const who = x.sharers.length === this.n ? t('wholeTable') : x.sharers.map((p) => this.bill.people[p]).join(', ');
      tags.push(`<span class="tag shared">👥 ${esc(who)}${x.per ? ' · ' + this.fmt(x.per) + esc(t('perPerson')) : ''}</span>`);
    }
    const warn = x.over ? t('overWarn', { n: x.over }) : x.sharers.length && !x.rest ? t('shareNothing') : '';
    const pill = x.over ? t('extra', { n: x.over }) : done === it.qty ? t('taken') : t('left', { n: it.qty - done });
    let ctl = '';
    if (this.me != null) {
      const c = this.cell(this.me, i);
      const all = x.sharers.length === this.n;
      ctl = `<div class="ctl">
        <button class="toggle${c.s ? ' on' : ''}" data-act="share" data-i="${i}" aria-pressed="${!!c.s}">${esc(t('shared'))}</button>
        <button class="linkbtn${all ? ' on' : ''}" data-act="table" data-i="${i}" aria-pressed="${all}">${esc(t('wholeTable'))}${all ? ' ✓' : ''}</button>
        <div class="stepper${c.q ? ' has' : ''}">
          <button data-act="dec" data-i="${i}" aria-label="− ${esc(this.label(i))}"${c.q ? '' : ' disabled'}>−</button>
          <output>${c.q}</output>
          <button data-act="inc" data-i="${i}" aria-label="+ ${esc(this.label(i))}"${x.rest ? '' : ' disabled'}>+</button>
        </div>
      </div>`;
    }
    return `<div class="item st-${st}">
      <div class="top">
        <div class="name">${esc(it.name)}${it.note ? `<small>${esc(it.note)}</small>` : ''}</div>
        <div class="price">${it.qty > 1 ? `${it.qty} × ${this.fmt(it.price)}<small>${esc(t('total'))} ${this.fmt(it.qty * it.price)}</small>` : this.fmt(it.price)}</div>
      </div>
      <div class="who">${tags.join('') || `<span class="muted">${esc(t('nobodyYet'))}</span>`}<span class="pill">${esc(pill)}</span></div>
      ${warn ? `<div class="warn">${esc(warn)}</div>` : ''}
      ${ctl}
    </div>`;
  }

  private renderBar(S: Split) {
    const show = this.me != null && this.tab === 'items';
    $('#bar').hidden = !show;
    document.body.classList.toggle('has-bar', show);
    if (this.me == null || !show) return;
    const p = this.me;
    const spent = Math.round(S.spent[p]);
    $('#bar-name').textContent = this.bill.people[p];
    $('#bar-amount').textContent = (this.isApprox(S, p) ? '≈ ' : '') + this.fmtHome(this.sendAmount(S, p));
    $('#bar-detail').textContent = spent
      ? (S.oweSettled ? this.fmt(S.owe[p]) + ' · ' : '') + this.t('spentPlusTip', { spent: this.fmt(spent), tip: this.fmt(S.owe[p] - spent) })
      : this.t('nothingYet');
  }

  private renderSummary(S: Split) {
    const t = this.t;
    const done = !S.unassigned && !S.over;
    const assigned = this.cb.receipt - S.unassigned;
    const pct = Math.round((assigned / this.cb.receipt) * 100);
    $('#progress').innerHTML = `
      <div class="prog-head"><b>${esc(done ? t('allDone') : t('splitOf', { a: this.fmt(assigned), b: this.fmt(this.cb.receipt) }))}</b><span>${pct} %</span></div>
      <div class="prog"><i style="width:${Math.min(100, pct)}%"></i></div>`;

    const payerView = this.me === this.cb.payer;
    const openRows = new Set([...document.querySelectorAll<HTMLElement>('#people-sum details[open]')].map((d) => +d.dataset.p!));
    let owed = 0;
    let waiting = 0;
    $('#people-sum').innerHTML = this.bill.people
      .map((name, p) => {
        const L = S.lines[p];
        const spent = Math.round(S.spent[p]);
        const isPayer = p === this.cb.payer;
        const send = this.sendAmount(S, p);
        if (!isPayer) {
          owed += send;
          if (!this.paidBack[p]) waiting += send;
        }
        const meta = (isPayer ? t('paidTheBill') + ' · ' : '') + (this.filled(S, p) ? `${L.length} ${this.plural(L.length)}` : L.length ? t('onlyShared') : t('nothingYet'));
        const paidBtn =
          payerView && !isPayer && send
            ? `<button class="paid${this.paidBack[p] ? ' on' : ''}" data-act="paid" data-p="${p}" aria-pressed="${!!this.paidBack[p]}">${esc(t(this.paidBack[p] ? 'arrived' : 'waiting'))}</button>`
            : '';
        const lines = L.map((l) => {
          const nm = this.label(l.item);
          const txt = l.q ? `${l.q}× ${nm}` : t('sharedLine', { name: nm, rest: l.rest! < this.cb.items[l.item].qty ? ` (${l.rest})` : '', k: l.k! });
          return `<li><span>${esc(txt)}</span><span>${this.fmt(l.amount)}</span></li>`;
        }).join('');
        const body = L.length
          ? `<ul class="lines">${lines}
              <li class="sub first"><span>${esc(t('spentLabel'))}</span><span>${this.fmt(spent)}</span></li>
              <li class="sub"><span>${esc(t('plusTip'))}</span><span>${this.fmt(S.owe[p] - spent)}</span></li>
              <li class="tot"><span>${esc(isPayer ? t('share') : t('sends', { payer: this.payerTo() }))}</span><span>${this.fmt(S.owe[p])}</span></li>
              ${S.oweSettled ? `<li class="tot"><span>${esc(t('inHome', { cur: this.cb.settlement!.currency }))}</span><span>${this.fmtHome(S.oweSettled[p])}</span></li>` : ''}
            </ul>${isPayer || this.bill.payment.scheme === 'none' ? '' : `<button class="qrbtn" data-act="pay" data-p="${p}">${esc(t('qrPay'))}</button>`}`
          : `<p class="muted pad">${esc(t('nothingPicked'))}</p>`;
        return `<details class="person${this.paidBack[p] && !isPayer ? ' is-paid' : ''}" data-p="${p}"${openRows.has(p) ? ' open' : ''}>
          <summary><span class="pname">${esc(name)}</span><span class="pmeta">${esc(meta)}</span>${paidBtn}
            <span class="pamount">${this.isApprox(S, p) ? '≈ ' : ''}${this.fmtHome(send)}${S.oweSettled ? `<small>${this.fmt(S.owe[p])}</small>` : ''}</span></summary>
          ${body}
        </details>`;
      })
      .join('');

    const payerSend = this.sendAmount(S, this.cb.payer);
    const target = this.cb.settlement ? this.cb.settlement.amount : this.cb.paid;
    $('#totals').innerHTML = `
      <div><span>${esc(t('othersSend', { payer: this.payerTo() }))}</span><b>${this.fmtHome(owed)}</b></div>
      <div><span>${esc(t('payerOwn', { payer: this.bill.payer }))}</span><b>${this.fmtHome(payerSend)}</b></div>
      ${payerView ? `<div><span>${esc(t('stillToCome'))}</span><b>${this.fmtHome(waiting)}</b></div>` : ''}
      <div class="sum"><span>${esc(t(done ? 'sumTotal' : 'sumSoFar'))}</span><b>${this.fmtHome(owed + payerSend)} / ${this.fmtHome(target)}</b></div>`;

    const list = (key: 'unassigned' | 'over') =>
      S.items.map((x, i) => (x[key] ? `<li><span>${x[key]}× ${esc(this.label(i))}</span><span>${this.fmt(x[key] * this.cb.items[i].price)}</span></li>` : '')).join('');
    $('#issues').innerHTML =
      (S.unassigned ? `<div class="card issue"><h3>${esc(t('unassignedTitle', { a: this.fmt(S.unassigned) }))}</h3><ul class="lines">${list('unassigned')}</ul><p>${esc(t('unassignedHint'))}</p></div>` : '') +
      (S.over ? `<div class="card issue bad"><h3>${esc(t('overTitle', { a: this.fmt(S.over) }))}</h3><ul class="lines">${list('over')}</ul><p>${esc(t('overHint'))}</p></div>` : '');
  }

  /* --- payment dialog --- */
  private qrMessage = (p: number) => this.t('qrMessage', { name: this.bill.people[p], title: this.bill.title });
  private openPay(p: number, mine: boolean) {
    const t = this.t;
    const S = computeSplit(this.cb, this.cells);
    const isPayer = p === this.cb.payer;
    const amount = isPayer ? 0 : this.sendAmount(S, p);
    const name = this.bill.people[p];
    $('#pay-title').textContent = t(isPayer ? 'payTitlePayer' : mine ? 'payTitleMine' : 'payTitleOther', { name, payer: this.payerTo() });
    $('#pay-amount').textContent = this.fmtHome(this.sendAmount(S, p));
    const spent = Math.round(S.spent[p]);
    $('#pay-sub').textContent = (S.oweSettled ? '= ' + this.fmt(S.owe[p]) + ' · ' : '') + t('spentPlusTip', { spent: this.fmt(spent), tip: this.fmt(S.owe[p] - spent) });
    const warn = isPayer ? t('payerNote') : !amount ? t('nothingToPay') : this.isApprox(S, p) ? t('approx') : S.unassigned || S.over ? t('notComplete') : '';
    $('#pay-warn').textContent = warn;
    $('#pay-warn').hidden = !warn;
    const pay = this.bill.payment;
    const showQr = !!amount && pay.scheme !== 'none';
    if (showQr) {
      const payload =
        pay.scheme === 'epc'
          ? epcPayload({ iban: pay.iban, amount, beneficiary: pay.beneficiary, message: this.qrMessage(p) })
          : spaydPayload({ iban: pay.iban, amount, currency: this.cb.settlement?.currency ?? this.bill.currency, message: this.qrMessage(p), beneficiary: pay.beneficiary });
      const q = qrcode(0, 'M');
      q.addData(pay.scheme === 'epc' ? toUtf8Binary(payload) : payload);
      q.make();
      $('#pay-qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
      $('#pay-acc').textContent = pay.accountLabel ?? pay.iban;
      $('#pay-amt').textContent = this.fmtHome(amount);
      $('#pay-msg').textContent = this.qrMessage(p);
    }
    $('#pay-qr').hidden = !showQr;
    $('#pay-info').hidden = !showQr;
    $('#pay-share').hidden = !(mine && isPayer);
    ($('#dlg-pay') as HTMLDialogElement).showModal();
  }

  /* --- texts to share --- */
  private inviteText = () => this.t('invite', { title: this.bill.title, url: location.origin + location.pathname });
  private summaryText(S: Split) {
    const t = this.t;
    const pay = this.bill.payment;
    const out = [
      t('summaryHead', {
        title: this.bill.title, date: this.dateText(), paid: this.fmt(this.cb.paid),
        home: this.cb.settlement ? ` = ${this.fmtHome(this.cb.settlement.amount)}` : '',
        receipt: this.fmt(this.cb.receipt), tip: this.fmt(this.cb.paid - this.cb.receipt),
      }),
    ];
    if (S.unassigned) out.push(t('summaryMissing', { a: this.fmt(S.unassigned) }));
    if (S.over) out.push(t('summaryOver', { a: this.fmt(S.over) }));
    const acc = pay.scheme === 'none' ? '' : t('summaryAccount', { acc: pay.accountLabel ?? pay.iban });
    out.push('', t('summaryAsk', { payer: this.payerTo(), account: acc }));
    this.bill.people.forEach((name, p) => {
      if (p !== this.cb.payer) out.push(`• ${name}: ${this.fmtHome(this.sendAmount(S, p))}${S.oweSettled ? ` (${this.fmt(S.owe[p])})` : ''}`);
    });
    out.push('', `(${this.bill.payer}: ${this.fmtHome(this.sendAmount(S, this.cb.payer))})`);
    return out.join('\n');
  }

  private async shareText(text: string) {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    this.openShareDialog(text);
  }
  private openShareDialog(text: string) {
    ($('#share-text') as HTMLTextAreaElement).value = text;
    ($('#share-wa') as HTMLAnchorElement).href = 'https://wa.me/?text=' + encodeURIComponent(text);
    ($('#dlg-share') as HTMLDialogElement).showModal();
  }
  private async copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fall back below */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch { /* nothing else to try */ }
    ta.remove();
    return ok;
  }
  private toast(msg: string) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (el.hidden = true), 3500);
  }

  private async reset() {
    if (!confirm(this.t('resetConfirm'))) return;
    const tokenKey = 'split-the-bill:admin';
    let token = localStorage.getItem(tokenKey) ?? '';
    if (!token) token = prompt(this.t('adminPrompt')) ?? '';
    if (!token) return;
    const r = await fetch(this.api, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ reset: true }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      localStorage.removeItem(tokenKey);
      this.toast(d.error ?? `HTTP ${r.status}`);
      return;
    }
    localStorage.setItem(tokenKey, token);
    this.dirty.clear();
    this.applyServer(d.cells);
    this.toast(this.t('resetDone'));
  }

  /* --- input --- */
  private async onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const act = el.dataset.act!;
    const i = Number(el.dataset.i);
    const p = Number(el.dataset.p);
    const me = this.me;
    if (['inc', 'dec', 'share', 'table', 'pay-me'].includes(act) && me == null) return;
    switch (act) {
      case 'tab': {
        this.tab = el.dataset.tab as 'items' | 'summary';
        const top = $('.tabs').offsetTop;
        if (scrollY > top) scrollTo(0, top);
        break;
      }
      case 'me':
        this.me = p;
        ($('#help') as HTMLDetailsElement).open = false;
        break;
      case 'inc': {
        const c = this.cell(me!, i);
        this.setCell(me!, i, Math.min(MAX_Q, c.q + 1), !!c.s);
        break;
      }
      case 'dec': {
        const c = this.cell(me!, i);
        this.setCell(me!, i, Math.max(0, c.q - 1), !!c.s);
        break;
      }
      case 'share': {
        const c = this.cell(me!, i);
        this.setCell(me!, i, c.q, !c.s);
        break;
      }
      case 'table': {
        const all = computeSplit(this.cb, this.cells).items[i].sharers.length === this.n;
        for (let q = 0; q < this.n; q++) {
          const c = this.cell(q, i);
          if (!!c.s === all) this.setCell(q, i, c.q, !all);
        }
        break;
      }
      case 'paid':
        e.preventDefault();
        this.paidBack[p] = !this.paidBack[p];
        break;
      case 'pay-me':
        return this.openPay(me!, true);
      case 'pay':
        e.preventDefault();
        return this.openPay(p, false);
      case 'share-invite':
        ($('#dlg-pay') as HTMLDialogElement).close();
        return this.shareText(this.inviteText());
      case 'copy-summary': {
        const text = this.summaryText(computeSplit(this.cb, this.cells));
        if (await this.copyText(text)) this.toast(this.t('summaryCopied'));
        else this.openShareDialog(text);
        return;
      }
      case 'copy-share':
        if (await this.copyText(($('#share-text') as HTMLTextAreaElement).value)) {
          this.toast(this.t('copied'));
          ($('#dlg-share') as HTMLDialogElement).close();
        } else this.toast(this.t('copyFailed'));
        return;
      case 'close':
        el.closest('dialog')!.close();
        return;
      case 'reset':
        return this.reset();
      default:
        return;
    }
    this.save();
    this.render();
  }
}

/** EPC QR declares UTF-8, but qrcode-generator writes one byte per char code – encode first. */
function toUtf8Binary(s: string) {
  return String.fromCharCode(...new TextEncoder().encode(s));
}
