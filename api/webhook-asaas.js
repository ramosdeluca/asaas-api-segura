const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CREDITOS_MENSAIS = 1000; // minutos do plano

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Apenas POST é permitido' });
  }

  const { event, payment, subscription } = req.body;

  if (!event) {
    return res.status(400).json({ error: 'Evento inválido' });
  }

  try {
    // =================================================
    // 🔴 CANCELAMENTO — PRIORIDADE ABSOLUTA
    // =================================================
    if (event === 'SUBSCRIPTION_INACTIVATED') {
      const subscriptionId =
        subscription?.id || payment?.subscription;

      if (!subscriptionId) {
        return res.status(200).send('OK');
      }

      await supabase
        .from('profiles')
        .update({
          subscription_status: 'CANCELLED',
          credits_total: 0,
          credits_remaining: 0
        })
        .eq('subscription', subscriptionId);

      return res.status(200).send('OK');
    }

    // =================================================
    // EVENTOS SEM PAYMENT
    // =================================================
    if (!payment?.id) {
      return res.status(200).send('OK');
    }

    // Busca pagamento atual
    const { data: pagamentoAtual } = await supabase
      .from('payments')
      .select('status, processed, type')
      .eq('asaas_id', payment.id)
      .single();

    if (!pagamentoAtual) {
      return res.status(200).send('OK');
    }

    // =================================================
    // 🟡 DEFINE O TIPO DO PAGAMENTO (O QUE FALTAVA)
    // =================================================
    const tipoPagamento = payment.subscription
      ? 'SUBSCRIPTION'
      : 'ONE_TIME';

    if (!pagamentoAtual.type) {
      await supabase
        .from('payments')
        .update({ type: tipoPagamento })
        .eq('asaas_id', payment.id);
    }

    // =================================================
    // ATUALIZA STATUS
    // =================================================
    let novoStatus = pagamentoAtual.status;

    if (event === 'PAYMENT_CONFIRMED') {
      novoStatus = 'RECEIVED';
    }

    if (event === 'PAYMENT_RECEIVED') {
      novoStatus = 'RECEIVED';
    }

    if (event === 'PAYMENT_OVERDUE') {
      novoStatus = 'SUSPENDED';
    }

    if (event === 'PAYMENT_REFUNDED') {
      novoStatus = 'CANCELLED';
    }

    if (novoStatus !== pagamentoAtual.status) {
      await supabase
        .from('payments')
        .update({ status: novoStatus })
        .eq('asaas_id', payment.id);
    }

    // =================================================
    // ASSINATURA → RESET DE CRÉDITOS
    // =================================================
    if (
      event === 'PAYMENT_RECEIVED' &&
      payment.subscription &&
      pagamentoAtual.processed === false
    ) {
      const inicioCiclo = new Date();
      const fimCiclo = payment.dueDate
        ? new Date(payment.dueDate + 'T23:59:59')
        : null;

      await supabase
        .from('profiles')
        .update({
          subscription_status: 'ACTIVE',
          credits_total: CREDITOS_MENSAIS,
          credits_remaining: CREDITOS_MENSAIS,
          current_period_start: inicioCiclo.toISOString(),
          current_period_end: fimCiclo ? fimCiclo.toISOString() : null
        })
        .eq('subscription', payment.subscription);
    }

    return res.status(200).send('OK');

  } catch (err) {
    console.error('[ASAAS] Erro no webhook:', err);
    return res.status(500).send('Erro interno');
  }
};
