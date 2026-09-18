/* Teste de tela em Chrome headless via CDP (sem dependências).
   Sobe um servidor estático, abre o app, simula importação do CSV de amostra, edita, finaliza,
   e confere o DOM. Uso: node tests/smoke.js */
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const RAIZ = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORTA = 8765, DBG = 9333;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv' };

const API = { pedidos: [], posts: [] }; // planilha simulada por HTTP (pra testar a sincronização de verdade)
const servidor = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/api-chave') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, erro: 'Chave inválida' })); }
  if (u === '/api-ok') {
    if (req.method === 'POST') { let b = ''; req.on('data', d => b += d); req.on('end', () => { API.posts.push(JSON.parse(b)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); }); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, pedidos: API.pedidos, fornecedores: [], transportadoras: [], tags: [], config: { emailDestino: 'x@y.z' } }));
  }
  const p = path.join(RAIZ, u === '/' ? 'index.html' : u);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); res.end(d); });
}).listen(PORTA);

const perfil = fs.mkdtempSync('/tmp/sjo-chrome-');
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + perfil, '--remote-debugging-port=' + DBG, 'about:blank'], { stdio: 'ignore' });

const dorme = ms => new Promise(r => setTimeout(r, ms));
async function json(url) { const r = await fetch(url); return r.json(); }

