const C = require('../core.js');
const fs = require('fs');
let ok = 0, falhas = [];
function t(nome, cond) { if (cond) ok++; else falhas.push(nome); }

// datas
t('parseData BR com hora', C.parseData('16/09/2026 10:32') === '2026-09-16');
t('parseData ISO', C.parseData('2026-09-16') === '2026-09-16');
t('parseData inválida', C.parseData('31/02/2026') === '');
t('parseData vazio', C.parseData('') === '');
t('fmtData', C.fmtData('2026-09-16') === '16/09/2026');
t('dias úteis: qua 16/09 + 15 = 07/10', C.addDiasUteis('2026-09-16', 15) === '2026-10-07');
t('dias úteis: sex + 1 = seg', C.addDiasUteis('2026-09-18', 1) === '2026-09-21');
t('dias úteis: 0', C.addDiasUteis('2026-09-18', 0) === '2026-09-18');
t('diffDias', C.diffDias('2026-09-18', '2026-09-20') === 2);
t('diaSemana', C.diaSemana('2026-09-18') === 'sex');

// números
t('parseNumBR 1.234,56', C.parseNumBR('1.234,56') === 1234.56);
t('parseNumBR 8.450,00', C.parseNumBR('8.450,00') === 8450);
t('parseNumBR 15.000', C.parseNumBR('15.000') === 15000);
t('parseNumBR 980,10', C.parseNumBR('980,10') === 980.1);
t('parseNumBR R$', C.parseNumBR('R$ 1.234,56') === 1234.56);
t('parseNumBR int', C.parseNumBR('120') === 120);
t('fmtMoeda', C.fmtMoeda(1234.56).replace(/ /g, ' ') === 'R$ 1.234,56');
t('fmtMoeda zero', C.fmtMoeda(0).replace(/ /g, ' ') === 'R$ 0,00');

// csv
const csv = fs.readFileSync(__dirname + '/../amostras/relatorio-exemplo.csv', 'utf8');
t('separador ;', C.detectaSeparador(csv) === ';');
const linhas = C.parseCSV(csv);
t('6 linhas (cab + 5)', linhas.length === 6);
t('16 colunas', linhas[0].length === 16);
t('aspas removidas', linhas[0][5] === 'PO');
t('csv com vírgula', C.parseCSV('a,b\n"x, y",2').length === 2 && C.parseCSV('a,b\n"x, y",2')[1][0] === 'x, y');
t('csv aspas duplas', C.parseCSV('a;b\n"di""z";2')[1][0] === 'di"z');

// cabeçalhos
const cas = C.casarCabecalhos(linhas[0], {}, [], []);
t('casou po', cas.porCampo.po === 5);
t('casou limite', cas.porCampo.limite === 14);
t('sem desconhecidos', cas.desconhecidos.length === 0);
t('sem faltando', cas.faltando.length === 0);
const cas2 = C.casarCabecalhos(['PO', 'Fornecedor', 'Delivery Time', 'Coluna Nova'], {}, [], []);
t('detecta coluna nova', cas2.desconhecidos.length === 1 && cas2.desconhecidos[0].cab === 'Coluna Nova');
const cas3 = C.casarCabecalhos(['PO', 'Fornecedor', 'Delivery Time', 'Coluna Nova'], {}, [{ k: 'nova', nome: 'Nova', cabecalho: 'Coluna Nova' }], []);
t('extra casada', cas3.porCampo['x:nova'] === 3 && cas3.desconhecidos.length === 0);
const cas4 = C.casarCabecalhos(['PO', 'Fornecedor', 'Delivery Time', 'Coluna Nova'], {}, [], ['Coluna Nova']);
t('ignorada', cas4.desconhecidos.length === 0);
const cas5 = C.casarCabecalhos(['Pedido', 'Fornecedor', 'Delivery Time'], { po: 'Pedido' }, [], []);
t('mapeamento custom', cas5.porCampo.po === 0);
t('faltando po', C.casarCabecalhos(['Fornecedor'], {}, [], []).faltando.includes('po'));

