/* core.js — regras puras do sistema de pedidos.
   Sem DOM, sem rede. Roda no navegador (window.Core) e no Node (module.exports) pra teste.
   Datas internas sempre em ISO "aaaa-mm-dd". Exibição sempre em "dd/mm/aaaa". */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Datas ----------
  function pad(n) { return String(n).padStart(2, '0'); }

  function hojeISO(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  }

  // "16/09/2026 10:32" | "16/09/2026" | "2026-09-16" | "16/09/26" -> "2026-09-16" | ""
  function parseData(s) {
    if (s == null) return '';
    if (s instanceof Date) return isNaN(s) ? '' : hojeISO(s);
    s = String(s).trim();
    if (!s) return '';
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      let a = m[3].length === 2 ? '20' + m[3] : m[3];
      const iso = a + '-' + pad(m[2]) + '-' + pad(m[1]);
      return validaISO(iso) ? iso : '';
    }
    return '';
  }

  function validaISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return false;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
  }

  function isoParaDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  // "2026-09-16" -> "16/09/2026"
  function fmtData(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }
  // "2026-09-16" -> "16/09"
  function fmtDataCurta(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '/' + m[2] : '';
  }

  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  function diaSemana(iso) { const d = isoParaDate(iso); return d ? DIAS[d.getDay()] : ''; }

  function addDias(iso, n) {
    const d = isoParaDate(iso); if (!d) return '';
    d.setDate(d.getDate() + n);
    return hojeISO(d);
  }

  // Dias úteis seg–sex (feriado não conta: pendente de confirmação com a Julia)
  function addDiasUteis(iso, n) {
    const d = isoParaDate(iso); if (!d) return '';
    let k = 0; n = Math.round(Number(n) || 0);
    while (k < n) {
      d.setDate(d.getDate() + 1);
      const w = d.getDay();
      if (w !== 0 && w !== 6) k++;
    }
    return hojeISO(d);
  }

  // diferença em dias corridos (b - a)
  function diffDias(a, b) {
    const da = isoParaDate(a), db = isoParaDate(b);
    if (!da || !db) return null;
    return Math.round((db - da) / 86400000);
  }

  // ---------- Números ----------
  // "1.234,56" | "1234.56" | 1234.56 -> 1234.56
  function parseNumBR(s) {
    if (s == null || s === '') return 0;
    if (typeof s === 'number') return s;
    s = String(s).trim().replace(/[R$\s]/g, '');
    if (!s) return 0;
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    else s = s.replace(',', '.');
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  }
  function fmtMoeda(n) {
    n = Number(n) || 0;
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtInt(n) { return (Number(n) || 0).toLocaleString('pt-BR'); }
  function fmtPct(a, b) { return b ? Math.round((a / b) * 100) + '%' : '0%'; }

  // ---------- CSV ----------
  function detectaSeparador(texto) {
    const linha = texto.split(/\r?\n/).find(l => l.trim()) || '';
    const c = { ';': 0, ',': 0, '\t': 0 };
    let q = false;
    for (const ch of linha) {
      if (ch === '"') q = !q;
      else if (!q && ch in c) c[ch]++;
    }
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || ';';
  }

  function parseCSV(texto, sep) {
    texto = String(texto || '').replace(/^\uFEFF/, '');
    sep = sep || detectaSeparador(texto);
    const linhas = []; let campo = '', linha = [], q = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (q) {
        if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else q = false; }
        else campo += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { linha.push(campo); campo = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && texto[i + 1] === '\n') i++;
        linha.push(campo); campo = '';
        if (linha.some(c => c.trim() !== '')) linhas.push(linha);
        linha = [];
      } else campo += ch;
    }
    linha.push(campo);
    if (linha.some(c => c.trim() !== '')) linhas.push(linha);
    return linhas;
  }

  function csvLinha(vals, sep) {
    return vals.map(v => {
      v = v == null ? '' : String(v);
      return /["\n\r;,\t]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(sep || ';');
  }

  // ---------- Normalização ----------
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function normChave(s) { return norm(s).replace(/ /g, '_'); }

  // ---------- Modelo ----------
  // Campos do pedido. `origem`: relatorio | julia | app
  const CAMPOS = [
    { k: 'po', nome: 'PO', tipo: 'texto', origem: 'relatorio', padrao: true },
    { k: 'status', nome: 'Status', tipo: 'status', origem: 'app', padrao: true },
    { k: 'fornecedor', nome: 'Fornecedor', tipo: 'fornecedor', origem: 'relatorio', padrao: true },
    { k: 'tipo', nome: 'Tipo', tipo: 'tag', origem: 'relatorio', padrao: true },
    { k: 'time', nome: 'Time', tipo: 'time', origem: 'relatorio', padrao: true },
    { k: 'limite', nome: 'Data limite', tipo: 'data', origem: 'relatorio', padrao: true },
    { k: 'qtd', nome: 'Qtd', tipo: 'int', origem: 'relatorio', padrao: true },
    { k: 'qtdEntregue', nome: 'Entregue', tipo: 'int', origem: 'julia', padrao: false },
    { k: 'saldo', nome: 'Saldo', tipo: 'int', origem: 'app', padrao: true },
    { k: 'acao', nome: 'Próxima ação', tipo: 'acao', origem: 'julia', padrao: true },
    { k: 'dataAcao', nome: 'Data da ação', tipo: 'data', origem: 'julia', padrao: true },
    { k: 'obs', nome: 'Observação', tipo: 'texto', origem: 'julia', padrao: true },
    { k: 'update', nome: 'Update', tipo: 'data', origem: 'app', padrao: true },
    { k: 'remessa', nome: 'Remessa', tipo: 'texto', origem: 'julia', padrao: false },
    { k: 'valor', nome: 'Valor', tipo: 'moeda', origem: 'relatorio', padrao: false },
    { k: 'armazem', nome: 'Armazém', tipo: 'texto', origem: 'relatorio', padrao: false },
    { k: 'campanha', nome: 'Campanha', tipo: 'texto', origem: 'relatorio', padrao: false },
    { k: 'campanhaId', nome: 'Campanha ID', tipo: 'texto', origem: 'relatorio', padrao: false },
    { k: 'envio', nome: 'Envio', tipo: 'data', origem: 'relatorio', padrao: false },
    { k: 'leadWms', nome: 'Lead WMS', tipo: 'int', origem: 'relatorio', padrao: false },
    { k: 'leadBob', nome: 'Lead BOB', tipo: 'int', origem: 'relatorio', padrao: false, oculto: true },
    { k: 'pagamento', nome: 'Pagamento', tipo: 'texto', origem: 'relatorio', padrao: false, oculto: true },
    { k: 'inicioCampanha', nome: 'Início camp.', tipo: 'data', origem: 'relatorio', padrao: false },
    { k: 'finalCampanha', nome: 'Final camp.', tipo: 'data', origem: 'relatorio', padrao: false },
    { k: 'finalizacao', nome: 'Finalização', tipo: 'data', origem: 'julia', padrao: false },
    { k: 'criadoEm', nome: 'Criado em', tipo: 'data', origem: 'app', padrao: false },
    { k: 'origem', nome: 'Origem', tipo: 'texto', origem: 'app', padrao: false }
  ];
  const CAMPO = Object.fromEntries(CAMPOS.map(c => [c.k, c]));

  // Mapeamento padrão: campo -> nome do cabeçalho no relatório (normalizado na comparação)
  const MAPEAMENTO_PADRAO = {
    po: 'PO', fornecedor: 'Fornecedor', tipo: 'Tipo PO', time: 'Time', envio: 'Envio PO',
    qtd: 'Qtd Pecas', valor: 'Valor PO', limite: 'Delivery Time', leadWms: 'Lead Time WMS',
    leadBob: 'Lead Time BOB', armazem: 'Armazem', campanha: 'Campanha', campanhaId: 'Campanha ID',
    pagamento: 'Forma Pagamento', inicioCampanha: 'Inicio Campanha', finalCampanha: 'Final Campanha'
  };

  const CONFIG_PADRAO = {
    apiUrl: '', chave: '',
    nomeSistema: 'Sistema Westwing',
    dashProximos: 7, dashTimeVista: 'grafico', dashTop: 10,
    avisosAtivo: true, emailDestino: '', hora: 8, diasSemana: [1, 2, 3, 4, 5], antecedencia: 2,
    enviarSeVazio: false, linkApp: '',
    colunasVisiveis: CAMPOS.filter(c => c.padrao).map(c => c.k),
    colunasExtras: [],          // [{k, nome, cabecalho}] colunas novas vindas do relatório
    mapeamento: Object.assign({}, MAPEAMENTO_PADRAO),
    ignorarCabecalhos: [],       // cabeçalhos do relatório que ela mandou ignorar
    periodo: { preset: 'tudo', de: '', ate: '', campo: 'limite' },
    dashMetrica: 'pedidos', dashRecorte: 'abertos',
    statusNomes: { atrasado: 'Atrasado', vence: 'Vence em breve', andamento: 'Em andamento', finalizado: 'Finalizado' },
    statusCores: { atrasado: '#e5484d', vence: '#f5a524', andamento: '#3b82f6', finalizado: '#9ca3af' }
  };

  const TAGS_PADRAO = [
    { id: 'tipo:now_crossdocking', grupo: 'tipo', codigo: 'now_crossdocking', nome: 'now_crossdocking', cor: '#0ea5e9' },
    { id: 'tipo:now_pre_buy', grupo: 'tipo', codigo: 'now_pre_buy', nome: 'now_pre_buy', cor: '#8b5cf6' },
    { id: 'tipo:ticket_active', grupo: 'tipo', codigo: 'ticket_active', nome: 'ticket_active', cor: '#f59e0b' },
    { id: 'tipo:repurchase', grupo: 'tipo', codigo: 'repurchase', nome: 'repurchase', cor: '#10b981' },
    { id: 'tipo:influencers', grupo: 'tipo', codigo: 'influencers', nome: 'influencers', cor: '#ec4899' },
    { id: 'tipo:store', grupo: 'tipo', codigo: 'store', nome: 'STORE', cor: '#64748b' },
    { id: 'tipo:special_actions', grupo: 'tipo', codigo: 'special_actions', nome: 'special_actions', cor: '#ef4444' },
    { id: 'tipo:saldo', grupo: 'tipo', codigo: 'saldo', nome: 'Saldo', cor: '#a16207' },
    { id: 'time:decor', grupo: 'time', codigo: 'decor', nome: 'Decor', cor: '#f97316' },
    { id: 'time:cozinha', grupo: 'time', codigo: 'cozinha', nome: 'Cozinha', cor: '#14b8a6' },
    { id: 'time:textil', grupo: 'time', codigo: 'textil', nome: 'Textil', cor: '#a855f7' },
    { id: 'time:moveis', grupo: 'time', codigo: 'moveis', nome: 'Moveis', cor: '#84cc16' }
  ];

  const ACOES_PADRAO = ['Agendar', 'Agendado', 'Previsão', 'Enviar ativo', 'Ativo enviado', 'Enviar preventivo',
    'Preventivo enviado', 'Ag. NF', 'Ag. retorno fornecedor', 'Ag. receber PO', 'PO recebido', 'NF recebida',
    'Quebrar', 'Ver saldo', 'Rastreio'];

  function pedidoVazio() {
    const p = {};
    CAMPOS.forEach(c => { p[c.k] = (c.tipo === 'int' || c.tipo === 'moeda') ? 0 : ''; });
    p.extras = {};
    p.criadoEm = hojeISO();
    p.origem = 'manual';
    p.remessa = '1';
    return p;
  }

  function saldo(p) {
    const q = Number(p.qtd) || 0, e = Number(p.qtdEntregue) || 0;
    return Math.max(0, q - e);
  }
  function temSaldo(p) { return (Number(p.qtdEntregue) || 0) > 0 && saldo(p) > 0; }
  function remessaDe(p) { return String(p.remessa || '') === '2' ? '2' : '1'; }

  // ---------- Status (calculado, nunca digitado) ----------
  // finalizado | atrasado | vence (hoje..hoje+antecedencia) | andamento
  function statusDe(p, hoje, antecedencia) {
    hoje = hoje || hojeISO();
    if (p.finalizacao) return 'finalizado';
    if (!p.limite) return 'andamento';
    const d = diffDias(hoje, p.limite);
    if (d < 0) return 'atrasado';
    if (d <= (antecedencia == null ? 2 : antecedencia)) return 'vence';
    return 'andamento';
  }
  function aberto(p) { return !p.finalizacao; }

  // ---------- Importação ----------
  // Casa cabeçalhos do arquivo com o mapeamento. Retorna {porCampo:{campo:idx}, desconhecidos:[{idx,cab}]}
  function casarCabecalhos(cabs, mapeamento, extras, ignorar) {
    const mapa = Object.assign({}, MAPEAMENTO_PADRAO, mapeamento || {});
    const porCampo = {}, usados = new Set();
    const nc = cabs.map(norm);
    Object.keys(mapa).forEach(campo => {
      const alvo = norm(mapa[campo]);
      let i = nc.indexOf(alvo);
      if (i < 0) i = nc.findIndex(c => c === norm(CAMPO[campo] ? CAMPO[campo].nome : ''));
      if (i >= 0 && !usados.has(i)) { porCampo[campo] = i; usados.add(i); }
    });
    (extras || []).forEach(ex => {
      const i = nc.indexOf(norm(ex.cabecalho));
      if (i >= 0 && !usados.has(i)) { porCampo['x:' + ex.k] = i; usados.add(i); }
    });
    const ign = new Set((ignorar || []).map(norm));
    const desconhecidos = [];
    cabs.forEach((c, i) => { if (!usados.has(i) && c.trim() && !ign.has(nc[i])) desconhecidos.push({ idx: i, cab: c.trim() }); });
    return { porCampo, desconhecidos, faltando: ['po', 'fornecedor', 'limite'].filter(k => porCampo[k] == null) };
  }

  function linhaParaPedido(linha, porCampo, hoje) {
    const g = k => porCampo[k] == null ? '' : (linha[porCampo[k]] || '').trim();
    const p = pedidoVazio();
    p.origem = 'import';
    p.criadoEm = hoje || hojeISO();
    p.po = g('po');
    p.fornecedor = g('fornecedor');
    p.tipo = normChave(g('tipo'));
    p.time = normChave(g('time'));
    p.envio = parseData(g('envio'));
    p.qtd = Math.round(parseNumBR(g('qtd')));
    p.valor = parseNumBR(g('valor'));
    p.limite = parseData(g('limite'));
    p.leadWms = Math.round(parseNumBR(g('leadWms')));
    p.leadBob = Math.round(parseNumBR(g('leadBob')));
    p.armazem = g('armazem'); p.campanha = g('campanha'); p.campanhaId = g('campanhaId');
    p.pagamento = g('pagamento');
    p.inicioCampanha = parseData(g('inicioCampanha')); p.finalCampanha = parseData(g('finalCampanha'));
    Object.keys(porCampo).filter(k => k.startsWith('x:')).forEach(k => { p.extras[k.slice(2)] = g(k); });
    return p;
  }

  // Compara relatório com pedidos existentes. Nunca sobrescreve campos da Julia.
  // Retorna {novos:[], atualizados:[{po, mudancas:[]}], iguais:n, avisos:[{po, msg}], pedidos: lista final}
  function mesclarImportacao(existentes, importados, hoje) {
    hoje = hoje || hojeISO();
    const porPO = new Map(existentes.map(p => [String(p.po), p]));
    const novos = [], atualizados = [], avisos = []; let iguais = 0;
    const camposRel = CAMPOS.filter(c => c.origem === 'relatorio' && c.k !== 'po').map(c => c.k);
    importados.forEach(imp => {
      if (!imp.po) { avisos.push({ po: '', msg: 'Linha sem PO ignorada' }); return; }
      // confere a regra de data limite
      if (imp.envio && imp.leadWms) {
        const calc = addDiasUteis(imp.envio, imp.leadWms);
        if (imp.limite && calc !== imp.limite)
          avisos.push({ po: imp.po, msg: 'Data limite do relatório (' + fmtData(imp.limite) + ') difere de envio + lead útil (' + fmtData(calc) + '). Mantida a do relatório.' });
        if (!imp.limite) { imp.limite = calc; avisos.push({ po: imp.po, msg: 'Relatório sem data limite; calculada ' + fmtData(calc) }); }
      }
      const ex = porPO.get(String(imp.po));
      if (!ex) { novos.push(imp); porPO.set(String(imp.po), imp); return; }
      const mud = [];
      camposRel.forEach(k => {
        const a = ex[k], b = imp[k];
        const iguaisV = (typeof b === 'number') ? Number(a || 0) === b : String(a || '') === String(b || '');
        if (!iguaisV && (b !== '' && b !== 0 || k === 'qtd')) {
          if (k === 'fornecedor' && a) avisos.push({ po: imp.po, msg: 'Fornecedor mudou: "' + a + '" → "' + b + '"' });
          mud.push({ k, de: a, para: b }); ex[k] = b;
        }
      });
      Object.keys(imp.extras || {}).forEach(k => { if (imp.extras[k] !== (ex.extras || {})[k]) { ex.extras = ex.extras || {}; ex.extras[k] = imp.extras[k]; mud.push({ k: 'x:' + k }); } });
      if (mud.length) { ex.update = hoje; atualizados.push({ po: imp.po, mudancas: mud }); } else iguais++;
    });
    return { novos, atualizados, iguais, avisos, pedidos: Array.from(porPO.values()) };
  }

  // ---------- Filtros / ordenação ----------
  function noPeriodo(p, periodo) {
    if (!periodo || (!periodo.de && !periodo.ate)) return true;
    const d = p[periodo.campo === 'envio' ? 'envio' : 'limite'];
    if (!d) return true;
    if (periodo.de && d < periodo.de) return false;
    if (periodo.ate && d > periodo.ate) return false;
    return true;
  }

  // Presets do filtro de período. Devolve {de, ate} (vazios = todo o período).
  const PRESETS_PERIODO = [
    { id: 'tudo', nome: 'Todo o período' }, { id: 'hoje', nome: 'Hoje' }, { id: 'ontem', nome: 'Ontem' },
    { id: 'u7', nome: 'Últimos 7 dias' }, { id: 'u14', nome: 'Últimos 14 dias' }, { id: 'mes', nome: 'Este mês' },
    { id: 'mesPassado', nome: 'Mês passado' }, { id: 'u60', nome: 'Últimos 60 dias' }, { id: 'u90', nome: 'Últimos 90 dias' },
    { id: 'p7', nome: 'Próximos 7 dias' }, { id: 'p14', nome: 'Próximos 14 dias' }, { id: 'p30', nome: 'Próximos 30 dias' },
    { id: 'custom', nome: 'Personalizado' }
  ];
  function calcularPeriodo(preset, hoje) {
    hoje = hoje || hojeISO();
    const fimMes = iso => { const d = isoParaDate(iso); return hojeISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
    const m = /^([up])(\d+)$/.exec(preset || '');
    if (m) return m[1] === 'u' ? { de: addDias(hoje, -(Number(m[2]) - 1)), ate: hoje } : { de: hoje, ate: addDias(hoje, Number(m[2]) - 1) };
    switch (preset) {
      case 'hoje': return { de: hoje, ate: hoje };
      case 'ontem': { const o = addDias(hoje, -1); return { de: o, ate: o }; }
      case 'mes': return { de: hoje.slice(0, 8) + '01', ate: fimMes(hoje) };
      case 'mesPassado': { const ini = addDias(hoje.slice(0, 8) + '01', -1).slice(0, 8) + '01'; return { de: ini, ate: fimMes(ini) }; }
      default: return { de: '', ate: '' };
    }
  }
  function rotuloPeriodo(periodo) {
    if (!periodo || (!periodo.de && !periodo.ate)) return 'Todo o período';
    const pr = PRESETS_PERIODO.find(x => x.id === periodo.preset);
    const faixa = periodo.de === periodo.ate ? fmtDataCurta(periodo.de) : (periodo.de ? fmtDataCurta(periodo.de) : '…') + ' – ' + (periodo.ate ? fmtDataCurta(periodo.ate) : '…');
    return (pr && pr.id !== 'custom' ? pr.nome + ' · ' : '') + faixa;
  }

  function filtrar(pedidos, f, ctx) {
    ctx = ctx || {}; const hoje = ctx.hoje || hojeISO(); const ant = ctx.antecedencia;
    const busca = norm(f.busca || '');
    return pedidos.filter(p => {
      if (!noPeriodo(p, f.periodo)) return false;
      const st = statusDe(p, hoje, ant);
      if (f.status && f.status !== 'todos') {
        if (f.status === 'abertos' && !aberto(p)) return false;
        else if (f.status !== 'abertos' && st !== f.status) return false;
      }
      if (f.fornecedor && p.fornecedor !== f.fornecedor) return false;
      if (f.tipo && p.tipo !== f.tipo) return false;
      if (f.time && p.time !== f.time) return false;
      if (f.transportadora && (ctx.transpDoFornecedor ? ctx.transpDoFornecedor(p.fornecedor) : '') !== f.transportadora) return false;
      if (f.remessa && f.remessa !== 'todas' && remessaDe(p) !== String(f.remessa)) return false;
      if (f.soSaldos && !temSaldo(p)) return false;
      if (busca) {
        const alvo = norm([p.po, p.fornecedor, p.obs, p.acao, p.campanha, p.armazem].join(' '));
        if (!alvo.includes(busca)) return false;
      }
      return true;
    });
  }

  function ordenar(pedidos, col, dir, ctx) {
    const s = dir === 'desc' ? -1 : 1;
    const hoje = (ctx && ctx.hoje) || hojeISO();
    const ordemStatus = { atrasado: 0, vence: 1, andamento: 2, finalizado: 3 };
    const val = p => {
      if (col === 'status') return ordemStatus[statusDe(p, hoje, ctx && ctx.antecedencia)];
      if (col === 'saldo') return saldo(p);
      if (col.startsWith('x:')) return (p.extras || {})[col.slice(2)] || '';
      const c = CAMPO[col];
      const v = p[col];
      if (c && (c.tipo === 'int' || c.tipo === 'moeda')) return Number(v) || 0;
      if (c && c.tipo === 'data') return v || '9999-99-99';
      return norm(v);
    };
    return pedidos.slice().sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -s; if (va > vb) return s;
      return (a.limite || '') < (b.limite || '') ? -1 : 1;
    });
  }

  // ---------- Resumo (Dash + e-mail) ----------
  function resumo(pedidos, hoje, antecedencia, diasProximos) {
    hoje = hoje || hojeISO(); antecedencia = antecedencia == null ? 2 : antecedencia;
    const r = { atrasados: [], vencem: [], acoesHoje: [], andamento: [], finalizados: [], abertos: [], proximos: [] };
    const lim7 = addDias(hoje, diasProximos || 7);
    pedidos.forEach(p => {
      const st = statusDe(p, hoje, antecedencia);
      if (st === 'finalizado') { r.finalizados.push(p); return; }
      r.abertos.push(p);
      if (st === 'atrasado') r.atrasados.push(p);
      else if (st === 'vence') r.vencem.push(p);
      else r.andamento.push(p);
      if (p.dataAcao && p.dataAcao <= hoje) r.acoesHoje.push(p);
      if (p.limite && p.limite >= hoje && p.limite <= lim7) r.proximos.push(p);
    });
    const porLimite = (a, b) => (a.limite || '') < (b.limite || '') ? -1 : 1;
    r.atrasados.sort(porLimite); r.vencem.sort(porLimite); r.proximos.sort(porLimite);
    r.proximos7 = r.proximos;
    r.acoesHoje.sort((a, b) => (a.dataAcao || '') < (b.dataAcao || '') ? -1 : 1);
    return r;
  }

  // agrupa métrica por chave (fornecedor/time) -> [{chave, valor}] ordenado desc
  function agrupar(pedidos, chave, metrica, top) {
    const m = new Map();
    pedidos.forEach(p => {
      const k = p[chave] || '(sem ' + chave + ')';
      const v = metrica === 'pecas' ? (saldo(p) || 0) : metrica === 'valor' ? (Number(p.valor) || 0) : 1;
      m.set(k, (m.get(k) || 0) + v);
    });
    return Array.from(m, ([chave, valor]) => ({ chave, valor })).sort((a, b) => b.valor - a.valor).slice(0, top || 10);
  }

  // Tabela por chave (ex.: time): pedidos, peças em aberto, valor, atrasados
  function tabelaPor(pedidos, chave, hoje, antecedencia) {
    hoje = hoje || hojeISO();
    const m = new Map();
    pedidos.forEach(p => {
      const k = p[chave] || '(sem ' + chave + ')';
      if (!m.has(k)) m.set(k, { chave: k, pedidos: 0, pecas: 0, valor: 0, atrasados: 0 });
      const r = m.get(k); r.pedidos++; r.pecas += saldo(p); r.valor += Number(p.valor) || 0;
      if (statusDe(p, hoje, antecedencia) === 'atrasado') r.atrasados++;
    });
    return Array.from(m.values()).sort((a, b) => b.pedidos - a.pedidos);
  }

  // Texto do e-mail diário. Usado pelo Apps Script (mesma função copiada lá) e pelo botão "prévia".
  function textoResumo(pedidos, cfg, hoje) {
    hoje = hoje || hojeISO(); cfg = cfg || {};
    const ant = cfg.antecedencia == null ? 2 : cfg.antecedencia;
    const r = resumo(pedidos, hoje, ant);
    const nomes = cfg.statusNomes || CONFIG_PADRAO.statusNomes;
    const lin = p => '  PO ' + p.po + (remessaDe(p) === '2' ? ' (2ª remessa, saldo ' + saldo(p) + ')' : '') + ' · ' + p.fornecedor + ' · limite ' + fmtDataCurta(p.limite) +
      (p.acao ? ' · ' + p.acao + (p.dataAcao ? ' ' + fmtDataCurta(p.dataAcao) : '') : '') + (p.obs ? ' · ' + p.obs : '');
    const assunto = 'Pedidos · ' + diaSemana(hoje) + ' ' + fmtDataCurta(hoje) + ' · ' + r.atrasados.length + ' ' + nomes.atrasado.toLowerCase() +
      (r.atrasados.length === 1 ? '' : 's') + ' · ' + r.vencem.length + ' vencem em até ' + ant + ' dias · ' + r.acoesHoje.length + ' ações hoje';
    const partes = [];
    if (r.atrasados.length) partes.push(nomes.atrasado.toUpperCase() + 'S (' + r.atrasados.length + ')\n' + r.atrasados.map(lin).join('\n'));
    if (r.vencem.length) partes.push('VENCEM EM ATÉ ' + ant + ' DIAS (' + r.vencem.length + ')\n' + r.vencem.map(lin).join('\n'));
    if (r.acoesHoje.length) partes.push('AÇÕES DE HOJE (' + r.acoesHoje.length + ')\n' + r.acoesHoje.map(lin).join('\n'));
    const vazio = partes.length === 0;
    let corpo = vazio ? 'Tudo em dia. Nenhum pedido atrasado, vencendo ou com ação marcada.' : partes.join('\n\n');
    if (cfg.linkApp) corpo += '\n\nAbrir o app: ' + cfg.linkApp;
    return { assunto, corpo, vazio, resumo: r };
  }

  // ---------- Exportar ----------
  function exportarCSV(pedidos, colunas, ctx) {
    const hoje = (ctx && ctx.hoje) || hojeISO();
    const nomes = (ctx && ctx.statusNomes) || CONFIG_PADRAO.statusNomes;
    const cab = colunas.map(k => k.startsWith('x:') ? ((ctx && ctx.extrasNome && ctx.extrasNome[k.slice(2)]) || k.slice(2)) : (CAMPO[k] ? CAMPO[k].nome : k));
    const linhas = [csvLinha(cab)];
    pedidos.forEach(p => {
      linhas.push(csvLinha(colunas.map(k => {
        if (k === 'status') return nomes[statusDe(p, hoje, ctx && ctx.antecedencia)];
        if (k === 'saldo') return saldo(p);
        if (k === 'remessa') return remessaDe(p) === '2' ? '2ª remessa' : '1ª remessa';
        if (k.startsWith('x:')) return (p.extras || {})[k.slice(2)] || '';
        const c = CAMPO[k]; const v = p[k];
        if (!c) return v == null ? '' : v;
        if (c.tipo === 'data') return fmtData(v);
        if (c.tipo === 'moeda') return (Number(v) || 0).toFixed(2).replace('.', ',');
        return v == null ? '' : v;
      })));
    });
    return '\uFEFF' + linhas.join('\r\n');
  }

  // ---------- Excel (.xlsx) sem biblioteca: zip "store" + SpreadsheetML mínimo ----------
  const CRC_TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TAB[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(arquivos) { // [{nome, texto}] -> Uint8Array
    const enc = new TextEncoder(); const partes = []; const cd = []; let off = 0;
    const d = new Date(); const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    arquivos.forEach(a => {
      const nome = enc.encode(a.nome), dados = enc.encode(a.texto), crc = crc32(dados);
      const loc = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosT), ...u16(dosD), ...u32(crc), ...u32(dados.length), ...u32(dados.length), ...u16(nome.length), ...u16(0), ...nome]);
      partes.push(loc, dados);
      cd.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosT), ...u16(dosD), ...u32(crc), ...u32(dados.length), ...u32(dados.length), ...u16(nome.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...nome]));
      off += loc.length + dados.length;
    });
    const cdLen = cd.reduce((s, x) => s + x.length, 0);
    const fim = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(cd.length), ...u16(cd.length), ...u32(cdLen), ...u32(off), ...u16(0)]);
    const total = partes.concat(cd, [fim]); const out = new Uint8Array(total.reduce((s, x) => s + x.length, 0)); let p = 0;
    total.forEach(x => { out.set(x, p); p += x.length; });
    return out;
  }
  const xmlEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  function colLetra(n) { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
  function serialExcel(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000) : null; }
  // colunas: [{nome, tipo: texto|int|moeda|data}], linhas: [[valor,...]] (data em ISO). Devolve Uint8Array do .xlsx
  function xlsx(nomeAba, colunas, linhas) {
    const n = colunas.length, ref = 'A1:' + colLetra(n - 1) + (linhas.length + 1);
    const cel = (r, c, v, tipo) => {
      const ref = colLetra(c) + r;
      if (tipo === 'cab') return '<c r="' + ref + '" t="inlineStr" s="3"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
      if (v === '' || v == null) return '';
      if (tipo === 'data') { const s = serialExcel(v); return s == null ? '' : '<c r="' + ref + '" s="1"><v>' + s + '</v></c>'; }
      if (tipo === 'moeda') return '<c r="' + ref + '" s="2"><v>' + (Number(v) || 0) + '</v></c>';
      if (tipo === 'int') return '<c r="' + ref + '" s="4"><v>' + (Number(v) || 0) + '</v></c>';
      return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
    };
    const largura = colunas.map((c, i) => Math.min(60, Math.max(10, c.nome.length + 2, ...linhas.slice(0, 200).map(l => String(l[i] == null ? '' : l[i]).length + 2))));
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + largura.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols><sheetData>' +
      '<row r="1">' + colunas.map((c, i) => cel(1, i, c.nome, 'cab')).join('') + '</row>' +
      linhas.map((l, r) => '<row r="' + (r + 2) + '">' + colunas.map((c, i) => cel(r + 2, i, l[i], c.tipo)).join('') + '</row>').join('') +
      '</sheetData><autoFilter ref="' + ref + '"/></worksheet>';
    const aba = xmlEsc(String(nomeAba || 'Dados').slice(0, 31));
    const arquivos = [
      { nome: '[Content_Types].xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { nome: '_rels/.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { nome: 'xl/workbook.xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + aba + '" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + aba + '\'!$A$1:$' + colLetra(n - 1) + '$' + (linhas.length + 1) + '</definedName></definedNames></workbook>' },
      { nome: 'xl/_rels/workbook.xml.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { nome: 'xl/styles.xml', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;R$ &quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
      { nome: 'xl/worksheets/sheet1.xml', texto: sheet }
    ];
    return zipStore(arquivos);
  }
  // Mesmas colunas do exportarCSV, com tipos certos pro Excel
  function exportarXLSX(pedidos, colunas, ctx) {
    const hoje = (ctx && ctx.hoje) || hojeISO();
    const nomes = (ctx && ctx.statusNomes) || CONFIG_PADRAO.statusNomes;
    const cols = colunas.map(k => {
      if (k === 'status' || k === 'remessa' || k.startsWith('x:')) return { k, nome: k.startsWith('x:') ? ((ctx && ctx.extrasNome && ctx.extrasNome[k.slice(2)]) || k.slice(2)) : CAMPO[k].nome, tipo: 'texto' };
      if (k === 'saldo') return { k, nome: 'Saldo', tipo: 'int' };
      const c = CAMPO[k]; return { k, nome: c ? c.nome : k, tipo: c ? (c.tipo === 'data' ? 'data' : c.tipo === 'moeda' ? 'moeda' : c.tipo === 'int' ? 'int' : 'texto') : 'texto' };
    });
    const linhas = pedidos.map(p => cols.map(c => {
      const k = c.k;
      if (k === 'status') return nomes[statusDe(p, hoje, ctx && ctx.antecedencia)];
      if (k === 'saldo') return saldo(p);
      if (k === 'remessa') return remessaDe(p) === '2' ? '2ª remessa' : '1ª remessa';
      if (k.startsWith('x:')) return (p.extras || {})[k.slice(2)] || '';
      return p[k] == null ? '' : p[k];
    }));
    return xlsx((ctx && ctx.nomeAba) || 'Pedidos', cols, linhas);
  }

  // ---------- Fornecedores ----------
  function acharFornecedor(nome, fornecedores) {
    const n = norm(nome);
    if (!n) return null;
    for (const f of fornecedores) {
      if (norm(f.nome) === n) return f;
      if ((f.aliases || '').split('|').some(a => a && norm(a) === n)) return f;
    }
    return null;
  }

  function id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  return {
    hojeISO, parseData, validaISO, fmtData, fmtDataCurta, diaSemana, addDias, addDiasUteis, diffDias,
    parseNumBR, fmtMoeda, fmtInt, fmtPct, detectaSeparador, parseCSV, csvLinha, norm, normChave,
    CAMPOS, CAMPO, MAPEAMENTO_PADRAO, CONFIG_PADRAO, TAGS_PADRAO, ACOES_PADRAO,
    pedidoVazio, saldo, temSaldo, remessaDe, statusDe, aberto, casarCabecalhos, linhaParaPedido, mesclarImportacao,
    noPeriodo, PRESETS_PERIODO, calcularPeriodo, rotuloPeriodo, filtrar, ordenar, resumo, tabelaPor, agrupar, textoResumo, exportarCSV,
    xlsx, exportarXLSX, crc32, acharFornecedor, id
  };
});
