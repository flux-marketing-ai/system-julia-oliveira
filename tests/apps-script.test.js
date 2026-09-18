/* Testa Code.gs em Node com uma planilha simulada em memória (mock do SpreadsheetApp e cia).
   Uso: node tests/apps-script.test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
let ok = 0; const falhas = [];
const t = (nome, cond) => { if (cond) ok++; else falhas.push(nome); };

// ---- mock mínimo do ambiente Apps Script ----
class Range {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.cel(this.r + i, this.c + j)); out.push(row); } return out; }
  setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => this.sh.set(this.r + i, this.c + j, v))); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, ''); return this; }
  setNumberFormat() { return this; } setFontWeight() { return this; }
}
class Sheet {
  constructor(nome) { this.nome = nome; this.dados = new Map(); this.max = 1000; }
  key(r, c) { return r + ':' + c; }
  cel(r, c) { return this.dados.has(this.key(r, c)) ? this.dados.get(this.key(r, c)) : ''; }
  set(r, c, v) { if (v === '' || v == null) this.dados.delete(this.key(r, c)); else this.dados.set(this.key(r, c), v); }
  getLastRow() { let m = 0; for (const k of this.dados.keys()) m = Math.max(m, +k.split(':')[0]); return m; }
  getMaxRows() { return this.max; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  setFrozenRows() { }
  deleteRow(r) { const novo = new Map(); for (const [k, v] of this.dados) { const [rr, cc] = k.split(':').map(Number); if (rr === r) continue; novo.set((rr > r ? rr - 1 : rr) + ':' + cc, v); } this.dados = novo; }
}
const planilha = { abas: new Map() };
const ss = {
  getSheetByName: n => planilha.abas.get(n) || null,
  insertSheet: n => { const s = new Sheet(n); planilha.abas.set(n, s); return s; },
  setActiveSheet: () => { }
};
const props = {}; const triggers = []; const emails = [];
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({ alert: () => { } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: tr => { const i = triggers.indexOf(tr); if (i >= 0) triggers.splice(i, 1); }, newTrigger: fn => ({ timeBased: () => ({ everyDays: () => ({ atHour: h => ({ create: () => { const tr = { getHandlerFunction: () => fn, hora: h }; triggers.push(tr); return tr; } }) }) }) }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { }, releaseLock: () => { } }) },
  ContentService: { createTextOutput: s => ({ setMimeType: () => ({ texto: s }) }), MimeType: { JSON: 'json' } },
  Utilities: { getUuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, () => (Math.random() * 16 | 0).toString(16)), formatDate: (d, tz, f) => d.toISOString().slice(0, 10) },
  Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
  MailApp: { sendEmail: o => emails.push(o) },
  Date, JSON, Math, String, Number, Array, Object, Map, Set, console
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../core.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
const R = out => JSON.parse(out.texto);
const get = p => R(ctx.doGet({ parameter: p }));
const post = b => R(ctx.doPost({ postData: { contents: JSON.stringify(b) } }));

// ---- setup ----
ctx.setup();
t('abas criadas', ['pedidos', 'fornecedores', 'transportadoras', 'tags', 'config', 'log'].every(n => planilha.abas.has(n)));
t('cabeçalho pedidos', planilha.abas.get('pedidos').cel(1, 1) === 'po');
t('chave gerada', !!props.CHAVE && props.CHAVE.length >= 32);
t('chave na aba config', ctx.lerConfig().chaveAcesso === props.CHAVE);
t('gatilho instalado às 8', triggers.length === 1 && triggers[0].hora === 8);
const chave = props.CHAVE;

// ---- auth ----
t('sem chave falha', get({ acao: 'ping' }).ok === false);
t('chave errada falha', get({ acao: 'ping', chave: 'x' }).ok === false);
t('ping ok', get({ acao: 'ping', chave }).ok === true);
t('post sem chave falha', post({ acao: 'upsertPedidos', pedidos: [] }).ok === false);

// ---- pedidos ----
const hoje = ctx.Core.hojeISO();
const p1 = { po: '900001', fornecedor: 'ALFA', tipo: 'now_crossdocking', limite: '2026-10-07', qtd: 120, qtdEntregue: 0, valor: 8450, envio: '2026-09-16', leadWms: 15, obs: 'Agendado 20/09', acao: 'Agendado', dataAcao: '2026-09-20', update: hoje, extras: { coluna_nova: 'v1' }, criadoEm: hoje, origem: 'import' };
const p2 = { po: '900002', fornecedor: 'BETA', tipo: 'ticket_active', limite: '2026-09-17', qtd: 40, valor: 1234.56, criadoEm: hoje, origem: 'import', remessa: '2' };
t('upsert 2', post({ acao: 'upsertPedidos', chave, pedidos: [p1, p2] }).ok === true);
let tudo = get({ acao: 'tudo', chave });
t('tudo ok', tudo.ok === true && tudo.pedidos.length === 2);
const l1 = tudo.pedidos.find(p => p.po === '900001');
t('texto preservado', l1.obs === 'Agendado 20/09' && l1.fornecedor === 'ALFA');
t('número volta como número', l1.qtd === 120 && l1.valor === 8450);
t('data volta como ISO string', l1.limite === '2026-10-07');
t('extras volta como objeto', l1.extras && l1.extras.coluna_nova === 'v1');
t('saldo calculado', l1.saldo === 120);
t('config não expõe chave', tudo.config.chaveAcesso === undefined);
t('remessa vai e volta', tudo.pedidos.find(p => p.po === '900002').remessa === '2');

// upsert atualiza sem duplicar
post({ acao: 'upsertPedidos', chave, pedidos: [Object.assign({}, p1, { obs: 'PO recebido', qtdEntregue: 80 })] });
tudo = get({ acao: 'tudo', chave });
t('sem duplicar', tudo.pedidos.length === 2);
t('obs atualizada', tudo.pedidos.find(p => p.po === '900001').obs === 'PO recebido');
t('saldo recalculado no servidor', tudo.pedidos.find(p => p.po === '900001').saldo === 40);
// linha 3 novo
post({ acao: 'upsertPedidos', chave, pedidos: [{ po: '900003', fornecedor: 'GAMA', limite: hoje, qtd: 9 }] });
t('3 pedidos', get({ acao: 'tudo', chave }).pedidos.length === 3);
// delete do meio
post({ acao: 'deletePedidos', chave, pos: ['900002'] });
tudo = get({ acao: 'tudo', chave });
t('delete', tudo.pedidos.length === 2 && !tudo.pedidos.some(p => p.po === '900002'));
t('delete não corrompeu os outros', tudo.pedidos.find(p => p.po === '900003').fornecedor === 'GAMA' && tudo.pedidos.find(p => p.po === '900001').obs === 'PO recebido');
// upsert após delete adiciona no fim certo
post({ acao: 'upsertPedidos', chave, pedidos: [{ po: '900004', fornecedor: 'DELTA', limite: hoje, qtd: 1 }] });
tudo = get({ acao: 'tudo', chave });
t('upsert após delete', tudo.pedidos.length === 3 && tudo.pedidos.some(p => p.po === '900004'));

// ---- listas ----
t('replaceLista fornecedores', post({ acao: 'replaceLista', chave, lista: 'fornecedores', linhas: [{ id: 'a1', nome: 'ALFA', aliases: 'ALFA LTDA|ALFA S.A.', cor: '#ff0000', transportadora: 'Dumar', diaEntrega: 'segunda', prazoNF: 'quarta', coleta: true, obs: '' }] }).ok === true);
const forn = get({ acao: 'tudo', chave }).fornecedores;
t('fornecedor volta com booleano', forn.length === 1 && forn[0].coleta === true && forn[0].aliases === 'ALFA LTDA|ALFA S.A.');
post({ acao: 'replaceLista', chave, lista: 'fornecedores', linhas: [] });
t('replaceLista vazia limpa', get({ acao: 'tudo', chave }).fornecedores.length === 0);
t('replaceLista pedidos bloqueada', post({ acao: 'replaceLista', chave, lista: 'pedidos', linhas: [] }).ok === false);
t('replaceLista inválida bloqueada', post({ acao: 'replaceLista', chave, lista: 'xyz', linhas: [] }).ok === false);

// ---- config + gatilho ----
t('salvarConfig', post({ acao: 'salvarConfig', chave, config: { emailDestino: 'julia@exemplo.com', hora: 7, antecedencia: 2, diasSemana: [1, 2, 3, 4, 5], avisosAtivo: true, chaveAcesso: 'HACK' } }).ok === true);
t('chave não sobrescrita pelo cliente', ctx.lerConfig().chaveAcesso === chave);
t('gatilho reprogramado pra 7', triggers.length === 1 && triggers[0].hora === 7);
post({ acao: 'salvarConfig', chave, config: { hora: 7 } });
t('mesma hora não recria', triggers.length === 1);
const cfg = get({ acao: 'tudo', chave }).config;
t('config lida com tipos certos', cfg.hora === 7 && Array.isArray(cfg.diasSemana) && cfg.emailDestino === 'julia@exemplo.com');

// ---- e-mail ----
const r = post({ acao: 'testarEmail', chave });
t('teste de e-mail', r.ok === true && emails.length === 1 && emails[0].to === 'julia@exemplo.com');
t('assunto do teste', /^\[teste\] Pedidos · /.test(emails[0].subject));
t('corpo tem PO atrasado ou hoje', /900003|900004/.test(emails[0].body));
// gatilho real: respeita dia da semana
const diaHoje = new Date().getDay();
post({ acao: 'salvarConfig', chave, config: { diasSemana: [(diaHoje + 1) % 7] } });
t('pula fora do dia', ctx.enviarResumoDiario().pulado === 'dia');
post({ acao: 'salvarConfig', chave, config: { diasSemana: [diaHoje], avisosAtivo: false } });
t('pula desligado', ctx.enviarResumoDiario().pulado === 'desligado');
post({ acao: 'salvarConfig', chave, config: { avisosAtivo: true } });
const antes = emails.length; ctx.enviarResumoDiario();
t('envia no dia certo', emails.length === antes + 1 && !/\[teste\]/.test(emails[emails.length - 1].subject));
// vazio: sem pedidos abertos e sem enviarSeVazio → pula
post({ acao: 'deletePedidos', chave, pos: ['900001', '900003', '900004'] });
t('pula vazio', ctx.enviarResumoDiario().pulado === 'vazio');
post({ acao: 'salvarConfig', chave, config: { enviarSeVazio: true } });
t('envia vazio quando pedido', ctx.enviarResumoDiario().para === 'julia@exemplo.com' && /Tudo em dia/.test(emails[emails.length - 1].body));

// ---- log ----
t('log', post({ acao: 'log', chave, entradas: [{ quando: 'x', tipo: 'importar', novos: 3 }] }).ok === true && planilha.abas.get('log').getLastRow() >= 2);

console.log(ok + ' ok, ' + falhas.length + ' falhas' + (falhas.length ? ':\n  ' + falhas.join('\n  ') : ''));
process.exit(falhas.length ? 1 : 0);