// linha -> pedido
const imp = linhas.slice(1).map(l => C.linhaParaPedido(l, cas.porCampo, '2026-09-18'));
t('po', imp[0].po === '900001');
t('tipo normalizado', imp[0].tipo === 'now_crossdocking');
t('time normalizado', imp[1].time === 'textil');
t('valor', imp[1].valor === 1234.56);
t('qtd', imp[0].qtd === 120);
t('limite', imp[0].limite === '2026-10-07');
t('envio', imp[0].envio === '2026-09-16');

// status
const hoje = '2026-09-18';
t('status atrasado', C.statusDe({ limite: '2026-09-17' }, hoje) === 'atrasado');
t('status vence hoje', C.statusDe({ limite: '2026-09-18' }, hoje) === 'vence');
t('status vence em 2', C.statusDe({ limite: '2026-09-20' }, hoje) === 'vence');
t('status andamento', C.statusDe({ limite: '2026-09-21' }, hoje) === 'andamento');
t('status finalizado ganha', C.statusDe({ limite: '2026-09-01', finalizacao: '2026-09-10' }, hoje) === 'finalizado');
t('antecedencia 0', C.statusDe({ limite: '2026-09-19' }, hoje, 0) === 'andamento');

// mesclar
const ex = [Object.assign(C.pedidoVazio(), { po: '900001', fornecedor: 'FORNECEDOR EXEMPLO ALFA LTDA', qtd: 100, limite: '2026-10-07', obs: 'Agendado 20/09', acao: 'Agendado', dataAcao: '2026-09-20' })];
const m = C.mesclarImportacao(ex, imp, hoje);
t('4 novos', m.novos.length === 4);
t('1 atualizado (qtd 100→120)', m.atualizados.length === 1 && m.atualizados[0].mudancas.some(x => x.k === 'qtd'));
t('obs preservada', m.pedidos.find(p => p.po === '900001').obs === 'Agendado 20/09');
t('update marcado', m.pedidos.find(p => p.po === '900001').update === hoje);
t('total 5', m.pedidos.length === 5);
t('sem avisos de data (regra bate)', m.avisos.filter(a => /difere/.test(a.msg)).length === 0);
const m2 = C.mesclarImportacao(m.pedidos.map(p => Object.assign({}, p)), imp, hoje);
t('reimport igual', m2.novos.length === 0 && m2.atualizados.length === 0 && m2.iguais === 5);
const impF = imp.map(p => Object.assign({}, p)); impF[0].fornecedor = 'OUTRO';
const m3 = C.mesclarImportacao(m.pedidos.map(p => Object.assign({}, p)), impF, hoje);
t('aviso fornecedor mudou', m3.avisos.some(a => /Fornecedor mudou/.test(a.msg)));
const impD = [Object.assign(C.pedidoVazio(), { po: 'X1', fornecedor: 'F', envio: '2026-09-16', leadWms: 15, limite: '2026-10-08' })];
t('aviso data difere', C.mesclarImportacao([], impD, hoje).avisos.some(a => /difere/.test(a.msg)));
const impS = [Object.assign(C.pedidoVazio(), { po: 'X2', fornecedor: 'F', envio: '2026-09-16', leadWms: 15, limite: '' })];
t('data calculada quando falta', C.mesclarImportacao([], impS, hoje).pedidos[0].limite === '2026-10-07');

// saldo
t('saldo', C.saldo({ qtd: 99, qtdEntregue: 56 }) === 43);
t('temSaldo', C.temSaldo({ qtd: 99, qtdEntregue: 56 }) && !C.temSaldo({ qtd: 99, qtdEntregue: 0 }) && !C.temSaldo({ qtd: 99, qtdEntregue: 99 }));

