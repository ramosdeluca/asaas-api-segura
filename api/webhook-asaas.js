const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🔧 REGRAS DE NEGÓCIO
const CREDITOS_MENSAIS = 1000;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Apenas POST é permitido' });
  }

  const { event, payment } = req.body;

  if (!event || !payment?.id) {
    return res.status(400).json({ error: 'Payload inválido' });
  }

  console.log(`[ASAAS] Evento: ${event} | Payment: ${payment.id}`);

  try {
    // =================================================
    // 1️⃣ BUSCA PAGAMENTO ATUAL (IDEMPOTÊNCIA)
    // =================================================
    const { data: pagamentoAtual, error: fetchError } = await supabase
      .from('payments')
      .select('status, paid_at')
      .eq('asaas_id', payment.id)
      .single();

    if (fetchError) {
      console.error('[ASAAS] Pagamento não encontrado:', fetchError.message);
      return res.status(404).send('Pagamento não encontrado');
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

    if (novoStatusPagamento !== pagamentoAtual.status || marcarComoPago) {
      await supabase
        .from('payments')
        .update({
          status: novoStatusPagamento,
          paid_at: marcarComoPago && !pagamentoAtual.paid_at
            ? new Date().toISOString()
            : pagamentoAtual.paid_at
        })
        .eq('asaas_id', payment.id);
    }

    // =================================================
    // 3️⃣ RENOVA CICLO E CRÉDITOS (SÓ UMA VEZ)
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

      console.log(`[ASAAS] Ciclo renovado com sucesso`);
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

      console.log('[ASAAS] Assinatura suspensa por inadimplência');
    }

    // =================================================
    // 5️⃣ CANCELAMENTO DEFINITIVO
    // =================================================
    if (event === 'SUBSCRIPTION_INACTIVATED' && payment.subscription) {
      await supabase
        .from('profiles')
        .update({
          subscription_status: 'CANCELLED',
          credits_remaining: 0
        })
        .eq('subscription', payment.subscription);

      console.log('[ASAAS] Assinatura cancelada');
    }

    return res.status(200).send('OK');

  } catch (err) {
    console.error('[ASAAS] Erro no webhook:', err);
    return res.status(500).send('Erro interno');
  }
};