(async () => {
  let alvo;
  for (let i = 0; i < 40 && !alvo; i++) { await dorme(250); try { alvo = (await json('http://127.0.0.1:' + DBG + '/json')).find(t => t.type === 'page'); } catch (e) { } }
  if (!alvo) throw new Error('Chrome não subiu');
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(); const erros = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') erros.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') erros.push(m.params.args.map(a => a.value || a.description).join(' '));
  };
  const cmd = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async expr => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception || {}).description); return r.result.result.value; };

  await cmd('Runtime.enable'); await cmd('Page.enable');
  await cmd('Page.navigate', { url: 'http://127.0.0.1:' + PORTA + '/index.html#pedidos' });
  await dorme(1200);

  let ok = 0; const falhas = [];
  const t = (nome, cond) => { if (cond) ok++; else falhas.push(nome); };

  t('título', await ev('document.title') === 'Sistema Westwing');
  t('aba pedidos ativa', await ev(`document.querySelector('.aba.ativa').dataset.aba`) === 'pedidos');
  t('sem planilha', await ev(`document.querySelector('#sync').textContent`) === 'Sem planilha');
  t('tabela vazia', await ev(`document.querySelector('#tabela-vazio').classList.contains('oculto')`) === false);

  // importação: injeta o CSV de amostra pelo mesmo caminho do input de arquivo
  const csv = fs.readFileSync(path.join(RAIZ, 'amostras/relatorio-exemplo.csv'), 'utf8');
  await ev(`document.querySelector('#btn-importar').click(); 'ok'`);
  t('modal importar aberto', await ev(`document.querySelector('#dlg-importar').open`) === true);
  await ev(`(function(){ const f = new File([${JSON.stringify(csv)}], 'rel.csv', {type:'text/csv'}); const dt = new DataTransfer(); dt.items.add(f); const inp = document.querySelector('#imp-arquivo'); inp.files = dt.files; inp.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  await dorme(400);
  t('prévia: 5 novos', /<b>5<\/b>novos/.test(await ev(`document.querySelector('#imp-passo-previa').innerHTML`)));
  t('sem passo de colunas', await ev(`document.querySelector('#imp-passo-colunas').classList.contains('oculto')`) === true);
  t('confirmar habilitado', await ev(`document.querySelector('#imp-confirmar').disabled`) === false);
  await ev(`document.querySelector('#imp-confirmar').click(); 'ok'`);
  await dorme(300);
  t('5 linhas na tabela', await ev(`document.querySelectorAll('#tabela-corpo tr').length`) === 5);
  t('fornecedores criados', await ev(`SJO.S.fornecedores.length`) === 5);
  t('tag nova criada (store não; influencers já existe)', await ev(`SJO.S.tags.filter(t=>t.grupo==='tipo').length`) >= 8);
  t('data BR na tabela', /07\/10\/2026/.test(await ev(`document.querySelector('#tabela-corpo').textContent`)));
  t('ordenado por limite asc', await ev(`document.querySelector('#tabela-corpo tr').dataset.po`) === '900003' || await ev(`document.querySelector('#tabela-corpo tr').dataset.po`) === '900004');
  t('status calculado atrasado', await ev(`document.querySelectorAll('#tabela-corpo tr.st-atrasado').length`) >= 1);
  t('fila tem ops (sem conexão, ficam pendentes)', await ev(`SJO.S.fila.length`) >= 1);

  // edição inline: observação
  await ev(`(function(){ const i = document.querySelector('#tabela-corpo input[data-k="obs"][data-po="900001"]'); i.value = 'Agendado 20/09'; i.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  t('obs salva', await ev(`SJO.S.pedidos.find(p=>p.po==='900001').obs`) === 'Agendado 20/09');
  t('update = hoje', await ev(`SJO.S.pedidos.find(p=>p.po==='900001').update`) === await ev(`Core.hojeISO()`));
  // ação + data
  await ev(`(function(){ const i = document.querySelector('#tabela-corpo input[data-k="acao"][data-po="900002"]'); i.value = 'Agendar'; i.dispatchEvent(new Event('change', {bubbles:true})); const d = document.querySelector('#tabela-corpo input[data-k="dataAcao"][data-po="900002"]'); d.value = Core.hojeISO(); d.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  t('ação salva', await ev(`SJO.S.pedidos.find(p=>p.po==='900002').acao`) === 'Agendar');
  // saldo
  await ev(`(function(){ const i = document.querySelector('#pop-colunas input[value="qtdEntregue"]'); i.checked = true; i.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  await ev(`(function(){ const i = document.querySelector('#tabela-corpo input[data-k="qtdEntregue"][data-po="900001"]'); i.value = '80'; i.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  t('saldo 40', await ev(`Core.saldo(SJO.S.pedidos.find(p=>p.po==='900001'))`) === 40);
  t('entrega parcial move pra 2ª remessa', await ev(`SJO.S.pedidos.find(p=>p.po==='900001').remessa`) === '2');
  t('some da 1ª remessa', await ev(`document.querySelectorAll('#tabela-corpo tr[data-po="900001"]').length`) === 0);
  await ev(`document.querySelector('#f-remessa button[data-v="2"]').click(); 'ok'`);
  t('aparece na 2ª remessa', await ev(`document.querySelectorAll('#tabela-corpo tr').length`) === 1);
  t('tag saldo aparece', /Saldo/.test(await ev(`document.querySelector('#tabela-corpo tr[data-po="900001"]').innerHTML`)));
  await ev(`document.querySelector('button[data-acao="remessa1"][data-po="900001"]').click(); 'ok'`);
  t('voltou pra 1ª', await ev(`SJO.S.pedidos.find(p=>p.po==='900001').remessa`) === '1');
  await ev(`document.querySelector('#f-remessa button[data-v="1"]').click(); 'ok'`);
  await ev(`document.querySelector('button[data-acao="remessa2"][data-po="900005"]').click(); 'ok'`);
  t('mover manual pra 2ª', await ev(`SJO.S.pedidos.find(p=>p.po==='900005').remessa`) === '2');
  await ev(`document.querySelector('button[data-acao="remessa1"]') ? 'x' : (document.querySelector('#f-remessa button[data-v="2"]').click(), document.querySelector('button[data-acao="remessa1"][data-po="900005"]').click(), document.querySelector('#f-remessa button[data-v="1"]').click(), 'ok')`);
  t('voltou 900005', await ev(`SJO.S.pedidos.find(p=>p.po==='900005').remessa`) === '1');
  await ev(`document.querySelector('#f-remessa button[data-v="1"]').click(); 'ok'`);
  t('5 linhas de novo na 1ª', await ev(`document.querySelectorAll('#tabela-corpo tr').length`) === 5);
  // finalizar
  await ev(`document.querySelector('button[data-acao="finalizar"][data-po="900003"]').click(); 'ok'`);
  t('finalizado some de abertos', await ev(`document.querySelectorAll('#tabela-corpo tr').length`) === 4);
  t('remessa persiste após limpar filtros', await ev(`SJO.UI.filtros.remessa`) === '1');
  await ev(`(function(){ const s = document.querySelector('#f-status'); s.value = 'finalizado'; s.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  t('filtro finalizados mostra 1', await ev(`document.querySelectorAll('#tabela-corpo tr').length`) === 1);
  await ev(`document.querySelector('#btn-limpar-filtros').click(); 'ok'`);
  // busca
  await ev(`(function(){ const b = document.querySelector('#busca'); b.value = 'beta'; b.dispatchEvent(new Event('input', {bubbles:true})); return 'ok'; })()`);
  await dorme(350);
  t('busca beta = 1', await ev(`document.querySelectorAll('#tabela-corpo tr').length`) === 1);
  await ev(`document.querySelector('#btn-limpar-filtros').click(); 'ok'`);

  // dash
  await ev(`document.querySelector('.aba[data-aba="dash"]').click(); 'ok'`);
  await dorme(200);
  t('kpis renderizados', await ev(`document.querySelectorAll('#kpis .kpi').length`) === 5);
  t('tarefa de hoje listada', await ev(`document.querySelectorAll('#tarefas-hoje li input[type=checkbox]').length`) === 1);
  t('gráfico fornecedor', await ev(`document.querySelectorAll('#graf-fornecedor .barra-linha').length`) === 4);
  t('valor em BR no dash', /R\$\s?[\d.]+,\d{2}/.test(await ev(`document.querySelector('#kpis').textContent`)));
  await ev(`(function(){ const c = document.querySelector('#tarefas-hoje input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  t('ação concluída vira obs', /Agendar .*✓/.test(await ev(`SJO.S.pedidos.find(p=>p.po==='900002').obs`)));
  // "vencem em breve": detalhe por dia
  await ev(`document.querySelector('.kpi[data-filtro="vence"]').click(); 'ok'`);
  t('detalhe vencem abre', await ev(`document.querySelector('#detalhe-vencem').classList.contains('oculto')`) === false);
  t('detalhe tem Hoje e Amanhã', /Hoje/.test(await ev(`document.querySelector('#detalhe-vencem').textContent`)) && /Amanhã/.test(await ev(`document.querySelector('#detalhe-vencem').textContent`)));
  await ev(`document.querySelector('#detalhe-vencem button[data-ver="fechar"]').click(); 'ok'`);
  t('detalhe vencem fecha', await ev(`document.querySelector('#detalhe-vencem').classList.contains('oculto')`) === true);
  // por time: tabela
  await ev(`document.querySelector('#time-vista button[data-v="tabela"]').click(); 'ok'`);
  t('tabela por time', await ev(`document.querySelectorAll('#graf-time table.tab-mini tbody tr').length`) === 3);
  await ev(`document.querySelector('#time-vista button[data-v="grafico"]').click(); 'ok'`);
  t('gráfico por time de volta', await ev(`document.querySelectorAll('#graf-time .barra-linha').length`) === 3);
  await dorme(100);
  t('barras animadas com largura', await ev(`Array.from(document.querySelectorAll('#graf-fornecedor .fill')).every(f => parseFloat(f.style.width) > 0)`) === true);
  // próximos dias: chips
  await ev(`document.querySelector('#prox-dias button[data-dias="30"]').click(); 'ok'`);
  t('próximos 30 lista mais', await ev(`document.querySelectorAll('#prox7 .item').length`) === 3);
  t('chip 30 ativo', await ev(`document.querySelector('#prox-dias button[data-dias="30"]').classList.contains('ativo')`) === true);
  t('título por fornecedor × métrica', /Por fornecedor × Pedidos/.test(await ev(`document.querySelector('#tit-forn').textContent`)));
  t('nome do sistema no topo', await ev(`document.querySelector('#logo').textContent`) === 'Sistema Westwing' && await ev('document.title') === 'Sistema Westwing');

  // período global: popover com presets, persiste entre abas
  await ev(`document.querySelector('#periodo-btn').click(); 'ok'`);
  t('popover período abre', await ev(`document.querySelector('#periodo-pop').classList.contains('oculto')`) === false);
  t('presets renderizados', await ev(`document.querySelectorAll('#pp-presets button[data-preset]').length`) === 12);
  t('calendário com 2 meses', await ev(`document.querySelectorAll('#pp-cal .cal-mes').length`) === 2);
  await ev(`document.querySelector('#pp-presets button[data-preset="p30"]').click(); 'ok'`);
  t('rótulo próximos 30', /Próximos 30 dias/.test(await ev(`document.querySelector('#periodo-rotulo').textContent`)));
  t('popover fechou', await ev(`document.querySelector('#periodo-pop').classList.contains('oculto')`) === true);
  await ev(`document.querySelector('.aba[data-aba="pedidos"]').click(); 'ok'`);
  t('período mantido na outra aba', /Próximos 30 dias/.test(await ev(`document.querySelector('#periodo-rotulo').textContent`)));
  t('período filtra tabela', await ev(`document.querySelectorAll('#tabela-corpo tr').length`) <= 4);
  // faixa personalizada clicando no calendário
  await ev(`document.querySelector('#periodo-btn').click(); 'ok'`);
  await ev(`document.querySelector('#pp-cal button[data-dia="' + Core.hojeISO() + '"]').click(); 'ok'`);
  t('primeiro clique fica pendente', /agora clique no fim/.test(await ev(`document.querySelector('#pp-dica').textContent`)));
  const fim = await ev(`Core.addDias(Core.hojeISO(), 20)`);
  await ev(`(function(){ let b = document.querySelector('#pp-cal button[data-dia="${fim}"]'); if (!b) { document.querySelector('#pp-cal button[data-nav="1"]').click(); b = document.querySelector('#pp-cal button[data-dia="${fim}"]'); } b.click(); return 'ok'; })()`);
  t('faixa aplicada', await ev(`SJO.S.config.periodo.de`) === await ev(`Core.hojeISO()`) && await ev(`SJO.S.config.periodo.ate`) === fim && await ev(`SJO.S.config.periodo.preset`) === 'custom');
  t('rótulo faixa', /–/.test(await ev(`document.querySelector('#periodo-rotulo').textContent`)));
  // aplicar em envio
  await ev(`document.querySelector('#periodo-btn').click(); document.querySelector('#pp-campo button[data-v="envio"]').click(); 'ok'`);
  t('campo envio', await ev(`SJO.S.config.periodo.campo`) === 'envio' && /envio/.test(await ev(`document.querySelector('#periodo-rotulo').textContent`)));
  await ev(`document.querySelector('#pp-presets button[data-preset="tudo"]').click(); 'ok'`);
  t('tudo limpa', await ev(`document.querySelector('#periodo-rotulo').textContent`) === 'Todo o período');

  // pedidos: contadores de remessa, filtro ativo escuro, limpar com contagem
  await ev(`document.querySelector('.aba[data-aba="pedidos"]').click(); 'ok'`);
  t('contador 1ª remessa', await ev(`document.querySelector('[data-cont="1"]').textContent`) === '4');
  t('contador todas', await ev(`document.querySelector('[data-cont="todas"]').textContent`) === '4');
  t('limpar oculto sem filtro', await ev(`document.querySelector('#btn-limpar-filtros').classList.contains('oculto')`) === true);
  await ev(`(function(){ const s = document.querySelector('#f-tipo'); s.value = 'now_pre_buy'; s.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  t('select ativo escurece', await ev(`document.querySelector('#f-tipo').classList.contains('ativo')`) === true);
  t('limpar aparece com contagem', await ev(`document.querySelector('#btn-limpar-filtros').classList.contains('oculto')`) === false && await ev(`document.querySelector('#n-filtros').textContent`) === '1');
  await ev(`document.querySelector('#btn-limpar-filtros').click(); 'ok'`);
  t('limpar zera', await ev(`document.querySelector('#f-tipo').classList.contains('ativo')`) === false);
  // exportar: menu com Excel e CSV (intercepta o download)
  await ev(`window.__blobs = []; URL.createObjectURL = b => { window.__blobs.push({ size: b.size, type: b.type }); return 'blob:x'; }; 'ok'`);
  await ev(`document.querySelector('#btn-exportar').click(); 'ok'`);
  t('menu exportar abre', await ev(`document.querySelector('#pop-exportar').classList.contains('oculto')`) === false);
  await ev(`document.querySelector('#pop-exportar button[data-fmt="xlsx"]').click(); 'ok'`);
  t('xlsx gerado', await ev(`window.__blobs.length === 1 && window.__blobs[0].size > 1500 && /spreadsheetml/.test(window.__blobs[0].type)`) === true);
  await ev(`document.querySelector('#btn-exportar').click(); document.querySelector('#pop-exportar button[data-fmt="csv"]').click(); 'ok'`);
  t('csv gerado', await ev(`window.__blobs.length === 2 && /csv/.test(window.__blobs[1].type)`) === true);
  // novo pedido: chips de tipo com cor, seletor de data, obrigatórios
  await ev(`document.querySelector('#btn-novo').click(); 'ok'`);
  t('modal novo aberto', await ev(`document.querySelector('#dlg-pedido').open`) === true);
  t('chips de tipo com bolinha', await ev(`document.querySelectorAll('.chips-tag[data-grupo="tipo"] button .bola').length`) >= 7 && await ev(`document.querySelector('.chips-tag[data-grupo="tipo"] button[data-v="saldo"]')`) === null);
  await ev(`document.querySelector('#form-pedido button[type="submit"]').click(); 'ok'`);
  t('bloqueia sem PO', await ev(`document.querySelector('#dlg-pedido').open`) === true && /Informe o PO/.test(await ev(`document.querySelector('#toast').textContent`)));
  await ev(`(function(){ const f = document.querySelector('#form-pedido'); f.po.value = 'M1'; f.fornecedor.value = 'NOVO FORN'; f.limite.click(); return 'ok'; })()`);
  t('calendário do campo abre', await ev(`document.querySelector('#form-pedido .campo-dp .dp-cal:not(.oculto)') !== null`) === true);
  await ev(`document.querySelector('#form-pedido .dp-cal:not(.oculto) button[data-dia="' + Core.addDias(Core.hojeISO(), 5) + '"]').click(); 'ok'`);
  t('data preenchida em BR', await ev(`document.querySelector('#form-pedido').limite.value`) === await ev(`Core.fmtData(Core.addDias(Core.hojeISO(), 5))`));
  t('calendário fechou', await ev(`document.querySelector('#form-pedido .campo-dp .dp-cal:not(.oculto)') === null`) === true);
  await ev(`document.querySelector('.chips-tag[data-grupo="tipo"] button[data-v="now_pre_buy"]').click(); 'ok'`);
  t('chip tipo selecionado', await ev(`document.querySelector('#form-pedido').tipo.value`) === 'now_pre_buy');
  await ev(`document.querySelector('#form-pedido button[type="submit"]').click(); 'ok'`);
  t('pedido manual salvo', await ev(`SJO.S.pedidos.find(p => p.po === 'M1') && SJO.S.pedidos.find(p => p.po === 'M1').limite === Core.addDias(Core.hojeISO(), 5) && SJO.S.pedidos.find(p => p.po === 'M1').tipo === 'now_pre_buy'`) === true);
  t('fornecedor novo cadastrado', await ev(`SJO.S.fornecedores.some(f => f.nome === 'NOVO FORN')`) === true);
  // envio + lead calculam a data limite
  await ev(`document.querySelector('#btn-novo').click(); (function(){ const f = document.querySelector('#form-pedido'); f.po.value = 'M2'; f.fornecedor.value = 'NOVO FORN'; f.envio.value = '16/09/2026'; f.leadWms.value = '15'; return 'ok'; })()`);
  await ev(`document.querySelector('#form-pedido button[type="submit"]').click(); 'ok'`);
  t('limite calculada por dias úteis', await ev(`SJO.S.pedidos.find(p => p.po === 'M2').limite`) === '2026-10-07');
  await ev(`SJO.S.pedidos = SJO.S.pedidos.filter(p => !/^M/.test(p.po)); SJO.S.fornecedores = SJO.S.fornecedores.filter(f => f.nome !== 'NOVO FORN'); 'ok'`);

  // config
  await ev(`document.querySelector('.aba[data-aba="config"]').click(); 'ok'`);
  await dorme(200);
  t('fornecedores na config', await ev(`document.querySelectorAll('#tab-forn tbody tr').length`) === 5);
  t('tags tipo na config', await ev(`document.querySelectorAll('#lista-tags-tipo .linha').length`) >= 8);
  await ev(`(function(){ const i = document.querySelector('#lista-tags-tipo .linha[data-id="tipo:now_crossdocking"] input[data-k="nome"]'); i.value = 'Cross-docking'; i.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  t('tag renomeada', await ev(`SJO.S.tags.find(t=>t.id==='tipo:now_crossdocking').nome`) === 'Cross-docking');
  await ev(`(function(){ const tr = document.querySelector('#tab-forn tbody tr'); const s = tr.querySelector('select[data-k="diaEntrega"]'); s.value='segunda'; s.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()`);
  t('regra do fornecedor salva', await ev(`SJO.S.fornecedores.some(f=>f.diaEntrega==='segunda')`) === true);
  await ev(`document.querySelector('#btn-previa-email').click(); 'ok'`);
  t('prévia e-mail', /Assunto: Pedidos/.test(await ev(`document.querySelector('#previa-email').textContent`)));

  // reimport igual: nada muda, obs preservada
  await ev(`document.querySelector('.aba[data-aba="pedidos"]').click(); document.querySelector('#btn-importar').click(); 'ok'`);
  await ev(`(function(){ const f = new File([${JSON.stringify(csv)}], 'rel.csv', {type:'text/csv'}); const dt = new DataTransfer(); dt.items.add(f); const inp = document.querySelector('#imp-arquivo'); inp.files = dt.files; inp.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  await dorme(400);
  t('reimport: 0 novos', /<b>0<\/b>novos/.test(await ev(`document.querySelector('#imp-passo-previa').innerHTML`)));
  t('reimport: confirmar desabilitado', await ev(`document.querySelector('#imp-confirmar').disabled`) === true);
  await ev(`document.querySelector('#dlg-importar').close(); 'ok'`);

  // relatório com coluna nova
  const csv2 = csv.split('\n').map((l, i) => i === 0 ? l + ';"Coluna Nova"' : (l.trim() ? l + ';"v' + i + '"' : l)).join('\n');
  await ev(`document.querySelector('#btn-importar').click(); 'ok'`);
  await ev(`(function(){ const f = new File([${JSON.stringify(csv2)}], 'rel2.csv', {type:'text/csv'}); const dt = new DataTransfer(); dt.items.add(f); const inp = document.querySelector('#imp-arquivo'); inp.files = dt.files; inp.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  await dorme(400);
  t('detectou coluna nova', /Coluna Nova/.test(await ev(`document.querySelector('#imp-passo-colunas').innerHTML`)));
  await ev(`(function(){ document.querySelector('#imp-passo-colunas input[value="add"]').checked = true; document.querySelector('#imp-colunas-ok').click(); return 'ok'; })()`);
  await dorme(300);
  t('coluna extra criada', await ev(`SJO.S.config.colunasExtras.length`) === 1);
  t('prévia com 5 atualizados', /<b>5<\/b>já existiam, com mudança/.test(await ev(`document.querySelector('#imp-passo-previa').innerHTML`)));
  await ev(`document.querySelector('#imp-confirmar').click(); 'ok'`);
  await dorme(300);
  t('extra visível na tabela', await ev(`document.querySelectorAll('#tabela-corpo input[data-k="x:coluna_nova"]').length`) >= 1);
  t('obs ainda preservada', await ev(`SJO.S.pedidos.find(p=>p.po==='900001').obs`) === 'Agendado 20/09');

  // sincronização: erro de rede → banner amarelo
  await ev(`SJO.L.apiUrl = 'http://127.0.0.1:1/'; SJO.L.chave = 'x'; SJO.LIMIAR.erros = 1; 'ok'`);
  await ev(`SJO.flush()`);
  t('pill erro', /Erro ao gravar/.test(await ev(`document.querySelector('#sync').textContent`)));
  t('banner rede visível', await ev(`!document.querySelector('#aviso').classList.contains('oculto') && document.querySelector('#aviso').classList.contains('amarelo')`) === true);
  t('banner texto rede', /Sem internet/.test(await ev(`document.querySelector('#aviso').textContent`)));
  t('banner diz pra não fechar', /Não feche o navegador/.test(await ev(`document.querySelector('#aviso').textContent`)));
  // google respondeu HTML → banner vermelho
  await ev(`SJO.L.apiUrl = 'http://127.0.0.1:' + ${PORTA} + '/index.html'; 'ok'`);
  await ev(`SJO.flush()`);
  t('banner google', /Google não respondeu/.test(await ev(`document.querySelector('#aviso').textContent`)) && await ev(`document.querySelector('#aviso').classList.contains('vermelho')`) === true);
  t('banner tem "fale com um dev"', /fale com um dev/.test(await ev(`document.querySelector('#aviso').textContent`)));
  // chave inválida
  await ev(`SJO.L.apiUrl = 'http://127.0.0.1:' + ${PORTA} + '/api-chave'; 'ok'`);
  await ev(`SJO.flush()`);
  t('banner chave', /recusou a chave/.test(await ev(`document.querySelector('#aviso').textContent`)));
  // sem conexão configurada com fila → aviso
  await ev(`SJO.L.apiUrl = ''; SJO.renderAviso(); 'ok'`);
  t('banner sem conexão', /Sem conexão configurada/.test(await ev(`document.querySelector('#aviso').textContent`)));
  // servidor ok → grava tudo, banner some, pill Salvo, POSTs chegaram com a chave
  const filaAntes = await ev(`SJO.S.fila.length`);
  await ev(`SJO.L.apiUrl = 'http://127.0.0.1:' + ${PORTA} + '/api-ok'; SJO.L.chave = 'segredo'; 'ok'`);
  await ev(`SJO.flush()`);
  t('fila esvaziou', await ev(`SJO.S.fila.length`) === 0 && filaAntes > 0);
  t('pill Salvo', await ev(`document.querySelector('#sync').textContent`) === 'Salvo');
  t('banner sumiu', await ev(`document.querySelector('#aviso').classList.contains('oculto')`) === true);
  t('POSTs chegaram com chave', API.posts.length >= filaAntes && API.posts.every(p => p.chave === 'segredo'));
  t('upsert enviado com pedidos', API.posts.some(p => p.acao === 'upsertPedidos' && p.pedidos.length >= 5));
  t('config enviada sem chave/apiUrl', API.posts.filter(p => p.acao === 'salvarConfig').every(p => p.config.apiUrl === undefined && p.config.chave === undefined));
  // leitura: servidor devolve 1 pedido → substitui local
  API.pedidos = [{ po: 'SRV1', fornecedor: 'DO SERVIDOR', limite: '2026-12-01', qtd: 3, extras: {} }];
  t('sincronizar lê do servidor', await ev(`SJO.sincronizar(true)`) === true);
  t('pedidos vieram do servidor', await ev(`SJO.S.pedidos.length === 1 && SJO.S.pedidos[0].po === 'SRV1'`) === true);
  t('config do servidor aplicada', await ev(`SJO.S.config.emailDestino`) === 'x@y.z');
  // volta ao estado sem conexão pra testar persistência
  await ev(`SJO.L.apiUrl = ''; SJO.L.chave = ''; 'ok'`);
  await ev(`(function(){ const i = document.querySelector('#tabela-corpo input[data-k="obs"][data-po="SRV1"]'); i.value = 'x'; i.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);

  // link de acesso: gera, decodifica e configura num navegador "limpo"
  await ev(`SJO.L.apiUrl = 'https://script.google.com/macros/s/ABC/exec'; SJO.L.chave = 'chave-teste-ção'; 'ok'`);
  const linkAcesso = await ev(`SJO.gerarLinkAcesso()`);
  t('link de acesso tem #acesso=', /#acesso=[A-Za-z0-9_-]+$/.test(linkAcesso));
  await ev(`localStorage.removeItem('sjo_local_v1'); 'ok'`);
  await cmd('Page.navigate', { url: 'http://127.0.0.1:' + PORTA + '/index.html' + linkAcesso.slice(linkAcesso.indexOf('#')) });
  await dorme(1000);
  t('link configurou url e chave (com acento)', await ev(`SJO.L.apiUrl`) === 'https://script.google.com/macros/s/ABC/exec' && await ev(`SJO.L.chave`) === 'chave-teste-ção');
  t('chave sumiu da barra de endereço', await ev(`location.hash`) === '' || await ev(`location.hash`) === '#dash');
  t('chave guardada no navegador', /chave-teste/.test(await ev(`localStorage.getItem('sjo_local_v1')`)));
  await cmd('Page.navigate', { url: 'http://127.0.0.1:' + PORTA + '/index.html#acesso=lixo' }); await dorme(800);
  t('link inválido não derruba', await ev(`document.querySelector('.aba.ativa') !== null`) === true);
  await ev(`SJO.L.apiUrl = ''; SJO.L.chave = ''; 'ok'`);
  await ev(`(function(){ try { localStorage.setItem('sjo_local_v1', JSON.stringify({apiUrl:'', chave:''})); } catch(e){} return 'ok'; })()`);

  // persistência: recarrega a página
  await cmd('Page.navigate', { url: 'http://127.0.0.1:' + PORTA + '/index.html#pedidos' });
  await dorme(1000);
  t('recarregou com dados', await ev(`SJO.S.pedidos.length`) === 1);
  t('fila preservada', await ev(`SJO.S.fila.length`) >= 1);

  t('sem erros de JS', erros.length === 0);
  if (erros.length) console.log('ERROS:\n  ' + erros.join('\n  '));
  console.log(ok + ' ok, ' + falhas.length + ' falhas' + (falhas.length ? ':\n  ' + falhas.join('\n  ') : ''));
  ws.close(); chrome.kill(); servidor.close(); setTimeout(() => { try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) { } }, 500);
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error(e); chrome.kill(); servidor.close(); process.exit(2); });
