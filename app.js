/* app.js — tela do sistema de pedidos. Depende de core.js (window.Core).
   Fonte da verdade: planilha Google via Apps Script. localStorage é cache + fila de envio. */
(function () {
  'use strict';
  const C = window.Core;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoje = () => C.hojeISO();
  const ico = n => '<svg class="ico"><use href="#i-' + n + '"/></svg>';

  // ---------------- Estado ----------------
  const LS = 'sjo_estado_v1', LS_LOCAL = 'sjo_local_v1';
  let S = { pedidos: [], fornecedores: [], transportadoras: [], tags: [], config: {}, fila: [], versao: 0, ultimaSync: '' };
  let L = { apiUrl: '', chave: '' }; // só neste navegador
  let UI = { aba: 'dash', ordem: { col: 'limite', dir: 'asc' }, filtros: { status: 'abertos', remessa: '1' }, buscaForn: '' };

  function carregar() {
    try { const s = JSON.parse(localStorage.getItem(LS) || 'null'); if (s) S = Object.assign(S, s); } catch (e) { }
    try { const l = JSON.parse(localStorage.getItem(LS_LOCAL) || 'null'); if (l) L = Object.assign(L, l); } catch (e) { }
    try { const u = JSON.parse(sessionStorage.getItem('sjo_ui') || 'null'); if (u) UI = Object.assign(UI, u); } catch (e) { }
    S.config = normalizarConfig(S.config);
    if (!S.tags.length) S.tags = C.TAGS_PADRAO.map(t => Object.assign({}, t));
    if (!S.config.acoes || !S.config.acoes.length) S.config.acoes = C.ACOES_PADRAO.slice();
    S.pedidos.forEach(p => { p.extras = p.extras || {}; });
  }
  function normalizarConfig(c) {
    const cfg = JSON.parse(JSON.stringify(C.CONFIG_PADRAO));
    c = c || {};
    Object.keys(c).forEach(k => {
      if (k === 'apiUrl' || k === 'chave') return;
      if (c[k] !== null && typeof c[k] === 'object' && !Array.isArray(c[k])) cfg[k] = Object.assign({}, cfg[k] || {}, c[k]);
      else if (c[k] !== undefined) cfg[k] = c[k];
    });
    cfg.hora = Number(cfg.hora); cfg.antecedencia = Number(cfg.antecedencia);
    cfg.diasSemana = (cfg.diasSemana || []).map(Number);
    if (!cfg.periodo.preset) cfg.periodo.preset = (cfg.periodo.de || cfg.periodo.ate) ? 'custom' : 'tudo';
    if (!cfg.periodo.campo) cfg.periodo.campo = 'limite';
    cfg.dashProximos = Number(cfg.dashProximos) || 7; cfg.dashTop = Number(cfg.dashTop) || 10;
    return cfg;
  }
  function salvarLocal() {
    try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { toast('Sem espaço no navegador pra guardar o cache', true); }
    try { localStorage.setItem(LS_LOCAL, JSON.stringify(L)); } catch (e) { }
    try { sessionStorage.setItem('sjo_ui', JSON.stringify(UI)); } catch (e) { }
  }

  // ---------------- API / sincronização ----------------
  const conectado = () => !!(L.apiUrl && L.chave);
  let flushando = false, timerFlush = null;
  // erros seguidos, tipo do último erro e quando a fila começou a acumular (S.filaDesde persiste)
  const SY = { erros: 0, tipo: '', msg: '', forcarAviso: false };
  const LIMIAR = { pendenteMs: 2 * 60000, erros: 2 };

  function setSync(cls, txt, title) { const el = $('#sync'); el.className = 'sync ' + cls; el.textContent = txt; el.title = title || ''; }
  function atualizarSync() {
    if (!conectado()) setSync('off', 'Sem planilha', 'Configure a conexão em Configurações');
    else if (S.fila.length && SY.erros) setSync('erro', 'Erro ao gravar · ' + S.fila.length + ' pendente' + (S.fila.length > 1 ? 's' : ''), SY.msg);
    else if (S.fila.length) setSync('pendente', S.fila.length + ' pendente' + (S.fila.length > 1 ? 's' : ''), 'Aguardando gravar na planilha');
    else setSync('ok', 'Salvo', S.ultimaSync ? 'Última sincronização: ' + S.ultimaSync : '');
    renderAviso();
  }

  // rede (sem internet / bloqueio) · chave · planilha (setup) · google (respondeu HTML ou 5xx) · outro
  function classificarErro(e) {
    const m = String((e && e.message) || e || '');
    if (e instanceof TypeError || /fetch|network|Load failed/i.test(m)) return 'rede';
    if (/Chave inválida/i.test(m)) return 'chave';
    if (/setup\(\)|não existe/i.test(m)) return 'planilha';
    if (e instanceof SyntaxError || /JSON|Unexpected token|Resposta inválida/i.test(m)) return 'google';
    return 'outro';
  }
  function registrarErro(e) {
    SY.erros++; SY.tipo = classificarErro(e); SY.msg = String((e && e.message) || e || '');
    console.warn('sincronização', SY.tipo, e);
    if (SY.erros === 1 && S.fila.length) toast('Não consegui gravar na planilha. Guardei aqui e vou tentar de novo sozinho.', true);
  }
  function tempoDesde(ts) {
    const min = Math.round((Date.now() - ts) / 60000);
    return min < 1 ? 'agora' : min < 60 ? 'há ' + min + ' min' : 'há ' + Math.round(min / 60) + ' h';
  }
  function renderAviso() {
    const el = $('#aviso'); if (!el) return;
    const n = S.fila.length;
    let mostrar = false, cls = 'amarelo', html = '';
    const acoes = '<button class="btn-mini" data-aviso="tentar">Tentar agora</button> <button class="btn-mini" data-aviso="copia">Baixar cópia (Excel)</button>';
    const guarda = n + (n === 1 ? ' alteração guardada' : ' alterações guardadas') + ' neste navegador' + (S.filaDesde ? ' (' + tempoDesde(S.filaDesde) + ')' : '') + '. <b>Não feche o navegador limpando os dados</b> até aparecer "Salvo" em verde.';
    if (n && !conectado()) {
      mostrar = true; html = '<b>Sem conexão configurada.</b> ' + guarda + ' Configure a conexão em Configurações. ' + '<button class="btn-mini" data-aviso="config">Abrir Configurações</button>';
    } else if (n && (SY.forcarAviso || SY.erros >= LIMIAR.erros || (S.filaDesde && Date.now() - S.filaDesde > LIMIAR.pendenteMs))) {
      mostrar = true;
      if (SY.tipo === 'chave') { cls = 'vermelho'; html = '<b>A planilha recusou a chave de acesso.</b> ' + guarda + ' Confira a chave em Configurações → Conexão. <button class="btn-mini" data-aviso="config">Abrir Configurações</button> ' + acoes; }
      else if (SY.tipo === 'planilha') { cls = 'vermelho'; html = '<b>A planilha não está preparada</b> (' + esc(SY.msg) + '). ' + guarda + ' Fale com um dev. ' + acoes; }
      else if (SY.tipo === 'google') { cls = 'vermelho'; html = '<b>O Google não respondeu direito.</b> ' + guarda + ' Aguarde alguns minutos e tente novamente. Se continuar, fale com um dev. ' + acoes; }
      else if (SY.tipo === 'outro') { cls = 'vermelho'; html = '<b>Erro ao gravar:</b> ' + esc(SY.msg) + '. ' + guarda + ' Aguarde e tente novamente. Se continuar, fale com um dev. ' + acoes; }
      else { html = '<b>Sem internet ou a planilha não respondeu.</b> ' + guarda + ' Reenvio automático a cada 30 s. ' + acoes; }
    }
    el.className = 'aviso ' + cls + (mostrar ? '' : ' oculto');
    if (mostrar) el.innerHTML = html;
  }

  async function apiGet(params) {
    const qs = new URLSearchParams(Object.assign({ chave: L.chave }, params)).toString();
    const r = await fetch(L.apiUrl + '?' + qs, { method: 'GET', redirect: 'follow' });
    const j = await r.json();
    if (!j || j.ok !== true) throw new Error((j && j.erro) || 'Resposta inválida');
    return j;
  }
  async function apiPost(body) {
    const r = await fetch(L.apiUrl, { method: 'POST', redirect: 'follow', body: JSON.stringify(Object.assign({ chave: L.chave }, body)) });
    const j = await r.json();
    if (!j || j.ok !== true) throw new Error((j && j.erro) || 'Resposta inválida');
    return j;
  }

  // Enfileira uma operação; junta com a anterior quando dá (mesmo tipo)
  function enfileirar(op) {
    const ult = S.fila[S.fila.length - 1];
    if (ult && !ult.emVoo && ult.acao === op.acao) {
      if (op.acao === 'upsertPedidos') {
        const m = new Map(ult.pedidos.map(p => [p.po, p]));
        op.pedidos.forEach(p => m.set(p.po, p));
        ult.pedidos = Array.from(m.values());
      } else if (op.acao === 'deletePedidos') ult.pos = Array.from(new Set(ult.pos.concat(op.pos)));
      else if (op.acao === 'replaceLista' && ult.lista === op.lista) ult.linhas = op.linhas;
      else if (op.acao === 'salvarConfig') ult.config = op.config;
      else if (op.acao === 'log') ult.entradas = ult.entradas.concat(op.entradas);
      else S.fila.push(op);
    } else S.fila.push(op);
    if (!S.filaDesde) S.filaDesde = Date.now();
    salvarLocal(); atualizarSync();
    clearTimeout(timerFlush); timerFlush = setTimeout(flush, 800);
  }

  async function flush() {
    if (flushando || !conectado() || !S.fila.length) { atualizarSync(); return; }
    flushando = true;
    try {
      while (S.fila.length) {
        const op = S.fila[0]; op.emVoo = true;
        const corpo = Object.assign({}, op); delete corpo.emVoo;
        await apiPost(corpo);
        S.fila.shift(); SY.erros = 0; SY.forcarAviso = false; salvarLocal(); atualizarSync();
      }
      S.filaDesde = 0; S.ultimaSync = new Date().toLocaleString('pt-BR'); salvarLocal(); atualizarSync();
    } catch (e) {
      if (S.fila[0]) S.fila[0].emVoo = false;
      registrarErro(e); atualizarSync();
    } finally { flushando = false; }
  }

  async function sincronizar(silencioso) {
    if (!conectado()) { atualizarSync(); return false; }
    await flush();
    if (S.fila.length) return false; // ainda tem pendência, não sobrescreve
    try {
      setSync('pendente', 'Lendo…');
      const r = await apiGet({ acao: 'tudo' });
      S.pedidos = (r.pedidos || []).map(p => { p.extras = p.extras || {}; return p; });
      S.fornecedores = r.fornecedores || []; S.transportadoras = r.transportadoras || [];
      S.tags = (r.tags && r.tags.length) ? r.tags : S.tags;
      S.config = normalizarConfig(Object.assign({}, S.config, r.config || {}));
      if (!S.config.acoes || !S.config.acoes.length) S.config.acoes = C.ACOES_PADRAO.slice();
      S.ultimaSync = new Date().toLocaleString('pt-BR');
      salvarLocal(); atualizarSync(); renderTudo();
      if (!silencioso) toast('Sincronizado com a planilha');
      return true;
    } catch (e) {
      const tipo = classificarErro(e);
      setSync('erro', 'Erro ao ler', String(e.message || e));
      if (!silencioso) toast(tipo === 'rede' ? 'Sem internet ou a planilha não respondeu. Mostrando a última cópia guardada.' : tipo === 'chave' ? 'A planilha recusou a chave. Confira em Configurações.' : 'Não consegui ler a planilha (' + (e.message || e) + '). Aguarde e tente novamente; se continuar, fale com um dev.', true);
      return false;
    }
  }

  // ---------------- Mutações ----------------
  const CAMPOS_JULIA = ['acao', 'dataAcao', 'obs', 'qtdEntregue', 'finalizacao', 'remessa'];

  function pedidoPorPO(po) { return S.pedidos.find(p => String(p.po) === String(po)); }

  function gravarPedidos(lista, log) {
    enfileirar({ acao: 'upsertPedidos', pedidos: lista.map(limparPedido) });
    if (log) enfileirar({ acao: 'log', entradas: [log].flat().map(l => Object.assign({ quando: new Date().toISOString() }, l)) });
    salvarLocal();
  }
  function limparPedido(p) {
    const o = {}; C.CAMPOS.forEach(c => { o[c.k] = p[c.k] == null ? '' : p[c.k]; });
    o.saldo = C.saldo(p); o.extras = p.extras || {}; return o;
  }

  function editarCampo(po, k, valor) {
    const p = pedidoPorPO(po); if (!p) return;
    const c = C.CAMPO[k];
    if (k.startsWith('x:')) { p.extras[k.slice(2)] = valor; }
    else if (c && (c.tipo === 'int')) p[k] = Math.max(0, Math.round(C.parseNumBR(valor)));
    else if (c && c.tipo === 'moeda') p[k] = C.parseNumBR(valor);
    else if (c && c.tipo === 'data') p[k] = C.parseData(valor);
    else p[k] = String(valor || '').trim();
    if (CAMPOS_JULIA.includes(k) || k.startsWith('x:')) p.update = hoje();
    if (k === 'qtdEntregue' && C.temSaldo(p) && C.remessaDe(p) !== '2') { p.remessa = '2'; toast('PO ' + p.po + ' foi pra 2ª remessa (saldo ' + C.saldo(p) + ')'); }
    if (k === 'acao' && p.acao && !S.config.acoes.includes(p.acao)) { S.config.acoes.push(p.acao); salvarConfig(); }
    gravarPedidos([p]);
    renderTudo();
  }
  function finalizar(po, desfazer) {
    const p = pedidoPorPO(po); if (!p) return;
    p.finalizacao = desfazer ? '' : hoje(); p.update = hoje();
    gravarPedidos([p], { tipo: desfazer ? 'reabrir' : 'finalizar', po: p.po });
    renderTudo(); toast(desfazer ? 'Pedido reaberto' : 'PO ' + p.po + ' finalizado');
  }
  function moverRemessa(po, para) {
    const p = pedidoPorPO(po); if (!p) return;
    p.remessa = para; p.update = hoje();
    gravarPedidos([p], { tipo: 'remessa', po: p.po, para }); renderTudo(); toast('PO ' + p.po + ' → ' + para + 'ª remessa');
  }
  function concluirAcao(po) {
    const p = pedidoPorPO(po); if (!p) return;
    const marca = (p.acao || 'Ação') + (p.dataAcao ? ' ' + C.fmtDataCurta(p.dataAcao) : '') + ' ✓';
    p.obs = p.obs ? p.obs + ' · ' + marca : marca;
    p.acao = ''; p.dataAcao = ''; p.update = hoje();
    gravarPedidos([p]); renderTudo();
  }
  function excluirPedido(po) {
    S.pedidos = S.pedidos.filter(p => String(p.po) !== String(po));
    enfileirar({ acao: 'deletePedidos', pos: [String(po)] });
    enfileirar({ acao: 'log', entradas: [{ quando: new Date().toISOString(), tipo: 'excluir', po }] });
    salvarLocal(); renderTudo();
  }
  function salvarConfig() {
    const c = Object.assign({}, S.config); delete c.apiUrl; delete c.chave;
    enfileirar({ acao: 'salvarConfig', config: c }); salvarLocal();
  }
  function salvarLista(nome) { enfileirar({ acao: 'replaceLista', lista: nome, linhas: S[nome] }); salvarLocal(); }

  // garante fornecedor e tags pra pedidos novos; devolve quantos criou
  function garantirCadastros(pedidos) {
    let novosF = 0, novasT = 0;
    pedidos.forEach(p => {
      if (p.fornecedor && !C.acharFornecedor(p.fornecedor, S.fornecedores)) {
        S.fornecedores.push({ id: C.id(), nome: p.fornecedor, aliases: '', cor: '', transportadora: '', diaEntrega: '', prazoNF: '', coleta: false, obs: '' }); novosF++;
      }
      ['tipo', 'time'].forEach(g => {
        const cod = p[g]; if (!cod) return;
        if (!S.tags.some(t => t.grupo === g && t.codigo === cod)) { S.tags.push({ id: g + ':' + cod, grupo: g, codigo: cod, nome: cod, cor: '#9ca3af' }); novasT++; }
      });
    });
    if (novosF) salvarLista('fornecedores');
    if (novasT) salvarLista('tags');
    return { novosF, novasT };
  }

  // ---------------- Helpers de exibição ----------------
  function tagDe(grupo, codigo) { return S.tags.find(x => x.grupo === grupo && x.codigo === codigo); }
  function nomeTag(grupo, codigo) { const t = tagDe(grupo, codigo); return t ? t.nome : (codigo || ''); }
  function tag(grupo, codigo) {
    if (!codigo) return '';
    const t = tagDe(grupo, codigo);
    const cor = (t && t.cor) || '#9ca3af';
    return '<span class="tag' + (clara(cor) ? ' clara' : '') + '" style="--cor:' + esc(cor) + '" title="' + esc(codigo) + '">' + esc(t ? t.nome : codigo) + '</span>';
  }
  function clara(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); if (!m) return false;
    const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16));
    return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
  }
  function fornecedorDe(nome) { return C.acharFornecedor(nome, S.fornecedores); }
  function regraFornecedor(f) {
    if (!f) return '';
    const partes = [];
    if (f.transportadora) partes.push(f.transportadora);
    if (f.diaEntrega) partes.push('entrega ' + f.diaEntrega);
    if (f.prazoNF) partes.push('NF até ' + f.prazoNF);
    if (f.coleta) partes.push('precisa coleta');
    if (f.obs) partes.push(f.obs);
    return partes.join(' · ');
  }
  function corFornecedor(nome) { const f = fornecedorDe(nome); return (f && f.cor) || '#d1d5db'; }
  function chipFornecedor(nome) {
    const f = fornecedorDe(nome);
    const regra = regraFornecedor(f);
    return '<span class="chip-forn" title="' + esc(regra || nome) + '"><span class="bola" style="--cor:' + esc((f && f.cor) || '#d1d5db') + '"></span>' + esc(nome) + '</span>';
  }
  function statusPill(st) {
    return '<span class="status-pill" style="--cor:' + esc(S.config.statusCores[st]) + '">' + esc(S.config.statusNomes[st]) + '</span>';
  }
  function transpDoFornecedor(nome) { const f = fornecedorDe(nome); return f ? (f.transportadora || '') : ''; }
  function ctx() { return { hoje: hoje(), antecedencia: S.config.antecedencia, transpDoFornecedor, statusNomes: S.config.statusNomes, extrasNome: Object.fromEntries((S.config.colunasExtras || []).map(e => [e.k, e.nome])) }; }
  function periodoAtual() { return S.config.periodo || { de: '', ate: '', campo: 'limite' }; }
  function pedidosNoPeriodo() { return S.pedidos.filter(p => C.noPeriodo(p, periodoAtual())); }

  let toastTimer;
  function toast(msg, erro) {
    const el = $('#toast'); el.textContent = msg; el.className = 'toast' + (erro ? ' erro' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('oculto'), erro ? 6000 : 2800);
  }
  function baixar(dados, nome, tipo) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([dados], { type: tipo }));
    a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportarLista(lista, nome, fmt) {
    const cols = colunasVisiveis();
    if (fmt === 'csv') baixar(C.exportarCSV(lista, cols, ctx()), nome + '-' + hoje() + '.csv', 'text/csv;charset=utf-8');
    else baixar(C.exportarXLSX(lista, cols, Object.assign(ctx(), { nomeAba: 'Pedidos' })), nome + '-' + hoje() + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast(fmt === 'csv' ? 'CSV gerado' : 'Excel gerado');
  }

  // ---------------- Calendário (compartilhado: período e datas do formulário) ----------------
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mesDe = iso => (iso || hoje()).slice(0, 7);
  function mesAdd(ym, n) { const [a, m] = ym.split('-').map(Number); const d = new Date(a, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  // sel: {de, ate}; nav: 'esq' | 'dir' | 'ambos' | 'nenhum'
  function calMesHTML(ym, sel, nav) {
    const [a, m] = ym.split('-').map(Number);
    const primeiro = new Date(a, m - 1, 1); const ini = new Date(a, m - 1, 1 - primeiro.getDay());
    const h = hoje(); let html = '<div class="cal-mes"><div class="cal-cab">' +
      (nav === 'esq' || nav === 'ambos' ? '<button type="button" data-nav="-1" title="Mês anterior">' + ico('left') + '</button>' : '<span class="vazio-nav"></span>') +
      '<span>' + MESES[m - 1] + ' ' + a + '</span>' +
      (nav === 'dir' || nav === 'ambos' ? '<button type="button" data-nav="1" title="Próximo mês">' + ico('right') + '</button>' : '<span class="vazio-nav"></span>') +
      '</div><div class="cal-grade">' + ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => '<span class="dsem">' + d + '</span>').join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + i);
      const iso = C.hojeISO(d); const fora = d.getMonth() !== m - 1;
      if (i === 35 && fora) break;
      const cls = ['', fora ? 'fora' : '', iso === h ? 'hoje' : '', (d.getDay() === 0 || d.getDay() === 6) ? 'fds' : '',
        sel && sel.de && sel.ate && iso > sel.de && iso < sel.ate ? 'na-faixa' : '',
        sel && iso === sel.de ? 'ini' : '', sel && iso === sel.ate ? 'fim' : '',
        sel && sel.de && sel.ate && sel.de !== sel.ate && (iso === sel.de || iso === sel.ate) ? 'na-faixa' : ''].filter(Boolean).join(' ');
      html += '<button type="button" class="' + cls + '" data-dia="' + iso + '">' + d.getDate() + '</button>';
    }
    return html + '</div></div>';
  }

  // ---------------- Período global ----------------
  const PC = { mes: mesDe(), de: '', ate: '', pendente: false };
  function renderPeriodo() {
    const p = periodoAtual();
    $('#periodo-rotulo').textContent = C.rotuloPeriodo(p) + (p.campo === 'envio' && (p.de || p.ate) ? ' · envio' : '');
    $('#periodo-btn').classList.toggle('ativo', !!(p.de || p.ate));
    const ativo = p.preset || 'tudo';
    const grupos = [['tudo', 'hoje', 'ontem', 'u7', 'u14', 'mes', 'mesPassado', 'u60', 'u90'], ['p7', 'p14', 'p30']];
    $('#pp-presets').innerHTML = grupos.map(g => g.map(id => { const pr = C.PRESETS_PERIODO.find(x => x.id === id); return '<button type="button" data-preset="' + id + '"' + (ativo === id ? ' class="ativo"' : '') + '>' + esc(pr.nome) + '</button>'; }).join('')).join('<div class="sep"></div>');
    $$('#pp-campo button').forEach(b => b.classList.toggle('ativo', b.dataset.v === (p.campo || 'limite')));
    if (!PC.pendente) { PC.de = p.de; PC.ate = p.ate; }
    $('#pp-de').value = C.fmtData(PC.de); $('#pp-ate').value = C.fmtData(PC.ate);
    $('#pp-cal').innerHTML = calMesHTML(PC.mes, { de: PC.de, ate: PC.ate }, 'esq') + calMesHTML(mesAdd(PC.mes, 1), { de: PC.de, ate: PC.ate }, 'dir');
    $('#pp-dica').textContent = PC.pendente ? 'agora clique no fim' : 'clique no início e no fim';
  }
  function definirPeriodo(preset, de, ate, campo) {
    const per = preset === 'custom' ? { de: de || '', ate: ate || '' } : C.calcularPeriodo(preset, hoje());
    per.preset = preset; per.campo = campo || periodoAtual().campo || 'limite';
    if (per.de && per.ate && per.de > per.ate) { const t = per.de; per.de = per.ate; per.ate = t; }
    S.config.periodo = per; PC.pendente = false; PC.de = per.de; PC.ate = per.ate;
    if (per.de) PC.mes = mesDe(per.de);
    salvarConfig(); renderPeriodo(); renderAba();
  }
  function clicarDiaPeriodo(iso) {
    if (!PC.pendente) { PC.de = iso; PC.ate = iso; PC.pendente = true; renderPeriodo(); return; }
    PC.pendente = false;
    const de = iso < PC.de ? iso : PC.de, ate = iso < PC.de ? PC.de : iso;
    definirPeriodo('custom', de, ate);
    fecharPopovers();
  }

  // ---------------- Seletor de data nos formulários (input.dp + .dp-cal) ----------------
  function abrirDP(inp) {
    const cal = inp.parentNode.querySelector('.dp-cal'); if (!cal) return;
    $$('.dp-cal').forEach(c => { if (c !== cal) c.classList.add('oculto'); });
    const v = C.parseData(inp.value);
    if (cal.classList.contains('oculto')) cal.dataset.mes = mesDe(v || hoje());
    renderDP(cal, v); cal.classList.remove('oculto');
  }
  function renderDP(cal, v) {
    cal.innerHTML = calMesHTML(cal.dataset.mes, { de: v, ate: v }, 'ambos') + '<div class="dp-rodape"><button type="button" class="btn-mini" data-dp="hoje">Hoje</button><button type="button" class="btn-mini" data-dp="limpar">Limpar</button></div>';
  }
  function tratarCliqueDP(e) {
    const cal = e.target.closest('.dp-cal'); if (!cal) return false;
    const inp = cal.parentNode.querySelector('input.dp');
    const nav = e.target.closest('button[data-nav]'); const dia = e.target.closest('button[data-dia]'); const acao = e.target.closest('button[data-dp]');
    if (nav) { cal.dataset.mes = mesAdd(cal.dataset.mes, Number(nav.dataset.nav)); renderDP(cal, C.parseData(inp.value)); }
    else if (dia) { inp.value = C.fmtData(dia.dataset.dia); cal.classList.add('oculto'); inp.dispatchEvent(new Event('change', { bubbles: true })); }
    else if (acao) { inp.value = acao.dataset.dp === 'hoje' ? C.fmtData(hoje()) : ''; cal.classList.add('oculto'); inp.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  }
  function normalizarDP(inp) { const v = C.parseData(inp.value); if (inp.value.trim() && !v) { toast('Data inválida: use dd/mm/aaaa', true); inp.value = ''; } else inp.value = C.fmtData(v); }

  // ---------------- Link de acesso (#acesso=…): configura link + chave e some da barra ----------------
  const b64url = { enc: str => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))) };
  function gerarLinkAcesso() { return location.origin + location.pathname + '#acesso=' + b64url.enc(JSON.stringify({ u: L.apiUrl, k: L.chave })); }
  function tratarLinkAcesso() {
    const m = /[#&]acesso=([A-Za-z0-9_-]+)/.exec(location.hash); if (!m) return false;
    try {
      const j = JSON.parse(b64url.dec(m[1]));
      if (j.u && j.k && /^https:\/\/script\.google\.com\//.test(j.u)) { L.apiUrl = j.u; L.chave = j.k; salvarLocal(); history.replaceState(null, '', location.pathname); return true; }
    } catch (e) { }
    toast('Link de acesso inválido', true); history.replaceState(null, '', location.pathname); return false;
  }

  // ---------------- Abas ----------------
  function irPara(aba) {
    UI.aba = aba; salvarLocal();
    $$('.aba').forEach(b => b.classList.toggle('ativa', b.dataset.aba === aba));
    ['dash', 'pedidos', 'config'].forEach(a => $('#aba-' + a).classList.toggle('oculto', a !== aba));
    if (location.hash !== '#' + aba) history.replaceState(null, '', '#' + aba);
    renderAba();
  }
  function renderAba() {
    if (UI.aba === 'dash') renderDash();
    else if (UI.aba === 'pedidos') renderPedidos();
    else renderConfig();
  }
  function renderTudo() { aplicarCoresStatus(); aplicarNome(); renderAba(); renderDatalists(); atualizarSync(); }
  function aplicarCoresStatus() {
    const r = document.documentElement.style, c = S.config.statusCores;
    r.setProperty('--atrasado', c.atrasado); r.setProperty('--vence', c.vence); r.setProperty('--andamento', c.andamento); r.setProperty('--finalizado', c.finalizado);
  }
  function aplicarNome() { const n = S.config.nomeSistema || C.CONFIG_PADRAO.nomeSistema; $('#logo').textContent = n; document.title = n; }
  function renderDatalists() {
    $('#dl-fornecedores').innerHTML = S.fornecedores.map(f => '<option value="' + esc(f.nome) + '">').join('');
    $('#dl-acoes').innerHTML = (S.config.acoes || []).map(a => '<option value="' + esc(a) + '">').join('');
  }
  function fecharPopovers(exceto) { $$('.menu .popover').forEach(p => { if (p !== exceto) p.classList.add('oculto'); }); }

  // ---------------- DASH ----------------
  let detalheVencemAberto = false;
  function renderDash() {
    const h = hoje(), ant = S.config.antecedencia, cfg = S.config;
    const base = pedidosNoPeriodo();
    const r = C.resumo(base, h, ant, cfg.dashProximos);
    const rTudo = C.resumo(S.pedidos, h, ant); // ações de hoje não dependem do período
    const n = cfg.statusNomes, cor = cfg.statusCores;
    const valorAberto = r.abertos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    const pecasAbertas = r.abertos.reduce((s, p) => s + C.saldo(p), 0);
    const per = periodoAtual();
    $('#dados-sub').textContent = (per.de || per.ate ? C.rotuloPeriodo(per) + ' · ' : '') + base.length + ' pedido' + (base.length === 1 ? '' : 's') + ' no período';
    const kpi = (t, num, sub, c, filtro, extra) => '<div class="kpi' + (extra || '') + '" style="--cor:' + c + '" data-filtro="' + esc(filtro) + '"><div class="t">' + esc(t) + (filtro === 'vence' ? ico('chev') : '') + '</div><div class="n">' + num + '</div><div class="s">' + esc(sub) + '</div></div>';
    $('#kpis').innerHTML =
      kpi(n.atrasado + 's', r.atrasados.length, C.fmtPct(r.atrasados.length, r.abertos.length) + ' dos abertos', cor.atrasado, 'atrasado') +
      kpi('Vencem em breve', r.vencem.length, 'até ' + ant + ' dia' + (ant === 1 ? '' : 's') + ' · ' + C.fmtPct(r.vencem.length, r.abertos.length) + ' dos abertos · clique pra ver por dia', cor.vence, 'vence', detalheVencemAberto ? ' aberto' : '') +
      kpi('Ações hoje', rTudo.acoesHoje.length, rTudo.acoesHoje.filter(p => p.dataAcao < h).length + ' atrasadas', '#111827', 'acoes') +
      kpi(n.andamento, r.andamento.length, C.fmtPct(r.andamento.length, r.abertos.length) + ' dos abertos', cor.andamento, 'andamento') +
      '<div class="kpi macro"><div class="t">Abertos</div><div class="n">' + r.abertos.length + '</div><div class="s">' + r.abertos.filter(p => C.remessaDe(p) === '2').length + ' na 2ª remessa · ' + r.finalizados.length + ' finalizados · ' + C.fmtInt(pecasAbertas) + ' peças · ' + C.fmtMoeda(valorAberto) + '</div></div>';
    renderDetalheVencem(r);

    // gráfico por fornecedor (animado)
    $('#dash-metrica').value = cfg.dashMetrica || 'pedidos';
    $('#dash-recorte').value = cfg.dashRecorte || 'abertos';
    $('#dash-top').value = String(cfg.dashTop || 10);
    const rec = cfg.dashRecorte || 'abertos';
    const conj = rec === 'todos' ? base : rec === 'abertos' ? r.abertos : base.filter(p => C.statusDe(p, h, ant) === rec);
    const met = cfg.dashMetrica || 'pedidos';
    const fmtV = v => met === 'valor' ? C.fmtMoeda(v) : C.fmtInt(v);
    const nomeMet = { pedidos: 'Pedidos', pecas: 'Peças em aberto', valor: 'Valor' }[met];
    $('#tit-forn').textContent = 'Por fornecedor × ' + nomeMet;
    const barras = (el, dados, chave, rotulo, corDe) => {
      const max = Math.max(1, ...dados.map(d => d.valor));
      el.innerHTML = dados.length ? dados.map(d => '<div class="barra-linha" data-chave="' + esc(chave) + '" data-v="' + esc(d.chave) + '" title="' + esc(d.chave) + ': ' + esc(fmtV(d.valor)) + '"><span class="nome">' + (corDe ? '<span class="bola" style="--cor:' + esc(corDe(d.chave)) + '"></span>' : '') + (rotulo ? rotulo(d.chave) : esc(d.chave)) + '</span><div class="trilho"><div class="fill" data-w="' + (d.valor / max * 100).toFixed(1) + '"></div></div><span class="v">' + fmtV(d.valor) + '</span></div>').join('')
        : '<div class="vazio">Nada nesse recorte.</div>';
      requestAnimationFrame(() => requestAnimationFrame(() => $$('.fill', el).forEach(f => { f.style.width = f.dataset.w + '%'; })));
    };
    barras($('#graf-fornecedor'), C.agrupar(conj, 'fornecedor', met, cfg.dashTop || 10), 'fornecedor', null, corFornecedor);

    // por time: gráfico ou tabela
    $$('#time-vista button').forEach(b => b.classList.toggle('ativo', b.dataset.v === (cfg.dashTimeVista || 'grafico')));
    const gt = $('#graf-time');
    if ((cfg.dashTimeVista || 'grafico') === 'tabela') {
      const linhas = C.tabelaPor(conj, 'time', h, ant);
      gt.className = '';
      gt.innerHTML = linhas.length ? '<table class="tab-mini"><thead><tr><th>Time</th><th class="num">Pedidos</th><th class="num">Peças em aberto</th><th class="num">Valor</th><th class="num">Atrasados</th></tr></thead><tbody>' +
        linhas.map(l => '<tr><td>' + tag('time', l.chave) + '</td><td class="num">' + C.fmtInt(l.pedidos) + '</td><td class="num">' + C.fmtInt(l.pecas) + '</td><td class="num">' + C.fmtMoeda(l.valor) + '</td><td class="num' + (l.atrasados ? ' atras' : '') + '">' + C.fmtInt(l.atrasados) + '</td></tr>').join('') +
        '</tbody></table>' : '<div class="vazio">Nada nesse recorte.</div>';
    } else {
      gt.className = 'barras';
      barras(gt, C.agrupar(conj, 'time', met, 10), 'time', k => esc(nomeTag('time', k)), k => { const t = tagDe('time', k); return (t && t.cor) || '#d1d5db'; });
    }

    // próximos dias
    $('#prox-dias').innerHTML = [2, 7, 14, 30, 60, 90].map(d => '<button type="button" data-dias="' + d + '"' + (d === cfg.dashProximos ? ' class="ativo"' : '') + '>' + d + ' dias</button>').join('');
    const grupos = new Map();
    r.proximos.forEach(p => { if (!grupos.has(p.limite)) grupos.set(p.limite, []); grupos.get(p.limite).push(p); });
    $('#prox-total').textContent = r.proximos.length + ' pedido' + (r.proximos.length === 1 ? '' : 's');
    $('#prox7').innerHTML = grupos.size ? Array.from(grupos, ([d, ps]) => '<div class="dia"><div class="dia-cab' + (d === h ? ' hoje' : '') + '">' + C.diaSemana(d) + ' ' + C.fmtDataCurta(d) + '<span class="mudo">' + (d === h ? 'hoje' : d === C.addDias(h, 1) ? 'amanhã' : 'em ' + C.diffDias(h, d) + ' dias') + ' · ' + ps.length + '</span></div>' +
      ps.map(p => '<div class="item" data-po="' + esc(p.po) + '"><b>' + esc(p.po) + '</b><span class="f">' + chipFornecedor(p.fornecedor) + '</span><span class="extra">' + tag('tipo', p.tipo) + '<span>' + C.fmtInt(C.saldo(p)) + ' pç</span>' + (p.acao ? '<span>· ' + esc(p.acao) + (p.dataAcao ? ' ' + C.fmtDataCurta(p.dataAcao) : '') + '</span>' : '') + '</span></div>').join('') + '</div>').join('')
      : '<div class="vazio">Nada vence nos próximos ' + cfg.dashProximos + ' dias.</div>';

    // lembrete: tarefas de hoje
    const tarefas = rTudo.acoesHoje;
    const atrasadas = tarefas.filter(p => p.dataAcao < h), deHoje = tarefas.filter(p => p.dataAcao === h);
    $('#hoje-total').textContent = tarefas.length ? tarefas.length + (tarefas.length === 1 ? ' tarefa' : ' tarefas') : '';
    const item = p => '<li class="' + (p.dataAcao < h ? 'atrasada' : '') + '"><input type="checkbox" data-po="' + esc(p.po) + '" title="Marcar como feita"><div class="tt"><b>' + esc(p.acao || 'Ação') + '</b> · PO ' + esc(p.po) + '<small>' + esc(p.fornecedor) + (p.dataAcao < h ? ' · era ' + C.fmtDataCurta(p.dataAcao) : '') + (p.obs ? ' · ' + esc(p.obs) : '') + '</small></div></li>';
    $('#tarefas-hoje').innerHTML = tarefas.length ? (atrasadas.length ? '<li class="sub">Atrasadas</li>' + atrasadas.map(item).join('') : '') + (deHoje.length ? '<li class="sub">Hoje · ' + C.diaSemana(h) + ' ' + C.fmtDataCurta(h) + '</li>' + deHoje.map(item).join('') : '')
      : '<li class="vazio-t">Nada marcado pra hoje. Preencha "Próxima ação" e "Data da ação" na tabela e a tarefa aparece aqui.</li>';
  }
  function renderDetalheVencem(r) {
    const el = $('#detalhe-vencem'); const h = hoje(), ant = S.config.antecedencia;
    if (!detalheVencemAberto) { el.classList.add('oculto'); return; }
    const dias = [];
    for (let i = 0; i <= ant; i++) { const d = C.addDias(h, i); dias.push({ d, ps: r.vencem.filter(p => p.limite === d) }); }
    el.innerHTML = '<div class="detalhe-grade">' + dias.map(x => '<div class="detalhe-dia"><div class="dd-cab">' + (x.d === h ? 'Hoje' : x.d === C.addDias(h, 1) ? 'Amanhã' : 'Em ' + C.diffDias(h, x.d) + ' dias') + ' · ' + C.diaSemana(x.d) + ' ' + C.fmtDataCurta(x.d) + '<span>' + x.ps.length + '</span></div>' +
      (x.ps.length ? x.ps.map(p => '<div class="item" data-po="' + esc(p.po) + '"><b>' + esc(p.po) + '</b> ' + esc(p.fornecedor) + (p.acao ? ' <span class="mudo">· ' + esc(p.acao) + '</span>' : '') + '</div>').join('') : '<div class="mudo">nenhum</div>') + '</div>').join('') +
      '</div><div class="dd-rodape"><button class="btn-mini" data-ver="vence">Ver na tabela</button><button class="btn-mini" data-ver="fechar">Fechar</button></div>';
    el.classList.remove('oculto');
  }

  // ---------------- PEDIDOS ----------------
  function colunasVisiveis() {
    const vis = S.config.colunasVisiveis || [];
    const todas = C.CAMPOS.map(c => c.k).concat((S.config.colunasExtras || []).map(e => 'x:' + e.k));
    return todas.filter(k => vis.includes(k));
  }
  function nomeColuna(k) {
    if (k.startsWith('x:')) { const e = (S.config.colunasExtras || []).find(x => x.k === k.slice(2)); return e ? e.nome : k; }
    return C.CAMPO[k] ? C.CAMPO[k].nome : k;
  }
  function filtrosAtivos() { const f = UI.filtros; return ['fornecedor', 'tipo', 'time', 'transportadora', 'busca'].filter(k => f[k]).length + ((f.status || 'abertos') !== 'abertos' ? 1 : 0); }

  function renderFiltros() {
    const f = UI.filtros;
    const opts = (sel, lista, atual, rotulo) => {
      sel.innerHTML = '<option value="">' + esc(rotulo) + '</option>' + lista.map(o => '<option value="' + esc(o.v) + '"' + (o.v === atual ? ' selected' : '') + '>' + esc(o.n) + '</option>').join('');
      sel.classList.toggle('ativo', !!atual);
    };
    const forn = Array.from(new Set(S.pedidos.map(p => p.fornecedor).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    opts($('#f-fornecedor'), forn.map(v => ({ v, n: v })), f.fornecedor || '', 'Fornecedor');
    const tipos = Array.from(new Set(S.pedidos.map(p => p.tipo).filter(Boolean)));
    opts($('#f-tipo'), tipos.map(v => ({ v, n: nomeTag('tipo', v) })), f.tipo || '', 'Tipo');
    const times = Array.from(new Set(S.pedidos.map(p => p.time).filter(Boolean)));
    opts($('#f-time'), times.map(v => ({ v, n: nomeTag('time', v) })), f.time || '', 'Time');
    const transp = Array.from(new Set(S.fornecedores.map(x => x.transportadora).filter(Boolean))).sort();
    opts($('#f-transp'), transp.map(v => ({ v, n: v })), f.transportadora || '', 'Transportadora');
    $('#f-status').value = f.status || 'abertos'; $('#f-status').classList.toggle('ativo', (f.status || 'abertos') !== 'abertos');
    $$('#f-remessa button').forEach(b => b.classList.toggle('ativo', b.dataset.v === (f.remessa || '1')));
    // contadores por remessa, respeitando os outros filtros
    const semRemessa = Object.assign({}, f, { periodo: periodoAtual(), remessa: 'todas' });
    const base = C.filtrar(S.pedidos, semRemessa, ctx());
    const c1 = base.filter(p => C.remessaDe(p) === '1').length, c2 = base.length - c1;
    $('[data-cont="1"]').textContent = c1; $('[data-cont="2"]').textContent = c2; $('[data-cont="todas"]').textContent = base.length;
    if ($('#busca').value !== (f.busca || '')) $('#busca').value = f.busca || '';
    const na = filtrosAtivos();
    $('#btn-limpar-filtros').classList.toggle('oculto', na === 0); $('#n-filtros').textContent = na;
  }

  function renderPedidos() {
    renderFiltros();
    const f = Object.assign({}, UI.filtros, { periodo: periodoAtual() });
    let lista = C.filtrar(S.pedidos, f, ctx());
    lista = C.ordenar(lista, UI.ordem.col, UI.ordem.dir, ctx());
    const cols = colunasVisiveis();
    $('#tabela-cab').innerHTML = cols.map(k => '<th data-col="' + esc(k) + '">' + esc(nomeColuna(k)) + (UI.ordem.col === k ? '<span class="seta">' + (UI.ordem.dir === 'asc' ? '▲' : '▼') + '</span>' : '') + '</th>').join('') + '<th></th>';
    const h = hoje(), ant = S.config.antecedencia;
    const cel = (p, k) => {
      const v = p[k];
      const inp = (tipo, extra) => '<input type="' + tipo + '" data-po="' + esc(p.po) + '" data-k="' + esc(k) + '" value="' + esc(v == null ? '' : v) + '"' + (extra || '') + '>';
      switch (k) {
        case 'status': return statusPill(C.statusDe(p, h, ant));
        case 'fornecedor': return chipFornecedor(v);
        case 'tipo': return tag('tipo', v) + (C.temSaldo(p) ? ' ' + tag('tipo', 'saldo') : '');
        case 'time': return tag('time', v);
        case 'limite': case 'envio': case 'finalizacao': case 'update': case 'criadoEm': case 'inicioCampanha': case 'finalCampanha':
          return v ? C.fmtData(v) + (k === 'limite' ? ' <span class="mudo">' + C.diaSemana(v) + '</span>' : '') : '';
        case 'saldo': return '<td class="num">' + C.fmtInt(C.saldo(p)) + (C.temSaldo(p) ? ' <span class="saldo-mini">de ' + C.fmtInt(p.qtd) + '</span>' : '');
        case 'qtd': case 'leadWms': case 'leadBob': return '<td class="num">' + C.fmtInt(v);
        case 'valor': return '<td class="num">' + C.fmtMoeda(v);
        case 'qtdEntregue': return inp('number', ' min="0"');
        case 'remessa': return C.remessaDe(p) === '2' ? '2ª' : '1ª';
        case 'acao': return '<input list="dl-acoes" data-po="' + esc(p.po) + '" data-k="acao" value="' + esc(v) + '" placeholder="—">';
        case 'dataAcao': return inp('date');
        case 'obs': return inp('text', ' class="obs" placeholder="—"');
        default:
          if (k.startsWith('x:')) return '<input type="text" data-po="' + esc(p.po) + '" data-k="' + esc(k) + '" value="' + esc((p.extras || {})[k.slice(2)] || '') + '">';
          return esc(v);
      }
    };
    const linhas = lista.map(p => {
      const st = C.statusDe(p, h, ant);
      const tds = cols.map(k => { const c = cel(p, k); return c.startsWith('<td') ? c + '</td>' : '<td>' + c + '</td>'; }).join('');
      const btn = p.finalizacao ? '<button class="btn-mini" data-acao="reabrir" data-po="' + esc(p.po) + '">Reabrir</button>' : '<button class="btn-mini" data-acao="finalizar" data-po="' + esc(p.po) + '" title="Finalizar (data de hoje)">' + ico('check') + 'Finalizar</button>';
      const mover = C.remessaDe(p) === '2' ? '<button class="btn-mini" data-acao="remessa1" data-po="' + esc(p.po) + '" title="Voltar pra 1ª remessa">← 1ª</button>' : '<button class="btn-mini" data-acao="remessa2" data-po="' + esc(p.po) + '" title="Mover pra 2ª remessa (entrega parcial, item similar, BO)">→ 2ª</button>';
      return '<tr class="st-' + st + '" data-po="' + esc(p.po) + '">' + tds + '<td class="acoes">' + btn + mover + '<button class="btn-mini" data-acao="editar" data-po="' + esc(p.po) + '" title="Editar tudo">' + ico('edit') + '</button></td></tr>';
    });
    $('#tabela-corpo').innerHTML = linhas.join('');
    $('#tabela-vazio').classList.toggle('oculto', lista.length > 0);
    const valor = lista.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    $('#tabela-total').textContent = lista.length + ' de ' + S.pedidos.length + ' pedidos · ' + C.fmtInt(lista.reduce((s, p) => s + C.saldo(p), 0)) + ' peças em aberto · ' + C.fmtMoeda(valor);
    renderPopColunas();
  }
  function listaFiltrada() { return C.ordenar(C.filtrar(S.pedidos, Object.assign({}, UI.filtros, { periodo: periodoAtual() }), ctx()), UI.ordem.col, UI.ordem.dir, ctx()); }
  function renderPopColunas() {
    const vis = S.config.colunasVisiveis || [];
    const itens = C.CAMPOS.filter(c => c.k !== 'po' && !c.oculto).map(c => ({ k: c.k, n: c.nome })).concat((S.config.colunasExtras || []).map(e => ({ k: 'x:' + e.k, n: e.nome })));
    $('#pop-colunas').innerHTML = itens.map(i => '<label><input type="checkbox" value="' + esc(i.k) + '"' + (vis.includes(i.k) ? ' checked' : '') + '> ' + esc(i.n) + '</label>').join('');
  }

  // ---------------- Modal pedido ----------------
  let pedidoEmEdicao = null;
  function renderChipsTag(form, grupo, atual) {
    const wrap = $('.chips-tag[data-grupo="' + grupo + '"]', form);
    const tags = S.tags.filter(t => t.grupo === grupo && t.codigo !== 'saldo');
    const extra = atual && !tags.some(t => t.codigo === atual) ? [{ codigo: atual, nome: atual, cor: '#9ca3af' }] : [];
    wrap.innerHTML = tags.concat(extra).map(t => '<button type="button" data-v="' + esc(t.codigo) + '"' + (t.codigo === atual ? ' class="ativo"' : '') + '><span class="bola" style="--cor:' + esc(t.cor || '#9ca3af') + '"></span>' + esc(t.nome) + '</button>').join('') || '<span class="mudo">Nenhuma cadastrada. Configurações → ' + (grupo === 'tipo' ? 'Tags de tipo' : 'Times') + '.</span>';
    form[grupo].value = atual || '';
  }
  function abrirPedido(po) {
    const dlg = $('#dlg-pedido'), form = $('#form-pedido');
    pedidoEmEdicao = po ? pedidoPorPO(po) : null;
    $('#dlg-pedido-titulo').textContent = pedidoEmEdicao ? 'PO ' + pedidoEmEdicao.po : 'Novo pedido';
    $('#btn-excluir-pedido').classList.toggle('oculto', !pedidoEmEdicao);
    form.po.readOnly = !!pedidoEmEdicao;
    const p = pedidoEmEdicao || C.pedidoVazio();
    renderChipsTag(form, 'tipo', p.tipo); renderChipsTag(form, 'time', p.time);
    ['po', 'fornecedor', 'leadWms', 'qtd', 'qtdEntregue', 'acao', 'obs', 'armazem', 'campanha'].forEach(k => { form[k].value = p[k] == null || p[k] === 0 ? '' : p[k]; });
    ['envio', 'limite', 'dataAcao', 'finalizacao'].forEach(k => { form[k].value = C.fmtData(p[k]); });
    form.remessa.value = C.remessaDe(p);
    form.valor.value = p.valor ? Number(p.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
    $('#dlg-pedido-extras').innerHTML = (S.config.colunasExtras || []).map(e => '<div class="campo"><label>' + esc(e.nome) + '</label><input name="x:' + esc(e.k) + '" value="' + esc((p.extras || {})[e.k] || '') + '"></div>').join('');
    $('details.detalhes', form).open = !!(pedidoEmEdicao && (p.valor || p.armazem || p.campanha || p.qtdEntregue || p.finalizacao));
    $$('.dp-cal', form).forEach(c => c.classList.add('oculto'));
    dlg.showModal();
    if (!pedidoEmEdicao) form.po.focus();
  }
  function salvarModalPedido(ev) {
    ev.preventDefault();
    const form = $('#form-pedido'); const fd = new FormData(form);
    const po = String(fd.get('po') || '').trim();
    const fornecedor = String(fd.get('fornecedor') || '').trim();
    const envio = C.parseData(fd.get('envio')), lead = Math.max(0, Math.round(C.parseNumBR(fd.get('leadWms'))));
    let limite = C.parseData(fd.get('limite'));
    if (!limite && envio && lead) { limite = C.addDiasUteis(envio, lead); form.limite.value = C.fmtData(limite); toast('Data limite calculada: ' + C.fmtData(limite) + ' (' + lead + ' dias úteis após o envio)'); }
    if (!po) { toast('Informe o PO', true); form.po.focus(); return; }
    if (!fornecedor) { toast('Informe o fornecedor', true); form.fornecedor.focus(); return; }
    if (!limite) { toast('Informe a data limite (ou envio + lead time)', true); form.limite.focus(); return; }
    let p = pedidoEmEdicao;
    if (!p) {
      if (pedidoPorPO(po)) { toast('Já existe um pedido com o PO ' + po, true); form.po.focus(); return; }
      p = C.pedidoVazio(); p.po = po; p.origem = 'manual'; S.pedidos.push(p);
    }
    const antes = JSON.stringify(p);
    p.fornecedor = fornecedor; p.envio = envio; p.leadWms = lead; p.limite = limite;
    ['tipo', 'time', 'acao', 'obs', 'armazem', 'campanha', 'remessa'].forEach(k => { p[k] = String(fd.get(k) || '').trim(); });
    ['dataAcao', 'finalizacao'].forEach(k => { p[k] = C.parseData(fd.get(k)); });
    ['qtd', 'qtdEntregue'].forEach(k => { p[k] = Math.max(0, Math.round(C.parseNumBR(fd.get(k)))); });
    p.valor = C.parseNumBR(fd.get('valor'));
    (S.config.colunasExtras || []).forEach(e => { p.extras[e.k] = String(fd.get('x:' + e.k) || '').trim(); });
    if (C.temSaldo(p) && C.remessaDe(p) !== '2') p.remessa = '2';
    if (JSON.stringify(p) !== antes) p.update = hoje();
    if (p.acao && !S.config.acoes.includes(p.acao)) { S.config.acoes.push(p.acao); salvarConfig(); }
    garantirCadastros([p]);
    gravarPedidos([p], pedidoEmEdicao ? null : { tipo: 'novo-manual', po: p.po });
    $('#dlg-pedido').close(); renderTudo(); toast('Salvo');
  }

  // ---------------- Importação ----------------
  let IMP = null;
  function abrirImportar() {
    IMP = null;
    $('#imp-passo-arquivo').classList.remove('oculto'); $('#imp-passo-colunas').classList.add('oculto'); $('#imp-passo-previa').classList.add('oculto');
    $('#imp-passo-colunas').innerHTML = ''; $('#imp-passo-previa').innerHTML = '';
    $('#imp-confirmar').disabled = true; $('#imp-arquivo').value = '';
    $('#dlg-importar').showModal();
  }
  function lerArquivo(file) {
    const r = new FileReader();
    r.onload = () => {
      let texto = r.result;
      // tenta latin1 se vier com caracteres quebrados
      if (/\uFFFD/.test(texto)) { const r2 = new FileReader(); r2.onload = () => processarTexto(r2.result); r2.readAsText(file, 'ISO-8859-1'); return; }
      processarTexto(texto);
    };
    r.readAsText(file, 'UTF-8');
  }
  function processarTexto(texto) {
    const linhas = C.parseCSV(texto);
    if (linhas.length < 2) { toast('Arquivo vazio ou sem linhas de dados', true); return; }
    IMP = { cabs: linhas[0].map(s => s.trim()), linhas: linhas.slice(1), adicionar: {}, ignorar: {}, mapa: {} };
    $('#imp-passo-arquivo').classList.add('oculto');
    passoColunas();
  }
  function passoColunas() {
    const cas = C.casarCabecalhos(IMP.cabs, Object.assign({}, S.config.mapeamento, IMP.mapa), S.config.colunasExtras, S.config.ignorarCabecalhos);
    IMP.cas = cas;
    const el = $('#imp-passo-colunas');
    if (!cas.desconhecidos.length && !cas.faltando.length) { el.classList.add('oculto'); passoPrevia(); return; }
    let html = '';
    if (cas.faltando.length) {
      html += '<h4>Não achei estas colunas no arquivo</h4><p class="mudo">Escolha qual coluna do arquivo corresponde a cada uma. Isso fica salvo pra próxima.</p>';
      cas.faltando.forEach(k => {
        html += '<div class="imp-col"><span>' + esc(C.CAMPO[k].nome) + '</span><select data-falta="' + k + '"><option value="">— escolher —</option>' + IMP.cabs.map((c, i) => '<option value="' + i + '">' + esc(c) + '</option>').join('') + '</select><span></span></div>';
      });
    }
    if (cas.desconhecidos.length) {
      html += '<h4>Colunas novas no relatório</h4><p class="mudo">O sistema mandou colunas que o app não conhece. Quer adicionar como coluna nova ou ignorar (sempre)?</p>';
      cas.desconhecidos.forEach(d => {
        html += '<div class="imp-col"><code>' + esc(d.cab) + '</code><label class="check"><input type="radio" name="desc-' + d.idx + '" value="add"> adicionar</label><label class="check"><input type="radio" name="desc-' + d.idx + '" value="ign" checked> ignorar</label></div>';
      });
    }
    html += '<div class="acoes-linha"><button type="button" class="btn" id="imp-colunas-ok">Continuar</button></div>';
    el.innerHTML = html; el.classList.remove('oculto');
    $('#imp-colunas-ok').onclick = () => {
      let faltaAinda = false;
      $$('select[data-falta]', el).forEach(s => {
        if (!s.value) { faltaAinda = true; return; }
        const k = s.dataset.falta; S.config.mapeamento[k] = IMP.cabs[Number(s.value)];
      });
      if (faltaAinda) { toast('Falta escolher a coluna de PO, Fornecedor ou Data limite', true); return; }
      cas.desconhecidos.forEach(d => {
        const v = ($('input[name="desc-' + d.idx + '"]:checked', el) || {}).value;
        if (v === 'add') {
          const k = C.normChave(d.cab) || ('col' + d.idx);
          if (!(S.config.colunasExtras || []).some(e => e.k === k)) { S.config.colunasExtras = (S.config.colunasExtras || []).concat([{ k, nome: d.cab, cabecalho: d.cab }]); S.config.colunasVisiveis.push('x:' + k); }
        } else if (!S.config.ignorarCabecalhos.includes(d.cab)) S.config.ignorarCabecalhos.push(d.cab);
      });
      salvarConfig();
      passoColunas();
    };
  }
  function passoPrevia() {
    const cas = C.casarCabecalhos(IMP.cabs, S.config.mapeamento, S.config.colunasExtras, S.config.ignorarCabecalhos);
    const importados = IMP.linhas.map(l => C.linhaParaPedido(l, cas.porCampo, hoje()));
    const copia = S.pedidos.map(p => JSON.parse(JSON.stringify(p)));
    const m = C.mesclarImportacao(copia, importados, hoje());
    IMP.resultado = m;
    const el = $('#imp-passo-previa');
    el.innerHTML = '<div class="imp-resumo"><div class="b"><b>' + m.novos.length + '</b>novos</div><div class="b"><b>' + m.atualizados.length + '</b>já existiam, com mudança</div><div class="b"><b>' + m.iguais + '</b>já existiam, iguais</div><div class="b"><b>' + m.avisos.length + '</b>avisos</div></div>' +
      (m.atualizados.length ? '<p class="mudo">Nos que já existiam, só os campos do relatório mudam (quantidade, data, valor…). Observação, ação e datas suas ficam como estão.</p>' : '') +
      (m.avisos.length ? '<div class="imp-avisos">' + m.avisos.map(a => '<div>' + (a.po ? '<b>PO ' + esc(a.po) + '</b> · ' : '') + esc(a.msg) + '</div>').join('') + '</div>' : '') +
      (m.novos.length ? '<h4>Novos</h4><div class="mudo" style="max-height:160px;overflow:auto">' + m.novos.map(p => 'PO ' + esc(p.po) + ' · ' + esc(p.fornecedor) + ' · limite ' + C.fmtData(p.limite) + ' · ' + C.fmtInt(p.qtd) + ' pç').join('<br>') + '</div>' : '');
    el.classList.remove('oculto');
    $('#imp-confirmar').disabled = !(m.novos.length || m.atualizados.length);
  }
  function confirmarImportacao() {
    const m = IMP.resultado; if (!m) return;
    S.pedidos = m.pedidos;
    const cad = garantirCadastros(m.novos);
    const mudados = m.novos.concat(m.atualizados.map(a => pedidoPorPO(a.po)).filter(Boolean));
    gravarPedidos(mudados, { tipo: 'importar', novos: m.novos.length, atualizados: m.atualizados.length, iguais: m.iguais, avisos: m.avisos.length });
    $('#dlg-importar').close();
    renderTudo();
    toast(m.novos.length + ' novos, ' + m.atualizados.length + ' atualizados' + (cad.novosF ? ', ' + cad.novosF + ' fornecedores novos' : '') + (cad.novasT ? ', ' + cad.novasT + ' tags novas' : ''));
  }

  // ---------------- CONFIG ----------------
  function renderConfig() {
    const c = S.config;
    $('#c-nomeSistema').value = c.nomeSistema || '';
    $('#c-apiUrl').value = L.apiUrl; $('#c-chave').value = L.chave; $('#c-linkApp').value = c.linkApp || '';
    $('#c-avisosAtivo').checked = !!c.avisosAtivo; $('#c-emailDestino').value = c.emailDestino || '';
    $('#c-hora').innerHTML = Array.from({ length: 24 }, (_, h) => '<option value="' + h + '"' + (h === Number(c.hora) ? ' selected' : '') + '>' + String(h).padStart(2, '0') + ':00</option>').join('');
    $('#c-antecedencia').value = String(c.antecedencia);
    $$('#c-diasSemana input').forEach(i => { i.checked = (c.diasSemana || []).includes(Number(i.value)); });
    $('#c-enviarSeVazio').checked = !!c.enviarSeVazio;
    $('#c-acoes').value = (c.acoes || []).join('\n');

    const linhaTag = t => '<div class="linha" data-id="' + esc(t.id) + '"><input type="color" data-k="cor" value="' + esc(t.cor || '#9ca3af') + '"><input type="text" data-k="nome" value="' + esc(t.nome) + '" placeholder="Nome exibido"><code title="código no relatório">' + esc(t.codigo) + '</code><button class="btn-mini" data-del="tag">✕</button></div>';
    $('#lista-tags-tipo').innerHTML = S.tags.filter(t => t.grupo === 'tipo').map(linhaTag).join('') || '<span class="mudo">Nenhuma tag ainda.</span>';
    $('#lista-tags-time').innerHTML = S.tags.filter(t => t.grupo === 'time').map(linhaTag).join('') || '<span class="mudo">Nenhum time ainda.</span>';

    $('#lista-status').innerHTML = ['atrasado', 'vence', 'andamento', 'finalizado'].map(k => '<div class="linha" data-st="' + k + '"><input type="color" data-k="cor" value="' + esc(c.statusCores[k]) + '"><input type="text" data-k="nome" value="' + esc(c.statusNomes[k]) + '"><span class="mudo">' + { atrasado: 'data limite passou', vence: 'vence em até ' + c.antecedencia + ' dias', andamento: 'no prazo', finalizado: 'tem data de finalização' }[k] + '</span></div>').join('');

    renderFornecedores();
    $('#lista-transp').innerHTML = S.transportadoras.map(t => '<div class="linha" data-id="' + esc(t.id) + '"><input type="text" data-k="nome" value="' + esc(t.nome) + '" placeholder="Nome"><input type="text" data-k="email" value="' + esc(t.email || '') + '" placeholder="E-mail"><input type="text" data-k="diaEntrega" value="' + esc(t.diaEntrega || '') + '" placeholder="Dia de entrega"><input type="text" data-k="regra" value="' + esc(t.regra || '') + '" placeholder="Regra (ex.: NF até sexta)"><button class="btn-mini" data-del="transp">✕</button></div>').join('') || '<span class="mudo">Nenhuma transportadora ainda.</span>';

    $('#lista-mapeamento').innerHTML = Object.keys(C.MAPEAMENTO_PADRAO).map(k => '<div class="linha"><span style="min-width:120px">' + esc(C.CAMPO[k].nome) + '</span><input type="text" data-map="' + k + '" value="' + esc(c.mapeamento[k] || '') + '"></div>').join('');
    $('#lista-extras').innerHTML = (c.colunasExtras || []).map(e => '<div class="linha" data-k="' + esc(e.k) + '"><input type="text" data-ex="nome" value="' + esc(e.nome) + '" placeholder="Nome no app"><code>' + esc(e.cabecalho) + '</code><button class="btn-mini" data-del="extra">✕</button></div>').join('') || '<span class="mudo">Nenhuma. Aparecem aqui quando o relatório traz coluna nova e você aceita.</span>';
    $('#lista-ignorados').innerHTML = (c.ignorarCabecalhos || []).map(h => '<span class="chip">' + esc(h) + '<button data-del="ign" data-v="' + esc(h) + '" title="Voltar a perguntar">✕</button></span>').join('') || '<span class="mudo">Nenhum.</span>';
    $('#dados-info').textContent = S.pedidos.length + ' pedidos · ' + S.fornecedores.length + ' fornecedores · ' + (S.ultimaSync ? 'última sincronização ' + S.ultimaSync : 'nunca sincronizou');
  }
  const DIAS_OPT = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'qualquer dia'];
  function renderFornecedores() {
    const b = C.norm(UI.buscaForn || '');
    const lista = S.fornecedores.filter(f => !b || C.norm(f.nome + ' ' + (f.aliases || '')).includes(b)).sort((x, y) => x.nome.localeCompare(y.nome));
    const transp = Array.from(new Set(S.transportadoras.map(t => t.nome).concat(S.fornecedores.map(f => f.transportadora)).filter(Boolean))).sort();
    const selT = f => '<input list="dl-transp" data-k="transportadora" value="' + esc(f.transportadora || '') + '" placeholder="—" style="min-width:110px">';
    const selD = (k, v) => '<select data-k="' + k + '">' + DIAS_OPT.map(d => '<option value="' + d + '"' + (d === (v || '') ? ' selected' : '') + '>' + (d || '—') + '</option>').join('') + '</select>';
    const abertos = new Map(); S.pedidos.forEach(p => { if (!p.finalizacao) abertos.set(p.fornecedor, (abertos.get(p.fornecedor) || 0) + 1); });
    $('#tab-forn').innerHTML = '<datalist id="dl-transp">' + transp.map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
      '<thead><tr><th>Cor</th><th>Nome</th><th>Nomes alternativos</th><th>Grupo / transportadora</th><th>Entrega</th><th>NF até</th><th>Coleta</th><th>Obs</th><th>Abertos</th><th></th></tr></thead><tbody>' +
      lista.map(f => '<tr data-id="' + esc(f.id) + '"><td><input type="color" data-k="cor" value="' + esc(f.cor || '#d1d5db') + '"></td><td><input type="text" data-k="nome" value="' + esc(f.nome) + '" style="min-width:200px"></td><td><input type="text" data-k="aliases" value="' + esc(f.aliases || '') + '" placeholder="Outro nome | Mais um" style="min-width:160px"></td><td>' + selT(f) + '</td><td>' + selD('diaEntrega', f.diaEntrega) + '</td><td>' + selD('prazoNF', f.prazoNF) + '</td><td><input type="checkbox" data-k="coleta"' + (f.coleta ? ' checked' : '') + '></td><td><input type="text" data-k="obs" value="' + esc(f.obs || '') + '" placeholder="ex.: Milk Run" style="min-width:140px"></td><td class="num">' + (abertos.get(f.nome) || 0) + '</td><td><button class="btn-mini" data-del="forn">✕</button></td></tr>').join('') +
      '</tbody>';
    if (!lista.length) $('#tab-forn').innerHTML += '<tbody><tr><td colspan="10" class="vazio">Nenhum fornecedor' + (b ? ' com esse nome' : '') + '.</td></tr></tbody>';
  }

  // ---------------- Eventos ----------------
  function ligarEventos() {
    $$('.aba').forEach(b => b.addEventListener('click', () => irPara(b.dataset.aba)));
    window.addEventListener('hashchange', () => {
      if (/[#&]acesso=/.test(location.hash)) { if (tratarLinkAcesso()) { toast('Acesso configurado. Lendo a planilha…'); atualizarSync(); irPara('dash'); sincronizar(true); } return; }
      const a = location.hash.slice(1); if (['dash', 'pedidos', 'config'].includes(a) && a !== UI.aba) irPara(a);
    });

    // menus (popovers): botão abre/fecha o irmão; clique fora fecha todos
    $$('.menu > button').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const pop = b.parentNode.querySelector('.popover'); const abrir = pop.classList.contains('oculto'); fecharPopovers(); if (abrir) { pop.classList.remove('oculto'); if (pop.id === 'periodo-pop') { PC.pendente = false; renderPeriodo(); } } }));
    document.addEventListener('click', e => {
      if (!e.target.closest('.menu')) fecharPopovers();
      if (!e.target.closest('.campo-dp')) $$('.dp-cal').forEach(c => c.classList.add('oculto'));
    });

    // período
    $('#periodo-pop').addEventListener('click', e => {
      const pr = e.target.closest('button[data-preset]'); const campo = e.target.closest('#pp-campo button'); const nav = e.target.closest('button[data-nav]'); const dia = e.target.closest('button[data-dia]');
      if (pr) { definirPeriodo(pr.dataset.preset); if (pr.dataset.preset !== 'custom') fecharPopovers(); }
      else if (campo) { definirPeriodo(periodoAtual().preset || 'tudo', periodoAtual().de, periodoAtual().ate, campo.dataset.v); }
      else if (nav) { PC.mes = mesAdd(PC.mes, Number(nav.dataset.nav)); renderPeriodo(); }
      else if (dia) clicarDiaPeriodo(dia.dataset.dia);
    });
    $('#pp-aplicar').addEventListener('click', () => {
      const de = C.parseData($('#pp-de').value), ate = C.parseData($('#pp-ate').value);
      if (!de && !ate) { definirPeriodo('tudo'); fecharPopovers(); return; }
      if (($('#pp-de').value && !de) || ($('#pp-ate').value && !ate)) { toast('Data inválida: use dd/mm/aaaa', true); return; }
      definirPeriodo('custom', de || ate, ate || de); fecharPopovers();
    });
    ['#pp-de', '#pp-ate'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#pp-aplicar').click(); } }));

    // dash
    $('#dash-metrica').addEventListener('change', e => { S.config.dashMetrica = e.target.value; salvarConfig(); renderDash(); });
    $('#dash-recorte').addEventListener('change', e => { S.config.dashRecorte = e.target.value; salvarConfig(); renderDash(); });
    $('#dash-top').addEventListener('change', e => { S.config.dashTop = Number(e.target.value); salvarConfig(); renderDash(); });
    $('#time-vista').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.config.dashTimeVista = b.dataset.v; salvarConfig(); renderDash(); });
    $('#prox-dias').addEventListener('click', e => { const b = e.target.closest('button[data-dias]'); if (!b) return; S.config.dashProximos = Number(b.dataset.dias); salvarConfig(); renderDash(); });
    $('#kpis').addEventListener('click', e => {
      const k = e.target.closest('.kpi'); if (!k || !k.dataset.filtro) return;
      const f = k.dataset.filtro;
      if (f === 'vence') { detalheVencemAberto = !detalheVencemAberto; renderDash(); return; }
      UI.filtros = f === 'acoes' ? { status: 'abertos', remessa: 'todas' } : { status: f, remessa: 'todas' };
      if (f === 'acoes') { UI.ordem = { col: 'dataAcao', dir: 'asc' }; }
      irPara('pedidos');
    });
    $('#detalhe-vencem').addEventListener('click', e => {
      const v = e.target.closest('button[data-ver]'); const it = e.target.closest('.item');
      if (v && v.dataset.ver === 'vence') { UI.filtros = { status: 'vence', remessa: 'todas' }; irPara('pedidos'); }
      else if (v) { detalheVencemAberto = false; renderDash(); }
      else if (it) { UI.filtros = { status: 'abertos', busca: it.dataset.po, remessa: 'todas' }; irPara('pedidos'); }
    });
    ['#graf-fornecedor', '#graf-time'].forEach(s => $(s).addEventListener('click', e => {
      const b = e.target.closest('.barra-linha'); if (!b) return;
      UI.filtros = { status: S.config.dashRecorte === 'todos' ? 'todos' : (S.config.dashRecorte || 'abertos'), remessa: 'todas' }; UI.filtros[b.dataset.chave] = b.dataset.v; irPara('pedidos');
    }));
    $('#tarefas-hoje').addEventListener('change', e => { if (e.target.type === 'checkbox') concluirAcao(e.target.dataset.po); });
    $('#prox7').addEventListener('click', e => { const it = e.target.closest('.item'); if (it) { UI.filtros = { status: 'abertos', busca: it.dataset.po, remessa: 'todas' }; irPara('pedidos'); } });

    // pedidos: filtros
    let tBusca;
    $('#busca').addEventListener('input', e => { clearTimeout(tBusca); tBusca = setTimeout(() => { UI.filtros.busca = e.target.value; salvarLocal(); renderPedidos(); }, 200); });
    [['#f-status', 'status'], ['#f-fornecedor', 'fornecedor'], ['#f-tipo', 'tipo'], ['#f-time', 'time'], ['#f-transp', 'transportadora']].forEach(([s, k]) => $(s).addEventListener('change', e => { UI.filtros[k] = e.target.value; salvarLocal(); renderPedidos(); }));
    $('#f-remessa').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; UI.filtros.remessa = b.dataset.v; salvarLocal(); renderPedidos(); });
    $('#btn-limpar-filtros').addEventListener('click', () => { UI.filtros = { status: 'abertos', remessa: UI.filtros.remessa || '1' }; salvarLocal(); renderPedidos(); });
    $('#pop-colunas').addEventListener('change', e => {
      const k = e.target.value; const vis = new Set(S.config.colunasVisiveis);
      if (e.target.checked) vis.add(k); else vis.delete(k);
      S.config.colunasVisiveis = C.CAMPOS.map(c => c.k).concat((S.config.colunasExtras || []).map(x => 'x:' + x.k)).filter(x => vis.has(x));
      salvarConfig(); renderPedidos();
    });
    $('#pop-exportar').addEventListener('click', e => { const b = e.target.closest('button[data-fmt]'); if (!b) return; exportarLista(listaFiltrada(), 'pedidos', b.dataset.fmt); fecharPopovers(); });
    $('#tabela-cab').addEventListener('click', e => {
      const th = e.target.closest('th'); if (!th || !th.dataset.col) return;
      const col = th.dataset.col;
      UI.ordem = { col, dir: UI.ordem.col === col && UI.ordem.dir === 'asc' ? 'desc' : 'asc' }; salvarLocal(); renderPedidos();
    });
    $('#tabela-corpo').addEventListener('change', e => { const t = e.target; if (t.dataset.k) editarCampo(t.dataset.po, t.dataset.k, t.value); });
    $('#tabela-corpo').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.k) e.target.blur(); });
    $('#tabela-corpo').addEventListener('click', e => {
      const b = e.target.closest('button[data-acao]'); if (!b) return;
      if (b.dataset.acao === 'finalizar') finalizar(b.dataset.po);
      else if (b.dataset.acao === 'reabrir') finalizar(b.dataset.po, true);
      else if (b.dataset.acao === 'editar') abrirPedido(b.dataset.po);
      else if (b.dataset.acao === 'remessa2') moverRemessa(b.dataset.po, '2');
      else if (b.dataset.acao === 'remessa1') moverRemessa(b.dataset.po, '1');
    });
    $('#btn-exportar-tudo').addEventListener('click', () => exportarLista(C.ordenar(S.pedidos, 'limite', 'asc', ctx()), 'pedidos-todos', 'csv'));
    $('#btn-exportar-tudo-xlsx').addEventListener('click', () => exportarLista(C.ordenar(S.pedidos, 'limite', 'asc', ctx()), 'pedidos-todos', 'xlsx'));
    $('#btn-novo').addEventListener('click', () => abrirPedido(null));

    // modal pedido: chips, seletor de data
    const form = $('#form-pedido');
    form.addEventListener('submit', salvarModalPedido);
    form.addEventListener('click', e => {
      if (tratarCliqueDP(e)) return;
      if (e.target.classList.contains('dp')) { abrirDP(e.target); return; }
      const chip = e.target.closest('.chips-tag button'); if (!chip) return;
      const wrap = chip.parentNode; const grupo = wrap.dataset.grupo;
      const jaAtivo = chip.classList.contains('ativo');
      $$('button', wrap).forEach(b => b.classList.remove('ativo'));
      if (!jaAtivo) chip.classList.add('ativo');
      form[grupo].value = jaAtivo ? '' : chip.dataset.v;
    });
    form.addEventListener('focusin', e => { if (e.target.classList.contains('dp')) abrirDP(e.target); });
    form.addEventListener('change', e => { if (e.target.classList.contains('dp')) normalizarDP(e.target); });
    $('#btn-cancelar-pedido').addEventListener('click', () => $('#dlg-pedido').close());
    $('#btn-excluir-pedido').addEventListener('click', () => { if (pedidoEmEdicao && confirm('Excluir o PO ' + pedidoEmEdicao.po + '? Isso apaga da planilha também.')) { excluirPedido(pedidoEmEdicao.po); $('#dlg-pedido').close(); } });

    // importação
    $('#btn-importar').addEventListener('click', abrirImportar);
    $('#imp-arquivo').addEventListener('change', e => { if (e.target.files[0]) lerArquivo(e.target.files[0]); });
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('sobre'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) lerArquivo(f); });
    $('#imp-confirmar').addEventListener('click', confirmarImportacao);

    // config: geral e conexão
    $('#c-nomeSistema').addEventListener('change', e => { S.config.nomeSistema = e.target.value.trim() || C.CONFIG_PADRAO.nomeSistema; e.target.value = S.config.nomeSistema; salvarConfig(); aplicarNome(); });
    $('#btn-testar-conexao').addEventListener('click', async () => {
      L.apiUrl = $('#c-apiUrl').value.trim(); L.chave = $('#c-chave').value.trim(); salvarLocal();
      const msg = $('#conexao-msg');
      if (!conectado()) { msg.textContent = 'Preencha link e chave.'; return; }
      msg.textContent = 'Testando…';
      try { await apiGet({ acao: 'ping' }); msg.textContent = 'Conectado. Lendo a planilha…'; const ok = await sincronizar(true); msg.textContent = ok ? 'Conectado e sincronizado.' : 'Conectou, mas há pendências na fila; tentando gravar.'; if (ok && S.fila.length === 0) { salvarConfig(); } }
      catch (e) { msg.textContent = 'Falhou: ' + (e.message || e) + '. Confira o link (/exec), a chave e se o script foi publicado como "Qualquer pessoa".'; }
      atualizarSync();
    });
    $('#c-linkApp').addEventListener('change', e => { S.config.linkApp = e.target.value.trim(); salvarConfig(); });
    $('#btn-link-acesso').addEventListener('click', async () => {
      L.apiUrl = $('#c-apiUrl').value.trim(); L.chave = $('#c-chave').value.trim(); salvarLocal();
      const msg = $('#link-acesso-msg'), campo = $('#link-acesso');
      if (!conectado()) { msg.textContent = 'Preencha link e chave primeiro.'; return; }
      const link = gerarLinkAcesso(); campo.value = link; campo.classList.remove('oculto');
      try { await navigator.clipboard.writeText(link); msg.textContent = 'Copiado. Mande por canal privado.'; } catch (e) { campo.select(); msg.textContent = 'Copie o link do campo.'; }
    });

    // config: avisos
    const cfgCampo = (sel, k, tipo) => $(sel).addEventListener('change', e => {
      S.config[k] = tipo === 'bool' ? e.target.checked : tipo === 'num' ? Number(e.target.value) : e.target.value.trim();
      salvarConfig(); if (k === 'antecedencia') renderTudo();
    });
    cfgCampo('#c-avisosAtivo', 'avisosAtivo', 'bool'); cfgCampo('#c-emailDestino', 'emailDestino'); cfgCampo('#c-hora', 'hora', 'num');
    cfgCampo('#c-antecedencia', 'antecedencia', 'num'); cfgCampo('#c-enviarSeVazio', 'enviarSeVazio', 'bool');
    $('#c-diasSemana').addEventListener('change', () => { S.config.diasSemana = $$('#c-diasSemana input:checked').map(i => Number(i.value)); salvarConfig(); });
    $('#btn-previa-email').addEventListener('click', () => {
      const t = C.textoResumo(S.pedidos, S.config, hoje());
      const el = $('#previa-email'); el.textContent = 'Assunto: ' + t.assunto + '\n\n' + t.corpo; el.classList.toggle('oculto');
    });
    $('#btn-teste-email').addEventListener('click', async () => {
      const msg = $('#email-msg');
      if (!conectado()) { msg.textContent = 'Configure a conexão primeiro.'; return; }
      if (!S.config.emailDestino) { msg.textContent = 'Informe o e-mail de destino.'; return; }
      msg.textContent = 'Enviando…';
      try { await flush(); const r = await apiPost({ acao: 'testarEmail' }); msg.textContent = 'Enviado para ' + (r.para || S.config.emailDestino) + '. Não apareceu? Olhe a pasta de spam e marque "Não é spam".'; }
      catch (e) { msg.textContent = 'Falhou: ' + (e.message || e); }
    });
    $('#c-acoes').addEventListener('change', e => { S.config.acoes = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); salvarConfig(); renderDatalists(); });

    // config: tags, status, transportadoras (delegação)
    const listaTags = (sel, grupo) => {
      $(sel).addEventListener('change', e => {
        const linha = e.target.closest('.linha'); if (!linha) return;
        const t = S.tags.find(x => x.id === linha.dataset.id); if (!t) return;
        t[e.target.dataset.k] = e.target.value; salvarLista('tags');
      });
      $(sel).addEventListener('click', e => {
        const b = e.target.closest('button[data-del="tag"]'); if (!b) return;
        const id = b.closest('.linha').dataset.id; const t = S.tags.find(x => x.id === id);
        const emUso = S.pedidos.filter(p => p[grupo] === t.codigo).length;
        if (emUso && !confirm('Essa tag está em ' + emUso + ' pedidos. Eles ficam com o código "' + t.codigo + '" sem nome/cor. Remover mesmo assim?')) return;
        S.tags = S.tags.filter(x => x.id !== id); salvarLista('tags'); renderConfig();
      });
    };
    listaTags('#lista-tags-tipo', 'tipo'); listaTags('#lista-tags-time', 'time');
    const addTag = grupo => {
      const cod = prompt(grupo === 'tipo' ? 'Código da tag como vem no relatório (ex.: now_pre_buy):' : 'Nome do time (ex.: Decor):'); if (!cod) return;
      const codigo = C.normChave(cod); if (!codigo) return;
      if (S.tags.some(t => t.grupo === grupo && t.codigo === codigo)) { toast('Já existe', true); return; }
      S.tags.push({ id: grupo + ':' + codigo, grupo, codigo, nome: cod.trim(), cor: '#9ca3af' }); salvarLista('tags'); renderConfig();
    };
    $('#btn-add-tag-tipo').addEventListener('click', () => addTag('tipo'));
    $('#btn-add-tag-time').addEventListener('click', () => addTag('time'));
    $('#lista-status').addEventListener('change', e => {
      const st = e.target.closest('.linha').dataset.st;
      if (e.target.dataset.k === 'cor') S.config.statusCores[st] = e.target.value; else S.config.statusNomes[st] = e.target.value.trim() || C.CONFIG_PADRAO.statusNomes[st];
      salvarConfig(); aplicarCoresStatus();
    });
    $('#lista-transp').addEventListener('change', e => {
      const linha = e.target.closest('.linha'); const t = S.transportadoras.find(x => x.id === linha.dataset.id); if (!t) return;
      t[e.target.dataset.k] = e.target.value.trim(); salvarLista('transportadoras');
    });
    $('#lista-transp').addEventListener('click', e => {
      const b = e.target.closest('button[data-del="transp"]'); if (!b) return;
      S.transportadoras = S.transportadoras.filter(x => x.id !== b.closest('.linha').dataset.id); salvarLista('transportadoras'); renderConfig();
    });
    $('#btn-add-transp').addEventListener('click', () => { S.transportadoras.push({ id: C.id(), nome: '', email: '', diaEntrega: '', regra: '' }); salvarLista('transportadoras'); renderConfig(); $('#lista-transp .linha:last-child input').focus(); });

    // config: fornecedores
    $('#busca-forn').addEventListener('input', e => { UI.buscaForn = e.target.value; renderFornecedores(); });
    $('#tab-forn').addEventListener('change', e => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const f = S.fornecedores.find(x => x.id === tr.dataset.id); if (!f) return;
      const k = e.target.dataset.k; if (!k) return;
      if (k === 'coleta') f.coleta = e.target.checked;
      else if (k === 'nome') {
        const novo = e.target.value.trim(); if (!novo) { e.target.value = f.nome; return; }
        if (novo !== f.nome) { S.pedidos.filter(p => p.fornecedor === f.nome).forEach(p => { p.fornecedor = novo; }); const mud = S.pedidos.filter(p => p.fornecedor === novo); if (mud.length) gravarPedidos(mud); f.nome = novo; }
      } else f[k] = e.target.value.trim();
      salvarLista('fornecedores');
    });
    $('#tab-forn').addEventListener('click', e => {
      const b = e.target.closest('button[data-del="forn"]'); if (!b) return;
      const id = b.closest('tr').dataset.id; const f = S.fornecedores.find(x => x.id === id);
      const emUso = S.pedidos.filter(p => p.fornecedor === f.nome).length;
      if (emUso && !confirm('Esse fornecedor está em ' + emUso + ' pedidos (eles não são apagados). Remover do cadastro?')) return;
      S.fornecedores = S.fornecedores.filter(x => x.id !== id); salvarLista('fornecedores'); renderFornecedores();
    });
    $('#btn-add-forn').addEventListener('click', () => {
      const nome = prompt('Nome do fornecedor:'); if (!nome || !nome.trim()) return;
      if (C.acharFornecedor(nome, S.fornecedores)) { toast('Já existe', true); return; }
      S.fornecedores.push({ id: C.id(), nome: nome.trim(), aliases: '', cor: '', transportadora: '', diaEntrega: '', prazoNF: '', coleta: false, obs: '' });
      salvarLista('fornecedores'); UI.buscaForn = nome.trim(); $('#busca-forn').value = UI.buscaForn; renderFornecedores();
    });
    $('#btn-colar-forn').addEventListener('click', () => { $('#colar-texto').value = ''; $('#dlg-colar').showModal(); });
    $('#colar-confirmar').addEventListener('click', () => {
      const nomes = $('#colar-texto').value.split('\n').map(s => s.trim()).filter(Boolean);
      let n = 0;
      nomes.forEach(nome => { if (!C.acharFornecedor(nome, S.fornecedores)) { S.fornecedores.push({ id: C.id(), nome, aliases: '', cor: '', transportadora: '', diaEntrega: '', prazoNF: '', coleta: false, obs: '' }); n++; } });
      if (n) salvarLista('fornecedores');
      $('#dlg-colar').close(); renderFornecedores(); toast(n + ' fornecedores adicionados');
    });

    // config: colunas e relatório
    $('#lista-mapeamento').addEventListener('change', e => { if (e.target.dataset.map) { S.config.mapeamento[e.target.dataset.map] = e.target.value.trim() || C.MAPEAMENTO_PADRAO[e.target.dataset.map]; salvarConfig(); } });
    $('#lista-extras').addEventListener('change', e => {
      const k = e.target.closest('.linha').dataset.k; const ex = (S.config.colunasExtras || []).find(x => x.k === k); if (ex && e.target.dataset.ex === 'nome') { ex.nome = e.target.value.trim() || ex.cabecalho; salvarConfig(); }
    });
    $('#lista-extras').addEventListener('click', e => {
      const b = e.target.closest('button[data-del="extra"]'); if (!b) return;
      const k = b.closest('.linha').dataset.k;
      if (!confirm('Remover a coluna extra? Os valores já importados ficam guardados, só somem da tela.')) return;
      S.config.colunasExtras = S.config.colunasExtras.filter(x => x.k !== k); S.config.colunasVisiveis = S.config.colunasVisiveis.filter(x => x !== 'x:' + k); salvarConfig(); renderConfig();
    });
    $('#lista-ignorados').addEventListener('click', e => {
      const b = e.target.closest('button[data-del="ign"]'); if (!b) return;
      S.config.ignorarCabecalhos = S.config.ignorarCabecalhos.filter(x => x !== b.dataset.v); salvarConfig(); renderConfig();
    });

    // config: dados
    $('#btn-recarregar').addEventListener('click', () => sincronizar(false));
    $('#btn-limpar-cache').addEventListener('click', () => {
      if (S.fila.length && !confirm('Há ' + S.fila.length + ' alterações ainda não gravadas na planilha. Limpar mesmo assim perde essas alterações. Continuar?')) return;
      if (!S.fila.length && !confirm('Limpar o cache deste navegador? Os dados continuam na planilha e são recarregados.')) return;
      localStorage.removeItem(LS); location.reload();
    });

    // aviso de pendências / erro
    $('#aviso').addEventListener('click', e => {
      const b = e.target.closest('button[data-aviso]'); if (!b) return;
      if (b.dataset.aviso === 'tentar') { SY.forcarAviso = true; flush().then(() => { if (!S.fila.length) toast('Tudo gravado na planilha'); }); }
      else if (b.dataset.aviso === 'copia') exportarLista(C.ordenar(S.pedidos, 'limite', 'asc', ctx()), 'pedidos-copia', 'xlsx');
      else if (b.dataset.aviso === 'config') { irPara('config'); $('#cfg-conexao').scrollIntoView(); }
    });
    $('#sync').addEventListener('click', () => { if (S.fila.length) { SY.forcarAviso = true; renderAviso(); flush(); } });
    window.addEventListener('beforeunload', e => { if (S.fila.length && conectado()) { e.preventDefault(); e.returnValue = 'Há alterações ainda não gravadas na planilha.'; } });
    setInterval(renderAviso, 30000);

    // sincronização periódica
    window.addEventListener('online', () => flush());
    setInterval(() => { if (S.fila.length) flush(); }, 30000);
    setInterval(() => { if (conectado() && !S.fila.length && document.visibilityState === 'visible') sincronizar(true); }, 5 * 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { renderAba(); if (S.fila.length) flush(); } });
  }

  // ---------------- Boot ----------------
  carregar();
  const viaLink = tratarLinkAcesso();
  ligarEventos();
  aplicarNome();
  renderPeriodo();
  aplicarCoresStatus();
  renderDatalists();
  const abaInicial = location.hash.slice(1);
  irPara(['dash', 'pedidos', 'config'].includes(abaInicial) ? abaInicial : (conectado() || S.pedidos.length ? UI.aba : 'config'));
  atualizarSync();
  if (viaLink) { irPara('dash'); toast('Acesso configurado. Lendo a planilha…'); }
  if (conectado()) sincronizar(true);
  window.SJO = { S, L, UI, SY, LIMIAR, PC, sincronizar, flush, renderAviso, exportarLista, definirPeriodo, gerarLinkAcesso }; // pra depuração no console
})();
