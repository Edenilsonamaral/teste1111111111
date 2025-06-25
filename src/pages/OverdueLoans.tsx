import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import dayjs from 'dayjs';
import { useLocalData } from '../contexts/SupabaseContext';

interface Loan {
  id: string;
  clientId: string;
  dueDate: string;
  amount: number;
  totalAmount?: number; // ADICIONADO
  status: string;
}

export default function OverdueLoans() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [debugInadimplentes, setDebugInadimplentes] = useState<any[]>([]);
  const { clients } = useLocalData();

  useEffect(() => {
    async function fetchOverdueLoans() {
      setLoading(true);
      // Busca todos inadimplentes (status defaulted)
      const { data, error } = await supabase
        .from('loans')
        .select('*')
        .eq('status', 'defaulted');
      if (error) {
        console.error('Erro ao buscar inadimplentes:', error);
      }
      // Mapeia os campos para camelCase
      const mapped = (data || []).map((loan: any) => ({
        id: loan.id,
        clientId: loan.client_id,
        dueDate: loan.due_date,
        amount: loan.amount,
        totalAmount: loan.total_amount, // ADICIONADO
        status: loan.status,
      }));
      setLoans(mapped);
      setDebugInadimplentes(mapped); // debug usa o mesmo array já mapeado
      setLoading(false);
    }
    fetchOverdueLoans();
  }, []);

  // Função para buscar nome do cliente pelo clientId
  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    return client ? client.name : 'Cliente desconhecido';
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Empréstimos Vencidos</h1>
      {/* DEBUG: Exibe inadimplentes encontrados */}
      {/* <pre style={{background:'#eee',padding:'8px',marginBottom:'16px',maxHeight:'200px',overflow:'auto'}}>
        {JSON.stringify(debugInadimplentes, null, 2)}
      </pre> */}
      {loading ? (
        <div>Carregando...</div>
      ) : loans.length === 0 ? (
        <div>Nenhum empréstimo vencido encontrado.</div>
      ) : (
        <table className="min-w-full bg-white border">
          <thead>
            <tr>
              <th className="px-4 py-2 border">Cliente</th>
              <th className="px-4 py-2 border">Data de Vencimento</th>
              <th className="px-4 py-2 border">Valor</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((loan) => (
              <tr key={loan.id}>
                <td className="px-4 py-2 border">{getClientName(loan.clientId)}</td>
                <td className="px-4 py-2 border">{dayjs(loan.dueDate).format('DD/MM/YYYY')}</td>
                <td className="px-4 py-2 border">R$ {loan.totalAmount?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* Bloco de debug removido */}
    </div>
  );
}
