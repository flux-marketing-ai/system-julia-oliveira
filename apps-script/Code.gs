/* Code.gs — lado do Google do sistema de pedidos.
   Projeto Apps Script vinculado à planilha (Extensões > Apps Script) com DOIS arquivos:
     1. Code.gs   (este arquivo)
     2. core.gs   (cole o conteúdo de core.js do repositório, sem mudar nada)
   Guia completo em docs/02-instalacao.md. */

const ABAS = {
  pedidos: ['po', 'status', 'fornecedor', 'tipo', 'limite', 'qtd', 'qtdEntregue', 'saldo', 'acao', 'dataAcao', 'obs', 'update',
    'time', 'valor', 'armazem', 'campanha', 'campanhaId', 'envio', 'leadWms', 'leadBob', 'pagamento', 'inicioCampanha',
    'finalCampanha', 'finalizacao', 'criadoEm', 'origem', 'remessa', 'extras'],
  fornecedores: ['id', 'nome', 'aliases', 'cor', 'transportadora', 'diaEntrega', 'prazoNF', 'coleta', 'obs'],
  transportadoras: ['id', 'nome', 'email', 'diaEntrega', 'regra'],
  tags: ['id', 'grupo', 'codigo', 'nome', 'cor'],
  config: ['chave', 'valor'],
  log: ['quando', 'tipo', 'detalhe']
};
const NUMERICOS = { qtd: 1, qtdEntregue: 1, saldo: 1, valor: 1, leadWms: 1, leadBob: 1 };
const BOOLEANOS = { coleta: 1 };

// ---------- Instalação (rodar UMA vez pelo editor: selecionar "setup" e clicar em Executar) ----------
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(ABAS).forEach(nome => {
    let sh = ss.getSheetByName(nome);
    if (!sh) sh = ss.insertSheet(nome);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, ABAS[nome].length).setValues([ABAS[nome]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    // tudo como texto: datas ficam "aaaa-mm-dd" sem o Sheets converter
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), ABAS[nome].length).setNumberFormat('@');
  });
  const props = PropertiesService.getScriptProperties();
  let chave = props.getProperty('CHAVE');
  if (!chave) { chave = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); props.setProperty('CHAVE', chave); }
  const cfg = lerConfig();
  cfg.chaveAcesso = chave; // fica visível na aba config pra ela copiar (planilha é privada)
  gravarConfig(cfg);
  instalarGatilho(Number(cfg.hora) || 8);
  const aba = ss.getSheetByName('config'); ss.setActiveSheet(aba);
  SpreadsheetApp.getUi().alert('Pronto. Sua chave de acesso está na aba "config" (linha chaveAcesso). Agora publique como app da web (Implantar > Nova implantação) e cole o link e a chave em Configurações no app.');
}

function instalarGatilho(hora) {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'enviarResumoDiario') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('enviarResumoDiario').timeBased().everyDays(1).atHour(hora).create();
}

// ---------- HTTP ----------
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    autenticar(p.chave);
    if (p.acao === 'ping') return responder({ ok: true, hora: new Date().toISOString() });
    if (p.acao === 'tudo') return responder({ ok: true, pedidos: lerLista('pedidos'), fornecedores: lerLista('fornecedores'), transportadoras: lerLista('transportadoras'), tags: lerLista('tags'), config: lerConfigPublica() });
    return responder({ ok: false, erro: 'Ação desconhecida' });
  } catch (err) { return responder({ ok: false, erro: String(err.message || err) }); }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    autenticar(body.chave);
    lock.waitLock(20000);
    switch (body.acao) {
      case 'upsertPedidos': upsertPedidos(body.pedidos || []); return responder({ ok: true, n: (body.pedidos || []).length });
      case 'deletePedidos': deletePedidos(body.pos || []); return responder({ ok: true });
      case 'replaceLista':
        if (!ABAS[body.lista] || ['pedidos', 'config', 'log'].includes(body.lista)) throw new Error('Lista inválida');
        gravarLista(body.lista, body.linhas || []); return responder({ ok: true });
      case 'salvarConfig': {
        const atual = lerConfig(); const nova = body.config || {};
        Object.keys(nova).forEach(k => { if (k !== 'chaveAcesso') atual[k] = nova[k]; });
        gravarConfig(atual);
        if (nova.hora != null) { const h = Number(nova.hora); const t = ScriptApp.getProjectTriggers().find(x => x.getHandlerFunction() === 'enviarResumoDiario'); if (!t || h !== (Number(atual.horaGatilho) || -1)) { instalarGatilho(h); atual.horaGatilho = h; gravarConfig(atual); } }
        return responder({ ok: true });
      }
      case 'log': appendLog(body.entradas || []); return responder({ ok: true });
      case 'testarEmail': { const r = enviarResumoDiario(true); return responder({ ok: true, para: r.para, assunto: r.assunto }); }
      default: throw new Error('Ação desconhecida');
    }
  } catch (err) { return responder({ ok: false, erro: String(err.message || err) }); }
  finally { try { lock.releaseLock(); } catch (x) { } }
}

function responder(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function autenticar(chave) {
  const certa = PropertiesService.getScriptProperties().getProperty('CHAVE');
  if (!certa) throw new Error('Rode setup() primeiro');
  if (!chave || String(chave) !== certa) throw new Error('Chave inválida');
}

// ---------- Leitura/escrita ----------
function aba(nome) { const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome); if (!sh) throw new Error('Aba ' + nome + ' não existe. Rode setup().'); return sh; }

