/**
 * Simulação visual LENTA do fluxo completo de troca.
 * Cada ator entra, abre o documento, rola até a fase e assina na tela.
 * Inicie a gravação quando o Chromium abrir.
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8080/';
const BROWSERS =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  'C:\\Users\\SALES\\AppData\\Local\\Temp\\cursor-sandbox-cache\\18807c1395b446c84272275d310a4b9d\\playwright';

const ACTORS = {
  a: { re: '555555-5', pass: '963511', label: 'Despachador A · solicitante' },
  b: { re: '666666-6', pass: '634931', label: 'Despachador B · interessado' },
  sa: { re: '333333-3', pass: '676450', label: 'Supervisor A · Passo 2' },
  sb: { re: '444444-4', pass: '131447', label: 'Supervisor B · Passo 2' },
  ca: { re: '111111-1', pass: '539856', label: 'Chefe Equipe A · Passo 3' },
  cb: { re: '222222-2', pass: '955650', label: 'Chefe Equipe B · Passo 3' },
};

const PAUSE = {
  banner: 4200,
  afterLogin: 2800,
  afterAction: 2200,
  afterSign: 4500,
  tour: 1600,
  betweenActors: 3200,
  final: 10000,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function banner(page, text, ms = PAUSE.banner) {
  await page.evaluate((msg) => {
    let el = document.getElementById('sim-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sim-banner';
      el.style.cssText =
        'position:fixed;z-index:2147483647;left:16px;right:16px;top:14px;padding:16px 20px;' +
        'background:#0b1f33;color:#fff;font:700 18px/1.35 Segoe UI,sans-serif;' +
        'border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.4);pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
  }, text);
  await sleep(ms);
}

/** Rola o container scrollável do dialog até o elemento ficar visível. */
async function reveal(page, selector, { hold = PAUSE.tour } = {}) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'attached', timeout: 20000 });
  await loc.evaluate((el) => {
    const shell =
      el.closest('.troca-doc-shell') ||
      el.closest('.troca-inbox-shell') ||
      el.closest('dialog') ||
      document.scrollingElement;
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    if (shell && shell !== el) {
      const er = el.getBoundingClientRect();
      const sr = shell.getBoundingClientRect();
      const delta = er.top - sr.top - sr.height * 0.22;
      shell.scrollBy({ top: delta, behavior: 'smooth' });
    }
  });
  await sleep(hold);
}

async function tourDocPhases(page, { highlightSign = true } = {}) {
  await banner(page, 'DOCUMENTO · rolando metadados e andamento', 2800);
  await reveal(page, '#trocaDocMeta', { hold: 1800 });
  await reveal(page, '#trocaTimeline', { hold: 2200 });

  const steps = page.locator('#trocaTimeline .timeline-step');
  const n = await steps.count();
  for (let i = 0; i < n; i += 1) {
    await steps.nth(i).evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await sleep(1400);
  }

  const blocks = page.locator('#trocaDocSignAreas .troca-sign-block');
  const b = await blocks.count();
  for (let i = 0; i < b; i += 1) {
    await blocks.nth(i).evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await sleep(1600);
  }

  if (highlightSign) {
    const canvas = page.locator('#trocaDocSignAreas canvas.troca-signature-canvas').first();
    if (await canvas.count()) {
      await banner(page, 'Área de assinatura desta fase — rolando até o canvas', 3000);
      await reveal(page, '#trocaDocSignAreas canvas.troca-signature-canvas', { hold: 2200 });
    }
  }
}

async function hardRefreshApp(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
      await Promise.all(regs.map((reg) => reg.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (_) { /* ignore */ }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1500);
}

async function login(page, actor) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginForm', { state: 'visible', timeout: 20000 });
  await banner(page, `LOGIN · ${actor.label} · RE ${actor.re}`);
  await reveal(page, '#loginCpf', { hold: 900 });
  await page.fill('#loginCpf', '');
  await page.type('#loginCpf', actor.re, { delay: 120 });
  await page.fill('#loginPassword', '');
  await page.type('#loginPassword', actor.pass, { delay: 140 });
  await sleep(900);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForSelector('#logoutButton', { state: 'visible', timeout: 25000 });
  await sleep(PAUSE.afterLogin);
}

