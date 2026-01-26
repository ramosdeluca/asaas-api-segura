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

  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  if (!ASAAS_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'ASAAS_ACCESS_TOKEN não configurado.' });
  }

  const {
    nomeCliente,
    cpfCnpj,
    emailCliente,
    valorCreditos,
    descricao = 'Compra de créditos',
    customer_id_asaas // 👈 NOVO
  } = req.body;

  if (!valorCreditos || isNaN(valorCreditos)) {
    return res.status(400).json({ error: 'Valor inválido.' });
  }

  let customerId = customer_id_asaas || null;

  try {
    // -------------------------------------------------
    // 1️⃣ CRIAR OU USAR CLIENTE
    // -------------------------------------------------
    if (!customerId) {
      if (!nomeCliente || !cpfCnpj || !emailCliente) {
        return res.status(400).json({
          error: 'Dados do cliente obrigatórios quando customer_id_asaas não é informado.'
        });
      }

      console.log(`Criando/buscando cliente Asaas para CPF/CNPJ: ${cpfCnpj}`);

      try {
        const customerResponse = await axios.post(
          `${ASAAS_BASE_URL}/customers`,
          {
            name: nomeCliente,
            cpfCnpj,
            email: emailCliente,
            notificationDisabled: true
          },
          { headers: asaasHeaders }
        );

        customerId = customerResponse.data.id;
        console.log('Cliente criado:', customerId);

      } catch (createError) {
        const errors = createError.response?.data?.errors;

        if (
          createError.response?.status === 400 &&
          errors?.some(err => err.code === 'invalid_cpfCnpj')
        ) {
          console.log('Cliente já existe, buscando...');
          const searchResponse = await axios.get(
            `${ASAAS_BASE_URL}/customers?cpfCnpj=${cpfCnpj}`,
            { headers: asaasHeaders }
          );

          if (searchResponse.data.data?.length) {
            customerId = searchResponse.data.data[0].id;
            console.log('Cliente encontrado:', customerId);
          } else {
            throw new Error('Cliente não encontrado após erro de duplicidade.');
          }
        } else {
          throw createError;
        }
      }
    } else {
      console.log('Usando customer_id_asaas informado:', customerId);
    }

    // -------------------------------------------------
    // 2️⃣ CRIAR PAGAMENTO PIX
    // -------------------------------------------------
    const dueDate = new Date(Date.now() + 3 * 86400000)
      .toISOString()
      .split('T')[0];

    const paymentResponse = await axios.post(
      `${ASAAS_BASE_URL}/payments`,
      {
        billingType: 'PIX',
        customer: customerId,
        value: valorCreditos,
        dueDate,
        description: descricao,
        anticipationDisabled: true
      },
      { headers: asaasHeaders }
    );

    const paymentId = paymentResponse.data.id;

    // -------------------------------------------------
    // 3️⃣ RECUPERAR QR CODE PIX
    // -------------------------------------------------
    const pixQrCodeResponse = await axios.get(
      `${ASAAS_BASE_URL}/payments/${paymentId}/pixQrCode`,
      { headers: asaasHeaders }
    );

    return res.status(200).json({
      status: 'success',
      paymentId,
      customer_id_asaas: customerId, // ✅ SEMPRE RETORNA
      qrCode: pixQrCodeResponse.data.encodedImage,
      payload: pixQrCodeResponse.data.payload,
      expirationDate: pixQrCodeResponse.data.expirationDate
    });

  } catch (error) {
    console.error('Erro Asaas:', error.message);
    return res.status(500).json({
      error: error.response?.data?.errors?.[0]?.description || 'Erro ao processar pagamento.'
    });
  }
}

module.exports = processarPagamentoAsaas;
