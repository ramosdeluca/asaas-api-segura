const { createClient } = require('@supabase/supabase-js');

// Conecta ao Supabase usando as variáveis de ambiente
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  // 1. O Asaas sempre envia via POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Apenas POST é permitido' });
  }

  // 2. Captura o evento e os dados do pagamento vindos do Asaas
  const { event, payment } = req.body;

  console.log(`Evento recebido: ${event} | ID Pagamento: ${payment.id}`);

  // 3. Define a lógica de conversão de status
  const eventosSucesso = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'];
  const eventosFalha = ['PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED'];

  try {
    let novoStatus = null;

    if (eventosSucesso.includes(event)) {
      novoStatus = 'RECEIVED';
    } else if (eventosFalha.includes(event)) {
      novoStatus = 'CANCELLED';
    }

    // 4. Se for um evento que queremos tratar, atualizamos a tabela
    if (novoStatus) {
      const { data, error } = await supabase
        .from('payments')
        .update({ status: novoStatus })
        .eq('asaas_id', payment.id); // Encontra a linha pelo asaas_id

      if (error) {
        console.error('Erro ao atualizar Supabase:', error.message);
        return res.status(500).json({ error: 'Erro no banco de dados' });
      }

      console.log(`Pagamento ${payment.id} atualizado com sucesso no Supabase para: ${novoStatus}`);
    }

    // 5. Avisa o Asaas que recebemos a mensagem com sucesso
    return res.status(200).send('OK');

  } catch (err) {
    console.error('Erro no processamento:', err.message);
    return res.status(500).send('Erro interno');
  }
};