async function logout(page) {
  await banner(page, 'Saindo da conta…', 2200);
  await page.click('#logoutButton');
  await page.waitForSelector('#loginForm', { state: 'visible', timeout: 15000 });
  await sleep(PAUSE.betweenActors);
}

async function openInbox(page) {
  await banner(page, 'Abrindo caixa de trocas / mensagens', 2600);
  await page.click('#trocaInboxButton');
  await page.waitForSelector('#trocaInboxDialog[open]', { timeout: 10000 });
  await sleep(1800);
  await reveal(page, '#trocaVigentesList, #trocaInboxList', { hold: 1600 });
}

async function closeInbox(page) {
  const open = await page.locator('#trocaInboxDialog[open]').count();
  if (open) {
    await page.click('#closeTrocaInbox');
    await sleep(900);
  }
}

async function closeDoc(page) {
  const open = await page.locator('#trocaDocDialog[open]').count();
  if (!open) return;
  await reveal(page, '#trocaDocStatus, #trocaTimeline', { hold: 1800 });
  await page.click('#closeTrocaDoc');
  await sleep(1000);
}

async function pickFirstDutyDay(page, gridSelector) {
  await reveal(page, gridSelector, { hold: 1400 });
  const day = page.locator(`${gridSelector} button.proposal-calendar-day.is-duty:not([disabled])`).first();
  await day.waitFor({ state: 'visible', timeout: 10000 });
  await day.scrollIntoViewIfNeeded();
  await sleep(700);
  await day.click();
  await sleep(1400);
}

/** Assinatura lenta e visível + traço no canvas. */
async function signCanvas(page, selector) {
  const canvas = page.locator(selector).first();
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  await reveal(page, selector, { hold: 2000 });
  await banner(page, 'Assinando… acompanhe o traço na tela', 2800);

  const box = await canvas.boundingBox();
  if (box) {
    const points = [
      [0.12, 0.62],
      [0.22, 0.48],
      [0.34, 0.68],
      [0.48, 0.42],
      [0.58, 0.58],
      [0.72, 0.40],
      [0.86, 0.55],
    ];
    const start = points[0];
    await page.mouse.move(box.x + box.width * start[0], box.y + box.height * start[1]);
    await page.mouse.down();
    for (const [px, py] of points.slice(1)) {
      await page.mouse.move(box.x + box.width * px, box.y + box.height * py, { steps: 22 });
      await sleep(120);
    }
    await page.mouse.up();
  }

  // Garante pixels no canvas (caso o pad limpe/redimensione)
  await canvas.evaluate((el) => {
    const ctx = el.getContext('2d');
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#102033';
    ctx.beginPath();
    ctx.moveTo(20, Math.max(36, el.height * 0.55));
    ctx.bezierCurveTo(el.width * 0.28, el.height * 0.18, el.width * 0.5, el.height * 0.88, el.width * 0.78, el.height * 0.42);
    ctx.stroke();
  });
  await sleep(1200);
}

async function dumpStatus(page, label) {
  const info = await page.evaluate(() => ({
    doc: document.querySelector('#trocaDocStatus')?.textContent || '',
    prop: document.querySelector('#trocaProposalStatus')?.textContent || '',
    docOpen: Boolean(document.querySelector('#trocaDocDialog')?.open),
    canvasCount: document.querySelectorAll('#trocaDocSignAreas canvas').length,
  }));
  console.log(`[STATUS:${label}]`, JSON.stringify(info));
  return info;
}

async function clickAction(page, text) {
  const btn = page.locator(`#trocaInboxList button.troca-action:has-text("${text}"), #trocaVigentesList button.troca-action:has-text("${text}")`).first();
  await btn.waitFor({ state: 'visible', timeout: 20000 });
  await btn.scrollIntoViewIfNeeded();
  await sleep(900);
  await btn.click();
  await sleep(PAUSE.afterAction);
}

async function waitDocStatus(page, regex, label) {
  try {
    await page.waitForFunction(
      (pattern) => {
        const s = document.querySelector('#trocaDocStatus');
        return s && !s.hidden && new RegExp(pattern, 'i').test(s.textContent || '');
      },
      regex.source,
      { timeout: 45000 }
    );
  } catch (err) {
    await dumpStatus(page, label);
    throw err;
  }
  await reveal(page, '#trocaDocStatus', { hold: 2000 });
  await sleep(PAUSE.afterSign);
}