function celulaParaValor(k, v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (NUMERICOS[k]) return Number(String(v).replace(',', '.')) || 0;
  if (BOOLEANOS[k]) return v === true || String(v).toUpperCase() === 'TRUE';
  if (k === 'extras') { try { return v ? JSON.parse(v) : {}; } catch (e) { return {}; } }
  return v == null ? '' : String(v);
}
function valorParaCelula(k, v) {
  if (k === 'extras') return JSON.stringify(v || {});
  if (BOOLEANOS[k]) return v ? 'TRUE' : 'FALSE';
  if (NUMERICOS[k]) return Number(v) || 0;
  return v == null ? '' : String(v);
}

function lerLista(nome) {
  const sh = aba(nome); const cols = ABAS[nome];
  const n = sh.getLastRow(); if (n < 2) return [];
  const vals = sh.getRange(2, 1, n - 1, cols.length).getValues();
  return vals.filter(r => String(r[0]).trim() !== '').map(r => { const o = {}; cols.forEach((k, i) => { o[k] = celulaParaValor(k, r[i]); }); return o; });
}
function gravarLista(nome, linhas) {
  const sh = aba(nome); const cols = ABAS[nome];
  const n = sh.getLastRow(); if (n > 1) sh.getRange(2, 1, n - 1, cols.length).clearContent();
  if (!linhas.length) return;
  const vals = linhas.map(o => cols.map(k => valorParaCelula(k, o[k])));
  sh.getRange(2, 1, vals.length, cols.length).setNumberFormat('@').setValues(vals);
}

function upsertPedidos(pedidos) {
  const sh = aba('pedidos'); const cols = ABAS.pedidos;
  const n = sh.getLastRow();
  const pos = n > 1 ? sh.getRange(2, 1, n - 1, 1).getValues().map(r => String(r[0])) : [];
  const idx = new Map(); pos.forEach((po, i) => idx.set(po, i + 2));
  const novos = [];
  pedidos.forEach(p => {
    if (!p || !p.po) return;
    p.saldo = Math.max(0, (Number(p.qtd) || 0) - (Number(p.qtdEntregue) || 0));
    const linha = cols.map(k => valorParaCelula(k, p[k]));
    const r = idx.get(String(p.po));
    if (r) sh.getRange(r, 1, 1, cols.length).setNumberFormat('@').setValues([linha]);
    else { novos.push(linha); idx.set(String(p.po), n + novos.length); }
  });
  if (novos.length) sh.getRange(sh.getLastRow() + 1, 1, novos.length, cols.length).setNumberFormat('@').setValues(novos);
}
function deletePedidos(pos) {
  const sh = aba('pedidos'); const n = sh.getLastRow(); if (n < 2) return;
  const col = sh.getRange(2, 1, n - 1, 1).getValues().map(r => String(r[0]));
  const alvo = new Set(pos.map(String));
  for (let i = col.length - 1; i >= 0; i--) if (alvo.has(col[i])) sh.deleteRow(i + 2);
}

function lerConfig() {
  const sh = aba('config'); const n = sh.getLastRow(); const cfg = {};
  if (n < 2) return cfg;
  sh.getRange(2, 1, n - 1, 2).getValues().forEach(r => { const k = String(r[0]).trim(); if (!k) return; try { cfg[k] = JSON.parse(r[1]); } catch (e) { cfg[k] = String(r[1]); } });
  return cfg;
}
function lerConfigPublica() { const c = lerConfig(); delete c.chaveAcesso; delete c.horaGatilho; return c; }
function gravarConfig(cfg) {
  const sh = aba('config'); const n = sh.getLastRow(); if (n > 1) sh.getRange(2, 1, n - 1, 2).clearContent();
  const vals = Object.keys(cfg).map(k => [k, typeof cfg[k] === 'string' ? cfg[k] : JSON.stringify(cfg[k])]);
  if (vals.length) sh.getRange(2, 1, vals.length, 2).setNumberFormat('@').setValues(vals);
}
function appendLog(entradas) {
  const sh = aba('log');
  const vals = entradas.map(e => [e.quando || new Date().toISOString(), e.tipo || '', JSON.stringify(Object.assign({}, e, { quando: undefined, tipo: undefined }))]);
  if (vals.length) sh.getRange(sh.getLastRow() + 1, 1, vals.length, 3).setNumberFormat('@').setValues(vals);
}

// ---------- E-mail diário (gatilho) ----------
function enviarResumoDiario(forcar) {
  const cfg = lerConfig();
  const hoje = Core.hojeISO();
  const dia = new Date().getDay();
  const para = String(cfg.emailDestino || '').split(',').map(s => s.trim()).filter(Boolean).join(',');
  if (!forcar) {
    if (cfg.avisosAtivo === false) return { pulado: 'desligado' };
    if (Array.isArray(cfg.diasSemana) && cfg.diasSemana.length && !cfg.diasSemana.map(Number).includes(dia)) return { pulado: 'dia' };
  }
  if (!para) throw new Error('Sem e-mail de destino em Configurações');
  const pedidos = lerLista('pedidos');
  const t = Core.textoResumo(pedidos, cfg, hoje);
  if (t.vazio && !cfg.enviarSeVazio && !forcar) return { pulado: 'vazio' };
  const assunto = (forcar ? '[teste] ' : '') + t.assunto;
  MailApp.sendEmail({ to: para, subject: assunto, body: t.corpo, htmlBody: '<pre style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;white-space:pre-wrap">' + t.corpo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>') + '</pre>' });
  appendLog([{ quando: new Date().toISOString(), tipo: forcar ? 'email-teste' : 'email', assunto, para }]);
  return { para, assunto };
}
