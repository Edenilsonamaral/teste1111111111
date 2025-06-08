import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { useLocalData } from '../contexts/SupabaseContext';
import { Client, Loan, Payment } from '../types';
import { format } from 'date-fns';
import { gerarRecibo } from '../utils/reciboGenerator';

export default function LoanDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { clients, loans, receipts, payments, deleteReceipt, updateLoan, addReceipt, addPayment, refetchLoans } = useLocalData();
  
  const [client, setClient] = useState<Client | null>(null);
  const [loan, setLoan] = useState<Loan | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState<number>(1);
  const [paymentAmount, setPaymentAmount] = useState<string>(''); // Inicializa como string vazia
  const [showDeleteReceiptModal, setShowDeleteReceiptModal] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      const foundLoan = loans.find(l => l.id === id);
      if (foundLoan) {
        setLoan(foundLoan);
        const foundClient = clients.find(c => c.id === foundLoan.clientId);
        if (foundClient) setClient(foundClient);

        // Corrige a lógica de status para todas as modalidades
        let newStatus = foundLoan.status;
        const today = new Date();
        const dueDate = new Date(foundLoan.dueDate);

        // Soma todos os recibos do empréstimo para considerar pagamentos confirmados
        const recibosDoEmprestimo = receipts.filter(r => r.loanId === foundLoan.id);
        const totalPagoRecibos = recibosDoEmprestimo.reduce((sum, r) => sum + (r.amount || 0), 0);

        if (foundLoan.paymentType === 'diario') {
          // Corrige: considera recibos confirmados para status concluído
          const totalParcelas = foundLoan.installments || foundLoan.numberOfInstallments || 0;
          const recibosPagos = receipts.filter(r => r.loanId === foundLoan.id).length;
          const hasQuitacao = foundLoan.payments?.some(p => p.type === 'full');
          if (hasQuitacao || (totalParcelas > 0 && recibosPagos >= totalParcelas)) {
            newStatus = 'completed';
          } else if (today > dueDate) {
            newStatus = 'defaulted';
          } else {
            newStatus = 'active';
          }
        } else if (foundLoan.paymentType === 'interest_only') {
          // Busca pagamentos do contexto global para este empréstimo
          const pagamentosDoEmprestimo = payments.filter(p => p.loanId === foundLoan.id);
          const hasFullPayment = pagamentosDoEmprestimo.some(p => p.type === 'full' && p.amount >= foundLoan.totalAmount);
          if (hasFullPayment) {
            newStatus = 'completed';
          } else if (today > dueDate) {
            newStatus = 'defaulted';
          } else {
            newStatus = 'active';
          }
        } else {
          // Modalidade parcelada: conclui se soma dos recibos (pagamentos confirmados) >= totalAmount
          if (totalPagoRecibos >= foundLoan.totalAmount) {
            newStatus = 'completed';
          } else if (today > dueDate) {
            newStatus = 'defaulted';
          } else {
            newStatus = 'active';
          }
        }

        if (newStatus !== foundLoan.status) {
          updateLoan(foundLoan.id, { status: newStatus });
          setLoan({ ...foundLoan, status: newStatus });
        }
      } else {
        navigate('/loans');
      }
    }
  }, [id, loans, clients, receipts, navigate]);

  const handlePayment = async () => {
    if (!loan || !client) return;

    try {
      let paymentTypeField = 'interest_only';
      let selectedType = 'interest_only';

      if (loan.paymentType === 'diario') {
        const parcelaValor = Number(paymentAmount);
        if (parcelaValor > 0) {
          const totalParcelas = Math.ceil(loan.totalAmount / parcelaValor);
          loan.installments = totalParcelas;
          loan.installmentAmount = parcelaValor;
        }
      } else if (loan.paymentType === 'interest_only') {
        selectedType = paymentAmount && Number(paymentAmount) >= loan.totalAmount ? 'full' : 'interest_only';
        if (selectedType === 'full') paymentTypeField = 'full';
      } else if (loan.paymentType === 'installments') {
        paymentTypeField = 'full';
      }

      // Monta objeto para salvar no Supabase
      const paymentToSave = {
        loanId: loan.id,
        amount: Number(paymentAmount),
        date: new Date().toISOString(),
        installmentNumber: selectedInstallment,
        type: paymentTypeField as 'interest_only' | 'full',
      };
      // Salva pagamento no Supabase e obtém UUID real
      const savedPayment = await addPayment(paymentToSave);
      if (!savedPayment) throw new Error('Erro ao registrar pagamento no Supabase.');

      // Atualiza pagamentos localmente
      const updatedPayments = [...(loan.payments || []), savedPayment];
      let isCompleted = false;
      if (loan.paymentType === 'diario') {
        const totalParcelas = loan.installments || loan.numberOfInstallments || 0;
        const recibosPagos = receipts.filter(r => r.loanId === loan.id).length;
        const hasQuitacao = updatedPayments.some(p => p.type === 'full');
        isCompleted = hasQuitacao || (totalParcelas > 0 && recibosPagos >= totalParcelas);
      } else if (loan.paymentType === 'interest_only') {
        // Se houver qualquer pagamento do tipo 'full', conclui o empréstimo
        isCompleted = updatedPayments.some(p => p.type === 'full');
        // Garantia extra: se o pagamento salvo for 'full', já marca como concluído
        if (savedPayment.type === 'full') {
          isCompleted = true;
        }
      } else {
        const totalParcelas = loan.installments || loan.numberOfInstallments || 0;
        const totalPago = updatedPayments.reduce((sum, p) => sum + p.amount, 0);
        isCompleted = (totalParcelas > 0 && updatedPayments.length >= totalParcelas) || (totalPago >= loan.totalAmount);
      }
      // Atualiza status imediatamente após pagamento
      const result = await updateLoan(loan.id, {
        status: isCompleted ? 'completed' : 'active',
        installments: loan.installments,
        installmentAmount: loan.installmentAmount,
      });
      if (result) {
        setLoan(result); // Atualiza o estado local imediatamente
        if (typeof refetchLoans === 'function') {
          await refetchLoans();
        }
        // Força recarregamento do empréstimo atualizado
        const updatedLoan = loans.find(l => l.id === loan.id);
        if (updatedLoan) {
          setLoan(updatedLoan);
        }
      } else {
        // alert('Falha ao atualizar status do empréstimo!');
      }

      // Gera recibo usando o UUID real do pagamento e valor pago confirmado atualizado
      const totalPagoConfirmado = updatedPayments.reduce((sum, p) => sum + p.amount, 0);
      await generateReceipt(savedPayment, totalPagoConfirmado);
      setShowPaymentModal(false);
      setPaymentAmount('');
      setSelectedInstallment(1);
    } catch (error) {
      console.error('Error processing payment:', error);
    }
  };

  // Ajuste: recebe totalPagoConfirmado como parâmetro
  const generateReceipt = async (payment: Payment, totalPagoConfirmado?: number) => {
    if (!loan || !client) return;
    const pagamentos = loan.payments ? [...loan.payments, payment] : [payment];
    const pagoConfirmado = typeof totalPagoConfirmado === 'number'
      ? totalPagoConfirmado
      : pagamentos.reduce((sum, p) => sum + p.amount, 0);
    const receipt = {
      clientId: client.id,
      loanId: loan.id,
      paymentId: payment.id || Date.now().toString(),
      receiptNumber: `REC-${Math.floor(1000 + Math.random() * 9000)}`,
      date: new Date().toISOString(),
      amount: payment.amount,
      dueDate: loan.dueDate,
      createdAt: new Date().toISOString(),
      pagoConfirmado // campo extra para recibo
    };
    const result = await addReceipt(receipt);
    if (!result) {
      // alert('Erro ao gerar recibo! Verifique o console para detalhes.');
      console.error('Erro ao gerar recibo:', receipt);
    } else {
      // alert('Recibo gerado com sucesso!');
    }
  };

  const handleDeleteReceipt = async (receiptId: string) => {
    if (!loan) return;

    if (window.confirm('Tem certeza que deseja excluir este recibo? Esta ação não pode ser desfeita.')) {
      try {
        await deleteReceipt(receiptId); // Remove o recibo do banco de dados ou armazenamento local
        // alert('Recibo excluído com sucesso!');
      } catch (error) {
        console.error('Erro ao excluir recibo:', error);
        // alert('Erro ao excluir recibo. Tente novamente mais tarde.');
      }
    }
  };

  const handleViewReceipt = (payment: Payment) => {
    const receiptMessage = `RECIBO DE PAGAMENTO\n\n` +
      `Cliente: ${client?.name}\n` +
      `Data do Pagamento: ${format(new Date(payment.date), 'dd/MM/yyyy')}\n` +
      `Valor Pago: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(payment.amount)}\n` +
      `--------------------------\n` +
      `Obrigado por utilizar nossos serviços!`;

    alert(receiptMessage);
  };

  // Função para compartilhar recibo via WhatsApp
  function handleSendReceiptWhatsAppFromReceipt(receipt: any) {
    if (!client || !loan) return;
    let telefone = client.phone || '';
    telefone = telefone.replace(/\D/g, '');
    if (telefone.length >= 11 && telefone.startsWith('0')) {
      telefone = telefone.replace(/^0+/, '');
    }
    if (telefone.length === 11) {
      telefone = '55' + telefone;
    }
    if (telefone.length === 13 && telefone.startsWith('55') && telefone[4] === '0') {
      telefone = '55' + telefone.slice(5);
    }
    if (!/^\d{12,13}$/.test(telefone)) {
      alert('Telefone do cliente inválido! Informe no formato 67992825341, 067992825341 ou 5567992825341.');
      return;
    }

    // Descobre a parcela atual e total de parcelas, se aplicável
    let parcelaAtual: number | undefined = undefined;
    let totalParcelas: number | undefined = undefined;
    if (loan.paymentType === 'diario') {
      // Para diário, conta recibos confirmados
      const recibosPagos = receipts.filter(r => r.loanId === loan.id);
      parcelaAtual = recibosPagos.length;
      totalParcelas = loan.installments || loan.numberOfInstallments || 0;
    } else if (loan.installments && loan.installments > 1) {
      // Parcelado tradicional
      const pagamentoRecibo = loan.payments?.find(p => p.id === receipt.paymentId);
      parcelaAtual = pagamentoRecibo?.installmentNumber ?? (receipts.filter(r => r.loanId === loan.id).length);
      totalParcelas = loan.installments;
    }

    // Calcula o total pago confirmado para o recibo
    const recibosDoEmprestimo = receipts.filter(r => r.loanId === loan.id);
    const pagoConfirmado = recibosDoEmprestimo.reduce((sum, r) => sum + (r.amount || 0), 0);

    // Monta a mensagem do recibo conforme modelo solicitado
    const recibo = gerarRecibo({
      docNumero: receipt.receiptNumber,
      cliente: client.name,
      vencimento: loan.dueDate ? format(new Date(loan.dueDate + 'T00:00:00'), 'dd/MM/yyyy') : '-',
      valorPagoHoje: receipt.amount,
      parcelaAtual,
      totalParcelas,
      pagoConfirmado,
      dataGeracao: new Date(),
      dataPagamento: receipt.date ? new Date(receipt.date) : new Date(), // Corrigido para usar a data do pagamento
    });

    const link = `https://wa.me/${telefone}?text=${encodeURIComponent(recibo)}`;
    window.open(link, '_blank', 'noopener,noreferrer');
  }

  const handleSendReceiptWhatsApp = (payment: Payment) => {
    // Busca o telefone do cliente diretamente da lista de clientes pelo id SEMPRE
    let telefone = '';
    if (client?.id) {
      const found = clients.find(c => c.id === client.id);
      telefone = found?.phone || '';
    }
    telefone = telefone.replace(/\D/g, '');
    if (telefone.length >= 11 && telefone.startsWith('0')) {
      telefone = telefone.replace(/^0+/, '');
    }
    if (telefone.length === 11) {
      telefone = '55' + telefone;
    }
    if (telefone.length === 13 && telefone.startsWith('55') && telefone[4] === '0') {
      telefone = '55' + telefone.slice(5);
    }
    if (!/^\d{12,13}$/.test(telefone)) {
      alert('Telefone do cliente inválido! Informe no formato 67992825341, 067992825341 ou 5567992825341.');
      return;
    }

    if (!loan || !client) return;
    // Corrigido: considera todos os pagamentos confirmados
    const pagamentos = loan.payments || [];
    const parcelaAtual = pagamentos.length;
    const totalParcelas = loan.installments;
    const pagoConfirmado = pagamentos.reduce((sum, p) => sum + p.amount, 0);
    const recibo = gerarRecibo({
      docNumero: loan.id.slice(-4),
      cliente: client.name,
      vencimento: loan.dueDate ? format(new Date(loan.dueDate + 'T00:00:00'), 'dd/MM/yyyy') : '-',
      valorPagoHoje: payment.amount,
      parcelaAtual,
      totalParcelas,
      pagoConfirmado,
      dataGeracao: new Date(),
      dataPagamento: payment.date ? new Date(payment.date) : new Date(), // Corrigido para usar a data do pagamento
    });

    const link = `https://wa.me/${telefone}?text=${encodeURIComponent(recibo)}`;
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  // Remover variáveis não utilizadas para evitar avisos
  // const handleDeletePayment = async (paymentId: string) => {
  //   if (!loan) return;

  //   if (window.confirm('Tem certeza que deseja excluir este pagamento? Esta ação não pode ser desfeita.')) {
  //     try {
  //       const updatedPayments = loan.payments?.filter((p) => p.id !== paymentId) || [];
  //       await updateLoan(loan.id, { payments: updatedPayments });
  //       setLoan({ ...loan, payments: updatedPayments });
  //       alert('Pagamento excluído com sucesso!');
  //     } catch (error) {
  //       console.error('Erro ao excluir pagamento:', error);
  //       alert('Erro ao excluir pagamento. Tente novamente mais tarde.');
  //     }
  //   }
  // };

  if (!loan || !client) {
    return <div className="p-4 text-center">Carregando...</div>;
  }
  // Cálculo correto do total pago e saldo a receber
  const recibosDoEmprestimo = receipts.filter(r => loan && r.loanId === loan.id);
  const totalPagoConfirmado = recibosDoEmprestimo.reduce((sum, r) => sum + (r.amount || 0), 0);
  // Se for 'interest_only' e houver pagamento tipo 'full', saldo a receber é 0
  let saldoAReceber = loan.paymentType === 'interest_only'
    ? loan.totalAmount
    : loan.totalAmount - totalPagoConfirmado;
  if (loan.paymentType === 'interest_only' && loan.payments?.some(p => p.type === 'full')) {
    saldoAReceber = 0;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/loans')}
            className="text-gray-500 hover:text-gray-700 flex items-center focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 relative z-10"
          >
            <ArrowLeft size={20} className="mr-1" />
          </button>
          <h1 className="text-2xl font-bold">Empréstimo #{loan.id.slice(-4)}</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPaymentModal(true)}
            className="btn btn-primary"
            disabled={loan.status === 'completed'}
          >
            Registrar Pagamento
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Loan Details */}
        <div className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-medium mb-4">Detalhes do Empréstimo</h2>
          <div className="space-y-4">
            <div>
              <span className="text-gray-500">Cliente:</span>
              <p className="font-medium">{client.name}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-gray-500">Valor Principal:</span>
                <p className="font-medium">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(loan.amount)}
                </p>
              </div>
              <div>
                <span className="text-gray-500">Total com Juros:</span>
                <p className="font-medium">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(loan.totalAmount)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-gray-500">Taxa de Juros:</span>
                <p className="font-medium">{loan.interestRate}% ao mês</p>
              </div>
              <div>
                <span className="text-gray-500">Vencimento:</span>
                <p className="font-medium">{loan.dueDate ? format(new Date(loan.dueDate + 'T00:00:00'), 'dd/MM/yyyy') : '-'}</p>
              </div>
            </div>
            <div>
              <span className="text-gray-500">Status:</span>
              <span className={`ml-2 px-2 py-1 text-sm font-semibold rounded-full 
                ${loan.status === 'active' ? 'bg-green-100 text-green-800' : 
                  loan.status === 'completed' ? 'bg-blue-100 text-blue-800' : 
                  'bg-red-100 text-red-800'}`}
              >
                {loan.status === 'active' ? 'Ativo' : 
                  loan.status === 'completed' ? 'Concluído' : 'Atrasado'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Modalidade:</span>
              <p className="font-medium">
                {loan.paymentType === 'interest_only'
                  ? 'Somente Juros'
                  : loan.paymentType === 'diario'
                  ? 'Diário'
                  : `Parcelado em ${loan.numberOfInstallments || loan.installments || 0}x`}
              </p>
            </div>
            <div>
              <span className="text-gray-500">Parcelas:</span>
              <p className="font-medium">
                {(() => {
                  if (loan.paymentType === 'diario' && loan.payments && loan.payments.length > 0) {
                    // Agrupa pagamentos por valor
                    const pagamentosPorValor: Record<string, number> = {};
                    loan.payments.forEach(p => {
                      const valor = p.amount.toFixed(2);
                      pagamentosPorValor[valor] = (pagamentosPorValor[valor] || 0) + 1;
                    });
                    // Exibe agrupado, ex: '5 x R$ 10,00'
                    return Object.entries(pagamentosPorValor)
                      .map(([valor, qtd]) => `${qtd} x ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor))}`)
                      .join(' + ');
                  }
                  // Padrão para outras modalidades
                  const qtdParcelas = loan.installments || loan.numberOfInstallments;
                  let valorParcela = loan.installmentAmount;
                  if ((!valorParcela || valorParcela === 0) && qtdParcelas) {
                    valorParcela = loan.totalAmount / qtdParcelas;
                  }
                  return qtdParcelas && valorParcela
                    ? `${qtdParcelas} x ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorParcela)}`
                    : '-';
                })()}
              </p>
            </div>
            <div>
              <span className="text-gray-500">Observações:</span>
              <p className="font-medium whitespace-pre-line">{loan.notes || '-'}</p>
            </div>
          </div>
        </div>

        {/* Financial Summary */}
        <div className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-medium mb-4">Resumo Financeiro</h2>
          <div className="space-y-4">
            <div>
              <span className="text-gray-500">Total Pago:</span>
              <p className="text-xl font-semibold text-green-600">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalPagoConfirmado)}
              </p>
            </div>
            <div>
              <span className="text-gray-500">Saldo a Receber:</span>
              <p className="text-xl font-semibold text-purple-600">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(saldoAReceber)}
              </p>
            </div>
            <div>
              <span className="text-gray-500">Parcelas Pagas:</span>
              <p className="font-medium">{loan.payments?.length || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Histórico de Recibos */}
      <div className="mt-6 bg-white rounded-lg p-6 shadow-sm">
        <h2 className="text-lg font-medium mb-4">Histórico de Recibos</h2>
        {receipts && receipts.filter(r => r.loanId === loan.id).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nº Recibo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Valor</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {receipts.filter(r => r.loanId === loan.id).map((receipt) => (
                  <tr key={receipt.id}>
                    <td className="px-6 py-4 whitespace-nowrap">{receipt.receiptNumber}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{new Date(receipt.date).toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(receipt.amount)}</td>
                    <td className="px-6 py-4 whitespace-nowrap flex gap-2">
                      <button
                        onClick={() => navigate(`/receipts/${receipt.id}`)}
                        className="text-indigo-600 hover:text-indigo-900 mr-1"
                      >
                        Ver Detalhes
                      </button>
                      <button
                        onClick={() => handleSendReceiptWhatsAppFromReceipt(receipt)}
                        className="text-green-600 hover:text-green-900"
                      >
                        Enviar via WhatsApp
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-center text-gray-500">Nenhum recibo gerado</p>
        )}
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium mb-4">Registrar Pagamento</h3>
            <div className="space-y-4">
              {loan.paymentType === 'interest_only' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo de Pagamento
                  </label>
                  <select
                    className="form-select w-full"
                    value={selectedInstallment === 2 ? 'full' : 'interest_only'}
                    onChange={e => setSelectedInstallment(e.target.value === 'full' ? 2 : 1)}
                  >
                    <option value="interest_only">Juros</option>
                    <option value="full">Juros + Capital</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Valor do Pagamento
                </label>
                <input
                  type="number"
                  className="form-input w-full"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  min="0"
                  step="0.01"
                  placeholder="Digite o valor"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowPaymentModal(false)}
                className="btn bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  handlePayment();
                  setShowPaymentModal(false);
                }}
                className="btn btn-primary"
              >
                Confirmar Pagamento
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Botão Quitar Empréstimo para diário */}
      {loan.paymentType === 'diario' && loan.status === 'active' && (
        <div className="flex justify-end mt-4">
          <button
            className="btn btn-danger"
            onClick={() => {
              setPaymentAmount('');
              setShowPaymentModal(true);
              // O handlePayment já trata o pagamento como quitação se for necessário
            }}
          >
            Quitar Empréstimo
          </button>
        </div>
      )}

      {/* Delete Receipt Modal */}
      {showDeleteReceiptModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center mb-4">
              <AlertTriangle className="h-6 w-6 text-red-600 mr-2" />
              <h3 className="text-lg font-medium">Excluir Recibo</h3>
            </div>
            <p className="text-gray-500 mb-4">
              Tem certeza que deseja excluir este recibo? Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteReceiptModal(null)}
                className="btn bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteReceipt(showDeleteReceiptModal)}
                className="btn btn-danger"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}