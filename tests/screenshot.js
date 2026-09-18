/* Gera capturas de tela em docs/img com o CSV de amostra. Uso: node tests/screenshot.js */
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const RAIZ = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORTA = 8766, DBG = 9334;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const servidor = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]); const p = path.join(RAIZ, u === '/' ? 'index.html' : u);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' }); res.end(d); });
}).listen(PORTA);
const perfil = fs.mkdtempSync('/tmp/sjo-shot-');
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--window-size=1360,900', '--user-data-dir=' + perfil, '--remote-debugging-port=' + DBG, 'about:blank'], { stdio: 'ignore' });
const dorme = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let alvo; for (let i = 0; i < 40 && !alvo; i++) { await dorme(250); try { alvo = (await (await fetch('http://127.0.0.1:' + DBG + '/json')).json()).find(t => t.type === 'page'); } catch (e) { } }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const cmd = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async expr => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
  await cmd('Page.enable'); await cmd('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: 'http://127.0.0.1:' + PORTA + '/index.html#pedidos' }); await dorme(1000);
  const csv = fs.readFileSync(path.join(RAIZ, 'amostras/relatorio-exemplo.csv'), 'utf8');
  await ev(`document.querySelector('#btn-importar').click(); 'ok'`);
  await ev(`(function(){ const f = new File([${JSON.stringify(csv)}], 'rel.csv', {type:'text/csv'}); const dt = new DataTransfer(); dt.items.add(f); const inp = document.querySelector('#imp-arquivo'); inp.files = dt.files; inp.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
  await dorme(400);
  const shot = async nome => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(RAIZ, 'docs/img', nome), Buffer.from(r.result.data, 'base64')); };
  await shot('importar.png');
  await ev(`document.querySelector('#imp-confirmar').click(); 'ok'`); await dorme(300);
  // dados de exemplo pra tela ficar viva
  await ev(`(function(){ const S = SJO.S; const h = Core.hojeISO();
    const p = po => S.pedidos.find(x => x.po === po);
    p('900001').obs = 'Agendado 20/09'; p('900001').acao = 'Agendado'; p('900001').dataAcao = Core.addDias(h, 2);
    p('900002').acao = 'Enviar ativo'; p('900002').dataAcao = h; p('900002').obs = 'Ag. retorno fornecedor';
    p('900003').acao = 'Agendar'; p('900003').dataAcao = Core.addDias(h, -1); p('900003').obs = 'Previsão 25/09';
    p('900004').finalizacao = h; p('900004').obs = 'NF recebida';
    p('900005').acao = 'Ag. NF'; p('900005').limite = Core.addDias(h, 1); p('900002').limite = h;
    S.fornecedores.forEach((f, i) => { f.cor = ['#0ea5e9','#8b5cf6','#f59e0b','#10b981','#ec4899'][i]; });
    S.fornecedores[0].transportadora = 'Dumar'; S.fornecedores[0].diaEntrega = 'segunda'; S.fornecedores[0].prazoNF = 'quarta';
    S.fornecedores[1].transportadora = 'Expresso Araújo'; S.fornecedores[1].diaEntrega = 'quarta'; S.fornecedores[1].prazoNF = 'sexta';
    S.fornecedores[2].obs = 'Milk Run'; S.fornecedores[2].coleta = true;
    S.transportadoras.push({id:'t1', nome:'Dumar', email:'coleta@exemplo.com', diaEntrega:'segunda', regra:'NF até quarta'});
    S.transportadoras.push({id:'t2', nome:'Expresso Araújo', email:'', diaEntrega:'quarta', regra:'NF até sexta, sem coleta'});
    S.fila.length = 0; S.filaDesde = 0; SJO.renderAviso();
    S.config.emailDestino = 'julia@exemplo.com'; S.config.linkApp = 'https://flux-marketing-ai.github.io/system-julia-oliveira/';
    return 'ok'; })()`);
  await ev(`document.querySelector('.aba[data-aba="pedidos"]').click(); 'ok'`); await dorme(200); await shot('pedidos.png');
  await ev(`document.querySelector('#tabela-corpo input[data-sel="900002"]').click(); document.querySelector('#tabela-corpo input[data-sel="900005"]').click(); 'ok'`); await dorme(200); await shot('pedidos-massa.png');
  await ev(`document.querySelector('button[data-massa="limpar"]').click(); 'ok'`);
  await ev(`document.querySelector('.aba[data-aba="dash"]').click(); 'ok'`); await dorme(200); await shot('dash.png');
  await ev(`document.querySelector('.kpi[data-filtro="vence"]').click(); 'ok'`); await dorme(200); await shot('dash-vencem.png');
  await ev(`document.querySelector('.kpi[data-filtro="vence"]').click(); document.querySelector('#periodo-btn').click(); 'ok'`); await dorme(200); await shot('periodo.png');
  await ev(`document.querySelector('#periodo-btn').click(); document.querySelector('.aba[data-aba="pedidos"]').click(); document.querySelector('#btn-novo').click(); 'ok'`); await dorme(200);
  await ev(`(function(){ const f = document.querySelector('#form-pedido'); f.po.value = '900010'; f.fornecedor.value = 'TECIDOS BETA S.A.'; f.limite.click(); return 'ok'; })()`); await dorme(200); await shot('novo-pedido.png');
  await ev(`document.querySelector('#dlg-pedido').close(); document.querySelector('.aba[data-aba="config"]').click(); 'ok'`); await dorme(200); await shot('config.png');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ev(`document.querySelector('.aba[data-aba="dash"]').click(); 'ok'`); await dorme(300); await shot('celular-dash.png');
  ws.close(); chrome.kill(); servidor.close(); setTimeout(() => { try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) { } }, 500); console.log('ok');
})().catch(e => { console.error(e); chrome.kill(); servidor.close(); process.exit(2); });
