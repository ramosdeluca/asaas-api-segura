// =================================================================
// ARQUIVO: api/processar-pagamento.js
// FUNÇÃO: Processa o pagamento PIX no Asaas, mantendo o token SEGURO
// =================================================================

const axios = require('axios');

// 🔑 Variáveis de Ambiente Seguras (Lidas do Vercel Settings)
const ASAAS_ACCESS_TOKEN = process.env.ASAAS_ACCESS_TOKEN;
const ASAAS_BASE_URL = 'https://api.asaas.com/v3';

// Headers obrigatórios em todas as chamadas para o Asaas
const asaasHeaders = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'access_token': ASAAS_ACCESS_TOKEN
};

/**
 * Função principal (Handler) que é exportada para o Vercel.
 * @param {object} req - Objeto de requisição (contém body).
 * @param {object} res - Objeto de resposta.
 */
async function processarPagamentoAsaas(req, res) {

    // 1. Verificação de Método HTTP
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    // 2. Verificação de Segurança (Token)
    if (!ASAAS_ACCESS_TOKEN) {
        console.error('ERRO CRÍTICO: ASAAS_ACCESS_TOKEN não configurado no Vercel.');
        return res.status(500).json({ error: 'Configuração do servidor incompleta. Verifique a variável de ambiente.' });
    }

    // 3. Extrair e validar dados do Frontend (req.body)
    const { 
        nomeCliente, 
        cpfCnpj, 
        emailCliente, 
        valorCreditos, 
        descricao = "Compra de créditos" 
    } = req.body;

    if (!nomeCliente || !cpfCnpj || !emailCliente || !valorCreditos || isNaN(valorCreditos)) {
        return res.status(400).json({ error: 'Dados incompletos ou valor de crédito inválido.' });
    }

    const today = new Date();
    // Vencimento do PIX para 3 dias
    const dueDate = new Date(today.setDate(today.getDate() + 3)).toISOString().split('T')[0];

    let customerId;

    try {
        // --- ETAPA 1: CRIAR OU REUTILIZAR CLIENTE ---
        console.log(`1. Tentando buscar ou criar cliente para CPF/CNPJ: ${cpfCnpj}`);
        
        const customerBody = {
            name: nomeCliente,
            cpfCnpj: cpfCnpj,
            email: emailCliente,
            notificationDisabled: true 
        };

        try {
            // Tenta criar (Se falhar por duplicidade, cai no catch interno)
            const customerResponse = await axios.post(`${ASAAS_BASE_URL}/customers`, customerBody, { headers: asaasHeaders });
            customerId = customerResponse.data.id;
            console.log(`Cliente criado com sucesso. ID: ${customerId}`);
        } catch (createError) {
             const errors = createError.response?.data?.errors;
             
             // Verifica se o erro é de duplicidade de CPF/CNPJ (código comum no Asaas: invalid_cpfCnpj)
             if (createError.response && createError.response.status === 400 && errors?.some(err => err.code === 'invalid_cpfCnpj')) {
                 console.log('Cliente já existe. Buscando cliente existente...');
                 
                 // Busca o cliente pelo CPF/CNPJ
                 const searchResponse = await axios.get(`${ASAAS_BASE_URL}/customers?cpfCnpj=${cpfCnpj}`, { headers: asaasHeaders });

                 if (searchResponse.data.data && searchResponse.data.data.length > 0) {
                    customerId = searchResponse.data.data[0].id;
                    console.log(`Cliente existente encontrado e ID capturado: ${customerId}`);
                 } else {
                     // Não conseguiu criar e nem encontrar, erro grave.
                     throw new Error('Erro ao criar/encontrar cliente no Asaas, CPF/CNPJ inválido ou sem cadastro.');
                 }
             } else {
                 // Outro erro de criação de cliente
                 throw createError;
             }
        }
    
        // --- ETAPA 2: CRIAR COBRANÇA PIX ---
        console.log('2. Criando cobrança PIX...');
        const paymentBody = {
            billingType: "PIX",
            customer: customerId,
            value: valorCreditos,
            dueDate: dueDate,
            description: descricao,
            anticipationDisabled: true 
        };

        const paymentResponse = await axios.post(`${ASAAS_BASE_URL}/payments`, paymentBody, { headers: asaasHeaders });
        const paymentId = paymentResponse.data.id;
        
        // --- ETAPA 3: RECUPERAR QR CODE PIX ---
        console.log('3. Recuperando QR Code PIX...');
        const pixQrCodeResponse = await axios.get(`${ASAAS_BASE_URL}/payments/${paymentId}/pixQrCode`, { headers: asaasHeaders });

        // Resposta de SUCESSO para o Frontend
        return res.status(200).json({
            status: 'success',
            paymentId: paymentId,
            customer: customerId,
            qrCode: pixQrCodeResponse.data.encodedImage, // base64 para exibir no <img>
            payload: pixQrCodeResponse.data.payload,       // Pix Copia e Cola
            expirationDate: pixQrCodeResponse.data.expirationDate
        });

    } catch (error) {
        // Loga o erro detalhado no console do Vercel
        console.error('ERRO NO FLUXO ASAAS:', error.message);
        
        // Se for um erro de resposta do Asaas, loga o detalhe
        if (error.response) {
            console.error('Resposta de Erro do Asaas:', error.response.data);
            return res.status(error.response.status).json({
                error: error.response.data.errors?.[0]?.description || 'Falha na comunicação com o Asaas.',
                details: error.response.data.errors
            });
        }
        
        // Retorna um erro 500 genérico e seguro
        return res.status(500).json({ error: 'Falha interna ao processar o PIX.' });
    }
}

// 💥 EXPORTAÇÃO CORRETA PARA O VERVEL
module.exports = processarPagamentoAsaas;