// remessa
t('remessa padrão 1', C.remessaDe(C.pedidoVazio()) === '1' && C.remessaDe({}) === '1');
t('remessa 2', C.remessaDe({ remessa: '2' }) === '2' && C.remessaDe({ remessa: 2 }) === '2');
t('filtro remessa 1 exclui 2', C.filtrar([{ po: 'a', remessa: '2', limite: '2026-10-01' }, { po: 'b', limite: '2026-10-01' }], { remessa: '1' }, { hoje }).length === 1);
t('filtro remessa todas', C.filtrar([{ po: 'a', remessa: '2', limite: '2026-10-01' }, { po: 'b', limite: '2026-10-01' }], { remessa: 'todas' }, { hoje }).length === 2);
t('e-mail marca 2ª remessa', /2ª remessa, saldo 43/.test(C.textoResumo([{ po: 'z', fornecedor: 'F', limite: '2026-09-01', qtd: 99, qtdEntregue: 56, remessa: '2' }], {}, hoje).corpo));
t('export remessa legível', /2ª remessa/.test(C.exportarCSV([{ po: 'z', remessa: '2' }], ['po', 'remessa'], { hoje })));
t('tag padrão usa código do relatório', C.TAGS_PADRAO.find(x => x.id === 'tipo:now_crossdocking').nome === 'now_crossdocking');
t('time é coluna padrão', C.CONFIG_PADRAO.colunasVisiveis.includes('time'));
t('leadBob oculto', C.CAMPO.leadBob.oculto === true);

// filtrar / ordenar
const todos = m.pedidos;
t('filtro abertos', C.filtrar(todos, { status: 'abertos' }, { hoje }).length === 5);
t('filtro atrasado', C.filtrar(todos, { status: 'atrasado' }, { hoje }).length === 2);
t('filtro busca', C.filtrar(todos, { busca: 'gama' }, { hoje }).length === 1);
t('filtro tipo', C.filtrar(todos, { tipo: 'now_pre_buy' }, { hoje }).length === 1);
t('filtro período', C.filtrar(todos, { periodo: { de: '2026-09-18', ate: '2026-09-30' } }, { hoje }).length === 2);
const ord = C.ordenar(todos, 'limite', 'asc', { hoje });
t('ordem limite asc', ord[0].limite <= ord[1].limite && ord[3].limite <= ord[4].limite);
const ordS = C.ordenar(todos, 'status', 'asc', { hoje });
t('ordem status atrasado primeiro', C.statusDe(ordS[0], hoje) === 'atrasado');

// resumo / texto
const r = C.resumo(todos, hoje);
t('resumo atrasados 2', r.atrasados.length === 2);
t('resumo andamento 3', r.andamento.length === 3);
t('resumo acoesHoje 0', r.acoesHoje.length === 0);
todos[0].dataAcao = hoje;
const tx = C.textoResumo(todos, { antecedencia: 2, linkApp: 'https://x' }, hoje);
t('assunto', tx.assunto.startsWith('Pedidos · sex 18/09 · 2 atrasados'));
t('corpo tem ATRASADOS', /ATRASADOS \(2\)/.test(tx.corpo));
t('corpo tem ação', /AÇÕES DE HOJE \(1\)/.test(tx.corpo));
t('corpo link', /Abrir o app/.test(tx.corpo));
t('vazio', C.textoResumo([], {}, hoje).vazio === true);

// exportar
const csvOut = C.exportarCSV(todos, ['po', 'status', 'limite', 'valor', 'saldo'], { hoje });
t('export BR data', /07\/10\/2026/.test(csvOut));
t('export BR valor', /8450,00/.test(csvOut));
t('export status nome', /Atrasado/.test(csvOut));
t('export sep ;', csvOut.replace(/^\uFEFF/, '').split('\r\n')[0] === 'PO;Status;Data limite;Valor;Saldo');

// agrupar
const g = C.agrupar(todos, 'time', 'pedidos');
t('agrupar time', g.find(x => x.chave === 'decor').valor === 2);
t('agrupar valor', C.agrupar(todos, 'fornecedor', 'valor')[0].valor === 15000);

// fornecedor
t('acharFornecedor alias', C.acharFornecedor('MOVEIS DELTA LTDA - 000300', [{ nome: 'Moveis Delta', aliases: 'MOVEIS DELTA LTDA - 000300|Delta' }]) !== null);
t('acharFornecedor null', C.acharFornecedor('zzz', []) === null);

console.log(ok + ' ok, ' + falhas.length + ' falhas' + (falhas.length ? ':\n  ' + falhas.join('\n  ') : ''));
process.exit(falhas.length ? 1 : 0);
