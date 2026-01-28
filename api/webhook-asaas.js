const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🔧 REGRAS DE NEGÓCIO
const CREDITOS_MENSAIS = 1800;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Apenas POST é permitido' });
  }

  const { event, payment, subscription } = req.body;

  if (!event) {
    return res.status(400).json({ error: 'Evento inválido' });
  }

  console.log(`[ASAAS] Evento recebido: ${event}`);

  try {
    // =================================================
    // 🔴 0️⃣ CANCELAMENTO TEM PRIORIDADE ABSOLUTA
    // =================================================
    if (event === 'SUBSCRIPTION_INACTIVATED') {
      const subscriptionId =
        subscription?.id || payment?.subscription;

      if (!subscriptionId) {
        console.warn('[ASAAS] Cancelamento sem subscription id');
        return res.status(200).send('OK');
      }

      await supabase
        .from('profiles')
        .update({
          subscription_status: 'CANCELLED',
          credits_remaining: 0
        })
        .eq('subscription', subscriptionId);

      console.log(`[ASAAS] Assinatura ${subscriptionId} CANCELADA`);

      return res.status(200).send('OK');
    }

    // =================================================
    // 1️⃣ EVENTOS DE PAGAMENTO (EXIGEM payment.id)
    // =================================================
    if (!payment?.id) {
      return res.status(200).send('OK');
    }

    // Busca pagamento atual (idempotência por payment.id)
    const { data: pagamentoAtual, error: fetchError } = await supabase
      .from('payments')
      .select('status, paid_at')
      .eq('asaas_id', payment.id)
      .single();

    if (fetchError || !pagamentoAtual) {
      console.warn('[ASAAS] Pagamento não encontrado:', payment.id);
      return res.status(200).send('OK');
    }

    // =================================================
    // 2️⃣ ATUALIZA STATUS DO PAGAMENTO
    // =================================================
    let novoStatusPagamento = pagamentoAtual.status;
    let marcarComoPago = false;

    if (event === 'PAYMENT_CONFIRMED') {
      novoStatusPagamento = 'RECEIVED';
    }

    if (event === 'PAYMENT_RECEIVED') {
      novoStatusPagamento = 'RECEIVED';
      marcarComoPago = true;
    }

    if (event === 'PAYMENT_OVERDUE') {
      novoStatusPagamento = 'SUSPENDED';
    }

    if (event === 'PAYMENT_REFUNDED') {
      novoStatusPagamento = 'CANCELLED';
    }

    if (
      novoStatusPagamento !== pagamentoAtual.status ||
      (marcarComoPago && !pagamentoAtual.paid_at)
    ) {
      await supabase
        .from('payments')
        .update({
          status: novoStatusPagamento,
          paid_at:
            marcarComoPago && !pagamentoAtual.paid_at
              ? new Date().toISOString()
              : pagamentoAtual.paid_at
        })
        .eq('asaas_id', payment.id);
    }

    // =================================================
    // 3️⃣ RENOVA CICLO E CRÉDITOS (SÓ NO RECEIVED)
    // =================================================
    if (
      event === 'PAYMENT_RECEIVED' &&
      payment.subscription &&
      !pagamentoAtual.paid_at
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

      console.log(
        `[ASAAS] Ciclo renovado para assinatura ${payment.subscription}`
      );
    }

    // =================================================
    // 4️⃣ INADIMPLÊNCIA → SUSPENDE ASSINATURA
    // =================================================
    if (event === 'PAYMENT_OVERDUE' && payment.subscription) {
      await supabase
        .from('profiles')
        .update({
          subscription_status: 'SUSPENDED'
        })
        .eq('subscription', payment.subscription);

      console.log('[ASAAS] Assinatura SUSPENSA por inadimplência');
    }

    return res.status(200).send('OK');

  } catch (err) {
    console.error('[ASAAS] Erro no webhook:', err);
    return res.status(500).send('Erro interno');
  }
};
