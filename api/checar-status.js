// =================================================================
// ARQUIVO: api/checar-status.js
// FUNÇÃO: Checa o status de pagamento (PIX) no Asaas de forma segura.
// =================================================================

const axios = require('axios');

// 🔑 Variáveis de Ambiente Seguras (Reutilizadas do Vercel Settings)
const ASAAS_ACCESS_TOKEN = process.env.ASAAS_ACCESS_TOKEN;
const ASAAS_BASE_URL = 'https://api.asaas.com/v3';

// Headers obrigatórios
const asaasHeaders = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'access_token': ASAAS_ACCESS_TOKEN
};

/**
 * Endpoint para checar o status de um pagamento.
 * O frontend deve passar o paymentId como um parâmetro de query (ex: /api/checar-status?id=pay_xxxx)
 */
async function checarStatusPagamento(req, res) {

    // 1. Verificação de Método HTTP
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Método não permitido. Use GET.' });
    }

    // 2. Verificação de Segurança (Token)
    if (!ASAAS_ACCESS_TOKEN) {
        console.error('ERRO CRÍTICO: ASAAS_ACCESS_TOKEN não configurado.');
        return res.status(500).json({ error: 'Configuração do servidor incompleta.' });
    }

    // 3. Extrair o paymentId do frontend (usando query parameters)
    const paymentId = req.query.id;

    if (!paymentId) {
        return res.status(400).json({ error: 'ID do pagamento (paymentId) é obrigatório.' });
    }

    try {
        // --- ETAPA 1: CONSULTAR O STATUS DO PAGAMENTO NO ASAAS ---
        console.log(`Consultando status para Payment ID: ${paymentId}`);
        
        const response = await axios.get(`${ASAAS_BASE_URL}/payments/${paymentId}`, {
            headers: asaasHeaders
        });

        const status = response.data.status;
        const valor = response.data.value; // Informação útil

        let mensagemRetorno = "Pagamento ainda não identificado.";
        let sucesso = false;

        // --- ETAPA 2: LÓGICA DE VALIDAÇÃO ---
        
        if (status === 'RECEIVED' || status === 'CONFIRMED') {
            mensagemRetorno = "Pagamento identificado com sucesso! Créditos liberados.";
            sucesso = true;
            // ⚠️ NOTA: Em um sistema real, aqui você chamaria a lógica para LIBERAR os créditos no seu banco de dados.
        } 
        // Você pode adicionar outras verificações, como se o status for 'PENDING', 'OVERDUE', etc.

        // Resposta para o Frontend
        return res.status(200).json({
            statusAsaas: status,
            paymentId: paymentId,
            valor: valor,
            sucesso: sucesso,
            mensagem: mensagemRetorno
        });

    } catch (error) {
        console.error(`ERRO ao consultar pagamento ${paymentId}:`, error.message);
        
        // Se o Asaas retornar 404 (ID inexistente) ou 500, tratamos como erro
        if (error.response && error.response.status === 404) {
             return res.status(404).json({ error: 'ID de pagamento não encontrado no Asaas.' });
        }
        
        return res.status(500).json({ error: 'Falha interna ao consultar o status do pagamento.' });
    }
}

// 💥 EXPORTAÇÃO CORRETA PARA O VERVEL
module.exports = checarStatusPagamento;