async function main() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS;
  const browser = await chromium.launch({
    headless: false,
    slowMo: 750,
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  page.on('dialog', async (d) => {
    console.log('[ALERT]', d.message());
    await d.accept();
  });

  try {
    await hardRefreshApp(page);
    await banner(page, 'INÍCIO · Simulação lenta do fluxo completo — comece a gravar', 6000);

    // 1) Pedido Titular — A
    await login(page, ACTORS.a);
    await banner(page, 'FASE 1 · Solicitante A cria pedido Titular → Equipe B');
    await page.click('#trocaButton');
    await page.waitForSelector('#trocaRequestDialog[open]', { timeout: 10000 });
    await sleep(1600);
    await pickFirstDutyDay(page, '#requestCalendarGrid');
    await reveal(page, '#trocaRoleTitular', { hold: 1200 });
    await page.locator('label.admin-check:has(#trocaRoleTitular)').click();
    await page.waitForFunction(() => {
      const sel = document.querySelector('#trocaBtl');
      return sel && [...sel.options].some((o) => o.value);
    }, null, { timeout: 8000 });
    await reveal(page, '#trocaBtl', { hold: 1200 });
    await page.selectOption('#trocaBtl', { index: 1 });
    await reveal(page, '#trocaTeamChoices', { hold: 1400 });
    await page.locator('#trocaTeamChoices label:has(input[value="B"])').click();
    await sleep(1200);
    await reveal(page, '#trocaRequestSubmit', { hold: 1200 });
    await page.click('#trocaRequestSubmit');
    await page.waitForFunction(() => !document.querySelector('#trocaRequestDialog')?.open, null, { timeout: 25000 });
    await sleep(2200);
    await logout(page);

    // 2) Contraproposta — B (assinatura Passo 1 interessado)
    await login(page, ACTORS.b);
    await banner(page, 'FASE 2 · Interessado B assina a contraproposta (Passo 1 · parte B)');
    await openInbox(page);
    await clickAction(page, 'Fazer contraproposta');
    await page.waitForSelector('#trocaProposalDialog[open]', { timeout: 10000 });
    await sleep(1600);
    await pickFirstDutyDay(page, '#proposalCalendarGrid');
    await reveal(page, '#proposalRoleTitular', { hold: 1200 });
    await page.locator('label.admin-check:has(#proposalRoleTitular)').click();
    await page.waitForFunction(() => {
      const sel = document.querySelector('#proposalBtl');
      return sel && [...sel.options].some((o) => o.value);
    }, null, { timeout: 8000 });
    await reveal(page, '#proposalBtl', { hold: 1200 });
    await page.selectOption('#proposalBtl', { index: 1 });
    await reveal(page, '#trocaProposalSignature', { hold: 2000 });
    await signCanvas(page, '#trocaProposalSignature');
    await reveal(page, '#trocaProposalForm button[type="submit"]', { hold: 1400 });
    await page.click('#trocaProposalForm button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('#trocaProposalDialog')?.open, null, { timeout: 30000 });
    await sleep(2500);
    await closeInbox(page);
    await logout(page);

    // 3) Aceite + assinatura Passo 1 — A
    await login(page, ACTORS.a);
    await banner(page, 'FASE 3 · Solicitante A aceita e assina o Passo 1 no documento');
    await openInbox(page);
    await clickAction(page, 'Aceitar proposta');
    await page.waitForSelector('#trocaDocDialog[open]', { timeout: 30000 });
    await sleep(2500);
    await tourDocPhases(page);
    await dumpStatus(page, 'antes-assinatura-passo1');
    await signCanvas(page, '#trocaDocSignAreas canvas.troca-signature-canvas');
    await reveal(page, '#trocaDocDialog button.troca-action.accept:has-text("Confirmar assinatura")', { hold: 1600 });
    await page.locator('#trocaDocDialog button.troca-action.accept:has-text("Confirmar assinatura")').click();
    await waitDocStatus(page, /Passo 1 concluído|Supervisores/, 'falha-passo1');
    await banner(page, 'Passo 1 concluído · assinaturas das partes OK', 3800);
    await tourDocPhases(page, { highlightSign: false });
    await closeDoc(page);
    await closeInbox(page);
    await logout(page);

    // 4) Supervisores — Passo 2
    for (const actor of [ACTORS.sa, ACTORS.sb]) {
      await login(page, actor);
      await banner(page, `${actor.label} abre o documento e assina a ciência`);
      await openInbox(page);
      await clickAction(page, 'Abrir documento');
      await page.waitForSelector('#trocaDocDialog[open]', { timeout: 25000 });
      await sleep(2200);
      await tourDocPhases(page);
      await signCanvas(page, '#trocaDocSignAreas canvas.troca-signature-canvas');
      await reveal(page, '#trocaDocDialog button.troca-action.accept:has-text("Ciente e assinar")', { hold: 1600 });
      await page.locator('#trocaDocDialog button.troca-action.accept:has-text("Ciente e assinar")').click();
      await waitDocStatus(page, /Ciência registrada|Passo 2 concluído|Chefes/, `falha-${actor.re}`);
      await banner(page, `${actor.label} · ciência registrada`, 3600);
      await reveal(page, '#trocaTimeline', { hold: 2200 });
      await closeDoc(page);
      await closeInbox(page);
      await logout(page);
    }

    // 5) Chefes — Passo 3
    for (const actor of [ACTORS.ca, ACTORS.cb]) {
      await login(page, actor);
      await banner(page, `${actor.label} abre o documento e assina a ciência`);
      await openInbox(page);
      await clickAction(page, 'Abrir documento');
      await page.waitForSelector('#trocaDocDialog[open]', { timeout: 25000 });
      await sleep(2200);
      await tourDocPhases(page);
      await signCanvas(page, '#trocaDocSignAreas canvas.troca-signature-canvas');
      await reveal(page, '#trocaDocDialog button.troca-action.accept:has-text("Ciente e assinar")', { hold: 1600 });
      await page.locator('#trocaDocDialog button.troca-action.accept:has-text("Ciente e assinar")').click();
      await waitDocStatus(page, /Ciência registrada|Passo 3 concluído|status é OK|\bOK\b/, `falha-chefe-${actor.re}`);
      await banner(page, `${actor.label} · ciência registrada`, 3600);
      await reveal(page, '#trocaTimeline', { hold: 2200 });
      await closeDoc(page);
      await closeInbox(page);
      await logout(page);
    }

    // 6) Confirmação final + PDF com todas as assinaturas
    await login(page, ACTORS.a);
    await banner(page, 'FIM · Abrindo documento e PDF com todas as assinaturas');
    await openInbox(page);
    await reveal(page, '#trocaVigentesList', { hold: 2800 });
    const verDoc = page.locator('#trocaInboxList button.troca-action:has-text("Ver status / documento"), #trocaVigentesList button.troca-action:has-text("Ver status / documento")').first();
    if (await verDoc.count()) {
      await verDoc.scrollIntoViewIfNeeded();
      await sleep(1000);
      await verDoc.click();
      await page.waitForSelector('#trocaDocDialog[open]', { timeout: 20000 });
      await sleep(2000);
      await tourDocPhases(page, { highlightSign: false });
      await reveal(page, '#trocaDocPdfActions', { hold: 2800 });
      await banner(page, 'Abrindo PDF · dados em vermelho + todas as assinaturas', 4000);
      const [pdfPage] = await Promise.all([
        page.waitForEvent('popup', { timeout: 30000 }),
        page.click('#viewTrocaPdf'),
      ]);
      await pdfPage.waitForLoadState('domcontentloaded').catch(() => {});
      await sleep(12000);
      await banner(page, 'PDF aberto — role as páginas para ver todas as assinaturas', 5000);
      await sleep(10000);
      await closeDoc(page);
    }
    await sleep(PAUSE.final);
    await closeInbox(page);
    await banner(page, 'Simulação lenta concluída. Pode parar a gravação.', 9000);
    await sleep(4000);
  } catch (error) {
    console.error('FALHA_UI', error);
    await banner(page, `ERRO: ${error.message || error}`, 12000).catch(() => {});
    await sleep(8000);
    throw error;
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
