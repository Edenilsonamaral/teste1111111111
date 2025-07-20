
import dayjs from 'dayjs';
import { useLocalData } from '../contexts/SupabaseContext';
import { useMemo } from 'react';
import type { Loan } from '../types';

export default function OverdueLoans() {
  // Função para buscar nome do cliente pelo clientId
  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    return client ? client.name : 'Cliente desconhecido';
  };
  const { clients, loans, payments } = useLocalData();
// ...restante do código permanece igual...


  // Função para saber se um empréstimo está inadimplente (vencido)
  function isOverdue(loan: Loan): boolean {
    if (loan.status !== 'active') return false;
    if (loan.paymentType === 'diario') {
      const start = loan.startDate ? dayjs(loan.startDate) : dayjs(loan.createdAt);
      const hoje = dayjs();
      const diasDecorridos = hoje.diff(start, 'day') + 1;
      const total = loan.installments || loan.numberOfInstallments || 0;
      // Verifica se existe ao menos uma parcela vencida e não paga
      for (let i = 0; i < Math.min(diasDecorridos, total); i++) {
        const venc = start.add(i, 'day');
        const foiPaga = payments.some(p => p.loanId === loan.id && p.installmentNumber === (i + 1));
        if ((venc.isBefore(hoje) || venc.isSame(hoje, 'day')) && !foiPaga) {
          return true;
        }
      }
      return false;
    } else {
      const hoje = dayjs();
      const foiPago = payments.some(p => p.loanId === loan.id);
      return !!loan.dueDate && hoje.isAfter(dayjs(loan.dueDate)) && !foiPago;
    }
  }

  // Lista todos os empréstimos inadimplentes individualmente
  const overdueLoans = useMemo(() => loans.filter(isOverdue), [loans, payments]);
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Empréstimos Vencidos</h1>
      {overdueLoans.length === 0 ? (
        <div>Nenhum empréstimo vencido encontrado.</div>
      ) : (
        <div className="space-y-6">
          {overdueLoans.map((loan) => {
            let parcelasVencidas = 0;
            let valorVencido = 0;
            if (loan.paymentType === 'diario') {
              const start = loan.startDate ? dayjs(loan.startDate) : dayjs(loan.createdAt);
              const total = loan.installments || loan.numberOfInstallments || 0;
              const hoje = dayjs();
              const diasVencidos = Math.min(hoje.diff(start, 'day') + 1, total);
              const pagas = payments.filter(p => p.loanId === loan.id && p.installmentNumber && p.installmentNumber <= diasVencidos).length;
              const vencidasNaoPagas = diasVencidos - pagas;
              parcelasVencidas = vencidasNaoPagas > 0 ? vencidasNaoPagas : 0;
              valorVencido = (loan.installmentAmount ? loan.installmentAmount : 0) * parcelasVencidas;
            } else if (loan.paymentType === 'installments') {
              const total = loan.installments || loan.numberOfInstallments || 0;
              const hoje = dayjs();
              const foiPago = payments.some(p => p.loanId === loan.id);
              if (!foiPago && loan.dueDate && hoje.isAfter(dayjs(loan.dueDate))) {
                parcelasVencidas = 1;
                valorVencido = loan.totalAmount ? loan.totalAmount : 0;
              }
            } else if (loan.paymentType === 'interest_only') {
              const foiPago = payments.some(p => p.loanId === loan.id && p.type === 'full');
              if (!foiPago && loan.dueDate && dayjs().isBefore(dayjs(loan.dueDate)) === false) {
                parcelasVencidas = 1;
                valorVencido = loan.totalAmount ? loan.totalAmount : 0;
              }
            } else {
              const foiPago = payments.some(p => p.loanId === loan.id);
              if (!foiPago && loan.dueDate && dayjs().isAfter(dayjs(loan.dueDate))) {
                valorVencido = loan.totalAmount ? loan.totalAmount : 0;
                parcelasVencidas = 1;
              }
            }
            return (
              <div key={loan.id} className="border rounded p-4 shadow-sm">
                <div className="font-semibold text-lg mb-1">{getClientName(loan.clientId)}</div>
                <div className="text-sm text-gray-600 mb-1">Modalidade: {loan.paymentType === 'diario' ? 'Diário' : loan.paymentType === 'installments' ? 'Parcelado' : loan.paymentType === 'interest_only' ? 'Somente Juros' : 'Outro'}</div>
                <div className="text-sm text-gray-600 mb-1">Valor original: {loan.amount?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
                <div className="text-sm text-gray-600 mb-1">Total de parcelas vencidas: {parcelasVencidas}</div>
                <div className="text-sm text-gray-600 mb-1">Valor total vencido: {valorVencido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
                <div className="text-sm text-gray-600">Data início: {loan.startDate ? dayjs(loan.startDate).format('DD/MM/YYYY') : (loan.createdAt ? dayjs(loan.createdAt).format('DD/MM/YYYY') : '-')}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}