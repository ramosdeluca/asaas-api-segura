// =================================================================
// ARQUIVO: api/processar-pagamento.js
// =================================================================

const axios = require('axios');

const ASAAS_ACCESS_TOKEN = process.env.ASAAS_ACCESS_TOKEN;
const ASAAS_BASE_URL = 'https://api.asaas.com/v3';

const asaasHeaders = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'access_token': ASAAS_ACCESS_TOKEN
};

async function processarPagamentoAsaas(req, res) {

    // --- ALTERAÇÃO 1: ADICIONAR HEADERS DE CORS ---
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // --- ALTERAÇÃO 2: TRATAR REQUISIÇÃO 'OPTIONS' (PREFLIGHT) ---
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    if (!ASAAS_ACCESS_TOKEN) {
        console.error('ERRO CRÍTICO: ASAAS_ACCESS_TOKEN não configurado no Vercel.');
        return res.status(500).json({ error: 'Configuração do servidor incompleta.' });
    }

    // --- ALTERAÇÃO 3: ADICIONAR userId E minutes (PARA O SEU SUPABASE) ---
    const { 
        nomeCliente, 
        cpfCnpj, 
        emailCliente, 
        valorCreditos, 
        descricao = "Compra de créditos",
        userId,   // <--- Adicionado aqui
        minutes   // <--- Adicionado aqui
    } = req.body;

    if (!nomeCliente || !cpfCnpj || !emailCliente || !valorCreditos || isNaN(valorCreditos)) {
        return res.status(400).json({ error: 'Dados incompletos ou valor de crédito inválido.' });
    }

    const today = new Date();
    const dueDate = new Date(today.setDate(today.getDate() + 3)).toISOString().split('T')[0];

    let customerId;

    try {
        console.log(`1. Tentando buscar ou criar cliente para CPF/CNPJ: ${cpfCnpj}`);
        
        const customerBody = {
            name: nomeCliente,
            cpfCnpj: cpfCnpj,
            email: emailCliente,
            notificationDisabled: true 
        };

        try {
            const customerResponse = await axios.post(`${ASAAS_BASE_URL}/customers`, customerBody, { headers: asaasHeaders });
            customerId = customerResponse.data.id;
            console.log(`Cliente criado com sucesso. ID: ${customerId}`);
        } catch (createError) {
             const errors = createError.response?.data?.errors;
             
             if (createError.response && createError.response.status === 400 && errors?.some(err => err.code === 'invalid_cpfCnpj')) {
                 console.log('Cliente já existe. Buscando cliente existente...');
                 const searchResponse = await axios.get(`${ASAAS_BASE_URL}/customers?cpfCnpj=${cpfCnpj}`, { headers: asaasHeaders });

                 if (searchResponse.data.data && searchResponse.data.data.length > 0) {
                    customerId = searchResponse.data.data[0].id;
                    console.log(`Cliente existente encontrado e ID capturado: ${customerId}`);
                 } else {
                     throw new Error('Erro ao criar/encontrar cliente no Asaas.');
                 }
             } else {
                 throw createError;
             }
        }
    
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
        
        // --- ALTERAÇÃO 4: SALVAR NO SUPABASE (OPCIONAL MAS RECOMENDADO AQUI) ---
        // Se você já tiver configurado o Supabase no webhook-asaas.js, 
        // este é o momento de inserir o registro PENDING na tabela.
        // Se preferir focar apenas no erro do Front, pule esta parte por enquanto.

        console.log('3. Recuperando QR Code PIX...');
        const pixQrCodeResponse = await axios.get(`${ASAAS_BASE_URL}/payments/${paymentId}/pixQrCode`, { headers: asaasHeaders });

        return res.status(200).json({
            status: 'success',
            paymentId: paymentId,
            customer: customerId,
            qrCode: pixQrCodeResponse.data.encodedImage,
            payload: pixQrCodeResponse.data.payload,
            expirationDate: pixQrCodeResponse.data.expirationDate
        });

    } catch (error) {
        console.error('ERRO NO FLUXO ASAAS:', error.message);
        if (error.response) {
            return res.status(error.response.status).json({
                error: error.response.data.errors?.[0]?.description || 'Falha na comunicação com o Asaas.'
            });
        }
        return res.status(500).json({ error: 'Falha interna ao processar o PIX.' });
    }
}

module.exports = processarPagamentoAsaas;