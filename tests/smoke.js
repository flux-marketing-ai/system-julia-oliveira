/* Teste de tela em Chrome headless via CDP (sem dependências).
   Sobe um servidor estático, abre o app, simula importação do CSV de amostra, edita, finaliza,
   e confere o DOM. Uso: node tests/smoke.js */
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const RAIZ = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORTA = 8765, DBG = 9333;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv' };

const servidor = http.createServer((req, res) => {
  const p = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
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

  t('título', await ev('document.title') === 'Pedidos');
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
  t('tag saldo aparece', /Saldo/.test(await ev(`document.querySelector('#tabela-corpo tr[data-po="900001"]').innerHTML`)));
  // finalizar
  await ev(`document.querySelector('button[data-acao="finalizar"][data-po="900003"]').click(); 'ok'`);
  t('finalizado some de abertos', await ev(`document.querySelectorAll('#tabela-corpo tr').length`) === 4);
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
  // período global persiste entre abas
  await ev(`(function(){ const s = document.querySelector('#periodo-preset'); s.value = '30'; s.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  await ev(`document.querySelector('.aba[data-aba="pedidos"]').click(); 'ok'`);
  t('período mantido na outra aba', await ev(`document.querySelector('#periodo-preset').value`) === '30');
  t('período filtra tabela', await ev(`document.querySelectorAll('#tabela-corpo tr').length`) <= 4);
  await ev(`(function(){ const s = document.querySelector('#periodo-preset'); s.value = 'tudo'; s.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);

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

  // persistência: recarrega a página
  await cmd('Page.navigate', { url: 'http://127.0.0.1:' + PORTA + '/index.html#pedidos' });
  await dorme(1000);
  t('recarregou com dados', await ev(`SJO.S.pedidos.length`) === 5);
  t('fila preservada', await ev(`SJO.S.fila.length`) >= 1);

  t('sem erros de JS', erros.length === 0);
  if (erros.length) console.log('ERROS:\n  ' + erros.join('\n  '));
  console.log(ok + ' ok, ' + falhas.length + ' falhas' + (falhas.length ? ':\n  ' + falhas.join('\n  ') : ''));
  ws.close(); chrome.kill(); servidor.close(); setTimeout(() => { try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) { } }, 500);
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error(e); chrome.kill(); servidor.close(); process.exit(2); });
